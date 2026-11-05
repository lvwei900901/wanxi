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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const cardInclude = client_1.Prisma.validator()({
    series: { select: { slug: true, name: true } },
    features: {
        include: { feature: { select: { name: true, kind: true } } },
        orderBy: { sortOrder: 'asc' },
    },
    scenarios: {
        include: { scenario: { select: { slug: true, name: true } } },
        orderBy: { sortOrder: 'asc' },
    },
});
let ContentService = class ContentService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getIndexVersion() {
        const row = await this.prisma.embeddingIndex.findFirst({
            where: { status: 'active' },
            orderBy: { id: 'desc' },
            select: { id: true },
        });
        return row?.id ?? null;
    }
    async meta(total) {
        return {
            total,
            indexVersion: await this.getIndexVersion(),
            generatedAt: new Date().toISOString(),
        };
    }
    async getBrand() {
        const row = await this.prisma.brand.findFirst({ orderBy: { id: 'asc' } });
        if (!row)
            return null;
        return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            description: row.description,
            website: row.website,
            foundedYear: row.foundedYear,
            headquarters: row.headquarters,
            coreCapabilities: this.parseArray(row.coreCapabilities),
            logoUrl: row.logoUrl,
            ogImageUrl: row.ogImageUrl,
            metaTitle: row.metaTitle,
            metaDescription: row.metaDescription,
            canonicalUrl: row.canonicalUrl,
        };
    }
    async listSeries() {
        const rows = await this.prisma.productSeries.findMany({
            orderBy: { sortOrder: 'asc' },
            include: {
                _count: { select: { products: { where: { status: { not: 'discontinued' } } } } },
            },
        });
        return rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            description: row.description,
            productCount: row._count.products,
            metaTitle: row.metaTitle,
            metaDescription: row.metaDescription,
            canonicalUrl: row.canonicalUrl,
        }));
    }
    async getSeries(slug) {
        const rows = await this.listSeries();
        return rows.find((s) => s.slug === slug) ?? null;
    }
    async listScenarios() {
        const rows = await this.prisma.scenario.findMany({
            orderBy: [{ isCanonical: 'desc' }, { sortOrder: 'asc' }],
            include: {
                _count: {
                    select: { products: { where: { product: { status: { not: 'discontinued' } } } } },
                },
            },
        });
        return rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            description: row.description,
            isCanonical: row.isCanonical,
            productCount: row._count.products,
            metaTitle: row.metaTitle,
            metaDescription: row.metaDescription,
        }));
    }
    async getScenario(slug) {
        const rows = await this.listScenarios();
        return rows.find((s) => s.slug === slug) ?? null;
    }
    async listProducts(filter = {}) {
        const where = {
            status: filter.includeBeta === false ? 'active' : { not: 'discontinued' },
        };
        if (filter.seriesSlug)
            where.series = { slug: filter.seriesSlug };
        if (filter.scenarioSlug)
            where.scenarios = { some: { scenario: { slug: filter.scenarioSlug } } };
        if (filter.q) {
            where.OR = [
                { name: { contains: filter.q } },
                { shortDescription: { contains: filter.q } },
                { overview: { contains: filter.q } },
            ];
        }
        const rows = await this.prisma.product.findMany({
            where,
            orderBy: [{ series: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
            include: cardInclude,
        });
        return rows.map((row) => this.toCard(row));
    }
    async getProduct(slug) {
        const row = await this.prisma.product.findUnique({
            where: { slug },
            include: {
                ...cardInclude,
                brand: { select: { name: true, slug: true, website: true } },
                faqs: {
                    where: { status: 'published' },
                    orderBy: { sortOrder: 'asc' },
                    select: {
                        id: true,
                        question: true,
                        answer: true,
                        answerSummary: true,
                        scope: true,
                        sortOrder: true,
                    },
                },
            },
        });
        if (!row)
            return null;
        const card = this.toCard(row);
        return {
            ...card,
            overview: row.overview,
            connectivity: row.connectivity,
            environment: row.environment,
            extraSpecs: this.parseObject(row.extraSpecs),
            aiFeatures: row.features.filter((f) => f.feature.kind === 'ai').map((f) => f.feature.name),
            faqs: row.faqs.map((f) => this.toFaq(f)),
            imageUrl: row.imageUrl,
            ogImageUrl: row.ogImageUrl,
            canonicalUrl: row.canonicalUrl,
            publishedAt: row.publishedAt?.toISOString() ?? null,
            brand: { name: row.brand.name, slug: row.brand.slug, website: row.brand.website },
        };
    }
    async listFaqs(scope, refSlug) {
        const where = { scope, status: 'published' };
        if (scope === 'series' && refSlug)
            where.series = { slug: refSlug };
        if (scope === 'scenario' && refSlug)
            where.scenario = { slug: refSlug };
        const rows = await this.prisma.faq.findMany({ where, orderBy: { sortOrder: 'asc' } });
        return rows.map((row) => this.toFaq(row));
    }
    async getStats() {
        const indexVersion = await this.getIndexVersion();
        const [products, series, scenarios, faqs, chunks] = await Promise.all([
            this.prisma.product.count({ where: { status: { not: 'discontinued' } } }),
            this.prisma.productSeries.count(),
            this.prisma.scenario.count(),
            this.prisma.faq.count(),
            indexVersion ? this.prisma.knowledgeChunk.count({ where: { indexVersion } }) : Promise.resolve(0),
        ]);
        return { products, series, scenarios, faqs, chunks };
    }
    async getSitemap() {
        const [products, series, scenarios] = await Promise.all([
            this.prisma.product.findMany({
                where: { status: { not: 'discontinued' } },
                select: { slug: true, updatedAt: true },
            }),
            this.prisma.productSeries.findMany({ select: { slug: true, updatedAt: true } }),
            this.prisma.scenario.findMany({ select: { slug: true, updatedAt: true } }),
        ]);
        const entries = [
            { path: '/', lastmod: null, changefreq: 'weekly', priority: 1 },
            { path: '/products', lastmod: null, changefreq: 'weekly', priority: 0.9 },
            { path: '/ask', lastmod: null, changefreq: 'monthly', priority: 0.6 },
        ];
        for (const p of products) {
            entries.push({
                path: `/products/${p.slug}`,
                lastmod: p.updatedAt.toISOString(),
                changefreq: 'monthly',
                priority: 0.8,
            });
        }
        for (const s of series) {
            entries.push({
                path: `/series/${s.slug}`,
                lastmod: s.updatedAt.toISOString(),
                changefreq: 'monthly',
                priority: 0.7,
            });
        }
        for (const s of scenarios) {
            entries.push({
                path: `/scenarios/${s.slug}`,
                lastmod: s.updatedAt.toISOString(),
                changefreq: 'monthly',
                priority: 0.6,
            });
        }
        return entries;
    }
    toCard(row) {
        return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            shortDescription: row.shortDescription,
            status: row.status,
            series: { slug: row.series.slug, name: row.series.name },
            keyFeatures: row.features.filter((f) => f.feature.kind === 'key').map((f) => f.feature.name),
            scenarios: row.scenarios.map((s) => ({ slug: s.scenario.slug, name: s.scenario.name })),
            resolution: row.resolution,
            connectivity: row.connectivity,
            environment: row.environment,
            metaTitle: row.metaTitle,
            metaDescription: row.metaDescription,
        };
    }
    toFaq(row) {
        return {
            id: row.id,
            question: row.question,
            answer: row.answer,
            answerSummary: row.answerSummary,
            scope: row.scope,
            sortOrder: row.sortOrder,
        };
    }
    parseArray(raw) {
        if (!raw)
            return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
        }
        catch {
            return [];
        }
    }
    parseObject(raw) {
        if (!raw)
            return null;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : null;
        }
        catch {
            return null;
        }
    }
};
exports.ContentService = ContentService;
exports.ContentService = ContentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ContentService);
//# sourceMappingURL=content.service.js.map