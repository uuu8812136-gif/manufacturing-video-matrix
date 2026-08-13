import { BadRequestException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { prepareSafeExternalRequest } from '../../../common/utils/external-url.util';
import { MinioService } from '../../system/minio.service';
import {
  IPlatformAdapter,
  PlatformComment,
  PlatformMessage,
  PlatformStats,
  PublishResult,
} from '../platform-adapter.interface';
import { bufferBlob, ensureJpeg, loadPlatformMedia } from '../platform-media.util';

type KuaishouCredentials = { accessToken: string; scopes: string[] };

const MIB = 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * MIB;
const MAX_COVER_BYTES = 10 * MIB;
const PART_SIZE = 10 * MIB;
const BASE_URL = 'https://open.kuaishou.com';

@Injectable()
export class KuaishouAdapter implements IPlatformAdapter {
  constructor(public platform: string, private config: ConfigService, private minio: MinioService) {}

  private get key() {
    return this.config.get<string>('PLATFORM_KUAISHOU_KEY') || '';
  }

  async publishVideo(params: Parameters<IPlatformAdapter['publishVideo']>[0]): Promise<PublishResult> {
    const credentials = this.requireCredentials(params.accountCredentials);
    this.requireScope(credentials, 'user_video_publish');
    if (!params.coverUrl) throw new BadRequestException('快手发布视频必须提供封面图');
    const caption = this.buildCaption(params.title, params.tags);
    const [video, sourceCover] = await Promise.all([
      loadPlatformMedia(this.minio, params.videoUrl, 'video', MAX_VIDEO_BYTES),
      loadPlatformMedia(this.minio, params.coverUrl, 'image', MAX_COVER_BYTES),
    ]);
    const cover = await ensureJpeg(sourceCover, MAX_COVER_BYTES);

    try {
      const start = await axios.post(`${BASE_URL}/openapi/photo/start_upload`, undefined, {
        params: { app_id: this.key, access_token: credentials.accessToken },
        timeout: 30_000,
        maxRedirects: 0,
      });
      this.assertSuccess(start.data, '发起上传');
      const uploadToken = String(start.data?.upload_token || start.data?.data?.upload_token || '');
      const endpoint = String(start.data?.endpoint || start.data?.data?.endpoint || '');
      if (!uploadToken || !endpoint) throw new ServiceUnavailableException('快手未返回 upload_token/endpoint');

      const uploadTarget = await this.resolveUploadEndpoint(endpoint);
      const uploadBase = uploadTarget.url.toString().replace(/\/$/, '');
      if (video.buffer.length <= PART_SIZE) {
        const upload = await axios.post(`${uploadBase}/api/upload`, video.buffer, {
          params: { upload_token: uploadToken },
          headers: { 'Content-Type': video.contentType },
          timeout: 120_000,
          maxBodyLength: PART_SIZE,
          maxRedirects: 0,
          ...uploadTarget.transport,
        });
        this.assertSuccess(upload.data, '上传视频');
      } else {
        const fragmentCount = Math.ceil(video.buffer.length / PART_SIZE);
        for (let fragmentId = 0; fragmentId < fragmentCount; fragmentId++) {
          const startOffset = fragmentId * PART_SIZE;
          const chunk = video.buffer.subarray(startOffset, Math.min(startOffset + PART_SIZE, video.buffer.length));
          const fragment = await axios.post(`${uploadBase}/api/upload/fragment`, chunk, {
            params: { upload_token: uploadToken, fragment_id: fragmentId },
            headers: { 'Content-Type': video.contentType },
            timeout: 120_000,
            maxBodyLength: PART_SIZE,
            maxRedirects: 0,
            ...uploadTarget.transport,
          });
          this.assertSuccess(fragment.data, `上传第 ${fragmentId} 个分片`);
        }
        const complete = await axios.post(`${uploadBase}/api/upload/complete`, undefined, {
          params: { upload_token: uploadToken, fragment_count: fragmentCount },
          timeout: 60_000,
          maxRedirects: 0,
          ...uploadTarget.transport,
        });
        this.assertSuccess(complete.data, '完成分片上传');
      }

      const form = new FormData();
      form.append('cover', bufferBlob(cover.buffer, cover.contentType), cover.filename);
      form.append('caption', caption);
      const publish = await axios.post(`${BASE_URL}/openapi/photo/publish`, form, {
        params: { app_id: this.key, access_token: credentials.accessToken, upload_token: uploadToken },
        timeout: 60_000,
        maxBodyLength: MAX_COVER_BYTES + MIB,
        maxRedirects: 0,
      });
      this.assertSuccess(publish.data, '发布视频');
      const photoId = publish.data?.video_info?.photo_id || publish.data?.data?.video_info?.photo_id;
      if (!photoId) throw new ServiceUnavailableException('快手未返回 photo_id，不能确认已接受发布');
      return { success: true, platformContentId: String(photoId) };
    } catch (error) {
      throw this.normalizeError(error, '发布视频');
    }
  }

  async publishImageText(): Promise<PublishResult> {
    return this.unsupported('图文发布');
  }

  async fetchStats(): Promise<PlatformStats> {
    return this.unsupported('账号统计');
  }

  async fetchComments(): Promise<PlatformComment[]> {
    return this.unsupported('评论拉取');
  }

  async fetchMessages(): Promise<PlatformMessage[]> {
    return this.unsupported('私信拉取');
  }

  async checkLogin(accountCredentials: string): Promise<{ valid: boolean; reason?: string }> {
    const credentials = this.requireCredentials(accountCredentials);
    if (!credentials.scopes.includes('user_video_publish')) {
      return { valid: false, reason: '授权凭据未记录 user_video_publish 发布权限，请重新完成 OAuth 授权' };
    }
    try {
      const response = await axios.get(`${BASE_URL}/openapi/user_info`, {
        params: { app_id: this.key, access_token: credentials.accessToken },
        timeout: 15_000,
        maxRedirects: 0,
      });
      if (Number(response.data?.result) !== 1) {
        return { valid: false, reason: String(response.data?.error_msg || `result=${response.data?.result}`) };
      }
      if (!response.data?.user_info) return { valid: false, reason: '快手未返回 user_info' };
      return { valid: true };
    } catch (error) {
      throw this.normalizeError(error, '校验账号');
    }
  }

  private requireCredentials(raw: string): KuaishouCredentials {
    if (!this.key) throw new ServiceUnavailableException('未配置 PLATFORM_KUAISHOU_KEY');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = { access_token: raw };
    }
    const accessToken = String(parsed.access_token || parsed.accessToken || '');
    const rawScopes = parsed.scopes || parsed.scope || [];
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.map(String)
      : String(rawScopes).split(/[ ,]+/).filter(Boolean);
    if (!accessToken) throw new BadRequestException('快手账号凭据缺少 access_token');
    return { accessToken, scopes };
  }

  private requireScope(credentials: KuaishouCredentials, scope: string) {
    if (!credentials.scopes.includes(scope)) {
      throw new ServiceUnavailableException(`快手账号未授权 ${scope}，请在应用审核通过后重新授权`);
    }
  }

  private async resolveUploadEndpoint(endpoint: string) {
    let url: URL;
    try {
      url = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`);
    } catch {
      throw new ServiceUnavailableException('快手返回的上传 endpoint 不合法');
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return prepareSafeExternalRequest(url.toString(), { requireHttps: true });
  }

  private assertSuccess(payload: Record<string, unknown>, operation: string) {
    if (Number(payload?.result) !== 1) {
      const nested = payload?.data as Record<string, unknown> | undefined;
      const detail = payload?.error_msg || payload?.message || nested?.error_msg || '未知错误';
      throw new ServiceUnavailableException(`快手${operation}失败：${String(detail)} (result=${String(payload?.result)})`);
    }
  }

  private buildCaption(title: string, tags?: string[]) {
    const caption = `${title}${(tags || []).map((tag) => ` #${tag.replace(/^#+/, '')}`).join('')}`.trim();
    if (!caption) throw new BadRequestException('快手视频标题不能为空');
    return caption;
  }

  private normalizeError(error: unknown, operation: string): HttpException {
    if (error instanceof HttpException) return error;
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as Record<string, unknown> | undefined;
      const detail = payload?.error_msg || payload?.message || error.message;
      return new ServiceUnavailableException(`快手${operation}请求失败：${String(detail)}`);
    }
    return new ServiceUnavailableException(`快手${operation}失败：${(error as Error).message}`);
  }

  private unsupported<T>(operation: string): T {
    throw new ServiceUnavailableException(
      `快手直连仅启用已验证的视频投稿与账号校验；${operation}需配置 PLATFORM_KUAISHOU_GATEWAY_URL`,
    );
  }
}
