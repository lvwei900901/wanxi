/**
 * 知识索引器：内容 → 分块 → 向量 → 版本切换。
 *
 * 三条核心保证：
 *  1. 增量：按 content_hash 比对，只有内容变了的块才重新调 embedding；
 *  2. 一致性：新索引先以 building 状态写完，再在一个事务里切成 active，
 *     检索永远看不到半成品；构建失败则旧索引原样可用；
 *  3. 删除生效：内容里已不存在（下架/删稿）的块不会复制到新版本，自然消失。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IndexStatusDto, RevalidateNotifyDto } from '@kb/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { GlmService } from '../glm/glm.service';
import { SearchService } from '../search/search.service';
import { RevalidateService } from '../revalidate/revalidate.service';
import {
  TEMPLATE_VERSION,
  brandChunk,
  chunkKey,
  faqChunk,
  productOverviewChunk,
  productSpecChunk,
  scenarioChunk,
  seriesChunk,
  type ChunkDraft,
  type ProductInput,
} from './chunk/templates';

const CHUNK_SIZE = 600;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export type ReindexPlan = {
  activeVersion: number | null;
  total: number;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  fullRebuild: boolean;
  fullRebuildReason?: string;
};

export type ReindexResult = ReindexPlan & {
  version: number | null;
  durationMs: number;
  embeddedChunks: number;
  /** 重建后通知 web 失效 ISR 的结果；dryRun 恒为 null（没有新内容可失效） */
  revalidate: RevalidateNotifyDto | null;
};

export type ReindexOptions = {
  dryRun?: boolean;
  force?: boolean;
  reason?: string;
  log?: (message: string) => void;
};

@Injectable()
export class IndexService {
  private readonly logger = new Logger(IndexService.name);
  /** 串行队列：Strapi 连续保存会并发触发，两个 building 版本互踩会毁掉索引 */
  private queue: Promise<unknown> = Promise.resolve();

  // 显式 @Inject 令牌：CLI 用 tsx 跑源码，esbuild 不产出 emitDecoratorMetadata，
  // 只靠类型推断会拿到 undefined 依赖。写死令牌后 tsx 与 nest build 两条路径都能注入。
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GlmService) private readonly glm: GlmService,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(RevalidateService) private readonly revalidate: RevalidateService,
  ) {}

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async getStatus(): Promise<IndexStatusDto> {
    const active = await this.prisma.embeddingIndex.findFirst({
      where: { status: 'active' },
      orderBy: { id: 'desc' },
    });
    return {
      version: active?.id ?? null,
      model: active?.model ?? null,
      dimensions: active?.dimensions ?? null,
      chunkCount: active?.chunkCount ?? 0,
      builtAt: active?.builtAt.toISOString() ?? null,
      templateVersion: active?.templateVersion ?? null,
    };
  }

  /** 从库里读出全部内容，按模板生成分块集合 */
  async buildDrafts(): Promise<ChunkDraft[]> {
    const drafts: ChunkDraft[] = [];

    const brand = await this.prisma.brand.findFirst({ orderBy: { id: 'asc' } });
    if (brand) {
      let caps: string[] = [];
      try {
        const parsed: unknown = JSON.parse(brand.coreCapabilities);
        caps = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        caps = [];
      }
      drafts.push(
        brandChunk({
          id: brand.id,
          name: brand.name,
          description: brand.description,
          foundedYear: brand.foundedYear,
          headquarters: brand.headquarters,
          coreCapabilities: caps,
        }),
      );
    }

    const seriesList = await this.prisma.productSeries.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    for (const s of seriesList) {
      drafts.push(seriesChunk({ id: s.id, slug: s.slug, name: s.name, description: s.description }));
    }

    const scenarioList = await this.prisma.scenario.findMany({
      orderBy: [{ isCanonical: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    for (const s of scenarioList) {
      drafts.push(scenarioChunk({ id: s.id, slug: s.slug, name: s.name, description: s.description }));
    }

    const products = await this.prisma.product.findMany({
      where: { status: { not: 'discontinued' } },
      orderBy: [{ series: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        series: { select: { name: true } },
        features: {
          include: { feature: { select: { name: true, kind: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        scenarios: {
          include: { scenario: { select: { name: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    for (const p of products) {
      const input: ProductInput = {
        id: p.id,
        slug: p.slug,
        name: p.name,
        shortDescription: p.shortDescription,
        overview: p.overview,
        seriesName: p.series.name,
        keyFeatures: p.features.filter((f) => f.feature.kind === 'key').map((f) => f.feature.name),
        scenarioNames: p.scenarios.map((s) => s.scenario.name),
        resolution: p.resolution,
        connectivity: p.connectivity,
        environment: p.environment,
        aiFeatures: p.features.filter((f) => f.feature.kind === 'ai').map((f) => f.feature.name),
      };
      drafts.push(productOverviewChunk(input));
      drafts.push(productSpecChunk(input));
    }

    const faqs = await this.prisma.faq.findMany({
      where: { status: 'published', product: { status: { not: 'discontinued' } } },
      include: { product: { select: { slug: true } } },
      orderBy: { id: 'asc' },
    });
    for (const f of faqs) {
      drafts.push(
        faqChunk({
          id: f.id,
          question: f.question,
          answer: f.answer,
          productSlug: f.product?.slug ?? '',
        }),
      );
    }

    // 内容为空的块不索引：派生场景（如 Lobby）目前只有名字、没有描述，
    // 单独一条"只有标题"的向量既浪费 embedding 调用又会污染检索结果。
    return drafts.filter((d) => d.content.trim().length > 0);
  }

  private async activeIndex() {
    return this.prisma.embeddingIndex.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } });
  }

  async plan(): Promise<ReindexPlan> {
    const drafts = await this.buildDrafts();
    const active = await this.activeIndex();

    let fullRebuild = false;
    let reason: string | undefined;
    if (!active) {
      fullRebuild = true;
      reason = '还没有生效的索引';
    } else if (active.model !== this.glm.embedModel) {
      fullRebuild = true;
      reason = `模型变更：${active.model} → ${this.glm.embedModel}`;
    } else if (active.dimensions !== this.glm.embedDim) {
      fullRebuild = true;
      reason = `维度变更：${active.dimensions} → ${this.glm.embedDim}`;
    } else if (active.templateVersion !== TEMPLATE_VERSION) {
      fullRebuild = true;
      reason = `分块模板变更：v${active.templateVersion} → v${TEMPLATE_VERSION}`;
    }

    const prev = new Map<string, string>();
    if (active && !fullRebuild) {
      const rows = await this.prisma.knowledgeChunk.findMany({
        where: { indexVersion: active.id },
        select: { sourceType: true, sourceId: true, chunkIndex: true, contentHash: true },
      });
      for (const r of rows) prev.set(`${r.sourceType}:${r.sourceId}:${r.chunkIndex}`, r.contentHash);
    }

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    for (const draft of drafts) {
      const hash = prev.get(chunkKey(draft));
      if (hash === undefined) added += 1;
      else if (hash !== sha256(draft.content)) updated += 1;
      else unchanged += 1;
    }

    const draftKeys = new Set(drafts.map(chunkKey));
    const removed = [...prev.keys()].filter((k) => !draftKeys.has(k)).length;

    return {
      activeVersion: active?.id ?? null,
      total: drafts.length,
      added,
      updated,
      removed,
      unchanged,
      fullRebuild,
      fullRebuildReason: reason,
    };
  }

  async reindex(options: ReindexOptions = {}): Promise<ReindexResult> {
    return this.runExclusive(() => this.doReindex(options));
  }

  private async doReindex({ dryRun = false, force = false, reason, log = () => {} }: ReindexOptions): Promise<ReindexResult> {
    const started = Date.now();

    // 清理上次崩溃残留的 building 版本
    const stale = await this.prisma.embeddingIndex.findMany({ where: { status: 'building' }, select: { id: true } });
    for (const s of stale) {
      await this.prisma.knowledgeChunk.deleteMany({ where: { indexVersion: s.id } });
      await this.prisma.embeddingIndex.delete({ where: { id: s.id } });
    }

    const drafts = await this.buildDrafts();
    if (drafts.length === 0) throw new Error('没有可索引的内容，请先执行 npm run db:seed');

    const plan = await this.plan();
    const effective: ReindexPlan = force
      ? {
          ...plan,
          fullRebuild: true,
          fullRebuildReason: reason ?? '手动 force',
          added: plan.total,
          updated: 0,
          unchanged: 0,
          removed: 0,
        }
      : plan;

    log(
      `计划：共 ${plan.total} 块 · 新增 ${plan.added} · 变更 ${plan.updated} · 未变 ${plan.unchanged} · 待删除 ${plan.removed}` +
        (effective.fullRebuild ? `（全量：${effective.fullRebuildReason}）` : ''),
    );

    if (dryRun) {
      return {
        ...effective,
        version: null,
        durationMs: Date.now() - started,
        embeddedChunks: 0,
        revalidate: null,
      };
    }

    const active = await this.activeIndex();
    const prevRows = new Map<string, { id: number; contentHash: string }>();
    if (active && !effective.fullRebuild) {
      const rows = await this.prisma.knowledgeChunk.findMany({
        where: { indexVersion: active.id },
        select: { id: true, sourceType: true, sourceId: true, chunkIndex: true, contentHash: true },
      });
      for (const r of rows) {
        prevRows.set(`${r.sourceType}:${r.sourceId}:${r.chunkIndex}`, { id: r.id, contentHash: r.contentHash });
      }
    }

    const toEmbed: ChunkDraft[] = [];
    const toCopy: { draft: ChunkDraft; sourceId: number }[] = [];
    for (const draft of drafts) {
      const hit = prevRows.get(chunkKey(draft));
      if (effective.fullRebuild || !hit || hit.contentHash !== sha256(draft.content)) toEmbed.push(draft);
      else toCopy.push({ draft, sourceId: hit.id });
    }

    log(`向量化 ${toEmbed.length} 块，复用 ${toCopy.length} 块`);
    const vectors = toEmbed.length
      ? await this.glm.embed(
          toEmbed.map((d) => d.content),
          { onProgress: (done, total) => log(`  embedding ${done}/${total}`) },
        )
      : [];

    const builtAt = new Date();
    const documentCount = new Set(drafts.map((d) => `${d.sourceType}:${d.sourceId}`)).size;
    const sourceHash = sha256(drafts.map((d) => `${chunkKey(d)}@${sha256(d.content)}`).join('|'));

    // 复用块需要原样拷贝，含 BLOB
    const copySources = await this.prisma.knowledgeChunk.findMany({
      where: { id: { in: toCopy.map((c) => c.sourceId) } },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        chunkIndex: true,
        heading: true,
        content: true,
        urlPath: true,
        embedding: true,
      },
    });
    const copyById = new Map(copySources.map((r) => [r.id, r]));

    const versionId = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.embeddingIndex.create({
          data: {
            model: this.glm.embedModel,
            dimensions: this.glm.embedDim,
            chunkSize: CHUNK_SIZE,
            documentCount,
            chunkCount: 0,
            templateVersion: TEMPLATE_VERSION,
            status: 'building',
            builtAt,
            sourceFile: 'db',
            sourceHash,
          },
        });

        for (const { draft, sourceId } of toCopy) {
          const src = copyById.get(sourceId);
          if (!src) continue;
          await tx.knowledgeChunk.create({
            data: {
              externalId: chunkKey(draft),
              sourceType: draft.sourceType,
              sourceId: draft.sourceId,
              chunkIndex: draft.chunkIndex,
              heading: src.heading,
              content: src.content,
              urlPath: src.urlPath,
              embedding: src.embedding,
              model: this.glm.embedModel,
              dimensions: this.glm.embedDim,
              contentHash: sha256(src.content),
              indexVersion: created.id,
              templateVersion: TEMPLATE_VERSION,
              builtAt,
            },
          });
        }

        for (const [i, draft] of toEmbed.entries()) {
          const vec = vectors[i];
          // Prisma 的 Bytes 要 Uint8Array<ArrayBuffer>；Buffer 的 backing store 是可共享的，
          // 这里复制一份转成标准 Uint8Array，避免类型与共享内存两类问题
          const bytes = new Uint8Array(Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
          await tx.knowledgeChunk.create({
            data: {
              externalId: chunkKey(draft),
              sourceType: draft.sourceType,
              sourceId: draft.sourceId,
              chunkIndex: draft.chunkIndex,
              heading: draft.heading,
              content: draft.content,
              urlPath: draft.urlPath,
              embedding: bytes,
              model: this.glm.embedModel,
              dimensions: this.glm.embedDim,
              contentHash: sha256(draft.content),
              indexVersion: created.id,
              templateVersion: TEMPLATE_VERSION,
              builtAt,
            },
          });
        }

        await tx.embeddingIndex.update({
          where: { id: created.id },
          data: { chunkCount: drafts.length, status: 'active', activatedAt: builtAt },
        });
        await tx.embeddingIndex.updateMany({
          where: { status: 'active', id: { not: created.id } },
          data: { status: 'superseded' },
        });

        // 只保留 active + 上一版，其余历史版本连同向量一起清掉
        const keep = await tx.embeddingIndex.findMany({
          where: { status: { in: ['active', 'superseded'] } },
          orderBy: { id: 'desc' },
          take: 2,
          select: { id: true },
        });
        const keepIds = keep.map((k) => k.id);
        await tx.knowledgeChunk.deleteMany({ where: { indexVersion: { notIn: keepIds } } });
        await tx.embeddingIndex.deleteMany({
          where: { status: 'superseded', id: { notIn: keepIds } },
        });

        return created.id;
      },
      { timeout: 120_000, maxWait: 15_000 },
    );

    this.search.invalidate();
    this.logger.log(`索引 v${versionId} 已生效，重算 ${toEmbed.length} 块，耗时 ${Date.now() - started}ms`);

    /**
     * 事务提交之后再通知 web。
     *
     * 顺序不能反：web 收到失效后会立刻回源打 API，而那时代码读的是 active 索引。
     * 如果在事务里就发通知，页面可能抢在新版本切换前重新渲染，拿到的还是旧内容，
     * 而这一轮失效已经用掉了——页面就真的卡到下一个 300s。
     */
    const revalidate = await this.revalidate.notify();

    return {
      ...effective,
      version: versionId,
      durationMs: Date.now() - started,
      embeddedChunks: toEmbed.length,
      revalidate,
    };
  }
}
