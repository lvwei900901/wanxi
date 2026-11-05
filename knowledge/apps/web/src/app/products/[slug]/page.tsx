import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProduct, listProductSlugs, listProducts } from '@/lib/api';
import { breadcrumbJsonLd, faqPageJsonLd, jsonLdScript, productJsonLd } from '@/lib/seo';
import Breadcrumbs from '@/components/breadcrumbs';
import CopyLink from '@/components/copy-link';
import ProductToc from '@/components/product-toc';
import Section from '@/components/section';
import { ProductRow, ROW_GRID } from '@/components/product-row';

export const revalidate = 300;

/** 构建期预渲染全部产品详情；新增产品会在下次构建或首次访问时按需生成 */
export async function generateStaticParams() {
  const slugs = await listProductSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: 'Product not found' };

  const title = product.metaTitle ?? `${product.name} — ${product.series.name}`;
  const description =
    product.metaDescription ??
    product.shortDescription ??
    `${product.name} from the ${product.series.name}.`;
  const canonical = `/products/${product.slug}`;
  const ogImage = product.ogImageUrl ?? product.imageUrl;

  return {
    // metaTitle 由 CMS/种子数据生成，已经带了 "| AsterVision"，
    // 用 absolute 跳过 layout 的 title.template，否则会出现品牌名重复
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      description,
      ...(ogImage ? { images: [{ url: ogImage, alt: product.name }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

function SpecRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-3 border-b border-rule py-2.5">
      <dt className="label w-[8.5rem] shrink-0 pt-px">{label}</dt>
      <span aria-hidden className="leader" />
      <dd className="text-right text-[13.5px] text-ink">{value}</dd>
    </div>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  const siblings = (await listProducts({ series: product.series.slug }))
    .filter((p) => p.slug !== product.slug)
    .slice(0, 4);

  const extra = Object.entries(product.extraSpecs ?? {});
  const published = product.publishedAt ? product.publishedAt.slice(0, 10) : null;
  const path = `/products/${product.slug}`;

  const sections = [
    { id: 'overview', label: 'Overview', no: '01' },
    { id: 'features', label: 'Key features', no: '02' },
    { id: 'specifications', label: 'Specifications', no: '03' },
    { id: 'best-for', label: 'Best for', no: '04' },
    { id: 'faq', label: 'FAQ', no: '05' },
  ];

  return (
    <article className="flex flex-col gap-12">
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Products', path: '/products' },
          { name: product.series.name, path: `/products?series=${product.series.slug}` },
          { name: product.name },
        ]}
      />

      {/* 标题区：左边型号，右边永久链接与更新日期，像样本册的条目头 */}
      <header className="rise flex flex-col gap-5 pb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href={`/products?series=${product.series.slug}`}
            className="label text-signal-deep underline-offset-4 hover:underline"
          >
            {product.series.name}
          </Link>
          <span aria-hidden className="h-px w-5 bg-rule-2" />
          {product.status === 'beta' && <span className="badge badge-signal">Beta</span>}
          {product.status === 'discontinued' && <span className="badge">Discontinued</span>}
          {product.status === 'active' && <span className="badge">In production</span>}
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <h1 className="text-[clamp(2.2rem,4.8vw,3.4rem)] leading-[1.02] font-semibold tracking-[-0.035em]">
            {product.name}
          </h1>
          <div className="flex flex-col gap-1.5 lg:items-end lg:pb-1.5">
            <CopyLink path={path} />
            {published && <span className="label">Updated {published}</span>}
          </div>
        </div>

        <p className="prose-measure text-[16px] leading-7 text-ink-2">
          {product.shortDescription}
        </p>
      </header>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_13.5rem] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-12">
          <Section no="01" title="Overview" id="overview">
            <p className="prose-measure text-[14.5px] leading-7 text-ink-2">{product.overview}</p>
          </Section>

          <Section
            no="02"
            title="Key features"
            id="features"
            meta={`${product.keyFeatures.length} listed`}
          >
            <ul className="grid gap-x-10 sm:grid-cols-2">
              {product.keyFeatures.map((f, i) => (
                <li
                  key={f}
                  className="flex items-baseline gap-3 border-b border-rule py-2.5 text-[14px]"
                >
                  <span className="code shrink-0 text-[11px] text-ink-3">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>{f}</span>
                  <span aria-hidden className="leader" />
                </li>
              ))}
            </ul>
          </Section>

          <Section no="03" title="Specifications" id="specifications">
            <dl className="border-t border-rule">
              <SpecRow label="Resolution" value={product.resolution} />
              <SpecRow label="Connectivity" value={product.connectivity} />
              <SpecRow label="Environment" value={product.environment} />
              {extra.map(([k, v]) => (
                <SpecRow key={k} label={k.replace(/([A-Z])/g, ' $1').trim()} value={String(v)} />
              ))}
            </dl>

            {product.aiFeatures.length > 0 && (
              <div className="mt-8">
                <div className="flex items-baseline gap-3">
                  <span className="label">On-device analytics</span>
                  <span aria-hidden className="leader" />
                  <span className="code text-[11px] text-ink-3">
                    {product.aiFeatures.length}
                  </span>
                </div>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {product.aiFeatures.map((f) => (
                    <li
                      key={f}
                      className="border border-rule-2 bg-paper-2 px-2 py-1 text-[12.5px] text-ink-2"
                    >
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section
            no="04"
            title="Best for"
            id="best-for"
            meta={`${product.scenarios.length} deployments`}
          >
            <p className="prose-measure text-[13.5px] leading-6 text-ink-3">
              Deployments this product is tagged for. Pick one to see every product that fits it.
            </p>
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {product.scenarios.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/scenarios/${s.slug}`}
                    className="group inline-flex items-center gap-1.5 border border-rule-2 px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors duration-200 hover:border-signal hover:text-signal-deep"
                  >
                    {s.name}
                    <span
                      aria-hidden
                      className="text-[11px] text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-signal"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            no="05"
            title="Frequently asked questions"
            id="faq"
            meta={`${product.faqs.length} answered`}
          >
            {product.faqs.length === 0 ? (
              <div className="notice notice-info">
                <span className="label pt-0.5">Empty</span>
                <p className="text-[13.5px] leading-6 text-ink-2">
                  No questions have been published for this product yet.
                </p>
              </div>
            ) : (
              <div className="border-t border-rule">
                {product.faqs.map((f, i) => (
                  <details
                    key={f.id}
                    className="group border-b border-rule"
                    open={i === 0}
                  >
                    <summary className="flex cursor-pointer list-none items-start gap-3 py-4 [&::-webkit-details-marker]:hidden">
                      <span className="code shrink-0 pt-0.5 text-[11px] text-ink-3 transition-colors group-open:text-signal-deep">
                        Q{String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="flex-1 text-[14.5px] leading-6 font-medium text-ink">
                        {f.question}
                      </span>
                      <span aria-hidden className="relative mt-[7px] h-2.5 w-2.5 shrink-0">
                        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-3 transition-colors duration-200 group-open:bg-signal-deep" />
                        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink-3 transition-transform duration-300 ease-out group-open:scale-y-0 group-open:bg-signal-deep" />
                      </span>
                    </summary>
                    <p className="prose-measure mr-6 pb-4 pl-9 text-[13.5px] leading-6 text-ink-2">
                      {f.answerSummary ?? f.answer}
                    </p>
                  </details>
                ))}
              </div>
            )}
          </Section>

          {siblings.length > 0 && (
            <Section no="06" title={`More in ${product.series.name}`} id="related">
              <div className={`${ROW_GRID} hidden border-b border-ink/65 pb-2 pl-3 md:grid`}>
                <span className="label">Ref</span>
                <span className="label">Model</span>
                <span className="label">Series</span>
                <span className="label">Max res</span>
                <span className="label">Scenarios</span>
                <span />
              </div>
              <ul>
                {siblings.map((p, i) => (
                  <ProductRow key={p.slug} product={p} no={i + 1} />
                ))}
              </ul>
            </Section>
          )}
        </div>

        {/* 侧栏：目录 + 条目索引卡。窄屏隐藏，因为内容不长，不值得占一屏 */}
        <aside className="order-first hidden lg:order-last lg:block">
          <div className="sticky top-20 flex flex-col gap-6">
            <ProductToc items={sections} />

            <div className="border-t border-rule pt-4">
              <span className="label">Entry</span>
              <dl className="mt-2 flex flex-col gap-1.5 text-[12px]">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-ink-3">Series</dt>
                  <dd className="text-right text-ink-2">{product.series.name}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-ink-3">Status</dt>
                  <dd className="text-right text-ink-2 capitalize">{product.status}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-ink-3">Questions</dt>
                  <dd className="text-right text-ink-2 tabular-nums">{product.faqs.length}</dd>
                </div>
              </dl>
            </div>

            <Link
              href={`/ask?q=${encodeURIComponent(`Tell me about ${product.name}`)}`}
              className="label flex items-center gap-1.5 border-t border-rule pt-4 text-ink-2 transition hover:text-signal-deep"
            >
              Ask about this model
              <span aria-hidden>→</span>
            </Link>
          </div>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-6">
        <p className="label">
          Published by {product.brand.name}
          {product.brand.website ? (
            <>
              {' · '}
              <a
                href={product.brand.website}
                className="text-ink-2 underline-offset-4 hover:text-ink hover:underline"
              >
                Official site
              </a>
            </>
          ) : null}
        </p>
        <Link href="/products" className="label transition hover:text-ink">
          ← All products
        </Link>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: 'Home', path: '/' },
              { name: 'Products', path: '/products' },
              { name: product.series.name, path: `/products?series=${product.series.slug}` },
              { name: product.name, path: `/products/${product.slug}` },
            ]),
          ),
        }}
      />
      {product.faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(faqPageJsonLd(product.faqs)) }}
        />
      )}
    </article>
  );
}
