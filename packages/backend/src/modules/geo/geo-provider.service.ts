import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';
import { runtimeMode } from '../../config/runtime-mode';

export const SEARCH_ENGINES = ['baidu', '360', 'sogou', 'bing'] as const;
export type SearchEngine = (typeof SEARCH_ENGINES)[number];

const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';
const SERPAPI_SUPPORTED_ENGINES = new Set<SearchEngine>(['baidu', 'bing']);
const DEFAULT_MAX_RANK_DEPTH = 50;
const MAX_ALLOWED_RANK_DEPTH = 100;

export interface RankTarget {
  targetDomain?: string | null;
  targetBrand?: string | null;
}

export interface CitationEvidence {
  parseStatus: 'valid_json' | 'invalid_json';
  answer: string;
  targetBrand?: string;
  targetDomain?: string;
  brandMentioned: boolean;
  domainMentioned: boolean;
  sourceUrls: string[];
  sourceDomains: string[];
  targetSourceUrls: string[];
  sourceVerification: 'model_claimed_not_fetched';
  scoreBreakdown: {
    explicitMention: number;
    sourceEvidence: number;
    targetDomainSource: number;
  };
}

export interface RankCheckResult {
  rank: number | null;
  cited: boolean;
  citationRate: number;
  /** Single-check evidence score. Kept beside citationRate for API/database compatibility. */
  evidenceScore?: number;
  found?: boolean;
  checkedDepth?: number;
  matchedUrl?: string | null;
  matchedBy?: 'domain' | 'brand' | 'both' | null;
  evidence?: CitationEvidence;
}

export interface SearchEngineCapability {
  engine: SearchEngine;
  supported: boolean;
  reason?: string;
}

export interface IRankProvider {
  checkKeyword(keyword: string, engine: string, target?: RankTarget): Promise<RankCheckResult>;
  getCapabilities(): SearchEngineCapability[];
}

interface OrganicResult {
  position?: number | string;
  title?: string;
  snippet?: string;
  link?: string;
  displayed_link?: string;
  displayed_brand?: string;
  source?: string;
}

interface StructuredCitationReply {
  answer?: unknown;
  sources?: unknown;
  citations?: unknown;
}

export class MockRankProvider implements IRankProvider {
  getCapabilities(): SearchEngineCapability[] {
    return SEARCH_ENGINES.map((engine) => ({ engine, supported: true }));
  }

  async checkKeyword(keyword: string, engine: string): Promise<RankCheckResult> {
    const seed = `${engine}:${keyword}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const rank = (seed % 50) + 1;
    const cited = seed % 3 !== 0;
    const citationRate = cited
      ? Number((0.45 + (seed % 45) / 100).toFixed(2))
      : Number(((seed % 20) / 100).toFixed(2));
    return { rank, cited, citationRate, found: true, checkedDepth: rank };
  }
}

export class SeoRankProvider implements IRankProvider {
  readonly maxRankDepth: number;

  constructor(
    private readonly apiKey: string,
    maxRankDepth = DEFAULT_MAX_RANK_DEPTH,
  ) {
    this.maxRankDepth = clampRankDepth(maxRankDepth);
  }

  getCapabilities(): SearchEngineCapability[] {
    return SEARCH_ENGINES.map((engine) => {
      if (SERPAPI_SUPPORTED_ENGINES.has(engine)) return { engine, supported: true };
      return {
        engine,
        supported: false,
        reason: `SerpAPI 当前未提供 ${engine} 搜索引擎接口`,
      };
    });
  }

  async checkKeyword(keyword: string, engine: string, target: RankTarget = {}): Promise<RankCheckResult> {
    if (!SERPAPI_SUPPORTED_ENGINES.has(engine as SearchEngine)) {
      throw new BadRequestException(`SerpAPI 不支持搜索引擎: ${engine}`);
    }

    const normalizedTarget = normalizeTarget(target);
    if (!normalizedTarget.targetDomain && !normalizedTarget.targetBrand) {
      throw new BadRequestException('排名监测必须配置 targetDomain 或 targetBrand');
    }

    let requestUrl = SERPAPI_ENDPOINT;
    let firstRequest = true;
    let checkedDepth = 0;
    const visited = new Set<string>();

    while (checkedDepth < this.maxRankDepth) {
      const urlKey = stripApiKey(requestUrl);
      if (visited.has(urlKey)) break;
      visited.add(urlKey);

      const target = await prepareSafeExternalRequest(requestUrl, { requireHttps: true });
      const response = await axios.get(target.url.toString(), {
        params: firstRequest
          ? { engine, q: keyword, api_key: this.apiKey }
          : { api_key: this.apiKey },
        timeout: 30000,
        maxRedirects: 0,
        ...target.transport,
      });
      firstRequest = false;

      if (response.data?.error) {
        throw new ServiceUnavailableException(`SerpAPI 查询失败: ${String(response.data.error)}`);
      }

      const organic: OrganicResult[] = Array.isArray(response.data?.organic_results)
        ? response.data.organic_results
        : [];
      const remaining = this.maxRankDepth - checkedDepth;
      const pageResults = organic.slice(0, remaining);

      for (let index = 0; index < pageResults.length; index++) {
        const result = pageResults[index];
        const match = matchOrganicResult(result, normalizedTarget);
        if (!match.matchedBy) continue;

        const inferredRank = checkedDepth + index + 1;
        const reportedPosition = Number(result.position);
        const rank = Number.isFinite(reportedPosition) && reportedPosition > checkedDepth
          ? reportedPosition
          : inferredRank;
        return {
          rank,
          cited: false,
          citationRate: 0,
          found: true,
          checkedDepth: inferredRank,
          matchedUrl: match.matchedUrl || null,
          matchedBy: match.matchedBy,
        };
      }

      checkedDepth += pageResults.length;
      if (!organic.length || pageResults.length < organic.length || checkedDepth >= this.maxRankDepth) break;

      const next = response.data?.serpapi_pagination?.next
        || response.data?.serpapi_pagination?.next_link;
      requestUrl = safeSerpApiPaginationUrl(next);
      if (!requestUrl) break;
    }

    return {
      rank: null,
      cited: false,
      citationRate: 0,
      found: false,
      checkedDepth,
      matchedUrl: null,
      matchedBy: null,
    };
  }
}

export class AiCitationProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async checkAiCitation(
    keyword: string,
    aiPlatform: string,
    target: RankTarget,
    llmKey?: string,
  ): Promise<RankCheckResult> {
    const supported = ['deepseek', 'doubao', 'ernie', 'qwen'];
    if (!supported.includes(aiPlatform)) {
      throw new ServiceUnavailableException(`Unsupported AI platform: ${aiPlatform}`);
    }

    const normalizedTarget = normalizeTarget(target);
    if (!normalizedTarget.targetBrand && !normalizedTarget.targetDomain) {
      throw new BadRequestException('AI 引用监测必须配置 targetBrand 或 targetDomain');
    }

    const messages = buildCitationMessages(keyword, normalizedTarget);
    let reply: string;
    const geoMode = runtimeMode(this.config, 'GEO_MODE');
    if (geoMode === 'mock') {
      // GEO_MODE owns the citation detector's mock/real boundary. In
      // particular, AI_MODE=real must never make a mock GEO check billable.
      reply = this.aiGateway.isMock
        ? await this.aiGateway.chat(messages, 0.1)
        : mockCitationReply(keyword, normalizedTarget);
    } else if (aiPlatform === 'deepseek') {
      if (this.aiGateway.isMock) {
        throw new ServiceUnavailableException('GEO_MODE=real 使用 DeepSeek 引用检测时，必须同时设置 AI_MODE=real');
      }
      reply = await this.aiGateway.chat(messages, 0.1);
    } else {
      const platformKey = this.resolvePlatformKey(aiPlatform, llmKey);
      if (!platformKey) throw new ServiceUnavailableException(`${aiPlatform} API key is not configured`);
      const { baseUrl, model } = this.resolvePlatformConfig(aiPlatform);
      const target = await prepareSafeExternalRequest(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        { requireHttps: true },
      );
      const response = await axios.post(
        target.url.toString(),
        { model, messages, temperature: 0.1, stream: false },
        {
          headers: { Authorization: `Bearer ${platformKey}`, 'Content-Type': 'application/json' },
          timeout: 60000,
          maxRedirects: 0,
          ...target.transport,
        },
      );
      reply = response.data?.choices?.[0]?.message?.content || '';
    }
    return parseCitationReply(reply, normalizedTarget);
  }

  private resolvePlatformKey(aiPlatform: string, llmKey?: string): string {
    if (llmKey) return llmKey;
    if (aiPlatform === 'deepseek') return this.config.get<string>('DEEPSEEK_API_KEY') || '';
    if (aiPlatform === 'doubao') return this.config.get<string>('DOUBAO_API_KEY') || this.config.get<string>('ARK_API_KEY') || '';
    if (aiPlatform === 'qwen') return this.config.get<string>('QWEN_API_KEY') || this.config.get<string>('DASHSCOPE_API_KEY') || '';
    return this.config.get<string>('ERNIE_API_KEY') || '';
  }

  private resolvePlatformConfig(aiPlatform: string) {
    const defaults: Record<string, { baseUrl: string; model: string }> = {
      doubao: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
      qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
      ernie: { baseUrl: 'https://api.baiduqianfan.ai/v1', model: 'ernie-3.5-8k' },
    };
    const fallback = defaults[aiPlatform];
    const prefix = aiPlatform.toUpperCase();
    const baseUrl = this.config.get<string>(`${prefix}_BASE_URL`) || fallback?.baseUrl || '';
    const model = this.config.get<string>(`${prefix}_MODEL`) || fallback?.model || '';
    if (!baseUrl || !model) throw new ServiceUnavailableException(`${aiPlatform} BASE_URL 或 MODEL 未配置`);
    return { baseUrl, model };
  }
}

function mockCitationReply(keyword: string, target: RankTarget): string {
  const targetName = target.targetBrand || target.targetDomain || '目标品牌';
  return JSON.stringify({
    answer: `Mock GEO：${targetName} 与“${keyword}”相关。`,
    sources: target.targetDomain ? [`https://${target.targetDomain}/mock-geo-source`] : [],
  });
}

@Injectable()
export class GeoProviderFactory {
  private readonly mockRank = new MockRankProvider();
  private readonly aiCitation: AiCitationProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly aiGateway: AiGatewayService,
  ) {
    this.aiCitation = new AiCitationProvider(config, aiGateway);
  }

  getRankProvider(): IRankProvider {
    const mode = runtimeMode(this.config, 'GEO_MODE');
    if (mode === 'mock') return this.mockRank;
    const key = this.config.get<string>('GEO_API_KEY') || '';
    if (!key) throw new ServiceUnavailableException('GEO_MODE=real，但未配置 GEO_API_KEY');
    const maxDepth = Number(this.config.get<string>('GEO_MAX_RANK_DEPTH') || DEFAULT_MAX_RANK_DEPTH);
    return new SeoRankProvider(key, maxDepth);
  }

  getSearchCapabilities(): SearchEngineCapability[] {
    const mode = runtimeMode(this.config, 'GEO_MODE');
    if (mode === 'mock') return this.mockRank.getCapabilities();
    const maxDepth = Number(this.config.get<string>('GEO_MAX_RANK_DEPTH') || DEFAULT_MAX_RANK_DEPTH);
    return new SeoRankProvider('', maxDepth).getCapabilities();
  }

  getMockRankProvider(): IRankProvider {
    return this.mockRank;
  }

  getAiCitationProvider(): AiCitationProvider {
    return this.aiCitation;
  }
}

function clampRankDepth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RANK_DEPTH;
  return Math.min(MAX_ALLOWED_RANK_DEPTH, Math.max(10, Math.floor(value)));
}

function normalizeTarget(target: RankTarget): RankTarget {
  return {
    targetDomain: normalizeDomain(target.targetDomain),
    targetBrand: typeof target.targetBrand === 'string' ? target.targetBrand.trim() || undefined : undefined,
  };
}

function normalizeDomain(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const candidate = value.trim().toLowerCase();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    return url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return undefined;
  }
}

function hostnameOf(value?: string): string | undefined {
  return normalizeDomain(value);
}

function domainMatches(candidate: string | undefined, target: string | undefined): boolean {
  if (!candidate || !target) return false;
  return candidate === target || candidate.endsWith(`.${target}`);
}

function brandMatches(text: string, brand?: string | null): boolean {
  if (!brand) return false;
  const normalizedBrand = brand.normalize('NFKC').trim().toLowerCase();
  if (normalizedBrand.length < 2) return false;
  const normalizedText = text.normalize('NFKC').toLowerCase();
  if (normalizedText.includes(normalizedBrand)) return true;
  const compactBrand = normalizedBrand.replace(/[\s\p{P}\p{S}]+/gu, '');
  const compactText = normalizedText.replace(/[\s\p{P}\p{S}]+/gu, '');
  return compactBrand.length >= 2 && compactText.includes(compactBrand);
}

function matchOrganicResult(
  result: OrganicResult,
  target: RankTarget,
): { matchedBy?: 'domain' | 'brand' | 'both'; matchedUrl?: string } {
  const urlCandidates = [result.link, result.displayed_link, result.displayed_brand, result.source]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const domainMatched = urlCandidates.some((value) => domainMatches(hostnameOf(value), target.targetDomain || undefined));
  const searchableText = [result.title, result.snippet, result.displayed_link, result.displayed_brand, result.source]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  const brandMatched = brandMatches(searchableText, target.targetBrand);
  const matchedBy = domainMatched && brandMatched ? 'both' : domainMatched ? 'domain' : brandMatched ? 'brand' : undefined;
  return {
    matchedBy,
    matchedUrl: urlCandidates.find((value) => domainMatches(hostnameOf(value), target.targetDomain || undefined))
      || result.link
      || result.displayed_link,
  };
}

function safeSerpApiPaginationUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (url.hostname !== 'serpapi.com' && !url.hostname.endsWith('.serpapi.com'))) {
      return '';
    }
    url.searchParams.delete('api_key');
    return url.toString();
  } catch {
    return '';
  }
}

function stripApiKey(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.delete('api_key');
    return url.toString();
  } catch {
    return value;
  }
}

function buildCitationMessages(keyword: string, _target: RankTarget) {
  return [
    {
      role: 'system' as const,
      content: [
        '你是面向制造业采购问题的客观问答助手。',
        '回答用户问题后，只返回一个合法 JSON 对象，不要 Markdown 代码块。',
        'JSON 格式：{"answer":"实际回答","sources":[{"title":"来源标题","url":"https://..."}]}',
        '不得因为监测而额外插入任何品牌，只能按你对查询的自然回答输出。',
        '只列出你确实能提供的完整 http/https 来源 URL；不确定时 sources 返回空数组，不得编造。',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: `查询：${keyword}\n请客观回答查询，并输出上述结构化 JSON。`,
    },
  ];
}

export function parseCitationReply(reply: string, target: RankTarget): RankCheckResult {
  const normalizedTarget = normalizeTarget(target);
  const parsed = extractJsonObject(reply);
  const data = parsed.value as StructuredCitationReply | undefined;
  const answer = typeof data?.answer === 'string' ? data.answer.trim().slice(0, 20000) : '';
  const sourceUrls = collectSourceUrls(data, answer);
  const sourceDomains = Array.from(new Set(sourceUrls.map((url) => hostnameOf(url)).filter((value): value is string => Boolean(value))));
  const targetSourceUrls = sourceUrls.filter((url) => domainMatches(hostnameOf(url), normalizedTarget.targetDomain || undefined));
  const brandMentioned = brandMatches(answer, normalizedTarget.targetBrand);
  const targetDomain = normalizedTarget.targetDomain || undefined;
  const domainMentioned = Boolean(targetDomain && answer.toLowerCase().includes(targetDomain));
  const explicitMention = brandMentioned || domainMentioned ? 0.5 : 0;
  const sourceEvidence = (brandMentioned || domainMentioned) && sourceUrls.length > 0 ? 0.25 : 0;
  const targetDomainSource = targetSourceUrls.length > 0 ? 0.5 : 0;
  const citationRate = Number(Math.min(1, explicitMention + sourceEvidence + targetDomainSource).toFixed(2));
  const cited = citationRate > 0;

  return {
    rank: null,
    cited,
    citationRate,
    evidenceScore: citationRate,
    evidence: {
      parseStatus: parsed.ok ? 'valid_json' : 'invalid_json',
      answer,
      targetBrand: normalizedTarget.targetBrand || undefined,
      targetDomain,
      brandMentioned,
      domainMentioned,
      sourceUrls,
      sourceDomains,
      targetSourceUrls,
      sourceVerification: 'model_claimed_not_fetched',
      scoreBreakdown: { explicitMention, sourceEvidence, targetDomainSource },
    },
  };
}

function extractJsonObject(reply: string): { ok: boolean; value?: Record<string, unknown> } {
  const text = (reply || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false };
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function collectSourceUrls(data: StructuredCitationReply | undefined, answer: string): string[] {
  const candidates: unknown[] = [];
  if (Array.isArray(data?.sources)) candidates.push(...data.sources);
  if (Array.isArray(data?.citations)) candidates.push(...data.citations);
  const urls: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') urls.push(candidate);
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      const value = record.url || record.link || record.source_url;
      if (typeof value === 'string') urls.push(value);
    }
  }
  urls.push(...(answer.match(/https?:\/\/[^\s\])}"'>]+/gi) || []));
  return Array.from(new Set(urls.map(normalizeHttpUrl).filter((value): value is string => Boolean(value))));
}

function normalizeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}
