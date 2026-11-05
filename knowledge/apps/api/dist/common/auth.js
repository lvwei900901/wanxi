"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeEqual = safeEqual;
exports.bearerOf = bearerOf;
exports.assertOpsToken = assertOpsToken;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
function safeEqual(a, b) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && (0, node_crypto_1.timingSafeEqual)(ba, bb);
}
function bearerOf(authorization) {
    if (authorization === undefined)
        return '';
    return authorization.replace(/^Bearer\s+/i, '').trim();
}
function assertOpsToken(provided, envName = 'REINDEX_TOKEN') {
    const expected = process.env[envName];
    if (!expected) {
        throw new common_1.HttpException(`未配置 ${envName}，拒绝执行`, common_1.HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!provided || !safeEqual(provided, expected)) {
        throw new common_1.UnauthorizedException('运维令牌无效');
    }
}
//# sourceMappingURL=auth.js.map