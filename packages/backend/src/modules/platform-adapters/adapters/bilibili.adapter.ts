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
import { bufferBlob, loadPlatformMedia } from '../platform-media.util';

const MIB = 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * MIB;
const MAX_COVER_BYTES = 10 * MIB;
const PART_SIZE = 8 * MIB;
const URL_VIDEO_INIT = 'https://member.bilibili.com/arcopen/fn/archive/video/init';
const URL_VIDEO_UPLOAD = 'https://openupos.bilivideo.com/video/v2/part/upload';
const URL_VIDEO_COMPLETE = 'https://member.bilibili.com/arcopen/fn/archive/video/complete';
const URL_COVER_UPLOAD = 'https://member.bilibili.com/arcopen/fn/archive/cover/upload';
const URL_ARCHIVE_SUBMIT = 'https://member.bilibili.com/arcopen/fn/archive/add-by-utoken';
const URL_TYPE_LIST = 'https://member.bilibili.com/arcopen/fn/archive/type/list';

@Injectable()
export class BilibiliAdapter implements IPlatformAdapter {
  constructor(public platform: string, private config: ConfigService, private minio: MinioService) {}

  private get key() {
    return this.config.get<string>('PLATFORM_BILIBILI_KEY') || '';
  }

  async publishVideo(params: Parameters<IPlatformAdapter['publishVideo']>[0]): Promise<PublishResult> {
    const accessToken = this.requireAccessToken(params.accountCredentials);
    const tid = Number(this.config.get<string>('PLATFORM_BILIBILI_TID'));
    if (!Number.isInteger(tid) || tid <= 0) {
      throw new ServiceUnavailableException('未配置有效的 PLATFORM_BILIBILI_TID，请先通过官方分区列表选择稿件分区');
    }
    if (!params.coverUrl) throw new BadRequestException('B站投稿必须提供封面图');
    if (!params.title.trim()) throw new BadRequestException('B站稿件标题不能为空');
    const [video, cover] = await Promise.all([
      loadPlatformMedia(this.minio, params.videoUrl, 'video', MAX_VIDEO_BYTES),
      loadPlatformMedia(this.minio, params.coverUrl, 'image', MAX_COVER_BYTES),
    ]);

    try {
      const init = await axios.post(URL_VIDEO_INIT, { name: video.filename }, {
        params: { client_id: this.key, access_token: accessToken },
        headers: { 'Content-Type': 'application/json' },
        timeout: 30_000,
        maxRedirects: 0,
      });
      this.assertSuccess(init.data, '初始化视频上传');
      const uploadToken = String(init.data?.data?.upload_token || '');
      if (!uploadToken) throw new ServiceUnavailableException('B站未返回 upload_token');

      for (let offset = 0, partNumber = 1; offset < video.buffer.length; offset += PART_SIZE, partNumber++) {
        const chunk = video.buffer.subarray(offset, Math.min(offset + PART_SIZE, video.buffer.length));
        const upload = await axios.post(URL_VIDEO_UPLOAD, chunk, {
          params: { upload_token: uploadToken, part_number: partNumber },
          headers: { 'Content-Type': 'application/octet-stream' },
          timeout: 120_000,
          maxBodyLength: PART_SIZE,
          maxRedirects: 0,
        });
        this.assertSuccess(upload.data, `上传第 ${partNumber} 个视频分片`);
      }

      const complete = await axios.post(URL_VIDEO_COMPLETE, {}, {
        params: { upload_token: uploadToken },
        headers: { 'Content-Type': 'application/json' },
        timeout: 60_000,
        maxRedirects: 0,
      });
      this.assertSuccess(complete.data, '合并视频分片');

      const coverForm = new FormData();
      coverForm.append('file', bufferBlob(cover.buffer, cover.contentType), cover.filename);
      const coverUpload = await axios.post(URL_COVER_UPLOAD, coverForm, {
        params: { client_id: this.key, access_token: accessToken },
        timeout: 60_000,
        maxBodyLength: MAX_COVER_BYTES + MIB,
        maxRedirects: 0,
      });
      this.assertSuccess(coverUpload.data, '上传封面');
      const coverUrl = String(coverUpload.data?.data?.url || '');
      if (!coverUrl) throw new ServiceUnavailableException('B站未返回封面 URL');

      const submit = await axios.post(
        URL_ARCHIVE_SUBMIT,
        {
          title: params.title.trim(),
          cover: coverUrl,
          tid,
          no_reprint: 1,
          desc: params.title.trim(),
          tag: (params.tags || []).join(','),
          copyright: 1,
          source: '',
        },
        {
          params: { client_id: this.key, access_token: accessToken, upload_token: uploadToken },
          headers: { 'Content-Type': 'application/json' },
          timeout: 60_000,
          maxRedirects: 0,
        },
      );
      this.assertSuccess(submit.data, '提交稿件');
      const resourceId = submit.data?.data?.resource_id;
      if (!resourceId) throw new ServiceUnavailableException('B站未返回 resource_id，不能确认稿件已接受');
      return { success: true, platformContentId: String(resourceId) };
    } catch (error) {
      throw this.normalizeError(error, '发布视频');
    }
  }

  async publishImageText(): Promise<PublishResult> {
    return this.unsupported('专栏/图文发布');
  }

  async fetchStats(): Promise<PlatformStats> {
    return this.unsupported('稿件统计');
  }

  async fetchComments(): Promise<PlatformComment[]> {
    return this.unsupported('评论拉取');
  }

  async fetchMessages(): Promise<PlatformMessage[]> {
    return this.unsupported('私信拉取');
  }

  async checkLogin(accountCredentials: string): Promise<{ valid: boolean; reason?: string }> {
    const accessToken = this.requireAccessToken(accountCredentials);
    try {
      const response = await axios.get(URL_TYPE_LIST, {
        params: { client_id: this.key, access_token: accessToken },
        timeout: 15_000,
        maxRedirects: 0,
      });
      if (Number(response.data?.code) !== 0) {
        return { valid: false, reason: String(response.data?.message || `code=${response.data?.code}`) };
      }
      if (!response.data?.data) return { valid: false, reason: 'B站未返回稿件分区数据，无法确认投稿权限' };
      return { valid: true };
    } catch (error) {
      throw this.normalizeError(error, '校验投稿权限');
    }
  }

  private requireAccessToken(raw: string) {
    if (!this.key) throw new ServiceUnavailableException('未配置 PLATFORM_BILIBILI_KEY');
    let accessToken = raw;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      accessToken = String(parsed.access_token || parsed.accessToken || '');
    } catch {
      // 兼容历史上直接存储 access_token 的账号。
    }
    if (!accessToken) throw new BadRequestException('B站账号凭据缺少 access_token');
    return accessToken;
  }

  private assertSuccess(payload: Record<string, unknown>, operation: string) {
    if (Number(payload?.code) !== 0) {
      throw new ServiceUnavailableException(
        `B站${operation}失败：${String(payload?.message || '未知错误')} (code=${String(payload?.code)})`,
      );
    }
  }

  private normalizeError(error: unknown, operation: string): HttpException {
    if (error instanceof HttpException) return error;
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as Record<string, unknown> | undefined;
      const detail = payload?.message || error.message;
      return new ServiceUnavailableException(`B站${operation}请求失败：${String(detail)}`);
    }
    return new ServiceUnavailableException(`B站${operation}失败：${(error as Error).message}`);
  }

  private unsupported<T>(operation: string): T {
    throw new ServiceUnavailableException(
      `B站直连仅启用官方视频投稿与投稿权限校验；${operation}需配置 PLATFORM_BILIBILI_GATEWAY_URL`,
    );
  }
}
