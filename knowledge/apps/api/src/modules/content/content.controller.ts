import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ApiEnvelope,
  BrandDto,
  FaqDto,
  ProductCardDto,
  ProductDetailDto,
  ScenarioDto,
  SeriesDto,
  SitemapEntryDto,
  StatsDto,
} from '@kb/contracts';
import { ContentService } from './content.service';
import { FaqQueryDto, ProductQueryDto } from './dto';

@ApiTags('content')
@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('brand')
  @ApiOperation({ summary: '品牌信息（Organization JSON-LD 数据源）' })
  async brand(): Promise<ApiEnvelope<BrandDto | null>> {
    return { data: await this.content.getBrand() };
  }

  @Get('stats')
  @ApiOperation({ summary: '全站统计，用于首页与调试' })
  async stats(): Promise<ApiEnvelope<StatsDto>> {
    return { data: await this.content.getStats() };
  }

  @Get('series')
  @ApiOperation({ summary: '产品线列表（含在售产品数）' })
  async series(): Promise<ApiEnvelope<SeriesDto[]>> {
    const data = await this.content.listSeries();
    return { data, meta: await this.content.meta(data.length) };
  }

  @Get('series/:slug')
  @ApiOperation({ summary: '单条产品线' })
  async seriesOne(@Param('slug') slug: string): Promise<ApiEnvelope<SeriesDto>> {
    const data = await this.content.getSeries(slug);
    if (!data) throw new NotFoundException(`未知系列：${slug}`);
    return { data };
  }

  @Get('scenarios')
  @ApiOperation({ summary: '场景词表（官方场景 + best_for 反推补建）' })
  async scenarios(): Promise<ApiEnvelope<ScenarioDto[]>> {
    const data = await this.content.listScenarios();
    return { data, meta: await this.content.meta(data.length) };
  }

  @Get('scenarios/:slug')
  @ApiOperation({ summary: '单个场景' })
  async scenarioOne(@Param('slug') slug: string): Promise<ApiEnvelope<ScenarioDto>> {
    const data = await this.content.getScenario(slug);
    if (!data) throw new NotFoundException(`未知场景：${slug}`);
    return { data };
  }

  @Get('faqs')
  @ApiOperation({ summary: '按 scope 取 FAQ（品牌/系列/场景级）' })
  async faqs(@Query() query: FaqQueryDto): Promise<ApiEnvelope<FaqDto[]>> {
    const data = await this.content.listFaqs(query.scope ?? 'brand', query.ref);
    return { data, meta: await this.content.meta(data.length) };
  }

  @Get('sitemap')
  @ApiOperation({ summary: '站点 URL 清单，供 Next sitemap.ts 消费' })
  async sitemap(): Promise<ApiEnvelope<SitemapEntryDto[]>> {
    const data = await this.content.getSitemap();
    return { data, meta: await this.content.meta(data.length) };
  }
}

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @ApiOperation({ summary: '产品列表，支持 series / scenario / q 筛选' })
  async list(@Query() query: ProductQueryDto): Promise<ApiEnvelope<ProductCardDto[]>> {
    const data = await this.content.listProducts({
      seriesSlug: query.series,
      scenarioSlug: query.scenario,
      q: query.q,
      includeBeta: query.includeBeta,
    });
    return { data, meta: await this.content.meta(data.length) };
  }

  @Get(':slug')
  @ApiOperation({ summary: '产品详情（Overview / Features / BestFor / FAQ）' })
  async one(@Param('slug') slug: string): Promise<ApiEnvelope<ProductDetailDto>> {
    const data = await this.content.getProduct(slug);
    if (!data) throw new NotFoundException(`未知产品：${slug}`);
    return { data };
  }
}
