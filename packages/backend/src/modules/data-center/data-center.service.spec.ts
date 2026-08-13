import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdapterFactory } from '../platform-adapters/platform-adapter.factory';
import { DataCenterService } from './data-center.service';

describe('DataCenterService follower synchronization', () => {
  const prisma = {
    team: { findMany: jest.fn() },
    platformAccount: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    dataSnapshot: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const fetchStats = jest.fn();
  const adapterFactory = {
    get: jest.fn().mockReturnValue({ fetchStats }),
  };
  let service: DataCenterService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DataCenterService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
    );
    prisma.team.findMany.mockResolvedValue([{ id: 'team-1' }]);
    prisma.platformAccount.findMany.mockResolvedValue([{
      id: 'account-1',
      teamId: 'team-1',
      platform: 'video_account',
      authType: 'cookie',
      credentials: null,
      nickname: '制造业账号',
    }]);
    prisma.dataSnapshot.upsert.mockResolvedValue({});
    prisma.platformAccount.update.mockResolvedValue({});
  });

  it('uses synchronized current account followers for overview instead of snapshot defaults', async () => {
    const syncedAt = new Date('2026-07-16T08:00:00.000Z');
    prisma.platformAccount.findMany.mockResolvedValueOnce([
      { id: 'account-1', followerCount: 190, followerCountSyncedAt: syncedAt },
      { id: 'account-2', followerCount: 0, followerCountSyncedAt: syncedAt },
      { id: 'account-3', followerCount: 0, followerCountSyncedAt: null },
    ]);
    prisma.dataSnapshot.findFirst.mockImplementation(async ({ where }: {
      where: { accountId: string };
    }) => ({
      id: `snapshot-${where.accountId}`,
      playCount: 10,
      readCount: 2,
      fanCount: 999,
      likeCount: 3,
      commentCount: 1,
      shareCount: 1,
      revenue: null,
    }));

    await expect(service.overview('team-1')).resolves.toMatchObject({
      accountCount: 3,
      totalPlay: 30,
      totalFan: 190,
      followerSyncedAccountCount: 2,
      followerUnsyncedAccountCount: 1,
    });
  });

  it('carries follower synchronization state in account ranking', async () => {
    const syncedAt = new Date('2026-07-16T08:00:00.000Z');
    prisma.platformAccount.findMany.mockResolvedValueOnce([
      {
        id: 'account-1',
        nickname: '已同步账号',
        platform: 'douyin',
        followerCount: 190,
        followerCountSyncedAt: syncedAt,
        dataSnapshots: [],
      },
      {
        id: 'account-2',
        nickname: '未同步账号',
        platform: 'kuaishou',
        followerCount: 0,
        followerCountSyncedAt: null,
        dataSnapshots: [],
      },
    ]);

    await expect(service.accountRanking('team-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'account-1',
        followerCount: 190,
        followerCountSyncedAt: syncedAt,
      }),
      expect.objectContaining({
        id: 'account-2',
        followerCount: 0,
        followerCountSyncedAt: null,
      }),
    ]);
  });

  it('does not overwrite a stored follower count when stats omit the follower metric', async () => {
    fetchStats.mockResolvedValue({
      playCount: 10,
      readCount: 20,
      likeCount: 3,
      commentCount: 2,
      shareCount: 1,
    });

    await service.aggregateDaily();

    const upsert = prisma.dataSnapshot.upsert.mock.calls[0][0];
    expect(upsert.update).not.toHaveProperty('fanCount');
    expect(upsert.create).not.toHaveProperty('fanCount');
    expect(prisma.platformAccount.update).not.toHaveBeenCalled();
  });

  it('stores and marks an explicitly reported zero follower count as synchronized', async () => {
    fetchStats.mockResolvedValue({
      playCount: 10,
      readCount: 20,
      fanCount: 0,
      likeCount: 3,
      commentCount: 2,
      shareCount: 1,
    });

    await service.aggregateDaily();

    const upsert = prisma.dataSnapshot.upsert.mock.calls[0][0];
    expect(upsert.update).toMatchObject({ fanCount: 0 });
    expect(upsert.create).toMatchObject({ fanCount: 0 });
    expect(prisma.platformAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: {
        followerCount: 0,
        followerCountSyncedAt: expect.any(Date),
      },
    });
  });

  it('reports an unconfigured hotspot sync as skipped instead of successful', async () => {
    const config = { get: jest.fn().mockReturnValue('') };
    const hotspotService = new DataCenterService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      config as unknown as ConfigService,
    );

    await expect(hotspotService.syncHotTopics()).resolves.toEqual({
      synced: 0,
      skipped: true,
      reason: '未配置 HOT_TOPIC_API_URL，未执行热点同步',
    });
  });
});
