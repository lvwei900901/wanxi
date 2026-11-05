import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ApiEnvelope, StrapiSyncReportDto } from '@kb/contracts';
import { assertOpsToken, bearerOf } from '../../common/auth';
import { IndexService } from '../index/index.service';
import { StrapiSyncService } from './strapi.service';
import { StrapiSyncDto } from './dto';

@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly strapi: StrapiSyncService,
    private readonly index: IndexService,
  ) {}

  /**
   * 从 Strapi 拉取内容写进本地库。
   *
   * 这是 webhook 的另一半：webhook 只说「变了」，这个端点才把新内容搬进来。
   * 顺序必须是「先 ingest，再 reindex」——反过来重建的还是旧内容。
   */
  @Post('strapi')
  @ApiBearerAuth()
  @ApiOperation({ summary: '从 Strapi 拉取内容 upsert 进本地库；dryRun 只预演' })
  async sync(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: StrapiSyncDto,
  ): Promise<ApiEnvelope<StrapiSyncReportDto & { reindexed?: number | null }>> {
    assertOpsToken(bearerOf(authorization));

    const report = await this.strapi.sync({ dryRun: dto.dryRun, mode: dto.mode, prune: dto.prune });

    let reindexed: number | null = null;
    if (!dto.dryRun && dto.rebuild !== false) {
      const result = await this.index.reindex({ reason: 'strapi sync' });
      reindexed = result.version;
    }

    return { data: { ...report, reindexed } };
  }
}
