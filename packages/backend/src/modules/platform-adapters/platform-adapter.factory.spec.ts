import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioService } from '../system/minio.service';
import { BilibiliAdapter } from './adapters/bilibili.adapter';
import { BrowserPlatformAdapter } from './browser-platform.adapter';
import { ConfiguredPlatformAdapter } from './configured-platform.adapter';
import { DouyinAdapter } from './adapters/douyin.adapter';
import { KuaishouAdapter } from './adapters/kuaishou.adapter';
import { MockPlatformAdapter } from './mock-adapter';
import { PlatformAdapterFactory } from './platform-adapter.factory';
import { SocialBrowserClient } from './social-browser.client';

function browserClient(enabled = true) {
  return {
    isEnabled: jest.fn(() => enabled),
  } as unknown as SocialBrowserClient;
}

function factory(values: Record<string, string>, browser?: SocialBrowserClient) {
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  const minio = {} as MinioService;
  return new PlatformAdapterFactory(config, minio, browser);
}

describe('PlatformAdapterFactory', () => {
  it('uses mock adapters only in mock mode', () => {
    expect(factory({ PLATFORM_MODE: 'mock' }).get('douyin')).toBeInstanceOf(MockPlatformAdapter);
  });

  it.each([
    'video_account',
    'xiaohongshu',
    'douyin',
    'kuaishou',
    'bilibili',
    'baijiahao',
  ])('routes %s scan accounts to the browser adapter regardless of platform mode', (platform) => {
    const adapter = factory({ PLATFORM_MODE: 'mock' }, browserClient()).get(platform, 'scan');
    expect(adapter).toBeInstanceOf(BrowserPlatformAdapter);
    expect(adapter.platform).toBe(platform);
  });

  it('normalizes the video-account alias before creating a browser adapter', () => {
    const adapter = factory({ PLATFORM_MODE: 'real' }, browserClient()).get('video-account', 'scan');
    expect(adapter).toBeInstanceOf(BrowserPlatformAdapter);
    expect(adapter.platform).toBe('video_account');
  });

  it('rejects scan mode when the browser sidecar is missing or disabled', () => {
    expect(() => factory({ PLATFORM_MODE: 'mock' }).get('douyin', 'scan'))
      .toThrow('浏览器扫码服务未启用');
    expect(() => factory({ PLATFORM_MODE: 'mock' }, browserClient(false)).get('douyin', 'scan'))
      .toThrow('浏览器扫码服务未启用');
  });

  it('rejects platforms outside the six-platform browser allowlist', () => {
    expect(() => factory({ PLATFORM_MODE: 'mock' }, browserClient()).get('wechat', 'scan'))
      .toThrow('暂不支持浏览器扫码模式');
  });

  it('keeps non-scan auth types on the existing adapter path', () => {
    const browser = browserClient();
    expect(factory({ PLATFORM_MODE: 'mock' }, browser).get('douyin', 'oauth'))
      .toBeInstanceOf(MockPlatformAdapter);
    expect(factory({ PLATFORM_MODE: 'real' }, browser).get('kuaishou', 'oauth'))
      .toBeInstanceOf(KuaishouAdapter);
    expect(factory({
      PLATFORM_MODE: 'real',
      PLATFORM_VIDEO_ACCOUNT_GATEWAY_URL: 'https://gateway.example.com/video-account',
    }, browser).get('video_account', 'cookie')).toBeInstanceOf(ConfiguredPlatformAdapter);
  });

  it.each(['video_account', 'video-account', 'xiaohongshu', 'baijiahao'])(
    'requires an approved gateway for %s in real mode',
    (platform) => {
      expect(() => factory({ PLATFORM_MODE: 'real' }).get(platform))
        .toThrow(ServiceUnavailableException);
      expect(() => factory({ PLATFORM_MODE: 'real' }).get(platform))
        .toThrow('GATEWAY_URL');
    },
  );

  it('uses the configured gateway for a gateway-only platform', () => {
    const adapter = factory({
      PLATFORM_MODE: 'real',
      PLATFORM_VIDEO_ACCOUNT_GATEWAY_URL: 'https://gateway.example.com/video-account',
    }).get('video-account');
    expect(adapter).toBeInstanceOf(ConfiguredPlatformAdapter);
    expect(adapter.platform).toBe('video_account');
  });

  it('creates only verified direct adapters in real mode', () => {
    const value = factory({ PLATFORM_MODE: 'real' });
    expect(value.get('douyin')).toBeInstanceOf(DouyinAdapter);
    expect(value.get('kuaishou')).toBeInstanceOf(KuaishouAdapter);
    expect(value.get('bilibili')).toBeInstanceOf(BilibiliAdapter);
  });
});
