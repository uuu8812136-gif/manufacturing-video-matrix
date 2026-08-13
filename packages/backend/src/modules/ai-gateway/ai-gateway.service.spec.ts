import { AiGatewayService } from './ai-gateway.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');
jest.mock('../../common/utils/external-url.util', () => ({
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AiGatewayService', () => {
  let service: AiGatewayService;

  beforeEach(() => {
    jest.clearAllMocks();
    const config = {
      get: (key: string) => ({ NODE_ENV: 'test', AI_MODE: 'mock' } as Record<string, string>)[key],
    } as unknown as ConfigService;
    service = new AiGatewayService(config);
  });

  it('isMock is true when isolated tests explicitly request mock mode', () => {
    expect(service.isMock).toBe(true);
  });

  it('chat returns mock with structure for 拆解 keyword', async () => {
    const r = await service.chat([{ role: 'user', content: '请帮我拆解这个视频结构' }]);
    const parsed = JSON.parse(r);
    expect(parsed).toHaveProperty('structure');
    expect(parsed).toHaveProperty('script');
    expect(parsed).toHaveProperty('emotionCurve');
  });

  it('chat returns mock with title for 二创 keyword', async () => {
    const r = await service.chat([{ role: 'user', content: '帮我二创改写这段文案' }]);
    const parsed = JSON.parse(r);
    expect(parsed).toHaveProperty('title');
    expect(parsed).toHaveProperty('altTitles');
    expect(Array.isArray(parsed.altTitles)).toBe(true);
  });

  it('chat returns titles array for 标题 keyword', async () => {
    const r = await service.chat([{ role: 'user', content: '请生成标题' }]);
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('chat returns tags array for 标签 keyword', async () => {
    const r = await service.chat([{ role: 'user', content: '请生成标签话题' }]);
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toContain('#');
  });

  it('chat returns default mock string for other content', async () => {
    const r = await service.chat([{ role: 'user', content: '随便说点什么吧' }]);
    expect(typeof r).toBe('string');
    expect(r).toContain('Mock');
  });

  it('uses deepseek-v4-flash in real mode by default', async () => {
    const values: Record<string, string> = {
      AI_MODE: 'real',
      DEEPSEEK_API_KEY: 'test-key',
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;
    service = new AiGatewayService(config);
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });

    await expect(service.chat([{ role: 'user', content: 'hello' }], 0.5)).resolves.toBe('ok');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        model: 'deepseek-v4-flash',
        temperature: 0.5,
        thinking: { type: 'disabled' },
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it.each([
    ['deepseek-chat', 'disabled'],
    ['deepseek-reasoner', 'enabled'],
  ] as const)('maps legacy model %s to V4 Flash with %s thinking', async (legacyModel, thinking) => {
    const values: Record<string, string> = {
      AI_MODE: 'real',
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_MODEL: legacyModel,
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;
    service = new AiGatewayService(config);
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });

    await service.chat([{ role: 'user', content: 'hello' }]);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        model: 'deepseek-v4-flash',
        thinking: { type: thinking },
      }),
      expect.any(Object),
    );
  });

  it('allows the thinking mode to be overridden explicitly', async () => {
    const values: Record<string, string> = {
      AI_MODE: 'real',
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_THINKING: 'enabled',
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;
    service = new AiGatewayService(config);
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });

    await service.chat([{ role: 'user', content: 'hello' }]);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        model: 'deepseek-v4-pro',
        thinking: { type: 'enabled' },
      }),
      expect.any(Object),
    );
  });
});
