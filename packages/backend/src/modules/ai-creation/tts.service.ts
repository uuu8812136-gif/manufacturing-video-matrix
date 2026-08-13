import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';
import { MinioService } from '../system/minio.service';

export interface SynthesizeOptions {
  rate?: number;
  pitch?: number;
}

@Injectable()
export class TtsService {
  constructor(private minio: MinioService, private config: ConfigService) {}

  async synthesize(
    text: string,
    voice = 'alloy',
    options?: SynthesizeOptions,
  ): Promise<{ url: string; duration: number }> {
    const endpoint = this.config.get<string>('TTS_API_URL') || '';
    const apiKey = this.config.get<string>('TTS_API_KEY') || '';
    if (!endpoint || !apiKey) throw new ServiceUnavailableException('TTS_API_URL/TTS_API_KEY 未配置');
    const target = await prepareSafeExternalRequest(endpoint, { requireHttps: true });

    const style = (this.config.get<string>('TTS_API_STYLE') || 'openai').toLowerCase();
    const body = style === 'generic'
      ? {
          text,
          voice,
          rate: options?.rate ?? 0,
          pitch: options?.pitch ?? 0,
          format: 'mp3',
        }
      : {
          model: this.config.get<string>('TTS_MODEL') || 'gpt-4o-mini-tts',
          input: text,
          voice,
          response_format: 'mp3',
          speed: Math.min(4, Math.max(0.25, 1 + (options?.rate ?? 0))),
        };
    const response = await axios.post<ArrayBuffer>(target.url.toString(), body, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120_000,
      maxRedirects: 0,
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
      ...target.transport,
    });
    const buffer = Buffer.from(response.data);
    if (!buffer.length) throw new ServiceUnavailableException('TTS 服务未返回音频数据');

    const key = `ai-creation/tts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    await this.minio.upload(key, buffer, 'audio/mpeg');
    const duration = Math.round((buffer.length / 6000) * 1000) / 1000;
    return { url: this.minio.publicUrl(key), duration };
  }
}
