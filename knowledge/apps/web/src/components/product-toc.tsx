'use client';

import { useEffect, useState } from 'react';

export type TocItem = { id: string; label: string; no: string };

/**
 * 详情页目录。滚动时高亮当前小节，点击用原生锚点（保留 ⌘ 点击/右键复制的能力）。
 *
 * IntersectionObserver 的 rootMargin 把检测带压到视口上方 25%：
 * 否则「刚进入视口底部」的段落会抢走高亮，读起来会觉得指示器跳得太早。
 */
export default function ProductToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    const nodes = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-25% 0px -65% 0px', threshold: 0 },
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="On this page" className="flex flex-col">
      <span className="label mb-2.5">On this page</span>
      <ul className="flex flex-col">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={isActive ? 'true' : undefined}
                className={`group flex items-baseline gap-2 border-l py-1.5 pl-2.5 text-[12.5px] leading-5 transition-colors duration-200 ${
                  isActive
                    ? 'border-signal text-ink'
                    : 'border-rule text-ink-3 hover:border-rule-2 hover:text-ink-2'
                }`}
              >
                <span className={`sec-no text-[10px] ${isActive ? 'opacity-100' : 'opacity-45'}`}>
                  {item.no}
                </span>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
