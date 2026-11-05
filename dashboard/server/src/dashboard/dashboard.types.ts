/**
 * 响应结构 —— 字段名与 dashboard_summary.json 完全一致（下划线命名），
 * 前端可以直接拿原始 JSON 做 diff，不需要任何字段映射。
 */

export interface SummaryBlock {
  visibility_score: number;
  mentions: number;
  recommendations: number;
  citations: number;
  questions_analyzed: number;
}

export interface PlatformBlock {
  name: string;
  visibility: number;
  mentions: number;
  recommendations: number;
  citations: number;
  question_count: number;
}

export interface TrendBlock {
  date: string;
  visibility: number;
  mentions: number;
  recommendations: number;
}

export interface TopicBlock {
  topic: string;
  questions: number;
  visibility: number;
  recommendations: number;
}

export interface DashboardResponse {
  brand: string;
  /** "2026-08-01~2026-08-30"，与源文件格式一致 */
  period: string;
  summary: SummaryBlock;
  platforms: PlatformBlock[];
  trend: TrendBlock[];
  topics: TopicBlock[];
}
