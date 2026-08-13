import { BadRequestException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MinioService } from '../../system/minio.service';
import {
  IPlatformAdapter,
  PlatformComment,
  PlatformMessage,
  PlatformStats,
  PublishResult,
} from '../platform-adapter.interface';
import { bufferBlob, loadPlatformMedia, PlatformMediaAsset } from '../platform-media.util';

type DouyinCredentials = { accessToken: string; openId: string; scopes: string[] };

const MIB = 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * MIB;
const PART_UPLOAD_THRESHOLD = 50 * MIB;
const PART_SIZE = 20 * MIB;
const BASE_URL = 'https://open.douyin.com';

@Injectable()
export class DouyinAdapter implements IPlatformAdapter {
  constructor(public platform: string, private config: ConfigService, private minio: MinioService) {}

  private get key() {
    return this.config.get<string>('PLATFORM_DOUYIN_KEY') || '';
  }

  async publishVideo(params: Parameters<IPlatformAdapter['publishVideo']>[0]): Promise<PublishResult> {
    const credentials = this.requireCredentials(params.accountCredentials, true);
    this.requireScope(credentials, 'video.create.bind');
    const text = this.buildText(params.title, params.tags);
    const media = await loadPlatformMedia(this.minio, params.videoUrl, 'video', MAX_VIDEO_BYTES);

    try {
      const videoId = media.buffer.length > PART_UPLOAD_THRESHOLD
        ? await this.uploadParts(media, credentials)
        : await this.uploadSingle(media, credentials);
      const response = await axios.post(
        `${BASE_URL}/api/douyin/v1/video/create_video/`,
        { video_id: videoId, text },
        {
          params: { open_id: credentials.openId },
          headers: { 'access-token': credentials.accessToken, 'Content-Type': 'application/json' },
          timeout: 60_000,
          maxRedirects: 0,
        },
      );
      this.assertSuccess(response.data, '创建视频');
      const itemId = response.data?.data?.item_id;
      if (!itemId) throw new ServiceUnavailableException('抖音已接受请求，但未返回 item_id，不能确认发布成功');
      return { success: true, platformContentId: String(itemId) };
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
    const credentials = this.requireCredentials(accountCredentials, true);
    if (!credentials.scopes.includes('video.create.bind')) {
      return { valid: false, reason: '授权凭据未记录 video.create.bind 发布权限，请重新完成 OAuth 授权' };
    }
    try {
      const response = await axios.get(`${BASE_URL}/oauth/userinfo/`, {
        params: { access_token: credentials.accessToken, open_id: credentials.openId },
        timeout: 15_000,
        maxRedirects: 0,
      });
      const data = response.data?.data || response.data || {};
      const errorCode = Number(data.error_code ?? response.data?.extra?.error_code ?? 0);
      if (errorCode !== 0) {
        return { valid: false, reason: String(data.description || response.data?.message || `error_code=${errorCode}`) };
      }
      if (!data.open_id) return { valid: false, reason: '抖音未返回授权用户 open_id' };
      if (String(data.open_id) !== credentials.openId) return { valid: false, reason: '抖音 token 与 open_id 不匹配' };
      return { valid: true };
    } catch (error) {
      throw this.normalizeError(error, '校验账号');
    }
  }

  private async uploadSingle(media: PlatformMediaAsset, credentials: DouyinCredentials) {
    const form = new FormData();
    form.append('video', bufferBlob(media.buffer, media.contentType), media.filename);
    const response = await axios.post(`${BASE_URL}/api/douyin/v1/video/upload_video/`, form, {
      params: { open_id: credentials.openId },
      headers: { 'access-token': credentials.accessToken },
      timeout: 120_000,
      maxBodyLength: MAX_VIDEO_BYTES,
      maxRedirects: 0,
    });
    this.assertSuccess(response.data, '上传视频');
    const videoId = response.data?.data?.video?.video_id;
    if (!videoId) throw new ServiceUnavailableException('抖音上传未返回 video_id');
    return String(videoId);
  }

  private async uploadParts(media: PlatformMediaAsset, credentials: DouyinCredentials) {
    const headers = { 'access-token': credentials.accessToken };
    const init = await axios.post(`${BASE_URL}/api/douyin/v1/video/init_video_part_upload/`, {}, {
      params: { open_id: credentials.openId },
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 30_000,
      maxRedirects: 0,
    });
    this.assertSuccess(init.data, '初始化分片上传');
    const uploadId = init.data?.data?.upload_id;
    if (!uploadId) throw new ServiceUnavailableException('抖音未返回 upload_id');

    for (let offset = 0, partNumber = 1; offset < media.buffer.length; offset += PART_SIZE, partNumber++) {
      const chunk = media.buffer.subarray(offset, Math.min(offset + PART_SIZE, media.buffer.length));
      const form = new FormData();
      form.append('video', bufferBlob(chunk, media.contentType), `part-${partNumber}.mp4`);
      const part = await axios.post(`${BASE_URL}/api/douyin/v1/video/upload_video_part/`, form, {
        params: { open_id: credentials.openId, upload_id: uploadId, part_number: partNumber },
        headers,
        timeout: 120_000,
        maxBodyLength: PART_SIZE + MIB,
        maxRedirects: 0,
      });
      this.assertSuccess(part.data, `上传第 ${partNumber} 个分片`);
    }

    const complete = await axios.post(`${BASE_URL}/api/douyin/v1/video/complete_video_part_upload/`, {}, {
      params: { open_id: credentials.openId, upload_id: uploadId },
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 60_000,
      maxRedirects: 0,
    });
    this.assertSuccess(complete.data, '完成分片上传');
    const videoId = complete.data?.data?.video?.video_id;
    if (!videoId) throw new ServiceUnavailableException('抖音合片未返回 video_id');
    return String(videoId);
  }

  private requireCredentials(raw: string, requireOpenId: boolean): DouyinCredentials {
    if (!this.key) throw new ServiceUnavailableException('未配置 PLATFORM_DOUYIN_KEY');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = { access_token: raw };
    }
    const accessToken = String(parsed.access_token || parsed.accessToken || '');
    const openId = String(parsed.open_id || parsed.openId || '');
    const rawScopes = parsed.scopes || parsed.scope || [];
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.map(String)
      : String(rawScopes).split(/[ ,]+/).filter(Boolean);
    if (!accessToken) throw new BadRequestException('抖音账号凭据缺少 access_token');
    if (requireOpenId && !openId) {
      throw new BadRequestException('抖音账号凭据缺少 open_id，请重新完成 OAuth 授权');
    }
    return { accessToken, openId, scopes };
  }

  private requireScope(credentials: DouyinCredentials, scope: string) {
    if (!credentials.scopes.includes(scope)) {
      throw new ServiceUnavailableException(`抖音账号未授权 ${scope}，请在能力实验室通过审核后重新授权`);
    }
  }

  private buildText(title: string, tags?: string[]) {
    const suffix = (tags || []).map((tag) => ` #${tag.replace(/^#+/, '')}`).join('');
    const text = `${title}${suffix}`.trim();
    if (!text) throw new BadRequestException('抖音视频标题不能为空');
    if (text.length > 1000) throw new BadRequestException('抖音视频标题不能超过 1000 字');
    return text;
  }

  private assertSuccess(payload: Record<string, any>, operation: string) {
    const data = payload?.data || {};
    const errorCode = Number(data.error_code ?? payload?.extra?.error_code ?? 0);
    if (errorCode !== 0) {
      const description = data.description || payload?.extra?.description || payload?.message || '未知错误';
      throw new ServiceUnavailableException(`抖音${operation}失败：${description} (error_code=${errorCode})`);
    }
  }

  private normalizeError(error: unknown, operation: string): HttpException {
    if (error instanceof HttpException) return error;
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as Record<string, any> | undefined;
      const detail = payload?.data?.description || payload?.extra?.description || payload?.message || error.message;
      return new ServiceUnavailableException(`抖音${operation}请求失败：${detail}`);
    }
    return new ServiceUnavailableException(`抖音${operation}失败：${(error as Error).message}`);
  }

  private unsupported<T>(operation: string): T {
    throw new ServiceUnavailableException(
      `抖音直连仅启用已验证的视频投稿与账号校验；${operation}需配置 PLATFORM_DOUYIN_GATEWAY_URL`,
    );
  }
}
