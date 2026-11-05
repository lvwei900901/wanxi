/**
 * AskAI 代理：浏览器只与本域通信，上游地址与凭据留在服务端。
 *
 * 直接把 SSE 流透传，不缓冲、不改写，前端拿到的事件格式与 apps/api 完全一致。
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const payload = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: payload,
    });
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', message: '知识服务暂时不可用，请确认 API 已启动' })}\n\n`,
      { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
