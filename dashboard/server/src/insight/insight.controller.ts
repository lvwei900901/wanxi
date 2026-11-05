import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ChatDto } from './dto/chat.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { SessionsQueryDto } from './dto/sessions-query.dto';
import { InsightService } from './insight.service';
import type { HistoryResponse, SessionsResponse } from './insight.types';

@ApiTags('insight')
@Controller('insight')
export class InsightController {
  constructor(private readonly service: InsightService) {}

  @Get('sessions')
  @ApiOperation({
    summary: '会话列表',
    description:
      '按品牌列出全部历史会话（不限区间），最近的在前，附带消息条数。' +
      '侧栏据此展示「对话记录」并支持切换。没有消息的空会话不会出现在列表里。',
  })
  @ApiOkResponse({ description: '会话摘要列表' })
  sessions(@Query() query: SessionsQueryDto): Promise<SessionsResponse> {
    return this.service.sessions(query);
  }

  @Get('history')
  @ApiOperation({
    summary: '对话历史',
    description:
      '传 session_id 时取指定会话（切换历史对话用）；不传时取该「品牌 + 区间」下最近一次会话。' +
      '响应里带上会话自己的品牌与区间，前端据此决定要不要同步切换看板。',
  })
  @ApiOkResponse({ description: '会话 id 与消息列表（按时间正序）' })
  history(@Query() query: HistoryQueryDto): Promise<HistoryResponse> {
    return this.service.history(query);
  }

  @Post('chat')
  @ApiOperation({
    summary: 'AI 对话（SSE 流式）',
    description:
      '上下文由服务端复用 /api/dashboard 的聚合结果拼装，模型只看到与页面一致的数字。' +
      '响应为 text/event-stream，依次给出 meta → delta(多次) → done，异常时给 error。',
  })
  @ApiProduces('text/event-stream')
  async chat(@Body() dto: ChatDto, @Res() res: Response): Promise<void> {
    const controller = new AbortController();

    // 客户端关掉抽屉 / 点停止时中断上游请求，别让它跑完再计费
    const onClose = (): void => {
      if (!res.writableFinished) controller.abort();
    };
    res.on('close', onClose);

    try {
      await this.service.chat(dto, res, controller.signal);
    } finally {
      res.off('close', onClose);
    }
  }
}
