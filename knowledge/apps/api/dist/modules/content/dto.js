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
exports.ReindexDto = exports.AskDto = exports.FaqQueryDto = exports.ProductQueryDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const toBool = ({ value }) => value === true || value === 'true' || value === '1';
class ProductQueryDto {
    series;
    scenario;
    q;
    includeBeta;
}
exports.ProductQueryDto = ProductQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], ProductQueryDto.prototype, "series", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], ProductQueryDto.prototype, "scenario", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], ProductQueryDto.prototype, "q", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toBool),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ProductQueryDto.prototype, "includeBeta", void 0);
class FaqQueryDto {
    scope;
    ref;
}
exports.FaqQueryDto = FaqQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['brand', 'series', 'product', 'scenario']),
    __metadata("design:type", String)
], FaqQueryDto.prototype, "scope", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], FaqQueryDto.prototype, "ref", void 0);
class AskDto {
    question;
    topK;
}
exports.AskDto = AskDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], AskDto.prototype, "question", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(8),
    __metadata("design:type", Number)
], AskDto.prototype, "topK", void 0);
class ReindexDto {
    force;
    dryRun;
    reason;
}
exports.ReindexDto = ReindexDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toBool),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ReindexDto.prototype, "force", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(toBool),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ReindexDto.prototype, "dryRun", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], ReindexDto.prototype, "reason", void 0);
//# sourceMappingURL=dto.js.map