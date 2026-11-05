import { Module } from '@nestjs/common';
import { ContentController, ProductsController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  controllers: [ContentController, ProductsController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
