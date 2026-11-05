import { Injectable } from '@nestjs/common';
import { Prisma, type AnswerRecord, type Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordFilter {
  brand: string;
  from: string;
  to: string;
  platform?: string[];
  topic?: string[];
  sentiment?: string;
  intentType?: string;
  mentioned?: boolean;
  keyword?: string;
}

export type RecordSortField =
  | 'date'
  | 'platform'
  | 'topic'
  | 'question'
  | 'citations';

export type SortDirection = 'asc' | 'desc';

export type RecordWithPlatform = AnswerRecord & { platform: Platform };

/**
 * 明细查询用 Prisma 的查询构造器（不是原生 SQL）：
 * 这里只做筛选和分页，没有聚合，用不上 $queryRaw；
 * 而且排序字段走白名单映射，不存在拼接注入。
 */
@Injectable()
export class RecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(filter: RecordFilter): Prisma.AnswerRecordWhereInput {
    return {
      brand: filter.brand,
      observedOn: { gte: filter.from, lte: filter.to },
      ...(filter.platform?.length
        ? { platform: { name: { in: filter.platform } } }
        : {}),
      ...(filter.topic?.length ? { topic: { in: filter.topic } } : {}),
      ...(filter.sentiment ? { sentiment: filter.sentiment } : {}),
      ...(filter.intentType ? { intentCode: filter.intentType } : {}),
      ...(filter.mentioned !== undefined
        ? { brandMentioned: filter.mentioned }
        : {}),
      ...(filter.keyword ? { question: { contains: filter.keyword } } : {}),
    };
  }

  private buildOrderBy(
    field: RecordSortField,
    dir: SortDirection,
  ): Prisma.AnswerRecordOrderByWithRelationInput[] {
    switch (field) {
      case 'platform':
        return [{ platform: { sortOrder: dir } }, { observedOn: dir }];
      case 'topic':
        return [{ topic: dir }, { observedOn: 'asc' }];
      case 'question':
        return [{ question: dir }];
      case 'citations':
        return [{ citationCount: dir }, { observedOn: dir }];
      case 'date':
      default:
        return [{ observedOn: dir }, { id: 'asc' }];
    }
  }

  async findPage(params: {
    filter: RecordFilter;
    page: number;
    pageSize: number;
    sortBy: RecordSortField;
    sortDir: SortDirection;
  }): Promise<{ rows: RecordWithPlatform[]; total: number }> {
    const where = this.buildWhere(params.filter);
    const orderBy = this.buildOrderBy(params.sortBy, params.sortDir);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.answerRecord.findMany({
        where,
        orderBy,
        include: { platform: true },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.answerRecord.count({ where }),
    ]);

    return { rows, total };
  }

  async findById(id: number): Promise<RecordWithPlatform | null> {
    return this.prisma.answerRecord.findUnique({
      where: { id },
      include: { platform: true },
    });
  }
}
