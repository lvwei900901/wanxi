/**
 * SEO / GEO 结构化数据构造器。
 *
 * 为什么单独成文件：JSON-LD 的字段名极易写错（大小写、@type 复数、URL 绝对化），
 * 集中一处可以统一用类型兜住，页面里只负责组装。
 * GEO 的关键是「AI 抓取器不执行 JS」，所以这些必须由服务端渲染进首字节 HTML。
 */
import type { BrandDto, FaqDto, ProductDetailDto, SeriesDto } from '@kb/contracts';
import { SITE_URL } from './api';

export const abs = (path: string) => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

export function organizationJsonLd(brand: BrandDto) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': abs('/#organization'),
    name: brand.name,
    url: brand.website ?? SITE_URL,
    description: brand.description ?? undefined,
    foundingDate: brand.foundedYear ? String(brand.foundedYear) : undefined,
    ...(brand.logoUrl ? { logo: abs(brand.logoUrl) } : {}),
    ...(brand.headquarters
      ? { address: { '@type': 'PostalAddress', addressLocality: brand.headquarters } }
      : {}),
    ...(brand.coreCapabilities.length > 0
      ? { knowsAbout: brand.coreCapabilities }
      : {}),
  };
}

export function websiteJsonLd(brand: BrandDto) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': abs('/#website'),
    name: `${brand.name} Product Knowledge Center`,
    url: SITE_URL,
    publisher: { '@id': abs('/#organization') },
    inLanguage: 'en',
  };
}

export function productJsonLd(product: ProductDetailDto) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': abs(`/products/${product.slug}#product`),
    name: product.name,
    description: product.overview ?? product.shortDescription ?? undefined,
    sku: product.slug,
    url: abs(`/products/${product.slug}`),
    ...(product.imageUrl ? { image: abs(product.imageUrl) } : {}),
    category: product.series.name,
    brand: { '@type': 'Brand', name: product.brand.name },
    ...(product.keyFeatures.length > 0 ? { keywords: product.keyFeatures.join(', ') } : {}),
    ...(Object.keys(product.extraSpecs ?? {}).length > 0
      ? {
          additionalProperty: Object.entries(product.extraSpecs ?? {}).map(([k, v]) => ({
            '@type': 'PropertyValue',
            name: k,
            value: String(v),
          })),
        }
      : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: abs(item.path),
    })),
  };
}

export function faqPageJsonLd(faqs: FaqDto[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answerSummary ?? f.answer,
      },
    })),
  };
}

export function itemListJsonLd(
  products: { slug: string; name: string }[],
  series: SeriesDto | null,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: series ? `${series.name} products` : 'All products',
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: abs(`/products/${p.slug}`),
      name: p.name,
    })),
  };
}

/** 把对象序列化成可安全内联进 <script> 的字符串（转义 </script> 与 </) */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
