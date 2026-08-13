import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  const create = jest.fn();
  const interceptor = new AuditInterceptor({
    auditLog: { create },
  } as unknown as PrismaService);

  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'PATCH',
        path: '/api/accounts/account-1',
        url: '/api/accounts/account-1?token=must-not-be-logged',
        ip: '127.0.0.1',
        user: { id: 'user-1', teamId: 'team-1', role: 'ops_lead' },
      }),
    }),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({});
  });

  it('waits for and records a successful authenticated write without query secrets', async () => {
    const next = { handle: () => of({ updated: true }) } as CallHandler;
    await expect(lastValueFrom(interceptor.intercept(context, next))).resolves.toEqual({ updated: true });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PATCH /api/accounts/account-1',
        target: '/api/accounts/account-1',
        detail: '{"outcome":"success"}',
      }),
    });
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('must-not-be-logged');
  });

  it('records a failed write and preserves the original error', async () => {
    const error = Object.assign(new Error('禁止修改'), { status: 403 });
    const next = { handle: () => throwError(() => error) } as CallHandler;

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toBe(error);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        detail: JSON.stringify({
          outcome: 'failure',
          error: 'Error',
          status: 403,
          message: '禁止修改',
        }),
      }),
    });
  });
});
