/**
 * 把本地库现有内容导出成可直接灌进 Strapi 的种子包。
 *
 * 为什么要这一步：本地这套 1/5/20/25/140/40 是早期从五份 JSON seed 出来的，
 * Strapi 里一条都没有。两边一旦并行，ingest 就只能在「覆盖」和「不覆盖」之间二选一——
 * 覆盖会把本地更完整的内容打残，不覆盖则 Strapi 改了也不生效。
 * 与其长期靠护栏维持，不如把本地这份搬到 Strapi，让下游只剩一个源。
 *
 * 产物（默认 data/strapi-seed/）：
 *  - seed.ndjson   每行一条 { collection, slug, data }，行序即导入顺序（依赖在前）
 *  - manifest.json 条数、schema 假设、体检结果
 *  - import.mjs    通过 REST 逐条 upsert 的导入脚本（幂等，可反复跑）
 *
 * 关联不写死 documentId（导入前根本不存在），用 { "$ref": collection, "slug": x }
 * 占位，由 import.mjs 在导入时换成真实 id。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ensureDatabaseUrl, repoRoot } from './db-path.js';

ensureDatabaseUrl();

const prisma = new PrismaClient();
const outDir = process.env.STRAPI_SEED_DIR
  ? resolve(process.env.STRAPI_SEED_DIR)
  : resolve(repoRoot(), 'data', 'strapi-seed');

type Entry = { collection: string; slug: string; data: Record<string, unknown> };

const ref = (collection: string, slug: string) => ({ $ref: collection, slug });

/** coreCapabilities / extraSpecs 在库里是 JSON 字符串，写回 Strapi 要给数组/对象 */
const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const issues: string[] = [];

async function main() {
  const brand = await prisma.brand.findFirst({ orderBy: { id: 'asc' } });
  if (!brand) throw new Error('库里没有 brand 记录，先跑 npm run db:seed');

  const [series, scenarios, products, faqs] = await Promise.all([
    prisma.productSeries.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.scenario.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.product.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        series: { select: { slug: true } },
        scenarios: { orderBy: { sortOrder: 'asc' }, include: { scenario: { select: { slug: true } } } },
        features: { orderBy: { sortOrder: 'asc' }, include: { feature: { select: { name: true, kind: true } } } },
      },
    }),
    prisma.faq.findMany({ orderBy: { sortOrder: 'asc' }, include: { product: { select: { slug: true } } } }),
  ]);

  const entries: Entry[] = [];
  // v5 靠 ?status=published 发布，v4 靠 publishedAt 字段本身。
  // 五个集合都带上：只给部分集合加，开了 Draft & Publish 的那些会变草稿，前端直接看不到。
  const publishStamp = new Date().toISOString();

  // ---- brand ----
  entries.push({
    collection: 'brand',
    slug: brand.slug,
    data: {
      slug: brand.slug,
      name: brand.name,
      description: brand.description,
      website: brand.website,
      // Strapi 侧的字段叫 founded，且是 string；发 foundedYear 会被当未知属性拒掉。
      // ingest 读的时候有 founded 回落，num("2019") 也能正确转成 2019。
      founded: brand.foundedYear == null ? null : String(brand.foundedYear),
      headquarters: brand.headquarters,
      coreCapabilities: parseJson<string[]>(brand.coreCapabilities, []),
      metaTitle: brand.metaTitle,
      metaDescription: brand.metaDescription,
      publishedAt: publishStamp,
    },
  });

  // ---- product-series ----
  if (series.length === 0) issues.push('库里没有系列，产品将无处挂载');
  for (const s of series) {
    entries.push({
      collection: 'product-series',
      slug: s.slug,
      data: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        sortOrder: s.sortOrder,
        // Strapi 5 保留 `status`（Draft & Publish 查询参数），内容侧用 lifecycleStatus
        lifecycleStatus: s.status,
        metaTitle: s.metaTitle,
        metaDescription: s.metaDescription,
        brand: ref('brand', brand.slug),
        publishedAt: publishStamp,
      },
    });
  }

  // ---- scenario ----
  for (const s of scenarios) {
    entries.push({
      collection: 'scenario',
      slug: s.slug,
      data: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        isCanonical: s.isCanonical,
        sortOrder: s.sortOrder,
        metaTitle: s.metaTitle,
        metaDescription: s.metaDescription,
        publishedAt: publishStamp,
      },
    });
  }

  // ---- product ----
  for (const p of products) {
    const keyFeatures = p.features.filter((f) => f.feature.kind === 'key').map((f) => f.feature.name);
    const aiFeatures = p.features.filter((f) => f.feature.kind === 'ai').map((f) => f.feature.name);
    const extraSpecs = parseJson<Record<string, unknown>>(p.extraSpecs, {});

    if (!p.overview) issues.push(`产品 ${p.slug} 的 overview 为空`);
    if (!p.shortDescription) issues.push(`产品 ${p.slug} 的 shortDescription 为空`);
    if (keyFeatures.length === 0) issues.push(`产品 ${p.slug} 没有 key features`);
    if (p.scenarios.length === 0) issues.push(`产品 ${p.slug} 没有场景关联`);

    entries.push({
      collection: 'product',
      slug: p.slug,
      data: {
        slug: p.slug,
        name: p.name,
        shortDescription: p.shortDescription,
        overview: p.overview,
        // 只写 specs：ingest 会先读顶层字段、读不到再回落到 specs，
        // 在 Strapi 里多建三个同义字段只会多三处不一致的来源
        specs: {
          ...extraSpecs,
          resolution: p.resolution,
          connectivity: p.connectivity,
          environment: p.environment,
          ...(aiFeatures.length > 0 ? { ai_features: aiFeatures } : {}),
        },
        lifecycleStatus: p.status,
        sortOrder: p.sortOrder,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        publishedAt: (p.publishedAt ?? new Date()).toISOString(),
        series: ref('product-series', p.series.slug),
        scenarios: p.scenarios.map((ps) => ref('scenario', ps.scenario.slug)),
        keyFeatures,
      },
    });
  }

  // ---- faq ----
  for (const f of faqs) {
    if (!f.legacyId) {
      issues.push(`FAQ「${f.question.slice(0, 18)}…」没有 legacyId，回同步时会重复插入`);
      continue;
    }
    entries.push({
      collection: 'faq',
      slug: `faq-${f.legacyId}`,
      data: {
        legacyId: f.legacyId,
        question: f.question,
        answer: f.answer,
        answerSummary: f.answerSummary,
        sortOrder: f.sortOrder,
        isFeatured: f.isFeatured,
        scope: f.scope,
        publishedAt: new Date().toISOString(),
        ...(f.product ? { product: ref('product', f.product.slug) } : {}),
      },
    });
  }

  // ---- 写盘 ----
  mkdirSync(outDir, { recursive: true });
  const ndjson = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(resolve(outDir, 'seed.ndjson'), ndjson, 'utf8');
  writeFileSync(resolve(outDir, 'import.mjs'), IMPORT_SCRIPT, 'utf8');

  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.collection] = (acc[e.collection] ?? 0) + 1;
    return acc;
  }, {});

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'local prisma database',
    outDir,
    counts,
    total: entries.length,
    /** import.mjs 假定这些 content-type 存在，字段名与类型以此为准 */
    collections: [
      { uid: 'brand', endpoint: 'brands（实际为 Collection Type，脚本两种都支持）', singleType: false },
      { uid: 'product-series', endpoint: 'product-series' },
      { uid: 'scenario', endpoint: 'scenarios' },
      { uid: 'product', endpoint: 'products' },
      { uid: 'faq', endpoint: 'faqs' },
    ],
    schemaAssumptions: {
      brand: [
        'slug (Text, unique)',
        'name (Text, required)',
        'description (Text)',
        'website (Text)',
        'founded (Text，注意不是 Integer，字段名也不是 foundedYear)',
        'headquarters (Text)',
        'coreCapabilities (JSON, 字符串数组)',
        'metaTitle (Text)',
        'metaDescription (Text)',
      ],
      'product-series': [
        'slug (Text, unique)',
        'name (Text, required)',
        'description (Text)',
        'sortOrder (Integer, default 0)',
        'lifecycleStatus (Enumeration: active | discontinued) — 不能叫 status，会与 Draft & Publish 撞名',
        'metaTitle (Text)',
        'metaDescription (Text)',
        'brand (Relation, manyToOne → brand)',
      ],
      scenario: [
        'slug (Text, unique)',
        'name (Text, required)',
        'description (Text)',
        'isCanonical (Boolean, default true)',
        'sortOrder (Integer, default 0)',
        'metaTitle (Text)',
        'metaDescription (Text)',
      ],
      product: [
        'slug (Text, unique)',
        'name (Text, required)',
        'shortDescription (Text)',
        'overview (Text)',
        'specs (JSON)',
        'keyFeatures (JSON, 字符串数组)',
        'lifecycleStatus (Enumeration: active | beta | discontinued) — 不能叫 status，会与 Draft & Publish 撞名',
        'sortOrder (Integer, default 0)',
        'metaTitle (Text)',
        'metaDescription (Text)',
        'series (Relation, manyToOne → product-series)',
        'scenarios (Relation, manyToMany → scenario)',
      ],
      faq: [
        'legacyId (Integer, unique) —— 回同步靠它对齐，必须建',
        'question (Text, required)',
        'answer (Text)',
        'answerSummary (Text)',
        'sortOrder (Integer, default 0)',
        'isFeatured (Boolean, default false)',
        'scope (Enumeration: product | series | scenario | brand)',
        'product (Relation, manyToOne → product)',
      ],
    },
    /** 不用手动建，但需要知道它从哪来 */
    notes: [
      'publishedAt 是 Draft & Publish 的系统字段：开了这个开关就有，不用手动建；没开就没有，所有内容默认对外可见。',
      '导入时发布的表达方式是 ?status=published（v5）或 publishedAt 字段（v4，加 --v4）。',
      'keyFeatures 必须是 JSON 字段：Strapi 没有原生数组类型，用 Text 存会解析成一整个字符串。',
      '端点名默认按复数探测（product → products），自定义过才需要 STRAPI_ENDPOINTS。',
    ],
    issues,
  };
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log('✓ 种子包已导出：', outDir);
  console.table(counts);
  console.log(`  共 ${entries.length} 条，导入顺序 brand → product-series → scenario → product → faq`);
  console.log(`\n  下一步：node ${resolve(outDir, 'import.mjs')} --url http://localhost:1337 --token <API_TOKEN>`);
  if (issues.length > 0) {
    console.log('\n⚠ 体检（不影响导出，但这些内容进 Strapi 后同样是残缺的）：');
    for (const i of issues.slice(0, 10)) console.log(`  - ${i}`);
    if (issues.length > 10) console.log(`  - …另有 ${issues.length - 10} 条`);
  }

  await prisma.$disconnect();
}

/** 生成到输出目录的导入脚本：REST upsert，幂等，按行序处理依赖 */
const IMPORT_SCRIPT = `#!/usr/bin/env node
/**
 * 把 seed.ndjson 灌进 Strapi。可以反复跑：已存在的按 slug 查出来 update，不会重复创建。
 *
 *   node import.mjs --url http://localhost:1337 --token <API_TOKEN> [--dry-run] [--v4]
 *
 * 前置：Strapi 里已建好 brand / product-series / scenario / product / faq 五个
 * content-type，且 API Token 有 find + create + update 权限。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const baseUrl = (opt('url') || process.env.STRAPI_URL || '').replace(/\\/+$/, '');
const token = opt('token') || process.env.STRAPI_TOKEN || '';
const dryRun = flag('dry-run');
const v4 = flag('v4');

if (!baseUrl) {
  console.error('缺 --url（或 STRAPI_URL）');
  process.exit(2);
}
if (!token) {
  console.error('缺 --token（或 STRAPI_TOKEN）。Strapi 后台 Settings → API Tokens 生成');
  process.exit(2);
}

const entries = readFileSync(join(here, 'seed.ndjson'), 'utf8')
  .split('\\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

/** 出错时用来提示该 content-type 还缺什么字段 */
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
} catch {
  /* 没 manifest 也能跑，只是报错时少一点线索 */
}

/** collection:slug → documentId */
const ids = new Map();
/** collection → 实际可用的 REST 路径段 */
const routes = new Map();
/** collection → 是不是 Single Type（/api/brand 返回对象而非数组，写入用无 id 的 PUT） */
const singles = new Set();

const stats = { created: 0, updated: 0, failed: 0 };

async function request(path, init = {}) {
  const res = await fetch(baseUrl + '/api/' + path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + token,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 保留原文 */
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Strapi 默认按 pluralName 暴露（product → products），单复数都试一次并记住结果 */
async function routeFor(collection) {
  if (routes.has(collection)) return routes.get(collection);
  const plural = collection.endsWith('s') ? collection : collection + 's';
  const candidates = collection === plural ? [collection] : [collection, plural];
  for (const name of candidates) {
    const res = await request(name + '?pagination[pageSize]=1');
    if (res.ok) {
      routes.set(collection, name);
      // Single Type 有两个特征：data 是对象，或者空的时候是 null
      //（Collection Type 空着也只会返回 []，不会是 null）
      const data = res.json && res.json.data;
      if (data === null || (data && !Array.isArray(data))) singles.add(collection);
      return name;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('API Token 无权访问 /api/' + name + '（HTTP ' + res.status + '），请补 find 权限');
    }
  }
  throw new Error(
    '找不到集合 ' + collection + '（试过 ' + candidates.join(' / ') + '）。先在后台上建好这个 content-type',
  );
}

/** v5 返回 documentId，v4 只有 id 且包一层 attributes */
function idOf(node) {
  if (!node) return null;
  if (node.documentId) return node.documentId;
  if (node.id !== undefined && node.id !== null) return node.id;
  return null;
}

/**
 * 按唯一键查已有记录。
 *
 * slug 是首选；FAQ 这类没有 slug 的必须用 legacyId——拿一个不存在的字段去 filter，
 * Strapi 只会返回空数组，于是每条都判成「不存在」，跑第二遍就重复插一份。
 */
async function findByKey(route, field, value, cacheKey) {
  const res = await request(
    route + '?filters[' + field + '][$eq]=' + encodeURIComponent(value) + '&pagination[pageSize]=1',
  );
  if (!res.ok) throw new Error('查询 ' + route + '?' + field + '=' + value + ' 失败：HTTP ' + res.status);
  const list = res.json && res.json.data;
  const first = Array.isArray(list) ? list[0] : list;
  const docId = idOf(first);
  if (!docId) return null;
  ids.set(currentCollection + ':' + cacheKey, docId);
  return docId;
}

/** 把 {$ref, slug} 换成真实 id；v4 用 connect 包装 */
function resolveRefs(node) {
  if (Array.isArray(node)) {
    const resolved = node.map(resolveRefs).filter((v) => v !== undefined);
    if (v4) return { connect: resolved };
    return resolved;
  }
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') {
      const key = node.$ref + ':' + node.slug;
      const docId = ids.get(key);
      if (!docId) {
        throw new Error('引用还没导入：' + key + '（检查行序，被引用项必须排在前面）');
      }
      return docId;
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = resolveRefs(v);
    return out;
  }
  return node;
}

let currentCollection = '';

async function main() {
  console.log('目标：' + baseUrl + (dryRun ? '（预演，不写库）' : '') + (v4 ? ' · v4 语法' : ' · v5 语法'));
  console.log('共 ' + entries.length + ' 条\\n');

  for (const entry of entries) {
    currentCollection = entry.collection;
    try {
      const route = await routeFor(entry.collection);
      const isSingle = singles.has(entry.collection);
      const keyField = entry.data.slug !== undefined ? 'slug' : entry.data.legacyId !== undefined ? 'legacyId' : null;
      if (!keyField && !isSingle) throw new Error('数据里既没有 slug 也没有 legacyId，无法做幂等导入');
      // 预演不解析关联：被引用项还没写进去，真实的 documentId 根本不存在
      const payload = dryRun ? entry.data : resolveRefs(entry.data);
      const existing = isSingle ? 'single' : await findByKey(route, keyField, payload[keyField], entry.slug);

      if (dryRun) {
        ids.set(entry.collection + ':' + entry.slug, 'dry-run-' + entry.slug);
        console.log('  ' + (existing ? '~' : '+') + ' ' + entry.collection + '/' + entry.slug);
        continue;
      }

      // v5 的 publishedAt 是系统字段：写进 data 会被当成未知属性拒掉，
      // 发布要靠 ?status=published。v4 相反，published_at 就在 attributes 里。
      const { publishedAt, ...fields } = payload;
      const body = v4 ? payload : fields;
      const publish = !v4 && publishedAt ? '?status=published' : '';

      let res;
      if (isSingle) {
        // Single Type 只有一条，没有 slug 可查，直接 PUT 覆盖（不存在时 Strapi 会建）
        res = await request(route + publish, {
          method: 'PUT',
          body: JSON.stringify({ data: body }),
        });
      } else if (existing) {
        res = await request(route + '/' + existing + publish, {
          method: 'PUT',
          body: JSON.stringify({ data: body }),
        });
      } else {
        res = await request(route + publish, { method: 'POST', body: JSON.stringify({ data: body }) });
      }

      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' ' + JSON.stringify(res.json || res.text).slice(0, 300));
      }
      const docId = idOf(res.json && res.json.data) || existing;
      if (docId) ids.set(entry.collection + ':' + entry.slug, docId);
      if (existing) stats.updated += 1;
      else stats.created += 1;
    } catch (err) {
      stats.failed += 1;
      const message = err.message.length > 400 ? err.message.slice(0, 400) + '…' : err.message;
      console.error('  ✗ ' + entry.collection + '/' + entry.slug + '：' + message);
      // 400 基本都是「content-type 里没这个字段」。直接把该集合的字段清单打出来，
      // 比让用户在后台一栏一栏比对快得多。
      const expected = manifest && manifest.schemaAssumptions && manifest.schemaAssumptions[entry.collection];
      if (expected && /HTTP 4\\d\\d/.test(err.message)) {
        console.error('    这个 content-type 需要这些字段（缺哪个补哪个）：');
        for (const field of expected) console.error('      · ' + field);
      }
    }
  }

  console.log('\\n新建 ' + stats.created + ' · 更新 ' + stats.updated + ' · 失败 ' + stats.failed);
  if (stats.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
`;

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
