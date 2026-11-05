/**
 * 数据导入 + 口径自检
 *
 * 用法：npm run db:seed
 *
 * 设计要点：
 * 1) 幂等：以 source_id 为唯一键 upsert，重复执行不会产生重复行；
 *    同一份文件的导入批次会被复用而不是每次新增。
 * 2) 自检：导入完成后，用 SQL 聚合反算 dashboard_summary.json 里的
 *    每一个数字（总览 / 平台 / 主题 / 趋势），全部对齐才算成功，
 *    否则退出码非 0，避免"导入成功但数字不对"的静默错误。
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { percent } from '../src/common/metrics';

const prisma = new PrismaClient();
const DATA_DIR = join(__dirname, '../../data');

type SourceRecord = {
  id: number;
  date: string;
  platform: string;
  topic: string;
  intent_type: string;
  question: string;
  brand_mentioned: boolean;
  brand_recommended: boolean;
  sentiment: string;
  mentioned_products: string[];
  answer_excerpt: string;
  citations: { title: string; url: string; source_type: string }[];
  citation_count: number;
};

type SummaryFile = {
  brand: string;
  period: string;
  summary: {
    visibility_score: number;
    mentions: number;
    recommendations: number;
    citations: number;
    questions_analyzed: number;
  };
  platforms: {
    name: string;
    visibility: number;
    mentions: number;
    recommendations: number;
    citations: number;
    question_count: number;
  }[];
  trend: { date: string; visibility: number; mentions: number; recommendations: number }[];
  topics: { topic: string; questions: number; visibility: number; recommendations: number }[];
};

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assert(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${label}: 实际 ${String(actual)} ≠ 期望 ${String(expected)}`);
  }
}

async function main() {
  const records: SourceRecord[] = JSON.parse(
    readFileSync(join(DATA_DIR, 'questions.json'), 'utf8'),
  );
  const summary: SummaryFile = JSON.parse(
    readFileSync(join(DATA_DIR, 'dashboard_summary.json'), 'utf8'),
  );

  const [periodStart, periodEnd] = summary.period.split('~');

  // ---- 1. 平台维度（顺序来自 summary，保证前端展示稳定）----
  for (const [i, p] of summary.platforms.entries()) {
    await prisma.platform.upsert({
      where: { name: p.name },
      update: { sortOrder: i },
      create: { id: i + 1, name: p.name, sortOrder: i },
    });
  }
  const platformRows = await prisma.platform.findMany();
  const platformIdByName = new Map(platformRows.map((p) => [p.name, p.id]));

  // ---- 2. 导入批次（同文件同周期复用，避免每次 seed 都新增）----
  const existingBatch = await prisma.importBatch.findFirst({
    where: { sourceFile: 'questions.json', periodStart, periodEnd },
  });
  const batch = existingBatch
    ? await prisma.importBatch.update({
        where: { id: existingBatch.id },
        data: { rowCount: records.length },
      })
    : await prisma.importBatch.create({
        data: {
          sourceFile: 'questions.json',
          periodStart,
          periodEnd,
          rowCount: records.length,
        },
      });

  // ---- 3. 明细 upsert ----
  for (const r of records) {
    const platformId = platformIdByName.get(r.platform);
    if (!platformId) throw new Error(`未知平台：${r.platform}（source_id=${r.id}）`);

    const payload = {
      brand: summary.brand,
      observedOn: r.date,
      platformId,
      topic: r.topic,
      intentCode: r.intent_type,
      question: r.question,
      brandMentioned: r.brand_mentioned,
      brandRecommended: r.brand_recommended,
      sentiment: r.sentiment,
      answerExcerpt: r.answer_excerpt,
      mentionedProducts: JSON.stringify(r.mentioned_products),
      citations: JSON.stringify(r.citations),
      citationCount: r.citation_count,
      importBatchId: batch.id,
    };

    await prisma.answerRecord.upsert({
      where: { sourceId: r.id },
      update: payload,
      create: { sourceId: r.id, ...payload },
    });
  }

  console.log(`\n已导入 ${records.length} 条明细，周期 ${periodStart} ~ ${periodEnd}\n`);

  // ---- 4. 口径自检：全部用 SQL 聚合反算 ----
  const overall = (
    await prisma.$queryRaw<
      { total: number; mentions: number; recs: number; cites: number }[]
    >`SELECT COUNT(*) AS total,
             SUM(brand_mentioned)   AS mentions,
             SUM(brand_recommended) AS recs,
             SUM(citation_count)    AS cites
      FROM answer_records`
  ).map((r) => ({
    total: Number(r.total),
    mentions: Number(r.mentions),
    recs: Number(r.recs),
    cites: Number(r.cites),
  }))[0];

  const s = summary.summary;
  assert('总览.questions', overall.total, s.questions_analyzed);
  const otherBrands = (
    await prisma.$queryRaw<
      { c: number }[]
    >`SELECT COUNT(*) AS c FROM answer_records WHERE brand <> ${summary.brand}`
  ).map((r) => Number(r.c))[0];
  assert('数据.brand 一致性', otherBrands, 0);
  assert('总览.mentions', overall.mentions, s.mentions);
  assert('总览.recommendations', overall.recs, s.recommendations);
  assert('总览.citations', overall.cites, s.citations);
  assert(
    '总览.visibility',
    percent(overall.mentions, overall.total),
    s.visibility_score,
  );
  console.log(
    `  总览   可见度 ${percent(overall.mentions, overall.total)}  ` +
      `提及 ${overall.mentions}  推荐 ${overall.recs}  引用 ${overall.cites}  ` +
      `问题 ${overall.total}`,
  );

  const platformAgg = await prisma.$queryRaw<
    { name: string; n: number; m: number; r: number; c: number }[]
  >`SELECT p.name, COUNT(*) AS n, SUM(a.brand_mentioned) AS m,
           SUM(a.brand_recommended) AS r, SUM(a.citation_count) AS c
    FROM answer_records a JOIN platforms p ON p.id = a.platform_id
    GROUP BY a.platform_id`;
  for (const row of platformAgg) {
    const j = summary.platforms.find((x) => x.name === row.name)!;
    const n = Number(row.n), m = Number(row.m), r = Number(row.r), c = Number(row.c);
    assert(`平台.${row.name}.count`, n, j.question_count);
    assert(`平台.${row.name}.mentions`, m, j.mentions);
    assert(`平台.${row.name}.recommendations`, r, j.recommendations);
    assert(`平台.${row.name}.citations`, c, j.citations);
    assert(`平台.${row.name}.visibility`, percent(m, n), j.visibility);
  }
  console.log(`  平台   ${platformAgg.length} 个平台，逐项核对`);

  const topicAgg = await prisma.$queryRaw<
    { topic: string; n: number; m: number; r: number }[]
  >`SELECT topic, COUNT(*) AS n, SUM(brand_mentioned) AS m,
           SUM(brand_recommended) AS r
    FROM answer_records GROUP BY topic`;
  for (const row of topicAgg) {
    const j = summary.topics.find((x) => x.topic === row.topic)!;
    const n = Number(row.n), m = Number(row.m), r = Number(row.r);
    assert(`主题.${row.topic}.count`, n, j.questions);
    assert(`主题.${row.topic}.recommendations`, r, j.recommendations);
    assert(`主题.${row.topic}.visibility`, percent(m, n), j.visibility);
  }
  console.log(`  主题   ${topicAgg.length} 个主题，逐项核对`);

  const trendAgg = await prisma.$queryRaw<
    { d: string; n: number; m: number; r: number }[]
  >`SELECT observed_on AS d, COUNT(*) AS n, SUM(brand_mentioned) AS m,
           SUM(brand_recommended) AS r
    FROM answer_records GROUP BY observed_on ORDER BY observed_on`;
  for (const row of trendAgg) {
    const j = summary.trend.find((x) => x.date === row.d)!;
    const n = Number(row.n), m = Number(row.m), r = Number(row.r);
    assert(`趋势.${row.d}.mentions`, m, j.mentions);
    assert(`趋势.${row.d}.recommendations`, r, j.recommendations);
    assert(`趋势.${row.d}.visibility`, percent(m, n), j.visibility);
  }
  console.log(`  趋势   ${trendAgg.length} 天，逐项核对`);

  // ---- 5. 结论 ----
  console.log(`\n口径自检：${pass} 项通过，${fail} 项失败\n`);
  if (fail > 0) {
    failures.slice(0, 20).forEach((f) => console.log(`   ✗ ${f}`));
    throw new Error('口径自检未通过，数据与 dashboard_summary.json 不一致');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
