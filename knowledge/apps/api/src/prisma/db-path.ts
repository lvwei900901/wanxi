/**
 * 数据库文件路径：向上找 workspaces 根，避免依赖启动目录。
 * Prisma 的 DATABASE_URL 用绝对路径 —— 相对路径在 CLI 与运行时有两种解析基准，
 * 是最容易出错的地方，这里一次性消掉。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const pkg = resolve(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
        if (json.workspaces) return dir;
      } catch {
        /* 忽略损坏的 package.json，继续向上 */
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`无法定位仓库根目录（从 ${start} 向上未找到 workspaces 声明）`);
}

export function dbPath(): string {
  return process.env.KNOWLEDGE_DB_PATH
    ? resolve(process.env.KNOWLEDGE_DB_PATH)
    : resolve(findRepoRoot(__dirname), 'data', 'knowledge.db');
}

/** 返回 datasourceUrl，并同步写入 process.env 供 Prisma CLI / 内部组件复用 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? `file:${dbPath()}`;
  process.env.DATABASE_URL = url;
  return url;
}

export function sourceDir(): string {
  return process.env.KNOWLEDGE_DATA_DIR
    ? resolve(process.env.KNOWLEDGE_DATA_DIR)
    : resolve(findRepoRoot(__dirname), 'data', 'source');
}
