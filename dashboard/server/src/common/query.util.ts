import { BadRequestException } from '@nestjs/common';
import { isRealDate } from './date';

/** 品牌解析：请求参数优先，其次 DEFAULT_BRAND，最后兜底 */
export function resolveBrand(
  requested: string | undefined,
  fallback: string | undefined,
): string {
  return requested?.trim() || fallback?.trim() || 'AsterVision';
}

/**
 * 解析最终查询区间：请求没给就用该品牌在库里的实际范围。
 * 三个接口共用这一处校验，避免各写一遍导致行为不一致。
 */
export function resolvePeriod(
  requested: { from?: string; to?: string },
  actual: { min: string; max: string },
): { from: string; to: string } {
  const from = requested.from ?? actual.min;
  const to = requested.to ?? actual.max;

  if (!isRealDate(from) || !isRealDate(to)) {
    throw new BadRequestException(`日期不存在：from=${from} to=${to}`);
  }
  if (from > to) {
    throw new BadRequestException(`from(${from}) 不能晚于 to(${to})`);
  }
  return { from, to };
}
