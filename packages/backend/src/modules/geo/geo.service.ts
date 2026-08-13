import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parsePage } from '../../common/utils/page.util';
import { CreateKeywordDto } from './dto/geo.dto';
import { GeoProviderFactory, RankTarget, SEARCH_ENGINES } from './geo-provider.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { runtimeMode } from '../../config/runtime-mode';

const AI_PLATFORMS = ['deepseek', 'doubao', 'ernie', 'qwen'];

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private providerFactory: GeoProviderFactory,
    private aiGateway: AiGatewayService,
  ) {}

  get isMock() {
    return runtimeMode(this.config, 'GEO_MODE') === 'mock';
  }

  async listKeywords(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.type) where.type = query.type;
    const [list, total] = await Promise.all([
      this.prisma.geoKeyword.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.geoKeyword.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async createKeyword(teamId: string, dto: CreateKeywordDto) {
    const target = normalizeAndValidateKeywordTarget(dto.targetDomain, dto.targetBrand);
    return this.prisma.geoKeyword.create({
      data: {
        teamId,
        ...dto,
        word: dto.word.trim(),
        targetDomain: target.targetDomain || null,
        targetBrand: target.targetBrand || null,
      },
    });
  }

  async removeKeyword(teamId: string, id: string) {
    const keyword = await this.prisma.geoKeyword.findFirst({ where: { id, teamId } });
    if (!keyword) return { count: 0 };
    await this.prisma.$transaction([
      this.prisma.geoRankRecord.deleteMany({ where: { keywordId: id } }),
      this.prisma.geoKeyword.delete({ where: { id } }),
    ]);
    return { count: 1 };
  }

  async checkRank(teamId: string, keywordId: string) {
    const keyword = await this.prisma.geoKeyword.findFirst({ where: { id: keywordId, teamId } });
    if (!keyword) return null;
    const provider = this.providerFactory.getRankProvider();
    const target = this.resolveTarget(keyword);
    const capabilities = provider.getCapabilities();
    let checked = 0;
    const results = [];
    const unsupported = [];
    for (const capability of capabilities) {
      if (!capability.supported) {
        unsupported.push({ engine: capability.engine, reason: capability.reason });
        continue;
      }
      const result = await provider.checkKeyword(keyword.word, capability.engine, target);
      const found = result.found === true && result.rank !== null;
      const rank = found ? result.rank : null;
      const checkedDepth = Math.max(0, Math.floor(result.checkedDepth || 0));
      const matchedUrl = found ? result.matchedUrl || null : null;
      const matchedBy = found ? result.matchedBy || null : null;
      await this.prisma.geoRankRecord.create({
        data: {
          keywordId,
          engine: capability.engine,
          rank,
          found,
          checkedDepth,
          matchedUrl,
          matchedBy,
          cited: result.cited,
          citationRate: result.citationRate,
        },
      });
      results.push({
        engine: capability.engine,
        rank,
        found,
        checkedDepth,
        matchedUrl,
        matchedBy,
      });
      checked++;
    }
    return { checked, target, results, unsupported, capabilities };
  }

  async checkAiCitation(teamId: string, keywordId: string, aiPlatform: string) {
    const keyword = await this.prisma.geoKeyword.findFirst({ where: { id: keywordId, teamId } });
    if (!keyword) return null;
    const provider = this.providerFactory.getAiCitationProvider();
    const target = this.resolveTarget(keyword);
    const result = await provider.checkAiCitation(keyword.word, aiPlatform, target);
    const record = await this.prisma.geoRankRecord.create({
      data: {
        keywordId,
        engine: aiPlatform,
        rank: null,
        found: null,
        checkedDepth: null,
        matchedUrl: null,
        matchedBy: null,
        cited: result.cited,
        citationRate: result.citationRate,
        ...(result.evidence
          ? { citationEvidence: result.evidence as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return { ...record, evidence: result.evidence };
  }

  searchCapabilities() {
    return {
      mode: this.isMock ? 'mock' : 'real',
      engines: this.providerFactory.getSearchCapabilities(),
    };
  }

  async rankTracking(teamId: string) {
    const keywords = await this.prisma.geoKeyword.findMany({
      where: { teamId },
      include: { records: { orderBy: { checkedAt: 'desc' } } },
    });
    return keywords.map((k) => {
      const latest = new Map<string, (typeof k.records)[number]>();
      for (const record of k.records) {
        if (!latest.has(record.engine)) latest.set(record.engine, record);
      }
      const records = Array.from(latest.values());
      const engineRecords = records.filter((r) => SEARCH_ENGINES.includes(r.engine as (typeof SEARCH_ENGINES)[number])
        && r.rank !== null
        // Rows created before match-evidence migration have found=null. Treat
        // those as unverified instead of presenting a legacy sentinel rank as
        // a confirmed match; the next real check will populate the evidence.
        && r.found === true);
      const avgRank = engineRecords.length
        ? engineRecords.reduce((s, r) => s + (r.rank || 0), 0) / engineRecords.length
        : null;
      const aiRecords = records.filter((r) => AI_PLATFORMS.includes(r.engine) && r.citationRate !== null);
      const citationEvidenceScore = aiRecords.length
        ? aiRecords.reduce((sum, record) => sum + (record.citationRate || 0), 0) / aiRecords.length
        : null;
      return {
        keyword: k.word,
        type: k.type,
        avgRank: avgRank === null ? null : Number(avgRank.toFixed(1)),
        citationEvidenceScore: citationEvidenceScore === null ? null : Number(citationEvidenceScore.toFixed(2)),
        // 兼容旧客户端；未检测不再伪装为 0 分。
        citationRate: citationEvidenceScore === null ? null : Number(citationEvidenceScore.toFixed(2)),
        status: avgRank === null ? 'unchecked' : avgRank <= 10 ? 'good' : avgRank <= 30 ? 'normal' : 'poor',
      };
    });
  }

  async dualEngineDashboard(teamId: string) {
    const socialLeads = await this.prisma.lead.count({ where: { teamId, sourcePlatform: { not: 'lead_form' } } });
    const searchLeads = await this.prisma.lead.count({ where: { teamId, sourcePlatform: 'lead_form' } });
    const total = socialLeads + searchLeads;

    const keywords = await this.prisma.geoKeyword.findMany({ where: { teamId }, select: { id: true } });
    const keywordIds = keywords.map((k) => k.id);
    const records = keywordIds.length
      ? await this.prisma.geoRankRecord.findMany({ where: { keywordId: { in: keywordIds } } })
      : [];

    const latestRecords = new Map<string, (typeof records)[number]>();
    for (const record of records.sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())) {
      const key = `${record.keywordId}:${record.engine}`;
      if (!latestRecords.has(key)) latestRecords.set(key, record);
    }
    const currentRecords = Array.from(latestRecords.values());
    const searchRecords = currentRecords.filter((r) => SEARCH_ENGINES.includes(r.engine as (typeof SEARCH_ENGINES)[number])
      && r.rank !== null
      && r.found === true);
    const aiRecords = currentRecords.filter((r) => AI_PLATFORMS.includes(r.engine) && r.citationRate !== null);
    const avgSearchRank = searchRecords.length
      ? searchRecords.reduce((s, r) => s + (r.rank || 0), 0) / searchRecords.length
      : null;
    const aiCitationEvidenceScore = aiRecords.length
      ? aiRecords.reduce((s, r) => s + (r.citationRate || 0), 0) / aiRecords.length
      : null;

    return {
      socialCount: socialLeads,
      searchCount: searchLeads,
      socialLeads,
      searchLeads,
      socialRate: total ? Number(((socialLeads / total) * 100).toFixed(1)) : 0,
      searchRate: total ? Number(((searchLeads / total) * 100).toFixed(1)) : 0,
      aiCitationEvidenceScore: aiCitationEvidenceScore === null ? null : Number(aiCitationEvidenceScore.toFixed(2)),
      aiCitationRate: aiCitationEvidenceScore === null ? null : Number(aiCitationEvidenceScore.toFixed(2)),
      searchTrend: avgSearchRank === null ? null : Number((60 - avgSearchRank > 0 ? 60 - avgSearchRank : 0).toFixed(1)),
      socialTrend: total ? Number(((socialLeads / total) * 100).toFixed(1)) : 0,
    };
  }

  async competitorCompare(teamId: string, keyword: string, competitor: string) {
    const provider = this.providerFactory.getRankProvider();
    const storedKeyword = await this.prisma.geoKeyword.findFirst({ where: { teamId, word: keyword } });
    const ownTarget = this.resolveTarget(storedKeyword || { word: keyword, targetDomain: null, targetBrand: null });
    if (!ownTarget.targetDomain && !ownTarget.targetBrand) {
      throw new BadRequestException('请先在关键词库中为该关键词配置我方品牌或官网域名');
    }
    const [self, compared] = await Promise.all([
      provider.checkKeyword(keyword, 'baidu', ownTarget),
      provider.checkKeyword(keyword, 'baidu', { targetBrand: competitor }),
    ]);
    const selfFound = self.found === true && self.rank !== null;
    const competitorFound = compared.found === true && compared.rank !== null;
    const selfRank = selfFound ? self.rank : null;
    const compRank = competitorFound ? compared.rank : null;
    let comparison: 'incomplete' | 'tie' | 'self_ahead' | 'competitor_ahead';
    if (selfRank === null || compRank === null) comparison = 'incomplete';
    else if (selfRank === compRank) comparison = 'tie';
    else if (selfRank < compRank) comparison = 'self_ahead';
    else comparison = 'competitor_ahead';
    return {
      keyword,
      competitor,
      selfRank,
      competitorRank: compRank,
      comparison,
      advantage: comparison === 'incomplete' ? null : comparison === 'self_ahead',
      gap: selfRank === null || compRank === null ? null : compRank - selfRank,
      selfMatch: {
        found: selfFound,
        checkedDepth: self.checkedDepth || 0,
        matchedUrl: selfFound ? self.matchedUrl || null : null,
        matchedBy: selfFound ? self.matchedBy || null : null,
      },
      competitorMatch: {
        found: competitorFound,
        checkedDepth: compared.checkedDepth || 0,
        matchedUrl: competitorFound ? compared.matchedUrl || null : null,
        matchedBy: competitorFound ? compared.matchedBy || null : null,
      },
    };
  }

  async seoAdvice(keyword: string) {
    let advice: string;
    try {
      advice = await this.aiGateway.chat(
        [
          {
            role: 'system',
            content: '你是制造业 GEO/SEO 优化专家，请给出结构化、可落地的优化建议。',
          },
          {
            role: 'user',
            content: `请针对关键词"${keyword}"给出 SEO/GEO 优化建议，包括：1.标题与内容结构；2.需要布局的长尾词；3.外链与媒体占位策略；4.AI 引用证据分提升技巧。请用 JSON 返回 {title, structure, longTail:[], media:[], aiTips:[]}。`,
          },
        ],
        0.5,
      );
    } catch (err) {
      throw err;
    }
    return { keyword, advice };
  }

  async monthlyReport(teamId: string) {
    const month = new Date().toISOString().slice(0, 7);
    const tracking = await this.rankTracking(teamId);
    const homeCount = tracking.filter((t) => t.avgRank !== null && t.avgRank <= 10).length;
    const citationChecked = tracking.filter((item) => item.citationEvidenceScore !== null);
    const avgCitationEvidenceScore = citationChecked.length
      ? citationChecked.reduce((sum, item) => sum + (item.citationEvidenceScore || 0), 0) / citationChecked.length
      : null;
    const poorKeywords = tracking.filter((t) => t.status === 'poor').map((t) => t.keyword);
    const suggestionParts: string[] = [];
    if (poorKeywords.length) {
      suggestionParts.push(`排名靠后待优化：${poorKeywords.slice(0, 5).join('、')}`);
    }
    if (avgCitationEvidenceScore !== null && avgCitationEvidenceScore < 0.5) {
      suggestionParts.push(`AI 引用证据分 ${avgCitationEvidenceScore.toFixed(2)} 偏低，建议增加结构化问答与权威媒体占位`);
    }
    const suggestion = suggestionParts.join('；');
    const citationSummary = avgCitationEvidenceScore === null
      ? '未检测'
      : avgCitationEvidenceScore.toFixed(2);
    const content = `【GEO 优化月报 ${month}】\n关键词数：${tracking.length}\n排名首页关键词：${homeCount}\n已检测 AI 引用证据分关键词：${citationChecked.length}\n平均 AI 引用证据分：${citationSummary}${suggestion ? '\n建议：' + suggestion : ''}`;
    return this.prisma.geoReport.create({ data: { teamId, month, content } });
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async dailyCheck() {
    this.logger.log('GEO 每日排名监测');
    const keywords = await this.prisma.geoKeyword.findMany({ where: { status: 'tracking' } });
    for (const k of keywords) {
      await this.checkRank(k.teamId, k.id).catch((e) => this.logger.warn(`监测失败 ${k.word}: ${(e as Error).message}`));
    }
  }

  private resolveTarget(keyword: { word: string; targetDomain: string | null; targetBrand: string | null }): RankTarget {
    const targetDomain = keyword.targetDomain?.trim()
      || this.config.get<string>('GEO_TARGET_DOMAIN')?.trim()
      || undefined;
    const targetBrand = keyword.targetBrand?.trim()
      || this.config.get<string>('GEO_TARGET_BRAND')?.trim()
      || (this.isMock ? keyword.word : undefined);
    return { targetDomain, targetBrand };
  }
}

function normalizeAndValidateKeywordTarget(
  targetDomain?: string,
  targetBrand?: string,
): { targetDomain?: string; targetBrand?: string } {
  const rawDomain = targetDomain?.trim() || '';
  const normalizedBrand = targetBrand?.normalize('NFKC').trim().replace(/\s+/g, ' ') || '';
  if (!rawDomain && !normalizedBrand) {
    throw new BadRequestException('目标官网域名和目标品牌至少填写一项');
  }

  let normalizedDomain: string | undefined;
  if (rawDomain) {
    if (rawDomain.includes('://') || /[/?#@]/.test(rawDomain)) {
      throw new BadRequestException('目标官网域名格式无效，请只填写 example.com，不要包含协议、路径或参数');
    }
    try {
      const parsed = new URL(`https://${rawDomain.toLowerCase()}`);
      if (parsed.port || parsed.username || parsed.password) throw new Error('domain extras');
      const hostname = parsed.hostname.replace(/^www\./, '').replace(/\.$/, '');
      const labels = hostname.split('.');
      const validLabels = labels.length >= 2
        && hostname.length <= 253
        && labels.every((label) => label.length >= 1
          && label.length <= 63
          && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
      const tld = labels.at(-1) || '';
      const validTld = /^[a-z]{2,63}$/i.test(tld) || /^xn--[a-z0-9-]{2,59}$/i.test(tld);
      if (!validLabels || !validTld) throw new Error('invalid public domain');
      normalizedDomain = hostname;
    } catch {
      throw new BadRequestException('目标官网域名格式无效，请填写 example.com 形式的公网域名');
    }
  }

  if (normalizedBrand) {
    const meaningfulCharacters = normalizedBrand.match(/[\p{L}\p{N}]/gu)?.length || 0;
    const allowed = /^(?!.*(?:https?:\/\/|[\r\n\t]))[\p{L}\p{N}\p{M}\s·&＋+（）()_.\-'’]+$/u.test(normalizedBrand);
    if (meaningfulCharacters < 2 || normalizedBrand.length > 100 || !allowed) {
      throw new BadRequestException('目标品牌至少包含两个文字或数字，且不能是网址或包含控制字符');
    }
  }

  return {
    targetDomain: normalizedDomain,
    targetBrand: normalizedBrand || undefined,
  };
}
