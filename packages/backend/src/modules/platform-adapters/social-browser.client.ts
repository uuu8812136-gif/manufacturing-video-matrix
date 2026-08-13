import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PlatformUserInfo } from './platform-adapter.interface';

export interface BrowserLoginStatus {
  status: 'waiting' | 'scanned' | 'security_verification' | 'saving' | 'confirmed' | 'failed' | 'expired';
  message?: string;
  platform?: string;
  accountId?: string;
  userInfo?: PlatformUserInfo;
  saved?: boolean;
  reloadVerified?: boolean;
  reloadResult?: Record<string, unknown>;
  qrImage?: string;
  qrVersion?: number;
  tokenHash?: string;
  qrHash?: string;
  generatedAt?: string;
  expiresIn?: number;
  officialStatus?: string;
  officialErrorCode?: string | number;
  evidence?: Record<string, unknown>;
  persistencePending?: boolean;
}

@Injectable()
export class SocialBrowserClient {
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (config.get<string>('SOCIAL_BROWSER_URL') || 'http://social-browser:8000').replace(/\/$/, '');
    this.internalKey = config.get<string>('SOCIAL_BROWSER_API_KEY')
      || config.get<string>('JWT_SECRET')
      || '';
    this.assertSafeInternalUrl();
  }

  isEnabled() {
    return ['1', 'true', 'yes', 'on'].includes(
      (this.config.get<string>('SOCIAL_BROWSER_ENABLED') || 'false').toLowerCase(),
    );
  }

  async startLogin(platform: string, accountId: string) {
    return this.request<{
      sessionId: string;
      platform: string;
      qrImage: string;
      expiresIn: number;
      qrVersion: number;
      tokenHash?: string;
      qrHash?: string;
      generatedAt?: string;
      evidence?: Record<string, unknown>;
    }>(
      'post', '/login/start', { platform, accountId }, 150_000,
    );
  }

  async loginStatus(sessionId: string) {
    // confirmed 后 social-browser 会关闭原会话，并以 storage_state 新开
    // 浏览器完成强认证 Cookie + 创作者接口复验；该过程可能超过默认 30 秒。
    return this.request<BrowserLoginStatus>(
      'get',
      `/login/${encodeURIComponent(sessionId)}/status`,
      undefined,
      180_000,
    );
  }

  async cancelLogin(sessionId: string) {
    return this.request<{ status: string }>('delete', `/login/${encodeURIComponent(sessionId)}`);
  }

  async checkAccount(platform: string, accountId: string, timeoutMs = 120_000) {
    return this.request<{ valid: boolean; transient?: boolean; reason?: string; userInfo?: BrowserLoginStatus['userInfo'] }>(
      'post', '/account/check', { platform, accountId }, timeoutMs,
    );
  }

  async deleteAccount(platform: string, accountId: string) {
    return this.request<{ deleted: boolean }>('delete', '/account', { platform, accountId });
  }

  async publishVideo(body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('post', '/publish/video', body, 10 * 60_000);
  }

  async publishImageText(body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('post', '/publish/image-text', body, 10 * 60_000);
  }

  private assertSafeInternalUrl() {
    let url: URL;
    try {
      url = new URL(this.baseUrl);
    } catch {
      throw new ServiceUnavailableException('SOCIAL_BROWSER_URL 格式不正确');
    }
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
      throw new ServiceUnavailableException('SOCIAL_BROWSER_URL 必须是无内嵌凭据的 HTTP/HTTPS URL');
    }
    const localHosts = new Set(['social-browser', 'localhost', '127.0.0.1', '::1']);
    if (url.protocol === 'http:' && !localHosts.has(url.hostname)) {
      throw new ServiceUnavailableException('HTTP SOCIAL_BROWSER_URL 只能指向本机或 Docker 内部 social-browser 服务');
    }
    if (this.internalKey.length < 32) {
      throw new ServiceUnavailableException('SOCIAL_BROWSER_API_KEY/JWT_SECRET 至少需要 32 位');
    }
  }

  private async request<T>(
    method: 'get' | 'post' | 'delete',
    path: string,
    data?: Record<string, unknown>,
    timeout = 30_000,
  ): Promise<T> {
    if (!this.isEnabled()) throw new ServiceUnavailableException('浏览器扫码服务未启用');
    try {
      const response = await axios.request<T>({
        method,
        url: `${this.baseUrl}${path}`,
        data,
        headers: { 'X-Internal-Key': this.internalKey, 'Content-Type': 'application/json' },
        timeout,
        maxRedirects: 0,
      });
      return response.data;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? (error.response?.data as { detail?: string } | undefined)?.detail || error.message
        : (error as Error).message;
      throw new ServiceUnavailableException(`浏览器扫码服务调用失败：${String(detail).slice(0, 500)}`);
    }
  }
}
