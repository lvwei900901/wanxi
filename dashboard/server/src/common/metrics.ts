/**
 * 指标口径的唯一实现处。
 *
 * visibility_score = 提及率 = brand_mentioned 占比 × 100
 *
 * 注意：原始数据是 Python round() 生成的（银行家舍入），
 * Claude 的 15/24 = 62.5 在源文件里是 62 而不是 63。
 * MySQL 的 ROUND()、JS 的 Math.round() 都会给 63，
 * 所以百分比一律在后端用 roundHalfEven 计算，SQL 只返回整数分子分母。
 */

/** 四舍六入五取偶（与 Python round / IEEE 754 默认舍入一致） */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  // 恰好 .5：取最近的偶数
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 百分比；分母为 0 时返回 null，避免 0/0 变成 NaN 或 0 误导前端 */
export function percent(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return roundHalfEven((numerator / denominator) * 100);
}

/** 原始比值（0~1），用于排序时避免百分比精度丢失 */
export function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}
