import { Module } from '@nestjs/common';
import { GlmModule } from '../glm/glm.module';
import { SearchModule } from '../search/search.module';
import { StrapiIngestModule } from '../sync/ingest.module';
import { RevalidateModule } from '../revalidate/revalidate.module';
import { IndexController } from './index.controller';
import { IndexService } from './index.service';
import { IndexHookService } from './index-hook.service';

@Module({
  // 重建前必须先 ingest：webhook 只说「变了」，内容得自己回库读
  // 重建后必须通知 web 失效：否则库和 API 是新的，页面还停在 300s 前的旧版本
  imports: [GlmModule, SearchModule, StrapiIngestModule, RevalidateModule],
  controllers: [IndexController],
  providers: [IndexService, IndexHookService],
  exports: [IndexService, IndexHookService],
})
export class IndexModule {}
