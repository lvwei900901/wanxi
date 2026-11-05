import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformOption, TopicOption } from './meta.types';

/**
 * 筛选项数据源。统计口径是「该品牌全量数据」，
 * 不受当前页面筛选影响，否则下拉框选项会越筛越少。
 */
@Injectable()
export class MetaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async platforms(brand: string): Promise<PlatformOption[]> {
    const rows = await this.prisma.$queryRaw<
      { id: unknown; name: string; sort_order: unknown; record_count: unknown }[]
    >`
      SELECT p.id, p.name, p.sort_order, COUNT(a.id) AS record_count
      FROM platforms p
      LEFT JOIN answer_records a
             ON a.platform_id = p.id
            AND a.brand = ${brand}
      GROUP BY p.id
      ORDER BY p.sort_order ASC, p.id ASC
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      sort_order: Number(r.sort_order),
      record_count: Number(r.record_count),
    }));
  }

  async topics(brand: string): Promise<TopicOption[]> {
    const rows = await this.prisma.$queryRaw<
      { name: string; record_count: unknown }[]
    >`
      SELECT topic AS name, COUNT(*) AS record_count
      FROM answer_records
      WHERE brand = ${brand}
      GROUP BY topic
      ORDER BY MIN(id) ASC
    `;
    return rows.map((r) => ({
      name: r.name,
      record_count: Number(r.record_count),
    }));
  }

  async intents(brand: string): Promise<{ value: string; record_count: unknown }[]> {
    return this.prisma.$queryRaw<{ value: string; record_count: unknown }[]>`
      SELECT intent_code AS value, COUNT(*) AS record_count
      FROM answer_records
      WHERE brand = ${brand}
      GROUP BY intent_code
      ORDER BY intent_code ASC
    `;
  }

  async sentiments(
    brand: string,
  ): Promise<{ value: string; record_count: unknown }[]> {
    return this.prisma.$queryRaw<{ value: string; record_count: unknown }[]>`
      SELECT sentiment AS value, COUNT(*) AS record_count
      FROM answer_records
      WHERE brand = ${brand}
      GROUP BY sentiment
      ORDER BY COUNT(*) DESC
    `;
  }
}
