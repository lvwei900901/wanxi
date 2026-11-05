/**
 * 索引重建端点已迁到 apps/api：POST /api/v1/index/reindex（Bearer REINDEX_TOKEN）。
 *
 * web 侧保留这个路由只为给出明确信号——旧的 Strapi webhook 若仍指向这里，
 * 会立刻看到 410 与正确地址，而不是一个"看起来成功但什么都没做"的 200。
 */
const API_REINDEX =
  (process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1') + '/index/reindex';

export function POST() {
  return Response.json(
    {
      error: 'Gone',
      message: '索引重建已迁到后端服务，请改为调用 POST /api/v1/index/reindex（Bearer REINDEX_TOKEN）',
      endpoint: API_REINDEX,
    },
    { status: 410 },
  );
}

export function GET() {
  return Response.json(
    { message: '索引重建使用 POST /api/v1/index/reindex', endpoint: API_REINDEX },
    { status: 410 },
  );
}
