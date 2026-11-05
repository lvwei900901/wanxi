import type { ReactNode } from 'react';

/**
 * 分节标题：一根实发丝线 + 编号 + 右侧延伸的细线。
 * 规格书的分节感来自「线」，不是来自大留白或图标。
 *
 * 注意 flex-wrap 与 min-w-0：窄屏下标题 + 右侧计数很容易超过一行的宽度，
 * 栅格轨道会被 min-content 撑开，整页跟着横向溢出。
 */
export default function Section({
  no,
  title,
  meta,
  id,
  children,
  className = '',
}: {
  no: string;
  title: string;
  meta?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-ink/65 pt-2.5">
        <span className="sec-no shrink-0">§ {no}</span>
        <h2 className="min-w-0 text-[16.5px] font-semibold tracking-[-0.01em]">{title}</h2>
        <span aria-hidden className="mb-[3px] h-px min-w-6 flex-1 bg-rule-2" />
        {meta && <span className="label shrink-0">{meta}</span>}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
