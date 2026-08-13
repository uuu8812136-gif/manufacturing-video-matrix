import { Controller, Get, Query, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser, Public, Roles } from './common/decorators';
import { PrismaService } from './prisma/prisma.service';
import { IntegrationReadinessService } from './integration-readiness.service';
import { assertSystemAdmin } from './common/utils/system-admin.util';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationReadinessService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
  }

  /** Authenticated readiness report. Add ?probe=true to make safe, non-billable connectivity checks. */
  @Get('integrations')
  @Roles('super_admin')
  integrationReadiness(@CurrentUser() user: { phone: string }, @Query('probe') probe?: string) {
    assertSystemAdmin(this.config, user.phone);
    return this.integrations.inspect(probe === 'true');
  }
}
