/**
 * Strapi ingest 验收脚本。
 *
 * 起一个 mock Strapi（故意用 v4 的 attributes + {data:...} 包装），验证：
 *  1. 两种响应形状都能压平——v4/v5 换版本不会解析成全空；
 *  2. 草稿（publishedAt=null）不会漏进线上；
 *  3. dryRun 真的不写库；
 *  4. 重复同步是幂等的（第二次 created 全为 0）；
 *  5. 关联（系列 / 场景）正确落地。
 *
 * 用法：npm run build -w @kb/api && node apps/api/verify-sync.mjs
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const require = createRequire(resolve(here, 'package.json'));

const results = [];
let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  results.push({ 检查项: name, 结果: ok ? '✓' : '✗', 说明: String(detail ?? '') });
  if (ok) pass += 1;
  else fail += 1;
};

const readJson = (name) => JSON.parse(readFileSync(resolve(repoRoot, 'data', 'source', name), 'utf8'));
const ISO = '2026-01-01T00:00:00.000Z';

// ---------------------------------------------------------------- fixture
const brandSrc = readJson('brand.json');
const seriesSrc = readJson('product_series.json');
const scenarioSrc = readJson('scenarios.json');
const productSrc = readJson('products.json');
const faqSrc = readJson('faqs.json');

const scenarioSlugByName = new Map(scenarioSrc.map((s) => [s.name, s.slug]));
const attr = (obj) => ({ attributes: obj });

/** 故意用 v4 形状：{ id, attributes: {...} }，关联再包一层 { data: ... } */
const brandPayload = {
  data: {
    id: 1,
    ...attr({
      slug: brandSrc.slug,
      name: brandSrc.name,
      description: brandSrc.description,
      website: brandSrc.website,
      founded: brandSrc.founded,
      headquarters: brandSrc.headquarters,
      core_capabilities: brandSrc.core_capabilities,
    }),
  },
};

const seriesPayload = {
  data: seriesSrc.map((s, i) => ({
    id: i + 1,
    ...attr({ ...s, sortOrder: i, publishedAt: ISO }),
  })),
};

const scenarioPayload = {
  data: scenarioSrc.map((s, i) => ({
    id: s.id ?? i + 1,
    ...attr({ ...s, isCanonical: true, sortOrder: i }),
  })),
};

const PROBE_SLUG = 'sync-probe-product';
const DRAFT_SLUG = 'sync-probe-draft';

const productPayload = {
  data: [
    ...productSrc.map((p, i) => ({
      id: p.id ?? i + 1,
      ...attr({
        slug: p.slug,
        name: p.name,
        short_description: p.short_description,
        overview: p.overview,
        specs: p.specs,
        keyFeatures: p.key_features,
        // Strapi 5 不允许自定义 status 属性（Draft & Publish 保留名），真机用 lifecycleStatus
        lifecycleStatus: p.status ?? 'active',
        sortOrder: i,
        publishedAt: ISO,
        series: { data: { id: 1, ...attr({ slug: p.series_slug }) } },
        scenarios: {
          data: (p.best_for ?? []).map((name) => ({
            id: 1,
            ...attr({ slug: scenarioSlugByName.get(name) ?? name.toLowerCase().replace(/\s+/g, '-') }),
          })),
        },
      }),
    })),
    // 已发布的探针：dryRun 后不应存在，真实同步后应存在
    {
      id: 9001,
      ...attr({
        slug: PROBE_SLUG,
        name: 'Sync Probe',
        overview: 'Temporary record used by verify-sync.mjs.',
        specs: { resolution: '4K', connectivity: 'PoE', environment: 'Indoor' },
        keyFeatures: ['Probe feature'],
        lifecycleStatus: 'active',
        publishedAt: ISO,
        series: { data: { id: 1, ...attr({ slug: 'nova' }) } },
        scenarios: { data: [{ id: 1, ...attr({ slug: 'warehouse' }) }] },
      }),
    },
    // 草稿：任何情况下都不该进库
    {
      id: 9002,
      ...attr({
        slug: DRAFT_SLUG,
        name: 'Draft Probe',
        overview: 'Should never be imported.',
        lifecycleStatus: 'active',
        publishedAt: null,
        series: { data: { id: 1, ...attr({ slug: 'nova' }) } },
        scenarios: { data: [] },
      }),
    },
  ],
};

const faqPayload = {
  data: faqSrc.map((f) => ({
    id: f.id,
    ...attr({
      legacyId: f.id,
      question: f.question,
      answer: f.answer,
      publishedAt: ISO,
      product: f.product_slug ? { data: { id: 1, ...attr({ slug: f.product_slug }) } } : null,
    }),
  })),
};

const ROUTES = {
  '/api/brand': brandPayload,
  '/api/product-series': seriesPayload,
  '/api/scenario': scenarioPayload,
  '/api/product': productPayload,
  '/api/faq': faqPayload,
};

/** 用例之间会切换这组路由，模拟「远端只有一部分内容」 */
let routes = ROUTES;

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const body = routes[path];
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body ?? { error: 'not found', path }));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const strapiPort = server.address().port;
process.env.STRAPI_URL = `http://127.0.0.1:${strapiPort}`;
process.env.NODE_ENV ??= 'development';

require('./dist/main.js');

const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasourceUrl: `file:${resolve(repoRoot, 'data', 'knowledge.db')}` });

const BASE = 'http://127.0.0.1:3001/api/v1';
let TOKEN = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  const bearer = token === undefined ? TOKEN : token;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 保留 text */
  }
  return { status: res.status, json, text };
}

async function waitReady() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await call('/health', { token: null });
      if (r.status === 200) return;
    } catch {
      /* 未就绪 */
    }
    await sleep(250);
  }
  throw new Error('API 未在 30s 内就绪');
}

const table = (report, collection) => report?.tables?.find((t) => t.collection === collection);

async function main() {
  await waitReady();
  TOKEN = process.env.REINDEX_TOKEN;
  if (!TOKEN) throw new Error('apps/api/.env 缺少 REINDEX_TOKEN');

  // 先清掉上一次运行留下的探针
  await cleanup();

  // ---- 缺配置 ----
  const savedUrl = process.env.STRAPI_URL;
  process.env.STRAPI_URL = '';
  const noConfig = await call('/sync/strapi', { method: 'POST', body: {} });
  process.env.STRAPI_URL = savedUrl;
  check('未配置 STRAPI_URL → 503', noConfig.status === 503, `status=${noConfig.status}`);

  // ---- 鉴权 ----
  const noToken = await call('/sync/strapi', { method: 'POST', token: null, body: {} });
  check('无令牌 → 401', noToken.status === 401, `status=${noToken.status}`);

  // ---- dryRun ----
  const dry = await call('/sync/strapi', { method: 'POST', body: { dryRun: true } });
  const dryReport = dry.json?.data;
  check('dryRun 返回报告', dry.status === 201 && dryReport?.dryRun === true, `status=${dry.status}`);
  check(
    'v4 attributes 包装能被压平（产品条数对得上）',
    table(dryReport, 'product')?.fetched === productPayload.data.length,
    `fetched=${table(dryReport, 'product')?.fetched} 期望=${productPayload.data.length}`,
  );
  check(
    'dryRun 不触发索引重建',
    dryReport?.reindexed === null || dryReport?.reindexed === undefined,
    `reindexed=${dryReport?.reindexed}`,
  );
  const probeAfterDry = await db.product.findUnique({ where: { slug: PROBE_SLUG }, select: { id: true } });
  check('dryRun 没有写库（探针产品仍不存在）', probeAfterDry === null, `found=${!!probeAfterDry}`);

  // ---- 真实同步 ----
  const real = await call('/sync/strapi', { method: 'POST', body: { rebuild: false } });
  const report = real.json?.data;
  check('真实同步成功', real.status === 201 && report?.dryRun === false, `status=${real.status}`);
  check(
    '新产品被创建',
    table(report, 'product')?.created === 1,
    `created=${table(report, 'product')?.created} updated=${table(report, 'product')?.updated}`,
  );

  const probe = await db.product.findUnique({
    where: { slug: PROBE_SLUG },
    select: { id: true, resolution: true, connectivity: true, environment: true, series: { select: { slug: true } } },
  });
  check('探针产品已入库且规格正确', probe?.resolution === '4K' && probe?.connectivity === 'PoE', JSON.stringify(probe?.resolution));
  check('系列关联落地', probe?.series?.slug === 'nova', `series=${probe?.series?.slug}`);

  const probeScenarios = probe ? await db.productScenario.count({ where: { productId: probe.id } }) : -1;
  check('场景关联落地', probeScenarios === 1, `scenarios=${probeScenarios}`);

  const draft = await db.product.findUnique({ where: { slug: DRAFT_SLUG }, select: { id: true } });
  check('草稿（publishedAt=null）没有入库', draft === null, `found=${!!draft}`);
  check(
    '草稿被计入 skipped 并给出提示',
    (table(report, 'product')?.skipped ?? 0) >= 1,
    `skipped=${table(report, 'product')?.skipped}`,
  );

  check(
    '远端已删除的条目只报告不删除',
    Array.isArray(report?.missingInStrapi?.scenarios) && report.missingInStrapi.scenarios.length > 0,
    `scenarios=${report?.missingInStrapi?.scenarios?.slice(0, 3).join(',')}`,
  );

  // ---- 幂等 ----
  const again = await call('/sync/strapi', { method: 'POST', body: { rebuild: false } });
  const againReport = again.json?.data;
  const createdTotal = againReport.tables.reduce((sum, t) => sum + t.created, 0);
  check('重复同步幂等（created 全为 0）', createdTotal === 0, `created 合计=${createdTotal}`);
  check(
    '重复同步仍更新已有记录',
    table(againReport, 'product')?.updated === productPayload.data.length - 1,
    `updated=${table(againReport, 'product')?.updated}`,
  );

  // ---- 库完整性 ----
  // 先清掉探针再统计，否则它自己的 1 条场景 + 1 条特性会让计数恒多 1
  await cleanup();
  const counts = {
    product: await db.product.count(),
    series: await db.productSeries.count(),
    scenario: await db.scenario.count(),
    faq: await db.faq.count(),
    productScenario: await db.productScenario.count(),
    productFeature: await db.productFeature.count(),
  };
  check(
    '同步后各表数量没有被破坏',
    counts.series === 5 && counts.scenario === 16 && counts.faq === 40,
    JSON.stringify({ series: counts.series, scenario: counts.scenario, faq: counts.faq }),
  );
  // 这一条是血泪：只认本次拉取的关联会让 best_for 派生场景整批消失，
  // 只同步 key_features 会让「支持哪些 AI 能力」整块丢失
  check(
    '关联关系没有在重建中被写丢',
    counts.productScenario === 64 && counts.productFeature === 140,
    `场景关联 ${counts.productScenario}/64 · 特性关联 ${counts.productFeature}/140`,
  );

  // ================= 写入模式与护栏 =================
  // 上面的用例都是「远端有全套内容」，所以整字段覆盖看不出毛病。
  // 真实的接入顺序恰好相反：Strapi 里先建 3 个产品就挂上 webhook。
  // 这一段专门验证「远端只有半条数据」时本地不会被写残。

  const empty = { data: [] };
  const blank = {
    '/api/brand': empty,
    '/api/product-series': empty,
    '/api/scenario': empty,
    '/api/product': empty,
    '/api/faq': empty,
  };

  // ---- A. brand 缺失时，dryRun 的计数口径必须和实跑一致 ----
  // 修之前 dryRun 会把 5 个系列全算成「将创建」，实跑却全部 skipped：
  // 预演报告说「一切正常」，跑完什么也没发生。
  routes = { ...blank, '/api/product-series': seriesPayload };
  const orphanDry = await call('/sync/strapi', { method: 'POST', body: { dryRun: true } });
  const orphanDrySeries = table(orphanDry.json?.data, 'product-series');
  const orphanReal = await call('/sync/strapi', { method: 'POST', body: { rebuild: false } });
  const orphanRealSeries = table(orphanReal.json?.data, 'product-series');
  check(
    'brand 缺失时 dryRun 与实跑计数口径一致',
    orphanDrySeries?.created === 0 && orphanDrySeries?.skipped === 5 && orphanRealSeries?.skipped === 5,
    `dryRun +${orphanDrySeries?.created}/skip${orphanDrySeries?.skipped} · 实跑 +${orphanRealSeries?.created}/skip${orphanRealSeries?.skipped}`,
  );

  // ---- B. merge：远端只给一个字段，其余不许动 ----
  const target = productSrc.find((p) => p.slug === 'nova-x4');
  const beforeProduct = await db.product.findUnique({
    where: { slug: target.slug },
    select: { name: true, overview: true, shortDescription: true },
  });
  const beforeScenarioLinks = await db.productScenario.count({ where: { product: { slug: target.slug } } });
  const beforeFeatureLinks = await db.productFeature.count({ where: { product: { slug: target.slug } } });

  const STUB_NAME = 'Nova X4 · stub from strapi';
  routes = {
    ...blank,
    '/api/brand': brandPayload,
    '/api/product-series': seriesPayload,
    '/api/scenario': scenarioPayload,
    // 只给 name 和 series：overview / keyFeatures / scenarios 一概没给
    '/api/product': {
      data: [
        {
          id: target.id,
          ...attr({
            slug: target.slug,
            name: STUB_NAME,
            lifecycleStatus: 'active',
            publishedAt: ISO,
            series: { data: { id: 1, ...attr({ slug: target.series_slug }) } },
          }),
        },
      ],
    },
  };

  const mergeRun = await call('/sync/strapi', { method: 'POST', body: { rebuild: false } });
  const afterMerge = await db.product.findUnique({
    where: { slug: target.slug },
    select: { name: true, overview: true, shortDescription: true },
  });
  const mergeScenarioLinks = await db.productScenario.count({ where: { product: { slug: target.slug } } });
  const mergeFeatureLinks = await db.productFeature.count({ where: { product: { slug: target.slug } } });

  check('merge 报告里标注了模式', mergeRun.json?.data?.mode === 'merge', `mode=${mergeRun.json?.data?.mode}`);
  check('merge：远端给出的字段照常写入', afterMerge?.name === STUB_NAME, `name=${afterMerge?.name}`);
  check(
    'merge：远端没给的 overview 不被清空',
    afterMerge?.overview === beforeProduct.overview,
    `overview ${afterMerge?.overview === null ? '被清空' : '保留'}`,
  );
  check(
    'merge：远端没给的 shortDescription 不被清空',
    afterMerge?.shortDescription === beforeProduct.shortDescription,
    `短描述${afterMerge?.shortDescription ? '保留' : '被清空'}`,
  );
  check(
    'merge：远端没给 scenarios 时本地场景关联保留',
    mergeScenarioLinks === beforeScenarioLinks,
    `${beforeScenarioLinks} → ${mergeScenarioLinks}`,
  );
  check(
    'merge：远端没给 features 时本地特性关联保留',
    mergeFeatureLinks === beforeFeatureLinks,
    `${beforeFeatureLinks} → ${mergeFeatureLinks}`,
  );

  // ---- C. mirror：同一份残缺数据，Strapi 说了算 ----
  const mirrorRun = await call('/sync/strapi', { method: 'POST', body: { rebuild: false, mode: 'mirror' } });
  const afterMirror = await db.product.findUnique({ where: { slug: target.slug }, select: { overview: true } });
  const mirrorScenarioLinks = await db.productScenario.count({ where: { product: { slug: target.slug } } });
  check('mirror 报告里标注了模式', mirrorRun.json?.data?.mode === 'mirror', `mode=${mirrorRun.json?.data?.mode}`);
  check('mirror：远端没给的 overview 被清空', afterMirror?.overview === null, `overview=${afterMirror?.overview}`);
  check('mirror：关联整组重建，没给即清空', mirrorScenarioLinks === 0, `scenarios=${mirrorScenarioLinks}`);

  // ---- D. prune 的护栏：远端全空时绝不能把本地库清干净 ----
  routes = blank;
  const guardRun = await call('/sync/strapi', { method: 'POST', body: { rebuild: false, dryRun: true, prune: true } });
  const guardReport = guardRun.json?.data;
  const productsLeft = await db.product.count();
  check(
    'prune：远端返回 0 条时拒绝清库',
    guardReport?.pruned?.products === 0 && guardReport?.pruned?.series === 0 && guardReport?.pruned?.scenarios === 0,
    JSON.stringify(guardReport?.pruned),
  );
  check(
    'prune：跳过原因写进 warnings',
    (guardReport?.warnings ?? []).filter((w) => w.includes('prune')).length >= 3,
    `${(guardReport?.warnings ?? []).filter((w) => w.includes('prune')).length} 条`,
  );
  check('prune 被拦下后产品一条没少', productsLeft === 20, `count=${productsLeft}`);

  // ---- E. FAQ 的 legacyId 撞号：不能拿别人的问答覆盖本地 ----
  const localFaq = await db.faq.findFirst({ where: { legacyId: 1 }, select: { question: true } });
  routes = {
    ...blank,
    '/api/brand': brandPayload,
    '/api/product-series': seriesPayload,
    '/api/scenario': scenarioPayload,
    '/api/faq': {
      data: [
        {
          id: 1,
          ...attr({
            legacyId: 1,
            question: '这是另一个站点的完全无关问题',
            answer: '来自 Strapi 的答案',
            publishedAt: ISO,
          }),
        },
      ],
    },
  };
  const clashRun = await call('/sync/strapi', { method: 'POST', body: { rebuild: false } });
  const clashFaq = await db.faq.findFirst({ where: { legacyId: 1 }, select: { question: true } });
  check(
    'FAQ 撞号不覆盖本地内容',
    clashFaq?.question === localFaq?.question,
    `question=${String(clashFaq?.question).slice(0, 22)}…`,
  );
  check(
    'FAQ 撞号写进 warnings',
    (clashRun.json?.data?.warnings ?? []).some((w) => w.includes('撞号')),
    (clashRun.json?.data?.warnings ?? []).find((w) => w.includes('撞号')) ?? '无',
  );
  check('FAQ 撞号计入 skipped', table(clashRun.json?.data, 'faq')?.skipped === 1, `skipped=${table(clashRun.json?.data, 'faq')?.skipped}`);

  // ---- 收尾：用完整数据 + mirror 把库恢复到验收前的状态 ----
  routes = ROUTES;
  await call('/sync/strapi', { method: 'POST', body: { rebuild: false, mode: 'mirror' } });
  await cleanup();
  const restored = await db.product.findUnique({ where: { slug: target.slug }, select: { name: true, overview: true } });
  const restoredLinks = { scenarios: await db.productScenario.count(), features: await db.productFeature.count() };
  check(
    '收尾恢复到验收前状态',
    restored?.name === beforeProduct.name &&
      restored?.overview === beforeProduct.overview &&
      restoredLinks.scenarios === 64 &&
      restoredLinks.features === 140,
    `name=${restored?.name} 场景关联=${restoredLinks.scenarios} 特性关联=${restoredLinks.features}`,
  );

  // ---- F. 真机 Strapi 的端点是复数，只认单数会在上线第一步就 404 ----
  routes = {
    '/api/brands': brandPayload,
    '/api/product-series': seriesPayload,
    '/api/scenarios': scenarioPayload,
    '/api/products': productPayload,
    '/api/faqs': faqPayload,
  };
  const pluralDry = await call('/sync/strapi', { method: 'POST', body: { dryRun: true } });
  const pluralProduct = table(pluralDry.json?.data, 'product');
  check(
    '单数 404 时自动回退复数端点',
    pluralDry.status === 201 && pluralProduct?.fetched === productPayload.data.length,
    `status=${pluralDry.status} fetched=${pluralProduct?.fetched} 期望=${productPayload.data.length}`,
  );

  routes = {
    '/api/brand': brandPayload,
    '/api/product-series': seriesPayload,
    '/api/scenario': scenarioPayload,
    '/api/product': productPayload,
    '/api/faq': faqPayload,
    '/api/products': productPayload,
  };
  const backToSingular = await call('/sync/strapi', { method: 'POST', body: { dryRun: true } });
  check(
    '端点改名后能自愈（缓存不是死守）',
    table(backToSingular.json?.data, 'product')?.fetched === productPayload.data.length,
    `fetched=${table(backToSingular.json?.data, 'product')?.fetched}`,
  );

  console.table(results);
  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? `　失败 ${fail}` : ''}`);
  console.log(`Strapi mock: ${process.env.STRAPI_URL}`);
  console.log(`同步耗时：dryRun ${dryReport?.durationMs}ms · 实跑 ${report?.durationMs}ms`);
  return fail;
}

/** 删掉探针产品及其关联，避免污染后续验收 */
async function cleanup() {
  const row = await db.product.findUnique({ where: { slug: PROBE_SLUG }, select: { id: true } });
  if (!row) return;
  await db.productScenario.deleteMany({ where: { productId: row.id } });
  await db.productFeature.deleteMany({ where: { productId: row.id } });
  await db.product.delete({ where: { id: row.id } });
  // 探针带来的孤儿特性也要收掉，否则 feature 表会一条条攒下去
  await db.feature.deleteMany({ where: { slug: 'probe-feature', products: { none: {} } } });
}

try {
  const failed = await main();
  await db.$disconnect();
  server.close();
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error('验收脚本异常：', err);
  await db.$disconnect().catch(() => {});
  server.close();
  process.exit(1);
}
