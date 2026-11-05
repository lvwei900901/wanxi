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
exports.SyncController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const index_service_1 = require("../index/index.service");
const strapi_service_1 = require("./strapi.service");
const dto_1 = require("./dto");
let SyncController = class SyncController {
    strapi;
    index;
    constructor(strapi, index) {
        this.strapi = strapi;
        this.index = index;
    }
    async sync(authorization, dto) {
        (0, auth_1.assertOpsToken)((0, auth_1.bearerOf)(authorization));
        const report = await this.strapi.sync({ dryRun: dto.dryRun, mode: dto.mode, prune: dto.prune });
        let reindexed = null;
        if (!dto.dryRun && dto.rebuild !== false) {
            const result = await this.index.reindex({ reason: 'strapi sync' });
            reindexed = result.version;
        }
        return { data: { ...report, reindexed } };
    }
};
exports.SyncController = SyncController;
__decorate([
    (0, common_1.Post)('strapi'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: '从 Strapi 拉取内容 upsert 进本地库；dryRun 只预演' }),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.StrapiSyncDto]),
    __metadata("design:returntype", Promise)
], SyncController.prototype, "sync", null);
exports.SyncController = SyncController = __decorate([
    (0, swagger_1.ApiTags)('sync'),
    (0, common_1.Controller)('sync'),
    __metadata("design:paramtypes", [strapi_service_1.StrapiSyncService,
        index_service_1.IndexService])
], SyncController);
//# sourceMappingURL=sync.controller.js.map