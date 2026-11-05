import { apiGet, ApiError, type ParamValue } from './client';

export type InsightRole = 'user' | 'assistant';

export interface InsightMessageItem {
  id: number;
  role: InsightRole;
  content: string;
  created_at: string;
}

export interface InsightHistory {
  session_id: string | null;
  /** 会话自己的品牌与区间；切换会话时用它判断要不要同步看板筛选 */
  brand: string | null;
  period_from: string | null;
  period_to: string | null;
  messages: InsightMessageItem[];
}

export interface SessionSummaryItem {
  id: string;
  title: string | null;
  brand: string;
  period_from: string;
  period_to: string;
  message_count: number;
  updated_at: string;
}

export interface SessionsResponse {
  items: SessionSummaryItem[];
}

export interface ChatPayload {
  session_id?: string;
  brand?: string;
  from?: string;
  to?: string;
  message: string;
}

export interface DoneInfo {
  message_id: number;
  usage: { prompt_tokens: number; completion_tokens: number };
}

export interface ChatHandlers {
  onMeta?: (info: { session_id: string; user_message_id: number }) => void;
  onDelta: (text: string) => void;
  onDone?: (info: DoneInfo) => void;
  onError?: (message: string) => void;
}

export function fetchInsightHistory(
  params: Record<string, ParamValue>,
): Promise<InsightHistory> {
  return apiGet<InsightHistory>('/insight/history', params);
}

/**
 * 侧栏的会话列表。
 *
 * 只按 brand 过滤、不传区间：列表要覆盖这个品牌的全部历史，
 * 否则用户把看板切到别的月份之后就再也看不到旧对话了。
 */
export function fetchInsightSessions(
  params: Record<string, ParamValue>,
): Promise<SessionsResponse> {
  return apiGet<SessionsResponse>('/insight/sessions', params);
}

interface SseEvent {
  event: string;
  data: string;
}

/** 解析一个 SSE 事件块（两条空行之间的内容） */
function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }

  return data.length > 0 ? { event, data: data.join('\n') } : null;
}

/**
 * 逐个消费服务端推来的 SSE 事件。
 *
 * 用 fetch + ReadableStream 而不是 EventSource：EventSource 只支持 GET，
 * 而这里要把问题放在 body 里发过去。
 */
export async function streamInsightChat(
  payload: ChatPayload,
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/insight/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join('；') : body.message;
      }
    } catch {
      /* 非 JSON 响应，保留默认文案 */
    }
    throw new ApiError(message, response.status);
  }

  if (!response.body) {
    throw new ApiError('浏览器不支持流式响应', 500);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block: string): void => {
    const parsed = parseBlock(block);
    if (!parsed) return;

    let data: unknown;
    try {
      data = JSON.parse(parsed.data);
    } catch {
      return;
    }

    if (parsed.event === 'meta') {
      handlers.onMeta?.(data as { session_id: string; user_message_id: number });
    } else if (parsed.event === 'delta') {
      handlers.onDelta((data as { text: string }).text);
    } else if (parsed.event === 'done') {
      handlers.onDone?.(data as DoneInfo);
    } else if (parsed.event === 'error') {
      handlers.onError?.((data as { message: string }).message);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }

    // 服务端正常收尾时会补上结尾空行；异常中断时这里兜底处理残留
    if (buffer.trim()) dispatch(buffer);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
