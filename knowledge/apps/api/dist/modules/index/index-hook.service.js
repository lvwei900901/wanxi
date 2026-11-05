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
var IndexHookService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexHookService = void 0;
exports.parseStrapiHook = parseStrapiHook;
const common_1 = require("@nestjs/common");
const index_service_1 = require("./index.service");
const strapi_service_1 = require("../sync/strapi.service");
const ALLOWED_MODELS = new Set(['product', 'product-series', 'scenario', 'faq', 'brand']);
const ALLOWED_EVENTS = new Set([
    'entry.create',
    'entry.update',
    'entry.delete',
    'entry.publish',
    'entry.unpublish',
]);
function modelOf(body) {
    const uid = typeof body.uid === 'string' ? body.uid : '';
    if (uid.includes('::')) {
        const rest = uid.split('::')[1] ?? '';
        const name = rest.split('.')[0];
        if (name)
            return name;
    }
    const model = typeof body.model === 'string' ? body.model : '';
    return model || null;
}
function idOf(entry) {
    const documentId = entry.documentId;
    if (typeof documentId === 'string' && documentId)
        return documentId;
    const id = entry.id;
    if (typeof id === 'number' || typeof id === 'string')
        return String(id);
    return null;
}
function parseStrapiHook(body) {
    if (!body || typeof body !== 'object')
        return { accepted: false, why: 'payload 不是对象' };
    const b = body;
    const event = typeof b.event === 'string' ? b.event : '';
    if (!event)
        return { accepted: false, why: '缺乏 event 字段' };
    if (event.startsWith('media.')) {
        return { accepted: false, why: '媒体事件不影响文本索引' };
    }
    if (!ALLOWED_EVENTS.has(event)) {
        return { accepted: false, why: `未订阅的事件 ${event}` };
    }
    const model = modelOf(b);
    if (!model)
        return { accepted: false, why: '缺乏 model / uid 字段' };
    if (!ALLOWED_MODELS.has(model)) {
        return { accepted: false, why: `未订阅的集合 ${model}` };
    }
    const rawEntry = b.entry && typeof b.entry === 'object' ? b.entry : {};
    const id = idOf(rawEntry);
    return { accepted: true, entry: { model, event, id, key: `${model}:${id ?? '-'}` } };
}
function reasonOf(entries) {
    const brief = entries
        .slice(0, 3)
        .map((e) => `${e.model}.${e.event.replace(/^entry\./, '')}${e.id ? `#${e.id}` : ''}`)
        .join(' ');
    const extra = entries.length - 3;
    const text = `strapi: ${brief}${extra > 0 ? ` +${extra}` : ''}`;
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
let IndexHookService = IndexHookService_1 = class IndexHookService {
    index;
    strapi;
    logger = new common_1.Logger(IndexHookService_1.name);
    debounceMs;
    maxWaitMs;
    timer = null;
    deadline = null;
    firstPendingAt = null;
    pending = new Map();
    running = false;
    delivered = 0;
    runs = 0;
    lastRun = null;
    lastError = null;
    constructor(index, strapi) {
        this.index = index;
        this.strapi = strapi;
        const raw = Number(process.env.REINDEX_DEBOUNCE_MS ?? 4000);
        this.debounceMs = Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 60_000) : 4000;
        const rawWait = Number(process.env.REINDEX_MAX_WAIT_MS ?? 15_000);
        this.maxWaitMs =
            Number.isFinite(rawWait) && rawWait >= this.debounceMs
                ? Math.min(rawWait, 300_000)
                : Math.max(this.debounceMs * 3, 15_000);
    }
    onModuleDestroy() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
    }
    enqueue(entry) {
        this.delivered += 1;
        if (this.pending.size === 0)
            this.firstPendingAt = Date.now();
        this.pending.set(entry.key, entry);
        this.schedule(this.debounceMs);
        return this.status();
    }
    status() {
        return {
            delivered: this.delivered,
            runs: this.runs,
            running: this.running,
            pendingEntries: this.pending.size,
            debounceMs: this.debounceMs,
            maxWaitMs: this.maxWaitMs,
            nextRunInMs: this.deadline === null ? null : Math.max(0, this.deadline - Date.now()),
            lastRun: this.lastRun,
            lastError: this.lastError,
        };
    }
    schedule(delayMs) {
        if (this.timer)
            clearTimeout(this.timer);
        const now = Date.now();
        const wait = this.firstPendingAt === null
            ? delayMs
            : Math.min(delayMs, Math.max(0, this.maxWaitMs - (now - this.firstPendingAt)));
        this.deadline = now + wait;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.deadline = null;
            void this.flush();
        }, wait);
        this.timer.unref?.();
    }
    async ingestFromStrapi() {
        if (!process.env.STRAPI_URL?.trim()) {
            return { status: 'skipped', created: 0, updated: 0, warnings: 0, message: '未配置 STRAPI_URL' };
        }
        const mode = process.env.STRAPI_SYNC_MODE === 'mirror' ? 'mirror' : 'merge';
        try {
            const report = await this.strapi.sync({ mode });
            return {
                status: 'synced',
                created: report.tables.reduce((sum, t) => sum + t.created, 0),
                updated: report.tables.reduce((sum, t) => sum + t.updated, 0),
                warnings: report.warnings.length,
                ...(report.warnings.length > 0 ? { message: report.warnings.slice(0, 3).join('; ') } : {}),
            };
        }
        catch (err) {
            return {
                status: 'failed',
                created: 0,
                updated: 0,
                warnings: 0,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }
    async flush() {
        if (this.running)
            return;
        const entries = [...this.pending.values()];
        this.pending.clear();
        this.firstPendingAt = null;
        if (entries.length === 0)
            return;
        this.running = true;
        const reason = reasonOf(entries);
        const startedAt = Date.now();
        let ingest = { status: 'skipped', created: 0, updated: 0, warnings: 0 };
        try {
            ingest = await this.ingestFromStrapi();
            if (ingest.status === 'failed') {
                throw new Error(`Strapi 拉取失败，已跳过重建：${ingest.message ?? '未知原因'}`);
            }
            const result = await this.index.reindex({ reason, log: (m) => this.logger.log(m) });
            this.runs += 1;
            this.lastRun = {
                at: new Date().toISOString(),
                reason,
                ok: true,
                version: result.version,
                durationMs: result.durationMs,
                embeddedChunks: result.embeddedChunks,
                ingest,
                revalidate: result.revalidate,
            };
            this.lastError = null;
            this.logger.log(`webhook 重建完成 v${result.version ?? '-'} · ingest +${ingest.created}/~${ingest.updated} · ` +
                `ISR ${result.revalidate?.status ?? 'skipped'} · ${result.durationMs}ms · ${reason}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.runs += 1;
            this.lastRun = {
                at: new Date().toISOString(),
                reason,
                ok: false,
                version: null,
                durationMs: Date.now() - startedAt,
                embeddedChunks: 0,
                ingest,
                revalidate: null,
                message,
            };
            this.lastError = message;
            this.logger.error(`webhook 重建失败：${message}`);
        }
        finally {
            this.running = false;
            if (this.pending.size > 0)
                this.schedule(this.debounceMs);
        }
    }
};
exports.IndexHookService = IndexHookService;
exports.IndexHookService = IndexHookService = IndexHookService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(index_service_1.IndexService)),
    __param(1, (0, common_1.Inject)(strapi_service_1.StrapiSyncService)),
    __metadata("design:paramtypes", [index_service_1.IndexService,
        strapi_service_1.StrapiSyncService])
], IndexHookService);
//# sourceMappingURL=index-hook.service.js.map