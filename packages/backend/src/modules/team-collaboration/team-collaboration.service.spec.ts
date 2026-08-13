import { BadRequestException } from '@nestjs/common';
import { TeamCollaborationService } from './team-collaboration.service';

describe('TeamCollaborationService calendar platform validation', () => {
  const prisma = {
    content: { findFirst: jest.fn() },
    platformAccount: { findMany: jest.fn() },
    calendarEvent: { create: jest.fn() },
  };
  const distribution = { publish: jest.fn() };
  const service = new TeamCollaborationService(prisma as never, distribution as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.content.findFirst.mockResolvedValue({ id: 'content-1' });
    prisma.calendarEvent.create.mockResolvedValue({ id: 'event-1' });
    distribution.publish.mockResolvedValue({ id: 'task-1', status: 'scheduled' });
  });

  it('rejects an active account from a different platform before publishing', async () => {
    prisma.platformAccount.findMany.mockResolvedValue([{ platform: 'video_account' }]);

    await expect(service.createCalendar('team-1', 'user-1', {
      title: '抖音排期',
      platform: 'douyin',
      contentId: 'content-1',
      accountIds: ['account-1'],
      scheduledAt: '2026-07-30T03:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(distribution.publish).not.toHaveBeenCalled();
    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('publishes when every selected account matches the calendar platform', async () => {
    prisma.platformAccount.findMany.mockResolvedValue([{ platform: 'douyin' }]);

    await service.createCalendar('team-1', 'user-1', {
      title: '抖音排期',
      platform: 'douyin',
      contentId: 'content-1',
      accountIds: ['account-1'],
      scheduledAt: '2026-07-30T03:00:00.000Z',
    });

    expect(distribution.publish).toHaveBeenCalledWith('team-1', 'user-1', {
      contentId: 'content-1',
      accountIds: ['account-1'],
      scheduledAt: '2026-07-30T03:00:00.000Z',
    });
    expect(prisma.calendarEvent.create).toHaveBeenCalled();
  });
});
