import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col gap-6 py-10">
      <div className="flex items-center gap-3">
        <span className="sec-no">Error</span>
        <span aria-hidden className="h-px w-6 bg-rule-2" />
        <span className="label">404 — not in the index</span>
      </div>

      <h1 className="max-w-[22ch] text-[clamp(2rem,4.4vw,3rem)] leading-[1.04] font-semibold tracking-[-0.035em]">
        This page isn&apos;t on the sheet.
      </h1>

      <p className="prose-measure text-[14.5px] leading-7 text-ink-2">
        The product or page you were looking for does not exist, or has been unpublished since the
        last build. Everything currently documented is reachable from the catalogue.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link href="/products" className="btn">
          Open the catalogue
          <span aria-hidden className="arrow">
            →
          </span>
        </Link>
        <Link href="/ask" className="btn btn-ghost">
          Ask the knowledge base
        </Link>
      </div>
    </div>
  );
}
