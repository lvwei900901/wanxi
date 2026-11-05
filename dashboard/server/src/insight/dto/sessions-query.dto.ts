import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * 会话列表的查询条件。
 *
 * 有意不接 from / to：列表要覆盖该品牌的全部历史区间，
 * 前端切换会话时才不会因为「当前看板停在别的月份」而看不到旧对话。
 */
export class SessionsQueryDto {
  @ApiPropertyOptional({
    description: '品牌名，缺省取 DEFAULT_BRAND',
    example: 'AsterVision',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  brand?: string;

  @ApiPropertyOptional({
    description: '最多返回多少条，默认 30，上限 100',
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
