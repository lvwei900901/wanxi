import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
import { PrismaModule } from './prisma/prisma.module';
import { ContentModule } from './modules/content/content.module';
import { GlmModule } from './modules/glm/glm.module';
import { SearchModule } from './modules/search/search.module';
import { RagModule } from './modules/rag/rag.module';
import { IndexModule } from './modules/index/index.module';
import { HealthModule } from './modules/health/health.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    // 按应用目录定位 .env，而不是 process.cwd()：从仓库根跑脚本 / 从 apps/api 起服务
    // 都能读到同一份配置（src/ 与 dist/ 都在 apps/api 下一层）
    ConfigModule.forRoot({ isGlobal: true, envFilePath: join(__dirname, '..', '.env') }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    ContentModule,
    GlmModule,
    SearchModule,
    RagModule,
    IndexModule,
    SyncModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
