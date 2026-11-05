/**
 * 数据库体检：行数、外键完整性、覆盖度，并跑一次真实余弦检索验证 BLOB 往返无损。
 */
import { DB_PATH, openDb, tableCount } from './shared.mjs';

const db = openDb({ readonly: true });
const problems = [];
const note = (msg) => problems.push(msg);

console.log(`数据库：${DB_PATH}\n`);

// ---- 1. 行数 -----------------------------------------------------------
const tables = [
  'brand',
  'product_series',
  'product',
  'feature',
  'product_feature',
  'scenario',
  'product_scenario',
  'faq',
  'knowledge_chunk',
  'embedding_index',
];
const counts = Object.fromEntries(tables.map((t) => [t, tableCount(db, t)]));
console.log('【行数】');
console.table(counts);

// ---- 2. 外键完整性（SQLite 单表自检，绕开 foreign_keys 开关）-----------
const fkChecks = [
  ['product 指向不存在的 series', 'select count(*) n from product p left join product_series s on s.id = p.series_id where s.id is null'],
  ['product 指向不存在的 brand', 'select count(*) n from product p left join brand b on b.id = p.brand_id where b.id is null'],
  ['faq 指向不存在的 product', 'select count(*) n from faq f left join product p on p.id = f.product_id where f.product_id is not null and p.id is null'],
  ['product_feature 孤儿', 'select count(*) n from product_feature pf left join product p on p.id = pf.product_id left join feature f on f.id = pf.feature_id where p.id is null or f.id is null'],
  ['product_scenario 孤儿', 'select count(*) n from product_scenario ps left join product p on p.id = ps.product_id left join scenario s on s.id = ps.scenario_id where p.id is null or s.id is null'],
  ['knowledge_chunk 未映射实体', `select count(*) n from knowledge_chunk k where
      (k.source_type = 'product' and not exists (select 1 from product p where p.id = k.source_id))
   or (k.source_type = 'series'  and not exists (select 1 from product_series s where s.id = k.source_id))
   or (k.source_type = 'faq'     and not exists (select 1 from faq f where f.id = k.source_id))
   or (k.source_type = 'scenario' and not exists (select 1 from scenario s where s.id = k.source_id))
   or (k.source_type = 'brand'   and not exists (select 1 from brand b where b.id = k.source_id))`],
];
console.log('【外键完整性】');
for (const [label, sql] of fkChecks) {
  const n = db.prepare(sql).get().n;
  console.log(`  ${n === 0 ? '✓' : '✗'} ${label}: ${n}`);
  if (n !== 0) note(label);
}

// ---- 3. 内容覆盖度 -----------------------------------------------------
const noScenario = db.prepare(`select p.name from product p
  where not exists (select 1 from product_scenario ps where ps.product_id = p.id)`).all();
const noFaq = db.prepare(`select p.name from product p
  where not exists (select 1 from faq f where f.product_id = p.id)`).all();
const noFeature = db.prepare(`select p.name from product p
  where not exists (select 1 from product_feature pf where pf.product_id = p.id and pf.feature_id in (select id from feature where kind = 'key'))`).all();
const emptyScenario = db.prepare(`select s.name from scenario s
  where not exists (select 1 from product_scenario ps where ps.scenario_id = s.id)`).all();
const noChunk = db.prepare(`select p.name from product p
  where not exists (select 1 from knowledge_chunk k where k.source_type = 'product' and k.source_id = p.id)`).all();
const noMeta = db.prepare(`select count(*) n from product where meta_title is null or meta_description is null`).get().n;

console.log('\n【内容覆盖度】');
console.log(`  ${noScenario.length === 0 ? '✓' : '✗'} 每个产品都有适用场景（缺失 ${noScenario.length}）`);
console.log(`  ${noFaq.length === 0 ? '✓' : '✗'} 每个产品都有 FAQ（缺失 ${noFaq.length}）`);
console.log(`  ${noFeature.length === 0 ? '✓' : '✗'} 每个产品都有特性（缺失 ${noFeature.length}）`);
console.log(`  ${noChunk.length === 0 ? '✓' : '✗'} 每个产品都有向量分块（缺失 ${noChunk.length}）`);
console.log(`  ${noMeta === 0 ? '✓' : '✗'} 每个产品都有 SEO 文案（缺失 ${noMeta}）`);
if (emptyScenario.length) {
  console.log(`  ⚠ 无产品关联的场景：${emptyScenario.map((s) => s.name).join(', ')}`);
}
for (const [arr, label] of [[noScenario, '有产品缺场景'], [noFaq, '有产品缺 FAQ'], [noChunk, '有产品缺向量']]) {
  if (arr.length) note(`${label}: ${arr.map((x) => x.name).join(', ')}`);
}

// ---- 4. 关系查询演练：Series 筛选 -------------------------------------
console.log('\n【列表页：Series 筛选】');
const rows = db.prepare(`
  select s.slug as series, s.name as series_name, count(p.id) as products,
         group_concat(p.name, ' / ') as names
  from product_series s
  left join product p on p.series_id = s.id and p.status <> 'discontinued'
  group by s.id order by s.sort_order`).all();
for (const r of rows) console.log(`  ${r.series_name.padEnd(18)} ${r.products} 个 · ${r.names}`);

// ---- 5. 详情页查询演练：一次装配 --------------------------------------
const slug = 'nova-x4';
const product = db.prepare(`
  select p.*, s.slug as series_slug, s.name as series_name, b.name as brand_name, b.website as brand_website
  from product p join product_series s on s.id = p.series_id join brand b on b.id = p.brand_id
  where p.slug = ?`).get(slug);
const keyFeatures = db.prepare(`
  select f.name from product_feature pf join feature f on f.id = pf.feature_id
  where pf.product_id = ? and f.kind = 'key' order by pf.sort_order`).all(product.id).map((r) => r.name);
const aiFeatures = db.prepare(`
  select f.name from product_feature pf join feature f on f.id = pf.feature_id
  where pf.product_id = ? and f.kind = 'ai' order by pf.sort_order`).all(product.id).map((r) => r.name);
const scenarios = db.prepare(`
  select s.name, s.slug from product_scenario ps join scenario s on s.id = ps.scenario_id
  where ps.product_id = ? order by ps.sort_order`).all(product.id);
const faqs = db.prepare('select question from faq where product_id = ? order by sort_order').all(product.id);

console.log(`\n【详情页：/products/${slug}】`);
console.log(`  title: ${product.meta_title}`);
console.log(`  desc : ${product.meta_description}`);
console.log(`  系列 : ${product.series_name} · 状态 ${product.status}`);
console.log(`  规格 : ${product.resolution ?? '—'} / ${product.connectivity} / ${product.environment}`);
console.log(`  特性 : ${keyFeatures.join(', ')}`);
console.log(`  AI   : ${aiFeatures.join(', ')}`);
console.log(`  场景 : ${scenarios.map((s) => s.name).join(', ')}`);
console.log(`  FAQ  : ${faqs.length} 条 → ${faqs.map((f) => f.question).join(' | ')}`);

// ---- 6. 向量检索：BLOB 往返 + 余弦相似度 -------------------------------
const decode = (buf) => new Float32Array(new Uint8Array(buf).buffer);
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const all = db.prepare(`select k.id, k.external_id, k.heading, k.url_path, k.source_type, k.embedding
  from knowledge_chunk k join embedding_index i on i.id = k.index_version and i.status = 'active'`).all();
const vecs = all.map((r) => ({ ...r, v: decode(r.embedding) }));

// 6.1 自检索命中率：每条 chunk 用自身向量查，top1 必须是自己
let hit = 0;
for (const q of vecs) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of vecs) {
    const s = dot(q.v, c.v);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (best.id === q.id) hit++;
}
console.log(`\n【向量自检】${hit}/${vecs.length} 条 chunk 用自身向量检索命中自己（BLOB 往返无损）`);
if (hit !== vecs.length) note(`向量自检命中 ${hit}/${vecs.length}`);

// 6.2 真实语义检索示例
function search(queryVec, k = 3) {
  return vecs
    .map((c) => ({ ...c, score: dot(queryVec, c.v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
const anchor = vecs.find((c) => c.source_type === 'faq' && (c.heading ?? '').includes('Thermal PTZ 25'));
console.log(`\n【检索示例】以 chunk「${anchor.heading}」的向量为 query，Top 3：`);
for (const r of search(anchor.v)) {
  console.log(`  ${r.score.toFixed(4)}  [${r.source_type}] ${r.heading}  →  ${r.url_path}`);
}

// ---- 7. FAQ 内容质量 ---------------------------------------------------
const dup = db.prepare('select count(*) n from faq').get().n - db.prepare('select count(distinct answer) n from faq').get().n;
console.log(`\n【FAQ 内容质量】${dup} 条答案与其它条目完全重复（源数据模板化，建议 CMS 侧改写）`);

console.log(`\n${problems.length === 0 ? '✓ 全部检查通过' : `✗ ${problems.length} 项待处理：\n  - ${problems.join('\n  - ')}`}`);
db.close();
