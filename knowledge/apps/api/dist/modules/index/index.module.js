"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexModule = void 0;
const common_1 = require("@nestjs/common");
const glm_module_1 = require("../glm/glm.module");
const search_module_1 = require("../search/search.module");
const ingest_module_1 = require("../sync/ingest.module");
const revalidate_module_1 = require("../revalidate/revalidate.module");
const index_controller_1 = require("./index.controller");
const index_service_1 = require("./index.service");
const index_hook_service_1 = require("./index-hook.service");
let IndexModule = class IndexModule {
};
exports.IndexModule = IndexModule;
exports.IndexModule = IndexModule = __decorate([
    (0, common_1.Module)({
        imports: [glm_module_1.GlmModule, search_module_1.SearchModule, ingest_module_1.StrapiIngestModule, revalidate_module_1.RevalidateModule],
        controllers: [index_controller_1.IndexController],
        providers: [index_service_1.IndexService, index_hook_service_1.IndexHookService],
        exports: [index_service_1.IndexService, index_hook_service_1.IndexHookService],
    })
], IndexModule);
//# sourceMappingURL=index.module.js.map