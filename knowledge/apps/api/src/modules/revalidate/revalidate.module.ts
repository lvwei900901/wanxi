/**
 * 失效通知的叶子模块：不依赖任何业务模块，只被 IndexService 使用。
 * 单独成模块是为了不在 IndexModule 里额外挂一个 provider——它需要能被
 * HTTP、webhook、CLI 三条入口共用（三条都从 IndexService 走）。
 */
import { Module } from '@nestjs/common';
import { RevalidateService } from './revalidate.service';

@Module({
  providers: [RevalidateService],
  exports: [RevalidateService],
})
export class RevalidateModule {}
