import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdapterFactory } from '../platform-adapters/platform-adapter.factory';
import { CryptoUtil } from '../../common/utils/crypto.util';
import ExcelJS from 'exceljs';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';

@Injectable()
export class DataCenterService {
  private readonly logger = new Logger(DataCenterService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: PlatformAdapterFactory,
    private config: ConfigService,
  ) {}

  async overview(teamId: string) {
    const accounts = await this.prisma.platformAccount.findMany({ where: { teamId } });
    const snapshots = (
      await Promise.all(
        accounts.map((account) =>
          this.prisma.dataSnapshot.findFirst({
            where: { teamId, accountId: account.id },
            orderBy: { date: 'desc' },
          }),
        ),
      )
    ).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const sum = (sel: (s: { playCount: number; readCount: number; fanCount: number; likeCount: number; commentCount: number; shareCount: number; revenue: { toNumber: () => number } | null }) => number) =>
      snapshots.reduce((s, x) => s + sel(x), 0);
    const followerSyncedAccounts = accounts.filter((account) => account.followerCountSyncedAt != null);
    return {
      accountCount: accounts.length,
      totalAccounts: accounts.length,
      totalPlay: sum((s) => s.playCount),
      totalRead: sum((s) => s.readCount),
      // 粉丝数是账号的当前资料字段，不是可累计的历史流量。扫码账号没有
      // DataSnapshot 时也必须纳入；未同步的默认 0 则不能被当作真实零。
      totalFan: followerSyncedAccounts.reduce((total, account) => total + account.followerCount, 0),
      followerSyncedAccountCount: followerSyncedAccounts.length,
      followerUnsyncedAccountCount: accounts.length - followerSyncedAccounts.length,
      totalLike: sum((s) => s.likeCount),
      totalComment: sum((s) => s.commentCount),
      totalShare: sum((s) => s.shareCount),
      revenue: sum((s) => (s.revenue ? s.revenue.toNumber() : 0)),
    };
  }

  async trend(teamId: string, days = 7) {
    days = Math.min(365, Math.max(1, days));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days);
    const snapshots = await this.prisma.dataSnapshot.findMany({
      where: { teamId, date: { gte: start } },
      orderBy: { date: 'asc' },
    });
    const map = new Map<string, { date: string; play: number; like: number; fan: number }>();
    for (const s of snapshots) {
      const key = s.date.toISOString().slice(0, 10);
      const cur = map.get(key) || { date: key, play: 0, like: 0, fan: 0 };
      cur.play += s.playCount;
      cur.like += s.likeCount;
      cur.fan += s.fanCount;
      map.set(key, cur);
    }
    return Array.from(map.values());
  }

  async accountRanking(teamId: string) {
    const accounts = await this.prisma.platformAccount.findMany({
      where: { teamId },
      include: { dataSnapshots: { orderBy: { date: 'desc' }, take: 1 } },
    });
    return accounts
      .map((a) => ({
        id: a.id,
        nickname: a.nickname,
        platform: a.platform,
        followerCount: a.followerCount,
        followerCountSyncedAt: a.followerCountSyncedAt,
        playCount: a.dataSnapshots[0]?.playCount || 0,
        likeCount: a.dataSnapshots[0]?.likeCount || 0,
      }))
      .sort((x, y) => y.playCount - x.playCount)
      .slice(0, 20);
  }

  async employeeData(teamId: string) {
    const users = await this.prisma.user.findMany({ where: { teamId } });
    const contents = await this.prisma.content.groupBy({
      by: ['createdBy'],
      where: { teamId, createdBy: { not: null } },
      _count: { _all: true },
    });
    const [published, completedTasks] = await Promise.all([
      this.prisma.publishTask.groupBy({
        by: ['createdBy'],
        where: { teamId, createdBy: { not: null }, status: 'published' },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['assigneeId'],
        where: { teamId, assigneeId: { not: null }, status: 'done' },
        _count: { _all: true },
      }),
    ]);
    const map = new Map(contents.map((c) => [c.createdBy, c._count._all]));
    const publishedMap = new Map(published.map((item) => [item.createdBy, item._count._all]));
    const taskMap = new Map(completedTasks.map((item) => [item.assigneeId, item._count._all]));
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      contentCount: map.get(u.id) || 0,
      publishedCount: publishedMap.get(u.id) || 0,
      completedTaskCount: taskMap.get(u.id) || 0,
    }));
  }

  async contentPerformance(teamId: string) {
    const contents = await this.prisma.content.findMany({
      where: { teamId },
      include: { publishTasks: { include: { records: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return contents.map((content) => {
      const records = content.publishTasks.flatMap((task) => task.records);
      const success = records.filter((record) => record.status === 'published').length;
      const failed = records.filter((record) => record.status === 'failed').length;
      return {
        id: content.id,
        title: content.title,
        type: content.type,
        source: content.source,
        createdAt: content.createdAt,
        targetCount: records.length,
        successCount: success,
        failedCount: failed,
        successRate: records.length ? Number(((success / records.length) * 100).toFixed(1)) : 0,
      };
    });
  }

  async hotTopics(platform?: string) {
    return this.prisma.hotTopic.findMany({
      where: platform ? { platform } : undefined,
      orderBy: [{ crawledAt: 'desc' }, { rank: 'asc' }],
      take: 100,
    });
  }

  async exportExcel(teamId: string) {
    const [accounts, employees, contents, topics] = await Promise.all([
      this.accountRanking(teamId),
      this.employeeData(teamId),
      this.contentPerformance(teamId),
      this.hotTopics(),
    ]);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('账号数据');
    ws.columns = [
      { header: '账号', key: 'nickname', width: 24 },
      { header: '平台', key: 'platform', width: 14 },
      { header: '粉丝数', key: 'followerCount', width: 12 },
      { header: '播放量', key: 'playCount', width: 12 },
      { header: '点赞数', key: 'likeCount', width: 12 },
    ];
    accounts.forEach((account) => ws.addRow({
      ...account,
      followerCount: account.followerCountSyncedAt ? account.followerCount : '未同步',
    }));
    const employeeSheet = wb.addWorksheet('员工数据');
    employeeSheet.columns = [
      { header: '成员', key: 'name', width: 18 },
      { header: '角色', key: 'role', width: 16 },
      { header: '内容产出', key: 'contentCount', width: 14 },
      { header: '发布成功', key: 'publishedCount', width: 14 },
      { header: '完成任务', key: 'completedTaskCount', width: 14 },
    ];
    employees.forEach((item) => employeeSheet.addRow(item));
    const contentSheet = wb.addWorksheet('内容分发');
    contentSheet.columns = [
      { header: '标题', key: 'title', width: 36 },
      { header: '类型', key: 'type', width: 14 },
      { header: '来源', key: 'source', width: 14 },
      { header: '目标账号', key: 'targetCount', width: 14 },
      { header: '发布成功', key: 'successCount', width: 14 },
      { header: '发布失败', key: 'failedCount', width: 14 },
      { header: '成功率(%)', key: 'successRate', width: 14 },
    ];
    contents.forEach((item) => contentSheet.addRow(item));
    const topicSheet = wb.addWorksheet('热点榜单');
    topicSheet.columns = [
      { header: '平台', key: 'platform', width: 14 },
      { header: '类型', key: 'type', width: 14 },
      { header: '排名', key: 'rank', width: 10 },
      { header: '热点', key: 'title', width: 42 },
      { header: '热度', key: 'hotValue', width: 16 },
      { header: '抓取时间', key: 'crawledAt', width: 22 },
    ];
    topics.forEach((item) => topicSheet.addRow(item));
    const buffer = await wb.xlsx.writeBuffer();
    return buffer;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async aggregateDaily() {
    this.logger.log('开始每日数据聚合');
    const teams = await this.prisma.team.findMany();
    for (const team of teams) {
      const accounts = await this.prisma.platformAccount.findMany({ where: { teamId: team.id, authType: { not: 'scan' } } });
      for (const account of accounts) {
        try {
          const adapter = this.adapterFactory.get(account.platform, account.authType);
          const stats = await adapter.fetchStats(account.credentials ? CryptoUtil.decrypt(account.credentials) : '');
          const followerCount = this.nonNegativeInt(stats.fanCount);
          const date = new Date();
          date.setHours(0, 0, 0, 0);
          await this.prisma.dataSnapshot.upsert({
            where: { accountId_date: { accountId: account.id, date } },
            update: {
              playCount: stats.playCount,
              readCount: stats.readCount,
              ...(followerCount === undefined ? {} : { fanCount: followerCount }),
              likeCount: stats.likeCount,
              commentCount: stats.commentCount,
              shareCount: stats.shareCount,
            },
            create: {
              teamId: team.id,
              accountId: account.id,
              platform: account.platform,
              date,
              playCount: stats.playCount,
              readCount: stats.readCount,
              ...(followerCount === undefined ? {} : { fanCount: followerCount }),
              likeCount: stats.likeCount,
              commentCount: stats.commentCount,
              shareCount: stats.shareCount,
            },
          });
          if (followerCount !== undefined) {
            await this.prisma.platformAccount.update({
              where: { id: account.id },
              data: {
                followerCount,
                followerCountSyncedAt: new Date(),
              },
            });
          }
        } catch (err) {
          this.logger.warn(`聚合失败 ${account.nickname}: ${(err as Error).message}`);
        }
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async syncHotTopics() {
    const endpoint = this.config.get<string>('HOT_TOPIC_API_URL') || '';
    const apiKey = this.config.get<string>('HOT_TOPIC_API_KEY') || '';
    let items: Array<{ platform: string; type: string; title: string; hotValue: number; rank: number }> = [];
    if (endpoint) {
      const target = await prepareSafeExternalRequest(endpoint, { requireHttps: Boolean(apiKey) });
      const response = await axios.get(target.url.toString(), {
        params: apiKey ? { apiKey } : undefined,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        timeout: 30000,
        maxRedirects: 0,
        ...target.transport,
      });
      const raw = response.data?.data?.list || response.data?.list || response.data?.data || response.data;
      if (!Array.isArray(raw)) throw new Error('热点服务返回格式错误');
      items = raw.map((item: Record<string, unknown>, index: number) => ({
        platform: String(item.platform || 'douyin'),
        type: String(item.type || 'topic'),
        title: String(item.title || item.name || ''),
        hotValue: Number(item.hotValue ?? item.hot_value ?? item.score ?? 0),
        rank: Number(item.rank || index + 1),
      })).filter((item) => item.title);
    } else {
      this.logger.warn('HOT_TOPIC_API_URL 未配置，跳过热点榜单同步');
      return {
        synced: 0,
        skipped: true,
        reason: '未配置 HOT_TOPIC_API_URL，未执行热点同步',
      };
    }
    const now = new Date();
    await this.prisma.$transaction(items.map((item) => this.prisma.hotTopic.create({ data: { ...item, crawledAt: now } })));
    await this.prisma.hotTopic.deleteMany({ where: { crawledAt: { lt: new Date(Date.now() - 7 * 86400000) } } });
    return { synced: items.length, skipped: false };
  }

  private nonNegativeInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    const integer = Math.trunc(value);
    return Number.isSafeInteger(integer) && integer <= 2_147_483_647 ? integer : undefined;
  }
}
