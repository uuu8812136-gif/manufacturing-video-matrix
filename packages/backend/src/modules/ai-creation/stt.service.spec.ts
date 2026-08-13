import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SttService } from './stt.service';
import { MinioService } from '../system/minio.service';
import { downloadExternalBuffer, prepareSafeExternalRequest } from '../../common/utils/external-url.util';

jest.mock('axios');
jest.mock('../../common/utils/external-url.util', () => ({
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
  downloadExternalBuffer: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedPrepareSafeExternalRequest = prepareSafeExternalRequest as jest.MockedFunction<typeof prepareSafeExternalRequest>;
const mockedDownloadExternalBuffer = downloadExternalBuffer as jest.MockedFunction<typeof downloadExternalBuffer>;

describe('SttService', () => {
  const createdFiles: string[] = [];

  afterEach(() => {
    jest.clearAllMocks();
    for (const file of createdFiles.splice(0)) {
      try {
        unlinkSync(file);
      } catch {
        // 服务会主动清理临时文件。
      }
    }
  });

  function createService(values: Record<string, string> = {}) {
    const defaults: Record<string, string> = {
      STT_API_URL: 'https://api.openai.com/v1/audio/transcriptions',
      STT_API_KEY: 'stt-key',
      STT_MODEL: 'whisper-1',
      STT_LANGUAGE: 'zh',
    };
    const configValues = { ...defaults, ...values };
    const config = { get: (key: string) => configValues[key] } as unknown as ConfigService;
    const minio = {
      downloadSignedPublicUrl: jest.fn().mockResolvedValue(Buffer.from('video')),
    } as unknown as MinioService;
    return new SttService(minio, config);
  }

  function createChunk(name: string, content: Buffer | string) {
    const path = join(tmpdir(), `stt-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}.mp3`);
    writeFileSync(path, content);
    createdFiles.push(path);
    return path;
  }

  it('compresses into ordered chunks, transcribes each chunk and preserves context', async () => {
    const service = createService();
    const first = createChunk('001', 'audio-one');
    const second = createChunk('002', 'audio-two');
    jest.spyOn(service as any, 'transcodeToChunks').mockResolvedValue([first, second]);
    mockedAxios.post
      .mockResolvedValueOnce({ data: { text: '第一段内容' } })
      .mockResolvedValueOnce({ data: '第二段内容' });

    await expect(service.extractText('https://media.example.com/video.mp4')).resolves.toEqual({
      text: '第一段内容\n第二段内容',
    });

    expect(mockedPrepareSafeExternalRequest).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      { requireHttps: true },
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    const firstForm = mockedAxios.post.mock.calls[0][1] as FormData;
    const secondForm = mockedAxios.post.mock.calls[1][1] as FormData;
    expect(firstForm.get('model')).toBe('whisper-1');
    expect(firstForm.get('language')).toBe('zh');
    expect(firstForm.get('prompt')).toBeNull();
    expect(secondForm.get('prompt')).toBe('第一段内容');
    expect(mockedAxios.post.mock.calls[0][2]).toEqual(expect.objectContaining({
      headers: { Authorization: 'Bearer stt-key' },
      maxRedirects: 0,
      maxBodyLength: 25 * 1024 * 1024,
    }));
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
  });

  it('falls back to the SSRF-protected external downloader when the URL is not in MinIO', async () => {
    const service = createService();
    (service as any).minio.downloadSignedPublicUrl.mockResolvedValueOnce(null);
    mockedDownloadExternalBuffer.mockResolvedValueOnce(Buffer.from('external-video'));
    const chunk = createChunk('external', 'audio');
    jest.spyOn(service as any, 'transcodeToChunks').mockResolvedValue([chunk]);
    mockedAxios.post.mockResolvedValueOnce({ data: { transcript: '识别结果' } });

    await expect(service.extractText('https://media.example.com/video.mp4')).resolves.toEqual({ text: '识别结果' });
    expect(mockedDownloadExternalBuffer).toHaveBeenCalledWith('https://media.example.com/video.mp4');
  });

  it('rejects a chunk that exceeds the configured upload limit before calling the API', async () => {
    const service = createService({ STT_MAX_UPLOAD_MB: '1' });
    const oversized = createChunk('oversized', Buffer.alloc(1024 * 1024 + 1));
    jest.spyOn(service as any, 'transcodeToChunks').mockResolvedValue([oversized]);

    await expect(service.extractText('https://media.example.com/video.mp4')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(existsSync(oversized)).toBe(false);
  });

  it('rejects missing API configuration before downloading media', async () => {
    const config = { get: (_key: string) => '' } as unknown as ConfigService;
    const minio = { downloadSignedPublicUrl: jest.fn() } as unknown as MinioService;
    const service = new SttService(minio, config);

    await expect(service.extractText('https://media.example.com/video.mp4')).rejects.toThrow(
      'STT_API_URL/STT_API_KEY 未配置',
    );
    expect((minio as any).downloadSignedPublicUrl).not.toHaveBeenCalled();
  });
});
