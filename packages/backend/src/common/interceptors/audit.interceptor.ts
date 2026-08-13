import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, concatMap, from, map, Observable, throwError } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestUser } from '../decorators';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method as string;
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }
    const path = String(request.path || request.url || '').split('?')[0];
    if (path.includes('/swagger')) {
      return next.handle();
    }
    const user = request.user as RequestUser | undefined;
    if (!user) return next.handle();

    const writeAudit = (outcome: 'success' | 'failure', error?: unknown) => {
      const errorValue = error as { name?: string; status?: number; message?: string };
      const detail = outcome === 'success'
        ? JSON.stringify({ outcome })
        : JSON.stringify({
            outcome,
            error: errorValue?.name || 'Error',
            status: errorValue?.status,
            message: String(errorValue?.message || '写操作失败').slice(0, 500),
          });
      return from(
        this.prisma.auditLog.create({
          data: {
            userId: user.id,
            teamId: user.teamId,
            action: `${method} ${path}`,
            target: path,
            detail,
            ip: request.ip,
          },
        }).catch(() => undefined),
      );
    };

    return next.handle().pipe(
      concatMap((value) => writeAudit('success').pipe(map(() => value))),
      catchError((error) => writeAudit('failure', error).pipe(
        concatMap(() => throwError(() => error)),
      )),
    );
  }
}
