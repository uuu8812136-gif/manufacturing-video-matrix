import { ServiceUnavailableException } from '@nestjs/common';
import { BrowserPlatformAdapter } from './browser-platform.adapter';
import { SocialBrowserClient } from './social-browser.client';

const credential = JSON.stringify({
  kind: 'browser_session',
  account_ref: 'browser-account_123',
});

function browserClient() {
  return {
    publishVideo: jest.fn(),
    publishImageText: jest.fn(),
    checkAccount: jest.fn(),
  } as unknown as jest.Mocked<SocialBrowserClient>;
}

describe('BrowserPlatformAdapter', () => {
  it('publishes video with only the opaque account reference and maps a successful result', async () => {
    const browser = browserClient();
    browser.publishVideo.mockResolvedValue({ success: true, platformContentId: 9527 });
    const adapter = new BrowserPlatformAdapter('douyin', browser);

    await expect(adapter.publishVideo({
      accountCredentials: credential,
      videoUrl: 'https://assets.example.com/video.mp4',
      title: '智能制造',
      coverUrl: 'https://assets.example.com/cover.jpg',
      tags: ['制造业', '数字化'],
      attachType: 'poi',
      attachValue: 'factory',
    })).resolves.toEqual({
      success: true,
      platformContentId: '9527',
      failReason: undefined,
    });

    expect(browser.publishVideo).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: 'browser-account_123',
      videoUrl: 'https://assets.example.com/video.mp4',
      title: '智能制造',
      coverUrl: 'https://assets.example.com/cover.jpg',
      tags: ['制造业', '数字化'],
      attachType: 'poi',
      attachValue: 'factory',
    });
  });

  it('maps a browser publishing failure without inventing a content id', async () => {
    const browser = browserClient();
    browser.publishVideo.mockResolvedValue({ success: false, message: '平台拒绝发布' });
    const adapter = new BrowserPlatformAdapter('kuaishou', browser);

    await expect(adapter.publishVideo({
      accountCredentials: credential,
      videoUrl: 'https://assets.example.com/video.mp4',
      title: 'title',
    })).resolves.toEqual({
      success: false,
      platformContentId: undefined,
      failReason: '平台拒绝发布',
    });
  });

  it('supports image-text publishing for Xiaohongshu', async () => {
    const browser = browserClient();
    browser.publishImageText.mockResolvedValue({ success: true, platformContentId: 'note-1' });
    const adapter = new BrowserPlatformAdapter('xiaohongshu', browser);

    await expect(adapter.publishImageText({
      accountCredentials: credential,
      images: ['https://assets.example.com/1.jpg', 'https://assets.example.com/2.jpg'],
      title: '工厂实拍',
      body: '车间数字化改造',
    })).resolves.toMatchObject({ success: true, platformContentId: 'note-1' });

    expect(browser.publishImageText).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'xiaohongshu',
      accountId: 'browser-account_123',
      tags: [],
    }));
  });

  it.each(['video_account', 'douyin', 'kuaishou', 'bilibili', 'baijiahao'])(
    'rejects unsupported image-text publishing for %s without calling the sidecar',
    async (platform) => {
      const browser = browserClient();
      const adapter = new BrowserPlatformAdapter(platform, browser);

      await expect(adapter.publishImageText({
        accountCredentials: credential,
        images: ['https://assets.example.com/1.jpg'],
        title: 'title',
        body: 'body',
      })).rejects.toThrow('目前只支持视频发布');
      expect(browser.publishImageText).not.toHaveBeenCalled();
    },
  );

  it('forwards login checks and preserves an invalid reason', async () => {
    const browser = browserClient();
    browser.checkAccount.mockResolvedValue({ valid: false, reason: '登录已过期' });
    const adapter = new BrowserPlatformAdapter('bilibili', browser);

    await expect(adapter.checkLogin(credential)).resolves.toEqual({
      valid: false,
      reason: '登录已过期',
    });
    expect(browser.checkAccount).toHaveBeenCalledWith('bilibili', 'browser-account_123');
  });

  it('preserves transient browser validation failures', async () => {
    const browser = browserClient();
    browser.checkAccount.mockResolvedValue({
      valid: false,
      transient: true,
      reason: 'validate exception: browser closed',
    });
    const adapter = new BrowserPlatformAdapter('bilibili', browser);

    await expect(adapter.checkLogin(credential)).resolves.toEqual({
      valid: false,
      transient: true,
      reason: 'validate exception: browser closed',
    });
  });

  it('forwards a readiness-specific timeout to the browser service', async () => {
    const browser = browserClient();
    browser.checkAccount.mockResolvedValue({ valid: true });
    const adapter = new BrowserPlatformAdapter('bilibili', browser);

    await expect(adapter.checkLogin(credential, { timeoutMs: 8_000 })).resolves.toEqual({
      valid: true,
      reason: undefined,
      userInfo: undefined,
    });
    expect(browser.checkAccount).toHaveBeenCalledWith(
      'bilibili',
      'browser-account_123',
      8_000,
    );
  });

  it('preserves account user info returned by the browser service', async () => {
    const browser = browserClient();
    const userInfo = {
      user_id: 'douyin-user-1',
      name: '制造业账号',
      extra: { follower_count: '1,234' },
    };
    browser.checkAccount.mockResolvedValue({ valid: true, userInfo });
    const adapter = new BrowserPlatformAdapter('douyin', browser);

    await expect(adapter.checkLogin(credential)).resolves.toEqual({
      valid: true,
      reason: undefined,
      userInfo,
    });
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['wrong credential kind', JSON.stringify({ kind: 'oauth', account_ref: 'browser-account_123' })],
    ['missing account reference', JSON.stringify({ kind: 'browser_session' })],
    ['too-short account reference', JSON.stringify({ kind: 'browser_session', account_ref: 'short' })],
    ['unsafe account reference', JSON.stringify({ kind: 'browser_session', account_ref: '../account-secret' })],
  ])('rejects %s before calling the sidecar', async (_case, accountCredentials) => {
    const browser = browserClient();
    const adapter = new BrowserPlatformAdapter('douyin', browser);

    await expect(adapter.checkLogin(accountCredentials)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(adapter.checkLogin(accountCredentials)).rejects.toThrow('请重新扫码');
    expect(browser.checkAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['account statistics', (adapter: BrowserPlatformAdapter) => adapter.fetchStats(credential), '账号统计'],
    ['comments', (adapter: BrowserPlatformAdapter) => adapter.fetchComments(credential), '评论同步'],
    ['messages', (adapter: BrowserPlatformAdapter) => adapter.fetchMessages(credential), '私信同步'],
  ])('reports %s as unavailable instead of returning fabricated data', async (_feature, call, message) => {
    const adapter = new BrowserPlatformAdapter('douyin', browserClient());
    await expect(call(adapter)).rejects.toThrow(message);
  });
});
