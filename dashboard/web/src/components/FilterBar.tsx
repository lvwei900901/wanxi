import type { ReactNode } from 'react';
import { DatePicker, Segmented, Select, Tag } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { shiftDays } from '../lib/format';

const { RangePicker } = DatePicker;
const DATE_FMT = 'YYYY-MM-DD';

interface Props {
  brands: { name: string; records: number }[];
  brand: string;
  from: string;
  to: string;
  bounds: { from: string; to: string } | null;
  pending: boolean;
  onChange: (next: { brand?: string; from?: string; to?: string }) => void;
  /** 右端动作位（AI Insight 入口）。筛选栏吸顶常驻，入口不跟着页面滚走 */
  action?: ReactNode;
}

const parse = (value: string): Dayjs | null => (value ? dayjs(value) : null);

export function FilterBar({
  brands,
  brand,
  from,
  to,
  bounds,
  pending,
  onChange,
  action,
}: Props) {
  const presets = bounds
    ? [
        { key: 'all', label: '全部', from: bounds.from, to: bounds.to },
        { key: '7', label: '末 7 天', from: shiftDays(bounds.to, -6), to: bounds.to },
        { key: '14', label: '末 14 天', from: shiftDays(bounds.to, -13), to: bounds.to },
      ]
    : [];

  const activePreset = presets.find((p) => p.from === from && p.to === to)?.key;
  const disabled = !bounds;

  return (
    <div className="filters">
      <div className="shell filters__inner">
        <div className="field">
          <label className="field__label" htmlFor="filter-brand">
            品牌
          </label>
          <Select
            id="filter-brand"
            value={brand || undefined}
            disabled={disabled}
            loading={brands.length === 0}
            placeholder="选择品牌"
            // 宽度走 CSS 变量：中等宽度要收窄控件给右侧入口腾位置，
            // 内联写死 196 的话媒体查询就改不动了
            style={{ width: 'var(--filter-brand-w)' }}
            onChange={(value: string) => onChange({ brand: value })}
            options={brands.map((item) => ({
              value: item.name,
              label: `${item.name}（${item.records} 条）`,
            }))}
          />
        </div>

        <div className="field">
          <span className="field__label" aria-hidden="true">
            周期
          </span>
          <RangePicker
            value={[parse(from), parse(to)]}
            disabled={disabled}
            allowClear={false}
            format={DATE_FMT}
            separator="→"
            placeholder={['开始日期', '结束日期']}
            style={{ width: 'var(--filter-range-w)' }}
            presets={presets.map((preset) => ({
              label: preset.label,
              value: [dayjs(preset.from), dayjs(preset.to)],
            }))}
            // disabledDate={(current) => {
            //   if (!bounds) return false;
            //   return (
            //     current.isBefore(dayjs(bounds.from), 'day') ||
            //     current.isAfter(dayjs(bounds.to), 'day')
            //   );
            // }}
            onChange={(dates) => {
              const [start, end] = dates ?? [];
              if (!start || !end) return;
              onChange({ from: start.format(DATE_FMT), to: end.format(DATE_FMT) });
            }}
          />
        </div>

        <Segmented
          value={activePreset ?? ''}
          options={presets.map((preset) => ({ label: preset.label, value: preset.key }))}
          onChange={(value) => {
            const preset = presets.find((item) => item.key === value);
            if (preset) onChange({ from: preset.from, to: preset.to });
          }}
        />

        <span className="filters__meta" aria-live="polite">
          {pending ? (
            <Tag color="processing" bordered={false}>
              正在刷新
            </Tag>
          ) : (
            `已选 ${from || '—'} → ${to || '—'}`
          )}
        </span>

        {action && <div className="filters__action">{action}</div>}
      </div>
    </div>
  );
}
