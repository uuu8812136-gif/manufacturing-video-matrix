import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { GeoProviderFactory, IRankProvider } from './geo-provider.service';
import { GeoService } from './geo.service';

describe('GeoService real monitoring flow', () => {
  function makeService(options?: {
    keyword?: Record<string, unknown>;
    config?: Record<string, string>;
    rankProvider?: Partial<IRankProvider>;
    citationResult?: Record<string, unknown>;
    trackingKeywords?: Record<string, unknown>[];
  }) {
    const keyword = {
      id: 'kw-1',
      teamId: 'team-1',
      word: '佛山门窗厂家',
      type: 'region',
      status: 'tracking',
      targetDomain: null,
      targetBrand: null,
      createdAt: new Date(),
      ...options?.keyword,
    };
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'record-1',
      checkedAt: new Date(),
      ...data,
    }));
    const keywordCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'kw-created',
      status: 'tracking',
      createdAt: new Date(),
      ...data,
    }));
    const reportCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'report-1',
      createdAt: new Date(),
      ...data,
    }));
    const prisma = {
      geoKeyword: {
        create: keywordCreate,
        findFirst: jest.fn().mockResolvedValue(keyword),
        findMany: jest.fn().mockResolvedValue(options?.trackingKeywords || []),
      },
      geoRankRecord: { create },
      geoReport: { create: reportCreate },
    } as unknown as PrismaService;
    const configValues = { GEO_MODE: 'real', ...options?.config };
    const config = {
      get: (key: string) => configValues[key as keyof typeof configValues],
    } as unknown as ConfigService;
    const rankProvider: IRankProvider = {
      getCapabilities: () => [
        { engine: 'baidu', supported: true },
        { engine: '360', supported: false, reason: '当前不支持' },
        { engine: 'sogou', supported: false, reason: '当前不支持' },
        { engine: 'bing', supported: true },
      ],
      checkKeyword: jest.fn().mockResolvedValue({
        rank: 3,
        cited: false,
        citationRate: 0,
        found: true,
        checkedDepth: 3,
        matchedUrl: 'https://acme.cn/product',
        matchedBy: 'domain',
      }),
      ...options?.rankProvider,
    };
    const citationProvider = {
      checkAiCitation: jest.fn().mockResolvedValue(options?.citationResult || {
        rank: null,
        cited: true,
        citationRate: 1,
        evidence: {
          parseStatus: 'valid_json',
          answer: '星河门窗提供方案。',
          brandMentioned: true,
          domainMentioned: false,
          sourceUrls: ['https://acme.cn/a'],
          sourceDomains: ['acme.cn'],
          targetSourceUrls: ['https://acme.cn/a'],
          scoreBreakdown: { explicitMention: 0.5, sourceEvidence: 0.25, targetDomainSource: 0.5 },
        },
      }),
    };
    const factory = {
      getRankProvider: () => rankProvider,
      getAiCitationProvider: () => citationProvider,
      getSearchCapabilities: () => rankProvider.getCapabilities(),
    } as unknown as GeoProviderFactory;
    const service = new GeoService(
      prisma,
      config,
      factory,
      {} as AiGatewayService,
    );
    return { service, prisma, rankProvider, citationProvider, create, keywordCreate, reportCreate };
  }

  it('checks only supported engines and returns explicit unsupported capability states', async () => {
    const { service, rankProvider, create } = makeService({
      keyword: { targetDomain: 'acme.cn', targetBrand: '星河门窗' },
    });

    const result = await service.checkRank('team-1', 'kw-1');

    expect(rankProvider.checkKeyword).toHaveBeenCalledTimes(2);
    expect(rankProvider.checkKeyword).toHaveBeenCalledWith(
      '佛山门窗厂家',
      'baidu',
      { targetDomain: 'acme.cn', targetBrand: '星河门窗' },
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rank: 3,
        found: true,
        checkedDepth: 3,
        matchedUrl: 'https://acme.cn/product',
        matchedBy: 'domain',
      }),
    });
    expect(result).toMatchObject({
      checked: 2,
      unsupported: [
        { engine: '360', reason: '当前不支持' },
        { engine: 'sogou', reason: '当前不支持' },
      ],
    });
  });

  it('normalizes valid targets and rejects missing or unreasonable targets at the service boundary', async () => {
    const { service, keywordCreate } = makeService();

    await service.createKeyword('team-1', {
      word: ' 门窗厂家 ',
      type: 'industry',
      targetDomain: 'WWW.Example.COM',
      targetBrand: ' 星河  门窗 ',
    });
    expect(keywordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        word: '门窗厂家',
        targetDomain: 'example.com',
        targetBrand: '星河 门窗',
      }),
    });

    await expect(service.createKeyword('team-1', {
      word: '门窗厂家',
      type: 'industry',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createKeyword('team-1', {
      word: '门窗厂家',
      type: 'industry',
      targetDomain: 'https://example.com/path',
    })).rejects.toThrow('域名格式无效');
    await expect(service.createKeyword('team-1', {
      word: '门窗厂家',
      type: 'industry',
      targetBrand: 'A',
    })).rejects.toThrow('至少包含两个');
  });

  it('persists and returns null rank instead of a synthetic max-depth-plus-one rank', async () => {
    const { service, create } = makeService({
      keyword: { targetDomain: 'acme.cn' },
      rankProvider: {
        checkKeyword: jest.fn().mockResolvedValue({
          rank: 51,
          cited: false,
          citationRate: 0,
          found: false,
          checkedDepth: 50,
        }),
      },
    });

    const result = await service.checkRank('team-1', 'kw-1');

    expect(result?.results[0]).toEqual(expect.objectContaining({
      rank: null,
      found: false,
      checkedDepth: 50,
      matchedUrl: null,
      matchedBy: null,
    }));
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rank: null, found: false, checkedDepth: 50 }),
    });
  });

  it('keeps old keyword rows compatible by falling back to global target configuration', async () => {
    const { service, rankProvider } = makeService({
      config: { GEO_TARGET_DOMAIN: 'legacy.example', GEO_TARGET_BRAND: '旧品牌' },
    });

    await service.checkRank('team-1', 'kw-1');

    expect(rankProvider.checkKeyword).toHaveBeenCalledWith(
      '佛山门窗厂家',
      'baidu',
      { targetDomain: 'legacy.example', targetBrand: '旧品牌' },
    );
  });

  it('persists auditable citation evidence and returns it to the caller', async () => {
    const { service, citationProvider, create } = makeService({
      keyword: { targetDomain: 'acme.cn', targetBrand: '星河门窗' },
    });

    const result = await service.checkAiCitation('team-1', 'kw-1', 'deepseek');

    expect(citationProvider.checkAiCitation).toHaveBeenCalledWith(
      '佛山门窗厂家',
      'deepseek',
      { targetDomain: 'acme.cn', targetBrand: '星河门窗' },
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cited: true,
        citationRate: 1,
        citationEvidence: expect.objectContaining({ parseStatus: 'valid_json' }),
      }),
    });
    expect(result).toEqual(expect.objectContaining({
      evidence: expect.objectContaining({ brandMentioned: true }),
    }));
  });

  it('does not declare a leader when either competitor rank was not found', async () => {
    const checkKeyword = jest.fn()
      .mockResolvedValueOnce({
        rank: null,
        cited: false,
        citationRate: 0,
        found: false,
        checkedDepth: 50,
        matchedUrl: null,
        matchedBy: null,
      })
      .mockResolvedValueOnce({
        rank: 8,
        cited: false,
        citationRate: 0,
        found: true,
        checkedDepth: 8,
        matchedUrl: 'https://competitor.example/a',
        matchedBy: 'brand',
      });
    const { service } = makeService({
      keyword: { targetDomain: 'acme.cn', targetBrand: '星河门窗' },
      rankProvider: { checkKeyword },
    });

    const result = await service.competitorCompare('team-1', '佛山门窗厂家', '竞品门窗');

    expect(result).toMatchObject({
      selfRank: null,
      competitorRank: 8,
      comparison: 'incomplete',
      advantage: null,
      gap: null,
      selfMatch: { found: false, checkedDepth: 50, matchedUrl: null, matchedBy: null },
    });
  });

  it('excludes unmeasured citation keywords and uses the evidence-score wording in monthly reports', async () => {
    const now = new Date();
    const { service, reportCreate } = makeService({
      trackingKeywords: [
        {
          id: 'kw-measured',
          word: '已检测关键词',
          type: 'product',
          records: [
            { id: 'ai-1', keywordId: 'kw-measured', engine: 'deepseek', rank: null, found: null, citationRate: 0.6, checkedAt: now },
          ],
        },
        {
          id: 'kw-unmeasured',
          word: '未检测关键词',
          type: 'industry',
          records: [],
        },
      ],
    });

    const report = await service.monthlyReport('team-1');

    expect(reportCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: expect.stringContaining('已检测 AI 引用证据分关键词：1'),
      }),
    });
    expect(report.content).toContain('平均 AI 引用证据分：0.60');
    expect(report.content).not.toContain('AI 引用率');
  });
});
