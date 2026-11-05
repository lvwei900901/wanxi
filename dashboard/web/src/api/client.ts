export type ParamValue = string | number | boolean | string[] | undefined | null;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function buildQuery(params?: Record<string, ParamValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** 统一走同源 /api，由 Vite 代理到 NestJS（生产环境交给网关） */
export async function apiGet<T>(
  path: string,
  params?: Record<string, ParamValue>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}${buildQuery(params)}`, {
    signal,
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join('；') : body.message;
      }
    } catch {
      /* 响应不是 JSON，保留默认文案 */
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}
