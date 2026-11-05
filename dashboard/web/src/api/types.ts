/** 后端接口的返回结构，字段名与 questions.json 保持一致（snake_case） */

export interface DashboardSummary {
  visibility_score: number;
  mentions: number;
  recommendations: number;
  citations: number;
  questions_analyzed: number;
}

export interface PlatformMetric {
  name: string;
  visibility: number;
  mentions: number;
  recommendations: number;
  citations: number;
  question_count: number;
}

export interface TrendPoint {
  date: string;
  visibility: number;
  mentions: number;
  recommendations: number;
}

export interface TopicMetric {
  topic: string;
  questions: number;
  visibility: number;
  recommendations: number;
}

export interface DashboardResponse {
  brand: string;
  /** "2026-08-01~2026-08-30" */
  period: string;
  summary: DashboardSummary;
  platforms: PlatformMetric[];
  trend: TrendPoint[];
  topics: TopicMetric[];
}

export interface MetaBrand {
  name: string;
  from: string;
  to: string;
  records: number;
}

export interface MetaResponse {
  brand: string;
  period: { from: string; to: string };
  brands: MetaBrand[];
  platforms: { id: number; name: string; sort_order: number; record_count: number }[];
  topics: { name: string; record_count: number }[];
  intents: { value: string; record_count: number }[];
  sentiments: { value: string; record_count: number }[];
}

export interface RecordItem {
  id: number;
  source_id: number;
  date: string;
  platform: string;
  topic: string;
  intent_type: string;
  question: string;
  brand_mentioned: boolean;
  brand_recommended: boolean;
  sentiment: string;
  answer_excerpt: string;
  mentioned_products: string[];
  citation_count: number;
}

export interface Citation {
  title: string;
  url: string;
  source_type: string;
}

export interface RecordDetail extends RecordItem {
  citations: Citation[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
}

export interface DashboardParams {
  brand: string;
  from: string;
  to: string;
}

export interface RecordParams extends DashboardParams {
  platforms: string[];
  mentioned: 'all' | 'true' | 'false';
  keyword: string;
  sortBy: 'date' | 'platform' | 'topic' | 'question' | 'citations';
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}
