/**
 * 导入 GLM embedding-3 向量文件（index.json）到 knowledge_chunk。
 *
 * 向量文件只带 chunk 的 source（文件名）+ heading（标题），
 * 所以这里按 heading 反查实体，把多态引用补成 source_type + source_id + url_path，
 * 检索命中后就能直接回链到对应页面。
 */
import { readFileSync } from 'node:fs';
import { VECTOR_FILE, insert, openDb, sha256, tableCount } from './shared.mjs';

const TEMPLATE_VERSION = 1;

const raw = readFileSync(VECTOR_FILE, 'utf8');
const { meta, chunks } = JSON.parse(raw);

if (!Array.isArray(chunks) || chunks.length === 0) throw new Error('向量文件里没有 chunks');
if (!meta?.dimension) throw new Error('向量文件缺少 meta.dimension');

const db = openDb();
const dimensions = meta.dimension;

// ---- 建立 heading → 实体 的反查表 -------------------------------------
const brand = db.prepare('select id, slug from brand').get();

const seriesByName = new Map();
for (const s of db.prepare('select id, slug, name from product_series').all()) {
  seriesByName.set(s.name.toLowerCase(), s);
}

const productByName = new Map();
for (const p of db.prepare('select id, slug, name from product').all()) {
  productByName.set(p.name.toLowerCase(), p);
}

const productById = new Map();
for (const p of db.prepare('select id, slug from product').all()) {
  productById.set(p.id, p);
}

const scenarioByName = new Map();
for (const s of db.prepare('select id, slug, name from scenario').all()) {
  scenarioByName.set(s.name.toLowerCase(), s);
}

const faqByQuestion = new Map();
for (const f of db.prepare('select id, question, product_id from faq').all()) {
  faqByQuestion.set(f.question.trim().toLowerCase(), f);
}

// ---- 映射规则 ---------------------------------------------------------
function resolve(chunk) {
  const doc = chunk.source.replace(/\.json$/, '');
  const heading = (chunk.heading ?? '').trim();

  if (doc === 'brand') {
    return { sourceType: 'brand', sourceId: brand.id, urlPath: '/', index: 0 };
  }

  if (doc === 'product_series') {
    const s = seriesByName.get(heading.toLowerCase());
    return s && { sourceType: 'series', sourceId: s.id, urlPath: `/series/${s.slug}`, index: 0 };
  }

  if (doc === 'products') {
    // heading 形如 "Nova X4" 或 "Nova X4 · 规格参数"
    const [name, section] = heading.split('·').map((x) => x.trim());
    const p = productByName.get(name.toLowerCase());
    if (!p) return null;
    const isSpec = Boolean(section);
    return {
      sourceType: 'product',
      sourceId: p.id,
      urlPath: isSpec ? `/products/${p.slug}#specs` : `/products/${p.slug}`,
      index: isSpec ? 1 : 0,
    };
  }

  if (doc === 'scenarios') {
    const s = scenarioByName.get(heading.toLowerCase());
    return s && { sourceType: 'scenario', sourceId: s.id, urlPath: `/scenarios/${s.slug}`, index: 0 };
  }

  if (doc === 'faqs') {
    const f = faqByQuestion.get(heading.toLowerCase());
    if (!f) return null;
    const p = productById.get(f.product_id);
    return { sourceType: 'faq', sourceId: f.id, urlPath: `/products/${p?.slug ?? ''}#faq`, index: 0 };
  }

  return null;
}

// ---- 写库 -------------------------------------------------------------
db.exec('begin');
let versionId = 0;
try {
  db.exec('delete from knowledge_chunk');
  db.exec('delete from embedding_index');
  db.exec(`delete from sqlite_sequence where name in ('knowledge_chunk','embedding_index')`);

  const builtAt = meta.builtAt ?? new Date().toISOString();

  // 先建版本行（building），灌完再切 active —— 与 kb:reindex 的流程保持一致
  versionId = insert(db, 'embedding_index', {
    model: meta.embedModel,
    dimensions,
    chunk_size: meta.chunkSize,
    document_count: meta.documentCount,
    chunk_count: 0,
    template_version: TEMPLATE_VERSION,
    status: 'building',
    built_at: builtAt,
    source_file: VECTOR_FILE,
    source_hash: sha256(raw),
  });

  const unmapped = [];
  let bytes = 0;

  for (const chunk of chunks) {
    if (chunk.vector.length !== dimensions) {
      throw new Error(`chunk ${chunk.id} 维度为 ${chunk.vector.length}，与 meta.dimension ${dimensions} 不一致`);
    }
    const target = resolve(chunk);
    if (!target) {
      unmapped.push(`${chunk.id} (${chunk.source} / ${chunk.heading})`);
      continue;
    }

    const f32 = Float32Array.from(chunk.vector);
    const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    bytes += buf.length;

    insert(db, 'knowledge_chunk', {
      external_id: `${target.sourceType}:${target.sourceId}:${target.index}`,
      source_type: target.sourceType,
      source_id: target.sourceId,
      chunk_index: target.index,
      heading: chunk.heading ?? null,
      content: chunk.text,
      url_path: target.urlPath,
      embedding: buf,
      model: meta.embedModel,
      dimensions,
      content_hash: sha256(chunk.text),
      index_version: versionId,
      template_version: TEMPLATE_VERSION,
      built_at: builtAt,
    });
  }

  if (unmapped.length) {
    throw new Error(`${unmapped.length} 条 chunk 无法映射到实体：\n  ${unmapped.join('\n  ')}`);
  }

  db.prepare('update embedding_index set chunk_count = ?, status = ?, activated_at = ? where id = ?').run(
    chunks.length,
    'active',
    builtAt,
    versionId,
  );

  db.exec('commit');

  console.log(`✓ 向量已导入：${tableCount(db, 'knowledge_chunk')} 条 · ${dimensions} 维 · ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  const dist = db
    .prepare('select source_type, count(*) n from knowledge_chunk group by source_type order by n desc')
    .all();
  console.table(dist);
} catch (err) {
  db.exec('rollback');
  throw err;
}

db.close();
