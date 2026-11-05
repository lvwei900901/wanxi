import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  BrandDto,
  FaqDto,
  FaqScope,
  ListMeta,
  ProductCardDto,
  ProductDetailDto,
  ProductStatus,
  ScenarioDto,
  SeriesDto,
  SitemapEntryDto,
  StatsDto,
} from '@kb/contracts';
import { PrismaService } from '../../prisma/prisma.service';

export type ProductFilter = {
  seriesSlug?: string;
  scenarioSlug?: string;
  q?: string;
  includeBeta?: boolean;
};

const cardInclude = Prisma.validator<Prisma.ProductInclude>()({
  series: { select: { slug: true, name: true } },
  features: {
    include: { feature: { select: { name: true, kind: true } } },
    orderBy: { sortOrder: 'asc' },
  },
  scenarios: {
    include: { scenario: { select: { slug: true, name: true } } },
    orderBy: { sortOrder: 'asc' },
  },
});

type CardRow = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

/**
 * 内容查询：只读，全部走 Prisma。
 *
 * 关联数据用 include 一次取回。Prisma 对每个 relation 各发一条 IN 查询，
 * 20 个产品就是 4 条 SQL，不存在 N+1。
 */
@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async getIndexVersion(): Promise<number | null> {
    const row = await this.prisma.embeddingIndex.findFirst({
      where: { status: 'active' },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async meta(total: number): Promise<ListMeta> {
    return {
      total,
      indexVersion: await this.getIndexVersion(),
      generatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------ brand

  async getBrand(): Promise<BrandDto | null> {
    const row = await this.prisma.brand.findFirst({ orderBy: { id: 'asc' } });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      website: row.website,
      foundedYear: row.foundedYear,
      headquarters: row.headquarters,
      coreCapabilities: this.parseArray(row.coreCapabilities),
      logoUrl: row.logoUrl,
      ogImageUrl: row.ogImageUrl,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      canonicalUrl: row.canonicalUrl,
    };
  }

  // ----------------------------------------------------------------- series

  async listSeries(): Promise<SeriesDto[]> {
    const rows = await this.prisma.productSeries.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { products: { where: { status: { not: 'discontinued' } } } } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      productCount: row._count.products,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      canonicalUrl: row.canonicalUrl,
    }));
  }

  async getSeries(slug: string): Promise<SeriesDto | null> {
    const rows = await this.listSeries();
    return rows.find((s) => s.slug === slug) ?? null;
  }

  // -------------------------------------------------------------- scenarios

  async listScenarios(): Promise<ScenarioDto[]> {
    const rows = await this.prisma.scenario.findMany({
      orderBy: [{ isCanonical: 'desc' }, { sortOrder: 'asc' }],
      include: {
        _count: {
          select: { products: { where: { product: { status: { not: 'discontinued' } } } } },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      isCanonical: row.isCanonical,
      productCount: row._count.products,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
    }));
  }

  async getScenario(slug: string): Promise<ScenarioDto | null> {
    const rows = await this.listScenarios();
    return rows.find((s) => s.slug === slug) ?? null;
  }

  // --------------------------------------------------------------- products

  async listProducts(filter: ProductFilter = {}): Promise<ProductCardDto[]> {
    // 默认展示全部在售产品（含 beta）。beta 是正式在售的预发布型号，
    // 隐去会让列表与 series.productCount 对不上（列表 17 / 系列 4）。
    // 只想看已 GA 的产品时传 includeBeta=false。
    const where: Prisma.ProductWhereInput = {
      status: filter.includeBeta === false ? 'active' : { not: 'discontinued' },
    };

    if (filter.seriesSlug) where.series = { slug: filter.seriesSlug };
    if (filter.scenarioSlug) where.scenarios = { some: { scenario: { slug: filter.scenarioSlug } } };
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q } },
        { shortDescription: { contains: filter.q } },
        { overview: { contains: filter.q } },
      ];
    }

    const rows = await this.prisma.product.findMany({
      where,
      orderBy: [{ series: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      include: cardInclude,
    });
    return rows.map((row) => this.toCard(row));
  }

  async getProduct(slug: string): Promise<ProductDetailDto | null> {
    const row = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        ...cardInclude,
        brand: { select: { name: true, slug: true, website: true } },
        faqs: {
          where: { status: 'published' },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            question: true,
            answer: true,
            answerSummary: true,
            scope: true,
            sortOrder: true,
          },
        },
      },
    });
    if (!row) return null;

    const card = this.toCard(row);
    return {
      ...card,
      overview: row.overview,
      connectivity: row.connectivity,
      environment: row.environment,
      extraSpecs: this.parseObject(row.extraSpecs),
      aiFeatures: row.features.filter((f) => f.feature.kind === 'ai').map((f) => f.feature.name),
      faqs: row.faqs.map((f) => this.toFaq(f)),
      imageUrl: row.imageUrl,
      ogImageUrl: row.ogImageUrl,
      canonicalUrl: row.canonicalUrl,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      brand: { name: row.brand.name, slug: row.brand.slug, website: row.brand.website },
    };
  }

  // -------------------------------------------------------------------- faq

  async listFaqs(scope: FaqScope, refSlug?: string): Promise<FaqDto[]> {
    const where: Prisma.FaqWhereInput = { scope, status: 'published' };
    if (scope === 'series' && refSlug) where.series = { slug: refSlug };
    if (scope === 'scenario' && refSlug) where.scenario = { slug: refSlug };

    const rows = await this.prisma.faq.findMany({ where, orderBy: { sortOrder: 'asc' } });
    return rows.map((row) => this.toFaq(row));
  }

  // ------------------------------------------------------------------ stats

  async getStats(): Promise<StatsDto> {
    const indexVersion = await this.getIndexVersion();
    const [products, series, scenarios, faqs, chunks] = await Promise.all([
      this.prisma.product.count({ where: { status: { not: 'discontinued' } } }),
      this.prisma.productSeries.count(),
      this.prisma.scenario.count(),
      this.prisma.faq.count(),
      indexVersion ? this.prisma.knowledgeChunk.count({ where: { indexVersion } }) : Promise.resolve(0),
    ]);
    return { products, series, scenarios, faqs, chunks };
  }

  async getSitemap(): Promise<SitemapEntryDto[]> {
    const [products, series, scenarios] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: { not: 'discontinued' } },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.productSeries.findMany({ select: { slug: true, updatedAt: true } }),
      this.prisma.scenario.findMany({ select: { slug: true, updatedAt: true } }),
    ]);

    const entries: SitemapEntryDto[] = [
      { path: '/', lastmod: null, changefreq: 'weekly', priority: 1 },
      { path: '/products', lastmod: null, changefreq: 'weekly', priority: 0.9 },
      { path: '/ask', lastmod: null, changefreq: 'monthly', priority: 0.6 },
    ];
    for (const p of products) {
      entries.push({
        path: `/products/${p.slug}`,
        lastmod: p.updatedAt.toISOString(),
        changefreq: 'monthly',
        priority: 0.8,
      });
    }
    for (const s of series) {
      entries.push({
        path: `/series/${s.slug}`,
        lastmod: s.updatedAt.toISOString(),
        changefreq: 'monthly',
        priority: 0.7,
      });
    }
    for (const s of scenarios) {
      entries.push({
        path: `/scenarios/${s.slug}`,
        lastmod: s.updatedAt.toISOString(),
        changefreq: 'monthly',
        priority: 0.6,
      });
    }
    return entries;
  }

  // ----------------------------------------------------------------- 映射

  private toCard(row: CardRow): ProductCardDto {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      shortDescription: row.shortDescription,
      status: row.status as ProductStatus,
      series: { slug: row.series.slug, name: row.series.name },
      keyFeatures: row.features.filter((f) => f.feature.kind === 'key').map((f) => f.feature.name),
      scenarios: row.scenarios.map((s) => ({ slug: s.scenario.slug, name: s.scenario.name })),
      resolution: row.resolution,
      connectivity: row.connectivity,
      environment: row.environment,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
    };
  }

  private toFaq(row: {
    id: number;
    question: string;
    answer: string;
    answerSummary: string | null;
    scope: string;
    sortOrder: number;
  }): FaqDto {
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      answerSummary: row.answerSummary,
      scope: row.scope as FaqScope,
      sortOrder: row.sortOrder,
    };
  }

  private parseArray(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private parseObject(raw: string | null): Record<string, unknown> | null {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}
