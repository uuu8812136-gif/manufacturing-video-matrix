import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import {
  AiCitationProvider,
  GeoProviderFactory,
  MockRankProvider,
  SeoRankProvider,
  parseCitationReply,
} from './geo-provider.service';

jest.mock('../../common/utils/external-url.util', () => ({
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
}));

describe('GeoProviderFactory', () => {
  let factory: GeoProviderFactory;

  beforeEach(() => {
    const config = {
      get: (key: string) => ({ NODE_ENV: 'test', GEO_MODE: 'mock' } as Record<string, string>)[key],
    } as unknown as ConfigService;
    const ai = { isMock: true } as unknown as AiGatewayService;
    factory = new GeoProviderFactory(config, ai);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns mock provider only when isolated tests explicitly request it', () => {
    expect(factory.getRankProvider()).toBeInstanceOf(MockRankProvider);
  });

  it('getMockRankProvider returns MockRankProvider', () => {
    expect(factory.getMockRankProvider()).toBeInstanceOf(MockRankProvider);
  });

  it('MockRankProvider returns rank between 1 and 50', async () => {
    const result = await factory.getMockRankProvider().checkKeyword('门窗', 'baidu');
    expect(result.rank).toBeGreaterThanOrEqual(1);
    expect(result.rank).toBeLessThanOrEqual(50);
    expect(typeof result.cited).toBe('boolean');
    expect(typeof result.citationRate).toBe('number');
  });

  it('reports real SerpAPI engine capabilities without requiring an API key', () => {
    const config = {
      get: (key: string) => ({ GEO_MODE: 'real' } as Record<string, string>)[key],
    } as unknown as ConfigService;
    const realFactory = new GeoProviderFactory(config, { isMock: false } as AiGatewayService);
    expect(realFactory.getSearchCapabilities()).toEqual([
      { engine: 'baidu', supported: true },
      { engine: '360', supported: false, reason: expect.stringContaining('未提供') },
      { engine: 'sogou', supported: false, reason: expect.stringContaining('未提供') },
      { engine: 'bing', supported: true },
    ]);
  });
});

describe('SeoRankProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the official endpoint and finds the configured domain instead of the first result', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        organic_results: [
          { position: 1, title: '其他工厂', link: 'https://other.example/page' },
          { position: 2, title: '目标工厂', link: 'https://www.acme.cn/products/windows' },
        ],
      },
    });
    const provider = new SeoRankProvider('secret', 50);

    const result = await provider.checkKeyword('断桥铝门窗', 'baidu', { targetDomain: 'https://acme.cn/' });

    expect(get).toHaveBeenCalledWith(
      'https://serpapi.com/search.json',
      expect.objectContaining({ params: { engine: 'baidu', q: '断桥铝门窗', api_key: 'secret' } }),
    );
    expect(result).toMatchObject({ rank: 2, found: true, matchedBy: 'domain' });
    expect(result.matchedUrl).toBe('https://www.acme.cn/products/windows');
  });

  it('can match a target brand in organic result content', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        organic_results: [
          { position: 1, title: '行业新闻', snippet: '来自佛山的星河门窗发布新品', link: 'https://news.example/a' },
        ],
      },
    });
    const result = await new SeoRankProvider('secret').checkKeyword('门窗', 'bing', { targetBrand: '星河门窗' });
    expect(result).toMatchObject({ rank: 1, found: true, matchedBy: 'brand' });
  });

  it('follows SerpAPI pagination and calculates a global organic rank', async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) => ({
      position: index + 1,
      title: `结果 ${index + 1}`,
      link: `https://other${index}.example/a`,
    }));
    const get = jest.spyOn(axios, 'get')
      .mockResolvedValueOnce({
        data: {
          organic_results: firstPage,
          serpapi_pagination: {
            next: 'https://serpapi.com/search.json?engine=baidu&q=test&pn=10&api_key=leaked',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          organic_results: [
            { position: 1, title: '目标', displayed_brand: 'acme.cn', link: 'https://acme.cn/hit' },
          ],
        },
      });

    const result = await new SeoRankProvider('secret', 50).checkKeyword('test', 'baidu', { targetDomain: 'acme.cn' });

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toBe('https://serpapi.com/search.json?engine=baidu&q=test&pn=10');
    expect(get.mock.calls[1][1]).toEqual(expect.objectContaining({ params: { api_key: 'secret' } }));
    expect(result).toMatchObject({ rank: 11, checkedDepth: 11, found: true });
  });

  it('returns null rank and explicit evidence fields when target is not found', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: { organic_results: Array.from({ length: 10 }, (_, i) => ({ title: `other${i}` })) },
    });
    const result = await new SeoRankProvider('secret', 10).checkKeyword('test', 'bing', { targetBrand: 'Acme' });
    expect(result).toEqual(expect.objectContaining({
      rank: null,
      found: false,
      checkedDepth: 10,
      matchedUrl: null,
      matchedBy: null,
    }));
  });

  it('rejects unsupported engines before making a request', async () => {
    const get = jest.spyOn(axios, 'get');
    await expect(
      new SeoRankProvider('secret').checkKeyword('test', '360', { targetBrand: 'Acme' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(get).not.toHaveBeenCalled();
  });

  it('requires a domain or brand target', async () => {
    await expect(new SeoRankProvider('secret').checkKeyword('test', 'baidu'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AI citation evidence', () => {
  it('scores an explicit brand mention with a target-domain source from structured JSON', () => {
    const result = parseCitationReply(JSON.stringify({
      answer: '星河门窗提供断桥铝门窗方案。',
      brandMentioned: true,
      sources: [{ title: '官网', url: 'https://www.acme.cn/products/windows#intro' }],
    }), { targetBrand: '星河门窗', targetDomain: 'acme.cn' });

    expect(result.cited).toBe(true);
    expect(result.citationRate).toBe(1);
    expect(result.evidence).toMatchObject({
      parseStatus: 'valid_json',
      brandMentioned: true,
      sourceDomains: ['acme.cn'],
      targetSourceUrls: ['https://www.acme.cn/products/windows'],
    });
  });

  it('does not trust a model boolean when the answer contains no verifiable target mention', () => {
    const result = parseCitationReply(JSON.stringify({
      answer: '这是一家门窗厂家。',
      brandMentioned: true,
      sources: [],
    }), { targetBrand: '星河门窗', targetDomain: 'acme.cn' });
    expect(result.cited).toBe(false);
    expect(result.citationRate).toBe(0);
  });

  it('returns zero evidence for malformed non-JSON output', () => {
    const result = parseCitationReply('我知道这个品牌，但没有结构化回答。', { targetBrand: '星河门窗' });
    expect(result).toMatchObject({ cited: false, citationRate: 0 });
    expect(result.evidence?.parseStatus).toBe('invalid_json');
  });

  it('asks the model for auditable JSON and parses the actual answer', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify({
      answer: '星河门窗是一家门窗厂家。',
      sources: [],
    }));
    const provider = new AiCitationProvider(
      { get: (key: string) => key === 'GEO_MODE' ? 'real' : undefined } as unknown as ConfigService,
      { isMock: false, chat } as unknown as AiGatewayService,
    );

    const result = await provider.checkAiCitation('佛山门窗厂家', 'deepseek', { targetBrand: '星河门窗' });

    expect(result).toMatchObject({ cited: true, citationRate: 0.5 });
    expect(chat).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('结构化 JSON') })]),
      0.1,
    );
    const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages.map((item) => item.content).join('\n')).not.toContain('星河门窗');
  });

  it('does not call a real AI gateway while GEO_MODE is mock', async () => {
    const chat = jest.fn();
    const provider = new AiCitationProvider(
      { get: (key: string) => key === 'GEO_MODE' ? 'mock' : undefined } as unknown as ConfigService,
      { isMock: false, chat } as unknown as AiGatewayService,
    );

    const result = await provider.checkAiCitation('佛山门窗厂家', 'deepseek', {
      targetBrand: '星河门窗',
      targetDomain: 'acme.cn',
    });

    expect(chat).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cited: true, citationRate: 1 });
  });

  it('rejects DeepSeek citation in real GEO mode when AI_MODE is still mock', async () => {
    const provider = new AiCitationProvider(
      { get: (key: string) => key === 'GEO_MODE' ? 'real' : undefined } as unknown as ConfigService,
      { isMock: true, chat: jest.fn() } as unknown as AiGatewayService,
    );

    await expect(provider.checkAiCitation('佛山门窗厂家', 'deepseek', { targetBrand: '星河门窗' }))
      .rejects.toThrow('AI_MODE=real');
  });
});
