import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchInsightHistory,
  fetchInsightSessions,
  streamInsightChat,
  type SessionSummaryItem,
} from '../../api/insight';

export interface UiMessage {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export interface InsightScope {
  brand: string;
  from: string;
  to: string;
}

interface Options {
  /** 会话列表最多取多少条 */
  limit?: number;
  /**
   * 切换到一条属于别的日期区间的会话时通知外部。
   *
   * AI 的回答永远绑定在某段区间的数据上，脱离区间讲结论没有意义，
   * 所以这里直接把看板也切过去，两边保持同源。
   */
  onScopeChange?: (scope: InsightScope) => void;
}

const DEFAULT_LIMIT = 30;

/**
 * 抽屉的会话状态机。
 *
 * 三条不变式：
 * 1. 会话列表按「品牌」拉，跨区间 —— 切日期不会让旧对话消失。
 * 2. 当前会话必须与看板区间一致，否则提问会落到别的区间（后端也会拒绝复用）。
 * 3. 「新对话」只是本地草稿态：清空视图但不发请求，首条消息才真正建会话。
 */
export function useInsightChat(
  scope: InsightScope | null,
  open: boolean,
  options: Options = {},
) {
  const { limit = DEFAULT_LIMIT } = options;

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummaryItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  /** 当前会话 id。send 要读最新值，不能用闭包里的 state */
  const activeRef = useRef<string | null>(null);
  /** 刚点了「新对话」，下一条消息才建会话 */
  const freshRef = useRef(false);
  const sendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  // 回调放进 ref：父组件每次渲染传新函数时，不该让这里的 useCallback 全部失效
  const scopeChangeRef = useRef(options.onScopeChange);
  scopeChangeRef.current = options.onScopeChange;

  const nextKey = (role: string): string => {
    seqRef.current += 1;
    return `${role}-${seqRef.current}`;
  };

  const applyMessages = (rows: { id: number; role: 'user' | 'assistant'; content: string }[]) => {
    setMessages(
      rows.map((item) => ({
        key: `s-${item.id}`,
        role: item.role,
        content: item.content,
      })),
    );
  };

  const loadMessages = useCallback(async (id: string) => {
    setLoadingHistory(true);
    try {
      const data = await fetchInsightHistory({ session_id: id });
      applyMessages(data.messages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '历史加载失败');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  /** 只刷列表，不动当前对话。发完一条消息后调用，让标题与条数跟着变 */
  const refreshSessions = useCallback(async () => {
    if (!scope) return;
    try {
      const data = await fetchInsightSessions({ brand: scope.brand, limit });
      setSessions(data.items);
    } catch {
      /* 列表刷新失败不影响对话本身，保持旧列表 */
    }
    // scope 的 from/to 不参与请求，但品牌变了要重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.brand, limit]);

  // 打开抽屉、切品牌、切区间时对齐服务端状态
  useEffect(() => {
    if (!open || !scope) return;

    let alive = true;
    setLoadingHistory(true);

    fetchInsightSessions({ brand: scope.brand, limit })
      .then(async (list) => {
        if (!alive) return;
        setSessions(list.items);

        // 「新对话」草稿态：列表照常显示，但当前视图留空
        if (freshRef.current) {
          setActiveSessionId(null);
          activeRef.current = null;
          setMessages([]);
          return;
        }

        const inRange = (item: SessionSummaryItem): boolean =>
          item.period_from === scope.from && item.period_to === scope.to;

        // 优先留住当前会话（切换后区间已经同步过来了）；否则取该区间最近一条
        const current = activeRef.current
          ? list.items.find((item) => item.id === activeRef.current)
          : undefined;
        const target = current && inRange(current) ? current : list.items.find(inRange);

        if (!target) {
          setActiveSessionId(null);
          activeRef.current = null;
          setMessages([]);
          return;
        }

        setActiveSessionId(target.id);
        activeRef.current = target.id;
        const data = await fetchInsightHistory({ session_id: target.id });
        if (!alive) return;
        applyMessages(data.messages);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : '历史加载失败');
      })
      .finally(() => {
        if (alive) setLoadingHistory(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope?.brand, scope?.from, scope?.to, limit]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  /** 从侧栏切换会话 */
  const switchSession = useCallback(
    (id: string) => {
      if (sendingRef.current) return;
      const target = sessions.find((item) => item.id === id);
      if (!target) return;

      setActiveSessionId(id);
      activeRef.current = id;
      freshRef.current = false;
      setError(null);

      const sameRange =
        scope !== null &&
        target.period_from === scope.from &&
        target.period_to === scope.to;

      if (!sameRange) {
        // 区间不同：先让看板切过去。effect 会因为 scope 变化重跑，
        // 那时 activeRef 已经指向这条会话，会把它加载进来
        scopeChangeRef.current?.({
          brand: target.brand,
          from: target.period_from,
          to: target.period_to,
        });
        return;
      }

      controllerRef.current?.abort();
      void loadMessages(id);
    },
    [sessions, scope?.from, scope?.to, loadMessages],
  );

  /** 新对话：清空视图但不发请求，首条消息由后端建会话 */
  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeRef.current = null;
    freshRef.current = true;
    sendingRef.current = false;
    setActiveSessionId(null);
    setMessages([]);
    setError(null);
    setStatus('idle');
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || !scope || sendingRef.current) return;

      const userKey = nextKey('user');
      const aiKey = nextKey('ai');

      setMessages((prev) => [
        ...prev,
        { key: userKey, role: 'user', content: text },
        { key: aiKey, role: 'assistant', content: '', streaming: true },
      ]);
      setStatus('sending');
      setError(null);
      sendingRef.current = true;

      const controller = new AbortController();
      controllerRef.current = controller;

      const patchAi = (patch: Partial<UiMessage>): void => {
        setMessages((prev) =>
          prev.map((item) => (item.key === aiKey ? { ...item, ...patch } : item)),
        );
      };

      try {
        await streamInsightChat(
          {
            session_id: activeRef.current ?? undefined,
            brand: scope.brand,
            from: scope.from,
            to: scope.to,
            message: text,
          },
          {
            onMeta: (info) => {
              activeRef.current = info.session_id;
              setActiveSessionId(info.session_id);
              // 新会话已经建好，之后再打开抽屉或切区间就该认这条了
              freshRef.current = false;
            },
            onDelta: (chunk) => {
              setMessages((prev) =>
                prev.map((item) =>
                  item.key === aiKey
                    ? { ...item, content: item.content + chunk }
                    : item,
                ),
              );
            },
            onDone: () => patchAi({ streaming: false }),
            onError: (message) => {
              setError(message);
              patchAi({ streaming: false });
            },
          },
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          // 用户主动停止：保留已经出来的内容
          patchAi({ streaming: false });
        } else {
          setError(err instanceof Error ? err.message : '生成失败，请重试');
          patchAi({ streaming: false });
        }
      } finally {
        setMessages((prev) =>
          prev.map((item) =>
            item.key === aiKey && item.streaming
              ? { ...item, streaming: false }
              : item,
          ),
        );
        setStatus('idle');
        sendingRef.current = false;
        controllerRef.current = null;
        // 标题、消息条数、新会话的出现都要靠列表刷新才能反映出来
        void refreshSessions();
      }
    },
    [scope?.brand, scope?.from, scope?.to, refreshSessions],
  );

  return {
    messages,
    sessions,
    activeSessionId,
    status,
    error,
    loadingHistory,
    send,
    stop,
    reset,
    switchSession,
    clearError: useCallback(() => setError(null), []),
  };
}
