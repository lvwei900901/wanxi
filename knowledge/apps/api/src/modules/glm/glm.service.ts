import { Injectable, Logger } from '@nestjs/common';

/**
 * 智谱 GLM 客户端：只需要 /embeddings 与 /chat/completions 两个接口，
 * 所以自己写这 120 行而不引 SDK —— 少一个依赖，也方便换 provider。
 *
 * 关键约束：查询向量与索引向量必须来自同一 model + 同一维度，否则余弦相似度没有意义，
 * 因此维度做硬校验。
 */
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

@Injectable()
export class GlmService {
  private readonly logger = new Logger(GlmService.name);

  get embedModel(): string {
    return process.env.GLM_EMBED_MODEL ?? 'embedding-3';
  }

  get embedDim(): number {
    return Number(process.env.GLM_EMBED_DIM ?? 2048);
  }

  get chatModel(): string {
    return process.env.GLM_CHAT_MODEL ?? 'glm-4-flash';
  }

  get enabled(): boolean {
    return Boolean(process.env.GLM_API_KEY);
  }

  private get baseUrl(): string {
    return process.env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GLM_API_KEY ?? ''}`,
    };
  }

  /** 批量向量化；429/5xx 退避重试 2 次 */
  async embed(texts: string[], options: { retries?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<Float32Array[]> {
    if (!this.enabled) throw new Error('缺少 GLM_API_KEY');
    const { retries = 2, onProgress } = options;
    const batchSize = 32;
    const out: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      let attempt = 0;
      for (;;) {
        try {
          out.push(...(await this.requestEmbeddings(slice)));
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const retryable = / 429| 5\d\d|fetch failed|ECONN|ETIMEDOUT|aborted/.test(message);
          if (attempt >= retries || !retryable) throw err;
          attempt += 1;
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }
      onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
    }
    return out;
  }

  private async requestEmbeddings(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.embedModel, input: texts, dimensions: this.embedDim }),
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`embedding 请求失败 ${res.status}: ${raw.slice(0, 300)}`);

    const json = JSON.parse(raw) as {
      data?: { index: number; embedding: number[] }[];
      error?: { message?: string };
    };
    if (json.error) throw new Error(`embedding 返回错误: ${json.error.message ?? 'unknown'}`);
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

  /** 流式对话：逐段 yield delta 文本 */
  async *chatStream(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    if (!this.enabled) throw new Error('缺少 GLM_API_KEY');

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
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            error?: { message?: string };
          };
          if (json.error) throw new Error(json.error.message ?? 'chat 流错误');
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch (err) {
          this.logger.warn(`跳过无法解析的流片段：${payload.slice(0, 80)}`);
          if (err instanceof Error && err.message.includes('chat 流错误')) throw err;
        }
      }
    }
  }
}
