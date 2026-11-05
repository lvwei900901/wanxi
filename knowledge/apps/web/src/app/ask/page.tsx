import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getStats } from '@/lib/api';
import Breadcrumbs from '@/components/breadcrumbs';
import Section from '@/components/section';
import AskClient from './AskClient';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Ask the knowledge base',
  description:
    'Ask a question about AsterVision products and get an answer grounded in this site’s own product documentation, with citations back to the source pages.',
  alternates: { canonical: '/ask' },
  openGraph: {
    type: 'website',
    url: '/ask',
    title: 'Ask the knowledge base | AsterVision',
    description: 'Answers grounded in AsterVision product documentation, with citations.',
  },
};

/** 控制台的占位骨架：尺寸与真实面板一致，避免 q 参数解析完成时页面跳动 */
function ConsoleSkeleton() {
  return <div className="tick-frame h-[13.5rem] border border-rule bg-paper-2/50" aria-hidden />;
}

const METHOD = [
  {
    title: 'Embed',
    body: 'Your question is mapped into the same vector space as the indexed product documentation.',
  },
  {
    title: 'Retrieve',
    body: 'The closest passages are pulled from the live index — products, series, scenarios and FAQs.',
  },
  {
    title: 'Answer',
    body: 'A language model writes the answer using only those passages, and every claim keeps its citation.',
  },
];

export default async function AskPage() {
  const stats = await getStats();

  return (
    <div className="flex flex-col gap-10">
      <Breadcrumbs trail={[{ name: 'Home', path: '/' }, { name: 'Ask' }]} />

      <header className="flex flex-col gap-5 border-b border-ink/65 pb-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="label text-signal-deep">Retrieval console</span>
          <span aria-hidden className="h-px w-5 bg-rule-2" />
          {stats && (
            <span className="label">
              {stats.chunks} indexed passages · {stats.products} products
            </span>
          )}
        </div>
        <h1 className="max-w-[22ch] text-[clamp(2rem,4.2vw,2.9rem)] leading-[1.04] font-semibold tracking-[-0.035em]">
          Ask the knowledge base
        </h1>
        <p className="prose-measure text-[14.5px] leading-7 text-ink-2">
          Answers come only from the product documentation on this site, and every answer links back
          to the pages it was built from — so you can check it instead of trusting it.
        </p>
      </header>

      <Suspense fallback={<ConsoleSkeleton />}>
        <AskClient />
      </Suspense>

      <Section no="01" title="How an answer is assembled" meta="Three steps">
        <ol className="grid gap-x-10 sm:grid-cols-3">
          {METHOD.map((step, i) => (
            <li key={step.title} className="border-t border-rule pt-3">
              <div className="flex items-baseline gap-2">
                <span className="sec-no">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="text-[13.5px] font-semibold tracking-tight">{step.title}</h3>
              </div>
              <p className="mt-1.5 text-[13px] leading-6 text-ink-2">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section no="02" title="What it will not do" meta="Scope">
        <ul className="flex flex-col">
          {[
            'It does not quote prices, stock levels or lead times — those are not in this dataset.',
            'It does not blend in outside knowledge. If the documents are silent, it says so.',
            'It does not answer from memory of the conversation: every answer re-runs retrieval.',
          ].map((line, i) => (
            <li
              key={line}
              className="flex items-baseline gap-3 border-b border-rule py-2.5 text-[13.5px] leading-6 text-ink-2"
            >
              <span className="code shrink-0 text-[11px] text-ink-3">
                {String(i + 1).padStart(2, '0')}
              </span>
              {line}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
