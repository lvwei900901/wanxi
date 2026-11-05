import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface LlmChunk {
  text: string;
  usage?: LlmUsage;
}

/** 模型侧的可读错误：带 HTTP 状态，方便上层翻译成给用户看的文案 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

const REQUEST_TIMEOUT_MS = 90_000;

/**
 * 智谱 GLM 的流式客户端。
 *
 * 接口是 OpenAI 兼容格式，所以没有引第三方 SDK ——
 * Node 22 自带 fetch，ReadableStream 直接读就行，少一个依赖。
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (
      this.config.get<string>('LLM_BASE_URL') ??
      'https://open.bigmodel.cn/api/paas/v4'
    ).replace(/\/+$/, '');
  }

  private get apiKey(): string {
    const key = this.config.get<string>('LLM_API_KEY')?.trim();
    if (!key) {
      throw new LlmError(
        '服务端未配置 LLM_API_KEY，请检查 server/.env',
        500,
      );
    }
    return key;
  }

  private get model(): string {
    return this.config.get<string>('LLM_MODEL') ?? 'glm-4-flash';
  }

  /**
   * 逐块产出模型输出。调用方负责消费并在结束后落库。
   *
   * @param signal 客户端断开时用来中断上游请求，避免白跑一次计费
   */
  async *stream(
    messages: LlmMessage[],
    signal: AbortSignal,
  ): AsyncGenerator<LlmChunk> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = AbortSignal.any([signal, timeout]);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          // 分析类任务要稳：低温度 + 收窄采样，避免同一问题两次回答差太多
          temperature: 0.4,
          top_p: 0.7,
          max_tokens: 1024,
        }),
        signal: combined,
      });
    } catch (error) {
      if (signal.aborted) throw new LlmError('请求已取消', 499);
      if (timeout.aborted) throw new LlmError('模型响应超时，请重试', 504);
      this.logger.error(`连接模型服务失败：${(error as Error).message}`);
      throw new LlmError('无法连接模型服务，请检查网络', 502);
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`模型返回 ${response.status}：${detail.slice(0, 300)}`);
      throw new LlmError(this.humanize(response.status, detail), response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 以行分隔，最后一行可能只有半截，留在 buffer 里等下一块
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;

          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') return;

          const chunk = this.parseChunk(payload);
          if (chunk) yield chunk;
        }
      }
    } finally {
      // 正常结束或中途抛错都要释放连接
      await reader.cancel().catch(() => undefined);
    }
  }

  private parseChunk(payload: string): LlmChunk | null {
    let body: {
      choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
      usage?: LlmUsage;
    };
    try {
      body = JSON.parse(payload) as typeof body;
    } catch {
      // 单块解析失败不该炸掉整个回答，跳过即可
      this.logger.warn(`无法解析的流式分块：${payload.slice(0, 120)}`);
      return null;
    }

    const text = body.choices?.[0]?.delta?.content ?? '';
    const usage = body.usage;

    if (!text && !usage) return null;
    return { text, usage };
  }

  private humanize(status: number, detail: string): string {
    if (status === 401 || status === 403) {
      return '模型鉴权失败，请检查 LLM_API_KEY 是否有效';
    }
    if (status === 429) {
      return '模型调用频率超限，请稍后再试';
    }
    if (status >= 500) {
      return '模型服务暂时不可用，请稍后重试';
    }
    if (status === 400 && /model/i.test(detail)) {
      return '模型名不可用，请检查 LLM_MODEL 配置';
    }
    return `模型调用失败（HTTP ${status}）`;
  }
}
