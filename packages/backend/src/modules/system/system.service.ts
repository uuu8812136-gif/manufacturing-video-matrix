import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { parsePage } from '../../common/utils/page.util';
import { BackupService } from './backup.service';

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private prisma: PrismaService,
    private backupService: BackupService,
  ) {}

  async auditLogs(query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = {};
    if (query.teamId) where.teamId = query.teamId;
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = { contains: query.action as string };
    const [list, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, phone: true, name: true, avatar: true, role: true, teamId: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async notifications(teamId: string, userId?: string) {
    const where: Record<string, unknown> = { teamId };
    if (userId) where.OR = [{ userId }, { userId: null }];
    return this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async markRead(teamId: string, userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, teamId, OR: [{ userId }, { userId: null }] },
      data: { read: true },
    });
    if (result.count === 0) throw new BadRequestException('通知不存在');
    return this.prisma.notification.findFirst({ where: { id, teamId } });
  }

  async log(userId: string, teamId: string, action: string, target: string, detail?: string, ip?: string) {
    return this.prisma.auditLog.create({ data: { userId, teamId, action, target, detail, ip } });
  }

  async backups() {
    return this.prisma.backupRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
  }

  async triggerBackup(type: 'full' | 'incremental') {
    if (type === 'full') return this.backupService.backupFull();
    return this.backupService.backupIncremental();
  }

  async restoreBackup(id: string) {
    return this.backupService.restore(id);
  }

  async downloadBackup(id: string) {
    return this.backupService.download(id);
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async dailyBackup() {
    this.logger.log('执行每日全量备份');
    try {
      await this.backupService.backupFull();
    } catch (err) {
      this.logger.error(`每日全量备份失败: ${(err as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async hourlyIncremental() {
    this.logger.log('执行每小时增量备份');
    try {
      await this.backupService.backupIncremental();
    } catch (err) {
      this.logger.error(`增量备份失败: ${(err as Error).message}`);
    }
  }
}
