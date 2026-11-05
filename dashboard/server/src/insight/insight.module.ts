import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { InsightController } from './insight.controller';
import { InsightRepository } from './insight.repository';
import { InsightService } from './insight.service';
import { LlmClient } from './llm.client';

@Module({
  imports: [DashboardModule],
  controllers: [InsightController],
  providers: [InsightService, InsightRepository, LlmClient],
})
export class InsightModule {}
