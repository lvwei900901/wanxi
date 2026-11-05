# NestJS + Prisma 后端实现方案

> 目标：把当前「Next.js 内嵌只读数据层」改造为 **NestJS（业务与数据）+ Next.js（渲染与 SEO）** 的前后端分离结构，
> 数据库继续用 SQLite（题目要求），Prisma 作为唯一 ORM；保留已验证的 10 表模型、增量索引与蓝绿切换能力。

---

## 1. 约束与现状

| 项 | 现状 | 对本方案的影响 |
|---|---|---|
| 数据规模 | 1 品牌 / 5 系列 / 20 产品 / 40 FAQ / 94 向量块 | 不需要分库分表，单机单文件足够 |
| 数据库 | `data/knowledge.db`，10 表 13 外键，DDL 在 `db/schema.sql` | 已有 DDL 是资产，迁移要保留 CHECK 约束 |
| 数据访问 | `src/lib/db.ts`（`node:sqlite`，同步，只读） | 全部收敛到 Prisma，web 端不再连库 |
| 知识库更新 | `src/lib/kb/{templates,embed,indexer}.ts`，已实测增量 + 蓝绿 | 逻辑平移进 Nest 模块，不重写 |
| 页面 | 仅有默认首页，列表/详情尚未开发 | **切换成本最低的时刻**，不存在改造成本 |
| 环境 | Node 22 / macOS arm64；官方引擎源慢，npmmirror 镜像 200 OK | 需在 `.npmrc` 固定 `PRISMA_ENGINES_MIRROR` |

---

## 2. 架构决策

### 2.1 职责切分

- **NestJS = 唯一数据出口**：业务查询、RAG 检索、索引重建、写操作、Strapi webhook 全在这里。
- **Next.js = 渲染层**：Server Component 调 API 取数，负责 HTML、Metadata、JSON-LD、sitemap。
- **SQLite 由 api 进程独占写入**，Next 侧删掉 `src/lib/db.ts`，避免双写与缓存不一致。

### 2.2 为什么不让 Next 直连数据库（BFF 模式）

直连能省一次 HTTP 往返，但会带来三个问题，且都影响本次考核点：

1. **写入路径分裂**：上线接 Strapi 后，Next 直连的只读副本与 api 的写入无法保证同一事务视图。
2. **契约无法证明**：题目要求「后端 NestJS + Prisma」，数据若由 Next 直读，Nest 层就退化成脚本。
3. **SEO 与缓存**：内容页需要 ISR 缓存，走 HTTP 才能用 `revalidate`/`tag` 精确失效；直连库只能靠定时刷新。

代价是首屏多一跳内网请求（本机 <5ms）。用 ISR 摊掉后，用户请求基本命中静态产物，不接受这一跳的是构建期，不是访客。

### 2.3 调用链

```
浏览器 → Next (SSR/ISR, :3000) → HTTP → Nest (:3001) → Prisma → SQLite
                     ↑                                    │
                     └──── revalidateTag('kb') ←── reindex ┘
Strapi ── webhook ──→ POST /api/v1/index/reindex (Bearer)
```

---

## 3. 仓库结构（npm workspaces 单仓）

```
wanxi_knowledge/
├─ apps/
│  ├─ api/                  # NestJS 11
│  └─ web/                  # 现有 Next 16（整目录平移）
├─ packages/
│  ├─ db/                   # Prisma schema、迁移、seed、PrismaService 工厂
│  └─ contracts/            # 纯 TS DTO 类型，零运行时依赖，前后端共享
├─ data/knowledge.db
├─ docs/
└─ package.json             # workspaces + 顶层脚本
```

顶层脚本约定：

```json
{
  "dev": "npm-run-all -p dev:api dev:web",
  "db:generate": "npm -w @kb/db run generate",
  "db:migrate": "npm -w @kb/db run migrate",
  "db:seed": "npm -w @kb/db run seed",
  "db:reset": "npm -w @kb/db run reset",
  "kb:reindex": "npm -w @kb/api run reindex --"
}
```

> 不用 Turborepo/Nx：两个应用 + 两个包，workspaces 的拓扑顺序已经够用，少一层工具就少一处环境风险。

---

## 4. 数据层（Prisma）

### 4.1 映射规则

| 现状 | Prisma 写法 | 说明 |
|---|---|---|
| `snake_case` 表/列 | `@@map("product_series")` / `@map("series_id")` | 保留现有命名，SQL 调试仍可直接读 |
| 整数布尔 `is_canonical` | `Boolean @map("is_canonical")` | Prisma 对 SQLite 布尔存 0/1，语义更强 |
| JSON 文本列 | `String` + 服务层 `JSON.parse` | SQLite 无 JSON 类型；不引 `Json`（该类型仅 PG/MySQL 支持） |
| 状态枚举 | `String` + Zod 校验 + DDL CHECK | **SQLite 不支持 Prisma enum**，双保险放应用层 |
| `embedding BLOB` | `Bytes` | 2048×4 = 8KB/条，94 条约 770KB |
| 时间戳 | `DateTime @default(now())` / `@updatedAt` | 统一由 Prisma 写入，不再手工拼 ISO 串 |

关键模型片段：

```prisma
model Product {
  id               Int      @id @default(autoincrement())
  brandId          Int      @map("brand_id")
  seriesId         Int      @map("series_id")
  legacyId         Int?     @unique @map("legacy_id")
  slug             String   @unique
  name             String
  shortDescription String?  @map("short_description")
  overview         String?
  resolution       String?
  connectivity     String?
  environment      String?
  extraSpecs       String?  @map("extra_specs")
  status           String   @default("active")
  sortOrder        Int      @default(0) @map("sort_order")
  publishedAt      DateTime? @map("published_at")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  series    ProductSeries   @relation(fields: [seriesId], references: [id], onDelete: Restrict)
  features  ProductFeature[]
  scenarios ProductScenario[]
  faqs      Faq[]

  @@index([seriesId, sortOrder])
  @@index([status])
  @@map("product")
}

model KnowledgeChunk {
  id              Int      @id @default(autoincrement())
  externalId      String   @map("external_id")
  sourceType      String   @map("source_type")
  sourceId        Int?     @map("source_id")
  chunkIndex      Int      @default(0) @map("chunk_index")
  heading         String?
  content         String
  urlPath         String?  @map("url_path")
  embedding       Bytes
  model           String
  dimensions      Int
  contentHash     String   @map("content_hash")
  indexVersion    Int      @map("index_version")
  templateVersion Int      @map("template_version")
  builtAt         DateTime @map("built_at")

  @@unique([indexVersion, sourceType, sourceId, chunkIndex])
  @@index([sourceType, sourceId])
  @@index([indexVersion])
  @@map("knowledge_chunk")
}
```

### 4.2 迁移策略：把现有 DDL 作为 `0_init` 基线

`prisma migrate dev` 生成的 SQLite 迁移**会丢掉 CHECK 约束和部分默认值**（Prisma schema 表达不了 CHECK）。
而 `faq` 的 4 条 scope 自洽约束、`status` 取值约束正是当前数据质量的护栏，不能丢。

采用**基线（baseline）**做法：

1. `packages/db/prisma/migrations/0_init/migration.sql` ← 直接放现有 `db/schema.sql`（已校验通过）。
2. `prisma migrate resolve --applied 0_init` 登记为已应用。
3. 之后的变更走正常 `prisma migrate dev`；需要 CHECK 的变更，用 `--create-only` 生成后手工补 SQL 再应用。
4. 新增 `npm run db:parity`：比对 `pragma table_info` / `foreign_key_list` 与 Prisma DMMF，任何漂移直接失败。

> 这样既让 Prisma 成为 ORM 与迁移工具，又保住了数据库层的约束语义；迁移历史对评审也是可读的。

### 4.3 SQLite 运行参数

`PrismaService.onModuleInit` 里执行一次：

```ts
await this.$executeRawUnsafe('PRAGMA journal_mode = WAL');
await this.$executeRawUnsafe('PRAGMA foreign_keys = ON');
await this.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
```

`DATABASE_URL="file:../data/knowledge.db?connection_limit=1&socket_timeout=10"`（路径相对 `packages/db/prisma/`）。
单写者 + WAL：读不阻塞写，写串行化，正合适本场景。

---

## 5. NestJS 模块与 API 契约

### 5.1 模块划分

| 模块 | 职责 | 依赖 |
|---|---|---|
| `PrismaModule` (global) | 连接生命周期、graceful shutdown、PRAGMA | — |
| `ContentModule` | brand / series / products / scenarios / faqs 只读查询 | Prisma |
| `SearchModule` | 向量载入（active 版）、余弦检索、关键词兜底 | Prisma |
| `RagModule` | 提问编排：embed → 检索 → prompt → 流式回答 + 引用 | Search, Glm |
| `GlmModule` | GLM embedding-3 / chat 客户端，超时重试、维度校验 | — |
| `IndexModule` | 分块、增量重算、蓝绿切换、并发锁、webhook | Glm, Prisma |
| `HealthModule` | `/health`、索引版本与数据统计 | Prisma |

### 5.2 接口清单（前缀 `/api/v1`）

| 方法 | 路径 | 参数 | 返回 | 缓存 |
|---|---|---|---|---|
| GET | `/brand` | — | 品牌 + 统计 | 300s |
| GET | `/series` | — | 系列 + `productCount` | 300s |
| GET | `/series/:slug` | — | 系列 + 产品卡片 | 300s |
| GET | `/products` | `series` `scenario` `q` `includeBeta` | `ProductCard[]` | 60s |
| GET | `/products/:slug` | — | 详情（overview/features/scenarios/faqs/aiFeatures/meta） | 300s |
| GET | `/scenarios` | — | 场景 + `productCount` | 300s |
| GET | `/faqs` | `scope` `ref` | FAQ 列表 | 300s |
| POST | `/ask` | `{ question, topK? }` | SSE：`citations` → `token`… → `done` | no-store |
| GET | `/index` | — | 生效索引版本/块数/模型/构建时间 | 10s |
| POST | `/index/reindex` | `{ force?, dryRun? }` + Bearer | 计划或结果 | no-store |
| GET | `/sitemap` | — | URL 清单（含 `lastmod`） | 600s |
| GET | `/health` | — | `{ db, index, glm }` | no-store |

约定：

- 响应统一 `{ data, meta }`，`meta` 带 `indexVersion` 与 `generatedAt`，便于前端判缓存新鲜度。
- 404 用 Nest `NotFoundException`，全局 `HttpExceptionFilter` 输出 `{ statusCode, message, path, timestamp }`。
- 校验：`class-validator` DTO + `ValidationPipe({ whitelist: true, transform: true })`。
- 限流：`@nestjs/throttler`，`/ask` 10 次/分钟/IP，其余 120 次/分钟。
- Swagger：`/docs`（非生产环境暴露），与 `packages/contracts` 的类型做编译期对齐。

### 5.3 类型共享（避免前后端漂移）

`packages/contracts/src/content.ts` 用纯 TS 声明 DTO：

```ts
export type ProductCardDto = {
  id: number; slug: string; name: string;
  shortDescription: string | null;
  status: 'active' | 'beta' | 'discontinued';
  series: SeriesRefDto;
  keyFeatures: string[];
  scenarios: SeriesRefDto[];
  resolution: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
};
```

api 侧 `class ProductCardResponse implements ProductCardDto`，web 侧直接 import 类型。少一个字段、类型不符都编译不过。
不引 `openapi-typescript` codegen：多一步构建产物，收益和这 60 行手写类型差不多。

---

## 6. AskAI（RAG）实现

```
POST /ask
 → ① 取 active 索引元信息（model/维度必须匹配，否则 409）
 → ② GLM embedding-3 embed(question)（2048 维，超时 8s，2 次退避）
 → ③ 内存矩阵余弦 topK=4，阈值 0.35；按 source 去重后保留 ≤4 条
 → ④ 组装 prompt：命中块 + 编号 + 指令（只依据上下文、无依据就说不知道）
 → ⑤ GLM chat 流式（glm-4-flash）→ SSE token 逐段推回
 → ⑥ 结束后推 citations：{ n, title, urlPath, sourceType, score }
```

要点：

- **缓存**：进程内 `{ version, matrix: Float32Array, norms, rows }`，按 `indexVersion` 命中；reindex 成功即失效，不重启进程。
- **降级**：无 `GLM_API_KEY` 或调用失败 → 关键词检索（name/short_description/overview 的 LIKE）返回命中文档链接，并标注 `degraded: true`；前端展示「AI 暂不可用，这里是相关内容」。
- **不说谎**：所有回答附引用，且 prompt 明确禁止超出上下文推测；无命中直接回「知识库暂无相关内容」。
- **安全**：GLM key 只在 api 进程；web 不持有任何密钥；`/ask` 入参长度上限 300 字，防提示注入的长文本轰炸。
- **SSE 实现**：`@Sse()` + `Observable<MessageEvent>`，`fetch` 读 `ReadableStream` 转 async generator；`AbortSignal` 在客户端断开时透传给上游，避免白烧 token。

---

## 7. 索引更新链路（从脚本平移为模块）

| 现有 | 迁移后 | 变化 |
|---|---|---|
| `src/lib/kb/templates.ts` | `apps/api/src/modules/index/chunk/templates.ts` | 原样搬，`TEMPLATE_VERSION` 不变 |
| `src/lib/kb/embed.ts` | `apps/api/src/modules/glm/glm.service.ts` | 保留 2048 维硬校验与退避 |
| `src/lib/kb/indexer.ts` | `apps/api/src/modules/index/index.service.ts` | Prisma 事务替代裸 SQL；加内存互斥锁 |
| `scripts/reindex.ts` | `apps/api/src/cli/reindex.ts` | 复用 service，`--dry-run/--force` 不变 |
| `/api/reindex` 路由 | `POST /api/v1/index/reindex` | 加 throttle + 审计日志 |

新增强制项：

- **互斥锁**：Strapi 连续保存会并发触发重建，用 `Promise` 串行队列 + 后到者合并，避免两个 `building` 版本互踩。
- **审计**：重建记录写 `embedding_index`（已有 `source_file/built_at`），响应里回传 diff（added/updated/removed/embedded）。
- **回归测试**：把「代码分块结果与 `index.json` 94/94 逐字一致」固化为单测，模板一改就红。

---

## 8. 与 SEO/GEO 的协作边界

后端不生成 HTML，但必须把结构化数据所需的原料一次给全：

| 结构化数据 | 数据来源字段 |
|---|---|
| `Organization` | brand 的 `name/website/foundedYear/logoUrl/sameAs` |
| `Product` | product 的 `name/description/imageUrl/brand/canonicalUrl` |
| `FAQPage` | faq 的 `question/answer/answerSummary` |
| `BreadcrumbList` | series / scenario 的名称 + slug |
| `WebSite` + `SearchAction` | 站点根地址（web 侧拼） |

web 侧 `generateMetadata()` 与 `<script type="application/ld+json">` 全部基于 DTO 生成；
canonical 由 DTO 的 `canonicalUrl` 兜底拼 `${SITE_URL}/products/${slug}`。

---

## 9. 实施步骤与验收标准

| # | 步骤 | 产出 | 验收 |
|---|---|---|---|
| S1 | Workspaces 改造，web 平移至 `apps/web` | 根 `package.json`、workspaces | `npm run build -w @kb/web` 通过，页面无变化 |
| S2 | `packages/db`：Prisma schema + `0_init` 基线 + parity 脚本 | schema、迁移、`db:parity` | `migrate resolve` 后 `prisma migrate status` 干净；parity 无差异 |
| S3 | seed / 向量导入改写为 Prisma | `packages/db/seed/*.ts` | 行数仍为 1/5/20/25/140/16/64/40/94；连跑两次幂等 |
| S4 | Nest 骨架：PrismaModule + Health + Swagger + 过滤器 | `apps/api` 可启动 :3001 | `/health` 返回 db ok、index v1、94 块 |
| S5 | ContentModule 五组只读接口 | DTO + service + controller | 6 个单测通过；`/products?series=nova` 与旧 `listProducts` 结果逐字段一致 |
| S6 | SearchModule + RagModule | 检索与 SSE | 自检 94/94 自命中；`/ask` 有引用、无 key 时降级 |
| S7 | IndexModule（含锁与审计） | service + CLI + webhook | `--dry-run` 0/0/94；改 1 条 → 只重算 1 块；下架 → 精确移除 |
| S8 | web 对接：删除 `src/lib/db.ts`，页面 + SEO | 列表/详情/JSON-LD | 构建通过；`view-source` 能看到完整正文与 JSON-LD |
| S9 | e2e + README | supertest 用例 | 未知 slug 404；筛选组合正确；`/ask` 限流生效 |

> 顺序不可颠倒：S2/S3 是数据血统，S5 之后才允许删 web 的库访问；S8 之前页面保持现状即可。

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Prisma 引擎下载超时（已发生过两次） | 装不上 | `.npmrc` 固定 `PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma`（实测 200）；版本锁 `6.19.3`（稳定，非 8.0 RC） |
| Prisma 表达不了 CHECK / enum | 约束退化 | 基线迁移保留手写 DDL；应用层 Zod 校验；`db:parity` 兜底 |
| SQLite 单写者锁 | 并发重建报 `SQLITE_BUSY` | WAL + `busy_timeout` + 重建互斥队列 |
| `Bytes` 读写类型出入 | 向量错位 | S3 增加字节级断言：读回 `Float32Array` 与原 vector 逐元素相等 |
| Next 16 `cacheComponents` 与 `revalidate` 冲突 | S8 构建失败 | 已踩过 `runtime/dynamic` 的坑；改用 `use cache` + `cacheTag`，S8 先做 1 个页面验证再批量 |
| 服务拆分后 web 单点依赖 api | api 挂则整站 500 | web 侧 fetch 失败走 ISR 旧产物（Next 默认保留），并给 `/api/health` 探活与 PM2/systemd 自启 |

**兜底方案（若 Prisma 仍装不上）**：把数据访问收敛为 `ContentRepository` 接口，先由 `node:sqlite` 实现（现有代码已验证），Prisma 实现并行写好但不启用；API 契约、模块划分、web 对接全部不受影响，只换一个 provider 注入。这样 S4~S9 不会被二进制下载卡住。

---

## 11. 待确认决策

| # | 决策点 | 建议 | 备选 |
|---|---|---|---|
| 1 | 服务边界 | web SSR 调 api（职责干净、契约可验） | web 直连库（少一跳，但后端退化、缓存难失效） |
| 2 | 仓库形态 | npm workspaces 单仓 | 两个独立目录，各自 `node_modules` |
| 3 | 迁移策略 | 现有 DDL 作 `0_init` 基线，保留 CHECK | 全交给 `prisma migrate`（丢 CHECK，校验上移应用层） |
| 4 | 提问交互 | SSE 流式 + 引用卡片 | 一次性 JSON（实现更简单，等待感差） |
| 5 | Prisma 版本 | 6.19.3 稳定线 | 8.0.0-rc（`latest` 标签当前指向 RC，不建议） |
| 6 | 数据库 | 继续 SQLite（题目要求），schema 保持 PG 可迁移 | 直接上 PostgreSQL（偏离题目） |
