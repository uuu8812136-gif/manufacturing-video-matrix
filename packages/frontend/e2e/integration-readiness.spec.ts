import { expect, test } from '@playwright/test';
import { DEMO } from './helpers';

interface ApiEnvelope<T> {
  code: number;
  data: T;
}

interface ReadinessReport {
  ready: boolean;
  probe: boolean;
  modes: Record<string, string>;
  summary: { total: number; required: number; missing: number; unverified: number; manual: number; failed: number };
  checks: Array<{ id: string; required: boolean; status: string }>;
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

test.describe('真实接口接入自检 @smoke @api', () => {
  test('接口必须登录，且不会暴露密钥', async ({ request }) => {
    const anonymous = await request.get('/api/health/integrations');
    expect(anonymous.status()).toBe(401);

    const login = await request.post('/api/auth/login', { data: DEMO });
    expect(login.ok()).toBeTruthy();
    const session = await login.json() as ApiEnvelope<{ accessToken: string }>;

    const response = await request.get('/api/health/integrations', {
      headers: { Authorization: `Bearer ${session.data.accessToken}` },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as ApiEnvelope<ReadinessReport>;
    expect(body.code).toBe(0);
    expect(body.data.probe).toBe(false);
    expect(body.data.summary.total).toBe(body.data.checks.length);
    expect(body.data.checks.map((item) => item.id)).toEqual(expect.arrayContaining([
      'deepseek',
      'serpapi',
      'platform_douyin',
      'platform_kuaishou',
      'platform_bilibili',
      'platform_video_account',
      'platform_xiaohongshu',
      'platform_baijiahao',
    ]));
    expect(allKeys(body).some((key) => /key|password|secret|credential|token/i.test(key))).toBe(false);
  });

  test('超级管理员可查看接入自检页面', async ({ page }) => {
    await page.goto('/system/integrations');
    await expect(page.getByText('真实接口接入自检').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '执行真实连通检查' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'DeepSeek', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '视频号', exact: true })).toBeVisible();
  });
});
