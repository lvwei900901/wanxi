/**
 * 索引重建命令行。
 *
 *   npm run kb:reindex             增量（内容没变就不调 API）
 *   npm run kb:reindex -- --dry-run   只看差异，不写库
 *   npm run kb:reindex -- --force     忽略 hash，全量重算（改模板后用）
 */
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.('.env');
} catch {
  // .env 不存在时直接用进程环境变量
}

const { runReindex } = await import('../src/lib/kb/indexer.ts');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');

const result = await runReindex({ dryRun, force, log: (m) => console.log(m) });

if (dryRun) {
  console.log('\n[dry-run] 未写入任何数据');
} else {
  console.log(
    `\n✓ 索引 v${result.version} 已生效 · ${result.total} 块（重算 ${result.embeddedChunks}）· 耗时 ${result.durationMs}ms`,
  );
}

export {};
