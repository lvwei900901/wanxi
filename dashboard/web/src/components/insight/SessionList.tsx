import { Conversations } from '@ant-design/x';
import { PlusOutlined } from '@ant-design/icons';
import type { SessionSummaryItem } from '../../api/insight';
import { monthDay } from '../../lib/format';

interface Props {
  items: SessionSummaryItem[];
  activeId: string | null;
  /** 发送中禁止切换，避免请求落在错误的会话上 */
  disabled?: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

/** 08-01 / 08-01 这种同月区间只写一次月份，跨月才写两头 */
function rangeLabel(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth
    ? `${monthDay(from)}–${monthDay(to).slice(3)}`
    : `${monthDay(from)}–${monthDay(to)}`;
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : monthDay(iso.slice(0, 10));
}

/**
 * 抽屉左侧的会话列表。
 *
 * 桌面端常驻在抽屉里，窄屏时同一份实例渲染进单独的历史抽屉 ——
 * 数据和回调都在外面，这里只管展示。
 */
export function SessionList({ items, activeId, disabled = false, onSelect, onCreate }: Props) {
  const options = items.map((item) => ({
    key: item.id,
    disabled,
    label: (
      <span className="session-item">
        <span className="session-item__title">{item.title || '未命名对话'}</span>
        <span className="session-item__meta">
          {rangeLabel(item.period_from, item.period_to)} · {item.message_count} 条 ·{' '}
          {ago(item.updated_at)}
        </span>
      </span>
    ),
  }));

  return (
    <div className="session-list">
      <button
        type="button"
        className="session-new"
        onClick={onCreate}
        disabled={disabled}
      >
        <PlusOutlined />
        新对话
      </button>

      <p className="session-list__head">对话记录 · {items.length}</p>

      {items.length === 0 ? (
        <p className="session-list__empty">还没有历史对话，问第一句就会出现在这里。</p>
      ) : (
        <Conversations
          className="session-list__items"
          items={options}
          activeKey={activeId ?? undefined}
          onActiveChange={(key) => onSelect(String(key))}
        />
      )}
    </div>
  );
}
