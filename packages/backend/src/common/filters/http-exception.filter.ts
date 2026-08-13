import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let code = -1;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        message = (r.message as string | string[] | undefined)
          ? Array.isArray(r.message)
            ? (r.message as string[]).join('; ')
            : (r.message as string)
          : message;
        code = (r.code as number | undefined) ?? status;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.stack);
    }

    response.status(status).json({
      code: code === -1 ? status : code,
      message,
      data: null,
    });
  }
}
