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
exports.IndexController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const throttler_1 = require("@nestjs/throttler");
const auth_1 = require("../../common/auth");
const index_service_1 = require("./index.service");
const index_hook_service_1 = require("./index-hook.service");
const dto_1 = require("../content/dto");
let IndexController = class IndexController {
    index;
    hook;
    constructor(index, hook) {
        this.index = index;
        this.hook = hook;
    }
    async status() {
        return { data: await this.index.getStatus() };
    }
    async reindex(authorization, dto) {
        (0, auth_1.assertOpsToken)((0, auth_1.bearerOf)(authorization));
        const data = await this.index.reindex({
            dryRun: dto.dryRun,
            force: dto.force,
            reason: dto.reason,
        });
        return { data };
    }
    async strapiHook(headers, body) {
        (0, auth_1.assertOpsToken)((0, auth_1.bearerOf)(headers.authorization));
        const verdict = (0, index_hook_service_1.parseStrapiHook)(body);
        if (!verdict.accepted) {
            return {
                data: {
                    accepted: false,
                    ignored: true,
                    why: verdict.why,
                    queue: this.hook.status(),
                },
            };
        }
        const queue = this.hook.enqueue(verdict.entry);
        return {
            data: {
                accepted: true,
                entry: {
                    model: verdict.entry.model,
                    event: verdict.entry.event,
                    id: verdict.entry.id,
                },
                queue,
            },
        };
    }
    async hookStatus(authorization) {
        (0, auth_1.assertOpsToken)((0, auth_1.bearerOf)(authorization));
        return { data: this.hook.status() };
    }
};
exports.IndexController = IndexController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: '当前生效的索引版本' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], IndexController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('reindex'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: '重建索引（增量；?force=true 全量；dryRun 只看差异）' }),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ReindexDto]),
    __metadata("design:returntype", Promise)
], IndexController.prototype, "reindex", null);
__decorate([
    (0, common_1.Post)('hook'),
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Strapi webhook 入口：立刻 202，去抖后异步重建索引' }),
    __param(0, (0, common_1.Headers)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], IndexController.prototype, "strapiHook", null);
__decorate([
    (0, common_1.Get)('hook/status'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'webhook 队列状态：投递数 / 实际重建次数 / 上一次结果' }),
    __param(0, (0, common_1.Headers)('authorization')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], IndexController.prototype, "hookStatus", null);
exports.IndexController = IndexController = __decorate([
    (0, swagger_1.ApiTags)('index'),
    (0, common_1.Controller)('index'),
    __metadata("design:paramtypes", [index_service_1.IndexService,
        index_hook_service_1.IndexHookService])
], IndexController);
//# sourceMappingURL=index.controller.js.map