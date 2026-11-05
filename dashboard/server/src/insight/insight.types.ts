/**
 * AI Insight 的接口契约。
 *
 * 与 dashboard 一致：对外用 snake_case，前端不再做字段映射。
 */

export type ChatRole = 'user' | 'assistant';

export interface ChatMessageItem {
  id: number;
  role: ChatRole;
  content: string;
  /** ISO 8601 */
  created_at: string;
}

/** GET /api/insight/history */
export interface HistoryResponse {
  /** 该「品牌 + 区间」下最近一次会话；没有历史时为 null */
  session_id: string | null;
  /**
   * 会话自己的品牌与区间。
   * 前端切换会话时靠它判断「要不要把看板切到另一段时间」，
   * 不用再去列表里反查。
   */
  brand: string | null;
  period_from: string | null;
  period_to: string | null;
  messages: ChatMessageItem[];
}

/** GET /api/insight/sessions 的单条记录 */
export interface SessionSummary {
  id: string;
  /** 首条提问截断；理论上不会为空，但历史数据可能是 null */
  title: string | null;
  brand: string;
  period_from: string;
  period_to: string;
  /** 该会话的消息条数（user + assistant） */
  message_count: number;
  /** ISO 8601，列表按此倒序 */
  updated_at: string;
}

export interface SessionsResponse {
  items: SessionSummary[];
}

/* ---------- SSE 事件负载 ---------- */

/** 第一个事件：告诉前端会话落到了哪个 id 上，后续提问带上它 */
export interface MetaEvent {
  session_id: string;
  user_message_id: number;
}

export interface DeltaEvent {
  text: string;
}

export interface DoneEvent {
  message_id: number;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export interface ErrorEvent {
  message: string;
}
