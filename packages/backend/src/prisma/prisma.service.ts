import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma connected to database');
    } catch (err) {
      this.logger.error(`Failed to connect to database: ${(err as Error).message}`);
      this.logger.warn('Application will continue running but database operations will fail. Please start Docker services (pnpm db:up) and run migrations (pnpm db:migrate).');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
