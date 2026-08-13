import axios from 'axios';
import { HeyGenProvider } from './digital-human.provider';

jest.mock('axios');
jest.mock('../../common/utils/external-url.util', () => ({
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HeyGenProvider', () => {
  let provider: HeyGenProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new HeyGenProvider('heygen-key', 'https://api.heygen.com/');
  });

  it('creates an avatar video through the V3 API', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { data: { video_id: 'video-123', status: 'pending', output_format: 'mp4' } },
    });

    await expect(provider.generate('欢迎来到工厂', {
      avatarKey: 'avatar-1',
      voiceKey: 'voice-1',
      background: 'https://cdn.example.com/factory.jpg',
    })).resolves.toEqual({ taskId: 'video-123', videoUrl: '' });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.heygen.com/v3/videos',
      {
        type: 'avatar',
        avatar_id: 'avatar-1',
        script: '欢迎来到工厂',
        voice_id: 'voice-1',
        output_format: 'mp4',
        background: { url: 'https://cdn.example.com/factory.jpg' },
      },
      expect.objectContaining({
        headers: { 'x-api-key': 'heygen-key', 'Content-Type': 'application/json' },
        timeout: 60000,
        maxRedirects: 0,
      }),
    );
  });

  it('rejects a free-form scene label instead of silently dropping the background', async () => {
    await expect(provider.generate('脚本', {
      avatarKey: 'avatar-1',
      voiceKey: 'voice-1',
      background: '工厂车间',
    })).rejects.toThrow('背景仅支持');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('requires configured avatar and voice identifiers', async () => {
    await expect(provider.generate('脚本', { avatarKey: 'avatar-1' })).rejects.toThrow('avatarKey 和 voiceKey');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('polls V3 and maps a completed response to done', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'video/123',
          status: 'completed',
          video_url: 'https://files.heygen.ai/video-123.mp4',
        },
      },
    });

    await expect(provider.pollStatus('video/123')).resolves.toEqual({
      status: 'done',
      videoUrl: 'https://files.heygen.ai/video-123.mp4',
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.heygen.com/v3/videos/video%2F123',
      expect.objectContaining({ headers: { 'x-api-key': 'heygen-key' }, timeout: 30000, maxRedirects: 0 }),
    );
  });

  it('maps pending and failed V3 responses to internal task statuses', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { data: { status: 'pending' } } })
      .mockResolvedValueOnce({
        data: { data: { status: 'failed', failure_code: 'rendering_failed', failure_message: 'Render timed out' } },
      });

    await expect(provider.pollStatus('pending-id')).resolves.toEqual({ status: 'processing' });
    await expect(provider.pollStatus('failed-id')).resolves.toEqual({ status: 'failed', error: 'Render timed out' });
  });
});
