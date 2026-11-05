"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATE_VERSION = void 0;
exports.brandChunk = brandChunk;
exports.seriesChunk = seriesChunk;
exports.scenarioChunk = scenarioChunk;
exports.productOverviewChunk = productOverviewChunk;
exports.productSpecChunk = productSpecChunk;
exports.faqChunk = faqChunk;
exports.chunkKey = chunkKey;
exports.TEMPLATE_VERSION = 1;
const SEP = '\n\n';
const line = (label, value) => `- ${label}：${value}`;
const list = (items) => items.join('、');
function block(lines) {
    return lines.filter((x) => typeof x === 'string' && x.length > 0).join(SEP);
}
function brandChunk(b) {
    return {
        sourceType: 'brand',
        sourceId: b.id,
        chunkIndex: 0,
        heading: b.name,
        urlPath: '/',
        content: block([
            b.description ? line('简介', b.description) : null,
            b.foundedYear ? line('成立年份', String(b.foundedYear)) : null,
            b.headquarters ? line('总部', b.headquarters) : null,
            b.coreCapabilities.length ? line('核心能力', list(b.coreCapabilities)) : null,
        ]),
    };
}
function seriesChunk(s) {
    return {
        sourceType: 'series',
        sourceId: s.id,
        chunkIndex: 0,
        heading: s.name,
        urlPath: `/series/${s.slug}`,
        content: block([s.description ? line('简介', s.description) : null]),
    };
}
function scenarioChunk(s) {
    return {
        sourceType: 'scenario',
        sourceId: s.id,
        chunkIndex: 0,
        heading: s.name,
        urlPath: `/scenarios/${s.slug}`,
        content: block([s.description ? line('说明', s.description) : null]),
    };
}
function productOverviewChunk(p) {
    return {
        sourceType: 'product',
        sourceId: p.id,
        chunkIndex: 0,
        heading: p.name,
        urlPath: `/products/${p.slug}`,
        content: block([
            line('所属系列', p.seriesName),
            p.shortDescription ? line('简介', p.shortDescription) : null,
            p.overview ? line('概述', p.overview) : null,
            p.keyFeatures.length ? line('核心功能', list(p.keyFeatures)) : null,
            p.scenarioNames.length ? line('适用场景', list(p.scenarioNames)) : null,
        ]),
    };
}
function productSpecChunk(p) {
    return {
        sourceType: 'product',
        sourceId: p.id,
        chunkIndex: 1,
        heading: `${p.name} · 规格参数`,
        urlPath: `/products/${p.slug}#specs`,
        content: block([
            p.resolution ? line('分辨率', p.resolution) : null,
            p.connectivity ? line('连接方式', p.connectivity) : null,
            p.environment ? line('使用环境', p.environment) : null,
            p.aiFeatures.length ? line('AI 功能', list(p.aiFeatures)) : null,
        ]),
    };
}
function faqChunk(f) {
    return {
        sourceType: 'faq',
        sourceId: f.id,
        chunkIndex: 0,
        heading: f.question,
        urlPath: `/products/${f.productSlug}#faq`,
        content: block([line('产品代号', f.productSlug), line('答案', f.answer)]),
    };
}
function chunkKey(d) {
    return `${d.sourceType}:${d.sourceId}:${d.chunkIndex}`;
}
//# sourceMappingURL=templates.js.map