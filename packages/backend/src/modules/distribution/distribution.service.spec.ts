import { BadRequestException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoProcessorService } from '../ai-creation/video-processor.service';
import { PlatformAdapterFactory } from '../platform-adapters/platform-adapter.factory';
import { DistributionService } from './distribution.service';

describe('DistributionService task lifecycle', () => {
  const remove = jest.fn();
  const queue = {
    getJob: jest.fn(),
  };
  const prisma = {
    publishTask: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    publishRecord: {
      updateMany: jest.fn(),
    },
    reviewFlow: {
      updateMany: jest.fn(),
    },
    recreationContent: {
      updateMany: jest.fn(),
    },
    platformAccount: {
      count: jest.fn(),
    },
    content: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };
  let service: DistributionService;

  beforeEach(() => {
    jest.clearAllMocks();
    queue.getJob.mockResolvedValue({ remove });
    remove.mockResolvedValue(undefined);
    prisma.publishTask.update.mockResolvedValue({});
    prisma.publishRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.reviewFlow.updateMany.mockResolvedValue({ count: 1 });
    prisma.recreationContent.updateMany.mockResolvedValue({ count: 1 });
    service = new DistributionService(
      prisma as unknown as PrismaService,
      {} as PlatformAdapterFactory,
      {} as VideoProcessorService,
      queue as unknown as Queue<{ taskId: string }>,
    );
  });

  it('removes a delayed job and restores linked workflows when a scheduled task is cancelled', async () => {
    prisma.publishTask.findFirst.mockResolvedValue({
      id: 'task-1',
      teamId: 'team-1',
      status: 'scheduled',
    });

    await expect(service.cancelTask('task-1', 'team-1')).resolves.toEqual({
      id: 'task-1',
      status: 'cancelled',
    });

    expect(queue.getJob).toHaveBeenCalledWith('publish-task-1');
    expect(remove).toHaveBeenCalled();
    expect(prisma.publishTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'cancelled' },
    });
    expect(prisma.reviewFlow.updateMany).toHaveBeenCalledWith({
      where: { publishTaskId: 'task-1' },
      data: { status: 'approved', publishTaskId: null },
    });
    expect(prisma.recreationContent.updateMany).toHaveBeenCalledWith({
      where: { publishTaskId: 'task-1' },
      data: { status: 'selected', publishTaskId: null },
    });
  });

  it('does not cancel a task that has already started', async () => {
    prisma.publishTask.findFirst.mockResolvedValue({
      id: 'task-1',
      teamId: 'team-1',
      status: 'publishing',
    });

    await expect(service.cancelTask('task-1', 'team-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it('rejects an incomplete batch before creating orphaned content', async () => {
    await expect(service.batchImport('team-1', 'user-1', {
      items: [{ title: '测试视频', videoUrl: '' }],
      accountIds: ['account-1'],
    })).rejects.toThrow('每条视频都必须提供视频地址');

    expect(prisma.content.create).not.toHaveBeenCalled();
  });
});
