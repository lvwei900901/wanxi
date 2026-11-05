import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ChatDto {
  @ApiPropertyOptional({
    description:
      '会话 id。不传则新建一条会话；前端点「新对话」就是不再传这个字段。',
    example: 'clx2b1f4g0000abcd1234efgh',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  session_id?: string;

  @ApiPropertyOptional({
    description: '品牌名，缺省取 DEFAULT_BRAND',
    example: 'AsterVision',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  brand?: string;

  @ApiPropertyOptional({
    description: '起始日期（含），YYYY-MM-DD',
    example: '2026-08-01',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from 必须是 YYYY-MM-DD 格式' })
  from?: string;

  @ApiPropertyOptional({
    description: '结束日期（含），YYYY-MM-DD',
    example: '2026-08-30',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to 必须是 YYYY-MM-DD 格式' })
  to?: string;

  @ApiProperty({
    description: '用户提问，最长 2000 字',
    example: '这个区间里最大的问题是什么？',
  })
  @IsString()
  @IsNotEmpty({ message: '提问不能为空' })
  @MaxLength(2000, { message: '提问不能超过 2000 字' })
  message!: string;
}
