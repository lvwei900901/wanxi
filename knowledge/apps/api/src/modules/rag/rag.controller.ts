import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AskDto } from '../content/dto';
import { RagService } from './rag.service';

@ApiTags('ask')
@Controller('ask')
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '基于知识库的问答，SSE 流式返回（citations → token… → done）' })
  async ask(@Body() dto: AskDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    const controller = new AbortController();
    // 客户端断连就停掉上游生成，避免白烧 token
    req.on('close', () => controller.abort());

    await this.rag.stream(dto.question, dto.topK ?? 4, res, controller.signal);
  }
}
