import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { parsePage } from '../../common/utils/page.util';
import { BindAccountDto, UpdateAccountDto, CreateGroupDto, CreateRegionDto, BrowserLoginStartDto, UpdateGroupDto, UpdateRegionDto } from './dto/account.dto';
import { PlatformAdapterFactory } from '../platform-adapters/platform-adapter.factory';
import { ConfigService } from '@nestjs/config';
import { ExchangeOAuthDto } from './dto/account.dto';
import { buildAuthorizationUrl, exchangeCodeForToken, refreshToken as refreshOAuthToken } from '../platform-adapters/oauth.util';
import { DistributionService } from '../distribution/distribution.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { BrowserLoginStatus, SocialBrowserClient } from '../platform-adapters/social-browser.client';

interface PendingBrowserLogin {
  teamId: string;
  userId: string;
  platform: string;
  accountRef: string;
  nickname: string;
  groupId?: string;
  regionId?: string;
  isDealer: boolean;
  parentAccountId?: string;
  expiresAt: number;
  qrVersion: number;
  scanExtended?: boolean;
  verifiedResult?: BrowserLoginStatus;
  persistencePromise?: Promise<Record<string, unknown>>;
  persistenceFailures?: number;
  completed?: Record<string, unknown>;
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);
  private readonly browserLogins = new Map<string, PendingBrowserLogin>();
  constructor(
    private prisma: PrismaService,
    private adapterFactory: PlatformAdapterFactory,
    private config: ConfigService,
    private distribution: DistributionService,
    private socialBrowser: SocialBrowserClient,
  ) {}

  private withoutCredentials<T extends { credentials?: string | null }>(account: T): Omit<T, 'credentials'> {
    const { credentials: _credentials, ...safe } = account;
    return safe;
  }

  private async assertRelations(teamId: string, groupId?: string, regionId?: string) {
    if (groupId) {
      const group = await this.prisma.accountGroup.findFirst({ where: { id: groupId, teamId } });
      if (!group) throw new BadRequestException('账号分组不存在或不属于当前企业');
    }
    if (regionId) {
      const region = await this.prisma.region.findFirst({ where: { id: regionId, teamId } });
      if (!region) throw new BadRequestException('区域不存在或不属于当前企业');
    }
  }

  oauthAuthorizationUrl(teamId: string, userId: string, platform: string, redirectUri: string) {
    if (!['douyin', 'video_account', 'kuaishou', 'xiaohongshu', 'bilibili', 'baijiahao'].includes(platform)) {
      throw new BadRequestException('不支持的平台');
    }
    let redirect: URL;
    try {
      redirect = new URL(redirectUri);
    } catch {
      throw new BadRequestException('回调地址格式不正确');
    }
    const allowed = new Set([
      ...(this.config.get<string>('CORS_ORIGIN') || '').split(',').map((item) => item.trim()).filter(Boolean),
      this.config.get<string>('APP_DOMAIN') || '',
    ].map((item) => {
      try { return new URL(item).origin; } catch { return ''; }
    }).filter(Boolean));
    if (allowed.size && !allowed.has(redirect.origin)) throw new BadRequestException('回调地址不在允许域名内');
    try {
      const state = this.createOAuthState(teamId, userId, platform, redirect.toString());
      return { url: buildAuthorizationUrl(platform, redirect.toString(), state, this.config) };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  async startBrowserLogin(teamId: string, userId: string, dto: BrowserLoginStartDto) {
    if (!this.socialBrowser.isEnabled()) {
      throw new BadRequestException('浏览器扫码服务未启用');
    }
    await this.cleanupExpiredBrowserLogins();
    await this.assertRelations(teamId, dto.groupId, dto.regionId);
    const count = await this.prisma.platformAccount.count({ where: { teamId } });
    if (count >= 200) throw new BadRequestException('单个企业最多绑定 200 个账号 (FR-AM-003)');
    if (dto.parentAccountId) {
      const parent = await this.prisma.platformAccount.findFirst({ where: { id: dto.parentAccountId, teamId } });
      if (!parent) throw new BadRequestException('总部账号不存在或不属于当前企业');
    }
    await this.cancelSupersededBrowserLogins(teamId, userId, dto.platform);

    const accountRef = randomUUID();
    const result = await this.socialBrowser.startLogin(dto.platform, accountRef);
    this.browserLogins.set(result.sessionId, {
      teamId,
      userId,
      platform: dto.platform,
      accountRef,
      nickname: dto.nickname,
      groupId: dto.groupId,
      regionId: dto.regionId,
      isDealer: dto.isDealer ?? false,
      parentAccountId: dto.parentAccountId,
      expiresAt: Date.now() + Math.min(Math.max(result.expiresIn, 60), 300) * 1000,
      qrVersion: result.qrVersion || 1,
    });
    return result;
  }

  async browserLoginStatus(teamId: string, userId: string, sessionId: string) {
    await this.cleanupExpiredBrowserLogins();
    const pending = this.browserLogins.get(sessionId);
    if (!pending || pending.teamId !== teamId || pending.userId !== userId) {
      throw new BadRequestException('扫码会话不存在、已过期或不属于当前用户');
    }
    if (pending.completed) return pending.completed;

    let result = pending.verifiedResult;
    if (!result) {
      result = await this.socialBrowser.loginStatus(sessionId);
    }
    if (result.status !== 'confirmed') {
      if ((result.qrVersion || 0) > pending.qrVersion) {
        pending.qrVersion = result.qrVersion || pending.qrVersion;
        pending.scanExtended = false;
        pending.expiresAt = Date.now()
          + Math.min(Math.max(result.expiresIn || 60, 15), 300) * 1000;
      }
      if ((result.status === 'scanned' || result.status === 'security_verification') && !pending.scanExtended) {
        pending.scanExtended = true;
        pending.expiresAt = Date.now() + 180_000;
      }
      if (result.status === 'failed' || result.status === 'expired') this.browserLogins.delete(sessionId);
      return result;
    }
    if (!result.saved || !result.reloadVerified || result.accountId !== pending.accountRef) {
      throw new BadRequestException('扫码服务未确认登录态已安全保存，请重新扫码');
    }

    // social-browser 的 confirmed 是一次性响应：它会先关闭二维码浏览器，
    // 用 storage_state 重载复验并保存文件，然后清理原扫码 session。必须在
    // 任何数据库操作之前缓存该结果，否则数据库的瞬时失败会让下一次轮询
    // 再去请求已清理的 sidecar session，并把真实成功误报为“已过期”。
    pending.verifiedResult = result;
    pending.expiresAt = Date.now() + 15 * 60_000;

    const persistence = pending.persistencePromise
      || this.persistVerifiedBrowserLogin(teamId, pending, result);
    pending.persistencePromise = persistence;
    try {
      const response = await persistence;
      pending.completed = response;
      pending.persistenceFailures = 0;
      pending.expiresAt = Date.now() + 60_000;
      return response;
    } catch (error) {
      pending.persistenceFailures = (pending.persistenceFailures || 0) + 1;
      pending.expiresAt = Date.now() + 15 * 60_000;
      this.logger.error(
        `扫码登录态已验证，但账号入库失败；保留会话等待重试 session=${sessionId} `
        + `platform=${pending.platform} attempt=${pending.persistenceFailures}: ${(error as Error).message}`,
      );
      return {
        ...result,
        // 平台验证已结束，账号资料正在单独入库。saving 是非终态，
        // 前端会继续轮询，但不会再次提示用户完成身份验证。
        status: 'saving',
        message: `平台登录已确认且登录态已安全保存，账号资料写入暂时失败，系统正在自动重试（第 ${pending.persistenceFailures} 次）`,
        expiresIn: 15 * 60,
        persistencePending: true,
      };
    } finally {
      if (pending.persistencePromise === persistence) {
        pending.persistencePromise = undefined;
      }
    }
  }

  private async persistVerifiedBrowserLogin(
    teamId: string,
    pending: PendingBrowserLogin,
    result: BrowserLoginStatus,
  ): Promise<Record<string, unknown>> {
    const userInfo = result.userInfo || {};
    const followerCount = this.followerCountFromUserInfo(userInfo);
    const followerMetric = followerCount === undefined
      ? {}
      : { followerCount, followerCountSyncedAt: new Date() };
    const platformUid = this.platformUidFromUserInfo(userInfo);
    const credentials = JSON.stringify({
      kind: 'browser_session',
      account_ref: pending.accountRef,
    });
    const nickname = this.firstText(userInfo.name, pending.nickname, userInfo.username, pending.platform) || pending.platform;

    const existing = platformUid
      ? await this.prisma.platformAccount.findFirst({ where: { teamId, platform: pending.platform, platformUid } })
      : null;
    let oldAccountRef: string | undefined;
    if (existing?.authType === 'scan' && existing.credentials) {
      oldAccountRef = this.browserAccountRef(CryptoUtil.decrypt(existing.credentials));
    }
    const account = existing
      ? await this.prisma.platformAccount.update({
        where: { id: existing.id },
        data: {
          nickname,
          avatar: userInfo.avatar,
          ...followerMetric,
          authType: 'scan',
          credentials: CryptoUtil.encrypt(credentials),
          status: 'active',
          groupId: pending.groupId ?? existing.groupId,
          regionId: pending.regionId ?? existing.regionId,
          isDealer: pending.isDealer,
          parentAccountId: pending.parentAccountId ?? existing.parentAccountId,
          lastRefreshAt: new Date(),
          expiredAt: null,
        },
      })
      : await this.prisma.platformAccount.create({
        data: {
          teamId,
          platform: pending.platform,
          platformUid,
          nickname,
          avatar: userInfo.avatar,
          ...followerMetric,
          authType: 'scan',
          credentials: CryptoUtil.encrypt(credentials),
          status: 'active',
          groupId: pending.groupId,
          regionId: pending.regionId,
          isDealer: pending.isDealer,
          parentAccountId: pending.parentAccountId,
          lastRefreshAt: new Date(),
        },
      });

    if (oldAccountRef && oldAccountRef !== pending.accountRef) {
      this.socialBrowser.deleteAccount(pending.platform, oldAccountRef)
        .catch((error) => this.logger.warn(`清理旧浏览器登录态失败：${(error as Error).message}`));
    }
    const response: Record<string, unknown> = {
      ...result,
      message: existing
        ? '扫码登录成功，已更新已有账号授权（未新增重复账号）'
        : '扫码登录成功，已新增账号',
      accountPersistence: existing ? 'updated_existing' : 'created_new',
      account: this.withoutCredentials(account),
    };
    return response;
  }

  async cancelBrowserLogin(teamId: string, userId: string, sessionId: string) {
    const pending = this.browserLogins.get(sessionId);
    if (!pending || pending.teamId !== teamId || pending.userId !== userId) {
      throw new BadRequestException('扫码会话不存在、已过期或不属于当前用户');
    }
    this.browserLogins.delete(sessionId);
    return this.socialBrowser.cancelLogin(sessionId);
  }

  private async cleanupExpiredBrowserLogins() {
    const expired = [...this.browserLogins.entries()]
      .filter(([, value]) => value.expiresAt < Date.now());
    for (const [sessionId, value] of expired) {
      this.browserLogins.delete(sessionId);
      if (!value.completed) {
        await this.socialBrowser.cancelLogin(sessionId).catch(() => undefined);
      }
    }
  }

  private async cancelSupersededBrowserLogins(teamId: string, userId: string, platform: string) {
    const sessions = [...this.browserLogins.entries()]
      .filter(([, value]) => (
        value.teamId === teamId
        && value.userId === userId
        && value.platform === platform
        && !value.completed
      ));
    for (const [sessionId] of sessions) this.browserLogins.delete(sessionId);
    await Promise.allSettled(
      sessions.map(([sessionId]) => this.socialBrowser.cancelLogin(sessionId)),
    );
  }

  private firstText(...values: unknown[]) {
    for (const value of values) {
      const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
      if (text) return text.slice(0, 191);
    }
    return undefined;
  }

  private platformUidFromUserInfo(userInfo: unknown) {
    if (!this.isRecord(userInfo)) return undefined;
    const extra = this.isRecord(userInfo.extra) ? userInfo.extra : {};
    return this.firstText(
      userInfo.user_id,
      extra.user_id,
      extra.red_id,
      extra.unique_id,
      extra.mid,
    );
  }

  private followerCountFromUserInfo(userInfo: unknown): number | undefined {
    if (!this.isRecord(userInfo)) return undefined;
    const extra = this.isRecord(userInfo.extra) ? userInfo.extra : undefined;
    const keys = [
      'followerCount',
      'follower_count',
      'followersCount',
      'followers_count',
      'followerNum',
      'follower_num',
      'follower',
      'followers',
      'fanCount',
      'fan_count',
      'fanNum',
      'fan_num',
      'fan',
      'fansCount',
      'fans_count',
      'fansNum',
      'fans_num',
      'fans',
    ];
    for (const source of [userInfo, extra]) {
      if (!source) continue;
      for (const key of keys) {
        const parsed = this.nonNegativeInt(source[key]);
        if (parsed !== undefined) return parsed;
      }
    }
    return undefined;
  }

  private nonNegativeInt(value: unknown): number | undefined {
    let numeric: number;
    if (typeof value === 'number') {
      numeric = value;
    } else if (typeof value === 'string') {
      const normalized = value.trim().replace(/[,_\s]/g, '');
      if (!/^\+?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return undefined;
      numeric = Number(normalized);
    } else {
      return undefined;
    }
    if (!Number.isFinite(numeric) || numeric < 0) return undefined;
    const integer = Math.trunc(numeric);
    // Prisma 的 Int 映射为有符号 32 位整数；异常的超大平台值应被忽略，
    // 不能让一次资料刷新导致整个账号绑定/刷新失败。
    return Number.isSafeInteger(integer) && integer <= 2_147_483_647 ? integer : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private browserAccountRef(credentials: string) {
    try {
      const value = JSON.parse(credentials) as { kind?: string; account_ref?: string };
      return value.kind === 'browser_session' ? value.account_ref : undefined;
    } catch {
      return undefined;
    }
  }

  async list(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.platform) where.platform = query.platform;
    if (query.status) where.status = query.status;
    if (query.groupId) where.groupId = query.groupId;
    if (query.keyword) {
      where.nickname = { contains: query.keyword as string };
    }
    const [list, total] = await Promise.all([
      this.prisma.platformAccount.findMany({
        where,
        include: { group: true, region: true },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.platformAccount.count({ where }),
    ]);
    return { list: list.map((account) => this.withoutCredentials(account)), total, page, pageSize };
  }

  async bind(teamId: string, dto: BindAccountDto) {
    await this.assertRelations(teamId, dto.groupId, dto.regionId);
    const count = await this.prisma.platformAccount.count({ where: { teamId } });
    if (count >= 200) {
      throw new BadRequestException('单个企业最多绑定 200 个账号 (FR-AM-003)');
    }
    if (dto.parentAccountId) {
      const parent = await this.prisma.platformAccount.findFirst({ where: { id: dto.parentAccountId, teamId } });
      if (!parent) throw new BadRequestException('总部账号不存在或不属于当前企业');
    }
    if (dto.authType === 'oauth') throw new BadRequestException('OAuth 授权请使用授权码交换接口');
    if (dto.authType === 'scan') throw new BadRequestException('扫码授权请使用扫码登录接口');
    const adapter = this.adapterFactory.get(dto.platform, dto.authType);
    const login = await adapter.checkLogin(dto.credentials || '');
    if (!login.valid) throw new BadRequestException(login.reason || '平台凭据无效');
    const followerCount = this.followerCountFromUserInfo(login.userInfo);
    const followerMetric = followerCount === undefined
      ? {}
      : { followerCount, followerCountSyncedAt: new Date() };
    const credentials = dto.credentials
      ? CryptoUtil.encrypt(dto.credentials)
      : undefined;
    const account = await this.prisma.platformAccount.create({
      data: {
        teamId,
        platform: dto.platform,
        nickname: dto.nickname,
        avatar: dto.avatar,
        authType: dto.authType,
        credentials,
        ...followerMetric,
        groupId: dto.groupId,
        regionId: dto.regionId,
        isDealer: dto.isDealer ?? false,
        parentAccountId: dto.parentAccountId,
        expiredAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastRefreshAt: new Date(),
      },
    });
    return this.withoutCredentials(account);
  }

  async exchangeOAuth(teamId: string, userId: string, dto: ExchangeOAuthDto) {
    this.verifyOAuthState(dto.state, teamId, userId, dto.platform, dto.redirectUri);
    await this.assertRelations(teamId, dto.groupId, dto.regionId);
    const count = await this.prisma.platformAccount.count({ where: { teamId } });
    if (count >= 200) throw new BadRequestException('单个企业最多绑定 200 个账号 (FR-AM-003)');
    const token = await exchangeCodeForToken(dto.platform, dto.code, dto.redirectUri, this.config);
    if (!token.accessToken) throw new BadRequestException('平台未返回 access token');
    const credentials = JSON.stringify({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expires_at: token.expiresAt.toISOString(),
      open_id: token.openId,
      scopes: token.scopes || [],
    });
    const login = await this.adapterFactory.get(dto.platform, 'oauth').checkLogin(credentials);
    if (!login.valid) throw new BadRequestException(login.reason || 'OAuth 令牌校验失败');
    const followerCount = this.followerCountFromUserInfo(login.userInfo);
    const followerMetric = followerCount === undefined
      ? {}
      : { followerCount, followerCountSyncedAt: new Date() };
    const account = await this.prisma.platformAccount.create({
      data: {
        teamId,
        platform: dto.platform,
        nickname: dto.nickname,
        authType: 'oauth',
        credentials: CryptoUtil.encrypt(credentials),
        ...followerMetric,
        groupId: dto.groupId,
        regionId: dto.regionId,
        expiredAt: token.expiresAt,
        lastRefreshAt: new Date(),
      },
    });
    return this.withoutCredentials(account);
  }

  private createOAuthState(teamId: string, userId: string, platform: string, redirectUri: string) {
    const payload = Buffer.from(JSON.stringify({
      t: teamId,
      u: userId,
      p: platform,
      r: redirectUri,
      exp: Date.now() + 10 * 60 * 1000,
      n: randomBytes(12).toString('base64url'),
    })).toString('base64url');
    return `${payload}.${this.signOAuthState(payload)}`;
  }

  private verifyOAuthState(state: string, teamId: string, userId: string, platform: string, redirectUri: string) {
    const separator = state.lastIndexOf('.');
    if (separator <= 0) throw new BadRequestException('OAuth state 无效或已过期');
    const payload = state.slice(0, separator);
    const actual = Buffer.from(state.slice(separator + 1));
    const expected = Buffer.from(this.signOAuthState(payload));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new BadRequestException('OAuth state 签名无效');
    }
    let value: { t?: string; u?: string; p?: string; r?: string; exp?: number };
    try {
      value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof value;
    } catch {
      throw new BadRequestException('OAuth state 内容无效');
    }
    if (value.t !== teamId || value.u !== userId || value.p !== platform || value.r !== redirectUri || !value.exp || value.exp < Date.now()) {
      throw new BadRequestException('OAuth state 与当前用户不匹配或已过期');
    }
  }

  private signOAuthState(payload: string) {
    const secret = this.config.get<string>('JWT_SECRET') || '';
    if (secret.length < 32) throw new BadRequestException('JWT_SECRET 至少需要 32 位');
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  async update(teamId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.prisma.platformAccount.findFirst({ where: { id, teamId } });
    if (!account) throw new BadRequestException('账号不存在');
    await this.assertRelations(teamId, dto.groupId, dto.regionId);
    const updated = await this.prisma.platformAccount.update({ where: { id }, data: dto });
    return this.withoutCredentials(updated);
  }

  async remove(teamId: string, id: string) {
    const account = await this.prisma.platformAccount.findFirst({ where: { id, teamId } });
    if (!account) throw new BadRequestException('账号不存在');
    if (account.authType === 'scan' && account.credentials) {
      const accountRef = this.browserAccountRef(CryptoUtil.decrypt(account.credentials));
      if (accountRef) {
        await this.socialBrowser.deleteAccount(account.platform, accountRef)
          .catch((error) => this.logger.warn(`删除浏览器登录态失败：${(error as Error).message}`));
      }
    }
    const result = await this.prisma.platformAccount.deleteMany({ where: { id, teamId } });
    if (result.count === 0) throw new BadRequestException('账号不存在');
    return { deleted: true };
  }

  async refreshStatus(teamId: string, id: string) {
    let account = await this.prisma.platformAccount.findFirst({ where: { id, teamId } });
    if (!account) throw new BadRequestException('账号不存在');
    if (account.authType === 'oauth' && account.credentials) {
      const current = JSON.parse(CryptoUtil.decrypt(account.credentials)) as {
        refresh_token?: string;
        expires_at?: string;
        open_id?: string;
        scopes?: string[];
      };
      const expiresAt = current.expires_at ? new Date(current.expires_at) : account.expiredAt;
      if (current.refresh_token && expiresAt && expiresAt.getTime() < Date.now() + 10 * 60 * 1000) {
        const refreshed = await refreshOAuthToken(account.platform, current.refresh_token, this.config);
        const value = JSON.stringify({
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: refreshed.expiresAt.toISOString(),
          open_id: refreshed.openId || current.open_id,
          scopes: refreshed.scopes?.length ? refreshed.scopes : current.scopes || [],
        });
        account = await this.prisma.platformAccount.update({
          where: { id },
          data: { credentials: CryptoUtil.encrypt(value), expiredAt: refreshed.expiresAt },
        });
      }
    }
    const adapter = this.adapterFactory.get(account.platform, account.authType);
    const credential = account.credentials ? CryptoUtil.decrypt(account.credentials) : '';
    const login = await adapter.checkLogin(credential);
    const reason = login.reason || '';
    if (!login.valid && login.transient) {
      throw new ServiceUnavailableException(
        `平台账号校验暂时失败，已保留原账号状态：${reason || '平台浏览器暂时不可用'}`,
      );
    }
    const invalidStatus = /封禁|banned/i.test(reason) ? 'banned' : /限流|limited/i.test(reason) ? 'limited' : 'expired';
    const followerCount = login.valid ? this.followerCountFromUserInfo(login.userInfo) : undefined;
    const refreshedPlatformUid = login.valid ? this.platformUidFromUserInfo(login.userInfo) : undefined;
    const conflictingAccount = refreshedPlatformUid && refreshedPlatformUid !== account.platformUid
      ? await this.prisma.platformAccount.findFirst({
        where: {
          teamId,
          platform: account.platform,
          platformUid: refreshedPlatformUid,
          id: { not: id },
        },
      })
      : null;
    if (conflictingAccount) {
      this.logger.warn(`账号资料刷新发现重复平台身份，保留当前账号 ID account=${id} conflict=${conflictingAccount.id}`);
    }
    const followerMetric = followerCount === undefined
      ? {}
      : { followerCount, followerCountSyncedAt: new Date() };
    const identityMetric = refreshedPlatformUid && !conflictingAccount
      ? { platformUid: refreshedPlatformUid }
      : {};
    const updated = await this.prisma.platformAccount.update({
      where: { id },
      data: {
        status: login.valid ? 'active' : invalidStatus,
        ...identityMetric,
        ...followerMetric,
        lastRefreshAt: new Date(),
      },
    });
    if (!login.valid && account.status === 'active') {
      await this.prisma.notification.create({
        data: {
          teamId,
          type: 'account_abnormal',
          title: `账号异常：${account.nickname}`,
          content: `${account.platform} 账号登录态异常：${reason || '授权已失效'}，请重新授权`,
        },
      });
    }
    return { ...this.withoutCredentials(updated), loginReason: login.reason };
  }

  /**
   * 浏览器扫码账号的资料刷新会启动真实浏览器会话，成本和误报风险都高于
   * 开放平台 token 校验，因此每天低频、严格顺序执行一次。
   *
   * 这里刻意不复用 refreshStatus：平台侧临时网络/风控失败不能把已登录账号
   * 自动改成 expired，也不能用缺失或异常的粉丝字段覆盖最后一次可信值。
   */
  @Cron('0 0 4 * * *')
  async refreshScanAccountProfilesDaily() {
    const accounts = await this.prisma.platformAccount.findMany({
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
    let refreshed = 0;
    let followerSynced = 0;
    let invalid = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        const adapter = this.adapterFactory.get(account.platform, 'scan');
        const credential = CryptoUtil.decrypt(account.credentials || '');
        const login = await adapter.checkLogin(credential);
        if (!login.valid) {
          invalid++;
          this.logger.warn(`扫码账号资料刷新未通过，保留原状态 account=${account.id}: ${login.reason || '平台未确认登录态'}`);
          continue;
        }
        const followerCount = this.followerCountFromUserInfo(login.userInfo);
        await this.prisma.platformAccount.update({
          where: { id: account.id },
          data: {
            lastRefreshAt: new Date(),
            ...(followerCount === undefined
              ? {}
              : { followerCount, followerCountSyncedAt: new Date() }),
          },
        });
        refreshed++;
        if (followerCount !== undefined) followerSynced++;
      } catch (error) {
        failed++;
        this.logger.warn(`扫码账号资料刷新失败，保留原状态 account=${account.id}: ${(error as Error).message}`);
      }
    }
    return {
      total: accounts.length,
      refreshed,
      followerSynced,
      invalid,
      failed,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async refreshAllAccountStatuses() {
    const accounts = await this.prisma.platformAccount.findMany({
      where: { status: { in: ['active', 'expired', 'limited'] }, authType: { not: 'scan' } },
      select: { id: true, teamId: true },
    });
    let success = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        await this.refreshStatus(account.teamId, account.id);
        success++;
      } catch (error) {
        failed++;
        this.logger.warn(`自动刷新账号失败 account=${account.id}: ${(error as Error).message}`);
      }
    }
    return { total: accounts.length, success, failed };
  }

  async listGroups(teamId: string) {
    return this.prisma.accountGroup.findMany({
      where: { teamId },
      include: { _count: { select: { accounts: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createGroup(teamId: string, dto: CreateGroupDto) {
    return this.prisma.accountGroup.create({ data: { teamId, name: dto.name, dimension: dto.dimension } });
  }

  async updateGroup(teamId: string, id: string, dto: UpdateGroupDto) {
    const group = await this.prisma.accountGroup.findFirst({ where: { id, teamId } });
    if (!group) throw new BadRequestException('账号分组不存在');
    return this.prisma.accountGroup.update({
      where: { id },
      data: { name: dto.name, dimension: dto.dimension },
    });
  }

  async removeGroup(teamId: string, id: string) {
    const group = await this.prisma.accountGroup.findFirst({
      where: { id, teamId },
      include: { _count: { select: { accounts: true } } },
    });
    if (!group) throw new BadRequestException('账号分组不存在');
    if (group._count.accounts > 0) throw new BadRequestException('请先将账号移出该分组');
    await this.prisma.accountGroup.delete({ where: { id } });
    return { deleted: true };
  }

  async listRegions(teamId: string) {
    return this.prisma.region.findMany({ where: { teamId }, orderBy: { level: 'asc' } });
  }

  async createRegion(teamId: string, dto: CreateRegionDto) {
    if (dto.parentId) {
      const parent = await this.prisma.region.findFirst({ where: { id: dto.parentId, teamId } });
      if (!parent) throw new BadRequestException('上级区域不存在');
    }
    return this.prisma.region.create({
      data: { teamId, name: dto.name, level: dto.level ?? 1, parentId: dto.parentId },
    });
  }

  async updateRegion(teamId: string, id: string, dto: UpdateRegionDto) {
    const region = await this.prisma.region.findFirst({ where: { id, teamId } });
    if (!region) throw new BadRequestException('区域不存在');
    if (dto.parentId === id) throw new BadRequestException('区域不能以自身作为上级');
    if (dto.parentId) {
      const parent = await this.prisma.region.findFirst({ where: { id: dto.parentId, teamId } });
      if (!parent) throw new BadRequestException('上级区域不存在');
    }
    return this.prisma.region.update({
      where: { id },
      data: { name: dto.name, level: dto.level, parentId: dto.parentId },
    });
  }

  async removeRegion(teamId: string, id: string) {
    const [region, accountCount, childCount] = await Promise.all([
      this.prisma.region.findFirst({ where: { id, teamId } }),
      this.prisma.platformAccount.count({ where: { regionId: id, teamId } }),
      this.prisma.region.count({ where: { parentId: id, teamId } }),
    ]);
    if (!region) throw new BadRequestException('区域不存在');
    if (accountCount > 0) throw new BadRequestException('请先将账号移出该区域');
    if (childCount > 0) throw new BadRequestException('请先删除或移动下级区域');
    await this.prisma.region.delete({ where: { id } });
    return { deleted: true };
  }

  async dealerDashboard(teamId: string) {
    const dealers = await this.prisma.platformAccount.findMany({
      where: { teamId, isDealer: true },
      include: { region: true, _count: { select: { publishRecords: true } } },
      orderBy: { followerCount: 'desc' },
    });
    return dealers.map((d, idx) => ({
      rank: idx + 1,
      id: d.id,
      nickname: d.nickname,
      platform: d.platform,
      region: d.region?.name,
      followerCount: d.followerCount,
      publishCount: d._count.publishRecords,
      status: d.status,
    }));
  }

  async pushdown(teamId: string, userId: string, contentId: string, dealerAccountIds: string[]) {
    // 总部内容下发至经销商账号：创建发布任务
    const content = await this.prisma.content.findFirst({ where: { id: contentId, teamId } });
    if (!content) throw new BadRequestException('内容不存在');
    const dealers = await this.prisma.platformAccount.findMany({
      where: { id: { in: dealerAccountIds }, teamId, isDealer: true },
      select: { id: true },
    });
    if (dealers.length !== new Set(dealerAccountIds).size) {
      throw new BadRequestException('包含无效或不属于当前企业的经销商账号');
    }
    return this.distribution.publish(teamId, userId, {
      contentId,
      accountIds: dealers.map((dealer) => dealer.id),
    });
  }
}
