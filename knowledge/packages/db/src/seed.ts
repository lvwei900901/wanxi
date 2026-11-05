/**
 * 把五份知识 JSON 灌成关系模型（等价于旧 scripts/seed.mjs，改为 Prisma 实现）。
 *
 * 相比"把 JSON 直接映射成表"，这里做了 5 件事：
 *  1. 丢弃 products.series_name 冗余字段，改由 series_id 外键取
 *  2. 丢弃 products.faq_ids 双向引用，只保留 faq.product_id 单向 + sort_order 定序
 *  3. best_for 字符串数组 → scenario 词表 + product_scenario 关联表
 *  4. key_features 与 specs.ai_features 合并进 feature 表，用 kind 区分
 *  5. 自动生成 SEO 默认文案（meta_title / meta_description），留待 CMS 覆盖
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ensureDatabaseUrl, sourceDir } from './db-path.js';

type BrandJson = {
  slug: string;
  name: string;
  description: string;
  website: string;
  founded: string;
  headquarters: string;
  core_capabilities: string[];
};

type SeriesJson = { slug: string; name: string; description: string };

type ProductJson = {
  id: number;
  slug: string;
  name: string;
  series_slug: string;
  short_description: string;
  overview: string;
  key_features: string[];
  best_for: string[];
  specs?: { resolution?: string | null; connectivity?: string | null; environment?: string | null; ai_features?: string[] };
  faq_ids: number[];
  status?: string;
};

type ScenarioJson = { slug: string; name: string; description: string };
type FaqJson = { id: number; product_slug: string; question: string; answer: string };

ensureDatabaseUrl();

const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(sourceDir(), file), 'utf8')) as T;

const brandJson = read<BrandJson>('brand.json');
const seriesJson = read<SeriesJson[]>('product_series.json');
const productsJson = read<ProductJson[]>('products.json');
const scenariosJson = read<ScenarioJson[]>('scenarios.json');
const faqsJson = read<FaqJson[]>('faqs.json');

const prisma = new PrismaClient();

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[.,;:、\s]+$/, '')}…`;
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const warnings: string[] = [];

async function main() {
  await prisma.$transaction(async (tx) => {
    // ---- 清空（顺序遵循外键依赖）--------------------------------------
    await tx.knowledgeChunk.deleteMany();
    await tx.embeddingIndex.deleteMany();
    await tx.productFeature.deleteMany();
    await tx.productScenario.deleteMany();
    await tx.faq.deleteMany();
    await tx.product.deleteMany();
    await tx.productSeries.deleteMany();
    await tx.feature.deleteMany();
    await tx.scenario.deleteMany();
    await tx.brand.deleteMany();
    await tx.$executeRawUnsafe(
      `delete from sqlite_sequence where name in
       ('brand','product_series','product','feature','scenario','faq','knowledge_chunk','embedding_index')`,
    );

    // ---- 1. brand ------------------------------------------------------
    const brand = await tx.brand.create({
      data: {
        slug: brandJson.slug,
        name: brandJson.name,
        description: brandJson.description,
        website: brandJson.website,
        foundedYear: Number.parseInt(brandJson.founded, 10) || null,
        headquarters: brandJson.headquarters,
        coreCapabilities: JSON.stringify(brandJson.core_capabilities ?? []),
        metaTitle: `${brandJson.name} — AI video security for retail, warehouse and perimeter`,
        metaDescription: truncate(brandJson.description, 158),
      },
    });

    // ---- 2. product_series（meta 里带产品数量，故先算）-----------------
    for (const [i, s] of seriesJson.entries()) {
      const productCount = productsJson.filter((p) => p.series_slug === s.slug).length;
      await tx.productSeries.create({
        data: {
          brandId: brand.id,
          slug: s.slug,
          name: s.name,
          description: s.description,
          sortOrder: i,
          metaTitle: `${s.name} | ${brandJson.name}`,
          metaDescription: truncate(
            `${s.description} ${productCount} products. Compare specs, features and best-fit scenarios.`,
            158,
          ),
        },
      });
    }
    const seriesRows = await tx.productSeries.findMany({ select: { id: true, slug: true, name: true } });
    const seriesBySlug = new Map(seriesRows.map((s) => [s.slug, s]));

    // ---- 3. scenario：8 个官方场景 + best_for 反推补建 ------------------
    const scenarioByName = new Map<string, { id: number; slug: string; name: string }>();
    for (const [i, s] of scenariosJson.entries()) {
      const row = await tx.scenario.create({
        data: {
          slug: s.slug,
          name: s.name,
          description: s.description,
          isCanonical: true,
          sortOrder: i,
          metaTitle: `${s.name} video surveillance solutions | ${brandJson.name}`,
          metaDescription: truncate(s.description, 158),
        },
      });
      scenarioByName.set(s.name.toLowerCase(), row);
    }

    const derived: { id: number; slug: string; name: string }[] = [];
    for (const p of productsJson) {
      for (const name of p.best_for) {
        const key = name.toLowerCase();
        if (scenarioByName.has(key) || derived.some((d) => d.name.toLowerCase() === key)) continue;
        const row = await tx.scenario.create({
          data: {
            slug: slugify(name),
            name,
            description: null, // 源数据无描述，留待编辑补充
            isCanonical: false,
            sortOrder: 100 + derived.length,
            metaTitle: `${name} | ${brandJson.name}`,
            metaDescription: `${name}: AI video security products and deployment guidance from ${brandJson.name}.`,
          },
        });
        derived.push(row);
      }
    }
    const scenarioLookup = (name: string) =>
      scenarioByName.get(name.toLowerCase()) ?? derived.find((d) => d.name.toLowerCase() === name.toLowerCase());

    // ---- 4. feature 词表（key 与 ai 两类共用一张表）---------------------
    const featureByKey = new Map<string, { id: number }>();
    const featureSeq = { key: 0, ai: 0 };
    async function ensureFeature(name: string, kind: 'key' | 'ai') {
      const key = `${kind}:${slugify(name)}`;
      const hit = featureByKey.get(key);
      if (hit) return hit.id;
      const row = await tx.feature.create({
        data: { slug: slugify(name), name, kind, category: null, sortOrder: featureSeq[kind]++ },
      });
      featureByKey.set(key, row);
      return row.id;
    }

    // ---- 5. product + 关联 --------------------------------------------
    const productBySlug = new Map<string, { id: number; slug: string; name: string }>();
    const now = new Date();

    for (const [i, p] of productsJson.entries()) {
      const series = seriesBySlug.get(p.series_slug);
      if (!series) throw new Error(`产品 ${p.slug} 引用了不存在的系列 ${p.series_slug}`);

      // meta description 优先保证"一句话定位 + 适用场景"完整，放得下再追加核心特性
      const metaHead = `${p.short_description.replace(/\.$/, '')}. Best for ${p.best_for.slice(0, 2).join(', ')}.`;
      const metaFull = `${metaHead} Key features: ${p.key_features.slice(0, 2).join(', ')}.`;
      const metaDescription = metaFull.length <= 158 ? metaFull : truncate(metaHead, 158);

      if (p.specs?.resolution == null) {
        warnings.push(`${p.name} 的 specs.resolution 为 null（源数据缺失，已存 null）`);
      }

      const featureLinks = [];
      for (const [j, name] of p.key_features.entries()) {
        featureLinks.push({ featureId: await ensureFeature(name, 'key'), sortOrder: j });
      }
      for (const [j, name] of (p.specs?.ai_features ?? []).entries()) {
        featureLinks.push({ featureId: await ensureFeature(name, 'ai'), sortOrder: j });
      }

      const scenarioLinks = p.best_for.map((name, j) => {
        const scenario = scenarioLookup(name);
        if (!scenario) throw new Error(`场景 ${name} 未解析`);
        return { scenarioId: scenario.id, sortOrder: j };
      });

      const product = await tx.product.create({
        data: {
          brandId: brand.id,
          seriesId: series.id,
          legacyId: p.id,
          slug: p.slug,
          name: p.name,
          shortDescription: p.short_description,
          overview: p.overview,
          resolution: p.specs?.resolution ?? null,
          connectivity: p.specs?.connectivity ?? null,
          environment: p.specs?.environment ?? null,
          status: p.status ?? 'active',
          sortOrder: i,
          metaTitle: truncate(`${p.name} — ${series.name} | ${brandJson.name}`, 60),
          metaDescription,
          publishedAt: now,
          features: { create: featureLinks },
          scenarios: { create: scenarioLinks },
        },
      });
      productBySlug.set(p.slug, product);
    }

    // ---- 6. faq（排序取自 product.faq_ids，同时校验双向一致性）----------
    const faqOrder = new Map<number, number>();
    for (const p of productsJson) {
      p.faq_ids.forEach((legacyId, j) => faqOrder.set(legacyId, j));
      const actual = faqsJson.filter((f) => f.product_slug === p.slug).length;
      if (actual !== p.faq_ids.length) {
        warnings.push(`${p.name}: faq_ids ${p.faq_ids.length} 条，实际 FAQ ${actual} 条，不一致`);
      }
    }

    for (const f of faqsJson) {
      const product = productBySlug.get(f.product_slug);
      if (!product) throw new Error(`FAQ ${f.id} 指向不存在产品 ${f.product_slug}`);
      await tx.faq.create({
        data: {
          legacyId: f.id,
          brandId: brand.id,
          productId: product.id,
          scope: 'product',
          question: f.question,
          answer: f.answer,
          sortOrder: faqOrder.get(f.id) ?? 0,
          status: 'published',
        },
      });
    }
  });
}

main()
  .then(async () => {
    const counts = {
      brand: await prisma.brand.count(),
      product_series: await prisma.productSeries.count(),
      product: await prisma.product.count(),
      feature: await prisma.feature.count(),
      product_feature: await prisma.productFeature.count(),
      scenario: await prisma.scenario.count(),
      product_scenario: await prisma.productScenario.count(),
      faq: await prisma.faq.count(),
    };
    const canonical = await prisma.scenario.count({ where: { isCanonical: true } });
    const distinct = await prisma.$queryRaw<{ n: number }[]>`select count(distinct answer) as n from faq`;

    console.log('✓ 知识数据已灌入');
    console.table(counts);
    console.log(`  官方场景 ${canonical} 个，best_for 补建 ${counts.scenario - canonical} 个`);
    console.log(`  FAQ 答案去重后 ${Number(distinct[0]?.n ?? 0)} 条 / 共 ${counts.faq} 条（源数据模板化，同产品两问共用一段答案）`);
    if (warnings.length) {
      console.log('\n⚠ 数据体检：');
      for (const w of warnings) console.log(`  - ${w}`);
    }
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
