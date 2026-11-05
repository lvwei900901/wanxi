/**
 * 端到端对账：把接口返回值和 dashboard_summary.json 逐字段比对。
 *
 * 用法：node scripts/verify-api.mjs
 * 前置：服务已启动（npm run start）
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/api';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

let pass = 0;
let fail = 0;
const lines = [];

function ok(label, detail = '') {
  pass += 1;
  lines.push(`  \u2713 ${label}${detail ? '  ' + detail : ''}`);
}
function bad(label, detail = '') {
  fail += 1;
  lines.push(`  \u2717 ${label}${detail ? '  ' + detail : ''}`);
}

/** 键序无关的深比较，返回差异路径列表 */
function diff(a, b, path = '$', out = []) {
  if (a === b) return out;
  if (typeof a !== typeof b || a === null || b === null) {
    out.push(`${path}: ${JSON.stringify(a)} \u2260 ${JSON.stringify(b)}`);
    return out;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push(`${path}: 数组类型不一致`);
      return out;
    }
    if (a.length !== b.length) out.push(`${path}.length: ${a.length} \u2260 ${b.length}`);
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i += 1) diff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) out.push(`${path}.${k}: 接口缺少该字段`);
      else if (!(k in b)) out.push(`${path}.${k}: 接口多出该字段`);
      else diff(a[k], b[k], `${path}.${k}`, out);
    }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(a)} \u2260 ${JSON.stringify(b)}`);
  return out;
}

const expected = JSON.parse(
  readFileSync(join(ROOT, 'data/dashboard_summary.json'), 'utf8'),
);
const source = JSON.parse(
  readFileSync(join(ROOT, 'data/questions.json'), 'utf8'),
);

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const roundHalfEven = (v) => {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};
const pct = (n, t) => (t ? roundHalfEven((n / t) * 100) : 0);

// ---- 用例 1：默认请求应与源文件完全一致 ----
{
  const { status, body } = await get('/dashboard');
  if (status !== 200) bad('默认请求', `HTTP ${status}`);
  else {
    const d = diff(body, expected);
    if (d.length === 0) ok('默认请求与 dashboard_summary.json 完全一致', '全字段逐项相等');
    else {
      bad('默认请求存在差异', `${d.length} 处`);
      d.slice(0, 8).forEach((x) => lines.push(`      ${x}`));
    }
    const byteEqual = JSON.stringify(body) === JSON.stringify(expected);
    if (byteEqual) ok('序列化后的键顺序也一致', '可直接做文本 diff');
    else lines.push('  \u00b7 提示：键顺序与源文件不同（结构一致，不影响前端）');
  }
}

// ---- 用例 2：显式传 brand + 全区间 ----
{
  const { status, body } = await get(
    '/dashboard?brand=AsterVision&from=2026-08-01&to=2026-08-30',
  );
  if (status === 200 && diff(body, expected).length === 0)
    ok('brand + 完整日期区间', '与源文件一致');
  else bad('brand + 完整日期区间', `HTTP ${status}`);
}

// ---- 用例 3：7 天子区间，独立用源 JSON 反算 ----
{
  const from = '2026-08-01';
  const to = '2026-08-07';
  const { status, body } = await get(`/dashboard?from=${from}&to=${to}`);
  const rows = source.filter((r) => r.date >= from && r.date <= to);
  const mentions = rows.filter((r) => r.brand_mentioned).length;
  const recs = rows.filter((r) => r.brand_recommended).length;
  const cites = rows.reduce((s, r) => s + r.citation_count, 0);

  if (status !== 200) bad('7 天子区间', `HTTP ${status}`);
  else if (body.period !== `${from}~${to}`) bad('7 天子区间.period', body.period);
  else if (body.summary.questions_analyzed !== rows.length)
    bad('7 天子区间.条数', `${body.summary.questions_analyzed} \u2260 ${rows.length}`);
  else if (body.summary.mentions !== mentions) bad('7 天子区间.提及', `${body.summary.mentions}`);
  else if (body.summary.recommendations !== recs) bad('7 天子区间.推荐', `${body.summary.recommendations}`);
  else if (body.summary.citations !== cites) bad('7 天子区间.引用', `${body.summary.citations}`);
  else if (body.summary.visibility_score !== pct(mentions, rows.length))
    bad('7 天子区间.可见度', `${body.summary.visibility_score}`);
  else if (body.trend.length !== 7) bad('7 天子区间.趋势天数', `${body.trend.length}`);
  else
    ok(
      `7 天子区间（${from}~${to}）`,
      `条数 ${rows.length} / 可见度 ${pct(mentions, rows.length)} / 趋势 ${body.trend.length} 天`,
    );

  if (body.platforms.length === 5) ok('筛选后平台仍返回 5 个', '空平台补 0，图表不塌陷');
  else bad('筛选后平台数量', `${body.platforms.length}`);
}

// ---- 用例 4：未知品牌 ----
{
  const { status, body } = await get('/dashboard?brand=NoSuchBrand');
  if (status === 404 && String(body?.message).includes('AsterVision'))
    ok('未知品牌返回 404', '并给出可选品牌');
  else bad('未知品牌', `HTTP ${status}`);
}

// ---- 用例 5：区间倒置 / 不存在的日期 ----
{
  const a = await get('/dashboard?from=2026-08-10&to=2026-08-01');
  if (a.status === 400) ok('区间倒置返回 400', a.body?.message);
  else bad('区间倒置', `HTTP ${a.status}`);
}
{
  const b = await get('/dashboard?from=2026-02-31');
  if (b.status === 400) ok('不存在的日期返回 400', b.body?.message);
  else bad('不存在的日期', `HTTP ${b.status}`);
}
{
  const c = await get('/dashboard?from=2026-8-1');
  if (c.status === 400) ok('日期格式错误返回 400', '要求 YYYY-MM-DD');
  else bad('日期格式错误', `HTTP ${c.status}`);
}

// ---- 用例 6：明细列表 ----
{
  const { status, body } = await get('/records');
  if (status !== 200) bad('明细列表', `HTTP ${status}`);
  else if (body.total !== 120) bad('明细列表.total', `${body.total}`);
  else if (body.items.length !== 20) bad('明细列表.默认页大小', `${body.items.length}`);
  else if (body.page_count !== 6) bad('明细列表.page_count', `${body.page_count}`);
  else if (body.items[0].date !== '2026-08-30')
    bad('明细列表.默认按日期倒序', body.items[0].date);
  else ok('明细列表默认分页', 'total 120 / 每页 20 / 6 页 / 日期倒序');
}

// ---- 用例 7：分页边界 ----
{
  const last = await get('/records?page=6&page_size=20');
  const over = await get('/records?page=7&page_size=20');
  if (last.body?.items?.length === 20 && over.body?.items?.length === 0)
    ok('翻页边界', '第 6 页满、第 7 页空');
  else bad('翻页边界', `${last.body?.items?.length} / ${over.body?.items?.length}`);
}

// ---- 用例 8：筛选 ----
{
  const multi = await get('/records?platform=ChatGPT,Gemini');
  const mentioned = await get('/records?mentioned=true');
  const notMentioned = await get('/records?mentioned=false');
  const combo = await get('/records?platform=DeepSeek&mentioned=true');

  const expectMulti = source.filter((r) => ['ChatGPT', 'Gemini'].includes(r.platform)).length;
  const expectMentioned = source.filter((r) => r.brand_mentioned).length;
  const expectCombo = source.filter(
    (r) => r.platform === 'DeepSeek' && r.brand_mentioned,
  ).length;

  if (multi.body?.total !== expectMulti) bad('平台多选', `${multi.body?.total}`);
  else if (mentioned.body?.total !== expectMentioned) bad('提及筛选', `${mentioned.body?.total}`);
  else if (notMentioned.body?.total !== 120 - expectMentioned)
    bad('未提及筛选', `${notMentioned.body?.total}`);
  else if (combo.body?.total !== expectCombo) bad('组合筛选', `${combo.body?.total}`);
  else
    ok(
      '筛选组合',
      `平台多选 ${expectMulti} / 提及 ${expectMentioned} / 未提及 ${120 - expectMentioned} / 组合 ${expectCombo}`,
    );
}

// ---- 用例 9：关键词与排序 ----
{
  const kw = await get('/records?keyword=warehouse&page_size=200');
  const expectKw = source.filter((r) => r.question.toLowerCase().includes('warehouse')).length;
  const sorted = await get('/records?sort_by=citations&sort_dir=desc&page_size=5');
  const maxCitations = Math.max(...source.map((r) => r.citation_count));

  if (kw.body?.total !== expectKw) bad('关键词搜索', `${kw.body?.total} \u2260 ${expectKw}`);
  else if (sorted.body?.items?.[0]?.citation_count !== maxCitations)
    bad('按引用数排序', `${sorted.body?.items?.[0]?.citation_count}`);
  else ok('关键词与排序', `关键词命中 ${expectKw} 条、引用数倒序首行 ${maxCitations}`);
}

// ---- 用例 10：详情 ----
{
  const { status, body } = await get('/records/1');
  const src = source.find((r) => r.id === 1);
  if (status !== 200) bad('明细详情', `HTTP ${status}`);
  else if (body.id !== 1) bad('明细详情.id', `${body.id}`);
  else if (body.source_id !== 1) bad('明细详情.source_id', `${body.source_id}`);
  else if (body.citations.length !== src.citations.length)
    bad('明细详情.引用条数', `${body.citations.length}`);
  else if (body.citations[0]?.url !== src.citations[0].url)
    bad('明细详情.引用内容', body.citations[0]?.url);
  else if (JSON.stringify(body.mentioned_products) !== JSON.stringify(src.mentioned_products))
    bad('明细详情.产品', JSON.stringify(body.mentioned_products));
  else
    ok(
      '明细详情',
      `引用 ${body.citations.length} 条、产品 ${body.mentioned_products.length} 个，与源数据一致`,
    );

  const miss = await get('/records/99999');
  if (miss.status === 404) ok('不存在的记录返回 404', miss.body?.message);
  else bad('不存在的记录', `HTTP ${miss.status}`);
}

// ---- 用例 11：参数校验 ----
{
  const cases = [
    ['page=0', '/records?page=0'],
    ['page_size=999', '/records?page_size=999'],
    ['非法情绪值', '/records?sentiment=angry'],
    ['非法排序字段', '/records?sort_by=evil'],
    ['非法意图码', '/records?intent_type=Z'],
    ['非法布尔值', '/records?mentioned=yes'],
  ];
  let badCount = 0;
  for (const [, url] of cases) {
    const { status } = await get(url);
    if (status !== 400) badCount += 1;
  }
  if (badCount === 0) ok('非法参数一律 400', `${cases.length} 个用例`);
  else bad('非法参数校验', `${badCount} 个未拦截`);
}

// ---- 用例 12：meta ----
{
  const { status, body } = await get('/meta');
  const sumPlatforms = body?.platforms?.reduce((s, p) => s + p.record_count, 0);
  if (status !== 200) bad('meta', `HTTP ${status}`);
  else if (body.platforms.length !== 5) bad('meta.平台数', `${body.platforms.length}`);
  else if (body.topics.length !== 8) bad('meta.主题数', `${body.topics.length}`);
  else if (sumPlatforms !== 120) bad('meta.平台记录数合计', `${sumPlatforms}`);
  else if (body.period.from !== '2026-08-01' || body.period.to !== '2026-08-30')
    bad('meta.周期', `${body.period.from}~${body.period.to}`);
  else
    ok(
      'meta 筛选项',
      `5 平台 / 8 主题 / 意图 ${body.intents.length} 个 / 情绪 ${body.sentiments.length} 种`,
    );
}

console.log('\n后端接口对账结果\n');
console.log(lines.join('\n'));
console.log(`\n通过 ${pass} 项，失败 ${fail} 项\n`);
if (fail > 0) process.exit(1);
