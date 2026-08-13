import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPlatformAdapter } from './platform-adapter.interface';
import { MockPlatformAdapter } from './mock-adapter';
import { DouyinAdapter } from './adapters/douyin.adapter';
import { KuaishouAdapter } from './adapters/kuaishou.adapter';
import { BilibiliAdapter } from './adapters/bilibili.adapter';
import { ConfiguredPlatformAdapter } from './configured-platform.adapter';
import { MinioService } from '../system/minio.service';
import { runtimeMode } from '../../config/runtime-mode';
import { BrowserPlatformAdapter } from './browser-platform.adapter';
import { SocialBrowserClient } from './social-browser.client';

const GATEWAY_ONLY_PLATFORMS = new Set(['video_account', 'xiaohongshu', 'baijiahao']);
const BROWSER_PLATFORMS = new Set(['video_account', 'xiaohongshu', 'douyin', 'kuaishou', 'bilibili', 'baijiahao']);

@Injectable()
export class PlatformAdapterFactory {
  constructor(
    private config: ConfigService,
    private minio: MinioService,
    private socialBrowser?: SocialBrowserClient,
  ) {}

  get(platform: string, authType?: string): IPlatformAdapter {
    const normalizedPlatform = platform === 'video-account' ? 'video_account' : platform;
    if (authType === 'scan') {
      if (!BROWSER_PLATFORMS.has(normalizedPlatform)) {
        throw new ServiceUnavailableException(`${normalizedPlatform} 暂不支持浏览器扫码模式`);
      }
      if (!this.socialBrowser?.isEnabled()) {
        throw new ServiceUnavailableException('浏览器扫码服务未启用');
      }
      return new BrowserPlatformAdapter(normalizedPlatform, this.socialBrowser);
    }
    const mode = runtimeMode(this.config, 'PLATFORM_MODE');
    const mock = mode === 'mock';
    MockPlatformAdapter.configure(mock);
    if (mock) return new MockPlatformAdapter(normalizedPlatform);
    const prefix = normalizedPlatform.toUpperCase().replace(/-/g, '_');
    if (this.config.get<string>(`PLATFORM_${prefix}_GATEWAY_URL`)) {
      return new ConfiguredPlatformAdapter(normalizedPlatform, this.config);
    }
    if (GATEWAY_ONLY_PLATFORMS.has(normalizedPlatform)) {
      throw new ServiceUnavailableException(
        `${normalizedPlatform} 没有可验证的公开直连发布协议，real 模式必须配置 PLATFORM_${prefix}_GATEWAY_URL`,
      );
    }
    switch (normalizedPlatform) {
      case 'douyin':
        return new DouyinAdapter(normalizedPlatform, this.config, this.minio);
      case 'kuaishou':
        return new KuaishouAdapter(normalizedPlatform, this.config, this.minio);
      case 'bilibili':
        return new BilibiliAdapter(normalizedPlatform, this.config, this.minio);
      default:
        throw new ServiceUnavailableException(`不支持的平台：${normalizedPlatform}`);
    }
  }
}
