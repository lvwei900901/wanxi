'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export type FilterItem = { href: string; label: string; count: number | null; active: boolean };

/**
 * 系列筛选条。
 *
 * 用 <a href> + 拦截点击而不是纯按钮：中键/⌘ 点击仍然能新开标签页（内容站常被这么用），
 * 同时用 router.push 走客户端导航，transition 的 pending 状态给用户一个「正在换页」的信号。
 */
export default function SeriesFilter({ items }: { items: FilterItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="navigation"
      aria-label="Filter by series"
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-2 transition-opacity duration-200 ${
        pending ? 'opacity-55' : 'opacity-100'
      }`}
    >
      <span className="label mr-1.5">Series</span>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            startTransition(() => router.push(item.href, { scroll: false }));
          }}
          className={`group inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[12.5px] transition-colors duration-200 ${
            item.active
              ? 'border-ink bg-ink text-paper'
              : 'border-rule-2 text-ink-2 hover:border-ink hover:text-ink'
          }`}
        >
          {item.label}
          {item.count !== null && (
            <span
              className={`code text-[10.5px] tabular-nums ${
                item.active ? 'text-paper/55' : 'text-ink-3'
              }`}
            >
              {item.count}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}
