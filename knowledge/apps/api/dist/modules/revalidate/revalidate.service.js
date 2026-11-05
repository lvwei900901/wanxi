"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var RevalidateService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RevalidateService = void 0;
const common_1 = require("@nestjs/common");
let RevalidateService = RevalidateService_1 = class RevalidateService {
    logger = new common_1.Logger(RevalidateService_1.name);
    get tags() {
        const raw = process.env.WEB_REVALIDATE_TAGS?.trim();
        const list = (raw ? raw.split(',') : ['kb']).map((t) => t.trim()).filter(Boolean);
        return list.length > 0 ? list : ['kb'];
    }
    get timeoutMs() {
        const raw = Number(process.env.WEB_REVALIDATE_TIMEOUT_MS ?? 3000);
        return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 30_000) : 3000;
    }
    get enabled() {
        return Boolean(process.env.WEB_REVALIDATE_URL?.trim() && process.env.WEB_REVALIDATE_TOKEN?.trim());
    }
    async notify() {
        const tags = this.tags;
        const url = process.env.WEB_REVALIDATE_URL?.trim();
        const token = process.env.WEB_REVALIDATE_TOKEN?.trim();
        if (!url || !token) {
            return {
                status: 'skipped',
                tags,
                durationMs: 0,
                message: '未配置 WEB_REVALIDATE_URL / WEB_REVALIDATE_TOKEN，页面将按 revalidate 定时过期',
            };
        }
        const started = Date.now();
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ tags }),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            const durationMs = Date.now() - started;
            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                const message = `web 返回 ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`;
                this.logger.warn(`ISR 失效通知失败：${message}`);
                return { status: 'failed', tags, durationMs, statusCode: res.status, message };
            }
            this.logger.log(`ISR 已失效：${tags.join(',')} · ${durationMs}ms`);
            return { status: 'ok', tags, durationMs, statusCode: res.status };
        }
        catch (err) {
            const durationMs = Date.now() - started;
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`ISR 失效通知失败：${message}`);
            return { status: 'failed', tags, durationMs, message };
        }
    }
};
exports.RevalidateService = RevalidateService;
exports.RevalidateService = RevalidateService = RevalidateService_1 = __decorate([
    (0, common_1.Injectable)()
], RevalidateService);
//# sourceMappingURL=revalidate.service.js.map