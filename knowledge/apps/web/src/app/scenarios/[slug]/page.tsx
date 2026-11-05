import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listProducts, listScenarios } from '@/lib/api';
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo';
import Breadcrumbs from '@/components/breadcrumbs';
import Section from '@/components/section';
import { ProductRow, ROW_GRID } from '@/components/product-row';

export const revalidate = 300;

export async function generateStaticParams() {
  const scenarios = await listScenarios();
  return scenarios.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const scenario = (await listScenarios()).find((s) => s.slug === slug);
  if (!scenario) return { title: 'Scenario not found' };

  const description =
    scenario.description ??
    `AsterVision products suited to ${scenario.name}: specifications, features and deployment notes.`;
  const canonical = `/scenarios/${scenario.slug}`;

  return {
    title: `${scenario.name} solutions`,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', url: canonical, title: `${scenario.name} | AsterVision`, description },
  };
}

export default async function ScenarioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const scenarios = await listScenarios();
  const scenario = scenarios.find((s) => s.slug === slug);
  if (!scenario) notFound();

  const products = await listProducts({ scenario: slug });
  const others = scenarios.filter((s) => s.slug !== slug && s.productCount > 0).slice(0, 6);

  return (
    <div className="flex flex-col gap-10">
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Scenarios', path: '/scenarios' },
          { name: scenario.name },
        ]}
      />

      <header className="rise flex flex-col gap-5 pb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="label text-signal-deep">Deployment scenario</span>
          <span aria-hidden className="h-px w-5 bg-rule-2" />
          <span className="label">
            {products.length} {products.length === 1 ? 'product' : 'products'} fitted
          </span>
        </div>
        <h1 className="max-w-[26ch] text-[clamp(2rem,4.4vw,3.1rem)] leading-[1.04] font-semibold tracking-[-0.035em]">
          {scenario.name}
        </h1>
        <p className="prose-measure text-[14.5px] leading-7 text-ink-2">
          {scenario.description ??
            `Products tagged for ${scenario.name}. Select one to see specifications, features and FAQs.`}
        </p>
      </header>

      <Section no="01" title="Products for this deployment" meta={`${products.length} matched`}>
        {products.length === 0 ? (
          <div className="notice notice-info">
            <span className="label pt-0.5">None</span>
            <p className="text-[13.5px] leading-6 text-ink-2">
              No product is tagged for this scenario yet. Ask the knowledge base which model comes
              closest.
            </p>
          </div>
        ) : (
          <div>
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
          </div>
        )}
      </Section>

      {others.length > 0 && (
        <Section no="02" title="Other deployments" meta="Browse sideways">
          <ul className="flex flex-wrap gap-1.5">
            {others.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/scenarios/${s.slug}`}
                  className="group inline-flex items-center gap-1.5 border border-rule-2 px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors duration-200 hover:border-signal hover:text-signal-deep"
                >
                  {s.name}
                  <span className="code text-[10.5px] text-ink-3">{s.productCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: 'Home', path: '/' },
              { name: 'Scenarios', path: '/scenarios' },
              { name: scenario.name, path: `/scenarios/${scenario.slug}` },
            ]),
          ),
        }}
      />
    </div>
  );
}
