/** 日期与百分比工具：统一时区处理，避免跨时区偏移一天 */

export function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function diffDaysInclusive(from: string, to: string): number {
  const toUTC = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000) + 1;
}

/** 2026-08-01 → 08/01（图表轴） */
export function shortDate(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

/** 2026-08-01 → 2026.08.01（正文） */
export function prettyDate(iso: string): string {
  return iso.replaceAll('-', '.');
}

/** 2026-08-01 → 08.01（表格） */
export function monthDay(iso: string): string {
  return `${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
}

/**
 * 百分比：与后端 roundHalfEven 保持一致。
 * 62.5 必须得 62（银行家舍入），否则会与源数据对不上。
 */
export function ratioPct(part: number, whole: number): number {
  if (!whole) return 0;
  const raw = (part / whole) * 100;
  const floor = Math.floor(raw);
  if (Math.abs(raw - floor - 0.5) < 1e-9) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(raw);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatCount(value: number): string {
  return value.toLocaleString('zh-CN');
}
