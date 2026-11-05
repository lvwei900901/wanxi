import { Global, Module } from '@nestjs/common';
import { BrandRangeService } from './brand-range.service';

@Global()
@Module({
  providers: [BrandRangeService],
  exports: [BrandRangeService],
})
export class CommonModule {}
