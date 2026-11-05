import Link from 'next/link';

export type Crumb = { name: string; path?: string };

/**
 * 面包屑。用「/」分隔而不是 ›，因为整站的语言是路径与编号；
 * 末项不加链接，也用墨色区分当前层级。
 */
export default function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="label flex flex-wrap items-center gap-x-2 gap-y-1">
        {trail.map((item, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${item.name}-${i}`} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden className="text-rule-2">
                  /
                </span>
              )}
              {item.path && !last ? (
                <Link
                  href={item.path}
                  className="text-ink-3 underline-offset-4 transition hover:text-ink hover:underline"
                >
                  {item.name}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="text-ink-2">
                  {item.name}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
