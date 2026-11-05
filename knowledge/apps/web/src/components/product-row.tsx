import Link from 'next/link';

/** 索引行与表头共用同一条栅格定义，避免两处各写一套导致列错位 */
export const ROW_GRID =
  'grid grid-cols-[1.75rem_minmax(0,1fr)_1rem] items-start gap-x-3 md:grid-cols-[2.1rem_minmax(0,1fr)_7.75rem_4.25rem_10.5rem_1rem] md:gap-x-4';

export type ProductRowData = {
  slug: string;
  name: string;
  shortDescription: string | null;
  status: 'active' | 'beta' | 'discontinued';
  series: { name: string };
  resolution: string | null;
  connectivity: string | null;
  environment: string | null;
  scenarios: { name: string }[];
};

/**
 * 目录行的信息取舍：
 * short_description 在源数据里是按系列套模板生成的（「X4 属于 Nova 系列，面向仓储与
 * 企业监控」），同系列 20 行几乎一字不差——占一整行却不帮任何忙。这里换成真正逐行
 * 变化的两个规格（接入方式、使用环境）作为规格摘要：短、可扫、相邻两行必然不同。
 */
export function ProductRow({ product, no }: { product: ProductRowData; no: number }) {
  const scenarios = product.scenarios.map((s) => s.name);
  const shown = scenarios.slice(0, 2).join(' · ');
  const rest = scenarios.length - 2;

  const spec = [product.connectivity, product.environment].filter(Boolean) as string[];
  // 两个规格都缺时退回短描述，避免整行空掉
  const specLine = spec.length > 0 ? spec.join(' · ') : product.shortDescription;
  const mobileMeta = [product.series.name, product.resolution].filter(Boolean) as string[];

  return (
    <li className="border-b border-rule">
      <Link href={`/products/${product.slug}`} className={`index-row group ${ROW_GRID} py-4 pr-2 pl-3`}>
        <span className="code pt-[3px] text-ink-3 tabular-nums">{String(no).padStart(2, '0')}</span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15.5px] font-medium tracking-tight text-ink transition-colors duration-200 group-hover:text-signal-deep">
              {product.name}
            </span>
            {product.status === 'beta' && <span className="badge badge-signal">Beta</span>}
            {product.status === 'discontinued' && <span className="badge">Discontinued</span>}
          </div>

          <p className="mt-1 hidden max-w-[62ch] text-[13px] leading-5 text-ink-2 md:block">
            {specLine}
          </p>

          {/* 窄屏没有表头列，用两条定长元信息代替：规格一行、系列与分辨率一行。
              压成一行时会在折行处留下一个孤零零的「·」，读起来像个列表符号。 */}
          <div className="mt-1.5 flex flex-col gap-0.5 text-[11.5px] leading-4 text-ink-3 md:hidden">
            {spec.length > 0 && (
              <span className="whitespace-nowrap">{spec.join(' · ')}</span>
            )}
            <span className="whitespace-nowrap">
              {mobileMeta.map((part, i) => (
                <span key={part}>
                  {i > 0 && <span aria-hidden> · </span>}
                  <span className={i === mobileMeta.length - 1 ? 'code' : undefined}>{part}</span>
                </span>
              ))}
            </span>
          </div>
        </div>

        <span className="hidden truncate pt-[5px] text-[11.5px] text-ink-2 md:block">
          {product.series.name}
        </span>

        <span className="code hidden pt-[3px] text-ink-2 md:block">{product.resolution ?? '—'}</span>

        <span className="hidden truncate pt-[5px] text-[11.5px] text-ink-3 md:block">
          {scenarios.length > 0 ? (
            <>
              {shown}
              {rest > 0 && <span className="opacity-70"> +{rest}</span>}
            </>
          ) : (
            '—'
          )}
        </span>

        <span aria-hidden className="row-arrow justify-self-end pt-[3px] text-ink-3">
          →
        </span>
      </Link>
    </li>
  );
}
