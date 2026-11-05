import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '健康检查：报告库连接与数据量' })
  async check() {
    const [records, platforms] = await Promise.all([
      this.prisma.answerRecord.count(),
      this.prisma.platform.count(),
    ]);
    return {
      status: 'ok',
      database: 'sqlite',
      records,
      platforms,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
