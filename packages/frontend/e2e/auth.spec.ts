import { test, expect } from '@playwright/test';
import { DEMO } from './helpers';

test.describe('P0 认证冒烟测试', () => {
  test('S01 正常登录跳转 Dashboard', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByPlaceholder('手机号').fill(DEMO.phone);
    await page.getByPlaceholder('密码').fill(DEMO.password);
    await page.getByRole('button', { name: /登\s?录/ }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('数据总览').first()).toBeVisible({ timeout: 20_000 });

    const stored = await page.evaluate(() => localStorage.getItem('mvms-auth'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored as string);
    expect(parsed.state.accessToken).toBeTruthy();
  });

  test('S02 错误密码不跳转', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('手机号').fill(DEMO.phone);
    await page.getByPlaceholder('密码').fill('wrong-password');
    await page.getByRole('button', { name: /登\s?录/ }).click();

    await expect(page.getByText('手机号或密码错误').first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('S03 未登录访问受保护路由重定向到 /login', async ({ page }) => {
    await page.goto('/accounts');
    await expect(page).toHaveURL(/\/login/);
  });

  test('S04 表单校验:空提交显示必填提示', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /登\s?录/ }).click();
    await expect(page.getByText('请输入手机号')).toBeVisible();
    await expect(page.getByText('请输入密码')).toBeVisible();
  });

  test('S05 内容编辑无法访问成员与渠道管理页面及接口', async ({ page, request }) => {
    const adminLogin = await request.post('/api/auth/login', { data: DEMO });
    expect(adminLogin.ok()).toBeTruthy();
    const adminBody = await adminLogin.json() as { data: { accessToken: string } };
    const adminHeaders = { Authorization: `Bearer ${adminBody.data.accessToken}` };
    const suffix = String(Date.now()).slice(-8);
    const phone = `136${suffix}`;
    const password = 'E2eRole#2026';

    const created = await request.post('/api/users/members', {
      headers: adminHeaders,
      data: {
        phone,
        name: `E2E权限成员-${suffix}`,
        password,
        role: 'content_editor',
      },
    });
    expect(created.ok()).toBeTruthy();
    const createdBody = await created.json() as { data: { id: string } };

    try {
      await page.goto('/login');
      await page.getByPlaceholder('手机号').fill(phone);
      await page.getByPlaceholder('密码').fill(password);
      await page.getByRole('button', { name: /登\s?录/ }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      const stored = await page.evaluate(() => localStorage.getItem('mvms-auth'));
      expect(stored).toBeTruthy();
      const editorToken = (JSON.parse(stored as string) as {
        state: { accessToken: string };
      }).state.accessToken;
      const editorHeaders = { Authorization: `Bearer ${editorToken}` };

      await page.goto('/system/members');
      await expect(page).toHaveURL(/\/dashboard/);
      await page.goto('/channel');
      await expect(page).toHaveURL(/\/dashboard/);

      const members = await request.get('/api/users/members', { headers: editorHeaders });
      expect(members.status()).toBe(403);
      expect(await members.text()).not.toContain(DEMO.phone);

      const channels = await request.get('/api/channels', { headers: editorHeaders });
      expect(channels.status()).toBe(403);
    } finally {
      const removed = await request.delete(`/api/users/members/${createdBody.data.id}`, {
        headers: adminHeaders,
      });
      expect(removed.ok()).toBeTruthy();
    }
  });
});
