import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, type ParamValue } from '../api/client';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * 以「路径 + 参数快照」为依赖的最小请求 hook。
 * 参数用序列化后的字符串做依赖，避免对象字面量每次渲染都触发重新请求。
 */
export function useApi<T>(
  path: string,
  params: Record<string, ParamValue>,
  enabled = true,
): AsyncState<T> {
  const key = useMemo(() => JSON.stringify(params), [params]);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let alive = true;

    setLoading(true);
    setError(null);

    apiGet<T>(path, JSON.parse(key) as Record<string, ParamValue>, controller.signal)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : '网络异常，请稍后重试');
        setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [path, key, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload };
}

/** 详情按 id 拉取，切换记录时清空旧内容 */
export function useRecordDetail<T>(id: number | null): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (id === null) {
      setData(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);

    apiGet<T>(`/records/${id}`, undefined, controller.signal)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : '明细加载失败');
        setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [id, nonce]);

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
