import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BrandRange {
  name: string;
  min: string;
  max: string;
  records: number;
}

/**
 * 品牌与数据范围查询。dashboard / records / meta 三个接口都要用，
 * 集中在这里，避免三段一样的 MIN/MAX SQL 各写一遍。
 */
@Injectable()
export class BrandRangeService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<BrandRange[]> {
    const rows = await this.prisma.$queryRaw<
      { brand: string; min: string; max: string; records: unknown }[]
    >`
      SELECT brand,
             MIN(observed_on) AS min,
             MAX(observed_on) AS max,
             COUNT(*)         AS records
      FROM answer_records
      GROUP BY brand
      ORDER BY brand ASC
    `;
    return rows.map((r) => ({
      name: r.brand,
      min: r.min,
      max: r.max,
      records: Number(r.records),
    }));
  }

  /** 取某品牌的日期范围；品牌不存在时抛 404 并列出可选品牌 */
  async require(brand: string): Promise<BrandRange> {
    const all = await this.list();
    const hit = all.find((b) => b.name === brand);
    if (!hit) {
      throw new NotFoundException(
        `品牌 "${brand}" 没有数据。可选品牌：${
          all.map((b) => b.name).join(', ') || '（库为空）'
        }`,
      );
    }
    return hit;
  }
}
