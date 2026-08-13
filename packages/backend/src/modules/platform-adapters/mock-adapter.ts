import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  IPlatformAdapter,
  PublishResult,
  PlatformStats,
  PlatformComment,
  PlatformMessage,
} from './platform-adapter.interface';

@Injectable()
export class MockPlatformAdapter implements IPlatformAdapter {
  private static enabled = true;

  static configure(enabled: boolean) {
    MockPlatformAdapter.enabled = enabled;
  }

  static unavailable(platform: string, operation: string): never {
    throw new ServiceUnavailableException(`平台 ${platform} 真实模式 ${operation} 不可用，请检查 Key、账号授权、接口权限或平台网关配置`);
  }

  constructor(public platform: string) {}
  private logger = new Logger(MockPlatformAdapter.name);

  private ensureEnabled() {
    if (!MockPlatformAdapter.enabled) {
      throw new ServiceUnavailableException(`平台 ${this.platform} 处于 real 模式，禁止回退为 Mock`);
    }
  }

  async publishVideo(): Promise<PublishResult> {
    this.ensureEnabled();
    this.logger.log(`[Mock] published video to ${this.platform}`);
    return { success: true, platformContentId: `mock_${this.platform}_video_${Date.now()}` };
  }

  async publishImageText(): Promise<PublishResult> {
    this.ensureEnabled();
    this.logger.log(`[Mock] published image-text to ${this.platform}`);
    return { success: true, platformContentId: `mock_${this.platform}_image_text_${Date.now()}` };
  }

  async fetchStats(): Promise<PlatformStats> {
    this.ensureEnabled();
    return { playCount: 12800, readCount: 8600, fanCount: 1200, likeCount: 640, commentCount: 86, shareCount: 120 };
  }

  async fetchComments(): Promise<PlatformComment[]> {
    this.ensureEnabled();
    return [];
  }

  async fetchMessages(): Promise<PlatformMessage[]> {
    this.ensureEnabled();
    return [];
  }

  async replyComment(): Promise<PublishResult> {
    this.ensureEnabled();
    return { success: true, platformContentId: `mock_reply_${Date.now()}` };
  }

  async replyMessage(): Promise<PublishResult> {
    this.ensureEnabled();
    return { success: true, platformContentId: `mock_message_${Date.now()}` };
  }

  async checkLogin(): Promise<{ valid: boolean; reason?: string }> {
    this.ensureEnabled();
    return { valid: true, reason: 'mock credentials accepted' };
  }
}
