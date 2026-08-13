import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';
import { runtimeMode } from '../../config/runtime-mode';

export interface CrawledHit {
  platform: string;
  author: string;
  authorAvatar?: string;
  title: string;
  coverUrl?: string;
  videoUrl?: string;
  playCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  collectCount: number;
  publishedAt: Date;
}

@Injectable()
export class CrawlService {
  private readonly logger = new Logger(CrawlService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly enableScrape: boolean;
  private readonly mode: string;

  constructor(private config: ConfigService) {
    this.apiKey = config.get<string>('CRAWL_API_KEY') || '';
    this.apiUrl = config.get<string>('CRAWL_API_URL') || '';
    this.enableScrape = (config.get<string>('CRAWL_ENABLE_SCRAPE') || '').toLowerCase() === 'true';
    this.mode = runtimeMode(config, 'CRAWL_MODE');
  }

  get isMock() {
    return this.mode === 'mock';
  }

  assertAvailable() {
    if (this.mode === 'mock' || (this.apiKey && this.apiUrl) || this.enableScrape) return;
    throw new ServiceUnavailableException(
      'CRAWL_MODE=real，但未同时配置 CRAWL_API_URL/CRAWL_API_KEY，且未启用 CRAWL_ENABLE_SCRAPE',
    );
  }

  async crawlPeer(peerNickname: string, platform: string): Promise<CrawledHit[]> {
    this.assertAvailable();
    if (this.mode === 'mock') return this.mockHits(peerNickname, platform);
    if (this.apiKey && this.apiUrl) {
      return await this.crawlByApi(peerNickname, platform);
    }
    if (this.enableScrape) {
      return await this.crawlByScrape(peerNickname, platform);
    }
    throw new ServiceUnavailableException('抓取服务不可用');
  }

  private mockHits(peerNickname: string, platform: string): CrawledHit[] {
    const now = Date.now();
    const titles = [
      '源头工厂揭秘采购避坑3件事',
      '这种设备参数别只看价格',
      '车间实拍：好产品是怎么做出来的',
    ];
    return titles.map((title, index) => ({
      platform,
      author: peerNickname,
      title,
      coverUrl: `https://dummyimage.com/720x1280/1f2937/ffffff&text=${encodeURIComponent(title)}`,
      videoUrl: `mock://crawl/${platform}/${index + 1}.mp4`,
      playCount: 120000 - index * 18000,
      likeCount: 8600 - index * 900,
      commentCount: 680 - index * 80,
      shareCount: 1200 - index * 130,
      collectCount: 2100 - index * 220,
      publishedAt: new Date(now - (index + 1) * 24 * 60 * 60 * 1000),
    }));
  }

  private async crawlByApi(peerNickname: string, platform: string): Promise<CrawledHit[]> {
    try {
      const target = await prepareSafeExternalRequest(this.apiUrl, { requireHttps: true });
      const resp = await axios.post(
        target.url.toString(),
        {
          peerNickname,
          platform,
          days: 7,
        },
        {
          timeout: 30000,
          maxRedirects: 0,
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          ...target.transport,
        },
      );
      const list = resp?.data?.data?.list || resp?.data?.list || [];
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error('third-party crawl returned empty');
      }
      return list.map((item: Record<string, unknown>) => this.normalizeApiHit(item, platform, peerNickname));
    } catch (err) {
      this.logger.error(`crawlByApi failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(`crawl service call failed: ${(err as Error).message}`);
    }
  }

  private normalizeApiHit(item: Record<string, unknown>, platform: string, peerNickname: string): CrawledHit {
    const publishedAt = item.published_at || item.publishTime || item.create_time;
    return {
      platform,
      author: String(item.author || item.nickname || peerNickname),
      authorAvatar: item.author_avatar ? String(item.author_avatar) : undefined,
      title: String(item.title || item.desc || ''),
      coverUrl: item.cover_url ? String(item.cover_url) : item.cover ? String(item.cover) : undefined,
      videoUrl: item.video_url ? String(item.video_url) : item.video ? String(item.video) : undefined,
      playCount: Number(item.play_count ?? item.playCount ?? item.views ?? 0),
      likeCount: Number(item.like_count ?? item.likeCount ?? item.diggs ?? 0),
      commentCount: Number(item.comment_count ?? item.commentCount ?? 0),
      shareCount: Number(item.share_count ?? item.shareCount ?? 0),
      collectCount: Number(item.collect_count ?? item.collectCount ?? item.favorites ?? 0),
      publishedAt: publishedAt ? new Date(publishedAt as string) : new Date(),
    };
  }

  private async crawlByScrape(peerNickname: string, platform: string): Promise<CrawledHit[]> {
    const targets = this.buildScrapeTargets(platform, peerNickname);
    for (const target of targets) {
      try {
        const hits = await this.scrapePage(target.url, platform, peerNickname, target.selector);
        if (hits.length > 0) {
          return hits;
        }
      } catch (err) {
        this.logger.warn(`scrape ${target.url} failed: ${(err as Error).message}`);
      }
    }
    throw new Error('all scrape targets failed or empty');
  }

  private buildScrapeTargets(
    platform: string,
    peerNickname: string,
  ): { url: string; selector: 'douyin' | 'xiaohongshu' | 'generic' }[] {
    const encoded = encodeURIComponent(peerNickname);
    switch (platform) {
      case 'douyin':
        return [
          { url: `https://www.douyin.com/search/${encoded}`, selector: 'douyin' },
          { url: `https://www.iesdouyin.com/share/user/${encoded}`, selector: 'douyin' },
        ];
      case 'xiaohongshu':
        return [
          { url: `https://www.xiaohongshu.com/search_result?keyword=${encoded}`, selector: 'xiaohongshu' },
          { url: 'https://www.xiaohongshu.com/explore', selector: 'xiaohongshu' },
        ];
      default:
        return [{ url: `https://www.baidu.com/s?wd=${encoded}+${platform}`, selector: 'generic' }];
    }
  }

  private async scrapePage(
    url: string,
    platform: string,
    peerNickname: string,
    selector: 'douyin' | 'xiaohongshu' | 'generic',
  ): Promise<CrawledHit[]> {
    const resp = await axios.get(url, {
      timeout: 30000,
      maxRedirects: 0,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    const $ = cheerio.load(html);
    const now = Date.now();
    const hits: CrawledHit[] = [];

    if (selector === 'douyin') {
      $('a[href*="/video/"], div[data-e2e="search-video-desc"], ul li').each((_, el) => {
        const $el = $(el);
        const title = $el.find('p, span, [data-e2e="search-video-desc"]').first().text().trim();
        if (!title) return;
        hits.push(this.scrapedHit(platform, peerNickname, title, now, hits.length));
      });
    } else if (selector === 'xiaohongshu') {
      $('section.note-item, a.cover, div.note-item').each((_, el) => {
        const $el = $(el);
        const title =
          $el.find('.title, .desc, .note-title, footer .desc').first().text().trim() ||
          $el.attr('title') ||
          $el.find('img').attr('alt') ||
          '';
        if (!title) return;
        hits.push({
          ...this.scrapedHit(platform, peerNickname, title, now, hits.length),
          coverUrl: $el.find('img').attr('src') || undefined,
        });
      });
    } else {
      $('h3, .result, .c-container').each((_, el) => {
        const title = $(el).text().trim();
        if (!title || title.length < 6) return;
        hits.push(this.scrapedHit(platform, peerNickname, title, now, hits.length));
      });
    }

    return hits.slice(0, 20);
  }

  private scrapedHit(platform: string, author: string, title: string, now: number, index: number): CrawledHit {
    return {
      platform,
      author,
      title,
      publishedAt: new Date(now - (index + 1) * 24 * 60 * 60 * 1000),
      playCount: 0,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      collectCount: 0,
    };
  }
}
