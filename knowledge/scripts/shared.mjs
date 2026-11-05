import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 五份知识 JSON 所在目录，可用 KNOWLEDGE_DATA_DIR 覆盖 */
export const DATA_DIR =
  process.env.KNOWLEDGE_DATA_DIR ??
  '/Users/lvwei/Documents/wanxi/AI全栈工程师笔试测试数据/project2_knowledge';

/** GLM embedding-3 向量文件，可用 VECTOR_FILE 覆盖 */
export const VECTOR_FILE =
  process.env.VECTOR_FILE ?? '/Users/lvwei/WorkBuddy/futrue/rag-demo/data/index.json';

export const DB_PATH = process.env.DATABASE_PATH ?? path.join(ROOT, 'data', 'knowledge.db');

export function readJson(file) {
  const full = path.isAbsolute(file) ? file : path.join(DATA_DIR, file);
  if (!existsSync(full)) throw new Error(`缺少数据文件：${full}`);
  return JSON.parse(readFileSync(full, 'utf8'));
}

export function openDb({ readonly = false } = {}) {
  if (!existsSync(DB_PATH)) {
    throw new Error(`数据库不存在：${DB_PATH}\n请先执行：npm run db:setup`);
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: readonly });
  db.exec('pragma foreign_keys = ON');
  return db;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 按词边界截断，用于自动生成 meta description */
export function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[.,;:、]$/, '')}…`;
}

/** 通用插入：把 camelCase 对象写成 snake_case 参数化 SQL */
export function insert(db, table, row) {
  const cols = Object.keys(row);
  const sql = `insert into ${table} (${cols.join(',')}) values (${cols.map(() => '?').join(',')})`;
  const info = db.prepare(sql).run(...cols.map((c) => row[c] ?? null));
  return Number(info.lastInsertRowid);
}

export function tableCount(db, table) {
  return db.prepare(`select count(*) as n from ${table}`).get().n;
}
