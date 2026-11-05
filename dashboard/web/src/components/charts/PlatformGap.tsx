import { useMemo } from 'react';
import type { PlatformMetric } from '../../api/types';
import { CHART } from '../../lib/constants';
import { ratioPct } from '../../lib/format';
import { useElementWidth } from '../../lib/useElementWidth';

interface Props {
  data: PlatformMetric[];
}

const LABEL_W = 92;
const VALUE_W = 58;
const ROW_H = 44;
const PAD_TOP = 6;
const AXIS_H = 24;

export function PlatformGap({ data }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();

  const rows = useMemo(
    () =>
      [...data]
        .map((item) => ({
          ...item,
          recRate: ratioPct(item.recommendations, item.question_count),
        }))
        .sort((a, b) => b.visibility - a.visibility),
    [data],
  );

  const height = rows.length * ROW_H + PAD_TOP + AXIS_H;
  const plotW = Math.max(120, width - LABEL_W - VALUE_W);
  const x = (value: number) => LABEL_W + (value / 100) * plotW;
  const top = PAD_TOP;
  const bottom = height - AXIS_H;

  const ticks = [0, 25, 50, 75, 100];
  const best = rows[0];
  const worst = rows.reduce(
    (min, item) => (item.visibility < min.visibility ? item : min),
    best,
  );

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {width > 0 && rows.length > 0 && (
        <svg
          className="dumbbell"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={
            best
              ? `各平台可见度与推荐率对比。可见度最高的是 ${best.name} ${best.visibility}%，最低的是 ${worst.name} ${worst.visibility}%。`
              : '各平台可见度与推荐率对比'
          }
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="db-grid"
                x1={x(tick)}
                x2={x(tick)}
                y1={top}
                y2={bottom}
              />
              <text
                className="db-axis"
                x={x(tick)}
                y={height - 8}
                textAnchor="middle"
              >
                {tick}%
              </text>
            </g>
          ))}

          {rows.map((row, index) => {
            const y = top + index * ROW_H + ROW_H / 2;
            const visX = x(row.visibility);
            const recX = x(row.recRate);

            return (
              <g className="db-row" key={row.name}>
                <title>
                  {`${row.name}：可见度 ${row.visibility}%，推荐率 ${row.recRate}%（${row.question_count} 次提问）`}
                </title>

                <line className="db-link" x1={visX} x2={recX} y1={y} y2={y} />

                <circle cx={visX} cy={y} r={4.6} className="db-dot--vis" />
                <circle cx={recX} cy={y} r={4} className="db-dot--rec" />

                <text className="db-name" x={0} y={y - 2}>
                  {row.name}
                </text>
                <text className="db-count" x={0} y={y + 11}>
                  n={row.question_count}
                </text>

                <text x={LABEL_W + plotW + 10} y={y + 3.5}>
                  <tspan fill={CHART.accent} fontFamily={CHART.mono} fontSize={11}>
                    {row.visibility}
                  </tspan>
                  <tspan fill={CHART.ruleStrong} fontFamily={CHART.mono} fontSize={10}>
                    {' / '}
                  </tspan>
                  <tspan fill={CHART.blue} fontFamily={CHART.mono} fontSize={10}>
                    {row.recRate}
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
