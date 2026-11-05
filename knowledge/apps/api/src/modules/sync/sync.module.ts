import { Module } from '@nestjs/common';
import { IndexModule } from '../index/index.module';
import { StrapiIngestModule } from './ingest.module';
import { SyncController } from './sync.controller';

@Module({
  imports: [IndexModule, StrapiIngestModule],
  controllers: [SyncController],
})
export class SyncModule {}
