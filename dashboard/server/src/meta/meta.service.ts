import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrandRangeService } from '../common/brand-range.service';
import { resolveBrand } from '../common/query.util';
import { MetaRepository } from './meta.repository';
import type { MetaResponse } from './meta.types';

@Injectable()
export class MetaService {
  constructor(
    private readonly repo: MetaRepository,
    private readonly brands: BrandRangeService,
    private readonly config: ConfigService,
  ) {}

  async getMeta(brandQuery?: string): Promise<MetaResponse> {
    const brand = resolveBrand(brandQuery, this.config.get<string>('DEFAULT_BRAND'));
    const range = await this.brands.require(brand);

    const [brands, platforms, topics, intents, sentiments] = await Promise.all([
      this.brands.list(),
      this.repo.platforms(brand),
      this.repo.topics(brand),
      this.repo.intents(brand),
      this.repo.sentiments(brand),
    ]);

    const toOption = (rows: { value: string; record_count: unknown }[]) =>
      rows.map((r) => ({ value: r.value, record_count: Number(r.record_count) }));

    return {
      brand,
      period: { from: range.min, to: range.max },
      brands: brands.map((b) => ({
        name: b.name,
        from: b.min,
        to: b.max,
        records: b.records,
      })),
      platforms,
      topics,
      intents: toOption(intents),
      sentiments: toOption(sentiments),
    };
  }
}
