import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { BrandRangeService } from '../common/brand-range.service';
import { resolveBrand, resolvePeriod } from '../common/query.util';
import { DashboardService } from '../dashboard/dashboard.service';
import { ChatDto } from './dto/chat.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { SessionsQueryDto } from './dto/sessions-query.dto';
import { InsightRepository, HISTORY_WINDOW } from './insight.repository';
import type {
  ChatMessageItem,
  DoneEvent,
  HistoryResponse,
  MetaEvent,
  SessionsResponse,
} from './insight.types';
import { LlmClient, LlmError, type LlmMessage } from './llm.client';
import { SYSTEM_PROMPT, buildContext } from './prompt';

/** GET /history 一次最多返回的历史条数（前端展示用，比喂模型的多） */
const HISTORY_LIST_LIMIT = 60;

/** 事件写出。data 走 JSON，内容里的换行会被转义，不会破坏 SSE 帧结构 */
function sse(res: Response, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

@Injectable()
export class InsightService {
  private readonly logger = new Logger(InsightService.name);

  constructor(
    private readonly repo: InsightRepository,
    private readonly dashboard: DashboardService,
    private readonly brands: BrandRangeService,
    private readonly llm: LlmClient,
    private readonly config: ConfigService,
  ) {}

  /** 三个接口共用的「品牌 + 区间」解析，行为与 dashboard 保持一致 */
  private async resolveScope(input: {
    brand?: string;
    from?: string;
    to?: string;
  }): Promise<{ brand: string; from: string; to: string }> {
    const brand = resolveBrand(input.brand, this.config.get<string>('DEFAULT_BRAND'));
    const range = await this.brands.require(brand);
    const { from, to } = resolvePeriod(input, { min: range.min, max: range.max });
    return { brand, from, to };
  }

  async history(query: HistoryQueryDto): Promise<HistoryResponse> {
    let session: {
      id: string;
      brand: string;
      periodFrom: string;
      periodTo: string;
    } | null;

    if (query.session_id) {
      // 指定了会话就直接按 id 取，不再受当前看板区间限制 ——
      // 用户从列表里点开一条 7 月的旧对话时，看板还没切过去
      session = await this.repo.findSessionById(query.session_id);
      if (session && query.brand && query.brand !== session.brand) {
        session = null;
      }
    } else {
      const { brand, from, to } = await this.resolveScope(query);
      session = await this.repo.findLatestSession(brand, from, to);
    }

    if (!session) {
      return {
        session_id: null,
        brand: null,
        period_from: null,
        period_to: null,
        messages: [],
      };
    }

    const messages = await this.repo.listMessages(session.id, HISTORY_LIST_LIMIT);
    return {
      session_id: session.id,
      brand: session.brand,
      period_from: session.periodFrom,
      period_to: session.periodTo,
      messages,
    };
  }

  /** 侧栏的会话列表：按品牌取全部区间，最近的在前 */
  async sessions(query: SessionsQueryDto): Promise<SessionsResponse> {
    const brand = resolveBrand(
      query.brand,
      this.config.get<string>('DEFAULT_BRAND'),
    );
    const items = await this.repo.listSessions(brand, query.limit ?? 30);
    return { items };
  }

  /**
   * 跑完一轮对话并把过程写进 SSE 响应。
   *
   * 注意：一旦 headers 发出去，NestJS 的异常过滤器就管不到这里了，
   * 所以整个流程用 try/catch 包住，任何失败都翻译成 error 事件。
   */
  async chat(dto: ChatDto, res: Response, abort: AbortSignal): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // 反向代理（nginx）看到这个头就不会攒够一个 buffer 再转发
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let text = '';
    let sessionId: string | undefined;
    try {
      const { brand, from, to } = await this.resolveScope(dto);

      // 会话必须和当前「品牌 + 区间」一致，否则前端传错了 id 就会串台
      sessionId = await this.ensureSession(dto.session_id, {
        brand,
        from,
        to,
        title: dto.message,
      });

      const userMessage = await this.repo.appendMessage({
        sessionId,
        role: 'user',
        content: dto.message,
      });

      const meta: MetaEvent = {
        session_id: sessionId,
        user_message_id: userMessage.id,
      };
      sse(res, 'meta', meta);

      const messages = await this.buildMessages(sessionId, {
        brand,
        from,
        to,
      });

      let usage: DoneEvent['usage'] = { prompt_tokens: 0, completion_tokens: 0 };

      for await (const chunk of this.llm.stream(messages, abort)) {
        if (chunk.text) {
          text += chunk.text;
          sse(res, 'delta', { text: chunk.text });
        }
        if (chunk.usage) usage = chunk.usage;
      }

      if (!text.trim()) {
        throw new LlmError('模型没有返回内容，请重试', 502);
      }

      const saved = await this.repo.appendMessage({
        sessionId,
        role: 'assistant',
        content: text,
        tokens: usage.completion_tokens || null,
      });

      sse(res, 'done', {
        message_id: saved.id,
        usage,
      } satisfies DoneEvent);
    } catch (error) {
      // 已经吐出的半截内容也要落库，否则前端看到一段话、刷新就没了
      if (text.trim() && sessionId) {
        await this.persistPartial(sessionId, text);
      }
      const message =
        error instanceof LlmError
          ? error.message
          : error instanceof Error
            ? error.message
            : '生成失败，请重试';

      if (!(error instanceof LlmError)) {
        this.logger.error(`对话失败：${message}`, (error as Error)?.stack);
      }
      sse(res, 'error', { message });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /** 校验传入的 session 是否属于当前区间；不属于就另起一条新会话 */
  private async ensureSession(
    candidate: string | undefined,
    scope: { brand: string; from: string; to: string; title: string },
  ): Promise<string> {
    if (candidate) {
      const found = await this.repo.findSessionById(candidate);
      if (
        found &&
        found.brand === scope.brand &&
        found.periodFrom === scope.from &&
        found.periodTo === scope.to
      ) {
        return found.id;
      }
    }

    const created = await this.repo.createSession({
      brand: scope.brand,
      from: scope.from,
      to: scope.to,
      title: scope.title,
    });
    return created.id;
  }

  private async buildMessages(
    sessionId: string,
    scope: { brand: string; from: string; to: string },
  ): Promise<LlmMessage[]> {
    // 上下文与页面同源：直接复用聚合服务，保证模型看到的数字和用户看到的一致
    const dashboard = await this.dashboard.getOverview(scope);
    const context = buildContext(dashboard);

    const history = await this.repo.listMessages(sessionId, HISTORY_WINDOW);

    return [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\n# 数据\n\n${context}`,
      },
      ...history.map((item: ChatMessageItem) => ({
        role: item.role,
        content: item.content,
      })),
    ];
  }

  /** 中断或出错时把已生成的部分存下来，避免刷新后只剩用户那一句 */
  private async persistPartial(sessionId: string, text: string): Promise<void> {
    try {
      await this.repo.appendMessage({
        sessionId,
        role: 'assistant',
        content: text,
      });
    } catch (error) {
      this.logger.warn(`保存未完成的回答失败：${(error as Error).message}`);
    }
  }
}
