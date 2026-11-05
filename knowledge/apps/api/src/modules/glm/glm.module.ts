import { Module } from '@nestjs/common';
import { GlmService } from './glm.service';

@Module({
  providers: [GlmService],
  exports: [GlmService],
})
export class GlmModule {}
