import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parsePage } from '../../common/utils/page.util';
import { CreateAnnotationDto, CreateReviewDto, ReviewActionDto, CreateTaskDto, UpdateTaskDto, CreateCalendarDto, PublishReviewDto } from './dto/team.dto';
import { DistributionService } from '../distribution/distribution.service';

@Injectable()
export class TeamCollaborationService {
  constructor(private prisma: PrismaService, private distribution: DistributionService) {}

  // ---------- 审核 ----------
  async listReviews(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.status) where.status = query.status;
    const [list, total] = await Promise.all([
      this.prisma.reviewFlow.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.reviewFlow.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async submitReview(teamId: string, userId: string, dto: CreateReviewDto) {
    if (dto.contentId) {
      const content = await this.prisma.content.findFirst({ where: { id: dto.contentId, teamId } });
      if (!content) throw new BadRequestException('内容不存在或不属于当前企业');
    }
    return this.prisma.reviewFlow.create({
      data: { teamId, title: dto.title, contentId: dto.contentId, status: 'pending', submitterId: userId },
    });
  }

  async reviewAction(teamId: string, id: string, reviewerId: string, dto: ReviewActionDto) {
    const review = await this.prisma.reviewFlow.findFirst({ where: { id, teamId } });
    if (!review) throw new BadRequestException('审核记录不存在');
    if (review.status !== 'pending') throw new BadRequestException('该审核已处理');
    const status = dto.action === 'approve' ? 'approved' : 'rejected';
    return this.prisma.reviewFlow.update({
      where: { id },
      data: { status, reviewerId, comment: dto.comment },
    });
  }

  async publishReview(teamId: string, userId: string, id: string, dto: PublishReviewDto) {
    const review = await this.prisma.reviewFlow.findFirst({ where: { id, teamId } });
    if (!review) throw new BadRequestException('审核记录不存在');
    if (!['approved', 'failed'].includes(review.status)) throw new BadRequestException('仅已通过审核或发布失败的内容可以重新发布');
    if (!review.contentId) throw new BadRequestException('审核单未关联内容，无法发布');
    const task = await this.distribution.publish(teamId, userId, {
      contentId: review.contentId,
      accountIds: dto.accountIds,
      scheduledAt: dto.scheduledAt,
    });
    await this.prisma.reviewFlow.update({
      where: { id },
      data: {
        publishTaskId: task.id,
        status: task.status === 'scheduled' ? 'scheduled' : 'publishing',
      },
    });
    return task;
  }

  // ---------- 任务 ----------
  async listTasks(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.status) where.status = query.status;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    const [list, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          assignee: { select: { id: true, phone: true, name: true, avatar: true, role: true } },
          creator: { select: { id: true, phone: true, name: true, avatar: true, role: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async createTask(teamId: string, userId: string, dto: CreateTaskDto) {
    if (dto.assigneeId) {
      const assignee = await this.prisma.user.findFirst({ where: { id: dto.assigneeId, teamId, status: 'active' } });
      if (!assignee) throw new BadRequestException('负责人不存在或不属于当前企业');
    }
    return this.prisma.task.create({
      data: {
        teamId,
        title: dto.title,
        description: dto.description,
        type: dto.type || 'creation',
        assigneeId: dto.assigneeId,
        creatorId: userId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
    });
  }

  async updateTask(teamId: string, userId: string, role: string, id: string, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findFirst({ where: { id, teamId } });
    if (!task) throw new BadRequestException('任务不存在');
    const manager = role === 'super_admin' || role === 'ops_lead';
    if (!manager && task.assigneeId !== userId) throw new BadRequestException('只能更新分配给自己的任务');
    if (!manager && dto.assigneeId && dto.assigneeId !== task.assigneeId) throw new BadRequestException('无权重新分配任务');
    if (dto.assigneeId) {
      const assignee = await this.prisma.user.findFirst({ where: { id: dto.assigneeId, teamId, status: 'active' } });
      if (!assignee) throw new BadRequestException('负责人不存在或不属于当前企业');
    }
    return this.prisma.task.update({
      where: { id },
      data: { status: dto.status, assigneeId: dto.assigneeId },
    });
  }

  async performance(teamId: string) {
    const users = await this.prisma.user.findMany({ where: { teamId } });
    const tasks = await this.prisma.task.groupBy({
      by: ['assigneeId'],
      where: { teamId, assigneeId: { not: null } },
      _count: { _all: true },
    });
    const done = await this.prisma.task.groupBy({
      by: ['assigneeId'],
      where: { teamId, status: 'done', assigneeId: { not: null } },
      _count: { _all: true },
    });
    const taskMap = new Map(tasks.map((t) => [t.assigneeId, t._count._all]));
    const doneMap = new Map(done.map((t) => [t.assigneeId, t._count._all]));
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      taskCount: taskMap.get(u.id) || 0,
      doneCount: doneMap.get(u.id) || 0,
    }));
  }

  // ---------- 内容日历 ----------
  async calendar(teamId: string, month?: string) {
    const where: Record<string, unknown> = { teamId };
    if (month) {
      const start = new Date(`${month}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.scheduledAt = { gte: start, lt: end };
    }
    return this.prisma.calendarEvent.findMany({ where, orderBy: { scheduledAt: 'asc' } });
  }

  async createCalendar(teamId: string, userId: string, dto: CreateCalendarDto) {
    if (dto.contentId) {
      const content = await this.prisma.content.findFirst({ where: { id: dto.contentId, teamId } });
      if (!content) throw new BadRequestException('内容不存在或不属于当前企业');
    }
    if (dto.contentId && dto.accountIds?.length) {
      if (dto.platform) {
        const accounts = await this.prisma.platformAccount.findMany({
          where: {
            id: { in: [...new Set(dto.accountIds)] },
            teamId,
            status: 'active',
          },
          select: { platform: true },
        });
        if (accounts.some((account) => account.platform !== dto.platform)) {
          throw new BadRequestException('发布账号必须与排期平台一致');
        }
      }
      await this.distribution.publish(teamId, userId, {
        contentId: dto.contentId,
        accountIds: dto.accountIds,
        scheduledAt: dto.scheduledAt,
      });
    }
    return this.prisma.calendarEvent.create({
      data: {
        teamId,
        title: dto.title,
        contentId: dto.contentId,
        accountIds: dto.accountIds ? JSON.stringify(dto.accountIds) : null,
        platform: dto.platform,
        scheduledAt: new Date(dto.scheduledAt),
        status: dto.contentId && dto.accountIds?.length ? 'scheduled' : 'planned',
      },
    });
  }

  async annotations(teamId: string, contentId: string) {
    const content = await this.prisma.content.findFirst({ where: { id: contentId, teamId } });
    if (!content) throw new BadRequestException('内容不存在');
    const rows = await this.prisma.annotation.findMany({
      where: { teamId, contentId },
      include: { user: { select: { id: true, name: true, avatar: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({ ...row, position: row.position ? JSON.parse(row.position) : null }));
  }

  async createAnnotation(teamId: string, userId: string, contentId: string, dto: CreateAnnotationDto) {
    const content = await this.prisma.content.findFirst({ where: { id: contentId, teamId } });
    if (!content) throw new BadRequestException('内容不存在');
    return this.prisma.annotation.create({
      data: { teamId, userId, contentId, text: dto.text, position: dto.position ? JSON.stringify(dto.position) : null },
      include: { user: { select: { id: true, name: true, avatar: true, role: true } } },
    });
  }
}
