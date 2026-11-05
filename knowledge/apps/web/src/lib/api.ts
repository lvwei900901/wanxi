/**
 * 服务端数据客户端：web 只通过 HTTP 访问 apps/api，不持有任何数据库依赖。
 *
 * 缓存策略：默认 ISR 300s（内容站，允许一点延迟换吞吐）。
 * 但定时过期只是兜底——内容改完要立刻可见，靠的是 api 重建成功后回调
 * `/api/revalidate` 打掉这里的标签。两者缺一不可：
 * 只有标签没有定时过期，web 挂掉一次就永远停在旧版本；
 * 只有定时过期没有标签，后台改完要等满 5 分钟。
 *
 * 取数失败不抛到页面：返回 null，由页面渲染降级态——构建期 api 未启动也能过。
 */
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

const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';
const REVALIDATE = Number(process.env.API_REVALIDATE ?? 300);

/**
 * 缓存标签。`kb` 是整站总标签，api 侧重建成功后按它一次性失效——
 * 一处内容改动常常牵动多个页面（改一个产品会影响首页统计、系列页、场景页），
 * 所以默认整站失效；`kb:<资源>` 是为将来做板块级失效留的钩子。
 */
export const KB_TAG = 'kb';

function tagOf(path: string): string {
  const first = path.split('?')[0]?.split('/').filter(Boolean)[0] ?? 'root';
  return `${KB_TAG}:${first}`;
}

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

async function getJson<T>(path: string, revalidate = REVALIDATE): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      next: { revalidate, tags: [KB_TAG, tagOf(path)] },
      headers: { accept: 'application/json' },
      // 显式超时：api 未启动时要快速失败，不能让 next build 挂在等待连接上
      signal: AbortSignal.timeout(Number(process.env.API_TIMEOUT_MS ?? 5000)),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getBrand(): Promise<BrandDto | null> {
  const body = await getJson<ApiEnvelope<BrandDto>>('/brand');
  return body?.data ?? null;
}

export async function getStats(): Promise<StatsDto | null> {
  const body = await getJson<ApiEnvelope<StatsDto>>('/stats');
  return body?.data ?? null;
}

export async function listSeries(): Promise<SeriesDto[]> {
  const body = await getJson<ApiEnvelope<SeriesDto[]>>('/series');
  return body?.data ?? [];
}

export async function listScenarios(): Promise<ScenarioDto[]> {
  const body = await getJson<ApiEnvelope<ScenarioDto[]>>('/scenarios');
  return body?.data ?? [];
}

export type ProductQuery = { series?: string; scenario?: string; q?: string };

export async function listProducts(query: ProductQuery = {}): Promise<ProductCardDto[]> {
  const qs = new URLSearchParams();
  if (query.series) qs.set('series', query.series);
  if (query.scenario) qs.set('scenario', query.scenario);
  if (query.q) qs.set('q', query.q);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  const body = await getJson<ApiEnvelope<ProductCardDto[]>>(`/products${suffix}`);
  return body?.data ?? [];
}

export async function getProduct(slug: string): Promise<ProductDetailDto | null> {
  const body = await getJson<ApiEnvelope<ProductDetailDto>>(`/products/${encodeURIComponent(slug)}`);
  return body?.data ?? null;
}

export async function listFaqs(scope: 'brand' | 'series' | 'product' | 'scenario'): Promise<FaqDto[]> {
  const body = await getJson<ApiEnvelope<FaqDto[]>>(`/faqs?scope=${scope}`);
  return body?.data ?? [];
}

export async function getSitemapEntries(): Promise<SitemapEntryDto[]> {
  const body = await getJson<ApiEnvelope<SitemapEntryDto[]>>('/sitemap');
  return body?.data ?? [];
}

/** 全站产品 slug，供 generateStaticParams 预渲染 */
export async function listProductSlugs(): Promise<string[]> {
  const items = await listProducts();
  return items.map((p) => p.slug);
}
