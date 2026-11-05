import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class HistoryQueryDto {
  @ApiPropertyOptional({
    description:
      '会话 id。传了就直接取这条会话（从会话列表里切换过来时用）；' +
      '不传则取该「品牌 + 区间」下最近一次会话，保持原有行为。',
    example: 'clx2b1f4g0000abcd1234efgh',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  session_id?: string;

  @ApiPropertyOptional({
    description: '品牌名，缺省取 DEFAULT_BRAND。指定 session_id 时用于校验归属',
    example: 'AsterVision',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  brand?: string;

  @ApiPropertyOptional({
    description: '起始日期（含），YYYY-MM-DD，缺省取该品牌最早日期',
    example: '2026-08-01',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from 必须是 YYYY-MM-DD 格式' })
  from?: string;

  @ApiPropertyOptional({
    description: '结束日期（含），YYYY-MM-DD，缺省取该品牌最晚日期',
    example: '2026-08-30',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to 必须是 YYYY-MM-DD 格式' })
  to?: string;
}
