/**
 * 灌入 5 份知识 JSON（brand / product_series / products / scenarios / faqs）。
 *
 * 相比"把 JSON 直接映射成表"，这里做了 5 件事：
 *  1. 丢弃 products.series_name 冗余字段，改由 series_id 外键取
 *  2. 丢弃 products.faq_ids 双向引用，只保留 faq.product_id 单向 + sort_order 定序
 *  3. best_for 字符串数组 → scenario 词表 + product_scenario 关联表
 *  4. key_features 与 specs.ai_features 合并进 feature 表，用 kind 区分
 *  5. 自动生成 SEO 默认文案（meta_title / meta_description），留待 CMS 覆盖
 */
import { DB_PATH, insert, nowIso, openDb, readJson, slugify, truncate } from './shared.mjs';

const brandJson = readJson('brand.json');
const seriesJson = readJson('product_series.json');
const productsJson = readJson('products.json');
const scenariosJson = readJson('scenarios.json');
const faqsJson = readJson('faqs.json');

const db = openDb();
const now = nowIso();
const report = { warnings: [] };

db.exec('begin');
try {
  // ---- 清空（顺序遵循外键依赖）------------------------------------------
  for (const t of [
    'knowledge_chunk',
    'embedding_index',
    'product_feature',
    'product_scenario',
    'faq',
    'product',
    'product_series',
    'feature',
    'scenario',
    'brand',
  ]) {
    db.exec(`delete from ${t}`);
  }
  db.exec(`delete from sqlite_sequence where name in
    ('brand','product_series','product','feature','scenario','faq','knowledge_chunk','embedding_index')`);

  // ---- 1. brand --------------------------------------------------------
  const brandId = insert(db, 'brand', {
    slug: brandJson.slug,
    name: brandJson.name,
    description: brandJson.description,
    website: brandJson.website,
    founded_year: Number.parseInt(brandJson.founded, 10) || null,
    headquarters: brandJson.headquarters,
    core_capabilities: JSON.stringify(brandJson.core_capabilities ?? []),
    meta_title: `${brandJson.name} — AI video security for retail, warehouse and perimeter`,
    meta_description: truncate(brandJson.description, 158),
    created_at: now,
    updated_at: now,
  });

  // ---- 2. product_series ----------------------------------------------
  const seriesIdBySlug = new Map();
  seriesJson.forEach((s, i) => {
    const id = insert(db, 'product_series', {
      brand_id: brandId,
      slug: s.slug,
      name: s.name,
      description: s.description,
      sort_order: i,
      status: 'active',
      meta_title: `${s.name} | ${brandJson.name}`,
      meta_description: truncate(s.description, 158),
      created_at: now,
      updated_at: now,
    });
    seriesIdBySlug.set(s.slug, id);
  });

  // ---- 3. feature 词表（key 与 ai 两类共用一张表）-----------------------
  const featureIdByKey = new Map();
  const featureSeq = { key: 0, ai: 0 };
  function ensureFeature(name, kind) {
    const slug = slugify(name);
    const key = `${kind}:${slug}`;
    if (featureIdByKey.has(key)) return featureIdByKey.get(key);
    const id = insert(db, 'feature', {
      slug, // key 与 ai 两套词表无重名，slug 全局唯一；若未来产生重名会显式报错而不是静默覆盖
      name,
      kind,
      category: null,
      sort_order: featureSeq[kind]++,
    });
    featureIdByKey.set(key, id);
    return id;
  }

  // ---- 4. product + product_feature ------------------------------------
  const productIdBySlug = new Map();
  productsJson.forEach((p, i) => {
    const seriesId = seriesIdBySlug.get(p.series_slug);
    if (!seriesId) throw new Error(`产品 ${p.slug} 引用了不存在的系列 ${p.series_slug}`);

    const seriesName = seriesJson.find((s) => s.slug === p.series_slug).name;
    // meta description 优先保证"一句话定位 + 适用场景"完整，长度允许再追加核心特性
    const metaHead = `${p.short_description.replace(/\.$/, '')}. Best for ${p.best_for.slice(0, 2).join(', ')}.`;
    const metaFull = `${metaHead} Key features: ${p.key_features.slice(0, 2).join(', ')}.`;
    const metaDescription = metaFull.length <= 158 ? metaFull : truncate(metaHead, 158);

    const id = insert(db, 'product', {
      brand_id: brandId,
      series_id: seriesId,
      legacy_id: p.id,
      slug: p.slug,
      name: p.name,
      short_description: p.short_description,
      overview: p.overview,
      resolution: p.specs?.resolution ?? null,
      connectivity: p.specs?.connectivity ?? null,
      environment: p.specs?.environment ?? null,
      extra_specs: null,
      status: p.status ?? 'active',
      sort_order: i,
      meta_title: truncate(`${p.name} — ${seriesName} | ${brandJson.name}`, 60),
      meta_description: metaDescription,
      published_at: now,
      created_at: now,
      updated_at: now,
    });
    productIdBySlug.set(p.slug, id);

    if (p.specs?.resolution == null) {
      report.warnings.push(`${p.name} 的 specs.resolution 为 null（源数据缺失，已存 null）`);
    }

    p.key_features.forEach((f, j) => {
      insert(db, 'product_feature', {
        product_id: id,
        feature_id: ensureFeature(f, 'key'),
        sort_order: j,
      });
    });
    (p.specs?.ai_features ?? []).forEach((f, j) => {
      insert(db, 'product_feature', {
        product_id: id,
        feature_id: ensureFeature(f, 'ai'),
        sort_order: j,
      });
    });
  });

  // ---- 5. scenario：8 个官方场景 + best_for 反推补建 --------------------
  const scenarioIdByName = new Map();
  scenariosJson.forEach((s, i) => {
    const id = insert(db, 'scenario', {
      slug: s.slug,
      name: s.name,
      description: s.description,
      is_canonical: 1,
      sort_order: i,
      meta_title: `${s.name} video surveillance solutions | ${brandJson.name}`,
      meta_description: truncate(s.description, 158),
      created_at: now,
      updated_at: now,
    });
    scenarioIdByName.set(s.name.toLowerCase(), id);
  });

  const derived = new Map(); // name -> id
  for (const p of productsJson) {
    for (const name of p.best_for) {
      const key = name.toLowerCase();
      if (scenarioIdByName.has(key) || derived.has(key)) continue;
      const id = insert(db, 'scenario', {
        slug: slugify(name),
        name,
        description: null, // 源数据无描述，留待编辑补充
        is_canonical: 0,
        sort_order: 100 + derived.size,
        meta_title: `${name} | ${brandJson.name}`,
        meta_description: `${name}: AI video security products and deployment guidance from ${brandJson.name}.`,
        created_at: now,
        updated_at: now,
      });
      derived.set(key, id);
    }
  }
  const scenarioLookup = (name) => scenarioIdByName.get(name.toLowerCase()) ?? derived.get(name.toLowerCase());

  // ---- 6. product_scenario（保留 best_for 原始顺序）---------------------
  for (const p of productsJson) {
    p.best_for.forEach((name, j) => {
      const scenarioId = scenarioLookup(name);
      if (!scenarioId) throw new Error(`场景 ${name} 未解析`);
      insert(db, 'product_scenario', {
        product_id: productIdBySlug.get(p.slug),
        scenario_id: scenarioId,
        sort_order: j,
      });
    });
  }

  // ---- 7. faq ----------------------------------------------------------
  const faqIdByLegacy = new Map();
  for (const f of faqsJson) {
    const productId = productIdBySlug.get(f.product_slug);
    if (!productId) throw new Error(`FAQ ${f.id} 指向不存在产品 ${f.product_slug}`);
    const id = insert(db, 'faq', {
      legacy_id: f.id,
      brand_id: brandId,
      product_id: productId,
      series_id: null,
      scenario_id: null,
      scope: 'product',
      question: f.question,
      answer: f.answer,
      answer_summary: null,
      sort_order: 0,
      is_featured: 0,
      status: 'published',
      created_at: now,
      updated_at: now,
    });
    faqIdByLegacy.set(f.id, id);
  }

  // 用 product.faq_ids 覆盖排序，并校验双向一致性
  for (const p of productsJson) {
    p.faq_ids.forEach((legacyId, j) => {
      const faqId = faqIdByLegacy.get(legacyId);
      if (!faqId) throw new Error(`${p.slug} 的 faq_ids 引用了不存在的 FAQ ${legacyId}`);
      db.prepare('update faq set sort_order = ? where id = ?').run(j, faqId);
    });
    const actual = faqsJson.filter((f) => f.product_slug === p.slug).length;
    if (actual !== p.faq_ids.length) {
      report.warnings.push(`${p.name}: faq_ids ${p.faq_ids.length} 条，实际 FAQ ${actual} 条，不一致`);
    }
  }

  // ---- 8. 回填系列级 meta（此时才知道每个系列有多少产品）----------------
  for (const s of seriesJson) {
    const n = productsJson.filter((p) => p.series_slug === s.slug).length;
    db.prepare('update product_series set meta_description = ?, updated_at = ? where slug = ?').run(
      truncate(`${s.description} ${n} products. Compare specs, features and best-fit scenarios.`, 158),
      now,
      s.slug,
    );
  }

  db.exec('commit');
} catch (err) {
  db.exec('rollback');
  throw err;
}

// ---- 数据体检 ----------------------------------------------------------
const counts = {
  brand: db.prepare('select count(*) n from brand').get().n,
  product_series: db.prepare('select count(*) n from product_series').get().n,
  product: db.prepare('select count(*) n from product').get().n,
  feature: db.prepare('select count(*) n from feature').get().n,
  product_feature: db.prepare('select count(*) n from product_feature').get().n,
  scenario: db.prepare('select count(*) n from scenario').get().n,
  product_scenario: db.prepare('select count(*) n from product_scenario').get().n,
  faq: db.prepare('select count(*) n from faq').get().n,
};
const canonical = db.prepare('select count(*) n from scenario where is_canonical = 1').get().n;
const distinctAnswers = db.prepare('select count(distinct answer) n from faq').get().n;

console.log('✓ 知识数据已灌入', DB_PATH);
console.table(counts);
console.log(`  官方场景 ${canonical} 个，best_for 补建 ${counts.scenario - canonical} 个`);
console.log(`  FAQ 答案去重后 ${distinctAnswers} 条 / 共 ${counts.faq} 条（源数据模板化，同产品两问共用一段答案）`);
if (report.warnings.length) {
  console.log('\n⚠ 数据体检：');
  for (const w of report.warnings) console.log(`  - ${w}`);
}
console.log('\n下一步：npm run db:vectors 导入向量');

db.close();
