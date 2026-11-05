import type { Metadata } from 'next';
import Link from 'next/link';
import { listProducts, listSeries } from '@/lib/api';
import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from '@/lib/seo';
import Breadcrumbs from '@/components/breadcrumbs';
import SeriesFilter from '@/components/series-filter';
import { ProductRow, ROW_GRID } from '@/components/product-row';

export const revalidate = 300;

type SearchParams = { series?: string; q?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { series: seriesSlug } = await searchParams;
  const series = seriesSlug ? (await listSeries()).find((s) => s.slug === seriesSlug) : null;

  const title = series ? `${series.name} products` : 'All products';
  const description = series
    ? `${series.name}: ${series.description ?? 'Specifications, features and best-fit scenarios.'}`
    : 'Complete AsterVision product catalogue with specifications, key features and the deployments each product is built for.';
  const canonical = series ? `/products?series=${series.slug}` : '/products';

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', url: canonical, title: `${title} | AsterVision`, description },
  };
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { series: seriesSlug } = await searchParams;
  const [products, series] = await Promise.all([listProducts({ series: seriesSlug }), listSeries()]);
  const active = series.find((s) => s.slug === seriesSlug) ?? null;
  const total = series.reduce((sum, s) => sum + s.productCount, 0);

  const filters = [
    { href: '/products', label: 'All', count: total, active: !active },
    ...series.map((s) => ({
      href: `/products?series=${s.slug}`,
      label: s.name.replace(/ Series$/, ''),
      count: s.productCount,
      active: s.slug === seriesSlug,
    })),
  ];

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/' },
          ...(active
            ? [{ name: 'Products', path: '/products' }, { name: active.name }]
            : [{ name: 'Products' }]),
        ]}
      />

      <header className="flex flex-col gap-5 border-b border-ink/65 pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h1 className="text-[clamp(1.9rem,3.6vw,2.6rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            {active ? active.name : 'All products'}
          </h1>
          <span className="label">
            {products.length} {products.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        <p className="prose-measure text-[14.5px] leading-7 text-ink-2">
          {active
            ? active.description
            : 'Every AsterVision product, ordered by series. Each entry carries the resolution, how it connects and where it can be installed, plus the deployments it is qualified for.'}
        </p>
      </header>

      <SeriesFilter items={filters} />

      {products.length === 0 ? (
        <div className="notice notice-warn">
          <span className="label pt-0.5">Empty</span>
          <p className="text-[13.5px] leading-6 text-ink-2">
            No products to show. The content API returned nothing for this filter — check that the
            API service is running and the catalogue has been seeded.
          </p>
        </div>
      ) : (
        <div>
          {/* 表头：与索引行共用 ROW_GRID，列宽永远对齐 */}
          <div className={`${ROW_GRID} hidden border-b border-ink/65 pb-2 pl-3 md:grid`}>
            <span className="label">Ref</span>
            <span className="label">Model</span>
            <span className="label">Series</span>
            <span className="label">Max res</span>
            <span className="label">Scenarios</span>
            <span />
          </div>
          <ul>
            {products.map((p, i) => (
              <ProductRow key={p.slug} product={p} no={i + 1} />
            ))}
          </ul>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-3">
            <span className="label">Note</span>
            Discontinued models stay listed so existing links and search results keep resolving.
          </p>
        </div>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: 'Home', path: '/' },
              {
                name: active ? active.name : 'Products',
                path: active ? `/products?series=${active.slug}` : '/products',
              },
            ]),
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(itemListJsonLd(products, active)) }}
      />
    </div>
  );
}
