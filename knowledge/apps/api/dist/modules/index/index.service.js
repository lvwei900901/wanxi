"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var IndexService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const prisma_service_1 = require("../../prisma/prisma.service");
const glm_service_1 = require("../glm/glm.service");
const search_service_1 = require("../search/search.service");
const revalidate_service_1 = require("../revalidate/revalidate.service");
const templates_1 = require("./chunk/templates");
const CHUNK_SIZE = 600;
const sha256 = (text) => (0, node_crypto_1.createHash)('sha256').update(text).digest('hex');
let IndexService = IndexService_1 = class IndexService {
    prisma;
    glm;
    search;
    revalidate;
    logger = new common_1.Logger(IndexService_1.name);
    queue = Promise.resolve();
    constructor(prisma, glm, search, revalidate) {
        this.prisma = prisma;
        this.glm = glm;
        this.search = search;
        this.revalidate = revalidate;
    }
    runExclusive(task) {
        const next = this.queue.then(task, task);
        this.queue = next.catch(() => undefined);
        return next;
    }
    async getStatus() {
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
    async buildDrafts() {
        const drafts = [];
        const brand = await this.prisma.brand.findFirst({ orderBy: { id: 'asc' } });
        if (brand) {
            let caps = [];
            try {
                const parsed = JSON.parse(brand.coreCapabilities);
                caps = Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
            }
            catch {
                caps = [];
            }
            drafts.push((0, templates_1.brandChunk)({
                id: brand.id,
                name: brand.name,
                description: brand.description,
                foundedYear: brand.foundedYear,
                headquarters: brand.headquarters,
                coreCapabilities: caps,
            }));
        }
        const seriesList = await this.prisma.productSeries.findMany({
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });
        for (const s of seriesList) {
            drafts.push((0, templates_1.seriesChunk)({ id: s.id, slug: s.slug, name: s.name, description: s.description }));
        }
        const scenarioList = await this.prisma.scenario.findMany({
            orderBy: [{ isCanonical: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
        });
        for (const s of scenarioList) {
            drafts.push((0, templates_1.scenarioChunk)({ id: s.id, slug: s.slug, name: s.name, description: s.description }));
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
            const input = {
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
            drafts.push((0, templates_1.productOverviewChunk)(input));
            drafts.push((0, templates_1.productSpecChunk)(input));
        }
        const faqs = await this.prisma.faq.findMany({
            where: { status: 'published', product: { status: { not: 'discontinued' } } },
            include: { product: { select: { slug: true } } },
            orderBy: { id: 'asc' },
        });
        for (const f of faqs) {
            drafts.push((0, templates_1.faqChunk)({
                id: f.id,
                question: f.question,
                answer: f.answer,
                productSlug: f.product?.slug ?? '',
            }));
        }
        return drafts.filter((d) => d.content.trim().length > 0);
    }
    async activeIndex() {
        return this.prisma.embeddingIndex.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } });
    }
    async plan() {
        const drafts = await this.buildDrafts();
        const active = await this.activeIndex();
        let fullRebuild = false;
        let reason;
        if (!active) {
            fullRebuild = true;
            reason = '还没有生效的索引';
        }
        else if (active.model !== this.glm.embedModel) {
            fullRebuild = true;
            reason = `模型变更：${active.model} → ${this.glm.embedModel}`;
        }
        else if (active.dimensions !== this.glm.embedDim) {
            fullRebuild = true;
            reason = `维度变更：${active.dimensions} → ${this.glm.embedDim}`;
        }
        else if (active.templateVersion !== templates_1.TEMPLATE_VERSION) {
            fullRebuild = true;
            reason = `分块模板变更：v${active.templateVersion} → v${templates_1.TEMPLATE_VERSION}`;
        }
        const prev = new Map();
        if (active && !fullRebuild) {
            const rows = await this.prisma.knowledgeChunk.findMany({
                where: { indexVersion: active.id },
                select: { sourceType: true, sourceId: true, chunkIndex: true, contentHash: true },
            });
            for (const r of rows)
                prev.set(`${r.sourceType}:${r.sourceId}:${r.chunkIndex}`, r.contentHash);
        }
        let added = 0;
        let updated = 0;
        let unchanged = 0;
        for (const draft of drafts) {
            const hash = prev.get((0, templates_1.chunkKey)(draft));
            if (hash === undefined)
                added += 1;
            else if (hash !== sha256(draft.content))
                updated += 1;
            else
                unchanged += 1;
        }
        const draftKeys = new Set(drafts.map(templates_1.chunkKey));
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
    async reindex(options = {}) {
        return this.runExclusive(() => this.doReindex(options));
    }
    async doReindex({ dryRun = false, force = false, reason, log = () => { } }) {
        const started = Date.now();
        const stale = await this.prisma.embeddingIndex.findMany({ where: { status: 'building' }, select: { id: true } });
        for (const s of stale) {
            await this.prisma.knowledgeChunk.deleteMany({ where: { indexVersion: s.id } });
            await this.prisma.embeddingIndex.delete({ where: { id: s.id } });
        }
        const drafts = await this.buildDrafts();
        if (drafts.length === 0)
            throw new Error('没有可索引的内容，请先执行 npm run db:seed');
        const plan = await this.plan();
        const effective = force
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
        log(`计划：共 ${plan.total} 块 · 新增 ${plan.added} · 变更 ${plan.updated} · 未变 ${plan.unchanged} · 待删除 ${plan.removed}` +
            (effective.fullRebuild ? `（全量：${effective.fullRebuildReason}）` : ''));
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
        const prevRows = new Map();
        if (active && !effective.fullRebuild) {
            const rows = await this.prisma.knowledgeChunk.findMany({
                where: { indexVersion: active.id },
                select: { id: true, sourceType: true, sourceId: true, chunkIndex: true, contentHash: true },
            });
            for (const r of rows) {
                prevRows.set(`${r.sourceType}:${r.sourceId}:${r.chunkIndex}`, { id: r.id, contentHash: r.contentHash });
            }
        }
        const toEmbed = [];
        const toCopy = [];
        for (const draft of drafts) {
            const hit = prevRows.get((0, templates_1.chunkKey)(draft));
            if (effective.fullRebuild || !hit || hit.contentHash !== sha256(draft.content))
                toEmbed.push(draft);
            else
                toCopy.push({ draft, sourceId: hit.id });
        }
        log(`向量化 ${toEmbed.length} 块，复用 ${toCopy.length} 块`);
        const vectors = toEmbed.length
            ? await this.glm.embed(toEmbed.map((d) => d.content), { onProgress: (done, total) => log(`  embedding ${done}/${total}`) })
            : [];
        const builtAt = new Date();
        const documentCount = new Set(drafts.map((d) => `${d.sourceType}:${d.sourceId}`)).size;
        const sourceHash = sha256(drafts.map((d) => `${(0, templates_1.chunkKey)(d)}@${sha256(d.content)}`).join('|'));
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
        const versionId = await this.prisma.$transaction(async (tx) => {
            const created = await tx.embeddingIndex.create({
                data: {
                    model: this.glm.embedModel,
                    dimensions: this.glm.embedDim,
                    chunkSize: CHUNK_SIZE,
                    documentCount,
                    chunkCount: 0,
                    templateVersion: templates_1.TEMPLATE_VERSION,
                    status: 'building',
                    builtAt,
                    sourceFile: 'db',
                    sourceHash,
                },
            });
            for (const { draft, sourceId } of toCopy) {
                const src = copyById.get(sourceId);
                if (!src)
                    continue;
                await tx.knowledgeChunk.create({
                    data: {
                        externalId: (0, templates_1.chunkKey)(draft),
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
                        templateVersion: templates_1.TEMPLATE_VERSION,
                        builtAt,
                    },
                });
            }
            for (const [i, draft] of toEmbed.entries()) {
                const vec = vectors[i];
                const bytes = new Uint8Array(Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
                await tx.knowledgeChunk.create({
                    data: {
                        externalId: (0, templates_1.chunkKey)(draft),
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
                        templateVersion: templates_1.TEMPLATE_VERSION,
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
        }, { timeout: 120_000, maxWait: 15_000 });
        this.search.invalidate();
        this.logger.log(`索引 v${versionId} 已生效，重算 ${toEmbed.length} 块，耗时 ${Date.now() - started}ms`);
        const revalidate = await this.revalidate.notify();
        return {
            ...effective,
            version: versionId,
            durationMs: Date.now() - started,
            embeddedChunks: toEmbed.length,
            revalidate,
        };
    }
};
exports.IndexService = IndexService;
exports.IndexService = IndexService = IndexService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(prisma_service_1.PrismaService)),
    __param(1, (0, common_1.Inject)(glm_service_1.GlmService)),
    __param(2, (0, common_1.Inject)(search_service_1.SearchService)),
    __param(3, (0, common_1.Inject)(revalidate_service_1.RevalidateService)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        glm_service_1.GlmService,
        search_service_1.SearchService,
        revalidate_service_1.RevalidateService])
], IndexService);
//# sourceMappingURL=index.service.js.map