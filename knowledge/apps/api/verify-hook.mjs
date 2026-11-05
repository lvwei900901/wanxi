/**
 * webhook 接入层验收脚本。
 *
 * 核心要证明的一件事：Strapi 连打 20 次投递，只应该产生 1 次索引重建。
 * 如果去抖层写错（比如每次投递都调一次 reindex），这里会看到 runs=20、
 * 版本号跳 20 次——那正是生产里把 Strapi 投递超时、索引反复重建的现场。
 *
 * 第二件事同样关键：重建之前必须先把内容从 Strapi 拉下来。
 * 只重建不 ingest 的话，webhook 200、版本号 +1、日志全绿，站点内容一动不动。
 * 所以脚本末尾会起一个 mock Strapi，验证内容真的被搬进了库。
 *
 * 用法：npm run build -w @kb/api && node apps/api/verify-hook.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const require = createRequire(resolve(here, 'package.json'));

process.env.NODE_ENV ??= 'development';
// 缩短去抖窗口，让验收在几秒内跑完；生产默认 4000ms（见 index-hook.service.ts）
process.env.REINDEX_DEBOUNCE_MS ??= '800';
// 上限设得比窗口只大一点，好在几秒内验证「不会被无限推迟」
process.env.REINDEX_MAX_WAIT_MS ??= '1200';
// 验收必须可重复：本机 .env 一旦配了真实的 STRAPI_URL，「未配置时降级」
// 这条用例就永远失败。这里显式置空（dotenv 不覆盖已存在的变量），
// 需要连 Strapi 的用例会在自己那一步把地址临时指过去。
process.env.STRAPI_URL = '';
process.env.STRAPI_TOKEN = '';
// 同一个道理：本机 .env 配了真实的 WEB_REVALIDATE_URL 时，验收会去敲真站点。
// 先清空，需要验证失效链路的用例会自己起 mock 并把地址指过去。
process.env.WEB_REVALIDATE_URL = '';
require('./dist/main.js');

const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasourceUrl: `file:${resolve(repoRoot, 'data', 'knowledge.db')}` });

const BASE = 'http://127.0.0.1:3001/api/v1';
let TOKEN = null;

const results = [];
let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  results.push({ 检查项: name, 结果: ok ? '✓' : '✗', 说明: detail });
  if (ok) pass += 1;
  else fail += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', token = TOKEN, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON，保留原样 */
  }
  return { status: res.status, json, text };
}

async function waitReady() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await call('/health', { token: null });
      if (r.status === 200) return;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('API 未在 30s 内就绪');
}

/** 轮询到「没有待合并条目 + 不在重建中」，返回那一刻的状态 */
async function settle(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await call('/index/hook/status');
    const s = r.json?.data;
    if (s && !s.running && s.pendingEntries === 0 && s.nextRunInMs === null) {
      // 再确认一次，避免刚好落在调度前的一瞬间
      await sleep(300);
      const again = await call('/index/hook/status');
      const t = again.json?.data;
      if (t && !t.running && t.pendingEntries === 0 && t.nextRunInMs === null) return t;
      continue;
    }
    await sleep(250);
  }
  throw new Error('重建未在超时内收敛');
}

const entryPayload = (model, event, id) => ({
  event,
  createdAt: new Date().toISOString(),
  model,
  uid: `api::${model}.${model}`,
  entry: { id, documentId: `doc-${model}-${id}`, slug: `${model}-${id}` },
});

async function main() {
  await waitReady();

  // 到这里 ConfigModule 已经把 .env 读进 process.env 了
  TOKEN = process.env.REINDEX_TOKEN;
  if (!TOKEN) throw new Error('apps/api/.env 缺少 REINDEX_TOKEN，无法验收');

  // 失效链路：mock 一个 web 端点接住通知。不起 mock 的话这一段只会走 skipped，
  // 而「通知根本没发出去」和「发了但没人接」在日志上长得一模一样。
  const web = await startMockWeb();

  const before = (await call('/index')).json?.data;
  const beforeQueue = (await call('/index/hook/status')).json?.data;
  check('新进程启动时没有任何重建记录', beforeQueue?.runs === 0, `runs=${beforeQueue?.runs}`);

  // ---- 鉴权 ----
  const noToken = await call('/index/hook', { method: 'POST', token: null, body: entryPayload('product', 'entry.update', 1) });
  check('无令牌 → 401', noToken.status === 401, `status=${noToken.status}`);

  const wrongToken = await call('/index/hook', { method: 'POST', token: 'wrong-token', body: entryPayload('product', 'entry.update', 1) });
  check('错令牌 → 401', wrongToken.status === 401, `status=${wrongToken.status}`);

  // ---- 白名单 ----
  const unknownModel = await call('/index/hook', { method: 'POST', body: entryPayload('user', 'entry.update', 3) });
  check(
    '未订阅集合 → 202 且 ignored',
    unknownModel.status === 202 && unknownModel.json?.data?.ignored === true,
    `status=${unknownModel.status} why=${unknownModel.json?.data?.why}`,
  );

  const mediaEvent = await call('/index/hook', {
    method: 'POST',
    body: { event: 'media.update', createdAt: new Date().toISOString(), media: { id: 1 } },
  });
  check(
    'media.* → 202 且 ignored（payload 结构不同，不能吃）',
    mediaEvent.status === 202 && mediaEvent.json?.data?.ignored === true,
    `status=${mediaEvent.status} why=${mediaEvent.json?.data?.why}`,
  );

  const deleteEvent = await call('/index/hook', { method: 'POST', body: { event: 'entry.delete', model: 'faq', entry: { id: 12 } } });
  check(
    'entry.delete 只带 id 也能识别',
    deleteEvent.status === 202 && deleteEvent.json?.data?.accepted === true,
    `id=${deleteEvent.json?.data?.entry?.id}`,
  );

  // 这一条会进队列，先让它自己收敛，避免干扰后面的计数断言
  const mid = await settle();
  const versionAfterDelete = (await call('/index')).json?.data?.version;

  // ---- 核心：连打 20 次，只重建一次 ----
  // 并发投递：Strapi 的 webhook runner 对同一批操作是各发各的，不互相等待。
  // 用串行 + sleep 反而比真实情况更慢，会把一批拆成两批。
  const burst = await Promise.all(
    Array.from({ length: 20 }, (_, idx) => {
      const i = idx + 1;
      const event = i % 5 === 0 ? 'entry.publish' : 'entry.update';
      return call('/index/hook', { method: 'POST', body: entryPayload('product', event, i) });
    }),
  );
  check(
    '20 次投递全部 202',
    burst.every((r) => r.status === 202 && r.json?.data?.accepted === true),
    `状态分布=${[...new Set(burst.map((r) => r.status))].join(',')}`,
  );

  const afterBurst = await settle();
  const versionAfterBurst = (await call('/index')).json?.data?.version;

  check('20 次投递只重建 1 次', afterBurst.runs - mid.runs === 1, `runs 增量=${afterBurst.runs - mid.runs}`);
  check('版本号只前进 1', versionAfterBurst - versionAfterDelete === 1, `${versionAfterDelete} → ${versionAfterBurst}`);
  check('投递计数如实累计 20', afterBurst.delivered - mid.delivered === 20, `delivered 增量=${afterBurst.delivered - mid.delivered}`);
  check(
    'reason 能追溯到具体记录',
    typeof afterBurst.lastRun?.reason === 'string' && afterBurst.lastRun.reason.startsWith('strapi: product.'),
    afterBurst.lastRun?.reason,
  );
  check(
    '上一次重建成功且耗时合理',
    afterBurst.lastRun?.ok === true && afterBurst.lastRun.durationMs < 15000,
    `ok=${afterBurst.lastRun?.ok} ${afterBurst.lastRun?.durationMs}ms v${afterBurst.lastRun?.version}`,
  );
  // 没配 Strapi 时降级成「只重建」，但这个降级必须被记录下来，
  // 否则线上漏配 STRAPI_URL 会表现成「一切正常，内容就是不变」
  check(
    '未配置 Strapi 时 ingest 降级为 skipped 且被记录',
    afterBurst.lastRun?.ingest?.status === 'skipped',
    `ingest=${afterBurst.lastRun?.ingest?.status} ${afterBurst.lastRun?.ingest?.message ?? ''}`,
  );

  // 重建完不通知 web，页面就还停在 300s 前的旧 HTML：库新了、页面没新，
  // 这是「后台改了站点不动」的最后一段路。标签、令牌、时机都得对。
  const lastHit = web.hits.at(-1);
  check(
    '重建成功后主动失效 ISR（Bearer + kb 标签）',
    afterBurst.lastRun?.revalidate?.status === 'ok' &&
      lastHit?.tags?.includes('kb') &&
      lastHit?.auth === `Bearer ${web.token}`,
    `revalidate=${afterBurst.lastRun?.revalidate?.status} 命中=${web.hits.length} 次 tags=${(lastHit?.tags ?? []).join(',')}`,
  );

  // ---- 空队列不应空跑 ----
  const afterIdle = await call('/index/hook/status');
  await sleep(1500);
  const afterIdle2 = await call('/index/hook/status');
  check(
    '空闲时不再触发重建',
    afterIdle.json?.data?.runs === afterIdle2.json?.data?.runs,
    `runs ${afterIdle.json?.data?.runs} → ${afterIdle2.json?.data?.runs}`,
  );

  // ---- 持续投递：必须按 maxWait 强制收敛，不能一直等下去 ----
  const slowStart = Date.now();
  // lastRun 只留最后一次，而最后一轮往往是循环结束后由窗口补的，
  // 所以「中途就重建过」只能在循环里当场观测
  let firstSlowRunAt = null;
  for (let i = 0; i < 6; i += 1) {
    await call('/index/hook', { method: 'POST', body: entryPayload('product', 'entry.update', 100 + i) });
    await sleep(400); // 每 400ms 一次，总长 2.4s > maxWait 1200ms
    if (firstSlowRunAt === null) {
      const st = (await call('/index/hook/status')).json?.data;
      if (st && st.runs > afterBurst.runs) firstSlowRunAt = Date.now();
    }
  }
  const slowEnd = Date.now();
  const afterSlow = await settle();
  const slowRuns = afterSlow.runs - afterBurst.runs;
  check(
    '持续投递不会无限推迟（maxWait 生效）',
    slowRuns >= 1 && slowRuns <= 3,
    `2.4s 内投递 6 次 → 重建 ${slowRuns} 次`,
  );
  check(
    '重建发生在投递过程中，而不是等全部结束后才补',
    firstSlowRunAt !== null && firstSlowRunAt - slowStart < slowEnd - slowStart - 700,
    firstSlowRunAt === null
      ? '整批投递期间一次都没重建'
      : `首次重建在投递开始后 ${firstSlowRunAt - slowStart}ms（整批耗时 ${slowEnd - slowStart}ms）`,
  );

  // ---- 回归：手动 reindex 仍可用 ----
  const manual = await call('/index/reindex', { method: 'POST', body: { dryRun: true, reason: 'verify-hook' } });
  check(
    '手动 reindex 未被破坏（dryRun）',
    (manual.status === 201 || manual.status === 200) && manual.json?.data?.total > 0,
    `status=${manual.status} total=${manual.json?.data?.total}`,
  );
  check('dryRun 不做失效（没新内容可失效）', manual.json?.data?.revalidate === null, `revalidate=${JSON.stringify(manual.json?.data?.revalidate)}`);

  // ---- web 不可达时，不能把一次已经成功的事务变成失败 ----
  // 索引版本已经切好了，这时候把 HTTP 报错往上传，调用方会以为重建失败并重试，
  // 实际上内容早就生效了。通知只该记录，不该传播。
  const workingUrl = process.env.WEB_REVALIDATE_URL;
  process.env.WEB_REVALIDATE_URL = 'http://127.0.0.1:9/api/revalidate'; // 本机无人监听
  const orphan = await call('/index/reindex', { method: 'POST', body: { reason: 'verify-hook: web 不可达' } });
  process.env.WEB_REVALIDATE_URL = workingUrl;
  check(
    'web 不可达时重建照样成功，失效记为 failed',
    (orphan.status === 200 || orphan.status === 201) &&
      typeof orphan.json?.data?.version === 'number' &&
      orphan.json?.data?.revalidate?.status === 'failed',
    `status=${orphan.status} v=${orphan.json?.data?.version} revalidate=${orphan.json?.data?.revalidate?.status}`,
  );

  // ---- 核心二：webhook 触发的内容真的被搬进库了 ----
  // 前面的用例都没配 Strapi，只能证明「排队 + 重建」是对的。这一段接一个 mock，
  // 证明 webhook → ingest → reindex 是完整链路，而不是重建了一遍旧内容。
  const payload = await startMockStrapi();
  let versionBeforeIngest = null;
  let afterIngest = null;
  let afterFailure = null;
  let versionAfterFailure = null;
  let renamed = null;
  try {
    versionBeforeIngest = (await call('/index')).json?.data?.version;
    await call('/index/hook', { method: 'POST', body: entryPayload('product', 'entry.update', 1) });
    afterIngest = await settle();
    renamed = await db.product.findUnique({
      where: { slug: payload.productSlug },
      select: { name: true, overview: true },
    });
    const versionNow = (await call('/index')).json?.data?.version;

    check(
      '配了 Strapi 时 webhook 会先 ingest 再重建',
      afterIngest.lastRun?.ingest?.status === 'synced',
      `ingest=${afterIngest.lastRun?.ingest?.status} +${afterIngest.lastRun?.ingest?.created}/~${afterIngest.lastRun?.ingest?.updated}`,
    );
    check(
      'Strapi 改过的名字真的落到了库里',
      renamed?.name === payload.stamp,
      `库里 name=${renamed?.name}`,
    );
    check(
      'ingest 有实际写入（不是拉了个空）',
      (afterIngest.lastRun?.ingest?.created ?? 0) + (afterIngest.lastRun?.ingest?.updated ?? 0) > 0,
      `created=${afterIngest.lastRun?.ingest?.created} updated=${afterIngest.lastRun?.ingest?.updated}`,
    );
    check('这是同一批投递里的唯一一次重建', versionNow - versionBeforeIngest === 1, `${versionBeforeIngest} → ${versionNow}`);

    // Strapi 不可用时不能再往前推版本号：重建只会把旧内容重新打包一遍，
    // 版本 +1、日志全绿、内容没变，是最难发现的故障
    payload.failing = true;
    versionAfterFailure = versionNow;
    await call('/index/hook', { method: 'POST', body: entryPayload('product', 'entry.update', 2) });
    afterFailure = await settle();
    const versionAfterFail = (await call('/index')).json?.data?.version;

    check(
      'Strapi 拉取失败时跳过重建',
      afterFailure.lastRun?.ok === false && afterFailure.lastRun?.ingest?.status === 'failed',
      `ok=${afterFailure.lastRun?.ok} ingest=${afterFailure.lastRun?.ingest?.status}`,
    );
    check(
      '拉取失败不会白造一个索引版本',
      versionAfterFail === versionAfterFailure,
      `${versionAfterFailure} → ${versionAfterFail}`,
    );
    check(
      '失败原因写进了 lastError',
      typeof afterFailure.lastError === 'string' && afterFailure.lastError.includes('Strapi'),
      afterFailure.lastError,
    );
  } finally {
    await payload.close();
    // 把被 mock 改掉的名字还原，别让验收污染开发库
    if (payload.productSlug) {
      await db.product
        .update({ where: { slug: payload.productSlug }, data: { name: payload.originalName } })
        .catch(() => {});
    }
  }

  console.log('');
  console.table(results);
  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? `　失败 ${fail}` : ''}`);
  console.log(`索引版本：${before?.version} → ${versionAfterBurst}（全程 ${afterBurst.runs - beforeQueue.runs} 次重建）`);
  console.log(`ISR 失效：mock web 收到 ${web.hits.length} 次通知`);
  // Nest 还在监听，不显式退出的话脚本会一直挂着，直到外层超时把它 SIGKILL
  process.exit(fail ? 1 : 0);
}

/**
 * 起一个只读的 mock Strapi（v5 扁平形状）并把 STRAPI_URL 指过去。
 *
 * 故意让第一个产品的名字和库里不一样：只有 ingest 真的执行了，库里才会变。
 * FAQ 故意返回空数组——merge 模式下「远端没内容」必须等于「不改本地」。
 */
async function startMockStrapi() {
  const read = (name) => JSON.parse(readFileSync(resolve(repoRoot, 'data', 'source', name), 'utf8'));
  const brand = read('brand.json');
  const series = read('product_series.json');
  const scenarios = read('scenarios.json');
  const products = read('products.json');
  const ISO = '2026-01-01T00:00:00.000Z';
  const stamp = `${products[0].name} · edited in Strapi`;
  const slugByName = new Map(scenarios.map((s) => [s.name, s.slug]));
  const slugOf = (name) => slugByName.get(name) ?? name.toLowerCase().replace(/\s+/g, '-');

  const payloads = {
    '/api/brand': {
      data: [
        {
          slug: brand.slug,
          name: brand.name,
          description: brand.description,
          website: brand.website,
          foundedYear: Number.parseInt(brand.founded, 10) || null,
          headquarters: brand.headquarters,
          coreCapabilities: brand.core_capabilities,
        },
      ],
    },
    '/api/product-series': { data: series.map((s, i) => ({ id: i + 1, ...s, sortOrder: i, publishedAt: ISO })) },
    '/api/scenario': { data: scenarios.map((s, i) => ({ id: i + 1, ...s, isCanonical: true, sortOrder: i })) },
    '/api/product': {
      data: products.map((p, i) => ({
        id: i + 1,
        slug: p.slug,
        name: i === 0 ? stamp : p.name,
        shortDescription: p.short_description,
        overview: p.overview,
        specs: p.specs,
        keyFeatures: p.key_features,
        status: p.status ?? 'active',
        sortOrder: i,
        publishedAt: ISO,
        series: { slug: p.series_slug },
        scenarios: (p.best_for ?? []).map((n) => ({ slug: slugOf(n) })),
      })),
    },
    '/api/faq': { data: [] },
  };

  const state = {
    failing: false,
    productSlug: products[0].slug,
    originalName: products[0].name,
    stamp,
    close: null,
  };

  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (state.failing) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'mock strapi down' }));
      return;
    }
    const body = payloads[path];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { error: 'not found', path }));
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.STRAPI_URL = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((r) => server.close(r));
  return state;
}

/**
 * 起一个 mock web 失效端点，把 WEB_REVALIDATE_URL 指过去。
 *
 * 它记录每次请求的路径、Authorization 和 tags——这三样正是失效能否生效的全部条件：
 * 地址错 → 打不到；令牌错 → 401 且页面照旧；标签错 → 页面匹配不上，等于没发。
 */
async function startMockWeb() {
  const token = 'verify-web-token';
  const state = { hits: [], token, close: null };

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        /* 非法 JSON 也照收，靠断言去暴露 */
      }
      state.hits.push({
        path: req.url,
        method: req.method,
        auth: req.headers.authorization ?? '',
        tags: Array.isArray(body?.tags) ? body.tags : [],
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tags: body?.tags ?? [] }));
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.WEB_REVALIDATE_URL = `http://127.0.0.1:${server.address().port}/api/revalidate`;
  process.env.WEB_REVALIDATE_TOKEN = token;
  state.close = () => new Promise((r) => server.close(r));
  return state;
}

main().catch((err) => {
  console.error('验收脚本异常：', err);
  process.exit(1);
});
