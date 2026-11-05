import type { Metadata } from 'next';
import Link from 'next/link';
import { getBrand, getStats, listSeries } from '@/lib/api';
import Section from '@/components/section';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'AsterVision Product Knowledge Center',
  description:
    'Browse every AsterVision AI video security product by series, compare specifications and features, and see which deployments each product is built for.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    title: 'AsterVision Product Knowledge Center',
    description:
      'Structured product knowledge: series, specifications, features, best-fit scenarios and FAQs.',
  },
};

const COUNTER_KEYS = [
  { key: 'products', label: 'Products' },
  { key: 'series', label: 'Series' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'faqs', label: 'Questions' },
] as const;

export default async function HomePage() {
  const [brand, series, stats] = await Promise.all([getBrand(), listSeries(), getStats()]);
  const name = brand?.name ?? 'AsterVision';

  return (
    <div className="flex flex-col gap-16 sm:gap-20">
      {/* 封面：左标题 + 右索引块。索引块是这个站点的「铭牌」*/}
      <section className="rise grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:gap-12">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="label text-ink-2">Product index</span>
            <span aria-hidden className="h-px w-6 bg-rule-2" />
            {brand?.foundedYear && <span className="label">Est. {brand.foundedYear}</span>}
            {brand?.headquarters && <span className="label">{brand.headquarters}</span>}
          </div>

          <h1 className="max-w-[26ch] text-[clamp(2.3rem,4.9vw,3.5rem)] leading-[1.04] font-semibold tracking-[-0.035em] text-balance">
            AI video security, documented product by product.
          </h1>

          <p className="prose-measure text-[15px] leading-7 text-ink-2">
            {brand?.description ??
              `Every ${name} product, specification, feature and deployment scenario in one place — written to be read by people, and parsed by search engines and AI assistants.`}
          </p>

          <div className="mt-1 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <Link href="/products" className="btn justify-between sm:justify-start">
              Browse the catalogue
              <span aria-hidden className="arrow">
                →
              </span>
            </Link>
            <Link href="/ask" className="btn btn-ghost justify-between sm:justify-start">
              Ask the knowledge base
            </Link>
          </div>
        </div>

        {/* 铭牌：四个计数 + 数据来源说明，用标尺线与刻角收边 */}
        <aside className="tick-frame border border-rule bg-paper-2/70">
          <div className="border-b border-rule px-4 py-2.5">
            <span className="label">Index summary</span>
          </div>
          <dl className="grid grid-cols-2">
            {COUNTER_KEYS.map((item, i) => (
              <div
                key={item.key}
                className={`px-4 py-3.5 ${i % 2 === 1 ? 'border-l border-rule' : ''} ${
                  i > 1 ? 'border-t border-rule' : ''
                }`}
              >
                <dt className="label">{item.label}</dt>
                <dd className="mt-1 text-[26px] leading-none font-medium tabular-nums tracking-[-0.02em]">
                  {stats ? String(stats[item.key]).padStart(2, '0') : '—'}
                </dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-rule px-4 py-3 text-[11.5px] leading-5 text-ink-3">
            One structured dataset behind every page. Answers cite the page they came from.
          </p>
        </aside>
      </section>

      <Section
        no="01"
        title="Product series"
        meta={<Link href="/products" className="transition hover:text-ink">All products →</Link>}
      >
        <ul className="border-t border-rule">
          {series.map((s, i) => (
            <li key={s.slug} className="border-b border-rule">
              <Link
                href={`/products?series=${s.slug}`}
                className="index-row group grid grid-cols-[1.75rem_minmax(0,1fr)_1rem] items-start gap-x-3 py-4 pr-2 pl-3 md:grid-cols-[2.1rem_minmax(0,10rem)_minmax(0,1fr)_5.5rem_1rem] md:items-center md:gap-x-4"
              >
                <span className="code pt-0.5 text-ink-3 tabular-nums md:pt-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <span className="text-[15.5px] font-medium tracking-tight transition-colors duration-200 group-hover:text-signal-deep">
                    {s.name}
                  </span>
                  <p className="mt-1 line-clamp-1 text-[13px] leading-5 text-ink-2 md:hidden">
                    {s.description}
                  </p>
                </div>
                <p className="hidden text-[13px] leading-5 text-ink-2 md:block">{s.description}</p>
                <span className="label hidden justify-self-end text-right md:block">
                  {s.productCount} {s.productCount === 1 ? 'product' : 'products'}
                </span>
                <span aria-hidden className="row-arrow justify-self-end pt-0.5 text-ink-3 md:pt-0">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {brand && brand.coreCapabilities.length > 0 && (
        <Section no="02" title="Core capabilities" meta={`${brand.coreCapabilities.length} areas`}>
          {/* 点线引线只有在右边有「值」时才成立；这里右侧本来是空的，引线就成了
              纯噪音。改成四格能力带，用 gap-px + 底色画出发丝分隔线。 */}
          <ul className="grid grid-cols-2 gap-px border-y border-rule bg-rule sm:grid-cols-4">
            {brand.coreCapabilities.map((cap, i) => (
              <li key={cap} className="flex flex-col gap-2 bg-paper px-4 py-4">
                <span className="label text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-[14.5px] leading-5 font-medium tracking-tight">{cap}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 收尾：把 Ask 当作目录的「索引员」，而不是营销 CTA */}
      <section className="tick-frame border border-rule bg-ink text-paper">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-3">
            <span className="label text-paper/50">§ 03 — Retrieval</span>
            <h2 className="max-w-[24ch] text-[26px] leading-[1.15] font-semibold tracking-[-0.02em]">
              Ask in plain language. Get an answer with sources.
            </h2>
            <p className="max-w-[52ch] text-[14px] leading-6 text-paper/65">
              The answer is assembled from this site&apos;s own product pages. If the documents
              don&apos;t cover your question, it says so instead of guessing.
            </p>
            <div className="mt-2">
              <Link
                href="/ask"
                className="btn border-paper/30 bg-transparent text-paper hover:border-signal hover:bg-signal-deep"
              >
                Open the console
                <span aria-hidden className="arrow">
                  →
                </span>
              </Link>
            </div>
          </div>

          <ul className="flex flex-col justify-center gap-px self-stretch">
            {[
              'Which products support 4K imaging?',
              'Which product works offline without a network?',
              'Nova X4 or Thermal T4 for a perimeter?',
            ].map((q) => (
              <li key={q} className="border-t border-paper/15 first:border-t-0">
                <Link
                  href={`/ask?q=${encodeURIComponent(q)}`}
                  className="group flex items-baseline gap-2 py-2.5 text-[13px] leading-5 text-paper/75 transition hover:text-paper"
                >
                  <span aria-hidden className="text-signal">
                    ›
                  </span>
                  {q}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
