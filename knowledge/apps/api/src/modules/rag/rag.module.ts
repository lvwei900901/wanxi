import { Module } from '@nestjs/common';
import { GlmModule } from '../glm/glm.module';
import { SearchModule } from '../search/search.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';

@Module({
  imports: [GlmModule, SearchModule],
  controllers: [RagController],
  providers: [RagService],
})
export class RagModule {}
