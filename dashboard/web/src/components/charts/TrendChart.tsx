import { Chart } from '@antv/g2';
import { useEffect, useMemo, useRef } from 'react';
import type { TrendPoint } from '../../api/types';
import { CHART } from '../../lib/constants';
import { shortDate } from '../../lib/format';

interface Props {
  data: TrendPoint[];
  overall: number;
}

const WINDOW = 7;

export function TrendChart({ data, overall }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () =>
      data.map((point, index) => {
        const slice = data.slice(Math.max(0, index - WINDOW + 1), index + 1);
        const mean = slice.reduce((sum, item) => sum + item.visibility, 0) / slice.length;
        return {
          date: point.date,
          daily: point.visibility,
          rolling: Math.round(mean * 10) / 10,
          mentions: point.mentions,
          series: '滚动均值',
        };
      }),
    [data],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || rows.length === 0) return;

    const chart = new Chart({ container, autoFit: true, height: 300 });
    chart.data(rows);

    chart.scale('x', { type: 'band', paddingInner: 0.45, paddingOuter: 0.12 });
    chart.scale('y', { domain: [0, 100], nice: false });
    chart.scale('color', { domain: ['滚动均值'], range: [CHART.ink] });
    chart.legend(false);

    chart.axis('x', {
      title: false,
      line: false,
      tick: false,
      labelTransform: 'rotate(0)',
      labelTextAlign: 'center',
      labelFill: CHART.faint,
      labelFontSize: 10,
      labelFontFamily: CHART.mono,
      labelSpacing: 8,
      labelFormatter: (value: string) => shortDate(value),
      labelFilter: (_value: string, index: number) =>
        rows.length <= 10 ? true : index % 5 === 0 || index === rows.length - 1,
    });

    chart.axis('y', {
      title: false,
      line: false,
      tick: false,
      labelFill: CHART.faint,
      labelFontSize: 10,
      labelFontFamily: CHART.mono,
      labelSpacing: 6,
      labelFormatter: (value: number) => `${value}%`,
      grid: true,
      gridStroke: CHART.ruleSoft,
      gridLineWidth: 1,
    });

    const noMotion = {
      enter: { duration: 0 },
      update: { duration: 0 },
      exit: false as const,
    };

    chart
      .interval()
      .data(rows)
      .encode('x', 'date')
      .encode('y', 'daily')
      .style('fill', CHART.accentFaint)
      .animate(noMotion);

    if (rows.length > 1) {
      chart
        .line()
        .data([
          { date: rows[0].date, baseline: overall },
          { date: rows[rows.length - 1].date, baseline: overall },
        ])
        .encode('x', 'date')
        .encode('y', 'baseline')
        .style('stroke', CHART.ruleStrong)
        .style('lineWidth', 1)
        .style('lineDash', [2, 4])
        .tooltip(false)
        .animate(noMotion);
    }

    chart
      .line()
      .data(rows)
      .encode('x', 'date')
      .encode('y', 'rolling')
      .encode('color', 'series')
      .style('lineWidth', 2)
      .style('lineJoin', 'round')
      .animate(noMotion);

    chart.render();
    return () => chart.destroy();
  }, [rows, overall]);

  return <div className="chart-canvas" ref={containerRef} style={{ height: 300 }} />;
}
