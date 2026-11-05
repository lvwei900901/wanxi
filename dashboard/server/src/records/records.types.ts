/**
 * 明细接口的字段沿用源数据（questions.json）的命名，
 * 与 /api/dashboard 保持一致：整个 API 只有一套命名，前端不用做字段映射。
 */

export interface CitationItem {
  title: string;
  url: string;
  source_type: string;
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
  answer_excerpt: string | null;
  mentioned_products: string[];
  citation_count: number;
}

/** 详情 = 列表项 + 引用明细（列表不返回 citations，避免翻页时体量过大） */
export interface RecordDetail extends RecordItem {
  citations: CitationItem[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
}
