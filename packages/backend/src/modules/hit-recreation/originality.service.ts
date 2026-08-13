import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';
import { createHash } from 'crypto';

@Injectable()
export class OriginalityService {
  private readonly logger = new Logger(OriginalityService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('ORIGINALITY_API_KEY') || '';
    this.apiUrl = this.config.get<string>('ORIGINALITY_API_URL') || '';
  }

  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    let buf = '';
    const flush = () => {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
    };
    for (const ch of text) {
      const code = ch.codePointAt(0) || 0;
      const isCJK = code >= 0x4e00 && code <= 0x9fff;
      if (isCJK) {
        flush();
        tokens.push(ch);
      } else if (/\s/.test(ch)) {
        flush();
      } else {
        buf += ch;
      }
    }
    flush();
    return tokens;
  }

  private hash64(str: string): bigint {
    return createHash('sha256').update(str, 'utf8').digest().readBigUInt64BE(0);
  }

  private simhash(text: string): bigint {
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return 0n;
    const weight = new Map<string, number>();
    for (const t of tokens) {
      weight.set(t, (weight.get(t) || 0) + 1);
    }
    const acc = new Array<number>(64).fill(0);
    for (const [token, w] of weight) {
      const h = this.hash64(token);
      for (let i = 0; i < 64; i++) {
        const bit = Number((h >> BigInt(i)) & 1n);
        if (bit === 1) acc[i] += w;
        else acc[i] -= w;
      }
    }
    let result = 0n;
    for (let i = 0; i < 64; i++) {
      if (acc[i] > 0) {
        result |= 1n << BigInt(i);
      }
    }
    return result;
  }

  private hammingDistance(a: bigint, b: bigint): number {
    let x = a ^ b;
    let count = 0;
    while (x > 0n) {
      count += Number(x & 1n);
      x >>= 1n;
    }
    return count;
  }

  async checkOriginality(
    text: string,
    teamId: string,
    excludeId?: string,
  ): Promise<{ score: number; similarIds: string[] }> {
    const textHash = this.simhash(text);
    let maxSimilarity = 0;
    const similarIds: string[] = [];

    try {
      const history = await this.prisma.recreationContent.findMany({
        where: { teamId },
        take: 1000,
        select: { id: true, body: true },
        orderBy: { createdAt: 'desc' },
      });

      for (const item of history) {
        if (excludeId && item.id === excludeId) continue;
        if (!item.body) continue;
        const h = this.simhash(item.body);
        const distance = this.hammingDistance(textHash, h);
        const similarity = 1 - distance / 64;
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
        }
        if (similarity > 0.5) {
          similarIds.push(item.id);
        }
      }
    } catch (err) {
      this.logger.error(`原创度历史查询失败: ${(err as Error).message}`);
      throw new ServiceUnavailableException('原创度历史数据查询失败，无法给出可信评分');
    }

    // Unrelated 64-bit SimHash values naturally share about half their bits.
    // Normalize only the similarity above that baseline as duplicate signal.
    const duplicateSimilarity = Math.max(0, (maxSimilarity - 0.5) / 0.5);
    let score = 1 - duplicateSimilarity;

    if (this.apiKey && this.apiUrl) {
      try {
        const target = await prepareSafeExternalRequest(this.apiUrl, { requireHttps: true });
        const resp = await axios.post(
          target.url.toString(),
          { text, teamId },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
            maxRedirects: 0,
            ...target.transport,
          },
        );
        const ext = resp.data?.score;
        if (typeof ext === 'number' && Number.isFinite(ext)) {
          score = Math.min(score, ext);
        }
      } catch (err) {
        this.logger.warn(`外部查重服务调用失败: ${(err as Error).message}`);
      }
    }

    score = Math.max(0, Math.min(1, score));
    return { score, similarIds };
  }
}
