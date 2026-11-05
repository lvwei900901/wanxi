import type { DashboardSummary } from '../api/types';
import { diffDaysInclusive, formatCount, prettyDate } from '../lib/format';

interface Props {
  brand: string | null;
  period: { from: string; to: string } | null;
  summary: DashboardSummary | null;
  platformCount: number | null;
  topicCount: number | null;
}

export function Masthead({
  brand,
  period,
  summary,
  platformCount,
  topicCount,
}: Props) {
  const days = period ? diffDaysInclusive(period.from, period.to) : null;

  const facts = [
    { key: '观测期', value: days, unit: '天' },
    { key: '回答样本', value: summary?.questions_analyzed ?? null, unit: '条' },
    { key: '平台', value: platformCount, unit: '个' },
    { key: '主题', value: topicCount, unit: '个' },
  ];

  return (
    <header className="masthead">
      <div className="masthead__rail">
        <span className="mono-label">AI Visibility · 监测报告</span>
        <span className="mono-label masthead__vintage">
          {period ? `Data vintage ${prettyDate(period.to)}` : 'Reading data…'}
        </span>
      </div>

      <div className="masthead__body">
        <div>
          <h1 className="masthead__title">
            {brand ?? '—'}
            <span className="sep">/</span>
            <span className="soft">AI 可见度监测</span>
          </h1>
          <p className="masthead__lede">
            5 个 AI 平台上的真实提问，被逐条判定：有没有提到品牌、有没有进入推荐名单、引用了哪些来源。
            页面上每一个百分比都能回溯到下方明细里的具体那几行回答。
          </p>
        </div>

        <div className="facts">
          {facts.map((fact) => (
            <div className="fact" key={fact.key}>
              <div className="fact__value">
                {fact.value === null ? '—' : formatCount(fact.value)}
                <small>{fact.unit}</small>
              </div>
              <span className="fact__key mono-label">{fact.key}</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
