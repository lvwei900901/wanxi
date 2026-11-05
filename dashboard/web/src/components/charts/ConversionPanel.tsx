import type { DashboardSummary } from '../../api/types';
import { ratioPct } from '../../lib/format';

interface Props {
  summary: DashboardSummary;
}

export function ConversionPanel({ summary }: Props) {
  const { mentions, recommendations, questions_analyzed: total } = summary;
  const held = mentions - recommendations;
  const absent = total - mentions;

  const share = (value: number) => `${ratioPct(value, total)}%`;

  return (
    <div className="conversion">
      <div>
        <div className="conversion__flow">
          <span className="conversion__num">{mentions}</span>
          <svg
            className="conversion__arrow"
            width="30"
            height="12"
            viewBox="0 0 30 12"
            aria-hidden="true"
          >
            <path
              d="M0 6h26m0 0-5-4.5M26 6l-5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
          <span className="conversion__num conversion__num--rec">{recommendations}</span>
        </div>
        <p className="conversion__caption" style={{ marginTop: 8 }}>
          被提及 → 被推荐　进入推荐名单的比例{' '}
          <b style={{ color: 'var(--ink)' }}>
            {ratioPct(recommendations, mentions)}%
          </b>
        </p>
      </div>

      <div>
        <div className="stack" role="img" aria-label={`推荐 ${recommendations} 次，提及未推荐 ${held} 次，未提及 ${absent} 次，共 ${total} 次提问`}>
          <div
            className="stack__seg stack__seg--rec"
            style={{ flexGrow: recommendations }}
            title={`推荐 ${recommendations} 次`}
          >
            {recommendations / total > 0.14 ? recommendations : ''}
          </div>
          <div
            className="stack__seg stack__seg--held"
            style={{ flexGrow: held }}
            title={`提及但未推荐 ${held} 次`}
          >
            {held / total > 0.14 ? held : ''}
          </div>
          <div
            className="stack__seg stack__seg--absent"
            style={{ flexGrow: absent }}
            title={`未提及 ${absent} 次`}
          >
            {absent / total > 0.14 ? absent : ''}
          </div>
        </div>
      </div>

      <ul className="ledger">
        <li className="ledger__row">
          <span className="ledger__swatch" style={{ background: 'var(--accent)' }} />
          进入推荐名单
          <span className="ledger__dots" />
          <span className="ledger__val">
            <b>{recommendations}</b> · {share(recommendations)}
          </span>
        </li>
        <li className="ledger__row">
          <span
            className="ledger__swatch"
            style={{
              background:
                'repeating-linear-gradient(135deg, var(--accent-wash) 0 3px, var(--paper-sunk) 3px 6px)',
            }}
          />
          提及但未推荐
          <span className="ledger__dots" />
          <span className="ledger__val">
            <b>{held}</b> · {share(held)}
          </span>
        </li>
        <li className="ledger__row">
          <span className="ledger__swatch" style={{ background: 'var(--paper-sunk)' }} />
          完全未提及
          <span className="ledger__dots" />
          <span className="ledger__val">
            <b>{absent}</b> · {share(absent)}
          </span>
        </li>
      </ul>

      <p className="insight">
        {mentions} 次提及里有 <b>{held}</b> 次没有进入推荐名单（
        {ratioPct(held, mentions)}%）——这是可见度之外更容易被忽略的流失。
      </p>
    </div>
  );
}
