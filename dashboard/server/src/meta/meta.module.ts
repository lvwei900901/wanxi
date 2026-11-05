import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { MetaRepository } from './meta.repository';
import { MetaService } from './meta.service';

@Module({
  controllers: [MetaController],
  providers: [MetaService, MetaRepository],
})
export class MetaModule {}
