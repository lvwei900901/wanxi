import type { MetadataRoute } from 'next';
import { getSitemapEntries, SITE_URL } from '@/lib/api';

export const revalidate = 3600;

/**
 * 站点地图以 api 的 /sitemap 为准（它知道有哪些产品/场景），
 * 这里只做两件事：
 *  1. 过滤掉本站没有对应路由的路径——api 会给出 /series/:slug，
 *     而 web 用 /products?series= 表达同一维度，列进 sitemap 会变成 404；
 *  2. 补上 api 不关心的静态页（/scenarios）。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = await getSitemapEntries();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/products`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/scenarios`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/ask`, changeFrequency: 'monthly', priority: 0.6 },
  ];

  const dynamicEntries: MetadataRoute.Sitemap = entries
    .filter((e) => !e.path.startsWith('/series/') && e.path !== '/' && e.path !== '/products' && e.path !== '/ask')
    .map((e) => ({
      url: `${SITE_URL}${e.path}`,
      lastModified: e.lastmod ? new Date(e.lastmod) : undefined,
      changeFrequency: e.changefreq,
      priority: e.priority,
    }));

  return [...staticEntries, ...dynamicEntries];
}
