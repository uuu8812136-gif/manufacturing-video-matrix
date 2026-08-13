import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';
import {
  IPlatformAdapter,
  PlatformComment,
  PlatformMessage,
  PlatformStats,
  PublishResult,
} from './platform-adapter.interface';

type Credentials = { accessToken?: string; cookie?: string };
type ReplyParams = { accountCredentials: string; externalId: string; platformContentId?: string; text: string };

export class ConfiguredPlatformAdapter implements IPlatformAdapter {
  private readonly prefix: string;
  private readonly baseUrl: string;

  constructor(public platform: string, private config: ConfigService) {
    this.prefix = platform.toUpperCase().replace(/-/g, '_');
    this.baseUrl = (config.get<string>(`PLATFORM_${this.prefix}_GATEWAY_URL`) || '').replace(/\/$/, '');
    if (this.baseUrl) {
      let url: URL;
      try {
        url = new URL(this.baseUrl);
      } catch {
        throw new ServiceUnavailableException(`${this.platform} 平台网关 URL 格式不正确`);
      }
      if (url.protocol !== 'https:') {
        throw new ServiceUnavailableException(`${this.platform} 平台网关会携带账号凭据，PLATFORM_${this.prefix}_GATEWAY_URL 必须使用 HTTPS`);
      }
      if (url.username || url.password) {
        throw new ServiceUnavailableException(`${this.platform} 平台网关 URL 不允许内嵌用户名或密码`);
      }
    }
  }

  async publishVideo(params: Parameters<IPlatformAdapter['publishVideo']>[0]): Promise<PublishResult> {
    return this.publish('/publish/video', params, true);
  }

  async publishImageText(params: Parameters<IPlatformAdapter['publishImageText']>[0]): Promise<PublishResult> {
    return this.publish('/publish/image-text', params, true);
  }

  async fetchStats(accountCredentials: string): Promise<PlatformStats> {
    const data = await this.request('get', '/stats', accountCredentials);
    const metricKeys = [
      'playCount', 'play_count', 'readCount', 'read_count', 'fanCount', 'fan_count', 'followers',
      'likeCount', 'like_count', 'commentCount', 'comment_count', 'shareCount', 'share_count',
    ];
    if (!metricKeys.some((key) => Object.prototype.hasOwnProperty.call(data, key))) {
      throw new ServiceUnavailableException(`${this.platform} 网关统计响应缺少可验证指标`);
    }
    return {
      playCount: Number(data.playCount ?? data.play_count ?? 0),
      readCount: Number(data.readCount ?? data.read_count ?? 0),
      fanCount: this.optionalNonNegativeInt(data.fanCount, data.fan_count, data.followers),
      likeCount: Number(data.likeCount ?? data.like_count ?? 0),
      commentCount: Number(data.commentCount ?? data.comment_count ?? 0),
      shareCount: Number(data.shareCount ?? data.share_count ?? 0),
    };
  }

  async fetchComments(accountCredentials: string): Promise<PlatformComment[]> {
    const data = await this.request('get', '/comments', accountCredentials);
    const list = Array.isArray(data) ? data : data.list || data.items;
    if (!Array.isArray(list)) {
      throw new ServiceUnavailableException(`${this.platform} 网关评论响应必须包含 list/items 数组`);
    }
    return list.map((item: Record<string, unknown>) => ({
      externalId: String(item.externalId || item.external_id || item.id || ''),
      platformContentId: String(item.platformContentId || item.contentId || item.item_id || ''),
      userName: String(item.userName || item.nickname || item.user_name || ''),
      userAvatar: item.userAvatar || item.avatar ? String(item.userAvatar || item.avatar) : undefined,
      text: String(item.text || item.content || ''),
      createdAt: this.normalizeDate(item.createdAt || item.create_time),
    }));
  }

  async fetchMessages(accountCredentials: string): Promise<PlatformMessage[]> {
    const data = await this.request('get', '/messages', accountCredentials);
    const list = Array.isArray(data) ? data : data.list || data.items;
    if (!Array.isArray(list)) {
      throw new ServiceUnavailableException(`${this.platform} 网关私信响应必须包含 list/items 数组`);
    }
    return list.map((item: Record<string, unknown>) => ({
      externalId: String(item.externalId || item.external_id || item.id || ''),
      userName: String(item.userName || item.nickname || item.user_name || ''),
      text: String(item.text || item.content || ''),
      createdAt: this.normalizeDate(item.createdAt || item.create_time),
    }));
  }

  async replyComment(params: ReplyParams): Promise<PublishResult> {
    return this.publish('/reply/comment', params);
  }

  async replyMessage(params: ReplyParams): Promise<PublishResult> {
    return this.publish('/reply/message', params);
  }

  async checkLogin(accountCredentials: string): Promise<{ valid: boolean; reason?: string }> {
    const data = await this.request('get', '/account/check', accountCredentials);
    if (typeof data.valid !== 'boolean' && typeof data.success !== 'boolean') {
      throw new ServiceUnavailableException(`${this.platform} 网关账号检查响应缺少 valid/success 布尔值`);
    }
    return { valid: data.valid ?? data.success, reason: data.reason || data.message };
  }

  private async publish(path: string, params: { accountCredentials: string; [key: string]: unknown }, requireContentId = false) {
    const data = await this.request('post', path, params.accountCredentials, params);
    const platformContentId = String(data.platformContentId || data.contentId || data.itemId || data.id || '');
    const explicitFailure = data.success === false || Boolean(data.error);
    const success = !explicitFailure && (data.success === true || Boolean(platformContentId));
    if (!success && !explicitFailure) {
      throw new ServiceUnavailableException(`${this.platform} 网关响应无法确认操作成功`);
    }
    if (success && requireContentId && !platformContentId) {
      throw new ServiceUnavailableException(`${this.platform} 网关未返回平台内容 ID，未能确认发布成功`);
    }
    return {
      success,
      platformContentId,
      failReason: success ? undefined : String(data.message || data.error || '平台网关返回失败'),
    };
  }

  private async request(method: 'get' | 'post', path: string, accountCredentials: string, body?: Record<string, unknown>) {
    if (!this.baseUrl) throw new ServiceUnavailableException(`${this.platform} 未配置平台网关`);
    const url = `${this.baseUrl}${path}`;
    const target = await prepareSafeExternalRequest(url, { requireHttps: true });
    const credentials = this.parseCredentials(accountCredentials);
    const gatewayKey = this.config.get<string>(`PLATFORM_${this.prefix}_GATEWAY_KEY`) || '';
    try {
      const response = await axios.request({
        method,
        url: target.url.toString(),
        params: method === 'get' ? { platform: this.platform } : undefined,
        data: method === 'post' ? { ...body, accountCredentials: undefined, platform: this.platform } : undefined,
        headers: {
          'Content-Type': 'application/json',
          ...(gatewayKey ? { 'X-Api-Key': gatewayKey } : {}),
          ...(credentials.accessToken ? { Authorization: `Bearer ${credentials.accessToken}` } : {}),
          ...(credentials.cookie ? { Cookie: credentials.cookie } : {}),
        },
        timeout: 60_000,
        maxRedirects: 0,
        ...target.transport,
      });
      const raw = response.data ?? {};
      this.assertNoBusinessFailure(raw);
      if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
        return { ...raw, ...raw.data };
      }
      return raw.data ?? raw;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : (error as Error).message;
      throw new ServiceUnavailableException(`${this.platform} 网关调用失败：${detail}`);
    }
  }

  private assertNoBusinessFailure(raw: any) {
    const layers = [raw, raw?.data, raw?.result]
      .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
    const successCodes = [0, '0', 1, '1', 200, '200', 'OK', 'ok', 'SUCCESS', 'success'];
    for (const layer of layers) {
      const status = String(layer.status || '').toLowerCase();
      const code = layer.errorCode ?? layer.code ?? layer.errcode;
      if (layer.success === false || layer.error
        || ['failed', 'failure', 'error', 'rejected'].includes(status)
        || (code !== undefined && !successCodes.includes(code))) {
        const detail = layer.reason || layer.message || layer.error || `code=${String(code ?? status)}`;
        throw new ServiceUnavailableException(`${this.platform} 网关返回业务失败：${String(detail)}`);
      }
    }
  }

  private parseCredentials(raw: string): Credentials {
    try {
      const value = JSON.parse(raw);
      return {
        accessToken: value.access_token || value.accessToken || value.token,
        cookie: value.cookie || value.cookies,
      };
    } catch {
      return raw.includes('=') && raw.includes(';') ? { cookie: raw } : { accessToken: raw };
    }
  }

  private normalizeDate(value: unknown) {
    if (typeof value === 'number' || /^\d+$/.test(String(value || ''))) {
      const numeric = Number(value);
      return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
    }
    const date = new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  private optionalNonNegativeInt(...values: unknown[]): number | undefined {
    for (const value of values) {
      let numeric: number;
      if (typeof value === 'number') {
        numeric = value;
      } else if (typeof value === 'string') {
        const normalized = value.trim().replace(/[,_\s]/g, '');
        if (!/^\+?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) continue;
        numeric = Number(normalized);
      } else {
        continue;
      }
      if (!Number.isFinite(numeric) || numeric < 0) continue;
      const integer = Math.trunc(numeric);
      if (Number.isSafeInteger(integer) && integer <= 2_147_483_647) return integer;
    }
    return undefined;
  }
}
