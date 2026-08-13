import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MinioService } from '../../system/minio.service';
import { BilibiliAdapter } from './bilibili.adapter';
import { DouyinAdapter } from './douyin.adapter';
import { KuaishouAdapter } from './kuaishou.adapter';
import { IPlatformAdapter } from '../platform-adapter.interface';

jest.mock('axios');
jest.mock('../../../common/utils/external-url.util', () => ({
  assertSafeExternalUrl: jest.fn(async (value: string) => new URL(value)),
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({
    url: new URL(value),
    transport: {},
  })),
  downloadExternalBuffer: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const validMp4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.from('real video bytes'),
]);
const validJpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from('real cover bytes'),
]);

function minio(video = validMp4, cover = validJpeg) {
  return {
    downloadSignedPublicUrl: jest.fn(async (url: string) => url.includes('cover') ? cover : video),
  } as unknown as MinioService;
}

describe('verified direct platform upload protocols', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uploads binary multipart to Douyin and uses the OAuth open_id', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { data: { error_code: 0, video: { video_id: 'video-id' } } } })
      .mockResolvedValueOnce({ data: { data: { error_code: 0, item_id: 'item-id' } } });
    const adapter = new DouyinAdapter('douyin', config({ PLATFORM_DOUYIN_KEY: 'client-key' }), minio());

    await expect(adapter.publishVideo({
      accountCredentials: JSON.stringify({
        access_token: 'access-token',
        open_id: 'user-open-id',
        scopes: ['video.create.bind'],
      }),
      videoUrl: 'https://app.example.com/assets/video.mp4',
      title: 'title',
    })).resolves.toEqual({ success: true, platformContentId: 'item-id' });

    expect(mockedAxios.post.mock.calls[0][0]).toContain('/video/upload_video/');
    expect(mockedAxios.post.mock.calls[0][1]).toBeInstanceOf(FormData);
    expect((mockedAxios.post.mock.calls[0][1] as FormData).get('video')).toBeInstanceOf(Blob);
    expect(mockedAxios.post.mock.calls[0][2]).toEqual(expect.objectContaining({
      params: { open_id: 'user-open-id' },
      headers: { 'access-token': 'access-token' },
    }));
    expect(mockedAxios.post.mock.calls[1][1]).toEqual(expect.objectContaining({ video_id: 'video-id' }));
  });

  it('rejects legacy Douyin credentials that do not contain open_id', async () => {
    const adapter = new DouyinAdapter('douyin', config({ PLATFORM_DOUYIN_KEY: 'client-key' }), minio());
    await expect(adapter.publishVideo({
      accountCredentials: 'legacy-access-token',
      videoUrl: 'https://app.example.com/assets/video.mp4',
      title: 'title',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('rejects Douyin credentials without the approved publishing scope', async () => {
    const adapter = new DouyinAdapter('douyin', config({ PLATFORM_DOUYIN_KEY: 'client-key' }), minio());
    await expect(adapter.publishVideo({
      accountCredentials: JSON.stringify({ access_token: 'token', open_id: 'open-id', scopes: [] }),
      videoUrl: 'https://app.example.com/assets/video.mp4',
      title: 'title',
    })).rejects.toThrow('video.create.bind');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('marks Kuaishou login invalid when the publishing scope is absent', async () => {
    const adapter = new KuaishouAdapter('kuaishou', config({ PLATFORM_KUAISHOU_KEY: 'app-id' }), minio());
    await expect(adapter.checkLogin(JSON.stringify({ access_token: 'token', scopes: [] })))
      .resolves.toMatchObject({ valid: false, reason: expect.stringContaining('user_video_publish') });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('uses Kuaishou start-upload, binary upload, and multipart publish', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { result: 1, upload_token: 'upload-token', endpoint: 'uploader.kuaishou.example' } })
      .mockResolvedValueOnce({ data: { result: 1 } })
      .mockResolvedValueOnce({ data: { result: 1, video_info: { photo_id: 'photo-id' } } });
    const adapter = new KuaishouAdapter('kuaishou', config({ PLATFORM_KUAISHOU_KEY: 'app-id' }), minio());

    await expect(adapter.publishVideo({
      accountCredentials: JSON.stringify({ access_token: 'token', scopes: ['user_video_publish'] }),
      videoUrl: 'https://app.example.com/assets/video.mp4',
      coverUrl: 'https://app.example.com/assets/cover.jpg',
      title: 'caption',
    })).resolves.toEqual({ success: true, platformContentId: 'photo-id' });

    expect(mockedAxios.post.mock.calls[0][0]).toContain('/photo/start_upload');
    expect(Buffer.isBuffer(mockedAxios.post.mock.calls[1][1])).toBe(true);
    expect(mockedAxios.post.mock.calls[2][1]).toBeInstanceOf(FormData);
    expect((mockedAxios.post.mock.calls[2][1] as FormData).get('cover')).toBeInstanceOf(Blob);
  });

  it('uses the Bilibili official init/chunk/complete/cover/submit sequence', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { code: 0, data: { upload_token: 'upload-token' } } })
      .mockResolvedValueOnce({ data: { code: 0 } })
      .mockResolvedValueOnce({ data: { code: 0 } })
      .mockResolvedValueOnce({ data: { code: 0, data: { url: 'https://i.example.com/cover.jpg' } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { resource_id: 'resource-id' } } });
    const adapter = new BilibiliAdapter('bilibili', config({
      PLATFORM_BILIBILI_KEY: 'client-id',
      PLATFORM_BILIBILI_TID: '75',
    }), minio());

    await expect(adapter.publishVideo({
      accountCredentials: JSON.stringify({ access_token: 'token' }),
      videoUrl: 'https://app.example.com/assets/video.mp4',
      coverUrl: 'https://app.example.com/assets/cover.jpg',
      title: 'title',
      tags: ['制造业'],
    })).resolves.toEqual({ success: true, platformContentId: 'resource-id' });

    expect(mockedAxios.post.mock.calls.map((call) => call[0])).toEqual([
      'https://member.bilibili.com/arcopen/fn/archive/video/init',
      'https://openupos.bilivideo.com/video/v2/part/upload',
      'https://member.bilibili.com/arcopen/fn/archive/video/complete',
      'https://member.bilibili.com/arcopen/fn/archive/cover/upload',
      'https://member.bilibili.com/arcopen/fn/archive/add-by-utoken',
    ]);
    expect(Buffer.isBuffer(mockedAxios.post.mock.calls[1][1])).toBe(true);
    expect(mockedAxios.post.mock.calls[3][1]).toBeInstanceOf(FormData);
    expect(mockedAxios.post.mock.calls[4][1]).toEqual(expect.objectContaining({ tid: 75, title: 'title' }));
  });

  it.each([
    ['douyin', () => new DouyinAdapter('douyin', config({ PLATFORM_DOUYIN_KEY: 'key' }), minio())],
    ['kuaishou', () => new KuaishouAdapter('kuaishou', config({ PLATFORM_KUAISHOU_KEY: 'key' }), minio())],
    ['bilibili', () => new BilibiliAdapter('bilibili', config({ PLATFORM_BILIBILI_KEY: 'key' }), minio())],
  ])('never fakes unsupported %s image-text publishing', async (_platform, create) => {
    await expect((create() as IPlatformAdapter).publishImageText({
      accountCredentials: 'token',
      images: [],
      title: 'title',
      body: 'body',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
