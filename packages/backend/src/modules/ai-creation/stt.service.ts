import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import {
  downloadExternalBuffer,
  prepareSafeExternalRequest,
  SafeExternalTransport,
} from '../../common/utils/external-url.util';
import { MinioService } from '../system/minio.service';

@Injectable()
export class SttService {
  constructor(private minio: MinioService, private config: ConfigService) {}

  async extractText(videoUrl: string): Promise<{ text: string }> {
    const endpoint = this.config.get<string>('STT_API_URL') || '';
    const apiKey = this.config.get<string>('STT_API_KEY') || '';
    if (!endpoint || !apiKey) {
      throw new ServiceUnavailableException('STT_API_URL/STT_API_KEY 未配置');
    }
    const target = await prepareSafeExternalRequest(endpoint, { requireHttps: true });

    const tmpFiles: string[] = [];
    let chunkPrefix = '';
    try {
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const input = join(tmpdir(), `stt_in_${stamp}.mp4`);
      chunkPrefix = `stt_chunk_${stamp}_`;
      const chunkPattern = join(tmpdir(), `${chunkPrefix}%03d.mp3`);
      const buffer = await this.minio.downloadSignedPublicUrl(videoUrl) || await downloadExternalBuffer(videoUrl);
      writeFileSync(input, buffer);
      tmpFiles.push(input);

      if (ffmpegInstaller?.path && existsSync(ffmpegInstaller.path)) {
        ffmpeg.setFfmpegPath(ffmpegInstaller.path);
      }

      const bitrateKbps = this.numberConfig('STT_AUDIO_BITRATE_KBPS', 32, 16, 128);
      const maxUploadBytes = this.numberConfig('STT_MAX_UPLOAD_MB', 24, 1, 24) * 1024 * 1024;
      const requestedChunkSeconds = this.numberConfig('STT_CHUNK_SECONDS', 1200, 60, 21600);
      const safeChunkSeconds = Math.max(
        60,
        Math.floor((maxUploadBytes * 8 * 0.8) / (bitrateKbps * 1000)),
      );
      const chunkSeconds = Math.min(requestedChunkSeconds, safeChunkSeconds);
      const chunks = await this.transcodeToChunks(input, chunkPattern, chunkPrefix, bitrateKbps, chunkSeconds);
      tmpFiles.push(...chunks);

      const model = this.config.get<string>('STT_MODEL') || 'whisper-1';
      const language = this.config.get<string>('STT_LANGUAGE') || 'zh';
      const transcripts: string[] = [];
      for (const chunk of chunks) {
        const chunkBuffer = readFileSync(chunk);
        if (chunkBuffer.length > maxUploadBytes) {
          throw new ServiceUnavailableException(
            `STT 音频分片超过上传限制（${Math.ceil(chunkBuffer.length / 1024 / 1024)} MB）`,
          );
        }
        const previousContext = model.includes('diarize') ? '' : (transcripts.at(-1) || '').slice(-1000);
        const text = await this.transcribeChunk(
          target.url.toString(),
          apiKey,
          model,
          language,
          chunkBuffer,
          maxUploadBytes,
          previousContext,
          target.transport,
        );
        if (text) transcripts.push(text);
      }

      const text = transcripts.join('\n').trim();
      if (!text) throw new ServiceUnavailableException('STT 服务未返回识别文本');
      return { text };
    } finally {
      const partialChunks = chunkPrefix
        ? this.findChunkFiles(chunkPrefix)
        : [];
      for (const file of new Set([...tmpFiles, ...partialChunks])) {
        try {
          unlinkSync(file);
        } catch {
          // 忽略临时文件清理失败
        }
      }
    }
  }

  private async transcodeToChunks(
    input: string,
    outputPattern: string,
    chunkPrefix: string,
    bitrateKbps: number,
    chunkSeconds: number,
  ): Promise<string[]> {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate(bitrateKbps)
        .audioChannels(1)
        .audioFrequency(16000)
        .outputOptions([
          '-f segment',
          `-segment_time ${chunkSeconds}`,
          '-reset_timestamps 1',
        ])
        .output(outputPattern)
        .on('end', () => resolve())
        .on('error', (error: Error) => reject(error))
        .run();
    });
    const chunks = this.findChunkFiles(chunkPrefix);
    if (chunks.length === 0) throw new ServiceUnavailableException('未能从视频中提取音频');
    return chunks;
  }

  private findChunkFiles(chunkPrefix: string): string[] {
    try {
      return readdirSync(tmpdir())
        .filter((name) => name.startsWith(chunkPrefix) && name.endsWith('.mp3'))
        .sort()
        .map((name) => join(tmpdir(), name));
    } catch {
      return [];
    }
  }

  private async transcribeChunk(
    endpoint: string,
    apiKey: string,
    model: string,
    language: string,
    audio: Buffer,
    maxUploadBytes: number,
    previousContext: string,
    transport: SafeExternalTransport,
  ): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', model);
    form.append('language', language);
    form.append('response_format', 'json');
    if (previousContext) form.append('prompt', previousContext);

    const response = await axios.post(endpoint, form, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 120_000,
      maxRedirects: 0,
      maxBodyLength: maxUploadBytes + 1024 * 1024,
      maxContentLength: 5 * 1024 * 1024,
      ...transport,
    });
    if (typeof response.data === 'string') return response.data.trim();
    return String(response.data?.text || response.data?.transcript || '').trim();
  }

  private numberConfig(name: string, fallback: number, min: number, max: number): number {
    const configured = Number(this.config.get<string | number>(name));
    if (!Number.isFinite(configured)) return fallback;
    return Math.min(max, Math.max(min, configured));
  }
}
