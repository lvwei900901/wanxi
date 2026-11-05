import { percent } from '../common/metrics';
import type { DashboardResponse } from '../dashboard/dashboard.types';

/**
 * 固定的角色与写作约束。
 *
 * 这里刻意写死了「只能用给定数据」和「数据不足要说无法判断」两条：
 * 看板类问答最常见的失败不是话说得不好，而是模型用行业常识补出了
 * 页面上根本没有的数字。约束放在 system 里比放在 user 里稳。
 */
export const SYSTEM_PROMPT = `你是 AsterVision 的 AI 可见度分析师，服务于品牌市场团队。

你的回答只能基于下方「数据」中给出的指标，禁止编造任何数字、平台名或主题名。
数据里没有的信息，就直接说没有。

分析方法：
- 先找最弱的地方：可见度最低的平台和主题，通常才是提升空间最大的。
- 再看「被提及但没被推荐」的落差：可见度减推荐率，差值越大说明模型认识这个品牌、
  却不愿把它放进推荐名单——这是内容问题，不是曝光问题，加投放解决不了。
- 已经被充分覆盖的维度，不要再建议加大投入。

写作要求：
1. 中文，结论先行。第一句直接回答问题，不要「根据数据显示」这类铺垫。
2. 用 Markdown 组织。需要对比时用小表格，但不要整段复述数据表。
3. 每个判断都要带依据：哪个平台、哪个主题、哪段时间，以及对应数字。
4. 建议必须落到「改什么内容、用在哪个平台或主题」，不要写「加强品牌建设」「提升曝光度」
   这类换个行业也成立的空话。
5. 数据不足以支撑结论时，明确说「现有数据无法判断」，并说明还缺什么。
6. 篇幅默认控制在 300 字以内；用户明确要求展开时才写长。`;

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

/**
 * 把看板聚合结果压成一段 Markdown 交给模型。
 *
 * 只放聚合值、不放原始回答正文：一次约 1.5K token，
 * 且模型看到的是和页面完全一致的数字，不会算出对不上的百分比。
 */
export function buildContext(dashboard: DashboardResponse): string {
  const { brand, period, summary, platforms, topics, trend } = dashboard;
  const [from, to] = period.split('~');

  const lines: string[] = [];

  lines.push(`品牌：${brand}`);
  lines.push(`观测期：${from} ~ ${to}`);
  lines.push(
    `样本：${summary.questions_analyzed} 条回答，覆盖 ${platforms.length} 个平台、${topics.length} 个主题`,
  );
  lines.push('');

  lines.push('## 总览');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 可见度 | ${pct(summary.visibility_score)} |`);
  lines.push(`| 提及次数 | ${summary.mentions} |`);
  lines.push(`| 推荐次数 | ${summary.recommendations} |`);
  lines.push(`| 引用次数 | ${summary.citations} |`);
  lines.push(`| 提问数 | ${summary.questions_analyzed} |`);
  lines.push('');

  lines.push('## 按平台（按可见度降序）');
  lines.push('| 平台 | 可见度 | 提及 | 推荐 | 推荐率 | 引用 | 提问数 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const item of platforms) {
    lines.push(
      `| ${item.name} | ${pct(item.visibility)} | ${item.mentions} | ` +
        `${item.recommendations} | ${pct(percent(item.recommendations, item.question_count))} | ` +
        `${item.citations} | ${item.question_count} |`,
    );
  }
  lines.push('');

  lines.push('## 按主题（按可见度降序）');
  lines.push('| 主题 | 可见度 | 推荐 | 提问数 |');
  lines.push('| --- | --- | --- | --- |');
  for (const item of topics) {
    lines.push(
      `| ${item.topic} | ${pct(item.visibility)} | ${item.recommendations} | ${item.questions} |`,
    );
  }
  lines.push('');

  if (trend.length > 0) {
    lines.push('## 每日可见度');
    lines.push(
      trend
        .map((point) => `${point.date.slice(5)} ${point.visibility}%`)
        .join(' · '),
    );
    lines.push('');
  }

  lines.push('## 口径');
  lines.push('- 可见度 = 提及该品牌的问题数 ÷ 该维度提问数，衡量「有没有被提到」。');
  lines.push('- 推荐率 = 推荐该品牌的问题数 ÷ 提问数，衡量「被提到之后有没有进入推荐名单」。');
  lines.push('- 两者落差大，说明模型知道这个品牌、但不太愿意主动推荐它。');
  if (trend.length > 0) {
    const perDay = Math.round(summary.questions_analyzed / trend.length);
    lines.push(
      `- 每天只有约 ${perDay} 条样本，单日可见度只能落在少数几档上，` +
        `日间跳动主要是样本噪声，看趋势要整体看，不要解读单日涨跌。`,
    );
  }
  lines.push('- 百分比为银行家舍入取整，与页面显示一致；不要自行重算或按四舍五入改值。');

  return lines.join('\n');
}
