/**
 * Schema 漂移检查：Prisma DMMF ↔ SQLite 实际表结构。
 *
 * 因为 0_init 是手写 DDL（为了保住 CHECK 约束），Prisma 并不知道这些约束，
 * 就存在"改了 schema.prisma 忘了写迁移"的风险。这个脚本做了三层核对：
 *  1. 表名：每个 model 的 @@map 表必须存在，且库里没有多余的表；
 *  2. 列名：字段 @map 后的列必须一一对应，多一列少一列都失败；
 *  3. 外键：pragma foreign_key_list 的数量与 Prisma 关系字段（持有外键的一侧）一致。
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { ensureDatabaseUrl } from './db-path.js';

ensureDatabaseUrl();
const prisma = new PrismaClient();

type Column = { name: string; type: string; notnull: number; dflt_value: string | null };
type Fk = { table: string; from: string; to: string };

async function main() {
  const models = Prisma.dmmf.datamodel.models;
  const rows: { table: string; columns: string; fks: string; status: string }[] = [];
  const problems: string[] = [];

  const existing = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '_prisma_migrations'`,
  );
  const dbTables = new Set(existing.map((t) => t.name));
  const expectedTables = new Set(models.map((m) => m.dbName ?? m.name));

  for (const table of dbTables) {
    if (!expectedTables.has(table)) problems.push(`库里多出表 ${table}（Prisma schema 未声明）`);
  }

  for (const model of models) {
    const table = model.dbName ?? model.name;
    if (!dbTables.has(table)) {
      problems.push(`缺少表 ${table}`);
      continue;
    }

    const columns = await prisma.$queryRawUnsafe<Column[]>(`pragma table_info('${table}')`);
    const dbCols = columns.map((c) => c.name).sort();

    const scalarFields = model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum');
    const prismaCols = scalarFields.map((f) => f.dbName ?? f.name).sort();

    const missing = prismaCols.filter((c) => !dbCols.includes(c));
    const extra = dbCols.filter((c) => !prismaCols.includes(c));
    if (missing.length) problems.push(`${table} 缺列：${missing.join(', ')}`);
    if (extra.length) problems.push(`${table} 多列：${extra.join(', ')}`);

    const fks = await prisma.$queryRawUnsafe<Fk[]>(`pragma foreign_key_list('${table}')`);
    const relationFields = model.fields.filter((f) => f.kind === 'object' && f.relationFromFields?.length);
    if (fks.length !== relationFields.length) {
      problems.push(`${table} 外键数量不一致：库 ${fks.length} 个，schema ${relationFields.length} 个`);
    }

    rows.push({
      table,
      columns: `${dbCols.length}/${prismaCols.length}`,
      fks: `${fks.length}/${relationFields.length}`,
      status: missing.length || extra.length ? '✗' : '✓',
    });
  }

  console.table(rows);

  const counts = {
    brand: await prisma.brand.count(),
    product_series: await prisma.productSeries.count(),
    product: await prisma.product.count(),
    feature: await prisma.feature.count(),
    product_feature: await prisma.productFeature.count(),
    scenario: await prisma.scenario.count(),
    product_scenario: await prisma.productScenario.count(),
    faq: await prisma.faq.count(),
    knowledge_chunk: await prisma.knowledgeChunk.count(),
    embedding_index: await prisma.embeddingIndex.count(),
  };
  console.table(counts);

  const active = await prisma.embeddingIndex.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } });
  console.log(
    active
      ? `生效索引 v${active.id} · ${active.model} · ${active.dimensions} 维 · ${active.chunkCount} 块 · 模板 v${active.templateVersion}`
      : '⚠ 没有状态为 active 的索引版本',
  );

  if (problems.length) {
    console.error('\n✗ schema 与数据库漂移：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ 表结构、列、外键与 Prisma schema 完全一致');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
