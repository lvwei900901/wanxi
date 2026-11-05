/**
 * 种子包导入脚本的验收。
 *
 * 每一步都要能验证，否则「把本地数据搬进 Strapi」就会变成手工点一百次后台。
 *
 * 这里起一个 mock Strapi，只暴露**复数**端点（真机就是这样：product → products），
 * 然后真跑一遍 data/strapi-seed/import.mjs，检查：
 *  1. 82 条全部创建成功，没有一条因为字段名对不上而 400；
 *  2. 关联是按 documentId 连的，不是把 slug 字符串塞进关系字段；
 *  3. 第二次跑变成全量更新（幂等），不会重复创建一份；
 *  4. 单数 404 时能自动回退到复数。
 *
 * 用法：npm run kb:export-strapi && node packages/db/verify-seed-import.mjs
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const seedDir = resolve(repoRoot, 'data', 'strapi-seed');
const run = promisify(execFile);

const results = [];
let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  results.push({ 检查项: name, 结果: ok ? '✓' : '✗', 说明: String(detail ?? '') });
  if (ok) pass += 1;
  else fail += 1;
};

if (!existsSync(resolve(seedDir, 'import.mjs'))) {
  console.error('没有种子包，先跑：npm run kb:export-strapi');
  process.exit(2);
}

// ---------------------------------------------------------------- mock strapi
/** 'products' → Map(slug → record)；只认复数，逼出导入脚本的回退逻辑 */
const buckets = new Map();
let counter = 0;
const writes = { post: 0, put: 0 };
const rejects = [];
/** 记录每次写入是怎么表达「已发布」的：v5 只能靠 ?status=published */
const publishChecks = [];

const bucketOf = (name) => {
  if (!buckets.has(name)) buckets.set(name, new Map());
  return buckets.get(name);
};

const readBody = (req) =>
  new Promise((done) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        done({});
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const segments = url.pathname.replace(/^\/api\//, '').split('/');
  const name = segments[0];
  const documentId = segments[1];
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // brand 故意做成 Single Type：端点走单数 /api/brand，data 是对象而不是数组，
  // 写入用无 id 的 PUT。这跟 Collection Type 是两套路径，必须分开验证。
  if (name === 'brand') {
    const bucket = bucketOf('brands');
    if (req.method === 'GET') {
      return send(200, { data: [...bucket.values()][0] ?? null });
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      publishChecks.push({ method: 'PUT', status: url.searchParams.get('status'), hasPublishedAt: 'publishedAt' in (body.data ?? {}) });
      const existing = [...bucket.values()][0];
      const record = existing
        ? Object.assign(existing, body.data)
        : { documentId: `brands-${++counter}`, ...body.data };
      bucket.set(record.slug ?? 'brand', record);
      writes.put += 1;
      return send(200, { data: record });
    }
  }

  // 单数端点一律 404：真机的 /api/product 就是这样
  if (!name.endsWith('s')) return send(404, { error: 'not found', path: url.pathname });
  const bucket = bucketOf(name);

  if (req.method === 'GET') {
    // 幂等去重靠 filters[...][$eq]，字段可能是 slug 也可能是 legacyId
    const filter = [...url.searchParams.entries()].find(([key]) => /^filters\[.+\]\[\$eq\]$/.test(key));
    if (filter) {
      const field = filter[0].slice(filter[0].indexOf('[') + 1, filter[0].indexOf(']'));
      const hit = [...bucket.values()].find((row) => String(row[field]) === filter[1]);
      return send(200, { data: hit ? [hit] : [] });
    }
    return send(200, { data: [...bucket.values()] });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const data = body.data ?? {};
    publishChecks.push({ method: 'POST', status: url.searchParams.get('status'), hasPublishedAt: 'publishedAt' in data });
    if (!data.slug && !data.legacyId) {
      rejects.push({ name, why: '缺 slug / legacyId' });
      return send(400, { error: 'missing slug' });
    }
    const key = data.slug ?? `legacy-${data.legacyId}`;
    if (bucket.has(key)) return send(400, { error: 'duplicate', key });
    const record = { documentId: `${name}-${++counter}`, ...data };
    bucket.set(key, record);
    writes.post += 1;
    return send(200, { data: record });
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    publishChecks.push({
      method: 'PUT',
      status: url.searchParams.get('status'),
      hasPublishedAt: 'publishedAt' in (body.data ?? {}),
    });
    const entry = [...bucket.entries()].find(([, v]) => v.documentId === documentId);
    if (!entry) return send(404, { error: 'not found' });
    Object.assign(entry[1], body.data ?? {});
    writes.put += 1;
    return send(200, { data: entry[1] });
  }

  return send(405, { error: 'method not allowed' });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- run import
const importOnce = () =>
  run(process.execPath, [resolve(seedDir, 'import.mjs'), '--url', base, '--token', 'test-token'], {
    timeout: 120000,
  });

async function main() {
  console.log(`mock Strapi：${base}（只开复数端点）\n`);

  const first = await importOnce();
  const firstOut = first.stdout;
  console.log(firstOut.trim(), '\n');
  check('首跑没有失败条目', /失败 0/.test(firstOut), (firstOut.match(/新建 \d+ · 更新 \d+ · 失败 \d+/) ?? [''])[0]);
  check(
    '81 条集合记录创建 + brand 走 Single Type upsert',
    /新建 81 · 更新 1/.test(firstOut),
    (firstOut.match(/新建 \d+ · 更新 \d+ · 失败 \d+/) ?? [''])[0],
  );
  check('没有字段层面的 400', rejects.length === 0, rejects.length ? JSON.stringify(rejects.slice(0, 2)) : '0 条被拒');

  const brand = bucketOf('brands');
  check('brand 只有一条（不是每条产品重复建一个品牌）', brand.size === 1, `count=${brand.size}`);

  const products = bucketOf('products');
  const series = bucketOf('product-series');
  const scenarios = bucketOf('scenarios');
  const faqs = bucketOf('faqs');
  check(
    '五个集合条数对得上',
    brand.size === 1 && series.size === 5 && scenarios.size === 16 && products.size === 20 && faqs.size === 40,
    `brand=${brand.size} series=${series.size} scenario=${scenarios.size} product=${products.size} faq=${faqs.size}`,
  );

  const nova = products.get('nova-x4');
  const seriesDocId = nova?.series;
  check(
    '产品系列关联写的是 documentId，不是 slug 字符串',
    typeof seriesDocId === 'string' && [...series.values()].some((s) => s.documentId === seriesDocId),
    `series=${seriesDocId}`,
  );
  check(
    '产品场景关联是 documentId 数组',
    Array.isArray(nova?.scenarios) && nova.scenarios.length === 3 && nova.scenarios.every((id) => typeof id === 'string'),
    `scenarios=${JSON.stringify(nova?.scenarios)}`,
  );
  check(
    'AI 能力进了 specs.ai_features',
    Array.isArray(nova?.specs?.ai_features) && nova.specs.ai_features.length === 3,
    `ai_features=${nova?.specs?.ai_features?.length}`,
  );

  const faq = [...faqs.values()].find((f) => f.product);
  check(
    'FAQ 的产品关联也解析成了 documentId',
    typeof faq?.product === 'string' && [...products.values()].some((p) => p.documentId === faq.product),
    `product=${faq?.product}`,
  );
  check('FAQ 保留了 legacyId（回同步靠它对齐）', typeof faq?.legacyId === 'number', `legacyId=${faq?.legacyId}`);

  // ---- 幂等：再跑一次应该全是 update ----
  const second = await importOnce();
  const secondOut = second.stdout;
  check('第二遍不重复创建', /新建 0/.test(secondOut), (secondOut.match(/新建 \d+ · 更新 \d+ · 失败 \d+/) ?? [''])[0]);
  check('第二遍全部走更新', /更新 82/.test(secondOut), (secondOut.match(/更新 \d+/) ?? [''])[0]);
  check(
    '库里没有多出一份',
    products.size === 20 && faqs.size === 40,
    `product=${products.size} faq=${faqs.size}`,
  );
  check(
    '写入次数符合预期（brand 走 Single Type 的 PUT，其余 81 POST）',
    writes.post === 81 && writes.put === 83,
    `post=${writes.post} put=${writes.put}`,
  );

  // v5 里 publishedAt 是系统字段，塞进 data 会被当成未知属性拒掉（400）。
  // 这条断言守住「发布靠 query 参数」这件事，别在真机上才发现。
  const withPublishedAt = publishChecks.filter((c) => c.hasPublishedAt).length;
  const allPublished = publishChecks.every((c) => c.status === 'published');
  check(
    '发布走 ?status=published，data 里不带 publishedAt',
    publishChecks.length === 164 && allPublished && withPublishedAt === 0,
    `${publishChecks.length} 次写入 · status 全为 published=${allPublished} · 误带 publishedAt ${withPublishedAt} 次`,
  );

  console.table(results);
  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? `　失败 ${fail}` : ''}`);
  return fail;
}

try {
  const failed = await main();
  server.close();
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error('验收脚本异常：', err);
  server.close();
  process.exit(1);
}
