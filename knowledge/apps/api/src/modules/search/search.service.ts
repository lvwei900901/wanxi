import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { SourceType } from '@kb/contracts';
import { PrismaService } from '../../prisma/prisma.service';

export type SearchHit = {
  chunkId: number;
  sourceType: SourceType;
  sourceId: number | null;
  heading: string | null;
  content: string;
  urlPath: string | null;
  score: number;
};

const MIN_SCORE = 0.35;

/**
 * 向量检索：把 active 版本的全部块载入内存做暴力余弦。
 *
 * 94 块 × 2048 维 ≈ 0.77MB，一次点积 19 万次乘加，单次检索毫秒级；
 * 数据量再涨一个数量级之前不需要 sqlite-vec。缓存以 indexVersion 为键，
 * 重建成功后自然失效，不需要重启进程。
 */
@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);

  private cache: {
    versionId: number;
    rows: { id: number; sourceType: SourceType; sourceId: number | null; heading: string | null; content: string; urlPath: string | null }[];
    matrix: Float32Array;
    norms: Float32Array;
    dims: number;
  } | null = null;

  // 显式令牌：CLI 走 tsx（esbuild 无 decorator metadata），类型推断拿不到依赖
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureLoaded();
    } catch (err) {
      this.logger.warn(`向量索引预载失败（AskAI 将走关键词降级）：${(err as Error).message}`);
    }
  }

  invalidate(): void {
    this.cache = null;
  }

  get versionId(): number | null {
    return this.cache?.versionId ?? null;
  }

  get chunkCount(): number {
    return this.cache?.rows.length ?? 0;
  }

  private async activeVersion(): Promise<{ id: number; dimensions: number } | null> {
    return this.prisma.embeddingIndex.findFirst({
      where: { status: 'active' },
      orderBy: { id: 'desc' },
      select: { id: true, dimensions: true },
    });
  }

  async ensureLoaded(force = false): Promise<void> {
    const active = await this.activeVersion();
    if (!active) {
      this.cache = null;
      return;
    }
    if (!force && this.cache?.versionId === active.id) return;

    const rows = await this.prisma.knowledgeChunk.findMany({
      where: { indexVersion: active.id },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        heading: true,
        content: true,
        urlPath: true,
        embedding: true,
      },
      orderBy: { id: 'asc' },
    });

    const dims = active.dimensions;
    const matrix = new Float32Array(rows.length * dims);
    const norms = new Float32Array(rows.length);

    rows.forEach((row, i) => {
      const bytes = new Uint8Array(row.embedding);
      const vec = new Float32Array(bytes.buffer, 0, dims);
      matrix.set(vec, i * dims);
      let sum = 0;
      for (let d = 0; d < dims; d += 1) sum += vec[d] * vec[d];
      norms[i] = Math.sqrt(sum) || 1;
    });

    this.cache = {
      versionId: active.id,
      rows: rows.map((row) => ({
        id: row.id,
        sourceType: row.sourceType as SourceType,
        sourceId: row.sourceId,
        heading: row.heading,
        content: row.content,
        urlPath: row.urlPath,
      })),
      matrix,
      norms,
      dims,
    };
    this.logger.log(`已载入索引 v${active.id}：${rows.length} 块 × ${dims} 维`);
  }

  /** 使用已归一化的查询向量做余弦检索；分数低于阈值的直接丢弃 */
  async search(query: Float32Array, topK = 4, minScore = MIN_SCORE): Promise<SearchHit[]> {
    await this.ensureLoaded();
    const cache = this.cache;
    if (!cache) return [];
    if (query.length !== cache.dims) {
      throw new Error(`查询向量维度 ${query.length} 与索引 ${cache.dims} 不一致，请用同一 embedding 模型`);
    }

    let qnorm = 0;
    for (let i = 0; i < query.length; i += 1) qnorm += query[i] * query[i];
    qnorm = Math.sqrt(qnorm) || 1;

    const scored: { index: number; score: number }[] = [];
    for (let row = 0; row < cache.rows.length; row += 1) {
      let dot = 0;
      const offset = row * cache.dims;
      for (let d = 0; d < cache.dims; d += 1) dot += query[d] * cache.matrix[offset + d];
      const score = dot / (qnorm * cache.norms[row]);
      if (score >= minScore) scored.push({ index: row, score });
    }

    scored.sort((a, b) => b.score - a.score);

    // 同一实体只保留得分最高的块，避免一个产品占满全部引用位
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const item of scored) {
      const row = cache.rows[item.index];
      const key = `${row.sourceType}:${row.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        chunkId: row.id,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        heading: row.heading,
        content: row.content,
        urlPath: row.urlPath,
        score: Number(item.score.toFixed(4)),
      });
      if (hits.length >= topK) break;
    }
    return hits;
  }

  /**
   * 关键词兜底：没有 API key 或 embedding 不可用时使用。
   * 只覆盖产品名/简介/概述与 FAQ 正文，质量明显低于向量检索，因此调用方要标注 degraded。
   */
  async keywordSearch(question: string, limit = 4): Promise<SearchHit[]> {
    const terms = question
      .replace(/[？?。，,！!、；;：:]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .slice(0, 6);
    if (terms.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: {
        status: { not: 'discontinued' },
        OR: terms.flatMap((t) => [
          { name: { contains: t } },
          { shortDescription: { contains: t } },
          { overview: { contains: t } },
        ]),
      },
      select: { id: true, slug: true, name: true, overview: true, shortDescription: true },
      take: limit,
    });

    return products.map((p) => ({
      chunkId: 0,
      sourceType: 'product' as SourceType,
      sourceId: p.id,
      heading: p.name,
      content: p.overview ?? p.shortDescription ?? p.name,
      urlPath: `/products/${p.slug}`,
      score: 0,
    }));
  }
}
