import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrandRangeService } from '../common/brand-range.service';
import { percent } from '../common/metrics';
import { resolveBrand, resolvePeriod } from '../common/query.util';
import { DashboardRepository, num } from './dashboard.repository';
import type {
  DashboardResponse,
  PlatformBlock,
  TopicBlock,
  TrendBlock,
} from './dashboard.types';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly brands: BrandRangeService,
    private readonly config: ConfigService,
  ) {}

  async getOverview(query: DashboardQueryDto): Promise<DashboardResponse> {
    const brand = resolveBrand(query.brand, this.config.get<string>('DEFAULT_BRAND'));
    const range = await this.brands.require(brand);
    const { from, to } = resolvePeriod(query, { min: range.min, max: range.max });

    // 四个块可以并行取，互不依赖
    const [summary, platformRows, topicRows, trendRows] = await Promise.all([
      this.repo.summary(brand, from, to),
      this.repo.platforms(brand, from, to),
      this.repo.topics(brand, from, to),
      this.repo.trend(brand, from, to),
    ]);

    if (summary.total === 0) {
      throw new NotFoundException(
        `品牌 "${brand}" 在 ${from} ~ ${to} 区间内没有数据，` +
          `该品牌实际数据范围为 ${range.min} ~ ${range.max}`,
      );
    }

    // 百分比统一在这里算，SQL 只出整数分子分母（见 common/metrics.ts 的舍入说明）
    const platforms: PlatformBlock[] = platformRows.map((row) => {
      const questionCount = num(row.question_count);
      return {
        name: row.name,
        visibility: percent(num(row.mentions), questionCount) ?? 0,
        mentions: num(row.mentions),
        recommendations: num(row.recommendations),
        citations: num(row.citations),
        question_count: questionCount,
      };
    });

    const topics: TopicBlock[] = topicRows.map((row) => {
      const questions = num(row.questions);
      return {
        topic: row.topic,
        questions,
        visibility: percent(num(row.mentions), questions) ?? 0,
        recommendations: num(row.recommendations),
      };
    });

    const trend: TrendBlock[] = trendRows.map((row) => {
      const total = num(row.total);
      return {
        date: row.date,
        visibility: percent(num(row.mentions), total) ?? 0,
        mentions: num(row.mentions),
        recommendations: num(row.recommendations),
      };
    });

    return {
      brand,
      period: `${from}~${to}`,
      summary: {
        visibility_score: percent(summary.mentions, summary.total) ?? 0,
        mentions: summary.mentions,
        recommendations: summary.recommendations,
        citations: summary.citations,
        questions_analyzed: summary.total,
      },
      platforms,
      trend,
      topics,
    };
  }
}
