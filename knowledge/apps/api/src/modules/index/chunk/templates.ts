/**
 * 分块模板 —— 这是"知识库可更新"的地基。
 *
 * 现有 94 个向量是由一份外部分块脚本产出的，模板只存在于那份产物里。
 * 这里把模板原样固化到代码中（含中文标签、全角冒号、"、" 分隔、空行分段、
 * 以及"字段为空则整行省略"的规则），才能保证：
 *   内容不变 → 重新分块得到的文本逐字相同 → content_hash 相同 → 不重复调 embedding；
 *   内容变了 → 只有变化的那一块 hash 变化 → 只重算那一块。
 *
 * 一旦修改本文件的任何一行，必须同时把 TEMPLATE_VERSION 加 1，
 * 索引器会据此强制全量重算，避免新旧向量语义不一致。
 */
export const TEMPLATE_VERSION = 1;

export type SourceType = 'brand' | 'series' | 'product' | 'faq' | 'scenario';

export type ChunkDraft = {
  sourceType: SourceType;
  sourceId: number;
  chunkIndex: number;
  heading: string;
  content: string;
  urlPath: string;
};

const SEP = '\n\n';
const line = (label: string, value: string) => `- ${label}：${value}`;
const list = (items: string[]) => items.join('、');

/** 空值整行省略：Edge 系列的 resolution 为 null，生成的分块里就没有"分辨率"这一行 */
function block(lines: (string | null | undefined)[]): string {
  return lines.filter((x): x is string => typeof x === 'string' && x.length > 0).join(SEP);
}

export type BrandInput = {
  id: number;
  name: string;
  description: string | null;
  foundedYear: number | null;
  headquarters: string | null;
  coreCapabilities: string[];
};

export function brandChunk(b: BrandInput): ChunkDraft {
  return {
    sourceType: 'brand',
    sourceId: b.id,
    chunkIndex: 0,
    heading: b.name,
    urlPath: '/',
    content: block([
      b.description ? line('简介', b.description) : null,
      b.foundedYear ? line('成立年份', String(b.foundedYear)) : null,
      b.headquarters ? line('总部', b.headquarters) : null,
      b.coreCapabilities.length ? line('核心能力', list(b.coreCapabilities)) : null,
    ]),
  };
}

export type SeriesInput = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
};

export function seriesChunk(s: SeriesInput): ChunkDraft {
  return {
    sourceType: 'series',
    sourceId: s.id,
    chunkIndex: 0,
    heading: s.name,
    urlPath: `/series/${s.slug}`,
    content: block([s.description ? line('简介', s.description) : null]),
  };
}

export type ScenarioInput = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
};

export function scenarioChunk(s: ScenarioInput): ChunkDraft {
  return {
    sourceType: 'scenario',
    sourceId: s.id,
    chunkIndex: 0,
    heading: s.name,
    urlPath: `/scenarios/${s.slug}`,
    content: block([s.description ? line('说明', s.description) : null]),
  };
}

export type ProductInput = {
  id: number;
  slug: string;
  name: string;
  shortDescription: string | null;
  overview: string | null;
  seriesName: string;
  keyFeatures: string[];
  scenarioNames: string[];
  resolution: string | null;
  connectivity: string | null;
  environment: string | null;
  aiFeatures: string[];
};

/** 产品第 0 块：定位、概述、核心功能、适用场景 */
export function productOverviewChunk(p: ProductInput): ChunkDraft {
  return {
    sourceType: 'product',
    sourceId: p.id,
    chunkIndex: 0,
    heading: p.name,
    urlPath: `/products/${p.slug}`,
    content: block([
      line('所属系列', p.seriesName),
      p.shortDescription ? line('简介', p.shortDescription) : null,
      p.overview ? line('概述', p.overview) : null,
      p.keyFeatures.length ? line('核心功能', list(p.keyFeatures)) : null,
      p.scenarioNames.length ? line('适用场景', list(p.scenarioNames)) : null,
    ]),
  };
}

/** 产品第 1 块：规格参数，便于"支持 PoE 吗""什么分辨率"这类问题精确命中 */
export function productSpecChunk(p: ProductInput): ChunkDraft {
  return {
    sourceType: 'product',
    sourceId: p.id,
    chunkIndex: 1,
    heading: `${p.name} · 规格参数`,
    urlPath: `/products/${p.slug}#specs`,
    content: block([
      p.resolution ? line('分辨率', p.resolution) : null,
      p.connectivity ? line('连接方式', p.connectivity) : null,
      p.environment ? line('使用环境', p.environment) : null,
      p.aiFeatures.length ? line('AI 功能', list(p.aiFeatures)) : null,
    ]),
  };
}

export type FaqInput = {
  id: number;
  question: string;
  answer: string;
  productSlug: string;
};

export function faqChunk(f: FaqInput): ChunkDraft {
  return {
    sourceType: 'faq',
    sourceId: f.id,
    chunkIndex: 0,
    heading: f.question,
    urlPath: `/products/${f.productSlug}#faq`,
    content: block([line('产品代号', f.productSlug), line('答案', f.answer)]),
  };
}

/** 稳定的 chunk 主键：实体变化不会改变它，只有块内内容会变 */
export function chunkKey(d: Pick<ChunkDraft, 'sourceType' | 'sourceId' | 'chunkIndex'>): string {
  return `${d.sourceType}:${d.sourceId}:${d.chunkIndex}`;
}
