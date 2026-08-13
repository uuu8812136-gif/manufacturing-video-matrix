import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { PlatformAdapterFactory } from './modules/platform-adapters/platform-adapter.factory';
import { IntegrationReadinessService } from './integration-readiness.service';
import axios from 'axios';

jest.mock('axios');
jest.mock('./common/utils/external-url.util', () => ({
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
}));

describe('IntegrationReadinessService', () => {
  const prisma = {
    crmIntegration: { count: jest.fn().mockResolvedValue(0) },
    platformAccount: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    geoKeyword: { count: jest.fn().mockResolvedValue(0) },
  } as unknown as PrismaService;
  const adapters = { get: jest.fn() } as unknown as PlatformAdapterFactory;

  beforeEach(() => jest.clearAllMocks());

  it('reports mock mode without pretending real integrations are ready', async () => {
    const config = {
      get: (name: string) => ({
        NODE_ENV: 'test',
        AI_MODE: 'mock',
        PLATFORM_MODE: 'mock',
        DIGITAL_HUMAN_MODE: 'mock',
        GEO_MODE: 'mock',
        CRAWL_MODE: 'mock',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;
    const result = await new IntegrationReadinessService(config, prisma, adapters).inspect(false);

    expect(result.ready).toBe(false);
    expect(result.modes).toEqual({ ai: 'mock', platform: 'mock', digitalHuman: 'mock', geo: 'mock', crawl: 'mock' });
    expect(result.checks.find((item) => item.id === 'deepseek')?.required).toBe(false);
  });

  it('lists every missing real-mode dependency without exposing secret values', async () => {
    const config = {
      get: (name: string) => ({
        NODE_ENV: 'production',
        AI_MODE: 'real',
        PLATFORM_MODE: 'real',
        DIGITAL_HUMAN_MODE: 'real',
        DIGITAL_HUMAN_PROVIDER: 'heygen',
        GEO_MODE: 'real',
        CRAWL_MODE: 'real',
        APP_DOMAIN: 'http://localhost:5173',
        PUBLIC_API_URL: 'http://localhost:3000',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;
    const result = await new IntegrationReadinessService(config, prisma, adapters).inspect(false);

    expect(result.ready).toBe(false);
    expect(result.summary.missing).toBeGreaterThanOrEqual(10);
    expect(JSON.stringify(result)).not.toContain('Bearer');
    expect(result.checks.find((item) => item.id === 'public_https')?.status).toBe('missing_config');
    expect(result.checks.find((item) => item.id === 'platform_video_account')?.detail).toContain('合规网关');
  });

  it('marks an HTTP 400 probe as unverified instead of treating configured as live-ready', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ status: 400, data: {} });
    const config = {
      get: (name: string) => ({
        NODE_ENV: 'test',
        AI_MODE: 'mock',
        PLATFORM_MODE: 'mock',
        DIGITAL_HUMAN_MODE: 'mock',
        GEO_MODE: 'mock',
        CRAWL_MODE: 'mock',
        SMS_API_URL: 'https://sms.example.com/health',
        SMS_API_KEY: 'real-key',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;

    const result = await new IntegrationReadinessService(config, prisma, adapters).inspect(true);
    expect(result.checks.find((item) => item.id === 'sms')?.status).toBe('unverified');
    expect(result.summary.unverified).toBe(1);
    expect(result.probeReady).toBe(false);
  });

  it('requires non-template security secrets whenever any real mode is enabled', async () => {
    const config = {
      get: (name: string) => ({
        NODE_ENV: 'test',
        AI_MODE: 'real',
        PLATFORM_MODE: 'mock',
        DIGITAL_HUMAN_MODE: 'mock',
        GEO_MODE: 'mock',
        CRAWL_MODE: 'mock',
        JWT_SECRET: 'change-me-in-production-mvms-jwt-secret-2025-very-long',
        ENCRYPTION_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        ASSET_SIGNING_SECRET: 'replace-with-at-least-32-random-characters',
        SEED_ADMIN_PASSWORD: 'admin123',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;

    const result = await new IntegrationReadinessService(config, prisma, adapters).inspect(false);
    for (const id of [
      'security_jwt_secret',
      'security_encryption_key',
      'security_asset_signing_secret',
      'security_seed_admin_password',
    ]) {
      expect(result.checks.find((item) => item.id === id)?.status).toBe('missing_config');
    }
    expect(JSON.stringify(result)).not.toContain('admin123');
  });

  it('checks every active platform account and clearly rejects seed mock credentials', async () => {
    (prisma.platformAccount.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'account-seed', nickname: '演示账号', credentials: 'mock:seed:credentials' },
      { id: 'account-real', nickname: '真实账号', credentials: JSON.stringify({ access_token: 'live-token' }) },
    ]);
    const checkLogin = jest.fn().mockResolvedValue({ valid: true });
    (adapters.get as jest.Mock).mockReturnValue({ checkLogin });
    const config = {
      get: (name: string) => ({
        NODE_ENV: 'production',
        PLATFORM_MODE: 'real',
        PLATFORM_DOUYIN_KEY: 'app-key',
        PLATFORM_DOUYIN_SECRET: 'app-secret',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;
    const service = new IntegrationReadinessService(config, prisma, adapters);

    const result = await (service as any).platformCheck('douyin', '抖音', true, true);
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('通过 1/2');
    expect(result.detail).toContain('Seed/Mock');
    expect(checkLogin).toHaveBeenCalledTimes(1);
  });

  it('accepts a scan account without OAuth keys or a gateway and probes the scan adapter', async () => {
    const scanAccount = {
      id: 'account-scan',
      nickname: '扫码账号',
      authType: 'scan',
      credentials: JSON.stringify({ kind: 'browser_session', account_ref: 'browser-account-001' }),
    };
    (prisma.platformAccount.findMany as jest.Mock)
      .mockResolvedValueOnce([scanAccount])
      .mockResolvedValueOnce([scanAccount]);
    const checkLogin = jest.fn().mockResolvedValue({ valid: true });
    (adapters.get as jest.Mock).mockReturnValue({ checkLogin });
    const config = {
      get: (name: string) => ({
        SOCIAL_BROWSER_ENABLED: 'true',
        SOCIAL_BROWSER_URL: 'http://social-browser:8000',
        JWT_SECRET: 'live-jwt-secret-for-browser-readiness-2026',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;
    const service = new IntegrationReadinessService(config, prisma, adapters);

    const configured = await (service as any).platformCheck('douyin', '抖音', true, false, true);
    expect(configured.status).toBe('configured');
    expect(configured.detail).toContain('不含评论、私信、统计');
    expect(configured.detail).not.toContain('缺少应用 Key/Secret');

    const probed = await (service as any).platformCheck('douyin', '抖音', true, true, true);
    expect(probed.status).toBe('reachable');
    expect(adapters.get).toHaveBeenCalledWith('douyin', 'scan');
    expect(probed.detail).toContain('评论、私信、统计未接入');
  });

  it('allows a real scan-account probe more than the old eight-second limit', async () => {
    const scanAccount = {
      id: 'account-scan-slow-valid',
      nickname: '正常慢响应账号',
      authType: 'scan',
      credentials: JSON.stringify({ kind: 'browser_session', account_ref: 'browser-account-slow-valid' }),
    };
    (prisma.platformAccount.findMany as jest.Mock).mockResolvedValueOnce([scanAccount]);
    const checkLogin = jest.fn().mockResolvedValue({ valid: true });
    (adapters.get as jest.Mock).mockReturnValue({ checkLogin });
    const config = {
      get: (name: string) => ({
        SOCIAL_BROWSER_ENABLED: 'true',
        SOCIAL_BROWSER_URL: 'http://social-browser:8000',
        JWT_SECRET: 'live-jwt-secret-for-browser-readiness-2026',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;
    const service = new IntegrationReadinessService(config, prisma, adapters);
    jest.spyOn(service as any, 'platformProbeBudgetMs').mockReturnValue(20_000);

    const result = await (service as any).platformCheck('douyin', '抖音', true, true, true);

    expect(result.status).toBe('reachable');
    expect(checkLogin).toHaveBeenCalledWith(
      scanAccount.credentials,
      { timeoutMs: expect.any(Number) },
    );
    const timeoutMs = checkLogin.mock.calls[0][1].timeoutMs as number;
    expect(timeoutMs).toBeGreaterThanOrEqual(19_000);
    expect(timeoutMs).toBeLessThanOrEqual(20_000);
  });

  it('returns a failed platform result within its probe budget when an adapter hangs', async () => {
    const scanAccount = {
      id: 'account-slow',
      nickname: '慢响应账号',
      authType: 'scan',
      credentials: JSON.stringify({ kind: 'browser_session', account_ref: 'browser-account-slow' }),
    };
    (prisma.platformAccount.findMany as jest.Mock).mockResolvedValueOnce([scanAccount]);
    const checkLogin = jest.fn(() => new Promise(() => undefined));
    (adapters.get as jest.Mock).mockReturnValue({ checkLogin });
    const config = {
      get: (name: string) => ({
        SOCIAL_BROWSER_ENABLED: 'true',
        SOCIAL_BROWSER_URL: 'http://social-browser:8000',
        JWT_SECRET: 'live-jwt-secret-for-browser-readiness-2026',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;
    const service = new IntegrationReadinessService(config, prisma, adapters);
    jest.spyOn(service as any, 'platformProbeBudgetMs').mockReturnValue(20);

    const result = await (service as any).platformCheck('bilibili', 'B站', true, true, true);

    expect(result.status).toBe('failed');
    expect(result.detail).toContain('登录态探测超过 1 秒');
    expect(checkLogin).toHaveBeenCalledWith(
      scanAccount.credentials,
      { timeoutMs: expect.any(Number) },
    );
  });

  it('reports the browser runtime as reachable without claiming the whole platform capability ready', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ status: 200, data: { ok: true, browser: 'chromium' } });
    const config = {
      get: (name: string) => ({
        NODE_ENV: 'test',
        AI_MODE: 'mock',
        PLATFORM_MODE: 'mock',
        DIGITAL_HUMAN_MODE: 'mock',
        GEO_MODE: 'mock',
        CRAWL_MODE: 'mock',
        SOCIAL_BROWSER_ENABLED: 'true',
        SOCIAL_BROWSER_URL: 'http://social-browser:8000',
        JWT_SECRET: 'live-jwt-secret-for-browser-readiness-2026',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        ASSET_SIGNING_SECRET: 'live-asset-signing-secret-readiness-2026',
        SEED_ADMIN_PASSWORD: 'AdminStrong#2026Ready',
      } as Record<string, string>)[name],
    } as unknown as ConfigService;

    const result = await new IntegrationReadinessService(config, prisma, adapters).inspect(true);
    const browser = result.checks.find((item) => item.id === 'social_browser');
    expect(browser?.status).toBe('reachable');
    expect(browser?.detail).toContain('评论、私信、统计仍未接入');
    expect(result.configurationReady).toBe(true);
    expect(result.probeReady).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.allRealModes).toBe(false);
  });
});
