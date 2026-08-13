import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { DistributionService } from '../distribution/distribution.service';
import { PlatformAdapterFactory } from '../platform-adapters/platform-adapter.factory';
import { SocialBrowserClient } from '../platform-adapters/social-browser.client';
import { AccountsService } from './accounts.service';

describe('AccountsService browser login persistence', () => {
  const prisma = {
    platformAccount: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    accountGroup: { findFirst: jest.fn() },
    region: { findFirst: jest.fn() },
    notification: { create: jest.fn() },
  };
  const socialBrowser = {
    isEnabled: jest.fn(),
    startLogin: jest.fn(),
    loginStatus: jest.fn(),
    cancelLogin: jest.fn(),
    deleteAccount: jest.fn(),
  };
  let service: AccountsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountsService(
      prisma as unknown as PrismaService,
      {} as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.count.mockResolvedValue(0);
    prisma.platformAccount.findFirst.mockResolvedValue(null);
    prisma.platformAccount.findMany.mockResolvedValue([]);
    socialBrowser.isEnabled.mockReturnValue(true);
    socialBrowser.cancelLogin.mockResolvedValue({ status: 'cancelled' });
    socialBrowser.deleteAccount.mockResolvedValue({ deleted: true });
  });

  it('caches a one-shot confirmed result and retries database persistence without polling the removed sidecar session', async () => {
    let accountRef = '';
    socialBrowser.startLogin.mockImplementation(async (_platform: string, value: string) => {
      accountRef = value;
      return {
        sessionId: 'session-confirmed-once',
        platform: 'douyin',
        qrImage: 'data:image/png;base64,AA==',
        expiresIn: 180,
        qrVersion: 1,
      };
    });
    socialBrowser.loginStatus.mockImplementation(async () => ({
      status: 'confirmed',
      message: '登录成功',
      platform: 'douyin',
      accountId: accountRef,
      saved: true,
      reloadVerified: true,
      userInfo: { user_id: 'douyin-user-1', name: '制造业账号' },
    }));
    prisma.platformAccount.create
      .mockRejectedValueOnce(new Error('Data too long for column credentials'))
      .mockResolvedValueOnce({
        id: 'account-1',
        teamId: 'team-1',
        platform: 'douyin',
        platformUid: 'douyin-user-1',
        nickname: '制造业账号',
        authType: 'scan',
        credentials: 'encrypted',
        status: 'active',
      });

    const started = await service.startBrowserLogin('team-1', 'user-1', {
      platform: 'douyin',
      nickname: '待绑定账号',
      isDealer: false,
    });

    await expect(
      service.browserLoginStatus('team-1', 'user-1', started.sessionId),
    ).resolves.toMatchObject({
      status: 'saving',
      saved: true,
      reloadVerified: true,
      persistencePending: true,
    });

    await expect(
      service.browserLoginStatus('team-1', 'user-1', started.sessionId),
    ).resolves.toMatchObject({
      status: 'confirmed',
      message: '扫码登录成功，已新增账号',
      accountPersistence: 'created_new',
      account: { id: 'account-1' },
    });

    expect(socialBrowser.loginStatus).toHaveBeenCalledTimes(1);
    expect(prisma.platformAccount.create).toHaveBeenCalledTimes(2);
    expect(socialBrowser.cancelLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['a direct numeric followerCount', { followerCount: 190 }, 190],
    ['a comma-separated follower_count in extra', { extra: { follower_count: '1,234' } }, 1234],
    ['a common fans_count alias in extra', { extra: { fans_count: 567 } }, 567],
  ])('persists %s from confirmed browser user info', async (_case, userInfo, expected) => {
    let accountRef = '';
    socialBrowser.startLogin.mockImplementation(async (_platform: string, value: string) => {
      accountRef = value;
      return {
        sessionId: `session-followers-${expected}`,
        platform: 'douyin',
        qrImage: 'data:image/png;base64,AA==',
        expiresIn: 180,
        qrVersion: 1,
      };
    });
    socialBrowser.loginStatus.mockImplementation(async () => ({
      status: 'confirmed',
      platform: 'douyin',
      accountId: accountRef,
      saved: true,
      reloadVerified: true,
      userInfo: {
        user_id: `douyin-user-${expected}`,
        name: '制造业账号',
        ...userInfo,
      },
    }));
    prisma.platformAccount.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `account-${expected}`,
      ...data,
    }));

    const started = await service.startBrowserLogin('team-1', 'user-1', {
      platform: 'douyin',
      nickname: '待绑定账号',
      isDealer: false,
    });
    await expect(
      service.browserLoginStatus('team-1', 'user-1', started.sessionId),
    ).resolves.toMatchObject({
      status: 'confirmed',
      message: '扫码登录成功，已新增账号',
      accountPersistence: 'created_new',
      account: { id: `account-${expected}` },
    });

    expect(prisma.platformAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        followerCount: expected,
        followerCountSyncedAt: expect.any(Date),
      }),
    });
  });

  it('marks an explicitly reported follower count as synchronized during a regular bind', async () => {
    const adapterFactory = {
      get: jest.fn().mockReturnValue({
        checkLogin: jest.fn().mockResolvedValue({
          valid: true,
          userInfo: { extra: { followers_count: 321 } },
        }),
      }),
    };
    const bindService = new AccountsService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'regular-account',
      ...data,
    }));

    await bindService.bind('team-1', {
      platform: 'douyin',
      nickname: '制造业账号',
      authType: 'cookie',
    });

    expect(prisma.platformAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        followerCount: 321,
        followerCountSyncedAt: expect.any(Date),
      }),
    });
  });

  it.each([
    [{ extra: { follower_count: '-1' } }],
    [{ followerCount: Number.POSITIVE_INFINITY }],
    [{ extra: { fans: 'not-a-number' } }],
  ])('does not overwrite an existing follower count with invalid user info', async (userInfo) => {
    const existing = {
      id: 'account-existing',
      teamId: 'team-1',
      platform: 'douyin',
      platformUid: 'douyin-existing',
      nickname: '制造业账号',
      authType: 'scan',
      credentials: null,
      followerCount: 88,
      groupId: null,
      regionId: null,
      parentAccountId: null,
    };
    let accountRef = '';
    socialBrowser.startLogin.mockImplementation(async (_platform: string, value: string) => {
      accountRef = value;
      return {
        sessionId: `session-invalid-${String(Object.values(userInfo)[0])}`,
        platform: 'douyin',
        qrImage: 'data:image/png;base64,AA==',
        expiresIn: 180,
        qrVersion: 1,
      };
    });
    socialBrowser.loginStatus.mockImplementation(async () => ({
      status: 'confirmed',
      platform: 'douyin',
      accountId: accountRef,
      saved: true,
      reloadVerified: true,
      userInfo: {
        user_id: existing.platformUid,
        name: existing.nickname,
        ...userInfo,
      },
    }));
    prisma.platformAccount.findFirst.mockResolvedValue(existing);
    prisma.platformAccount.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
    }));

    const started = await service.startBrowserLogin('team-1', 'user-1', {
      platform: 'douyin',
      nickname: existing.nickname,
      isDealer: false,
    });
    await expect(
      service.browserLoginStatus('team-1', 'user-1', started.sessionId),
    ).resolves.toMatchObject({
      status: 'confirmed',
      message: '扫码登录成功，已更新已有账号授权（未新增重复账号）',
      accountPersistence: 'updated_existing',
      account: { id: existing.id },
    });

    const updateData = prisma.platformAccount.update.mock.calls.at(-1)?.[0]?.data;
    expect(updateData).not.toHaveProperty('followerCount');
    expect(updateData).not.toHaveProperty('followerCountSyncedAt');
  });

  it.each([
    ['numeric string', { extra: { follower_count: '2,345' } }, 2345],
    ['explicit zero', { fanCount: '0' }, 0],
  ])('refreshes followerCount from browser check user info (%s)', async (_case, userInfo, expected) => {
    const account = {
      id: 'account-refresh',
      teamId: 'team-1',
      platform: 'douyin',
      nickname: '制造业账号',
      authType: 'scan',
      credentials: null,
      status: 'active',
      followerCount: 99,
      expiredAt: null,
    };
    const checkLogin = jest.fn().mockResolvedValue({ valid: true, userInfo });
    const adapterFactory = {
      get: jest.fn().mockReturnValue({ checkLogin }),
    };
    const refreshService = new AccountsService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.findFirst.mockResolvedValue(account);
    prisma.platformAccount.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...account,
      ...data,
    }));

    const result = await refreshService.refreshStatus('team-1', account.id);

    expect(adapterFactory.get).toHaveBeenCalledWith('douyin', 'scan');
    expect(prisma.platformAccount.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: expect.objectContaining({
        status: 'active',
        followerCount: expected,
        followerCountSyncedAt: expect.any(Date),
      }),
    });
    expect(result).toMatchObject({ followerCount: expected });
  });

  it('repairs an unstable stored platform UID from verified browser user info', async () => {
    const account = {
      id: 'account-refresh-identity',
      teamId: 'team-1',
      platform: 'video_account',
      platformUid: 'fallback-cookie-id',
      nickname: '视频号账号',
      authType: 'scan',
      credentials: null,
      status: 'active',
      followerCount: 2,
      expiredAt: null,
    };
    const adapterFactory = {
      get: jest.fn().mockReturnValue({
        checkLogin: jest.fn().mockResolvedValue({
          valid: true,
          userInfo: { user_id: 'stable-finder-id' },
        }),
      }),
    };
    const refreshService = new AccountsService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.findFirst
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(null);
    prisma.platformAccount.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...account,
      ...data,
    }));

    const result = await refreshService.refreshStatus('team-1', account.id);

    expect(prisma.platformAccount.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: expect.objectContaining({
        platformUid: 'stable-finder-id',
        status: 'active',
      }),
    });
    expect(result).toMatchObject({ platformUid: 'stable-finder-id' });
  });

  it('does not overwrite a platform UID when another account already owns it', async () => {
    const account = {
      id: 'account-refresh-conflict',
      teamId: 'team-1',
      platform: 'video_account',
      platformUid: 'fallback-cookie-id',
      nickname: '视频号账号',
      authType: 'scan',
      credentials: null,
      status: 'active',
      followerCount: 2,
      expiredAt: null,
    };
    const adapterFactory = {
      get: jest.fn().mockReturnValue({
        checkLogin: jest.fn().mockResolvedValue({
          valid: true,
          userInfo: { extra: { user_id: 'stable-finder-id' } },
        }),
      }),
    };
    const refreshService = new AccountsService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.findFirst
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce({ id: 'other-account' });
    prisma.platformAccount.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...account,
      ...data,
    }));

    await refreshService.refreshStatus('team-1', account.id);

    const updateData = prisma.platformAccount.update.mock.calls.at(-1)?.[0]?.data;
    expect(updateData).not.toHaveProperty('platformUid');
  });

  it('keeps the stored follower count when refresh user info has no valid count', async () => {
    const account = {
      id: 'account-refresh-invalid',
      teamId: 'team-1',
      platform: 'douyin',
      nickname: '制造业账号',
      authType: 'scan',
      credentials: null,
      status: 'active',
      followerCount: 99,
      expiredAt: null,
    };
    const adapterFactory = {
      get: jest.fn().mockReturnValue({
        checkLogin: jest.fn().mockResolvedValue({
          valid: true,
          userInfo: { extra: { follower_count: '-10' } },
        }),
      }),
    };
    const refreshService = new AccountsService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.findFirst.mockResolvedValue(account);
    prisma.platformAccount.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...account,
      ...data,
    }));

    const result = await refreshService.refreshStatus('team-1', account.id);

    const updateData = prisma.platformAccount.update.mock.calls.at(-1)?.[0]?.data;
    expect(updateData).not.toHaveProperty('followerCount');
    expect(updateData).not.toHaveProperty('followerCountSyncedAt');
    expect(result).toMatchObject({ followerCount: 99 });
  });

  it('does not trust follower data from an invalid browser login check', async () => {
    const account = {
      id: 'account-refresh-expired',
      teamId: 'team-1',
      platform: 'douyin',
      nickname: '制造业账号',
      authType: 'scan',
      credentials: null,
      status: 'expired',
      followerCount: 99,
      expiredAt: null,
    };
    const adapterFactory = {
      get: jest.fn().mockReturnValue({
        checkLogin: jest.fn().mockResolvedValue({
          valid: false,
          reason: '登录已过期',
          userInfo: { extra: { follower_count: 12345 } },
        }),
      }),
    };
    const refreshService = new AccountsService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.findFirst.mockResolvedValue(account);
    prisma.platformAccount.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...account,
      ...data,
    }));

    const result = await refreshService.refreshStatus('team-1', account.id);

    const updateData = prisma.platformAccount.update.mock.calls.at(-1)?.[0]?.data;
    expect(updateData).not.toHaveProperty('followerCount');
    expect(updateData).not.toHaveProperty('followerCountSyncedAt');
    expect(result).toMatchObject({ followerCount: 99, status: 'expired' });
  });

  it('preserves the last trusted account state on transient browser validation failures', async () => {
    const account = {
      id: 'account-refresh-transient',
      teamId: 'team-1',
      platform: 'bilibili',
      nickname: '制造业账号',
      authType: 'scan',
      credentials: null,
      status: 'active',
      followerCount: 99,
      expiredAt: null,
    };
    const adapterFactory = {
      get: jest.fn().mockReturnValue({
        checkLogin: jest.fn().mockResolvedValue({
          valid: false,
          transient: true,
          reason: 'validate exception: BrowserContext.new_page closed',
        }),
      }),
    };
    const refreshService = new AccountsService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.findFirst.mockResolvedValue(account);

    await expect(
      refreshService.refreshStatus('team-1', account.id),
    ).rejects.toThrow('已保留原账号状态');

    expect(prisma.platformAccount.update).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('refreshes scan profiles sequentially without expiring accounts or overwriting known followers on failures', async () => {
    prisma.platformAccount.findMany.mockResolvedValue([
      { id: 'scan-1', platform: 'douyin', credentials: 'credential-1' },
      { id: 'scan-2', platform: 'kuaishou', credentials: 'credential-2' },
      { id: 'scan-3', platform: 'xiaohongshu', credentials: 'credential-3' },
      { id: 'scan-4', platform: 'bilibili', credentials: 'credential-4' },
    ]);
    let activeChecks = 0;
    let maxActiveChecks = 0;
    const checkLogin = jest.fn().mockImplementation(async (credential: string) => {
      activeChecks++;
      maxActiveChecks = Math.max(maxActiveChecks, activeChecks);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeChecks--;
      if (credential === 'credential-1') {
        return { valid: true, userInfo: { extra: { follower_count: 190 } } };
      }
      if (credential === 'credential-2') {
        return { valid: true, userInfo: { name: '未返回粉丝字段' } };
      }
      if (credential === 'credential-3') {
        return {
          valid: false,
          reason: '平台临时未确认登录态',
          userInfo: { extra: { follower_count: 99999 } },
        };
      }
      throw new Error('临时网络失败');
    });
    const adapterFactory = {
      get: jest.fn().mockReturnValue({ checkLogin }),
    };
    const refreshService = new AccountsService(
      prisma as unknown as PrismaService,
      adapterFactory as unknown as PlatformAdapterFactory,
      {} as ConfigService,
      {} as DistributionService,
      socialBrowser as unknown as SocialBrowserClient,
    );
    prisma.platformAccount.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);

    await expect(refreshService.refreshScanAccountProfilesDaily()).resolves.toEqual({
      total: 4,
      refreshed: 2,
      followerSynced: 1,
      invalid: 1,
      failed: 1,
    });

    expect(maxActiveChecks).toBe(1);
    expect(prisma.platformAccount.findMany).toHaveBeenCalledWith({
      where: {
        authType: 'scan',
        status: 'active',
        credentials: { not: null },
      },
      select: {
        id: true,
        platform: true,
        credentials: true,
      },
      orderBy: { lastRefreshAt: 'asc' },
    });
    expect(prisma.platformAccount.update).toHaveBeenCalledTimes(2);
    expect(prisma.platformAccount.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'scan-1' },
      data: expect.objectContaining({
        followerCount: 190,
        followerCountSyncedAt: expect.any(Date),
        lastRefreshAt: expect.any(Date),
      }),
    });
    const secondUpdate = prisma.platformAccount.update.mock.calls[1][0];
    expect(secondUpdate).toMatchObject({
      where: { id: 'scan-2' },
      data: { lastRefreshAt: expect.any(Date) },
    });
    expect(secondUpdate.data).not.toHaveProperty('followerCount');
    expect(secondUpdate.data).not.toHaveProperty('followerCountSyncedAt');
    for (const call of prisma.platformAccount.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('status');
    }
  });
});
