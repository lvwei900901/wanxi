/**
 * 命令行重建索引：npm run kb:reindex -- [--dry-run] [--force]
 *
 * 复用 IndexService，保证 CLI 与 HTTP 入口走同一条代码路径。
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IndexService } from '../modules/index/index.service';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const index = app.get(IndexService);
    const result = await index.reindex({ dryRun, force, log: (m) => console.log(m) });

    if (dryRun) {
      console.log(`\n计划：共 ${result.total} 块 · 新增 ${result.added} · 变更 ${result.updated} · 未变 ${result.unchanged} · 待删除 ${result.removed}`);
    } else {
      console.log(
        `\n✓ 索引 v${result.version} 已生效 · ${result.total} 块（重算 ${result.embeddedChunks}）· 耗时 ${result.durationMs}ms`,
      );
      // 失效没发出去时页面会继续吃旧 HTML 直到定时过期，CLI 里必须能看见
      const rv = result.revalidate;
      console.log(
        rv
          ? `ISR 失效：${rv.status}${rv.statusCode ? `（${rv.statusCode}）` : ''} · ${rv.tags.join(',')}` +
              `${rv.message ? ` · ${rv.message}` : ''}`
          : 'ISR 失效：dryRun，跳过',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
