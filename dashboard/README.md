# AsterVision AI Visibility Dashboard

AI 可见度数据分析看板。前端 React 19 + Vite 7 + AntV G2，后端 NestJS 11 + Prisma 6 + SQLite，
数据来自 `data/` 下的两份原始 JSON。

## 目录

```
wanxi/
├── data/                       # 原始数据（只读）
│   ├── questions.json          # 120 条回答明细
│   └── dashboard_summary.json  # 4 个汇总块（对账基准）
├── server/                     # NestJS 后端
│   ├── .env.example            # 环境变量模板（.env 不入库，含 LLM 密钥）
│   ├── prisma/
│   │   ├── schema.prisma       # 5 张表（3 张业务 + 2 张会话）
│   │   ├── seed.ts             # 导入 + 口径自检
│   │   └── dev.db              # SQLite 库（由迁移生成）
│   ├── scripts/verify-api.mjs  # 接口对账脚本
│   ├── test/                   # Jest e2e 回归测试
│   └── src/
│       ├── common/             # 口径、日期/区间校验、品牌范围（各接口共用）
│       ├── dashboard/          # 聚合接口
│       ├── records/            # 明细接口
│       ├── meta/               # 筛选项接口
│       ├── insight/            # AI Insight：会话、上下文拼装、GLM 流式
│       ├── health/             # 健康检查
│       └── prisma/             # Prisma 封装
└── web/                        # React 前端
    ├── vite.config.ts          # 127.0.0.1:5173，/api 代理到 3000
    └── src/
        ├── api/                # 类型、fetch 封装、useApi、SSE 解析
        ├── components/
        │   ├── charts/         # 走势图（G2）、哑铃图与主题条形图（手绘 SVG）
        │   ├── insight/        # AI Insight 抽屉（antd X + XMarkdown）
        │   │                   #   SessionList：左侧会话列表 / useInsightChat：会话状态机
        │   ├── Masthead.tsx    # 报头（品牌、周期、样本量）
        │   ├── FilterBar.tsx   # antd：品牌 Select + RangePicker + Segmented
        │   ├── KpiStrip.tsx    # 四个指标
        │   ├── RecordsSheet.tsx# 明细表（antd Table + Pagination）
        │   └── RecordDrawer.tsx# 单条详情抽屉（antd Drawer）
        ├── lib/                # 格式化、银行家舍入、色板、尺寸 hook
        ├── theme.ts            # antd ConfigProvider 主题
        └── styles/             # index（入口）/ tokens / base / app / antd（覆盖组件）
```

## 启动

```bash
cd server
npm install                      # 首次
cp .env.example .env              # 填 DATABASE_URL / LLM_API_KEY
npx prisma migrate dev           # 建表（自动执行 seed）
npm run dev                      # 开发模式，热重载
# 或 npm run build && npm start
```

- 接口：<http://localhost:3000/api/dashboard>
- Swagger：<http://localhost:3000/api/docs>
- 健康检查：<http://localhost:3000/api/health>

`.env` 含模型密钥，已在 `.gitignore` 中排除；新环境从 `.env.example` 复制后再填值。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dashboard?brand&from&to` | 聚合看板，一次返回 4 个块 |
| GET | `/api/records?…` | 回答明细分页、筛选、排序 |
| GET | `/api/records/:id` | 单条详情（含引用明细） |
| GET | `/api/meta?brand` | 筛选项：品牌/周期/平台/主题/意图/情绪 |
| GET | `/api/insight/sessions?brand&limit` | 会话列表（按品牌取全部区间，带消息条数） |
| GET | `/api/insight/history?session_id` | 指定会话的消息；不传 `session_id` 则取该品牌+区间最近一条 |
| POST | `/api/insight/chat` | AI 对话，`text/event-stream` 流式返回 |
| GET | `/api/health` | 健康检查 |

所有接口统一用 snake_case，字段名与源数据保持一致，前端不需要做字段映射。

### 聚合接口

`GET /api/dashboard?brand=AsterVision&from=2026-08-01&to=2026-08-30`

三个参数都可选，缺省取 `DEFAULT_BRAND` 与该品牌在库里的实际日期范围。返回结构与你提供的
`dashboard_summary.json` **逐字段一致**（含字段顺序），可直接做文本 diff。

```jsonc
{
  "brand": "AsterVision",
  "period": "2026-08-01~2026-08-30",
  "summary": { "visibility_score": 71, "mentions": 85, "recommendations": 56,
               "citations": 71, "questions_analyzed": 120 },
  "platforms": [{ "name": "ChatGPT", "visibility": 76, "mentions": 19,
                  "recommendations": 13, "citations": 18, "question_count": 25 }],
  "trend":     [{ "date": "2026-08-01", "visibility": 75, "mentions": 3, "recommendations": 2 }],
  "topics":    [{ "topic": "Warehouse Security", "questions": 15, "visibility": 80, "recommendations": 9 }]
}
```

### 明细接口

`GET /api/records?brand&from&to&platform&topic&sentiment&intent_type&mentioned&keyword&page&page_size&sort_by&sort_dir`

- `platform` / `topic` 支持逗号分隔多选，例如 `platform=ChatGPT,Gemini`
- `sort_by` 白名单：`date` / `platform` / `topic` / `question` / `citations`，默认 `date` 倒序
- 返回 `{ items, total, page, page_size, page_count }`；列表不含 `citations`，详情才返回

`GET /api/records/1` 返回列表项字段 + `citations: [{ title, url, source_type }]`。

### 筛选项

`GET /api/meta` 返回品牌列表、数据周期、平台/主题及其记录数、意图码与情绪分布。
统计口径是品牌全量数据，不随页面筛选变化，避免下拉选项越筛越少。

错误统一为 `{ statusCode, error, message, path, timestamp }`，成功响应不套壳。

## 前端

技术栈：React 19 + Vite 7 + AntV G2 5 + **antd 6** + **Tailwind CSS 4** + **@ant-design/x 2**。

```bash
cd web
npm install
npm run dev        # http://127.0.0.1:5173，需后端已在 3000 运行
npm run build      # tsc --noEmit + vite build → dist/
npm run preview    # http://127.0.0.1:4173，跑生产产物（同样代理 /api）
```

`vite.config.ts` 里 `server.host` 必须写成 `127.0.0.1`：不指定时 Vite 只监听 `::1`，
而 `/api` 代理指向的是 IPv4 的 `127.0.0.1:3000`，会出现「页面能开、接口全 404」。

### 布局：上图下表

单页三段，全部由 `GET /api/dashboard` 一个请求驱动，筛选只改 query：

| 区块 | 内容 |
|---|---|
| 报头 + 筛选 | 品牌、日期区间、快捷周期（全部 / 末 7 天 / 末 14 天） |
| KPI 四连 | 可见度、被推荐、引用来源、提及缺口，每个都带分子分母与进度细线 |
| 01 可见度走势 | 每日可见度柱状 + 7 日滚动线 + 整体基准虚线；右侧并列「提及 → 推荐」转化台账 |
| 02 平台与主题 | 左：可见度 vs 推荐率哑铃图；右：8 个主题的可见度条形图 |
| 03 回答明细 | 平台多选、提及状态分段、关键词搜索、表头排序、分页；点行开详情抽屉 |

筛选状态写进 URL（`?brand=&from=&to=&record=`），刷新和分享都能还原到同一视图。

### 交互控件一律用 antd 组件

自己手写的 `<select>` / `<input type="date">` / 自绘分页全部换成了组件：

| 位置 | 组件 | 说明 |
|---|---|---|
| 品牌 | `Select` | 选项带记录数；`id` 挂在内部 input 上，外层用 `<label htmlFor>` 关联 |
| 周期 | `DatePicker.RangePicker` | `disabledDate` 锁在品牌数据范围内，`presets` 同时提供快捷区间 |
| 快捷周期 | `Segmented` | 单选；与 RangePicker 双向联动，区间不匹配预设时无选中项 |
| 平台多选 | `Select mode="multiple"` | `maxTagCount="responsive"`，窄屏自动折叠成 +N |
| 提及状态 | `Segmented` | 全部 / 已提及 / 未提及 |
| 关键词 | `Input.Search` | 防抖仍放在 App 层（320ms），组件只负责输入 |
| 明细表 | `Table` | `sorter` + 受控 `sortOrder`，排序落到服务端 `sort_by/sort_dir` |
| 分页 | `Pagination` | `showSizeChanger`，每页 20 / 50 / 100 |
| 详情 | `Drawer` | 遮罩、Esc、焦点管理交给 antd，不再手写 portal 与焦点归还 |
| 错误 / 加载 | `Alert` / `Skeleton` | 失败态带「重试」按钮 |
| AI Insight 入口 | `Button` | 筛选栏右端（`FilterBar` 的 `action` 插槽），随吸顶常驻；≤620 收成圆形图标 |
| 会话列表 | `Conversations`（antd X） | 左侧栏，`activeKey` 受控；高度要覆盖，默认 40px 单行放不下两行 |
| 对话消息 | `Bubble.List`（antd X） | 用户靠右实心、AI 靠左无框；头像走 `Bubble.avatar` 角色级配置 |
| 输入框 | `Sender`（antd X） | `loading` 时自动变停止按钮，`onCancel` 中断上游 |
| AI 回答正文 | `XMarkdown`（x-markdown） | `streaming.hasNextChunk` 处理未闭合语法，`escapeRawHtml` 防 XSS |
| 角色头像 | `Avatar` | AI 朱红实心 + 闪电，用户白底描边 + 人形，26px |

### Tailwind 与 antd 怎么共存

两个坑必须处理，否则组件的观感会被打回原形：

1. **不能引入 Tailwind 的 preflight。** 它会把 `button` / `input` 的背景和边框重置掉，
   而 antd 的组件样式是用 `:where()` 压低优先级写的，特异性比 preflight 还低，直接被盖掉。
   所以 `styles/index.css` 只 `@import` 了 `tailwindcss/theme.css` 与 `utilities.css`，
   缺的那点边框默认值在 `base.css` 里手写了三行补上。
2. **自有 CSS 要放进 cascade layer。** 顺序是 `theme → base → components → utilities`，
   自己的样式进 `base` / `components`，Tailwind 工具类留在最后的 `utilities`，
   这样 JSX 上写的 `mb-4`、`text-faint` 一定压得住组件样式。

设计令牌通过 `@theme inline` 接进了 Tailwind：
`bg-surface` / `text-ink` / `border-rule` / `text-accent` 这些类直接读 CSS 变量，
改一处 `tokens.css` 全局生效，不用在两个体系里各维护一份颜色。

### antd 主题

`src/theme.ts` 里用 `ConfigProvider` 对齐视觉，二个点值得记住：

<!-- - `motion: false`。报告页不需要控件动效；更重要的是 `Segmented` 的滑块依赖测量，
  动画未完成时截图/首屏会出现「滑块停在错误选项上、选中项白字落在浅色底上」的错位。 -->
- `colorLink` 必须显式设。antd 会给 `a` 注入全局样式，默认取 `colorInfo`——
  不覆盖的话正文链接会变成浏览器味的蓝色，和这套配色打架。
- `Segmented` 的选中态用墨色而不是主色：橙红只留给数据信号，控件保持中性。

### 图表为什么一半用 G2、一半手绘 SVG

AntV G2 5 只用在走势图（柱 + 双线 + 基准线），这是它擅长的多 mark 叠加。
另外两张图改成手绘 SVG，原因写在这里免得后面再踩：

- **哑铃图**要在一个分类轴上画两套点（实心可见度、空心推荐率）再用连线表达差距，
  右侧还要对齐输出两个数字。G2 的 legend/annotation 体系做这个要绕很多配置，且对齐不稳。
- **主题条形图**在「band 分类轴 + `scale('x', { domain: [0, 100] })`」这个组合下会整块不渲染
  （只有去掉 domain 或改成 linear 才出图），属于库的行为，不值得为它把数据整形变形。

手绘 SVG 的好处是排版完全可控、零额外体积；代价是要自己算刻度。
`src/lib/useElementWidth.ts` 用 `ResizeObserver` 取真实像素宽度再算坐标，
所以窗口缩放时字号不会跟着变形（用 `viewBox` 缩放就会）。

G2 这边有个坑值得记：**入场动画会让截图/首屏里的图表停在半透明状态**，
折线和坐标轴发灰、柱子只到一半高度。所有 mark 都挂了
`noMotion = { enter: { duration: 0 }, update: { duration: 0 }, exit: false }`。
另外 `.color()` 不是 mark 方法，单系列上色要用
`.encode('color', 'series')` + `chart.scale('color', { domain, range })` + `chart.legend(false)`。

### 视觉与可访问性

**明亮报告体**：浅灰底 `#f4f6f9` + 纯白卡片 + 发丝边 + 极轻阴影，主信号用亮朱红 `#f4511e`。
标题与数字保留宋体，正文苹方、小标签等宽体——按「研究报告」而不是「管理后台」来做，
但把原来的暖纸底与墨色重量感换成了通透的白面。

| 令牌 | 值 | 用途 |
|---|---|---|
| `--paper` / `--paper-hi` | `#f4f6f9` / `#ffffff` | 页底 / 卡片面 |
| `--ink` / `--muted` / `--faint` | `#0f172a` / `#5c6779` / `#94a0b2` | 三级文字 |
| `--rule` / `--rule-strong` | `#e3e8ef` / `#cfd6e0` | 分隔线 / 强调线 |
| `--accent` / `--accent-wash` | `#f4511e` / `#ffe9e0` | 主信号 / 浅底高亮 |

平台色是固定的五个（ChatGPT 青 / Gemini 亮朱红 / Claude 琥珀 / Perplexity 蓝 / DeepSeek 紫），
不随排序变化，保证同一平台在任何区块里颜色一致；哑铃图里「推荐率」固定用蓝色空心点，
和「可见度」的橙色实心点在色相上拉开。

百分比一律走 `src/lib/format.ts` 的 `ratioPct()`，和后端 `roundHalfEven()` 用同一套银行家舍入，
避免前端算出后端没给的数（例如 15/24 必须显示 62 而不是 63）。

可访问性上：表格排序走 antd 的 `aria-sort`，抽屉用 antd `Drawer`（`role="dialog"` + 焦点陷阱 +
Esc + 焦点归还），`prefers-reduced-motion` 关闭动效，跳过导航的 skip-link，
表格行可 Tab 聚焦并回车打开详情。
响应式断点 1180 / 860 / 620：窄屏下三张卡片单列堆叠、明细表在卡片内横向滚动，
报头右侧的 vintage 标签与标题分隔符会收起来，避免 mono 标签挤成两行。

## AI Insight

筛选栏右端的「AI Insight」打开一个抽屉，可以就当前看板的数据提问。用 `@ant-design/x`
（`Bubble.List` + `Sender`）搭对话界面，`@ant-design/x-markdown` 渲染模型输出。

### 上下文怎么来

模型不能自己去查库，否则它会算出和页面对不上的数。做法是：`InsightService` 直接注入
`DashboardService`，用当前 `brand / from / to` 调一次 `getOverview()`，把聚合结果压成一段
Markdown 表格塞进 system prompt，然后再附上「口径」说明：

- 可见度 = 提及问题数 ÷ 提问数；推荐率 = 推荐问题数 ÷ 提问数
- 两者落差大，代表「提过但不愿推」，属于内容问题而不是曝光问题
- 每天只有约 4 条样本，单日可见度只能落在少数几档，日间跳动是噪声
- 百分比是银行家舍入，不要自行重算

这样模型看到的数字和页面上完全一致，也不会把单日锯齿解读成趋势。一次约 1.1K prompt token。

### 流式返回

`POST /api/insight/chat` 返回 `text/event-stream`，事件顺序：

```
event: meta   data: {"session_id":"…","user_message_id":12}
event: delta  data: {"text":"从数据看，" }      ← 多次
event: done   data: {"message_id":13,"usage":{"prompt_tokens":1102,"completion_tokens":147}}
```

失败走 `event: error`。前端用 `fetch` + `ReadableStream` 自己解析，没用 `EventSource`
（它只支持 GET，而提问要放在 body 里）。

### 会话

抽屉是双栏：左边「对话记录」，右边当前对话。

**列表按品牌取全部区间**（`GET /api/insight/sessions`），不按日期过滤 —— 否则把看板切到
另一个月之后，之前的对话就再也看不见了。每条显示首句提问、所属区间、消息条数和相对时间。

点开一条属于别的区间的会话，看板会跟着切过去：AI 的回答永远绑定在某段数据上，脱离区间
讲结论没有意义，所以 `onScopeChange` 会把 `brand / from / to` 推回 `App`，两边保持同源。
切换期间 `activeSessionId` 的优先级高于「取最近一条」，不会被区间变化的副作用覆盖。

「新对话」只是本地草稿态：清空视图但不发请求，首条消息才真正建会话。
客户端中断（关抽屉、点停止）时，已生成的部分仍会落库，刷新不会丢。

### 三个容易踩的点

- **`@Res()` 会绕过 NestJS 的响应管道**。`AllExceptionsFilter` 对 SSE 路由失效，
  且 headers 一旦 flush 就无法改状态码，所以 `InsightService.chat()` 整个流程用 try/catch
  包住，任何失败都翻译成 `event: error`。
- **`Bubble.List` 的 `autoScroll` 要求父容器是 flex column**，否则消息少时会贴底而不是贴顶。
- **antd 的样式是运行时注入的、不带 cascade layer**。而 `app.css` 整份在
  `@layer components` 里，按规范未分层样式优先级高于任何 layer —— 也就是说放在 layer 里
  的覆盖不管特异性多高都会输。需要压过 antd 的规则集中在 `styles/antd.css`，这个文件
  **故意不带 layer 引入**。头像是白底改朱红、会话项要放开 40px 固定高度，都靠这一点才生效。

### 视觉

抽屉整体白色系：body 纯白、侧栏 `#fafbfc`、只靠 1px 发丝线分层。朱红 `#f4511e` 只做信号色，
出现在三处——AI 头像、会话选中态、发送按钮。用户气泡是浅灰蓝 `#eef2f7`，与 AI 的纯白无框
气泡形成区分。

抽屉根容器的类名是 `insight-panel`，**不能叫 `insight`**：`.insight` 是
`ConversionPanel` 里引用块的类（左侧 2px 橙条 + 淡橙底 `#ffe9e0`），两个组件同选择器时
属性会合并，整个抽屉会被染成橙色。

窄屏（≤860px）侧栏收起，标题栏出现「历史」按钮，点开是左滑的历史抽屉，复用同一个
`SessionList`。

### 入口：钉在吸顶筛选栏里

筛选栏本身是 `position: sticky; top: 0`，把入口放进去就**天然常驻**，不需要额外的浮层。
所以没有悬浮按钮、没有滚动监听，报头也不放按钮——这是净减代码的一次改动。

`FilterBar` 只加一个 `action` 插槽，由 `App` 把按钮传进去：

```tsx
<FilterBar … action={
  <Button type="primary" icon={<ThunderboltOutlined />} className="insight-entry">…</Button>
} />
```

筛选组件仍然只管筛选，换到别的页面复用时可以不带这个入口。

按宽度分三档，`scrollWidth` 实测无横向溢出：

| 断点 | 排布 |
|---|---|
| ≥ 1180 | 控件 + 「已选…」+ 入口，一行（栏高 54px） |
| 1024–1180 | 收掉「已选…」，入口独占右端 |
| 860–1024 | 控件再收窄（品牌 196→160、周期 268→226），避免换行把吸顶栏撑成两倍高 |
| ≤ 620 | 入口收成 32px 圆形图标，文字 `display: none`，另给 `aria-label` |

控件宽度写成 CSS 变量（`--filter-brand-w` / `--filter-range-w`），组件上是
`style={{ width: 'var(--filter-brand-w)' }}`。若把 `width: 196` 内联写死，媒体查询就改不动了。

窄屏那条圆形化规则**必须放 `styles/antd.css`**：`width` / `padding` / `border-radius` 是
antd `Button` 自己写的，放在 `@layer components` 里会被未分层样式压掉。

## 指标口径

**`visibility_score` = 提及率**：

```
visibility = round(SUM(brand_mentioned) / COUNT(*) × 100)
```

用总览 + 5 平台 + 8 主题 + 30 天共 44 个数据点反推验证，与源文件 100% 吻合，没有隐藏权重。

⚠️ 舍入方式必须注意：源数据由 Python `round()` 生成，属于**银行家舍入**。
Claude 是 15/24 = 62.5，源文件里是 **62**；而 SQL 的 `ROUND()` 和 JS 的 `Math.round()` 都会给 **63**。
因此 SQL 只返回整数分子分母，百分比统一由 `src/common/metrics.ts` 的 `roundHalfEven()` 计算。

另外两个数据特征会影响图表，别踩：

- 每天固定 4 条记录，日可见度只能取 25/50/75/100 四档，折线会像台阶，建议配 7 日滚动或按周聚合。
- 可见度与推荐率排序会反转：Gemini 可见度最高（87）但推荐率只排第三（52%），
  Perplexity 推荐率最高（62%）。只看可见度会漏掉「被提及但不被推荐」的情况。

## 数据模型（5 张表）

| 表 | 行数 | 说明 |
|---|---|---|
| `answer_records` | 120 | 唯一事实表。引用与提及产品存 JSON 文本（SQLite 无 JSON 类型，Prisma 也不支持 SQLite 的 `Json`） |
| `platforms` | 5 | 平台维度，提供稳定排序 |
| `import_batches` | 1 | 导入批次，支撑幂等与溯源 |
| `insight_sessions` | 运行时 | AI Insight 会话，按「品牌 + 区间」区分 |
| `insight_messages` | 运行时 | 会话消息，`role` 为 user / assistant |

不单独建 trend 表：它是纯聚合结果，建表等于制造第二个事实来源。唯一值得建表的情况是口径会版本化。

`UNIQUE(platform_id, question, observed_on)` 是导入幂等的依据，重复 `npm run db:seed` 不会产生重复行。

会话两张表不参与任何指标计算，删掉不影响看板；`insight_messages` 通过外键级联随会话删除。

## 验证

```bash
cd server

npx prisma db seed     # 导入后自检 145 项（总览/平台/主题/趋势 + brand 一致性）
npm test               # Jest e2e：7 个用例，含与源文件的逐字段全等断言
npm run verify:api     # 需服务已启动：17 项对账，覆盖聚合/明细/meta/分页/筛选/校验分支

# AI Insight（需 .env 里的 LLM_API_KEY）
curl -s "http://localhost:3000/api/insight/history?brand=AsterVision&from=2026-08-01&to=2026-08-30"
curl -sN -X POST http://localhost:3000/api/insight/chat \
  -H 'Content-Type: application/json' \
  -d '{"brand":"AsterVision","from":"2026-08-01","to":"2026-08-30","message":"最大的问题是什么？"}'
# 期望：event: meta → 多个 event: delta → event: done（带 usage）
```

```bash
cd web
npm run typecheck      # tsc --noEmit，strict + noUnusedLocals
npm run build          # 类型检查 + 生产打包
```

改任何 SQL 前先跑 `npm test`，它是口径的护栏。
