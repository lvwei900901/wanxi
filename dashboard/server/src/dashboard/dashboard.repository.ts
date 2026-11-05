import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 所有口径 SQL 集中在这里，只此一处。
 *
 * 为什么不用 Prisma 的 groupBy：布尔字段在 SQLite 里是 0/1，
 * 而 Prisma 的 _sum 只支持数值类型，要拿「提及数」必须拆成
 * 多个带 where 的 _count，5 个平台就是十几次查询且口径分散。
 * 一条聚合 SQL 既准确又只有一处定义。
 *
 * 所有查询都用参数化占位符，不存在拼接注入。
 */

/** SQLite 的 INTEGER 经 Prisma 可能返回 number 或 bigint，统一收敛成 number */
const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

export interface SummaryRow {
  total: unknown;
  mentions: unknown;
  recommendations: unknown;
  citations: unknown;
}

export interface PlatformRow {
  name: string;
  question_count: unknown;
  mentions: unknown;
  recommendations: unknown;
  citations: unknown;
}

export interface TopicRow {
  topic: string;
  questions: unknown;
  mentions: unknown;
  recommendations: unknown;
}

export interface TrendRow {
  date: string;
  total: unknown;
  mentions: unknown;
  recommendations: unknown;
}

export interface SummaryCounts {
  total: number;
  mentions: number;
  recommendations: number;
  citations: number;
}

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async summary(brand: string, from: string, to: string): Promise<SummaryCounts> {
    const rows = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT COUNT(*)                            AS total,
             COALESCE(SUM(brand_mentioned), 0)   AS mentions,
             COALESCE(SUM(brand_recommended), 0) AS recommendations,
             COALESCE(SUM(citation_count), 0)    AS citations
      FROM answer_records
      WHERE brand = ${brand}
        AND observed_on >= ${from}
        AND observed_on <= ${to}
    `;
    const row = rows[0];
    return {
      total: num(row?.total),
      mentions: num(row?.mentions),
      recommendations: num(row?.recommendations),
      citations: num(row?.citations),
    };
  }

  /**
   * 平台维度：从 platforms 表 LEFT JOIN 明细，
   * 保证筛选后哪怕某平台 0 条数据也返回（图表不会突然少一根柱子）。
   */
  async platforms(brand: string, from: string, to: string): Promise<PlatformRow[]> {
    return this.prisma.$queryRaw<PlatformRow[]>`
      SELECT p.name                                AS name,
             COUNT(a.id)                           AS question_count,
             COALESCE(SUM(a.brand_mentioned), 0)   AS mentions,
             COALESCE(SUM(a.brand_recommended), 0) AS recommendations,
             COALESCE(SUM(a.citation_count), 0)    AS citations
      FROM platforms p
      LEFT JOIN answer_records a
             ON a.platform_id = p.id
            AND a.brand = ${brand}
            AND a.observed_on >= ${from}
            AND a.observed_on <= ${to}
      GROUP BY p.id
      ORDER BY p.sort_order ASC, p.id ASC
    `;
  }

  /**
   * 主题维度：主题没有独立维度表，用「该品牌全量数据里主题首次出现的顺序」
   * 作为稳定排序，这样筛选后主题卡片的顺序不会变。
   */
  async topics(brand: string, from: string, to: string): Promise<TopicRow[]> {
    return this.prisma.$queryRaw<TopicRow[]>`
      SELECT t.topic                               AS topic,
             COUNT(a.id)                           AS questions,
             COALESCE(SUM(a.brand_mentioned), 0)   AS mentions,
             COALESCE(SUM(a.brand_recommended), 0) AS recommendations
      FROM (
        SELECT topic, MIN(id) AS first_id
        FROM answer_records
        WHERE brand = ${brand}
        GROUP BY topic
      ) t
      LEFT JOIN answer_records a
             ON a.topic = t.topic
            AND a.brand = ${brand}
            AND a.observed_on >= ${from}
            AND a.observed_on <= ${to}
      GROUP BY t.topic
      ORDER BY t.first_id ASC
    `;
  }

  async trend(brand: string, from: string, to: string): Promise<TrendRow[]> {
    return this.prisma.$queryRaw<TrendRow[]>`
      SELECT observed_on                             AS date,
             COUNT(*)                                AS total,
             COALESCE(SUM(brand_mentioned), 0)       AS mentions,
             COALESCE(SUM(brand_recommended), 0)     AS recommendations
      FROM answer_records
      WHERE brand = ${brand}
        AND observed_on >= ${from}
        AND observed_on <= ${to}
      GROUP BY observed_on
      ORDER BY observed_on ASC
    `;
  }
}

export { num };
