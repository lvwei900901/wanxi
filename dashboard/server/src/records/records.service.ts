import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrandRangeService } from '../common/brand-range.service';
import { resolveBrand, resolvePeriod } from '../common/query.util';
import { RecordQueryDto } from './dto/record-query.dto';
import {
  RecordsRepository,
  type RecordSortField,
  type RecordWithPlatform,
  type SortDirection,
} from './records.repository';
import type {
  CitationItem,
  Paginated,
  RecordDetail,
  RecordItem,
} from './records.types';

/** JSON 列的解析必须是防御性的：库里可能存了脏数据 */
function parseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

@Injectable()
export class RecordsService {
  constructor(
    private readonly repo: RecordsRepository,
    private readonly brands: BrandRangeService,
    private readonly config: ConfigService,
  ) {}

  private toItem(row: RecordWithPlatform): RecordItem {
    return {
      id: row.id,
      source_id: row.sourceId,
      date: row.observedOn,
      platform: row.platform.name,
      topic: row.topic,
      intent_type: row.intentCode,
      question: row.question,
      brand_mentioned: row.brandMentioned,
      brand_recommended: row.brandRecommended,
      sentiment: row.sentiment,
      answer_excerpt: row.answerExcerpt,
      mentioned_products: parseArray<string>(row.mentionedProducts),
      citation_count: row.citationCount,
    };
  }

  async list(query: RecordQueryDto): Promise<Paginated<RecordItem>> {
    const brand = resolveBrand(query.brand, this.config.get<string>('DEFAULT_BRAND'));
    const range = await this.brands.require(brand);
    const { from, to } = resolvePeriod(query, { min: range.min, max: range.max });

    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;
    const sortBy = (query.sort_by ?? 'date') as RecordSortField;
    const sortDir = (query.sort_dir ?? 'desc') as SortDirection;

    const { rows, total } = await this.repo.findPage({
      filter: {
        brand,
        from,
        to,
        platform: query.platform,
        topic: query.topic,
        sentiment: query.sentiment,
        intentType: query.intent_type,
        mentioned: query.mentioned,
        keyword: query.keyword,
      },
      page,
      pageSize,
      sortBy,
      sortDir,
    });

    return {
      items: rows.map((row) => this.toItem(row)),
      total,
      page,
      page_size: pageSize,
      page_count: Math.ceil(total / pageSize),
    };
  }

  async detail(id: number): Promise<RecordDetail> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`记录 ${id} 不存在`);
    }
    return {
      ...this.toItem(row),
      citations: parseArray<CitationItem>(row.citations),
    };
  }
}
