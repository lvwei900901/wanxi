'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/products', label: 'Products', no: '01' },
  { href: '/scenarios', label: 'Scenarios', no: '02' },
  { href: '/ask', label: 'Ask', no: '03' },
];

/**
 * 顶部导航。用 usePathname 判断当前段，而不是靠页面各自传 prop——
 * 详情页 /products/nova-x4 也要点亮 Products。
 */
export default function SiteNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Primary" className="flex shrink-0 items-stretch">
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex items-center gap-1.5 px-2 py-2 transition-colors sm:px-3.5 ${
              active ? 'text-ink' : 'text-ink-3 hover:text-ink'
            }`}
          >
            <span className="label hidden tabular-nums sm:inline">{item.no}</span>
            <span className="text-[12px] font-medium tracking-tight sm:text-[13px]">
              {item.label}
            </span>
            <span
              aria-hidden
              className={`absolute inset-x-2 -bottom-px h-px bg-signal transition-transform duration-300 ease-out sm:inset-x-3.5 ${
                active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
              }`}
              style={{ transformOrigin: 'left' }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
