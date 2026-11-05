import { useMemo } from 'react';
import type { TopicMetric } from '../../api/types';
import { CHART } from '../../lib/constants';
import { useElementWidth } from '../../lib/useElementWidth';

interface Props {
  data: TopicMetric[];
}

const LABEL_W = 118;
const VALUE_W = 40;
const ROW_H = 34;
const PAD_TOP = 8;
const AXIS_H = 22;

export function TopicBars({ data }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();

  const rows = useMemo(
    () => [...data].sort((a, b) => b.visibility - a.visibility),
    [data],
  );

  const height = rows.length * ROW_H + PAD_TOP + AXIS_H;
  const plotW = Math.max(80, width - LABEL_W - VALUE_W);
  const x = (value: number) => LABEL_W + (value / 100) * plotW;
  const top = PAD_TOP;
  const bottom = height - AXIS_H;

  const best = rows[0];
  const worst = rows[rows.length - 1];

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {width > 0 && rows.length > 0 && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={
            best && worst
              ? `各主题可见度，最高 ${best.topic} ${best.visibility}%，最低 ${worst.topic} ${worst.visibility}%。`
              : '各主题可见度'
          }
        >
          {[0, 50, 100].map((tick) => (
            <g key={tick}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={top - 2}
                y2={bottom}
                stroke={CHART.ruleSoft}
                strokeWidth={1}
                strokeDasharray={tick === 0 ? undefined : '1 3'}
              />
              <text
                x={x(tick)}
                y={height - 6}
                textAnchor={tick === 0 ? 'start' : tick === 100 ? 'end' : 'middle'}
                fill={CHART.faint}
                fontFamily={CHART.mono}
                fontSize={9}
              >
                {tick}%
              </text>
            </g>
          ))}

          {rows.map((row, index) => {
            const y = top + index * ROW_H + ROW_H / 2;
            const barW = (row.visibility / 100) * plotW;

            return (
              <g key={row.topic}>
                <title>
                  {`${row.topic}：可见度 ${row.visibility}%，${row.questions} 次提问，${row.recommendations} 次推荐`}
                </title>
                <text
                  x={LABEL_W - 10}
                  y={y + 3.5}
                  textAnchor="end"
                  fill={CHART.inkSoft}
                  fontFamily={CHART.sans}
                  fontSize={11}
                >
                  {row.topic}
                </text>
                <rect
                  x={x(0)}
                  y={y - 6}
                  width={Math.max(barW, 1.5)}
                  height={12}
                  fill={CHART.accent}
                  fillOpacity={0.8}
                />
                <text
                  x={x(row.visibility) + 7}
                  y={y + 3.5}
                  fill={CHART.muted}
                  fontFamily={CHART.mono}
                  fontSize={9.5}
                >
                  {row.visibility}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
