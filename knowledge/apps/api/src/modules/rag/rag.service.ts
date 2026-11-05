import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { AskCitationDto, AskStreamEvent } from '@kb/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { GlmService, type ChatMessage } from '../glm/glm.service';
import { SearchService, type SearchHit } from '../search/search.service';

const SYSTEM_PROMPT = `你是 AsterVision 的产品知识助手。只能依据下面提供的「知识片段」回答。
规则：
1. 片段里没有的信息，直接回答"知识库中没有这项信息"，不要推测，不要补充行业常识。
2. 中文作答，先给结论再给一句解释，总长控制在 3 句以内。
3. 不要罗列片段编号，也不要复述问题。`;

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly glm: GlmService,
    private readonly search: SearchService,
  ) {}

  private send(res: Response, event: AskStreamEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private toCitation(hit: SearchHit, n: number): AskCitationDto {
    return {
      n,
      title: hit.heading ?? '未命名片段',
      urlPath: hit.urlPath ?? '/',
      sourceType: hit.sourceType,
      score: hit.score,
    };
  }

  private prompt(question: string, hits: SearchHit[]): ChatMessage[] {
    const context = hits.map((h, i) => `[${i + 1}] ${h.content}`).join('\n\n');
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `知识片段：\n${context}\n\n问题：${question}` },
    ];
  }

  /**
   * SSE 输出：先推 citations（前端可立即渲染引用卡片），再逐 token 推正文，
   * 最后 done。上游失败时降级为关键词结果 + 提示，不让用户看到空屏。
   */
  async stream(question: string, topK: number, res: Response, signal: AbortSignal): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const active = await this.prisma.embeddingIndex.findFirst({
      where: { status: 'active' },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    const indexVersion = active?.id ?? null;

    if (!indexVersion) {
      this.send(res, { type: 'error', message: '知识索引尚未构建，请先执行 npm run kb:reindex' });
      this.send(res, { type: 'done', degraded: true, indexVersion: null });
      res.end();
      return;
    }

    if (!this.glm.enabled) {
      await this.degraded(question, res, indexVersion, 'AI 服务未配置（缺少 GLM_API_KEY）');
      return;
    }

    let hits: SearchHit[] = [];
    try {
      const [vector] = await this.glm.embed([question]);
      hits = await this.search.search(vector, topK);
    } catch (err) {
      this.logger.warn(`向量检索失败，降级为关键词：${(err as Error).message}`);
      await this.degraded(question, res, indexVersion, '向量服务暂时不可用');
      return;
    }

    if (hits.length === 0) {
      this.send(res, { type: 'citations', citations: [] });
      this.send(res, {
        type: 'token',
        value: '知识库中没有找到与这个问题相关的内容。可以换个说法，或直接问某个产品是否支持某项能力。',
      });
      this.send(res, { type: 'done', degraded: false, indexVersion });
      res.end();
      return;
    }

    this.send(res, { type: 'citations', citations: hits.map((h, i) => this.toCitation(h, i + 1)) });

    try {
      for await (const delta of this.glm.chatStream(this.prompt(question, hits), signal)) {
        if (signal.aborted) break;
        this.send(res, { type: 'token', value: delta });
      }
      this.send(res, { type: 'done', degraded: false, indexVersion });
    } catch (err) {
      if (!signal.aborted) {
        this.logger.error(`生成失败：${(err as Error).message}`);
        this.send(res, { type: 'token', value: '\n\n（生成中断，请稍后重试）' });
        this.send(res, { type: 'done', degraded: true, indexVersion });
      }
    } finally {
      res.end();
    }
  }

  private async degraded(question: string, res: Response, indexVersion: number, reason: string): Promise<void> {
    const hits = await this.search.keywordSearch(question, 4);
    this.send(res, { type: 'citations', citations: hits.map((h, i) => this.toCitation(h, i + 1)) });

    const body = hits.length
      ? `${reason}。以下是知识库中与问题最相关的内容：${hits.map((h) => h.heading ?? '相关产品').join('、')}。点击下方引用可查看完整页面。`
      : `${reason}，且没有找到关键词匹配的内容。可以换个说法，或直接浏览产品列表。`;

    this.send(res, { type: 'token', value: body });
    this.send(res, { type: 'done', degraded: true, indexVersion });
    res.end();
  }
}
