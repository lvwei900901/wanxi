import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class ProductQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  series?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  scenario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeBeta?: boolean;
}

export class FaqQueryDto {
  @IsOptional()
  @IsIn(['brand', 'series', 'product', 'scenario'])
  scope?: 'brand' | 'series' | 'product' | 'scenario';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ref?: string;
}

export class AskDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  question: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  topK?: number;
}

export class ReindexDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;
}
