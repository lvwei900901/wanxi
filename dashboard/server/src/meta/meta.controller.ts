import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MetaService } from './meta.service';
import type { MetaResponse } from './meta.types';

@ApiTags('meta')
@Controller('meta')
export class MetaController {
  constructor(private readonly service: MetaService) {}

  @Get()
  @ApiOperation({
    summary: '筛选项元数据',
    description:
      '品牌列表、数据周期、平台/主题选项及其记录数、意图码与情绪分布。' +
      '统计口径为品牌全量数据，不受当前页筛选影响，避免下拉选项越筛越少。',
  })
  @ApiQuery({ name: 'brand', required: false, example: 'AsterVision' })
  @ApiOkResponse({ description: '筛选项' })
  getMeta(@Query('brand') brand?: string): Promise<MetaResponse> {
    return this.service.getMeta(brand);
  }
}
