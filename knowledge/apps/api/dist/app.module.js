"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const throttler_1 = require("@nestjs/throttler");
const node_path_1 = require("node:path");
const prisma_module_1 = require("./prisma/prisma.module");
const content_module_1 = require("./modules/content/content.module");
const glm_module_1 = require("./modules/glm/glm.module");
const search_module_1 = require("./modules/search/search.module");
const rag_module_1 = require("./modules/rag/rag.module");
const index_module_1 = require("./modules/index/index.module");
const health_module_1 = require("./modules/health/health.module");
const sync_module_1 = require("./modules/sync/sync.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true, envFilePath: (0, node_path_1.join)(__dirname, '..', '.env') }),
            throttler_1.ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
            prisma_module_1.PrismaModule,
            content_module_1.ContentModule,
            glm_module_1.GlmModule,
            search_module_1.SearchModule,
            rag_module_1.RagModule,
            index_module_1.IndexModule,
            sync_module_1.SyncModule,
            health_module_1.HealthModule,
        ],
        providers: [{ provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard }],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map