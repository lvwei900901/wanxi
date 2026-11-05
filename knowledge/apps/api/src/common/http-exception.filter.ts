import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * 统一错误体：{ statusCode, message, path, timestamp }
 * SSE 已开始写流时不再写 JSON，否则会污染事件流。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (res.headersSent) {
      this.logger.error(`流式响应中出错：${(exception as Error)?.message ?? exception}`);
      res.end();
      return;
    }

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : null;

    let message: unknown = 'Internal server error';
    if (typeof payload === 'string') message = payload;
    else if (payload && typeof payload === 'object' && 'message' in payload) {
      message = (payload as { message: unknown }).message;
    }

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      statusCode: status,
      message,
      path: req?.url,
      timestamp: new Date().toISOString(),
    });
  }
}
