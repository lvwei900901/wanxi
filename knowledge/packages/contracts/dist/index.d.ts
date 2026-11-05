/**
 * 前后端共享的接口契约（纯类型，零运行时依赖）。
 *
 * 之所以手写不引 codegen：这份契约只有十几个形状，手写可读性更好，
 * 也少一层构建产物。api 侧的 DTO 类 implements 这些类型，
 * web 侧直接 import type —— 任一侧改字段不同步就编译不过。
 */
export type SourceType = 'brand' | 'series' | 'product' | 'faq' | 'scenario';
export type ProductStatus = 'active' | 'beta' | 'discontinued';
export type FaqScope = 'brand' | 'series' | 'product' | 'scenario';
export type SlugRef = {
    slug: string;
    name: string;
};
export type BrandDto = {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    website: string | null;
    foundedYear: number | null;
    headquarters: string | null;
    coreCapabilities: string[];
    logoUrl: string | null;
    ogImageUrl: string | null;
    metaTitle: string | null;
    metaDescription: string | null;
    canonicalUrl: string | null;
};
export type SeriesDto = {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    productCount: number;
    metaTitle: string | null;
    metaDescription: string | null;
    canonicalUrl: string | null;
};
export type ScenarioDto = {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    isCanonical: boolean;
    productCount: number;
    metaTitle: string | null;
    metaDescription: string | null;
};
export type FaqDto = {
    id: number;
    question: string;
    answer: string;
    answerSummary: string | null;
    scope: FaqScope;
    sortOrder: number;
};
export type ProductCardDto = {
    id: number;
    slug: string;
    name: string;
    shortDescription: string | null;
    status: ProductStatus;
    series: SlugRef;
    keyFeatures: string[];
    scenarios: SlugRef[];
    resolution: string | null;
    connectivity: string | null;
    environment: string | null;
    metaTitle: string | null;
    metaDescription: string | null;
};
export type ProductDetailDto = ProductCardDto & {
    overview: string | null;
    connectivity: string | null;
    environment: string | null;
    extraSpecs: Record<string, unknown> | null;
    aiFeatures: string[];
    faqs: FaqDto[];
    imageUrl: string | null;
    ogImageUrl: string | null;
    canonicalUrl: string | null;
    publishedAt: string | null;
    brand: {
        name: string;
        slug: string;
        website: string | null;
    };
};
export type StatsDto = {
    products: number;
    series: number;
    scenarios: number;
    faqs: number;
    chunks: number;
};
export type IndexStatusDto = {
    version: number | null;
    model: string | null;
    dimensions: number | null;
    chunkCount: number;
    builtAt: string | null;
    templateVersion: number | null;
};
/**
 * 一次 webhook 触发前，有没有真的先把内容从 Strapi 拉下来。
 *
 * 只重建不 ingest 时，重建的很可能是库里的旧内容——webhook 200、版本号 +1、
 * 站点没变。所以这一步的结果必须显式记录下来，不能靠日志碰运气。
 */
export type IndexHookIngestDto = {
    /** synced=拉取成功 · skipped=未配置 Strapi · failed=拉取失败（此时不重建） */
    status: 'synced' | 'skipped' | 'failed';
    created: number;
    updated: number;
    warnings: number;
    message?: string;
};
/**
 * 重建完成后通知 web 失效 ISR 缓存的回执。
 *
 * 没有这一步时链路是断的：ingest + reindex 都成功了，库和 API 都是最新的，
 * 但页面仍按 `revalidate = 300` 的节奏供旧 HTML——表现是「后台改了，站点五分钟不动」，
 * 极容易被误判成 ingest 没跑到。所以失效结果必须和 ingest 一样被记录下来。
 */
export type RevalidateNotifyDto = {
    /** ok=已通知并失效 · skipped=未配置 web 地址（页面回落到定时过期）· failed=web 调用失败 */
    status: 'ok' | 'skipped' | 'failed';
    /** 实际请求失效的缓存标签 */
    tags: string[];
    durationMs: number;
    /** web 返回的 HTTP 状态码：failed 时用来区分 401（token 不对）与 5xx */
    statusCode?: number;
    message?: string;
};
/** 一次由 webhook 触发的重建结果，用于回看「这次改了什么引出的重建」 */
export type IndexHookRunDto = {
    at: string;
    reason: string;
    ok: boolean;
    version: number | null;
    durationMs: number;
    embeddedChunks: number;
    /** 重建前的 ingest 结果；老版本只重建，这里为 null */
    ingest: IndexHookIngestDto | null;
    /** 重建后通知 web 失效 ISR 的结果；失败不影响重建本身 */
    revalidate: RevalidateNotifyDto | null;
    message?: string;
};
export type IndexHookStatusDto = {
    /** 累计收到的 webhook 投递数 */
    delivered: number;
    /** 实际执行的重建次数——与 delivered 的差值就是去抖省掉的空跑 */
    runs: number;
    running: boolean;
    /** 还在去抖窗口里等待合并的条目数 */
    pendingEntries: number;
    debounceMs: number;
    /** 同一批投递最多等这么久就必须重建，避免持续写入把重建无限推迟 */
    maxWaitMs: number;
    nextRunInMs: number | null;
    lastRun: IndexHookRunDto | null;
    lastError: string | null;
};
export type StrapiSyncTableDto = {
    collection: string;
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
};
/**
 * merge（默认）：只写 Strapi 明确给出的非空字段，关联仅在明确给出非空数组时重建。
 *   —— 本地补充的内容（手写的 overview、补建的场景关联）不会被残缺的远端数据抹掉。
 * mirror：整字段覆盖 + 关联整组重建，Strapi 是唯一权威源。
 */
export type StrapiSyncMode = 'merge' | 'mirror';
export type StrapiSyncReportDto = {
    baseUrl: string;
    dryRun: boolean;
    mode: StrapiSyncMode;
    durationMs: number;
    tables: StrapiSyncTableDto[];
    /** 映射时遇到的、需要人看一眼的情况（字段缺失、关联指向不存在的 slug…） */
    warnings: string[];
    /** 远端已没有、本地仍在的条目。默认只报告不删除，避免清掉 Strapi 之外的补充内容 */
    missingInStrapi: {
        products: string[];
        series: string[];
        scenarios: string[];
    };
    /** 仅在显式 prune 时非 null：按集合记录实际删掉的条数 */
    pruned: {
        products: number;
        series: number;
        scenarios: number;
    } | null;
};
export type IndexHookAckDto = {
    accepted: boolean;
    ignored?: boolean;
    why?: string;
    entry?: {
        model: string;
        event: string;
        id: string | null;
    };
    queue: IndexHookStatusDto;
};
export type ListMeta = {
    total: number;
    indexVersion: number | null;
    generatedAt: string;
};
export type ApiEnvelope<T> = {
    data: T;
    meta?: ListMeta;
};
export type SitemapEntryDto = {
    path: string;
    lastmod: string | null;
    changefreq: 'daily' | 'weekly' | 'monthly';
    priority: number;
};
export type AskRequestDto = {
    question: string;
    topK?: number;
};
export type AskCitationDto = {
    n: number;
    title: string;
    urlPath: string;
    sourceType: SourceType;
    score: number;
};
/** POST /ask 的 SSE 事件序列：citations → token… → done */
export type AskStreamEvent = {
    type: 'citations';
    citations: AskCitationDto[];
} | {
    type: 'token';
    value: string;
} | {
    type: 'done';
    degraded: boolean;
    indexVersion: number | null;
} | {
    type: 'error';
    message: string;
};
