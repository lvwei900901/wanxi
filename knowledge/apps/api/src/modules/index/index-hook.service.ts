/**
 * Strapi webhook 接收端的排队层。
 *
 * 为什么不能把 webhook 直接接到 `POST /index/reindex`：
 *  1. reindex 是同步的（跑完整个 plan + embedding 才返回），全量重建远超 Strapi 的
 *     投递超时——Strapi 记一条失败，而我们这边其实成功，两边状态对不上；
 *  2. 批量发布 20 条会连打 20 次，逐个排队等于连跑 20 遍完整 plan，后面的请求要
 *     等几十秒才开始，且全部超时。
 *
 * 所以这层做两件事：把「一段时间内的所有投递」合并成「一次处理」，
 * 并且这「一次处理」必须是 ingest → reindex 的完整链路。
 *
 * 只重建不 ingest 是最坏的组合：webhook 200、版本号 +1、日志漂亮，
 * 站点内容一动不动，因为重建时读的还是库里的旧记录。
 */
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { IndexHookIngestDto, IndexHookRunDto, IndexHookStatusDto, StrapiSyncMode } from '@kb/contracts';
import { IndexService } from './index.service';
import { StrapiSyncService } from '../sync/strapi.service';

/** 会影响知识库正文的集合。Strapi 的 model 名（非 uid） */
const ALLOWED_MODELS = new Set(['product', 'product-series', 'scenario', 'faq', 'brand']);

/** 只订阅这几类。media.* 不在其中：它的 payload 结构不同，且图片不进入文本索引 */
const ALLOWED_EVENTS = new Set([
  'entry.create',
  'entry.update',
  'entry.delete',
  'entry.publish',
  'entry.unpublish',
]);

export type HookEntry = {
  model: string;
  event: string;
  id: string | null;
  /** 去重键：同一条记录在一个窗口内被改多次，只记一次 */
  key: string;
};

export type HookVerdict =
  | { accepted: true; entry: HookEntry }
  | { accepted: false; why: string };

/** `api::product-series.product-series` → `product-series` */
function modelOf(body: Record<string, unknown>): string | null {
  const uid = typeof body.uid === 'string' ? body.uid : '';
  if (uid.includes('::')) {
    const rest = uid.split('::')[1] ?? '';
    const name = rest.split('.')[0];
    if (name) return name;
  }
  const model = typeof body.model === 'string' ? body.model : '';
  return model || null;
}

/**
 * 只从 payload 里取「哪条记录变了」，不信任 entry 的业务字段。
 *
 * Strapi 5 移除了 webhooks.populateRelations，关联字段填充与否不可配置，
 * 不同版本、不同内容类型给回来的 entry 形状都不一样。内容本身一律回库读。
 */
function idOf(entry: Record<string, unknown>): string | null {
  const documentId = entry.documentId;
  if (typeof documentId === 'string' && documentId) return documentId;
  const id = entry.id;
  if (typeof id === 'number' || typeof id === 'string') return String(id);
  return null;
}

export function parseStrapiHook(body: unknown): HookVerdict {
  if (!body || typeof body !== 'object') return { accepted: false, why: 'payload 不是对象' };
  const b = body as Record<string, unknown>;

  const event = typeof b.event === 'string' ? b.event : '';
  if (!event) return { accepted: false, why: '缺乏 event 字段' };

  if (event.startsWith('media.')) {
    return { accepted: false, why: '媒体事件不影响文本索引' };
  }
  if (!ALLOWED_EVENTS.has(event)) {
    return { accepted: false, why: `未订阅的事件 ${event}` };
  }

  const model = modelOf(b);
  if (!model) return { accepted: false, why: '缺乏 model / uid 字段' };
  if (!ALLOWED_MODELS.has(model)) {
    return { accepted: false, why: `未订阅的集合 ${model}` };
  }

  const rawEntry =
    b.entry && typeof b.entry === 'object' ? (b.entry as Record<string, unknown>) : {};
  const id = idOf(rawEntry);
  return { accepted: true, entry: { model, event, id, key: `${model}:${id ?? '-'}` } };
}

/** `strapi: product.update#nova-x4 faq.create#12` —— 重建日志里能直接看出是哪次改动 */
function reasonOf(entries: HookEntry[]): string {
  const brief = entries
    .slice(0, 3)
    .map((e) => `${e.model}.${e.event.replace(/^entry\./, '')}${e.id ? `#${e.id}` : ''}`)
    .join(' ');
  const extra = entries.length - 3;
  const text = `strapi: ${brief}${extra > 0 ? ` +${extra}` : ''}`;
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

@Injectable()
export class IndexHookService implements OnModuleDestroy {
  private readonly logger = new Logger(IndexHookService.name);
  private readonly debounceMs: number;
  /**
   * 去抖的上限。纯尾端去抖有个致命弱点：只要一直有人保存，定时器就一直被推后，
   * 重建可以无限推迟——站点内容会长时间停在旧版本。所以再加一道「最多等这么久」。
   */
  private readonly maxWaitMs: number;

  private timer: NodeJS.Timeout | null = null;
  private deadline: number | null = null;
  /** 本批第一条投递到达的时刻，用来算 maxWait 还能等多久 */
  private firstPendingAt: number | null = null;
  private readonly pending = new Map<string, HookEntry>();

  private running = false;
  private delivered = 0;
  private runs = 0;
  private lastRun: IndexHookRunDto | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(IndexService) private readonly index: IndexService,
    @Inject(StrapiSyncService) private readonly strapi: StrapiSyncService,
  ) {
    const raw = Number(process.env.REINDEX_DEBOUNCE_MS ?? 4000);
    this.debounceMs = Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 60_000) : 4000;

    const rawWait = Number(process.env.REINDEX_MAX_WAIT_MS ?? 15_000);
    this.maxWaitMs =
      Number.isFinite(rawWait) && rawWait >= this.debounceMs
        ? Math.min(rawWait, 300_000)
        : Math.max(this.debounceMs * 3, 15_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 收下一次投递，立刻返回排队状态；重活在定时器里做 */
  enqueue(entry: HookEntry): IndexHookStatusDto {
    this.delivered += 1;
    if (this.pending.size === 0) this.firstPendingAt = Date.now();
    this.pending.set(entry.key, entry);
    this.schedule(this.debounceMs);
    return this.status();
  }

  status(): IndexHookStatusDto {
    return {
      delivered: this.delivered,
      runs: this.runs,
      running: this.running,
      pendingEntries: this.pending.size,
      debounceMs: this.debounceMs,
      maxWaitMs: this.maxWaitMs,
      nextRunInMs: this.deadline === null ? null : Math.max(0, this.deadline - Date.now()),
      lastRun: this.lastRun,
      lastError: this.lastError,
    };
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    const now = Date.now();
    // 尾端去抖与「本批最多等 maxWait」取较小值：批次结束后正常收敛，
    // 持续写入时也不会无限推迟
    const wait =
      this.firstPendingAt === null
        ? delayMs
        : Math.min(delayMs, Math.max(0, this.maxWaitMs - (now - this.firstPendingAt)));
    this.deadline = now + wait;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = null;
      void this.flush();
    }, wait);
    // 不要让一个待触发的 webhook 拖住进程退出（CLI / 测试场景）
    this.timer.unref?.();
  }

  /**
   * 重建前的 ingest。
   *
   * 未配置 Strapi 时降级成「只重建」而不是失败：本地开发、只跑接口验收时没有远端，
   * webhook 仍然该把队列跑通。但这个降级必须写进 lastRun——线上漏配 STRAPI_URL
   * 的表现恰好是「一切正常，内容就是不变」，最容易误判。
   */
  private async ingestFromStrapi(): Promise<IndexHookIngestDto> {
    if (!process.env.STRAPI_URL?.trim()) {
      return { status: 'skipped', created: 0, updated: 0, warnings: 0, message: '未配置 STRAPI_URL' };
    }
    const mode: StrapiSyncMode = process.env.STRAPI_SYNC_MODE === 'mirror' ? 'mirror' : 'merge';
    try {
      const report = await this.strapi.sync({ mode });
      return {
        status: 'synced',
        created: report.tables.reduce((sum, t) => sum + t.created, 0),
        updated: report.tables.reduce((sum, t) => sum + t.updated, 0),
        warnings: report.warnings.length,
        ...(report.warnings.length > 0 ? { message: report.warnings.slice(0, 3).join('; ') } : {}),
      };
    } catch (err) {
      return {
        status: 'failed',
        created: 0,
        updated: 0,
        warnings: 0,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async flush(): Promise<void> {
    // 重建期间又到了投递时刻：什么都不做，等当前这轮结束再统一调度
    if (this.running) return;

    const entries = [...this.pending.values()];
    this.pending.clear();
    this.firstPendingAt = null;
    // 空跑会白白造出一个新版本（version+1），必须挡掉
    if (entries.length === 0) return;

    this.running = true;
    const reason = reasonOf(entries);
    const startedAt = Date.now();
    let ingest: IndexHookIngestDto = { status: 'skipped', created: 0, updated: 0, warnings: 0 };
    try {
      ingest = await this.ingestFromStrapi();
      // ingest 失败还去重建，等于把旧内容重新打包一遍：日志变绿、版本号 +1、内容没变
      if (ingest.status === 'failed') {
        throw new Error(`Strapi 拉取失败，已跳过重建：${ingest.message ?? '未知原因'}`);
      }
      const result = await this.index.reindex({ reason, log: (m) => this.logger.log(m) });
      this.runs += 1;
      this.lastRun = {
        at: new Date().toISOString(),
        reason,
        ok: true,
        version: result.version,
        durationMs: result.durationMs,
        embeddedChunks: result.embeddedChunks,
        ingest,
        revalidate: result.revalidate,
      };
      this.lastError = null;
      this.logger.log(
        `webhook 重建完成 v${result.version ?? '-'} · ingest +${ingest.created}/~${ingest.updated} · ` +
          `ISR ${result.revalidate?.status ?? 'skipped'} · ${result.durationMs}ms · ${reason}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.runs += 1;
      this.lastRun = {
        at: new Date().toISOString(),
        reason,
        ok: false,
        version: null,
        durationMs: Date.now() - startedAt,
        embeddedChunks: 0,
        ingest,
        // 重建都没成，也没有新内容需要让页面失效
        revalidate: null,
        message,
      };
      this.lastError = message;
      this.logger.error(`webhook 重建失败：${message}`);
    } finally {
      this.running = false;
      // 重建期间攒下的投递重新走一次去抖窗口，让批量导入继续合并
      if (this.pending.size > 0) this.schedule(this.debounceMs);
    }
  }
}
