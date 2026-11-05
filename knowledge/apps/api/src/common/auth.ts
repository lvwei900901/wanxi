import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * 恒定时间字符串比较。
 *
 * 先比长度再 timingSafeEqual：length 不同时 timingSafeEqual 会抛异常，
 * 而长度本身不是秘密，提前返回不会泄漏有效信息。
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 从 Authorization 头里取出 bearer 值；不是 Bearer 形式则原样返回便于兼容 */
export function bearerOf(authorization: string | undefined): string {
  if (authorization === undefined) return '';
  return authorization.replace(/^Bearer\s+/i, '').trim();
}

/**
 * 校验运维令牌。
 *
 * 没配令牌时直接 503 而不是放行——「配置缺失」和「令牌正确」绝不能等价，
 * 否则一个漏配的环境等于把重建端口完全敞开。
 */
export function assertOpsToken(provided: string, envName = 'REINDEX_TOKEN'): void {
  const expected = process.env[envName];
  if (!expected) {
    throw new HttpException(`未配置 ${envName}，拒绝执行`, HttpStatus.SERVICE_UNAVAILABLE);
  }
  if (!provided || !safeEqual(provided, expected)) {
    throw new UnauthorizedException('运维令牌无效');
  }
}
