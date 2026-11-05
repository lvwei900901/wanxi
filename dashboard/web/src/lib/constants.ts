/** 平台与情绪的统一配色 / 文案，图表、表格、抽屉共用同一套 */

export const PLATFORM_COLOR: Record<string, string> = {
  ChatGPT: '#0d9488',
  Gemini: '#f4511e',
  Claude: '#d97706',
  Perplexity: '#2563eb',
  DeepSeek: '#7c3aed',
};

export function platformColor(name: string): string {
  return PLATFORM_COLOR[name] ?? '#5c6779';
}

export const SENTIMENT_LABEL: Record<string, string> = {
  positive: '正面',
  neutral: '中性',
  mixed: '混合',
  negative: '负面',
};

export function sentimentLabel(value: string): string {
  return SENTIMENT_LABEL[value] ?? value;
}

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  Review: '评测',
  Industry: '行业',
  Media: '媒体',
  Vendor: '厂商',
  Blog: '博客',
  Forum: '论坛',
  Documentation: '文档',
};

export function sourceTypeLabel(value: string): string {
  return SOURCE_TYPE_LABEL[value] ?? value;
}

/** 图表内联样式用的色值（与 tokens.css 保持一致，改一处要同步另一处） */
export const CHART = {
  ink: '#0f172a',
  inkSoft: '#334155',
  muted: '#5c6779',
  faint: '#94a0b2',
  rule: '#e3e8ef',
  ruleSoft: '#eef1f6',
  ruleStrong: '#cfd6e0',
  accent: '#f4511e',
  accentSoft: '#fb8b5f',
  accentFaint: '#ffd3c2',
  pine: '#0d9488',
  blue: '#2563eb',
  paper: '#f4f6f9',
  paperHi: '#ffffff',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  sans: '"PingFang SC", "Hiragino Sans GB", system-ui, sans-serif',
} as const;
