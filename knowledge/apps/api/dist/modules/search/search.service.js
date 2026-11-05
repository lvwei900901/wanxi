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
var SearchService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const MIN_SCORE = 0.35;
let SearchService = SearchService_1 = class SearchService {
    prisma;
    logger = new common_1.Logger(SearchService_1.name);
    cache = null;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async onModuleInit() {
        try {
            await this.ensureLoaded();
        }
        catch (err) {
            this.logger.warn(`向量索引预载失败（AskAI 将走关键词降级）：${err.message}`);
        }
    }
    invalidate() {
        this.cache = null;
    }
    get versionId() {
        return this.cache?.versionId ?? null;
    }
    get chunkCount() {
        return this.cache?.rows.length ?? 0;
    }
    async activeVersion() {
        return this.prisma.embeddingIndex.findFirst({
            where: { status: 'active' },
            orderBy: { id: 'desc' },
            select: { id: true, dimensions: true },
        });
    }
    async ensureLoaded(force = false) {
        const active = await this.activeVersion();
        if (!active) {
            this.cache = null;
            return;
        }
        if (!force && this.cache?.versionId === active.id)
            return;
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
            for (let d = 0; d < dims; d += 1)
                sum += vec[d] * vec[d];
            norms[i] = Math.sqrt(sum) || 1;
        });
        this.cache = {
            versionId: active.id,
            rows: rows.map((row) => ({
                id: row.id,
                sourceType: row.sourceType,
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
    async search(query, topK = 4, minScore = MIN_SCORE) {
        await this.ensureLoaded();
        const cache = this.cache;
        if (!cache)
            return [];
        if (query.length !== cache.dims) {
            throw new Error(`查询向量维度 ${query.length} 与索引 ${cache.dims} 不一致，请用同一 embedding 模型`);
        }
        let qnorm = 0;
        for (let i = 0; i < query.length; i += 1)
            qnorm += query[i] * query[i];
        qnorm = Math.sqrt(qnorm) || 1;
        const scored = [];
        for (let row = 0; row < cache.rows.length; row += 1) {
            let dot = 0;
            const offset = row * cache.dims;
            for (let d = 0; d < cache.dims; d += 1)
                dot += query[d] * cache.matrix[offset + d];
            const score = dot / (qnorm * cache.norms[row]);
            if (score >= minScore)
                scored.push({ index: row, score });
        }
        scored.sort((a, b) => b.score - a.score);
        const seen = new Set();
        const hits = [];
        for (const item of scored) {
            const row = cache.rows[item.index];
            const key = `${row.sourceType}:${row.sourceId}`;
            if (seen.has(key))
                continue;
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
            if (hits.length >= topK)
                break;
        }
        return hits;
    }
    async keywordSearch(question, limit = 4) {
        const terms = question
            .replace(/[？?。，,！!、；;：:]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length >= 2)
            .slice(0, 6);
        if (terms.length === 0)
            return [];
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
            sourceType: 'product',
            sourceId: p.id,
            heading: p.name,
            content: p.overview ?? p.shortDescription ?? p.name,
            urlPath: `/products/${p.slug}`,
            score: 0,
        }));
    }
};
exports.SearchService = SearchService;
exports.SearchService = SearchService = SearchService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(prisma_service_1.PrismaService)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SearchService);
//# sourceMappingURL=search.service.js.map