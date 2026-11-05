/**
 * 接口验收脚本：在同一个 node 进程里启动 Nest 应用，然后自测各端点。
 *
 * 为什么不 shell 起后台进程：本机的 shell 沙箱对「脱离进程组的长驻子进程」
 * 支持不稳定（起得来但收不到监听/日志），同进程内验证最可靠。
 *
 * 用法：npm run build -w @kb/api && node apps/api/verify-api.mjs
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, 'package.json'));

process.env.NODE_ENV ??= 'development';
require('./dist/main.js');

const BASE = 'http://127.0.0.1:3001/api/v1';
const results = [];
let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  results.push({ 检查项: name, 结果: ok ? '✓' : '✗', 说明: detail });
  if (ok) pass += 1;
  else fail += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应，保留 text */
  }
  return { status: res.status, json, text };
}

async function waitReady() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  return false;
}

const ready = await waitReady();
if (!ready) {
  console.error('✗ 服务在 30s 内未就绪');
  process.exit(1);
}

// 1. 健康检查
const health = await get('/health');
check(
  '健康检查',
  health.json?.data?.db === 'ok' && health.json?.data?.index?.chunks === 94,
  `db=${health.json?.data?.db} · 索引 v${health.json?.data?.index?.version} · ${health.json?.data?.index?.chunks} 块 · GLM ${health.json?.data?.glm?.configured ? '已配置' : '未配置'}`,
);

// 2. 产品列表默认口径
const list = await get('/products');
const statusCount = (list.json?.data ?? []).reduce((a, p) => {
  a[p.status] = (a[p.status] || 0) + 1;
  return a;
}, {});
check('产品列表（默认）', list.json?.meta?.total === 20, `total=${list.json?.meta?.total} · ${JSON.stringify(statusCount)}`);

// 3. 仅 active
const onlyActive = await get('/products?includeBeta=false');
check('产品列表（仅 active）', onlyActive.json?.meta?.total === 17, `total=${onlyActive.json?.meta?.total}`);

// 4. 系列筛选与系列计数一致
const series = await get('/series');
const counts = Object.fromEntries((series.json?.data ?? []).map((s) => [s.slug, s.productCount]));
let consistent = true;
const detail = [];
for (const [slug, count] of Object.entries(counts)) {
  const filtered = await get(`/products?series=${slug}`);
  const got = filtered.json?.meta?.total;
  detail.push(`${slug} ${got}/${count}`);
  if (got !== count) consistent = false;
}
check('系列计数 == 筛选结果', consistent, detail.join(' · '));

// 5. 关键词搜索
const search = await get('/products?q=thermal');
check('关键词搜索 thermal', (search.json?.meta?.total ?? 0) > 0, `命中 ${search.json?.meta?.total} 个：${(search.json?.data ?? []).map((p) => p.slug).join(', ')}`);

// 6. 场景筛选
const scenario = await get('/products?scenario=warehouse');
check('场景筛选 warehouse', (scenario.json?.meta?.total ?? 0) > 0, `命中 ${scenario.json?.meta?.total} 个`);

// 7. 产品详情完整性
const detailRes = await get('/products/nova-x4');
const d = detailRes.json?.data;
check(
  '产品详情字段完整',
  Boolean(d?.overview) && d?.keyFeatures?.length === 4 && d?.faqs?.length === 2 && d?.scenarios?.length === 3,
  `overview ${d?.overview ? '有' : '无'} · keyFeatures ${d?.keyFeatures?.length} · aiFeatures ${d?.aiFeatures?.length} · faqs ${d?.faqs?.length} · scenarios ${d?.scenarios?.length} · 规格 ${d?.resolution}/${d?.connectivity}/${d?.environment}`,
);

// 8. 404 语义
const notFound = await get('/products/does-not-exist');
check('不存在的产品返回 404', notFound.status === 404, `HTTP ${notFound.status}`);

// 9. FAQ
const faqs = await get('/faqs?scope=product');
check('FAQ 列表', faqs.json?.meta?.total === 40, `total=${faqs.json?.meta?.total}`);

// 10. sitemap 覆盖 20 个产品
const sitemap = await get('/sitemap');
const productEntries = (sitemap.json?.data ?? []).filter((e) => e.path.startsWith('/products/'));
check('sitemap 覆盖度', productEntries.length === 20, `${sitemap.json?.data?.length} 条，其中产品详情 ${productEntries.length} 条`);

// 11. 重建接口鉴权
const reindexNoAuth = await fetch(`${BASE}/index/reindex`, { method: 'POST', signal: AbortSignal.timeout(15000) });
check('重建接口无令牌被拒', reindexNoAuth.status === 401, `HTTP ${reindexNoAuth.status}`);

console.table(results);
console.log(fail === 0 ? `\n✓ 全部通过（${pass}/${pass + fail}）` : `\n✗ ${fail} 项未通过（通过 ${pass}/${pass + fail}）`);
process.exit(fail === 0 ? 0 : 1);
