import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type {
  ApiEnvelope,
  IndexHookAckDto,
  IndexHookStatusDto,
  IndexStatusDto,
} from '@kb/contracts';
import { assertOpsToken, bearerOf } from '../../common/auth';
import { IndexService, type ReindexResult } from './index.service';
import { IndexHookService, parseStrapiHook } from './index-hook.service';
import { ReindexDto } from '../content/dto';

@ApiTags('index')
@Controller('index')
export class IndexController {
  constructor(
    private readonly index: IndexService,
    private readonly hook: IndexHookService,
  ) {}

  @Get()
  @ApiOperation({ summary: '当前生效的索引版本' })
  async status(): Promise<ApiEnvelope<IndexStatusDto>> {
    return { data: await this.index.getStatus() };
  }

  @Post('reindex')
  @ApiBearerAuth()
  @ApiOperation({ summary: '重建索引（增量；?force=true 全量；dryRun 只看差异）' })
  async reindex(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: ReindexDto,
  ): Promise<ApiEnvelope<ReindexResult>> {
    assertOpsToken(bearerOf(authorization));

    const data = await this.index.reindex({
      dryRun: dto.dryRun,
      force: dto.force,
      reason: dto.reason,
    });
    return { data };
  }

  /**
   * Strapi webhook 入口。
   *
   * 接受与忽略都返回 202：Strapi 只认 2xx，任何 4xx 都会在它那边记成投递失败，
   * 而「这个集合不归我们管」并不是失败。只有鉴权不过才给 401。
   *
   * 跳过全局限流：去抖层本身就是最强的限流——一秒内投 500 次也只会重建一次，
   * 而 429 会让 Strapi 把一次正常保存记成失败。
   */
  @Post('hook')
  @SkipThrottle()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Strapi webhook 入口：立刻 202，去抖后异步重建索引' })
  async strapiHook(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
  ): Promise<ApiEnvelope<IndexHookAckDto>> {
    assertOpsToken(bearerOf(headers.authorization));

    const verdict = parseStrapiHook(body);
    if (!verdict.accepted) {
      return {
        data: {
          accepted: false,
          ignored: true,
          why: verdict.why,
          queue: this.hook.status(),
        },
      };
    }

    const queue = this.hook.enqueue(verdict.entry);
    return {
      data: {
        accepted: true,
        entry: {
          model: verdict.entry.model,
          event: verdict.entry.event,
          id: verdict.entry.id,
        },
        queue,
      },
    };
  }

  @Get('hook/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'webhook 队列状态：投递数 / 实际重建次数 / 上一次结果' })
  async hookStatus(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ApiEnvelope<IndexHookStatusDto>> {
    assertOpsToken(bearerOf(authorization));
    return { data: this.hook.status() };
  }
}
