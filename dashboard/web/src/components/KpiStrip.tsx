import type { ReactNode } from 'react';
import type { DashboardSummary } from '../api/types';
import { formatCount, ratioPct } from '../lib/format';

interface Props {
  summary: DashboardSummary | null;
  loading: boolean;
}

interface KpiItem {
  key: string;
  label: string;
  value: number;
  unit: string;
  meta: ReactNode;
  bar?: number;
  accent?: boolean;
}

export function KpiStrip({ summary, loading }: Props) {
  if (!summary) {
    return (
      <section className="kpis" aria-label="核心指标" aria-busy={loading}>
        {[0, 1, 2, 3].map((index) => (
          <article className="kpi" key={index}>
            <div className="kpi__label">
              <span className="kpi__dot" />
              <span className="sk sk--line" style={{ width: 60, height: 8 }} />
            </div>
            <div className="sk sk--num" />
            <div className="sk sk--line short" style={{ marginTop: 12, height: 8 }} />
          </article>
        ))}
      </section>
    );
  }

  const { mentions, recommendations, citations, questions_analyzed: total } = summary;
  const gap = total - mentions;

  const items: KpiItem[] = [
    {
      key: 'visibility',
      label: '可见度',
      value: summary.visibility_score,
      unit: '%',
      meta: (
        <>
          提及 <b>{mentions}</b> / {total} 次提问
        </>
      ),
      bar: summary.visibility_score,
      accent: true,
    },
    {
      key: 'recommendation',
      label: '被推荐',
      value: ratioPct(recommendations, total),
      unit: '%',
      meta: (
        <>
          提及后被推荐 <b>{ratioPct(recommendations, mentions)}%</b>（{recommendations}/{mentions}）
        </>
      ),
      bar: ratioPct(recommendations, total),
    },
    {
      key: 'citations',
      label: '引用来源',
      value: citations,
      unit: '条',
      meta: (
        <>
          平均每次提及 <b>{(citations / Math.max(mentions, 1)).toFixed(1)}</b> 条引用
        </>
      ),
    },
    {
      key: 'gap',
      label: '提及缺口',
      value: gap,
      unit: '次',
      meta: (
        <>
          占全部提问 <b>{ratioPct(gap, total)}%</b>，回答里完全没有这个品牌
        </>
      ),
      bar: ratioPct(gap, total),
    },
  ];

  return (
    <section className="kpis" aria-label="核心指标">
      {items.map((item) => (
        <article className={`kpi${item.accent ? ' kpi--accent' : ''}`} key={item.key}>
          <div className="kpi__label">
            <span className="kpi__dot" aria-hidden="true" />
            <span className="mono-label">{item.label}</span>
          </div>
          <div className="kpi__value">
            <span className="kpi__num">{formatCount(item.value)}</span>
            <span className="kpi__unit">{item.unit}</span>
          </div>
          <p className="kpi__meta">{item.meta}</p>
          {item.bar !== undefined && (
            <div className="kpi__bar" aria-hidden="true">
              <span style={{ width: `${Math.min(item.bar, 100)}%` }} />
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
