import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ConfiguredPlatformAdapter } from './configured-platform.adapter';

jest.mock('axios');
jest.mock('../../common/utils/external-url.util', () => ({
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ConfiguredPlatformAdapter response verification', () => {
  let adapter: ConfiguredPlatformAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    const values: Record<string, string> = {
      PLATFORM_VIDEO_ACCOUNT_GATEWAY_URL: 'https://gateway.example.com/video-account',
      PLATFORM_VIDEO_ACCOUNT_GATEWAY_KEY: 'gateway-key',
    };
    adapter = new ConfiguredPlatformAdapter(
      'video_account',
      { get: (key: string) => values[key] } as unknown as ConfigService,
    );
  });

  it('rejects non-HTTPS gateways before any credential can be sent', () => {
    const insecure = {
      get: (key: string) => key === 'PLATFORM_VIDEO_ACCOUNT_GATEWAY_URL' ? 'http://gateway.example.com' : undefined,
    } as unknown as ConfigService;
    expect(() => new ConfiguredPlatformAdapter('video_account', insecure)).toThrow('HTTPS');
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('does not treat an empty account-check response as valid', async () => {
    mockedAxios.request.mockResolvedValueOnce({ data: {} });
    await expect(adapter.checkLogin('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requires a platform content id before reporting publish success', async () => {
    mockedAxios.request.mockResolvedValueOnce({ data: { success: true } });
    await expect(adapter.publishVideo({
      accountCredentials: 'token',
      videoUrl: 'https://assets.example.com/video.mp4',
      title: 'title',
    })).rejects.toThrow('内容 ID');
  });

  it('rejects nested success when an outer business layer reports failure', async () => {
    mockedAxios.request.mockResolvedValueOnce({
      data: { code: 500, success: false, message: 'outer failed', data: { success: true, id: 'fake-id' } },
    });
    await expect(adapter.publishVideo({
      accountCredentials: 'token',
      videoUrl: 'https://assets.example.com/video.mp4',
      title: 'title',
    })).rejects.toThrow('outer failed');
  });

  it('requires an explicit success signal for reply operations', async () => {
    mockedAxios.request.mockResolvedValueOnce({ data: {} });
    await expect(adapter.replyComment({
      accountCredentials: 'token',
      externalId: 'comment-1',
      text: 'reply',
    })).rejects.toThrow('无法确认');
  });

  it('accepts explicit gateway account validation', async () => {
    mockedAxios.request.mockResolvedValueOnce({ data: { data: { valid: true }, success: true } });
    await expect(adapter.checkLogin('token')).resolves.toEqual({ valid: true, reason: undefined });
  });

  it('does not coerce a missing follower metric to zero', async () => {
    mockedAxios.request.mockResolvedValueOnce({ data: { playCount: 12 } });
    const stats = await adapter.fetchStats('token');
    expect(stats.playCount).toBe(12);
    expect(stats.fanCount).toBeUndefined();
  });

  it('keeps an explicitly reported zero follower metric', async () => {
    mockedAxios.request.mockResolvedValueOnce({ data: { fan_count: 0 } });
    await expect(adapter.fetchStats('token')).resolves.toMatchObject({ fanCount: 0 });
  });
});
