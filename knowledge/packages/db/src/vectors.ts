/**
 * 导入 GLM embedding-3 向量文件（data/source/index.json）到 knowledge_chunk。
 *
 * 向量文件只带 chunk 的 source（文件名）+ heading（标题），
 * 所以这里按 heading 反查实体，把多态引用补成 source_type + source_id + url_path，
 * 检索命中后就能直接回链到对应页面。
 *
 * 注意：这是"首次播种"路径。日常更新走 npm run kb:reindex（content_hash 增量 + 蓝绿切换）。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { ensureDatabaseUrl, vectorFile } from './db-path.js';

const TEMPLATE_VERSION = 1;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

type VectorFile = {
  meta: {
    embedModel: string;
    dimension: number;
    chunkSize: number;
    documentCount: number;
    chunkCount: number;
    builtAt?: string;
  };
  chunks: { id: string; source: string; heading: string | null; text: string; vector: number[] }[];
};

ensureDatabaseUrl();
const prisma = new PrismaClient();

const file = vectorFile();
const raw = readFileSync(file, 'utf8');
const { meta, chunks } = JSON.parse(raw) as VectorFile;

if (!Array.isArray(chunks) || chunks.length === 0) throw new Error('向量文件里没有 chunks');
if (!meta?.dimension) throw new Error('向量文件缺少 meta.dimension');

const dimensions = meta.dimension;

async function resolveMaps() {
  const brand = await prisma.brand.findFirst({ select: { id: true, slug: true } });
  if (!brand) throw new Error('数据库里没有品牌，请先执行 npm run db:seed');

  const series = await prisma.productSeries.findMany({ select: { id: true, slug: true, name: true } });
  const products = await prisma.product.findMany({ select: { id: true, slug: true, name: true } });
  const scenarios = await prisma.scenario.findMany({ select: { id: true, slug: true, name: true } });
  const faqs = await prisma.faq.findMany({ select: { id: true, question: true, productId: true } });

  return {
    brand,
    seriesByName: new Map(series.map((s) => [s.name.toLowerCase(), s])),
    productByName: new Map(products.map((p) => [p.name.toLowerCase(), p])),
    productById: new Map(products.map((p) => [p.id, p])),
    scenarioByName: new Map(scenarios.map((s) => [s.name.toLowerCase(), s])),
    faqByQuestion: new Map(faqs.map((f) => [f.question.trim().toLowerCase(), f])),
  };
}

type Maps = Awaited<ReturnType<typeof resolveMaps>>;

type Target = { sourceType: string; sourceId: number; urlPath: string; index: number };

function resolve(chunk: VectorFile['chunks'][number], maps: Maps): Target | null {
  const doc = chunk.source.replace(/\.json$/, '');
  const heading = (chunk.heading ?? '').trim();

  if (doc === 'brand') {
    return { sourceType: 'brand', sourceId: maps.brand.id, urlPath: '/', index: 0 };
  }
  if (doc === 'product_series') {
    const s = maps.seriesByName.get(heading.toLowerCase());
    return s ? { sourceType: 'series', sourceId: s.id, urlPath: `/series/${s.slug}`, index: 0 } : null;
  }
  if (doc === 'products') {
    // heading 形如 "Nova X4" 或 "Nova X4 · 规格参数"
    const [name, section] = heading.split('·').map((x) => x.trim());
    const p = maps.productByName.get(name.toLowerCase());
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
    const s = maps.scenarioByName.get(heading.toLowerCase());
    return s ? { sourceType: 'scenario', sourceId: s.id, urlPath: `/scenarios/${s.slug}`, index: 0 } : null;
  }
  if (doc === 'faqs') {
    const f = maps.faqByQuestion.get(heading.toLowerCase());
    if (!f) return null;
    const p = f.productId ? maps.productById.get(f.productId) : undefined;
    return { sourceType: 'faq', sourceId: f.id, urlPath: `/products/${p?.slug ?? ''}#faq`, index: 0 };
  }
  return null;
}

async function main() {
  const maps = await resolveMaps();
  const builtAt = new Date(meta.builtAt ?? Date.now());

  await prisma.knowledgeChunk.deleteMany();
  await prisma.embeddingIndex.deleteMany();
  await prisma.$executeRawUnsafe(
    `delete from sqlite_sequence where name in ('knowledge_chunk','embedding_index')`,
  );

  // 先建版本行（building），灌完再切 active —— 与 kb:reindex 的流程保持一致
  const version = await prisma.embeddingIndex.create({
    data: {
      model: meta.embedModel,
      dimensions,
      chunkSize: meta.chunkSize,
      documentCount: meta.documentCount,
      chunkCount: 0,
      templateVersion: TEMPLATE_VERSION,
      status: 'building',
      builtAt,
      sourceFile: file,
      sourceHash: sha256(raw),
    },
  });

  let bytes = 0;
  const unmapped: string[] = [];

  await prisma.$transaction(
    async (tx) => {
      for (const chunk of chunks) {
        if (chunk.vector.length !== dimensions) {
          throw new Error(`chunk ${chunk.id} 维度为 ${chunk.vector.length}，与 meta.dimension ${dimensions} 不一致`);
        }
        const target = resolve(chunk, maps);
        if (!target) {
          unmapped.push(`${chunk.id} (${chunk.source} / ${chunk.heading})`);
          continue;
        }
        const f32 = Float32Array.from(chunk.vector);
        const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
        bytes += buf.length;

        await tx.knowledgeChunk.create({
          data: {
            externalId: `${target.sourceType}:${target.sourceId}:${target.index}`,
            sourceType: target.sourceType,
            sourceId: target.sourceId,
            chunkIndex: target.index,
            heading: chunk.heading ?? null,
            content: chunk.text,
            urlPath: target.urlPath,
            embedding: buf,
            model: meta.embedModel,
            dimensions,
            contentHash: sha256(chunk.text),
            indexVersion: version.id,
            templateVersion: TEMPLATE_VERSION,
            builtAt,
          },
        });
      }

      if (unmapped.length) {
        throw new Error(`${unmapped.length} 条 chunk 无法映射到实体：\n  ${unmapped.join('\n  ')}`);
      }

      await tx.embeddingIndex.update({
        where: { id: version.id },
        data: { chunkCount: chunks.length, status: 'active', activatedAt: builtAt },
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const bySource = await prisma.knowledgeChunk.groupBy({
    by: ['sourceType'],
    _count: { _all: true },
  });

  console.log(
    `✓ 向量已导入：${chunks.length} 条 · ${dimensions} 维 · ${(bytes / 1024 / 1024).toFixed(2)} MB · 索引 v${version.id}`,
  );
  console.table(bySource.map((r) => ({ source_type: r.sourceType, n: r._count._all })));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
