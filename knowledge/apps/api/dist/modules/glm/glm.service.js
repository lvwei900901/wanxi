"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var GlmService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlmService = void 0;
const common_1 = require("@nestjs/common");
let GlmService = GlmService_1 = class GlmService {
    logger = new common_1.Logger(GlmService_1.name);
    get embedModel() {
        return process.env.GLM_EMBED_MODEL ?? 'embedding-3';
    }
    get embedDim() {
        return Number(process.env.GLM_EMBED_DIM ?? 2048);
    }
    get chatModel() {
        return process.env.GLM_CHAT_MODEL ?? 'glm-4-flash';
    }
    get enabled() {
        return Boolean(process.env.GLM_API_KEY);
    }
    get baseUrl() {
        return process.env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
    }
    headers() {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GLM_API_KEY ?? ''}`,
        };
    }
    async embed(texts, options = {}) {
        if (!this.enabled)
            throw new Error('缺少 GLM_API_KEY');
        const { retries = 2, onProgress } = options;
        const batchSize = 32;
        const out = [];
        for (let i = 0; i < texts.length; i += batchSize) {
            const slice = texts.slice(i, i + batchSize);
            let attempt = 0;
            for (;;) {
                try {
                    out.push(...(await this.requestEmbeddings(slice)));
                    break;
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const retryable = / 429| 5\d\d|fetch failed|ECONN|ETIMEDOUT|aborted/.test(message);
                    if (attempt >= retries || !retryable)
                        throw err;
                    attempt += 1;
                    await new Promise((r) => setTimeout(r, 600 * attempt));
                }
            }
            onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
        }
        return out;
    }
    async requestEmbeddings(texts) {
        const res = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ model: this.embedModel, input: texts, dimensions: this.embedDim }),
            signal: AbortSignal.timeout(20_000),
        });
        const raw = await res.text();
        if (!res.ok)
            throw new Error(`embedding 请求失败 ${res.status}: ${raw.slice(0, 300)}`);
        const json = JSON.parse(raw);
        if (json.error)
            throw new Error(`embedding 返回错误: ${json.error.message ?? 'unknown'}`);
        if (!Array.isArray(json.data) || json.data.length !== texts.length) {
            throw new Error(`embedding 返回条数不符：期望 ${texts.length}，实际 ${json.data?.length ?? 0}`);
        }
        return json.data
            .slice()
            .sort((a, b) => a.index - b.index)
            .map((item) => {
            const vec = Float32Array.from(item.embedding);
            if (vec.length !== this.embedDim) {
                throw new Error(`embedding 维度不符：期望 ${this.embedDim}，实际 ${vec.length}`);
            }
            return vec;
        });
    }
    async *chatStream(messages, signal) {
        if (!this.enabled)
            throw new Error('缺少 GLM_API_KEY');
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
                model: this.chatModel,
                messages,
                stream: true,
                temperature: 0.2,
                max_tokens: 800,
            }),
            signal,
        });
        if (!res.ok || !res.body) {
            const raw = await res.text().catch(() => '');
            throw new Error(`chat 请求失败 ${res.status}: ${raw.slice(0, 300)}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:'))
                    continue;
                const payload = trimmed.slice(5).trim();
                if (payload === '[DONE]')
                    return;
                try {
                    const json = JSON.parse(payload);
                    if (json.error)
                        throw new Error(json.error.message ?? 'chat 流错误');
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta)
                        yield delta;
                }
                catch (err) {
                    this.logger.warn(`跳过无法解析的流片段：${payload.slice(0, 80)}`);
                    if (err instanceof Error && err.message.includes('chat 流错误'))
                        throw err;
                }
            }
        }
    }
};
exports.GlmService = GlmService;
exports.GlmService = GlmService = GlmService_1 = __decorate([
    (0, common_1.Injectable)()
], GlmService);
//# sourceMappingURL=glm.service.js.map