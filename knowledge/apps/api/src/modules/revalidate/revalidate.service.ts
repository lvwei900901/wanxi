/**
 * 重建成功后，通知 web 立刻失效 ISR 缓存。
 *
 * 为什么必须由 API 主动通知，而不是让页面自己等：
 * 页面是 `revalidate = 300` 的静态产物，fetch 那层还各自有 300s 的数据缓存。
 * 内容改完，库里和 API 立刻是新的，页面却最多要等 5 分钟——而这个等待期里
 * 后台、webhook、日志全都是绿的，看不出任何问题。只有主动失效能让三者同拍。
 *
 * 三条硬约束，决定这里的写法：
 *  1. **不能拖慢重建**：通知失败绝不能让一次已经成功的事务回滚成失败。
 *     所以超时短（默认 3s）、异常全吞、结果只记录不抛出；
 *  2. **不能猜地址**：未配置 WEB_REVALIDATE_URL 时明确记 skipped，
 *     而不是静默成功——「配置漏了」和「已经失效了」必须能被区分；
 *  3. **不能无鉴权**：web 侧要 token，否则任何人 POST 一下就能把全站页面打回重渲染。
 */
import { Injectable, Logger } from '@nestjs/common';
import type { RevalidateNotifyDto } from '@kb/contracts';

@Injectable()
export class RevalidateService {
  private readonly logger = new Logger(RevalidateService.name);

  /** 逗号分隔的缓存标签；web 侧默认按 `kb` 整站失效 */
  private get tags(): string[] {
    const raw = process.env.WEB_REVALIDATE_TAGS?.trim();
    const list = (raw ? raw.split(',') : ['kb']).map((t) => t.trim()).filter(Boolean);
    return list.length > 0 ? list : ['kb'];
  }

  private get timeoutMs(): number {
    const raw = Number(process.env.WEB_REVALIDATE_TIMEOUT_MS ?? 3000);
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 30_000) : 3000;
  }

  get enabled(): boolean {
    return Boolean(process.env.WEB_REVALIDATE_URL?.trim() && process.env.WEB_REVALIDATE_TOKEN?.trim());
  }

  async notify(): Promise<RevalidateNotifyDto> {
    const tags = this.tags;
    const url = process.env.WEB_REVALIDATE_URL?.trim();
    const token = process.env.WEB_REVALIDATE_TOKEN?.trim();

    if (!url || !token) {
      return {
        status: 'skipped',
        tags,
        durationMs: 0,
        message: '未配置 WEB_REVALIDATE_URL / WEB_REVALIDATE_TOKEN，页面将按 revalidate 定时过期',
      };
    }

    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tags }),
        // 重建已经成功，通知只是锦上添花；宁可超时也不能挂着连接不返回
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const durationMs = Date.now() - started;
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const message = `web 返回 ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`;
        this.logger.warn(`ISR 失效通知失败：${message}`);
        return { status: 'failed', tags, durationMs, statusCode: res.status, message };
      }

      this.logger.log(`ISR 已失效：${tags.join(',')} · ${durationMs}ms`);
      return { status: 'ok', tags, durationMs, statusCode: res.status };
    } catch (err) {
      const durationMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`ISR 失效通知失败：${message}`);
      return { status: 'failed', tags, durationMs, message };
    }
  }
}
