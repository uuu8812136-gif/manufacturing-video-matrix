import { ServiceUnavailableException } from '@nestjs/common';
import {
  IPlatformAdapter,
  PlatformComment,
  PlatformLoginOptions,
  PlatformLoginResult,
  PlatformMessage,
  PlatformStats,
  PublishResult,
} from './platform-adapter.interface';
import { SocialBrowserClient } from './social-browser.client';

interface BrowserCredential {
  kind: 'browser_session';
  account_ref: string;
}

const IMAGE_TEXT_PLATFORMS = new Set(['xiaohongshu']);

export class BrowserPlatformAdapter implements IPlatformAdapter {
  constructor(public readonly platform: string, private readonly browser: SocialBrowserClient) {}

  async publishVideo(params: Parameters<IPlatformAdapter['publishVideo']>[0]): Promise<PublishResult> {
    const result = await this.browser.publishVideo({
      platform: this.platform,
      accountId: this.accountRef(params.accountCredentials),
      videoUrl: params.videoUrl,
      title: params.title,
      coverUrl: params.coverUrl,
      tags: params.tags || [],
      attachType: params.attachType,
      attachValue: params.attachValue,
    });
    return this.publishResult(result);
  }

  async publishImageText(params: Parameters<IPlatformAdapter['publishImageText']>[0]): Promise<PublishResult> {
    if (!IMAGE_TEXT_PLATFORMS.has(this.platform)) {
      throw new ServiceUnavailableException(`${this.platform} 浏览器模式目前只支持视频发布`);
    }
    const result = await this.browser.publishImageText({
      platform: this.platform,
      accountId: this.accountRef(params.accountCredentials),
      images: params.images,
      title: params.title,
      body: params.body,
      tags: params.tags || [],
      attachType: params.attachType,
      attachValue: params.attachValue,
    });
    return this.publishResult(result);
  }

  async checkLogin(
    accountCredentials: string,
    options?: PlatformLoginOptions,
  ): Promise<PlatformLoginResult> {
    const accountRef = this.accountRef(accountCredentials);
    const result = options?.timeoutMs
      ? await this.browser.checkAccount(this.platform, accountRef, options.timeoutMs)
      : await this.browser.checkAccount(this.platform, accountRef);
    return {
      valid: result.valid,
      ...(result.transient ? { transient: true } : {}),
      reason: result.reason,
      userInfo: result.userInfo,
    };
  }

  async fetchStats(_accountCredentials: string): Promise<PlatformStats> {
    throw new ServiceUnavailableException(`${this.platform} 浏览器模式尚未接入账号统计`);
  }

  async fetchComments(_accountCredentials: string): Promise<PlatformComment[]> {
    throw new ServiceUnavailableException(`${this.platform} 浏览器模式尚未接入评论同步`);
  }

  async fetchMessages(_accountCredentials: string): Promise<PlatformMessage[]> {
    throw new ServiceUnavailableException(`${this.platform} 浏览器模式尚未接入私信同步`);
  }

  private accountRef(raw: string): string {
    try {
      const value = JSON.parse(raw) as BrowserCredential;
      if (
        value?.kind === 'browser_session'
        && typeof value.account_ref === 'string'
        && /^[A-Za-z0-9_-]{8,100}$/.test(value.account_ref)
      ) {
        return value.account_ref;
      }
    } catch {
      // handled below
    }
    throw new ServiceUnavailableException(`${this.platform} 浏览器账号凭据无效，请重新扫码`);
  }

  private publishResult(result: Record<string, unknown>): PublishResult {
    const success = result.success === true;
    return {
      success,
      platformContentId: result.platformContentId ? String(result.platformContentId) : undefined,
      failReason: success ? undefined : String(result.message || result.status || '浏览器发布失败'),
    };
  }
}
