/**
 * ISR 按需失效入口：`POST /api/revalidate`（Bearer WEB_REVALIDATE_TOKEN）。
 *
 * 谁调它：apps/api 在 reindex 成功后（见 modules/revalidate/revalidate.service.ts）。
 * 为什么需要它：页面是 300s 静态产物，fetch 那层还有各自的 300s 数据缓存。
 * 后台改完、webhook 跑完、索引版本号 +1，页面却最多要等 5 分钟才换内容——
 * 这中间所有日志都是绿的，最难排查。主动失效把「库新了」和「页面新了」拉到同一秒。
 *
 * 几个刻意的选择：
 *  - **默认整站失效**（tag `kb`）：一次内容改动常常牵动多个页面，按板块失效容易漏；
 *  - **鉴权失败一律 401，未配置 token 一律 503**：这个端点能打掉全站缓存，
 *    开放出去等于给了别人一个「反复触发重渲染」的开关；
 *  - **不缓存自身响应**：失效接口被缓存就毫无意义。
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 与 apps/web/src/lib/api.ts 的 KB_TAG 保持一致：所有取数都挂着它，api 侧默认也只发这一个 */
const KB_TAG = 'kb';
const DEFAULT_TAGS = [KB_TAG];

/** 标签与路径都做白名单校验：这两个值会直接进 Next 的缓存索引，不该接受任意字符串 */
const TAG_RE = /^[A-Za-z0-9:_.-]{1,128}$/;
const PATH_RE = /^\/[A-Za-z0-9\-._~/]*$/;

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // 长度不同直接 false：timingSafeEqual 长度不等会抛异常，而异常本身就是长度侧信道
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.WEB_REVALIDATE_TOKEN?.trim();
  if (!expected) {
    return Response.json(
      {
        error: 'NotConfigured',
        message: '未配置 WEB_REVALIDATE_TOKEN，已拒绝失效请求（开放出去等于给任何人一个重渲染开关）',
      },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!given || !tokenMatches(given, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    const text = await request.text();
    payload = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: 'BadRequest', message: 'body 不是合法 JSON' }, { status: 400 });
  }
  if (payload !== null && typeof payload !== 'object') {
    return Response.json({ error: 'BadRequest', message: 'body 必须是对象' }, { status: 400 });
  }

  const { tags: rawTags, paths: rawPaths } = (payload ?? {}) as { tags?: unknown; paths?: unknown };
  const tags = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === 'string') : [];
  const paths = Array.isArray(rawPaths) ? rawPaths.filter((p): p is string => typeof p === 'string') : [];

  const badTag = tags.find((t) => !TAG_RE.test(t));
  if (badTag !== undefined) {
    return Response.json({ error: 'BadRequest', message: `非法标签：${badTag}` }, { status: 400 });
  }
  const badPath = paths.find((p) => !PATH_RE.test(p) || p.includes('..'));
  if (badPath !== undefined) {
    return Response.json({ error: 'BadRequest', message: `非法路径：${badPath}` }, { status: 400 });
  }

  // 什么都没给 = 调用方只想「整站刷新」，这是最常见的情况（api 的默认行为）
  const effectiveTags = tags.length === 0 && paths.length === 0 ? DEFAULT_TAGS : tags;

  /**
   * 两件事都得做，缺一个页面就不新：
   *  - `revalidateTag` 清的是 **fetch 数据缓存**（那一层同样有 300s）；
   *  - `revalidatePath` 清的是 **页面/路由缓存**。
   *
   * 而且只有按路径失效才会让下一次请求 **阻塞重建**（实测响应头 MISS + 新内容）；
   * 只用标签时下一次请求拿到的是 STALE——旧页面照发，后台再慢慢重建。
   * 对「改完立刻看」的场景来说，那一次旧页面正是最容易被误判成「没生效」的地方，
   * 所以整站失效时用 `revalidatePath('/', 'layout')` 把整棵树打掉。
   */
  for (const tag of effectiveTags) {
    // Next 16 的 revalidateTag 第二个参数是 cacheLife profile；
    // 这里的数据来自 fetch 缓存而非 use cache，profile 只用于计算 stale 语义，取 'max' 即「立刻过期」
    revalidateTag(tag, 'max');
  }
  if (effectiveTags.includes(KB_TAG)) {
    revalidatePath('/', 'layout');
  }
  for (const path of paths) {
    revalidatePath(path);
  }

  return Response.json({
    ok: true,
    tags: effectiveTags,
    paths,
    at: new Date().toISOString(),
  });
}

export function GET(): Response {
  return Response.json(
    {
      error: 'MethodNotAllowed',
      message: '失效请求必须使用 POST，并带 Authorization: Bearer <WEB_REVALIDATE_TOKEN>',
      body: { tags: ['kb'], paths: ['/products/xxx'] },
    },
    { status: 405, headers: { allow: 'POST' } },
  );
}
