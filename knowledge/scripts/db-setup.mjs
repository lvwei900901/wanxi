/**
 * 建库：删除旧文件 → 按 db/schema.sql 重建全部表与索引。
 * 幂等，可反复执行；会清空数据，生产环境不要跑。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ROOT, ensureDir } from './shared.mjs';

ensureDir(path.dirname(DB_PATH));

for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const f = `${DB_PATH}${suffix}`;
  if (existsSync(f)) rmSync(f);
}

const schema = readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
const db = new DatabaseSync(DB_PATH);
db.exec(schema);

const tables = db
  .prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`)
  .all()
  .map((r) => r.name);
const indexes = db
  .prepare(`select name from sqlite_master where type = 'index' and name not like 'sqlite_%'`)
  .all().length;

console.log(`✓ 数据库已创建：${DB_PATH}`);
console.log(`  表 ${tables.length} 张：${tables.join(', ')}`);
console.log(`  索引 ${indexes} 个 · schema 版本 ${db.prepare('pragma user_version').get().user_version}`);
db.close();
