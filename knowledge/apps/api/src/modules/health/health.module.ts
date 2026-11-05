import { Module } from '@nestjs/common';
import { GlmModule } from '../glm/glm.module';
import { SearchModule } from '../search/search.module';
import { IndexModule } from '../index/index.module';
import { HealthController } from './health.controller';

@Module({
  imports: [GlmModule, SearchModule, IndexModule],
  controllers: [HealthController],
})
export class HealthModule {}
