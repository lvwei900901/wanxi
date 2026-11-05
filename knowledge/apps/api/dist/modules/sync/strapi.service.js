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
var StrapiSyncService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrapiSyncService = void 0;
exports.flatten = flatten;
exports.unwrapList = unwrapList;
exports.flattenList = flattenList;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function flatten(node) {
    if (!isObject(node))
        return null;
    if ('attributes' in node && isObject(node.attributes)) {
        return { id: node.id, documentId: node.documentId, ...flatten(node.attributes) };
    }
    if ('data' in node && node.data !== undefined) {
        if (Array.isArray(node.data))
            return node;
        return flatten(node.data);
    }
    return node;
}
function unwrapList(value) {
    if (value === null || value === undefined)
        return [];
    if (Array.isArray(value))
        return value;
    if (isObject(value) && 'data' in value)
        return unwrapList(value.data);
    return [value];
}
function flattenList(node) {
    if (node === null || node === undefined)
        return [];
    if (Array.isArray(node))
        return node.map(flatten).filter((v) => v !== null);
    const one = flatten(node);
    return one ? [one] : [];
}
const str = (v) => {
    if (typeof v === 'string') {
        const t = v.trim();
        return t.length > 0 ? t : null;
    }
    if (typeof v === 'number')
        return String(v);
    return null;
};
const num = (v) => {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v);
    return null;
};
const list = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);
function pick(obj, keys, read) {
    for (const key of keys) {
        const value = read(obj[key]);
        if (value !== null)
            return value;
    }
    return null;
}
const nameToSlug = (value) => {
    const text = str(value);
    return text ? slugify(text) : null;
};
const slugify = (text) => text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
function refSlugs(value) {
    return unwrapList(value)
        .map((item) => {
        if (typeof item === 'string')
            return item.trim() || null;
        const obj = flatten(item);
        if (!obj)
            return null;
        return str(obj.slug) ?? nameToSlug(obj.name);
    })
        .filter((v) => typeof v === 'string' && v.length > 0);
}
function refSlug(value) {
    const obj = flatten(value);
    if (obj)
        return str(obj.slug) ?? nameToSlug(obj.name);
    return str(value);
}
const emptyCounters = (collection) => ({
    collection,
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
});
class Patch {
    strict;
    data = {};
    constructor(strict) {
        this.strict = strict;
    }
    set(key, value, fallback) {
        if (value !== null && value !== undefined) {
            this.data[key] = value;
            return this;
        }
        if (!this.strict)
            return this;
        this.data[key] = fallback !== undefined ? fallback : null;
        return this;
    }
    force(key, value) {
        this.data[key] = value;
        return this;
    }
    build() {
        return this.data;
    }
}
let StrapiSyncService = StrapiSyncService_1 = class StrapiSyncService {
    prisma;
    logger = new common_1.Logger(StrapiSyncService_1.name);
    routeCache = new Map();
    constructor(prisma) {
        this.prisma = prisma;
    }
    async sync({ dryRun = false, mode = 'merge', prune = false } = {}) {
        const started = Date.now();
        const strict = mode === 'mirror';
        const rawUrl = process.env.STRAPI_URL?.trim();
        if (!rawUrl) {
            throw new common_1.HttpException('未配置 STRAPI_URL，无法从 Strapi 同步内容（见 apps/api/.env）', common_1.HttpStatus.SERVICE_UNAVAILABLE);
        }
        const baseUrl = rawUrl.replace(/\/+$/, '');
        const token = process.env.STRAPI_TOKEN?.trim() ?? '';
        const [brandRows, seriesRows, scenarioRows, productRows, faqRows] = await Promise.all([
            this.fetchAll(baseUrl, token, 'brand'),
            this.fetchAll(baseUrl, token, 'product-series'),
            this.fetchAll(baseUrl, token, 'scenario'),
            this.fetchAll(baseUrl, token, 'product'),
            this.fetchAll(baseUrl, token, 'faq'),
        ]);
        const tables = [];
        const warnings = [];
        const apply = async (tx) => {
            const db = tx;
            const brandTable = emptyCounters('brand');
            brandTable.fetched = brandRows.length;
            const brandRaw = brandRows[0] ? flatten(brandRows[0]) : null;
            let brandId = 0;
            if (!brandRaw) {
                brandTable.skipped = brandRows.length || 1;
                warnings.push('Strapi 里没有 brand 记录：系列与产品无法挂载，已全部跳过');
            }
            else {
                const slug = str(brandRaw.slug) ?? slugify(str(brandRaw.name) ?? 'brand');
                const existing = await db.brand.findUnique({ where: { slug }, select: { id: true } });
                const capabilities = list(brandRaw.coreCapabilities ?? brandRaw.core_capabilities)
                    .map((v) => str(v))
                    .filter((v) => v !== null);
                const data = new Patch(strict)
                    .set('name', str(brandRaw.name) ?? slug)
                    .set('description', str(brandRaw.description))
                    .set('website', str(brandRaw.website))
                    .set('foundedYear', num(brandRaw.foundedYear ?? brandRaw.founded_year ?? brandRaw.founded))
                    .set('headquarters', str(brandRaw.headquarters))
                    .set('coreCapabilities', capabilities.length > 0 ? JSON.stringify(capabilities) : null, '[]')
                    .build();
                if (existing)
                    brandTable.updated += 1;
                else
                    brandTable.created += 1;
                if (!dryRun) {
                    const row = existing
                        ? await db.brand.update({ where: { id: existing.id }, data })
                        : await db.brand.create({ data: { slug, ...data } });
                    brandId = row.id;
                }
                else {
                    brandId = existing?.id ?? 0;
                }
            }
            tables.push(brandTable);
            const seriesTable = emptyCounters('product-series');
            seriesTable.fetched = seriesRows.length;
            const seriesIdBySlug = new Map();
            for (const [i, raw] of seriesRows.entries()) {
                const row = flatten(raw);
                if (!row) {
                    seriesTable.skipped += 1;
                    continue;
                }
                if (row.publishedAt === null) {
                    seriesTable.skipped += 1;
                    warnings.push(`系列 ${str(row.slug) ?? i} 是草稿（publishedAt=null），已跳过`);
                    continue;
                }
                const slug = str(row.slug) ?? slugify(str(row.name) ?? '');
                if (!slug) {
                    seriesTable.skipped += 1;
                    continue;
                }
                if (!brandId) {
                    seriesTable.skipped += 1;
                    continue;
                }
                const data = new Patch(strict)
                    .force('name', str(row.name) ?? slug)
                    .set('description', str(row.description))
                    .set('sortOrder', num(row.sortOrder ?? row.sort_order), i)
                    .set('status', str(row.lifecycleStatus ?? row.lifecycle_status ?? row.status) === 'discontinued'
                    ? 'discontinued'
                    : str(row.lifecycleStatus ?? row.lifecycle_status ?? row.status) === 'active'
                        ? 'active'
                        : null, 'active')
                    .set('metaTitle', str(row.metaTitle ?? row.meta_title))
                    .set('metaDescription', str(row.metaDescription ?? row.meta_description))
                    .build();
                const existing = await db.productSeries.findUnique({
                    where: { brandId_slug: { brandId, slug } },
                    select: { id: true },
                });
                if (existing)
                    seriesTable.updated += 1;
                else
                    seriesTable.created += 1;
                if (!dryRun) {
                    const saved = existing
                        ? await db.productSeries.update({ where: { id: existing.id }, data })
                        : await db.productSeries.create({
                            data: { brandId, slug, ...data },
                        });
                    seriesIdBySlug.set(slug, saved.id);
                }
                else if (existing) {
                    seriesIdBySlug.set(slug, existing.id);
                }
            }
            tables.push(seriesTable);
            const scenarioTable = emptyCounters('scenario');
            scenarioTable.fetched = scenarioRows.length;
            const scenarioIdBySlug = new Map();
            for (const [i, raw] of scenarioRows.entries()) {
                const row = flatten(raw);
                const slug = row ? str(row.slug) ?? slugify(str(row.name) ?? '') : '';
                if (!row || !slug) {
                    scenarioTable.skipped += 1;
                    continue;
                }
                const data = new Patch(strict)
                    .force('name', str(row.name) ?? slug)
                    .set('description', str(row.description))
                    .set('isCanonical', row.isCanonical === undefined ? null : Boolean(row.isCanonical), true)
                    .set('sortOrder', num(row.sortOrder ?? row.sort_order), i)
                    .build();
                const existing = await db.scenario.findUnique({ where: { slug }, select: { id: true } });
                if (existing)
                    scenarioTable.updated += 1;
                else
                    scenarioTable.created += 1;
                if (!dryRun) {
                    const saved = existing
                        ? await db.scenario.update({ where: { id: existing.id }, data })
                        : await db.scenario.create({ data: { slug, ...data } });
                    scenarioIdBySlug.set(slug, saved.id);
                }
                else if (existing) {
                    scenarioIdBySlug.set(slug, existing.id);
                }
            }
            const localScenarios = await db.scenario.findMany({ select: { id: true, slug: true } });
            for (const local of localScenarios) {
                if (!scenarioIdBySlug.has(local.slug))
                    scenarioIdBySlug.set(local.slug, local.id);
            }
            tables.push(scenarioTable);
            const productTable = emptyCounters('product');
            productTable.fetched = productRows.length;
            for (const [i, raw] of productRows.entries()) {
                const row = flatten(raw);
                if (!row) {
                    productTable.skipped += 1;
                    continue;
                }
                if (row.publishedAt === null) {
                    productTable.skipped += 1;
                    warnings.push(`产品 ${str(row.slug) ?? i} 是草稿（publishedAt=null），已跳过`);
                    continue;
                }
                const slug = str(row.slug) ?? slugify(str(row.name) ?? '');
                const seriesSlug = refSlug(row.series ?? row.productSeries ?? row.product_series);
                if (!slug || !seriesSlug) {
                    productTable.skipped += 1;
                    warnings.push(`产品 ${slug || i} 缺少 slug 或 series 关联，已跳过`);
                    continue;
                }
                const seriesId = seriesIdBySlug.get(seriesSlug);
                if (!seriesId) {
                    productTable.skipped += 1;
                    warnings.push(`产品 ${slug} 指向不存在的系列 ${seriesSlug}，已跳过`);
                    continue;
                }
                const specs = isObject(row.specs) ? row.specs : {};
                const statusRaw = str(row.lifecycleStatus ?? row.lifecycle_status ?? row.status);
                const data = new Patch(strict)
                    .force('seriesId', seriesId)
                    .force('name', str(row.name) ?? slug)
                    .set('shortDescription', str(row.shortDescription ?? row.short_description))
                    .set('overview', str(row.overview))
                    .set('resolution', pick(row, ['resolution'], str) ?? pick(specs, ['resolution'], str))
                    .set('connectivity', pick(row, ['connectivity'], str) ?? pick(specs, ['connectivity'], str))
                    .set('environment', pick(row, ['environment'], str) ?? pick(specs, ['environment'], str))
                    .set('extraSpecs', Object.keys(specs).length > 0 ? JSON.stringify(specs) : null, '{}')
                    .set('status', statusRaw === 'discontinued' || statusRaw === 'beta' || statusRaw === 'active' ? statusRaw : null, 'active')
                    .set('sortOrder', num(row.sortOrder ?? row.sort_order), i)
                    .set('metaTitle', str(row.metaTitle ?? row.meta_title))
                    .set('metaDescription', str(row.metaDescription ?? row.meta_description))
                    .set('publishedAt', str(row.publishedAt) ? new Date(str(row.publishedAt)) : null)
                    .build();
                const existing = await db.product.findUnique({ where: { slug }, select: { id: true } });
                if (existing)
                    productTable.updated += 1;
                else
                    productTable.created += 1;
                if (dryRun)
                    continue;
                const saved = existing
                    ? await db.product.update({ where: { id: existing.id }, data })
                    : await db.product.create({
                        data: { brandId, slug, ...data },
                    });
                const scenarioKeys = ['scenarios', 'bestFor', 'best_for'];
                const scenarioProvided = scenarioKeys.some((k) => row[k] !== undefined && row[k] !== null);
                const scenarioSlugs = refSlugs(row.scenarios ?? row.bestFor ?? row.best_for);
                if (strict || (scenarioProvided && scenarioSlugs.length > 0)) {
                    await db.productScenario.deleteMany({ where: { productId: saved.id } });
                    for (const [order, sSlug] of scenarioSlugs.entries()) {
                        const scenarioId = scenarioIdBySlug.get(sSlug);
                        if (!scenarioId) {
                            warnings.push(`产品 ${slug} 的场景 ${sSlug} 不存在，已忽略`);
                            continue;
                        }
                        await db.productScenario.create({ data: { productId: saved.id, scenarioId, sortOrder: order } });
                    }
                }
                const names = (value) => list(value)
                    .map((v) => str(v))
                    .filter((v) => v !== null);
                const featureGroups = [
                    { kind: 'key', names: names(row.keyFeatures ?? row.key_features ?? row.features) },
                    { kind: 'ai', names: names(row.aiFeatures ?? row.ai_features ?? specs.ai_features) },
                ];
                for (const group of featureGroups) {
                    if (!strict && group.names.length === 0)
                        continue;
                    await db.productFeature.deleteMany({
                        where: { productId: saved.id, feature: { kind: group.kind } },
                    });
                    let order = 0;
                    for (const name of group.names) {
                        const fSlug = slugify(name);
                        if (!fSlug)
                            continue;
                        const feature = await db.feature.upsert({
                            where: { slug: fSlug },
                            update: { name },
                            create: { slug: fSlug, name, kind: group.kind, sortOrder: order },
                            select: { id: true },
                        });
                        await db.productFeature.create({
                            data: { productId: saved.id, featureId: feature.id, sortOrder: order },
                        });
                        order += 1;
                    }
                }
            }
            tables.push(productTable);
            const faqTable = emptyCounters('faq');
            faqTable.fetched = faqRows.length;
            for (const [i, raw] of faqRows.entries()) {
                const row = flatten(raw);
                if (!row) {
                    faqTable.skipped += 1;
                    continue;
                }
                if (row.publishedAt === null) {
                    faqTable.skipped += 1;
                    continue;
                }
                const question = str(row.question);
                const answer = str(row.answer);
                const legacyId = num(row.legacyId ?? row.legacy_id);
                if (!question || !answer || legacyId === null) {
                    faqTable.skipped += 1;
                    warnings.push(`FAQ 第 ${i} 条缺少 legacyId / question / answer，已跳过`);
                    continue;
                }
                const productSlug = refSlug(row.product);
                const seriesSlug = refSlug(row.series ?? row.productSeries);
                const scenarioSlug = refSlug(row.scenario);
                const product = productSlug ? await db.product.findUnique({ where: { slug: productSlug }, select: { id: true } }) : null;
                const series = seriesSlug
                    ? await db.productSeries.findUnique({ where: { brandId_slug: { brandId, slug: seriesSlug } }, select: { id: true } })
                    : null;
                const scenario = scenarioSlug ? await db.scenario.findUnique({ where: { slug: scenarioSlug }, select: { id: true } }) : null;
                const scope = product ? 'product' : series ? 'series' : scenario ? 'scenario' : null;
                const featured = row.isFeatured ?? row.is_featured;
                const data = new Patch(strict)
                    .force('question', question)
                    .force('answer', answer)
                    .set('answerSummary', str(row.answerSummary ?? row.answer_summary))
                    .set('sortOrder', num(row.sortOrder ?? row.sort_order), i)
                    .set('scope', scope, 'brand')
                    .set('productId', product?.id ?? null)
                    .set('seriesId', series?.id ?? null)
                    .set('scenarioId', scenario?.id ?? null)
                    .set('isFeatured', featured === undefined || featured === null ? null : Boolean(featured), false)
                    .build();
                const existing = await db.faq.findUnique({
                    where: { legacyId },
                    select: { id: true, question: true },
                });
                if (existing && mode === 'merge' && existing.question !== question) {
                    faqTable.skipped += 1;
                    warnings.push(`FAQ legacyId ${legacyId} 与本地既有条目撞号（问题不同），已跳过：${question.slice(0, 24)}…`);
                    continue;
                }
                if (existing)
                    faqTable.updated += 1;
                else
                    faqTable.created += 1;
                if (dryRun)
                    continue;
                if (existing)
                    await db.faq.update({ where: { id: existing.id }, data });
                else
                    await db.faq.create({ data: { legacyId, brandId, ...data } });
            }
            tables.push(faqTable);
            if (prune) {
                const remoteOf = (rows) => new Set(rows
                    .map((r) => str(flatten(r)?.slug))
                    .filter((v) => typeof v === 'string' && v.length > 0));
                const keepProducts = remoteOf(productRows);
                if (productRows.length === 0) {
                    warnings.push('prune 跳过产品：远端返回 0 条，删空整库的风险太大');
                }
                else {
                    const locals = await db.product.findMany({ select: { id: true, slug: true } });
                    const ids = locals.filter((l) => !keepProducts.has(l.slug)).map((l) => l.id);
                    pruned.products = ids.length;
                    if (!dryRun && ids.length > 0) {
                        await db.product.deleteMany({ where: { id: { in: ids } } });
                    }
                }
                const keepSeries = remoteOf(seriesRows);
                if (seriesRows.length === 0) {
                    warnings.push('prune 跳过系列：远端返回 0 条');
                }
                else {
                    const locals = await db.productSeries.findMany({ select: { id: true, slug: true } });
                    const ids = locals.filter((l) => !keepSeries.has(l.slug)).map((l) => l.id);
                    pruned.series = ids.length;
                    if (!dryRun && ids.length > 0) {
                        const blocked = await db.productSeries.findMany({
                            where: { id: { in: ids }, products: { some: {} } },
                            select: { id: true },
                        });
                        const blockedIds = new Set(blocked.map((b) => b.id));
                        const deletable = ids.filter((id) => !blockedIds.has(id));
                        pruned.series -= blockedIds.size;
                        if (blockedIds.size > 0) {
                            warnings.push(`prune 有 ${blockedIds.size} 个系列仍挂着产品，已保留`);
                        }
                        if (deletable.length > 0) {
                            await db.productSeries.deleteMany({ where: { id: { in: deletable } } });
                        }
                    }
                }
                const keepScenarios = remoteOf(scenarioRows);
                if (scenarioRows.length === 0) {
                    warnings.push('prune 跳过场景：远端返回 0 条');
                }
                else {
                    const locals = await db.scenario.findMany({ select: { id: true, slug: true } });
                    const ids = locals.filter((l) => !keepScenarios.has(l.slug)).map((l) => l.id);
                    pruned.scenarios = ids.length;
                    if (!dryRun && ids.length > 0) {
                        await db.scenario.deleteMany({ where: { id: { in: ids } } });
                    }
                }
            }
        };
        const pruned = { products: 0, series: 0, scenarios: 0 };
        if (dryRun) {
            await apply(this.prisma);
        }
        else {
            await this.prisma.$transaction(apply, { timeout: 120_000 });
        }
        const missingInStrapi = await this.diffMissing(productRows, seriesRows, scenarioRows);
        const report = {
            baseUrl,
            dryRun,
            mode,
            durationMs: Date.now() - started,
            tables,
            warnings,
            missingInStrapi,
            pruned: prune ? pruned : null,
        };
        this.logger.log(`Strapi 同步${dryRun ? '（预演）' : ''}[${mode}]完成：${tables
            .map((t) => `${t.collection} +${t.created}/~${t.updated}`)
            .join(' · ')}${prune ? ` · 清理 ${pruned.products}/${pruned.series}/${pruned.scenarios}` : ''} · ${report.durationMs}ms`);
        return report;
    }
    async diffMissing(productRows, seriesRows, scenarioRows) {
        const slugsOf = (rows, key = 'slug') => rows
            .map((r) => str(flatten(r)?.[key]))
            .filter((v) => typeof v === 'string' && v.length > 0);
        const remoteProducts = new Set(slugsOf(productRows));
        const remoteSeries = new Set(slugsOf(seriesRows));
        const remoteScenarios = new Set(slugsOf(scenarioRows));
        const [localProducts, localSeries, localScenarios] = await Promise.all([
            this.prisma.product.findMany({ select: { slug: true } }),
            this.prisma.productSeries.findMany({ select: { slug: true } }),
            this.prisma.scenario.findMany({ select: { slug: true } }),
        ]);
        return {
            products: localProducts.map((r) => r.slug).filter((s) => !remoteProducts.has(s)),
            series: localSeries.map((r) => r.slug).filter((s) => !remoteSeries.has(s)),
            scenarios: localScenarios.map((r) => r.slug).filter((s) => !remoteScenarios.has(s)),
        };
    }
    routeCandidates(collection) {
        const override = process.env.STRAPI_ENDPOINTS?.trim();
        if (override) {
            for (const pair of override.split(',')) {
                const [key, value] = pair.split('=').map((s) => s.trim());
                if (key === collection && value)
                    return [value];
            }
        }
        const plural = collection.endsWith('s') ? collection : `${collection}s`;
        return collection === plural ? [collection] : [collection, plural];
    }
    async fetchAll(baseUrl, token, collection) {
        const cached = this.routeCache.get(collection);
        const candidates = cached
            ? [cached, ...this.routeCandidates(collection).filter((c) => c !== cached)]
            : this.routeCandidates(collection);
        let lastStatus = 0;
        for (const route of candidates) {
            const url = `${baseUrl}/api/${route}?pagination[pageSize]=200&populate=*`;
            let res;
            try {
                res = await fetch(url, {
                    headers: token ? { authorization: `Bearer ${token}` } : {},
                    signal: AbortSignal.timeout(20_000),
                });
            }
            catch (err) {
                throw new common_1.HttpException(`无法连接 Strapi（${route}）：${err.message}`, common_1.HttpStatus.BAD_GATEWAY);
            }
            if (res.status === 404) {
                lastStatus = 404;
                continue;
            }
            if (res.status === 401 || res.status === 403) {
                throw new common_1.HttpException(`Strapi 拒绝访问 ${route}（HTTP ${res.status}）：API Token 缺少 find 权限`, common_1.HttpStatus.BAD_GATEWAY);
            }
            if (!res.ok) {
                throw new common_1.HttpException(`Strapi 拉取 ${route} 失败：HTTP ${res.status}`, common_1.HttpStatus.BAD_GATEWAY);
            }
            this.routeCache.set(collection, route);
            const json = (await res.json());
            return list(json?.data);
        }
        throw new common_1.HttpException(`Strapi 里找不到集合 ${collection}（试过 ${candidates.map((c) => `/api/${c}`).join(' 和 ')}），${lastStatus}：先在后台上建好这个 content-type，或用 STRAPI_ENDPOINTS 指定端点名`, common_1.HttpStatus.BAD_GATEWAY);
    }
};
exports.StrapiSyncService = StrapiSyncService;
exports.StrapiSyncService = StrapiSyncService = StrapiSyncService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], StrapiSyncService);
//# sourceMappingURL=strapi.service.js.map