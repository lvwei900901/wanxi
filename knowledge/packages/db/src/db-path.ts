/**
 * 路径解析：所有脚本都从仓库根目录取数据，不依赖启动时的工作目录。
 *
 * Prisma CLI 用 packages/db/.env 里的相对路径；运行时（Nest）用这里的绝对路径，
 * 两者指向同一个 data/knowledge.db，避免"相对 schema 还是相对 cwd"的歧义。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** 向上找带 workspaces 的 package.json，兼容 src/ 与 dist/ 两种运行位置 */
export function repoRoot(): string {
  const override = process.env.KNOWLEDGE_ROOT;
  if (override) return resolve(override);

  let dir = here;
  for (let i = 0; i < 8; i += 1) {
    const pkg = resolve(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
        if (json.workspaces) return dir;
      } catch {
        /* 继续向上 */
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`无法定位仓库根目录（从 ${here} 向上未找到 workspaces 声明）`);
}

export function dbPath(): string {
  return process.env.KNOWLEDGE_DB_PATH
    ? resolve(process.env.KNOWLEDGE_DB_PATH)
    : resolve(repoRoot(), 'data', 'knowledge.db');
}

/** 五份知识 JSON 与向量文件所在目录，默认收进仓库 data/source */
export function sourceDir(): string {
  return process.env.KNOWLEDGE_DATA_DIR
    ? resolve(process.env.KNOWLEDGE_DATA_DIR)
    : resolve(repoRoot(), 'data', 'source');
}

export function vectorFile(): string {
  return process.env.VECTOR_FILE ? resolve(process.env.VECTOR_FILE) : resolve(sourceDir(), 'index.json');
}

/** 运行时兜底：Prisma 默认读 DATABASE_URL，这里保证它指向绝对路径 */
export function ensureDatabaseUrl(): string {
  const url = `file:${dbPath()}`;
  process.env.DATABASE_URL ??= url;
  return process.env.DATABASE_URL;
}
