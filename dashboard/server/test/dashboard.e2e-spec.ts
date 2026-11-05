import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 口径回归测试：接口返回必须与你提供的 dashboard_summary.json 逐字段一致。
 * 这是整个后端最该守住的契约，改任何 SQL 都应该先跑它。
 */
describe('GET /api/dashboard', () => {
  let app: INestApplication;
  const expected = JSON.parse(
    readFileSync(join(__dirname, '../../data/dashboard_summary.json'), 'utf8'),
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('默认请求与 dashboard_summary.json 完全一致', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard')
      .expect(200);
    expect(res.body).toEqual(expected);
  });

  it('显式 brand + 完整区间结果相同', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard?brand=AsterVision&from=2026-08-01&to=2026-08-30')
      .expect(200);
    expect(res.body).toEqual(expected);
  });

  it('子区间只统计区间内的数据', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard?from=2026-08-01&to=2026-08-07')
      .expect(200);

    expect(res.body.period).toBe('2026-08-01~2026-08-07');
    expect(res.body.summary.questions_analyzed).toBe(28);
    expect(res.body.trend).toHaveLength(7);
    // 平台维度恒为 5 个，空数据补 0，图表不会少一根柱子
    expect(res.body.platforms).toHaveLength(5);
  });

  it('未知品牌 → 404 并提示可选品牌', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard?brand=NoSuchBrand')
      .expect(404);
    expect(String(res.body.message)).toContain('AsterVision');
  });

  it.each([
    ['区间倒置', '/api/dashboard?from=2026-08-10&to=2026-08-01'],
    ['不存在的日期', '/api/dashboard?from=2026-02-31'],
    ['日期格式错误', '/api/dashboard?from=2026-8-1'],
  ])('%s → 400', async (_label, url) => {
    await request(app.getHttpServer()).get(url).expect(400);
  });
});
