import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { CrawlService } from '../crawl/crawl.service';
import { sensitiveUtil } from '../../common/utils/sensitive.util';
import { DistributionService } from '../distribution/distribution.service';
import { parsePage } from '../../common/utils/page.util';
import { AddPeerDto, GenerateRecreationsDto, UpdateRecreationDto, PublishRecreationDto, UpdatePeerDto } from './dto/hit.dto';
import { OriginalityService } from './originality.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UpdateRecreationScoreDto } from './dto/hit.dto';
import { parseAiJson } from '../../common/utils/ai-json.util';

@Injectable()
export class HitRecreationService {
  private readonly logger = new Logger(HitRecreationService.name);

  constructor(
    private prisma: PrismaService,
    private ai: AiGatewayService,
    private crawl: CrawlService,
    private dist: DistributionService,
    private originalityService: OriginalityService,
  ) {}

  // ---------- 同行情报监控 ----------
  async listPeers(teamId: string) {
    return this.prisma.peerAccount.findMany({
      where: { teamId },
      include: { _count: { select: { hitContents: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addPeer(teamId: string, dto: AddPeerDto) {
    const count = await this.prisma.peerAccount.count({ where: { teamId } });
    if (count >= 100) throw new BadRequestException('同行账号库最多 100 个 (FR-BT-001)');
    return this.prisma.peerAccount.create({ data: { teamId, ...dto } });
  }

  async updatePeer(teamId: string, id: string, dto: UpdatePeerDto) {
    const peer = await this.prisma.peerAccount.findFirst({ where: { id, teamId } });
    if (!peer) throw new BadRequestException('同行账号不存在');
    return this.prisma.peerAccount.update({ where: { id }, data: dto });
  }

  async removePeer(teamId: string, id: string) {
    const peer = await this.prisma.peerAccount.findFirst({ where: { id, teamId } });
    if (!peer) throw new BadRequestException('同行账号不存在');
    await this.prisma.$transaction([
      this.prisma.hitContent.updateMany({ where: { teamId, peerAccountId: id }, data: { peerAccountId: null } }),
      this.prisma.peerAccount.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }

  async benchmarks(teamId: string) {
    return this.prisma.peerAccount.findMany({
      where: { teamId, isBenchmark: true },
      take: 20,
    });
  }

  async crawlPeers(teamId: string) {
    this.crawl.assertAvailable();
    const peers = await this.prisma.peerAccount.findMany({ where: { teamId } });
    let total = 0;
    for (const peer of peers) {
      const hits = await this.crawl.crawlPeer(peer.nickname, peer.platform);
      for (const h of hits) {
        const likeRate = h.playCount ? h.likeCount / h.playCount : 0;
        const commentRate = h.playCount ? h.commentCount / h.playCount : 0;
        const isExplosive = h.playCount >= peer.explosiveThresholdPlay
          || likeRate >= peer.explosiveThresholdLikeRate
          || commentRate >= peer.explosiveThresholdCommentRate;
        const existing = await this.prisma.hitContent.findFirst({
          where: { teamId, platform: h.platform, title: h.title },
        });
        if (existing) continue;
        const created = await this.prisma.hitContent.create({
          data: {
            teamId,
            peerAccountId: peer.id,
            platform: h.platform,
            author: h.author,
            authorAvatar: h.authorAvatar,
            title: h.title,
            coverUrl: h.coverUrl,
            videoUrl: h.videoUrl,
            playCount: h.playCount,
            likeCount: h.likeCount,
            commentCount: h.commentCount,
            shareCount: h.shareCount,
            collectCount: h.collectCount,
            publishedAt: h.publishedAt,
            isExplosive,
            alertPushed: isExplosive,
          },
        });
        if (isExplosive) {
          await this.prisma.notification.create({
            data: {
              teamId,
              type: 'hit_alert',
              title: `发现${peer.nickname}爆款内容`,
              content: `${h.title}｜播放 ${h.playCount}｜点赞率 ${(likeRate * 100).toFixed(1)}%｜评论率 ${(commentRate * 100).toFixed(1)}%`,
            },
          });
          this.logger.log(`爆款提醒 hit=${created.id} team=${teamId}`);
        }
        total++;
      }
    }
    return { crawled: total };
  }

  async listHits(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.platform) where.platform = query.platform;
    if (query.keyword) where.title = { contains: query.keyword as string };
    const [list, total] = await Promise.all([
      this.prisma.hitContent.findMany({
        where,
        include: { teardown: true },
        skip,
        take,
        orderBy: { playCount: 'desc' },
      }),
      this.prisma.hitContent.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async getHit(teamId: string, id: string) {
    return this.prisma.hitContent.findFirst({
      where: { id, teamId },
      include: { teardown: true, peerAccount: true },
    });
  }

  // ---------- AI 拆解 ----------
  async teardown(teamId: string, userId: string, hitId: string) {
    const hit = await this.prisma.hitContent.findFirst({ where: { id: hitId, teamId } });
    if (!hit) throw new BadRequestException('爆款内容不存在');
    const existing = await this.prisma.hitTeardown.findUnique({ where: { hitContentId: hitId } });
    if (existing) return existing;

    const output = await this.ai.chat([
      {
        role: 'system',
        content:
          '你是爆款内容拆解专家。从结构(开头钩子/中间内容/结尾CTA)、话术框架、情绪曲线、标签、音乐、画面、时长多维度拆解。输出严格 JSON。',
      },
      { role: 'user', content: `请拆解这条爆款内容：${hit.title}\n平台：${hit.platform}\n播放：${hit.playCount} 点赞：${hit.likeCount}` },
    ]);

    const parsed = parseAiJson<Record<string, unknown>>(output, '爆款拆解模型');
    const structure = (parsed.structure as object) || {};
    const script = (parsed.script as object) || {};
    const emotionCurve = (parsed.emotionCurve as unknown[]) || [];
    const tags = (parsed.tags as string[]) || [];
    const music = (parsed.music as string) || '';
    const visual = (parsed.visual as string) || '';
    const duration = (parsed.duration as string) || '';

    const report = `【爆款拆解报告】\n标题：${hit.title}\n平台：${hit.platform}\n\n一、结构拆解\n开头钩子：${(structure as { hook?: string }).hook || '-'}\n中间内容：${(structure as { body?: string }).body || '-'}\n结尾CTA：${(structure as { cta?: string }).cta || '-'}\n\n二、话术框架：${(script as { framework?: string }).framework || '-'}\n高频关键词：${(script as { keywords?: string[] }).keywords?.join('、') || '-'}\n\n三、情绪曲线：${emotionCurve.map((e) => (e as { phase?: string; emotion?: string }).emotion).join(' → ')}\n\n四、标签策略：${tags.join(' ')}\n五、音乐卡点：${music}\n六、画面手法：${visual}\n七、时长分析：${duration}`;

    return this.prisma.hitTeardown.create({
      data: {
        hitContentId: hitId,
        structure: JSON.stringify(structure),
        script: JSON.stringify(script),
        emotionCurve: JSON.stringify(emotionCurve),
        tags: JSON.stringify(tags),
        music,
        visual,
        duration,
        report,
      },
    });
  }

  // ---------- 知识库融合 + 二创生成 ----------
  async generateRecreations(teamId: string, userId: string, dto: GenerateRecreationsDto) {
    const hit = await this.prisma.hitContent.findFirst({
      where: { id: dto.hitContentId, teamId },
      include: { teardown: true },
    });
    if (!hit) throw new BadRequestException('爆款内容不存在');

    let teardown = hit.teardown;
    if (!teardown) {
      teardown = await this.teardown(teamId, userId, dto.hitContentId);
    }

    let product: { name: string; parameters: string | null; sellingPoints: string | null; scenarios: string | null; brandScript: string | null } | null = null;
    if (dto.productId) {
      product = await this.prisma.product.findFirst({ where: { id: dto.productId, teamId } });
      if (!product) throw new BadRequestException('产品不存在或不属于当前企业');
    }
    const productInfo = product
      ? `产品：${product.name}\n参数：${product.parameters || '无'}\n卖点：${product.sellingPoints || '无'}\n应用场景：${product.scenarios || '无'}\n品牌话术：${product.brandScript || '无'}`
      : '';

    const style = dto.style || 'professional';
    const platform = dto.platform || 'douyin';
    const versionCount = Math.min(5, Math.max(1, dto.versionCount || 3));
    const versions = ['A', 'B', 'C', 'D', 'E'].slice(0, versionCount);

    const created = [];
    for (const version of versions) {
      const output = await this.ai.chat([
        {
          role: 'system',
          content:
            '你是制造业短视频二创专家。基于爆款拆解结构，结合企业产品知识库进行差异化改写，确保原创度>70%。输出严格 JSON：{title,body,altTitles[],storyboard,voiceScript,tags[]}',
        },
        {
          role: 'user',
          content: `爆款拆解：${teardown.report}\n\n企业产品信息：${productInfo}\n风格：${style}\n平台：${platform}\n版本：${version}\n请生成差异化二创内容，只输出 JSON。`,
        },
      ]);

      const parsed = parseAiJson<{ title?: string; body?: string; altTitles?: string[]; storyboard?: string; voiceScript?: string; tags?: string[] }>(output, '二创模型');

      const sensitive = sensitiveUtil.check(parsed.body || '');

      const rec = await this.prisma.recreationContent.create({
        data: {
          teamId,
          hitContentId: dto.hitContentId,
          productId: dto.productId || null,
          version,
          platform,
          style,
          title: parsed.title || `${hit.title}（${version}版）`,
          body: parsed.body || '',
          storyboard: parsed.storyboard || null,
          voiceScript: parsed.voiceScript || null,
          altTitles: JSON.stringify(parsed.altTitles || []),
          tags: JSON.stringify(parsed.tags || []),
          originalityScore: 0,
          compliancePass: !sensitive.hit,
          sensitiveHit: sensitive.hit,
          status: 'draft',
          createdBy: userId,
        },
      });

      try {
        const orig = await this.originalityService.checkOriginality(rec.body, teamId, rec.id);
        const updated = await this.prisma.recreationContent.update({
          where: { id: rec.id },
          data: { originalityScore: orig.score },
        });
        created.push(updated);
      } catch (err) {
        this.logger.warn(`原创度检查失败: ${(err as Error).message}`);
        created.push(rec);
      }
    }
    return { count: created.length, items: created };
  }

  async listRecreations(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.hitContentId) where.hitContentId = query.hitContentId;
    if (query.status) where.status = query.status;
    const [list, total] = await Promise.all([
      this.prisma.recreationContent.findMany({
        where,
        include: { hitContent: true, score: true },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.recreationContent.count({ where }),
    ]);
    return {
      list: list.map((r) => ({
        ...r,
        altTitles: r.altTitles ? JSON.parse(r.altTitles) : [],
        tags: r.tags ? JSON.parse(r.tags) : [],
      })),
      total,
      page,
      pageSize,
    };
  }

  async getRecreation(teamId: string, id: string) {
    const r = await this.prisma.recreationContent.findFirst({
      where: { id, teamId },
      include: { hitContent: { include: { teardown: true } }, score: true },
    });
    if (!r) return null;
    const history = await this.prisma.recreationHistory.findMany({ where: { teamId, recreationId: id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return {
      ...r,
      altTitles: r.altTitles ? JSON.parse(r.altTitles) : [],
      tags: r.tags ? JSON.parse(r.tags) : [],
      history: history.map((item) => ({ ...item, snapshot: item.snapshot ? JSON.parse(item.snapshot) : null })),
    };
  }

  async updateRecreation(teamId: string, id: string, dto: UpdateRecreationDto) {
    const existing = await this.prisma.recreationContent.findFirst({ where: { id, teamId } });
    if (!existing) throw new BadRequestException('二创内容不存在');
    await this.prisma.recreationHistory.create({
      data: { teamId, recreationId: id, snapshot: JSON.stringify(existing) },
    });
    const sensitive = dto.body ? sensitiveUtil.check(dto.body) : { hit: false, words: [] };
    const updated = await this.prisma.recreationContent.update({
      where: { id },
      data: {
        title: dto.title,
        body: dto.body,
        storyboard: dto.storyboard,
        videoUrl: dto.videoUrl,
        coverUrl: dto.coverUrl,
        tags: dto.tags ? JSON.stringify(dto.tags) : undefined,
        sensitiveHit: dto.body ? sensitive.hit : undefined,
        compliancePass: dto.body ? !sensitive.hit : undefined,
      },
    });
    if (dto.body) {
      const originality = await this.originalityService.checkOriginality(dto.body, teamId, id);
      return this.prisma.recreationContent.update({ where: { id }, data: { originalityScore: originality.score } });
    }
    return updated;
  }

  async removeRecreation(teamId: string, id: string) {
    const existing = await this.prisma.recreationContent.findFirst({ where: { id, teamId } });
    if (!existing) throw new BadRequestException('二创内容不存在');
    if (existing.status === 'published') throw new BadRequestException('已发布的二创内容不能删除');
    await this.prisma.$transaction([
      this.prisma.recreationHistory.deleteMany({ where: { teamId, recreationId: id } }),
      this.prisma.recreationContent.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }

  async selectRecreation(teamId: string, id: string) {
    const existing = await this.prisma.recreationContent.findFirst({ where: { id, teamId } });
    if (!existing) throw new BadRequestException('二创内容不存在');
    if (!existing.compliancePass) throw new BadRequestException('内容合规检查未通过，不能选中');
    if (existing.originalityScore < 0.7) throw new BadRequestException('原创度低于 70%，请修改后再选中');
    return this.prisma.recreationContent.update({
      where: { id },
      data: { status: 'selected' },
    });
  }

  async publishRecreation(teamId: string, userId: string, id: string, dto: PublishRecreationDto) {
    const rec = await this.prisma.recreationContent.findFirst({ where: { id, teamId } });
    if (!rec) throw new BadRequestException('二创内容不存在');
    if (rec.status !== 'selected') throw new BadRequestException('请先选中通过审核的二创版本');
    if (!rec.compliancePass || rec.originalityScore < 0.7) throw new BadRequestException('内容合规或原创度未达到发布要求');
    const type = rec.platform === 'xiaohongshu' || !rec.videoUrl ? 'image_text' : 'video';
    if (type === 'image_text' && !rec.coverUrl) {
      throw new BadRequestException('发布前请为二创内容上传视频，或为图文内容上传封面');
    }
    const content = await this.prisma.content.create({
      data: {
        teamId,
        type,
        title: rec.title,
        body: rec.body,
        videoUrl: rec.videoUrl,
        coverUrl: rec.coverUrl,
        tags: rec.tags || JSON.stringify([]),
        source: 'recreation',
        createdBy: userId,
      },
    });
    const task = await this.dist.publish(teamId, userId, {
      contentId: content.id,
      accountIds: dto.accountIds,
    });
    await this.prisma.recreationContent.update({
      where: { id },
      data: { status: 'publishing', publishTaskId: task.id },
    });
    return { content, task };
  }

  // ---------- 数据飞轮 ----------
  async flywheelStats(teamId: string) {
    const total = await this.prisma.recreationContent.count({ where: { teamId } });
    const published = await this.prisma.recreationContent.count({
      where: { teamId, status: 'published' },
    });
    const scored = await this.prisma.recreationScore.findMany({
      where: { recreation: { teamId } },
      select: { score: true },
    });
    const avgScore = scored.length
      ? scored.reduce((s, r) => s + r.score, 0) / scored.length
      : 0;
    const factorRows = scored.length
      ? await this.prisma.recreationScore.findMany({ where: { recreation: { teamId } }, select: { factors: true } })
      : [];
    const factorTotals: Record<string, { total: number; count: number }> = {};
    for (const row of factorRows) {
      const factors = row.factors ? JSON.parse(row.factors) as Record<string, number> : {};
      for (const [name, value] of Object.entries(factors)) {
        const current = factorTotals[name] || { total: 0, count: 0 };
        current.total += value;
        current.count += 1;
        factorTotals[name] = current;
      }
    }
    return {
      totalRecreations: total,
      publishedRecreations: published,
      avgScore: Number(avgScore.toFixed(2)),
      flywheelLevel: total === 0 ? null : total < 50 ? '第一层（单企业积累）' : total < 500 ? '第二层（跨企业聚合）' : '第三层（AI自进化）',
      effectiveFactors: Object.entries(factorTotals)
        .map(([name, item]) => ({ name, score: Number((item.total / item.count).toFixed(2)) }))
        .sort((a, b) => b.score - a.score),
    };
  }

  async updateScore(teamId: string, id: string, dto: UpdateRecreationScoreDto) {
    const recreation = await this.prisma.recreationContent.findFirst({
      where: { id, teamId },
      include: { hitContent: { include: { teardown: true } } },
    });
    if (!recreation) throw new BadRequestException('二创内容不存在');
    const engagement = dto.playCount ? (dto.likeCount + dto.commentCount * 2 + dto.shareCount * 3) / dto.playCount : 0;
    const score = Math.min(100, Number((Math.log10(dto.playCount + 1) * 12 + engagement * 500).toFixed(2)));
    const teardown = recreation.hitContent.teardown;
    const factorNames = [
      teardown?.structure ? '内容结构' : '',
      teardown?.script ? '话术框架' : '',
      teardown?.music ? '音乐卡点' : '',
      teardown?.visual ? '画面手法' : '',
      teardown?.emotionCurve ? '情绪曲线' : '',
    ].filter(Boolean);
    const factors = Object.fromEntries(factorNames.map((name) => [name, score]));
    return this.prisma.recreationScore.upsert({
      where: { recreationId: id },
      update: { ...dto, score, factors: JSON.stringify(factors), computedAt: new Date() },
      create: { recreationId: id, ...dto, score, factors: JSON.stringify(factors) },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async scheduledCrawl() {
    const teams = await this.prisma.peerAccount.findMany({ distinct: ['teamId'], select: { teamId: true } });
    for (const team of teams) {
      await this.crawlPeers(team.teamId).catch((error) => this.logger.warn(`定时同行抓取失败 team=${team.teamId}: ${(error as Error).message}`));
    }
  }
}
