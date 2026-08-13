import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';
import { runtimeMode } from '../../config/runtime-mode';

export interface DigitalHumanGenerateOptions {
  avatarKey?: string;
  voiceKey?: string;
  background?: string;
}

export interface DigitalHumanGenerateResult {
  videoUrl: string;
  taskId?: string;
}

export interface DigitalHumanPollResult {
  status: string;
  videoUrl?: string;
  error?: string;
}

export interface IDigitalHumanProvider {
  generate(script: string, options: DigitalHumanGenerateOptions): Promise<DigitalHumanGenerateResult>;
  pollStatus(taskId: string): Promise<DigitalHumanPollResult>;
}

export class MockDigitalHumanProvider implements IDigitalHumanProvider {
  async generate(script: string, _options: DigitalHumanGenerateOptions): Promise<DigitalHumanGenerateResult> {
    const taskId = `mock_dh_${Date.now()}`;
    const encoded = encodeURIComponent(script.slice(0, 20) || 'digital-human');
    return {
      taskId,
      videoUrl: `mock://digital-human/${taskId}.mp4?title=${encoded}`,
    };
  }

  async pollStatus(taskId: string): Promise<DigitalHumanPollResult> {
    return { status: 'done', videoUrl: `mock://digital-human/${taskId}.mp4` };
  }
}

export class HeyGenProvider implements IDigitalHumanProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl = 'https://api.heygen.com') {
    this.baseUrl = credentialBaseUrl(baseUrl, 'HEYGEN_BASE_URL');
  }

  async generate(script: string, options: DigitalHumanGenerateOptions): Promise<DigitalHumanGenerateResult> {
    if (!options.avatarKey || !options.voiceKey) throw new Error('HeyGen 需要 avatarKey 和 voiceKey');
    const background = this.toBackground(options.background);
    const target = await prepareSafeExternalRequest(`${this.baseUrl}/v3/videos`, { requireHttps: true });
    const resp = await axios.post(
      target.url.toString(),
      {
        type: 'avatar',
        avatar_id: options.avatarKey,
        script,
        voice_id: options.voiceKey,
        output_format: 'mp4',
        ...(background ? { background } : {}),
      },
      {
        headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
        timeout: 60000,
        maxRedirects: 0,
        ...target.transport,
      },
    );
    const taskId = resp.data?.data?.video_id;
    const videoUrl = resp.data?.data?.video_url || '';
    if (!taskId) throw new Error('HeyGen did not return taskId');
    return { videoUrl, taskId };
  }

  async pollStatus(taskId: string): Promise<DigitalHumanPollResult> {
    const target = await prepareSafeExternalRequest(
      `${this.baseUrl}/v3/videos/${encodeURIComponent(taskId)}`,
      { requireHttps: true },
    );
    const resp = await axios.get(target.url.toString(), {
      headers: { 'x-api-key': this.apiKey },
      timeout: 30000,
      maxRedirects: 0,
      ...target.transport,
    });
    const data = resp.data?.data || {};
    const providerStatus = String(data.status || '').toLowerCase();
    const videoUrl = typeof data.video_url === 'string' && data.video_url ? data.video_url : undefined;
    const error = data.failure_message || data.failure_code;
    if (providerStatus === 'completed' || providerStatus === 'complete' || (!providerStatus && videoUrl)) {
      return { status: 'done', videoUrl };
    }
    if (providerStatus === 'failed' || providerStatus === 'error' || providerStatus === 'cancelled') {
      return { status: 'failed', error: error ? String(error) : undefined };
    }
    return { status: 'processing' };
  }

  private toBackground(value?: string): { value?: string; url?: string; asset_id?: string } | undefined {
    const background = value?.trim();
    if (!background) return undefined;
    if (/^https:\/\//i.test(background)) return { url: background };
    if (/^asset(?:_id)?:/i.test(background)) {
      const assetId = background.replace(/^asset(?:_id)?:/i, '').trim();
      return assetId ? { asset_id: assetId } : undefined;
    }
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(background)) {
      return { value: background };
    }
    throw new Error('HeyGen 背景仅支持 HTTPS 图片 URL、asset:<素材ID> 或十六进制颜色');
  }
}

export class GuijiProvider implements IDigitalHumanProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {
    this.baseUrl = credentialBaseUrl(baseUrl, 'GUIJI_BASE_URL');
  }

  async generate(script: string, options: DigitalHumanGenerateOptions): Promise<DigitalHumanGenerateResult> {
    const target = await prepareSafeExternalRequest(
      `${this.baseUrl}/composite/v1/digital-human/video/generate`,
      { requireHttps: true },
    );
    const resp = await axios.post(
      target.url.toString(),
      {
        text: script,
        modelId: options.avatarKey,
        voiceId: options.voiceKey,
        background: options.background,
      },
      {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
        maxRedirects: 0,
        ...target.transport,
      },
    );
    const taskId = resp.data?.data?.taskId || resp.data?.taskId;
    const videoUrl = resp.data?.data?.videoUrl || resp.data?.videoUrl || '';
    if (!taskId) throw new Error('Guiji did not return taskId');
    return { videoUrl, taskId };
  }

  async pollStatus(taskId: string): Promise<DigitalHumanPollResult> {
    const target = await prepareSafeExternalRequest(
      `${this.baseUrl}/composite/v1/digital-human/video/status?taskId=${encodeURIComponent(taskId)}`,
      { requireHttps: true },
    );
    const resp = await axios.get(target.url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeout: 30000,
      maxRedirects: 0,
      ...target.transport,
    });
    const status = resp.data?.data?.status || resp.data?.status || 'processing';
    const videoUrl = resp.data?.data?.videoUrl || resp.data?.videoUrl;
    return { status: status === 'success' || status === 'done' ? 'done' : status, videoUrl };
  }
}

export class ZhiyingProvider implements IDigitalHumanProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {
    this.baseUrl = credentialBaseUrl(baseUrl, 'ZHIYING_BASE_URL');
  }

  async generate(script: string, options: DigitalHumanGenerateOptions): Promise<DigitalHumanGenerateResult> {
    const target = await prepareSafeExternalRequest(
      `${this.baseUrl}/v1/digitalhuman/video/generate`,
      { requireHttps: true },
    );
    const resp = await axios.post(
      target.url.toString(),
      {
        text: script,
        avatarId: options.avatarKey,
        voiceId: options.voiceKey,
        background: options.background,
      },
      {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
        maxRedirects: 0,
        ...target.transport,
      },
    );
    const taskId = resp.data?.taskId || resp.data?.data?.taskId;
    const videoUrl = resp.data?.videoUrl || resp.data?.data?.videoUrl || '';
    if (!taskId) throw new Error('Zhiying did not return taskId');
    return { videoUrl, taskId };
  }

  async pollStatus(taskId: string): Promise<DigitalHumanPollResult> {
    const target = await prepareSafeExternalRequest(
      `${this.baseUrl}/v1/digitalhuman/video/status?taskId=${encodeURIComponent(taskId)}`,
      { requireHttps: true },
    );
    const resp = await axios.get(target.url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeout: 30000,
      maxRedirects: 0,
      ...target.transport,
    });
    const status = resp.data?.status || resp.data?.data?.status || 'processing';
    const videoUrl = resp.data?.videoUrl || resp.data?.data?.videoUrl;
    return { status: status === 'success' || status === 'done' ? 'done' : status, videoUrl };
  }
}

@Injectable()
export class DigitalHumanProviderFactory {
  constructor(private readonly config: ConfigService) {}

  get(requestedProvider?: string): IDigitalHumanProvider {
    const mode = runtimeMode(this.config, 'DIGITAL_HUMAN_MODE');
    const provider = (requestedProvider || this.config.get<string>('DIGITAL_HUMAN_PROVIDER') || (mode === 'mock' ? 'mock' : 'heygen')).trim().toLowerCase();
    if (mode === 'mock') {
      return new MockDigitalHumanProvider();
    }

    if (provider === 'mock') throw new ServiceUnavailableException('DIGITAL_HUMAN_MODE=real，禁止使用 Mock 服务商');

    const key = this.config.get<string>(`${provider.toUpperCase()}_API_KEY`) || '';
    if (!key) {
      throw new ServiceUnavailableException(`未配置 ${provider.toUpperCase()}_API_KEY`);
    }

    switch (provider) {
      case 'heygen':
        return new HeyGenProvider(key, (this.config.get<string>('HEYGEN_BASE_URL') || 'https://api.heygen.com').replace(/\/$/, ''));
      case 'guiji':
        return new GuijiProvider(key, this.requiredBaseUrl('GUIJI_BASE_URL'));
      case 'zhiying':
        return new ZhiyingProvider(key, this.requiredBaseUrl('ZHIYING_BASE_URL'));
      default:
        throw new ServiceUnavailableException(`Unsupported digital human provider: ${provider}`);
    }
  }

  private requiredBaseUrl(name: string) {
    const value = (this.config.get<string>(name) || '').replace(/\/$/, '');
    if (!value) throw new ServiceUnavailableException(`未配置 ${name}`);
    return value;
  }
}

function credentialBaseUrl(raw: string, name: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new ServiceUnavailableException(`${name} 必须是不含内嵌凭据的 HTTPS URL`);
  }
}
