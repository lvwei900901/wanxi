import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class DashboardQueryDto {
  @ApiPropertyOptional({
    description: '品牌名，缺省取 DEFAULT_BRAND',
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
