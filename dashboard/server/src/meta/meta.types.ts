export interface BrandOption {
  name: string;
  from: string;
  to: string;
  records: number;
}

export interface PlatformOption {
  id: number;
  name: string;
  sort_order: number;
  record_count: number;
}

export interface TopicOption {
  name: string;
  record_count: number;
}

export interface CountOption {
  value: string;
  record_count: number;
}

export interface MetaResponse {
  brand: string;
  period: { from: string; to: string };
  brands: BrandOption[];
  platforms: PlatformOption[];
  topics: TopicOption[];
  /** 意图码 A/B/C。源数据没有给出语义，这里只返回码与数量，标签由前端或产品补 */
  intents: CountOption[];
  sentiments: CountOption[];
}
