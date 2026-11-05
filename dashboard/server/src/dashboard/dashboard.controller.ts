import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import type { DashboardResponse } from './dashboard.types';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: '聚合看板数据',
    description:
      '一次返回总览 / 平台 / 趋势 / 主题四个块，结构与你提供的 dashboard_summary.json 完全一致。' +
      '支持 brand 与日期区间筛选；平台排序、主题排序在服务端固定，前端无需再排。',
  })
  @ApiOkResponse({ description: '与 dashboard_summary.json 同构的 JSON' })
  getOverview(@Query() query: DashboardQueryDto): Promise<DashboardResponse> {
    return this.service.getOverview(query);
  }
}
