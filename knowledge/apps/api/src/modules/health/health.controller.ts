import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { GlmService } from '../glm/glm.service';
import { SearchService } from '../search/search.service';
import { IndexService } from '../index/index.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly glm: GlmService,
    private readonly search: SearchService,
    private readonly index: IndexService,
  ) {}

  @Get()
  @ApiOperation({ summary: '依赖健康检查：db / 索引 / 模型配置' })
  async check() {
    let db: 'ok' | 'down' = 'ok';
    try {
      await this.prisma.$queryRawUnsafe('select 1');
    } catch {
      db = 'down';
    }

    const status = await this.index.getStatus();
    return {
      data: {
        db,
        index: {
          version: status.version,
          chunks: status.chunkCount,
          loadedInMemory: this.search.chunkCount,
          templateVersion: status.templateVersion,
        },
        glm: { configured: this.glm.enabled, embedModel: this.glm.embedModel, chatModel: this.glm.chatModel },
        uptimeSec: Math.round(process.uptime()),
      },
    };
  }
}
