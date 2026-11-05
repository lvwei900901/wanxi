import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RecordQueryDto } from './dto/record-query.dto';
import { RecordsService } from './records.service';
import type { Paginated, RecordDetail, RecordItem } from './records.types';

@ApiTags('records')
@Controller('records')
export class RecordsController {
  constructor(private readonly service: RecordsService) {}

  @Get()
  @ApiOperation({
    summary: '回答明细（分页 + 筛选 + 排序）',
    description:
      '支持品牌、日期区间、平台多选、主题多选、情绪、意图码、是否提及、问题关键词筛选；' +
      '排序字段走白名单。列表不返回 citations，详情才返回。',
  })
  @ApiOkResponse({ description: '分页结果' })
  list(@Query() query: RecordQueryDto): Promise<Paginated<RecordItem>> {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '单条回答详情（含引用明细）' })
  @ApiParam({ name: 'id', example: 1 })
  detail(@Param('id', ParseIntPipe) id: number): Promise<RecordDetail> {
    return this.service.detail(id);
  }
}
