import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatMessageItem, ChatRole, SessionSummary } from './insight.types';

/** 单次请求带进模型的历史消息上限（user + assistant 合计） */
export const HISTORY_WINDOW = 12;

@Injectable()
export class InsightRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 找该「品牌 + 区间」下最近活跃的会话。
   * 排序依据是 session.updated_at —— 每次追加消息都会 touch 一次，
   * 否则 @updatedAt 只在 session 自身被 update 时才变，排序会失准。
   */
  async findLatestSession(
    brand: string,
    from: string,
    to: string,
  ): Promise<{
    id: string;
    brand: string;
    periodFrom: string;
    periodTo: string;
  } | null> {
    return this.prisma.insightSession.findFirst({
      where: { brand, periodFrom: from, periodTo: to },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, brand: true, periodFrom: true, periodTo: true },
    });
  }

  async findSessionById(id: string): Promise<{
    id: string;
    brand: string;
    periodFrom: string;
    periodTo: string;
  } | null> {
    return this.prisma.insightSession.findUnique({
      where: { id },
      select: { id: true, brand: true, periodFrom: true, periodTo: true },
    });
  }

  /**
   * 按品牌列出会话，最近的在前。
   *
   * 过滤掉没有消息的会话：新建会话后如果第一条消息就失败，
   * 库里会留下一条空壳，出现在列表里只会让人困惑。
   */
  async listSessions(brand: string, limit: number): Promise<SessionSummary[]> {
    const rows = await this.prisma.insightSession.findMany({
      where: { brand, messages: { some: {} } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        brand: true,
        periodFrom: true,
        periodTo: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      brand: row.brand,
      period_from: row.periodFrom,
      period_to: row.periodTo,
      message_count: row._count.messages,
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  async createSession(input: {
    brand: string;
    from: string;
    to: string;
    title?: string;
  }): Promise<{ id: string }> {
    return this.prisma.insightSession.create({
      data: {
        brand: input.brand,
        periodFrom: input.from,
        periodTo: input.to,
        title: input.title?.slice(0, 80) ?? null,
      },
      select: { id: true },
    });
  }

  /** 取最近 limit 条，再翻回时间正序 —— 截断要砍最早的，不是最新的 */
  async listMessages(sessionId: string, limit: number): Promise<ChatMessageItem[]> {
    const rows = await this.prisma.insightMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, role: true, content: true, createdAt: true },
    });

    return rows
      .reverse()
      .map((row) => ({
        id: row.id,
        role: row.role as ChatRole,
        content: row.content,
        created_at: row.createdAt.toISOString(),
      }));
  }

  /** 写入一条消息，同时把会话的 updated_at 顶上去 */
  async appendMessage(input: {
    sessionId: string;
    role: ChatRole;
    content: string;
    tokens?: number | null;
  }): Promise<{ id: number }> {
    const [message] = await this.prisma.$transaction([
      this.prisma.insightMessage.create({
        data: {
          sessionId: input.sessionId,
          role: input.role,
          content: input.content,
          tokens: input.tokens ?? null,
        },
        select: { id: true },
      }),
      this.prisma.insightSession.update({
        where: { id: input.sessionId },
        data: { updatedAt: new Date() },
        select: { id: true },
      }),
    ]);

    return message;
  }
}
