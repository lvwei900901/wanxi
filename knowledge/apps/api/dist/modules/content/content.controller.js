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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductsController = exports.ContentController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const content_service_1 = require("./content.service");
const dto_1 = require("./dto");
let ContentController = class ContentController {
    content;
    constructor(content) {
        this.content = content;
    }
    async brand() {
        return { data: await this.content.getBrand() };
    }
    async stats() {
        return { data: await this.content.getStats() };
    }
    async series() {
        const data = await this.content.listSeries();
        return { data, meta: await this.content.meta(data.length) };
    }
    async seriesOne(slug) {
        const data = await this.content.getSeries(slug);
        if (!data)
            throw new common_1.NotFoundException(`未知系列：${slug}`);
        return { data };
    }
    async scenarios() {
        const data = await this.content.listScenarios();
        return { data, meta: await this.content.meta(data.length) };
    }
    async scenarioOne(slug) {
        const data = await this.content.getScenario(slug);
        if (!data)
            throw new common_1.NotFoundException(`未知场景：${slug}`);
        return { data };
    }
    async faqs(query) {
        const data = await this.content.listFaqs(query.scope ?? 'brand', query.ref);
        return { data, meta: await this.content.meta(data.length) };
    }
    async sitemap() {
        const data = await this.content.getSitemap();
        return { data, meta: await this.content.meta(data.length) };
    }
};
exports.ContentController = ContentController;
__decorate([
    (0, common_1.Get)('brand'),
    (0, swagger_1.ApiOperation)({ summary: '品牌信息（Organization JSON-LD 数据源）' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ContentController.prototype, "brand", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, swagger_1.ApiOperation)({ summary: '全站统计，用于首页与调试' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ContentController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)('series'),
    (0, swagger_1.ApiOperation)({ summary: '产品线列表（含在售产品数）' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ContentController.prototype, "series", null);
__decorate([
    (0, common_1.Get)('series/:slug'),
    (0, swagger_1.ApiOperation)({ summary: '单条产品线' }),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ContentController.prototype, "seriesOne", null);
__decorate([
    (0, common_1.Get)('scenarios'),
    (0, swagger_1.ApiOperation)({ summary: '场景词表（官方场景 + best_for 反推补建）' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ContentController.prototype, "scenarios", null);
__decorate([
    (0, common_1.Get)('scenarios/:slug'),
    (0, swagger_1.ApiOperation)({ summary: '单个场景' }),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ContentController.prototype, "scenarioOne", null);
__decorate([
    (0, common_1.Get)('faqs'),
    (0, swagger_1.ApiOperation)({ summary: '按 scope 取 FAQ（品牌/系列/场景级）' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.FaqQueryDto]),
    __metadata("design:returntype", Promise)
], ContentController.prototype, "faqs", null);
__decorate([
    (0, common_1.Get)('sitemap'),
    (0, swagger_1.ApiOperation)({ summary: '站点 URL 清单，供 Next sitemap.ts 消费' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ContentController.prototype, "sitemap", null);
exports.ContentController = ContentController = __decorate([
    (0, swagger_1.ApiTags)('content'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [content_service_1.ContentService])
], ContentController);
let ProductsController = class ProductsController {
    content;
    constructor(content) {
        this.content = content;
    }
    async list(query) {
        const data = await this.content.listProducts({
            seriesSlug: query.series,
            scenarioSlug: query.scenario,
            q: query.q,
            includeBeta: query.includeBeta,
        });
        return { data, meta: await this.content.meta(data.length) };
    }
    async one(slug) {
        const data = await this.content.getProduct(slug);
        if (!data)
            throw new common_1.NotFoundException(`未知产品：${slug}`);
        return { data };
    }
};
exports.ProductsController = ProductsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: '产品列表，支持 series / scenario / q 筛选' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ProductQueryDto]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':slug'),
    (0, swagger_1.ApiOperation)({ summary: '产品详情（Overview / Features / BestFor / FAQ）' }),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "one", null);
exports.ProductsController = ProductsController = __decorate([
    (0, swagger_1.ApiTags)('products'),
    (0, common_1.Controller)('products'),
    __metadata("design:paramtypes", [content_service_1.ContentService])
], ProductsController);
//# sourceMappingURL=content.controller.js.map