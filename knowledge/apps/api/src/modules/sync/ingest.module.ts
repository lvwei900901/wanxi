/**
 * 只装 ingest 服务、不装控制器的模块。
 *
 * 存在的理由：`IndexModule`（负责重建）和 `SyncModule`（负责搬内容）互相需要——
 * 同步完要重建索引，重建前要先同步。直接互相 import 就是循环依赖。
 * 把 `StrapiSyncService` 提成这个不依赖任何业务模块的叶子模块，
 * 两边都从它取，依赖图就变成单向的了。
 */
import { Module } from '@nestjs/common';
import { StrapiSyncService } from './strapi.service';

@Module({
  providers: [StrapiSyncService],
  exports: [StrapiSyncService],
})
export class StrapiIngestModule {}
