import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaModule } from './prisma/prisma.module';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { PlatformAdaptersModule } from './modules/platform-adapters/platform-adapters.module';
import { CrawlModule } from './modules/crawl/crawl.module';
import { SystemModule } from './modules/system/system.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { DistributionModule } from './modules/distribution/distribution.module';
import { AiCreationModule } from './modules/ai-creation/ai-creation.module';
import { ProductLibraryModule } from './modules/product-library/product-library.module';
import { HitRecreationModule } from './modules/hit-recreation/hit-recreation.module';
import { InteractionLeadsModule } from './modules/interaction-leads/interaction-leads.module';
import { DataCenterModule } from './modules/data-center/data-center.module';
import { DigitalHumanModule } from './modules/digital-human/digital-human.module';
import { GeoModule } from './modules/geo/geo.module';
import { TeamCollaborationModule } from './modules/team-collaboration/team-collaboration.module';
import { ChannelModule } from './modules/channel/channel.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { BullModule } from '@nestjs/bullmq';
import { rootEnvFile } from './config/environment';
import { IntegrationReadinessService } from './integration-readiness.service';
import { validateRuntimeModeEnvironment } from './config/runtime-mode';

@Module({
  controllers: [HealthController],
  imports: [
    // Local pnpm and Docker now share the workspace-root .env. Environment
    // variables injected by Docker/CI still take precedence over this file.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: rootEnvFile(),
      validate: validateRuntimeModeEnvironment,
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = new URL(config.get<string>('REDIS_URL') || 'redis://localhost:6379');
        return {
          connection: {
            host: redis.hostname,
            port: Number(redis.port || 6379),
            username: redis.username || undefined,
            password: redis.password || undefined,
            db: redis.pathname.length > 1 ? Number(redis.pathname.slice(1)) : 0,
          },
        };
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    PrismaModule,
    AiGatewayModule,
    PlatformAdaptersModule,
    CrawlModule,
    SystemModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    DistributionModule,
    AiCreationModule,
    ProductLibraryModule,
    HitRecreationModule,
    InteractionLeadsModule,
    DataCenterModule,
    DigitalHumanModule,
    GeoModule,
    TeamCollaborationModule,
    ChannelModule,
  ],
  providers: [
    IntegrationReadinessService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
