import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdapterFactory } from '../platform-adapters/platform-adapter.factory';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { parsePage } from '../../common/utils/page.util';
import { CreateContentDto, PublishDto, BatchImportDto } from './dto/content.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PUBLISH_QUEUE } from './distribution.constants';
import { VideoProcessorService } from '../ai-creation/video-processor.service';
import * as mammoth from 'mammoth';

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: PlatformAdapterFactory,
    private videoProcessor: VideoProcessorService,
    @InjectQueue(PUBLISH_QUEUE) private publishQueue: Queue<{ taskId: string }>,
  ) {}

  // ---------- 内容 ----------
  async listContents(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.keyword) where.title = { contains: query.keyword as string };
    const [list, total] = await Promise.all([
      this.prisma.content.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.content.count({ where }),
    ]);
    return { list: list.map((item) => this.serializeContent(item)), total, page, pageSize };
  }

  async getContent(id: string, teamId: string) {
    const content = await this.prisma.content.findFirst({ where: { id, teamId } });
    return content ? this.serializeContent(content) : null;
  }

  async createContent(teamId: string, userId: string, dto: CreateContentDto) {
    return this.prisma.content.create({
      data: {
        teamId,
        type: dto.type,
        title: dto.title,
        coverUrl: dto.coverUrl,
        videoUrl: dto.videoUrl,
        body: dto.body,
        tags: JSON.stringify(dto.tags || []),
        watermark: dto.watermark,
        attachType: dto.attachType,
        attachValue: dto.attachValue,
        source: dto.source || 'manual',
        createdBy: userId,
      },
    });
  }

  async updateContent(id: string, teamId: string, dto: Partial<CreateContentDto>) {
    const data: Record<string, unknown> = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.coverUrl !== undefined) data.coverUrl = dto.coverUrl;
    if (dto.videoUrl !== undefined) data.videoUrl = dto.videoUrl;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.tags !== undefined) data.tags = JSON.stringify(dto.tags || []);
    if (dto.watermark !== undefined) data.watermark = dto.watermark;
    if (dto.attachType !== undefined) data.attachType = dto.attachType;
    if (dto.attachValue !== undefined) data.attachValue = dto.attachValue;
    if (dto.source !== undefined) data.source = dto.source;
    return this.prisma.content.updateMany({ where: { id, teamId }, data });
  }

  async deleteContent(id: string, teamId: string) {
    return this.prisma.content.deleteMany({ where: { id, teamId } });
  }

  async importWord(teamId: string, userId: string, buffer: Buffer, originalName: string) {
    const extracted = await mammoth.extractRawText({ buffer });
    const body = extracted.value.trim();
    if (!body) throw new BadRequestException('Word 文档中没有可导入的文字内容');
    const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || originalName.replace(/\.docx$/i, '');
    const content = await this.prisma.content.create({
      data: {
        teamId,
        type: 'image_text',
        title: firstLine.slice(0, 100),
        body,
        source: 'batch_import',
        createdBy: userId,
      },
    });
    return this.serializeContent(content);
  }

  // ---------- 发布 ----------
  async publish(teamId: string, userId: string, dto: PublishDto) {
    const content = await this.prisma.content.findFirst({ where: { id: dto.contentId, teamId } });
    if (!content) throw new BadRequestException('内容不存在');
    if (content.type === 'video' && !content.videoUrl) throw new BadRequestException('视频内容缺少视频地址');
    if (content.type !== 'video' && !content.coverUrl && !content.body) throw new BadRequestException('图文内容至少需要封面或正文');
    const accounts = await this.prisma.platformAccount.findMany({
      where: { id: { in: dto.accountIds }, teamId, status: 'active' },
    });
    const requestedIds = [...new Set(dto.accountIds)];
    if (accounts.length !== requestedIds.length) throw new BadRequestException('包含无效或不属于当前企业的账号');

    let scheduledAt: Date | null = null;
    if (dto.scheduledAt) {
      scheduledAt = new Date(dto.scheduledAt);
      const now = Date.now();
      if (scheduledAt.getTime() <= now) throw new BadRequestException('定时时间必须晚于当前时间');
      if (scheduledAt.getTime() > now + 7 * 24 * 60 * 60 * 1000) {
        throw new BadRequestException('定时发布最多可设置未来 7 天');
      }
    }

    const status = scheduledAt ? 'scheduled' : 'queued';
    const task = await this.prisma.publishTask.create({
      data: {
        teamId,
        contentId: content.id,
        accountIds: JSON.stringify(requestedIds),
        platforms: JSON.stringify(accounts.map((a) => a.platform)),
        scheduledAt,
        status,
        createdBy: userId,
      },
    });

    await this.prisma.publishRecord.createMany({
      data: accounts.map((a) => ({
        taskId: task.id,
        accountId: a.id,
        platform: a.platform,
        status: status === 'scheduled' ? 'queued' : 'queued',
      })),
    });

    await this.enqueueTask(task.id, scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0);
    return task;
  }

  private async enqueueTask(taskId: string, delay = 0) {
    try {
      await this.publishQueue.add(
        'publish-task',
        { taskId },
        {
          jobId: `publish-${taskId}`,
          delay,
          attempts: 4,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 24 * 3600, count: 5000 },
          removeOnFail: { age: 7 * 24 * 3600, count: 10000 },
        },
      );
    } catch (err) {
      await this.prisma.publishTask.update({
        where: { id: taskId },
        data: { status: 'failed' },
      });
      throw new BadRequestException(`发布任务入队失败：${(err as Error).message}`);
    }
  }

  async listTasks(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.status) where.status = query.status;
    const [list, total] = await Promise.all([
      this.prisma.publishTask.findMany({
        where,
        include: { content: true, records: { include: { account: true } } },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.publishTask.count({ where }),
    ]);
    const safeList = list.map((task) => ({
      ...task,
      records: task.records.map((record) => {
        const { credentials: _credentials, ...account } = record.account;
        return { ...record, account };
      }),
    }));
    return { list: safeList, total, page, pageSize };
  }

  async getTask(id: string, teamId: string) {
    const task = await this.prisma.publishTask.findFirst({
      where: { id, teamId },
      include: { content: true, records: { include: { account: true } } },
    });
    if (!task) return null;
    return {
      ...task,
      records: task.records.map((record) => {
        const { credentials: _credentials, ...account } = record.account;
        return { ...record, account };
      }),
    };
  }

  async cancelTask(id: string, teamId: string) {
    const task = await this.prisma.publishTask.findFirst({ where: { id, teamId } });
    if (!task) throw new BadRequestException('发布任务不存在');
    if (task.status !== 'scheduled') throw new BadRequestException('仅尚未开始的定时任务可以取消');

    const job = await this.publishQueue.getJob(`publish-${task.id}`);
    if (job) {
      try {
        await job.remove();
      } catch (error) {
        throw new BadRequestException(`取消定时任务失败：${(error as Error).message}`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.publishTask.update({
        where: { id: task.id },
        data: { status: 'cancelled' },
      }),
      this.prisma.publishRecord.updateMany({
        where: { taskId: task.id, status: 'queued' },
        data: { status: 'cancelled', failReason: '用户取消定时发布' },
      }),
      this.prisma.reviewFlow.updateMany({
        where: { publishTaskId: task.id },
        data: { status: 'approved', publishTaskId: null },
      }),
      this.prisma.recreationContent.updateMany({
        where: { publishTaskId: task.id },
        data: { status: 'selected', publishTaskId: null },
      }),
    ]);
    return { id: task.id, status: 'cancelled' };
  }

  async batchImport(teamId: string, userId: string, dto: BatchImportDto) {
    if (dto.items.length > 30) throw new BadRequestException('批量导入最多 30 条 (FR-CD-001)');
    if (dto.items.some((item) => !item.videoUrl?.trim())) {
      throw new BadRequestException('批量发布的每条视频都必须提供视频地址');
    }
    const requestedIds = [...new Set(dto.accountIds)];
    const accountCount = await this.prisma.platformAccount.count({
      where: { id: { in: requestedIds }, teamId, status: 'active' },
    });
    if (accountCount !== requestedIds.length) {
      throw new BadRequestException('包含无效或不属于当前企业的账号');
    }
    const created = [];
    for (const item of dto.items) {
      const content = await this.prisma.content.create({
        data: {
          teamId,
          type: 'video',
          title: item.title,
          videoUrl: item.videoUrl,
          coverUrl: item.coverUrl,
          tags: JSON.stringify(item.tags || []),
          source: 'batch_import',
          createdBy: userId,
        },
      });
      const task = await this.publish(teamId, userId, {
        contentId: content.id,
        accountIds: dto.accountIds,
      });
      created.push({ content, task });
    }
    return { count: created.length, items: created };
  }

  async processTask(taskId: string) {
    const task = await this.prisma.publishTask.findUnique({
      where: { id: taskId },
      include: { content: true, records: true },
    });
    if (!task) return;
    if (task.status === 'published') return;
    await this.prisma.publishTask.update({ where: { id: taskId }, data: { status: 'publishing' } });
    const preparedVideos = new Map<string, string>();
    if (task.content.type === 'video' && task.content.videoUrl) {
      for (const platform of new Set(task.records.map((record) => record.platform))) {
        const url = task.content.videoUrl.startsWith('mock://')
          ? task.content.videoUrl
          : await this.videoProcessor.mixcut([task.content.videoUrl], {
              ratio: this.platformRatio(platform),
              watermark: task.content.watermark || undefined,
            });
        preparedVideos.set(platform, url);
      }
    }
    for (const record of task.records) {
      if (record.status === 'published') continue;
      await this.processRecord(record.id, preparedVideos.get(record.platform));
    }
    const records = await this.prisma.publishRecord.findMany({ where: { taskId } });
    const allDone = records.every((r) => r.status === 'published');
    const anyFail = records.some((r) => r.status === 'failed');
    await this.prisma.publishTask.update({
      where: { id: taskId },
      data: { status: allDone ? 'published' : anyFail ? 'failed' : 'publishing' },
    });
    if (allDone) {
      await this.prisma.$transaction([
        this.prisma.recreationContent.updateMany({
          where: { publishTaskId: taskId },
          data: { status: 'published' },
        }),
        this.prisma.reviewFlow.updateMany({
          where: { publishTaskId: taskId },
          data: { status: 'published' },
        }),
      ]);
    }
    if (anyFail) throw new Error(`发布任务 ${taskId} 存在失败记录，将按队列策略重试`);
  }

  private async processRecord(recordId: string, preparedVideoUrl?: string) {
    const record = await this.prisma.publishRecord.findUnique({
      where: { id: recordId },
      include: { account: true, task: { include: { content: true } } },
    });
    if (!record) return;
    try {
      const adapter = this.adapterFactory.get(record.platform, record.account.authType);
      const credentials = record.account.credentials
        ? CryptoUtil.decrypt(record.account.credentials)
        : '';
      const content = record.task.content;
      let result;
      if (content.type === 'video') {
        if (!content.videoUrl) throw new BadRequestException('视频内容缺少视频地址');
        result = await adapter.publishVideo({
          accountCredentials: credentials,
          videoUrl: preparedVideoUrl || content.videoUrl || '',
          title: content.title,
          coverUrl: content.coverUrl || undefined,
          tags: content.tags ? JSON.parse(content.tags) : [],
          attachType: content.attachType || undefined,
          attachValue: content.attachValue || undefined,
        });
      } else {
        result = await adapter.publishImageText({
          accountCredentials: credentials,
          images: content.coverUrl ? [content.coverUrl] : [],
          title: content.title,
          body: content.body || '',
          tags: content.tags ? JSON.parse(content.tags) : [],
          attachType: content.attachType || undefined,
          attachValue: content.attachValue || undefined,
        });
      }
      await this.prisma.publishRecord.update({
        where: { id: recordId },
        data: {
          status: result.success ? 'published' : 'failed',
          platformContentId: result.platformContentId,
          failReason: result.failReason,
          publishedAt: result.success ? new Date() : null,
        },
      });
    } catch (err) {
      this.logger.error(`发布失败 ${recordId}: ${(err as Error).message}`);
      await this.prisma.publishRecord.update({
        where: { id: recordId },
        data: { status: 'failed', failReason: (err as Error).message },
      });
    }
  }

  private platformRatio(platform: string) {
    return platform === 'bilibili' || platform === 'baijiahao' ? '16:9' : '9:16';
  }

  private serializeContent<T extends { tags: string | null }>(content: T) {
    let tags: string[] = [];
    try {
      tags = content.tags ? JSON.parse(content.tags) : [];
    } catch {
      tags = [];
    }
    return { ...content, tags };
  }

  async markTaskFailed(taskId: string, reason: string) {
    const failReason = reason.slice(0, 2000);
    await this.prisma.$transaction([
      this.prisma.publishTask.updateMany({ where: { id: taskId, status: { not: 'published' } }, data: { status: 'failed' } }),
      this.prisma.publishRecord.updateMany({ where: { taskId, status: { not: 'published' } }, data: { status: 'failed', failReason } }),
      this.prisma.recreationContent.updateMany({ where: { publishTaskId: taskId, status: { not: 'published' } }, data: { status: 'failed' } }),
      this.prisma.reviewFlow.updateMany({ where: { publishTaskId: taskId, status: { not: 'published' } }, data: { status: 'failed' } }),
    ]);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduled() {
    const due = await this.prisma.publishTask.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
    });
    for (const task of due) {
      this.logger.log(`处理定时任务 ${task.id}`);
      await this.enqueueTask(task.id);
    }
  }
}
