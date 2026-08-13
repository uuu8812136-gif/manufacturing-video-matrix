import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly SLOW_THRESHOLD = 500;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const now = Date.now();
    return next.handle().pipe(
      tap(() => {
        const cost = Date.now() - now;
        const msg = `${method} ${url} ${cost}ms`;
        if (cost > this.SLOW_THRESHOLD) {
          this.logger.warn(`[SLOW] ${msg}`);
        } else {
          this.logger.log(msg);
        }
      }),
    );
  }
}
