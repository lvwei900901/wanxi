import type { Metadata } from 'next';
import Link from 'next/link';
import { listScenarios } from '@/lib/api';
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo';
import Breadcrumbs from '@/components/breadcrumbs';
import Section from '@/components/section';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Deployment scenarios',
  description:
    'Every deployment scenario AsterVision products are built for — from warehouse and retail floor to perimeter and critical infrastructure.',
  alternates: { canonical: '/scenarios' },
  openGraph: {
    type: 'website',
    url: '/scenarios',
    title: 'Deployment scenarios | AsterVision',
    description: 'Find the right AsterVision product by deployment scenario.',
  },
};

type Scenario = Awaited<ReturnType<typeof listScenarios>>[number];

function ScenarioRows({
  items,
  startAt = 1,
  muted = false,
}: {
  items: Scenario[];
  startAt?: number;
  muted?: boolean;
}) {
  return (
    <ul className="border-t border-rule">
      {items.map((s, i) => (
        <li key={s.slug} className="border-b border-rule">
          <Link
            href={`/scenarios/${s.slug}`}
            className="index-row group grid grid-cols-[1.75rem_minmax(0,1fr)_1rem] items-start gap-x-3 py-4 pr-2 pl-3 md:grid-cols-[2.1rem_minmax(0,11rem)_minmax(0,1fr)_5.5rem_1rem] md:items-center md:gap-x-4"
          >
            <span className="code pt-0.5 text-ink-3 tabular-nums md:pt-0">
              {String(startAt + i).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <span
                className={`text-[15px] font-medium tracking-tight transition-colors duration-200 group-hover:text-signal-deep ${
                  s.productCount === 0 ? 'text-ink-3' : muted ? 'text-ink-2' : 'text-ink'
                }`}
              >
                {s.name}
              </span>
              <p className="mt-1 line-clamp-1 text-[13px] leading-5 text-ink-2 md:hidden">
                {s.description ?? 'Derived from product best-fit tagging.'}
              </p>
            </div>
            <p className="hidden text-[13px] leading-5 text-ink-2 md:block">
              {s.description ?? 'Derived from product best-fit tagging; description pending review.'}
            </p>
            {/* 「0 PRODUCTS」读起来像坏链：这条场景确实存在、也有页面，只是还没有产品
                被指派过来，所以直说 None yet，而不是报一个零 */}
            <span className="label hidden justify-self-end text-right md:block">
              {s.productCount === 0 ? (
                <span className="text-ink-3">None yet</span>
              ) : (
                `${s.productCount} ${s.productCount === 1 ? 'product' : 'products'}`
              )}
            </span>
            <span aria-hidden className="row-arrow justify-self-end pt-0.5 text-ink-3 md:pt-0">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function ScenariosPage() {
  const scenarios = await listScenarios();
  const canonical = scenarios.filter((s) => s.isCanonical);
  const derived = scenarios.filter((s) => !s.isCanonical);

  return (
    <div className="flex flex-col gap-10">
      <Breadcrumbs trail={[{ name: 'Home', path: '/' }, { name: 'Scenarios' }]} />

      <header className="flex flex-col gap-5 pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h1 className="text-[clamp(1.9rem,3.6vw,2.6rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            Deployment scenarios
          </h1>
          <span className="label">{scenarios.length} contexts</span>
        </div>
        <p className="prose-measure text-[14.5px] leading-7 text-ink-2">
          Every product is tagged with the deployments it is designed for. Start from the site you
          are planning and work back to the hardware — the reverse of a spec sheet.
        </p>
      </header>

      {scenarios.length === 0 ? (
        <div className="notice notice-warn">
          <span className="label pt-0.5">Empty</span>
          <p className="text-[13.5px] leading-6 text-ink-2">
            No scenarios available. The content API returned nothing — check that the API service is
            running.
          </p>
        </div>
      ) : (
        <>
          <Section no="01" title="Official scenarios" meta={`${canonical.length} curated`}>
            <ScenarioRows items={canonical} />
          </Section>

          {derived.length > 0 && (
            <Section
              no="02"
              title="Additional deployment contexts"
              meta={`${derived.length} derived`}
            >
              <p className="prose-measure mb-4 text-[13.5px] leading-6 text-ink-3">
                These contexts appear in product best-fit tagging but have not been written up by the
                product team yet. They are kept visible so no product is unreachable.
              </p>
              <ScenarioRows items={derived} startAt={canonical.length + 1} muted />
            </Section>
          )}
        </>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: 'Home', path: '/' },
              { name: 'Scenarios', path: '/scenarios' },
            ]),
          ),
        }}
      />
    </div>
  );
}
