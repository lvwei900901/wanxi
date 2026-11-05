import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const SENTIMENTS = ['positive', 'neutral', 'mixed', 'negative'] as const;
export const SORT_FIELDS = [
  'date',
  'platform',
  'topic',
  'question',
  'citations',
] as const;

/** 允许 `platform=ChatGPT,Gemini` 这种逗号分隔的多选 */
const toArray = ({ value }: TransformFnParams): unknown => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return value;
};

const toBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
};

export class RecordQueryDto {
  @ApiPropertyOptional({ example: 'AsterVision' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  brand?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from 必须是 YYYY-MM-DD 格式' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-30' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to 必须是 YYYY-MM-DD 格式' })
  to?: string;

  @ApiPropertyOptional({
    description: '平台名，支持逗号分隔多选',
    example: 'ChatGPT,Gemini',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  platform?: string[];

  @ApiPropertyOptional({
    description: '主题名，支持逗号分隔多选',
    example: 'Warehouse Security',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  topic?: string[];

  @ApiPropertyOptional({ enum: SENTIMENTS })
  @IsOptional()
  @IsIn(SENTIMENTS as unknown as string[])
  sentiment?: string;

  @ApiPropertyOptional({ description: '意图码 A/B/C', example: 'A' })
  @IsOptional()
  @IsIn(['A', 'B', 'C'])
  intent_type?: string;

  @ApiPropertyOptional({ description: '是否提及品牌', example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mentioned?: boolean;

  @ApiPropertyOptional({ description: '问题文案模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(200)
  page_size?: number;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'date' })
  @IsOptional()
  @IsIn(SORT_FIELDS as unknown as string[])
  sort_by?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_dir?: string;
}
