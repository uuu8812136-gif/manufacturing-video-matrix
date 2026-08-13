import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { buildAuthorizationUrl, exchangeCodeForToken, refreshToken } from './oauth.util';

jest.mock('axios');
jest.mock('../../common/utils/external-url.util', () => ({
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('platform OAuth protocol', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exchanges a Douyin code as form data and keeps open_id/scopes', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          error_code: 0,
          access_token: 'dy-token',
          refresh_token: 'dy-refresh',
          open_id: 'dy-user',
          scope: 'user_info,video.create.bind',
          expires_in: 7200,
        },
      },
    });

    const result = await exchangeCodeForToken('douyin', 'code', 'https://app.example.com/callback', config({
      PLATFORM_DOUYIN_KEY: 'client-key',
      PLATFORM_DOUYIN_SECRET: 'client-secret',
    }));

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://open.douyin.com/oauth/access_token/',
      expect.stringContaining('client_key=client-key'),
      expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
    );
    expect(result).toMatchObject({ openId: 'dy-user', scopes: ['user_info', 'video.create.bind'] });
  });

  it('uses the official Kuaishou GET token exchange', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        result: 1,
        access_token: 'ks-token',
        refresh_token: 'ks-refresh',
        open_id: 'ks-user',
        scopes: ['user_info', 'user_video_publish'],
        expires_in: 172800,
      },
    });

    const result = await exchangeCodeForToken('kuaishou', 'code', 'https://app.example.com/callback', config({
      PLATFORM_KUAISHOU_KEY: 'app-id',
      PLATFORM_KUAISHOU_SECRET: 'app-secret',
    }));

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://open.kuaishou.com/oauth2/access_token',
      expect.objectContaining({ params: expect.objectContaining({ app_id: 'app-id', app_secret: 'app-secret' }) }),
    );
    expect(result.scopes).toContain('user_video_publish');
  });

  it.each(['video_account', 'xiaohongshu', 'baijiahao', 'bilibili'])(
    'does not invent an authorization endpoint for %s',
    (platform) => {
      expect(() => buildAuthorizationUrl(platform, 'https://app.example.com/callback', 'state', config({
        [`PLATFORM_${platform.toUpperCase()}_KEY`]: 'key',
      }))).toThrow('AUTHORIZE_URL');
    },
  );

  it('requires an explicit Bilibili refresh endpoint', async () => {
    await expect(refreshToken('bilibili', 'refresh', config({
      PLATFORM_BILIBILI_KEY: 'key',
      PLATFORM_BILIBILI_SECRET: 'secret',
    }))).rejects.toThrow('REFRESH_URL');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
