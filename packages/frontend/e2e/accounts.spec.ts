import { test, expect, type APIRequestContext } from '@playwright/test';
import { antMessage, openModalWithButton, antSelectOption, antTableDataRows, DEMO } from './helpers';

let fixtureAccountId = '';

async function authenticatedHeaders(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', { data: DEMO });
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { data: { accessToken: string } };
  return { Authorization: `Bearer ${body.data.accessToken}` };
}

test.describe('P1 账号矩阵管理', () => {
  test.beforeAll(async ({ request }) => {
    // Live deployed-page smoke tests (for example the fully mocked Edge
    // verification UI case) must not create fake platform accounts in the
    // business database. The normal isolated mvms_e2e run keeps the fixture.
    if (process.env.E2E_LIVE_READONLY === 'true') return;
    const headers = await authenticatedHeaders(request);
    const existing = await request.get('/api/accounts', {
      headers,
      params: { keyword: 'E2E佛山测试账号', pageSize: '100' },
    });
    expect(existing.ok()).toBeTruthy();
    const existingBody = await existing.json() as { data?: { list?: { id: string }[] } };
    for (const account of existingBody.data?.list || []) {
      const removed = await request.delete(`/api/accounts/${account.id}`, { headers });
      expect(removed.ok()).toBeTruthy();
    }

    const created = await request.post('/api/accounts', {
      headers,
      data: {
        platform: 'douyin',
        nickname: 'E2E佛山测试账号',
        authType: 'cookie',
        credentials: `mock:accounts-suite:${Date.now()}`,
      },
    });
    expect(created.ok()).toBeTruthy();
    const createdBody = await created.json() as { data: { id: string } };
    fixtureAccountId = createdBody.data.id;
  });

  test.afterAll(async ({ request }) => {
    if (process.env.E2E_LIVE_READONLY === 'true') return;
    if (!fixtureAccountId) return;
    const headers = await authenticatedHeaders(request);
    const removed = await request.delete(`/api/accounts/${fixtureAccountId}`, { headers });
    expect(removed.ok()).toBeTruthy();
  });

  test('账号列表加载与搜索过滤', async ({ page }) => {
    await page.goto('/accounts');
    await expect(page.getByText('账号矩阵管理').first()).toBeVisible({ timeout: 20_000 });
    await expect(antTableDataRows(page).first()).toBeVisible({ timeout: 20_000 });

    const totalText = await page.getByText(/共 \d+ 条/).first().textContent();
    expect(totalText).toBeTruthy();

    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/api/accounts') && url.searchParams.get('keyword') === '佛山';
    });
    await page.getByPlaceholder('搜索账号昵称').fill('佛山');
    await searchResponse;
    await expect(antTableDataRows(page).first()).toBeVisible();
  });

  test('账号列表提供归类入口', async ({ page }) => {
    await page.goto('/accounts');
    await expect(antTableDataRows(page).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: '归类' }).first()).toBeVisible();
  });

  test('账号刷新发现登录态过期时给出明确提示', async ({ page }) => {
    await page.route('**/api/accounts/*/refresh', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            id: 'expired-account',
            status: 'expired',
            loginReason: 'Cookie invalid: redirected to login page',
          },
        }),
      });
    });

    await page.goto('/accounts');
    await expect(antTableDataRows(page).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '刷新' }).first().click();

    await antMessage(page, '账号登录态已过期，请重新扫码登录');
  });

  test('平台筛选触发带参数请求', async ({ page }) => {
    await page.goto('/accounts');
    await expect(antTableDataRows(page).first()).toBeVisible({ timeout: 20_000 });

    const reqPromise = page.waitForRequest(
      (r) => r.url().includes('/api/accounts') && r.url().includes('platform=douyin'),
      { timeout: 15_000 },
    );
    await page.locator('.ant-select').first().click();
    await page.locator('.ant-select-item').filter({ hasText: '抖音' }).first().click();
    await reqPromise;
  });

  test('绑定账号弹窗提交成功', async ({ page }) => {
    await page.goto('/accounts');
    await expect(antTableDataRows(page).first()).toBeVisible({ timeout: 20_000 });
    const token = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('mvms-auth') || '{}') as { state?: { accessToken?: string } };
      return stored.state?.accessToken || '';
    });
    const authHeaders = { Authorization: `Bearer ${token}` };
    const previous = await page.request.get('/api/accounts', {
      headers: authHeaders,
      params: { keyword: 'E2E测试账号', pageSize: '100' },
    });
    const previousBody = await previous.json() as { data?: { list?: { id: string }[] } };
    for (const account of previousBody.data?.list || []) {
      await page.request.delete(`/api/accounts/${account.id}`, { headers: authHeaders });
    }

    await openModalWithButton(page, '绑定账号');
    await expect(page.getByText('绑定平台账号').first()).toBeVisible();

    const modal = page.locator('.ant-modal-content').filter({ hasText: '绑定平台账号' });
    await antSelectOption(page, modal.locator('.ant-select').first(), '抖音');
    const authTypeItem = modal.locator('.ant-form-item').filter({ hasText: '授权方式' });
    await antSelectOption(page, authTypeItem.locator('.ant-select'), '手工凭据');
    await modal.getByPlaceholder('用于系统内显示；扫码后会优先使用平台昵称').fill('E2E测试账号');
    await modal.getByPlaceholder('Cookie / Access Token（将使用 AES-256-GCM 加密存储）').fill('mock:cookie:e2e');

    const respPromise = page.waitForResponse((r) => r.url().includes('/api/accounts') && r.request().method() === 'POST', { timeout: 15_000 });
    await page.locator('.ant-modal-footer').getByRole('button', { name: '确 定' }).click();
    const resp = await respPromise;
    expect(resp.status()).toBeLessThan(400);
    const body = await resp.json() as { data: { id: string } };

    await antMessage(page, '绑定成功');
    await expect(page.locator('.ant-modal-content').first()).not.toBeVisible({ timeout: 10_000 });
    const removed = await page.request.delete(`/api/accounts/${body.data.id}`, { headers: authHeaders });
    expect(removed.ok()).toBeTruthy();
  });

  test('扫码获取失败后关闭再打开弹窗不残留错误状态', async ({ page }) => {
    await page.route('**/api/accounts/scan/start', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '模拟扫码服务故障' }),
      });
    });

    await page.goto('/accounts');
    await expect(page.getByText('账号矩阵管理').first()).toBeVisible({ timeout: 20_000 });
    await openModalWithButton(page, '绑定账号');

    const modal = page.locator('.ant-modal-content').filter({ hasText: '绑定平台账号' });
    await antSelectOption(page, modal.locator('.ant-select').first(), '抖音');
    const nicknameInput = modal.getByPlaceholder('用于系统内显示；扫码后会优先使用平台昵称');
    await nicknameInput.fill('扫码失败状态重置测试');
    await modal.getByRole('button', { name: '获取二维码' }).click();

    await expect(modal.getByText('获取二维码失败：模拟扫码服务故障')).toBeVisible();
    await expect(modal.getByRole('button', { name: '重新获取二维码' })).toBeVisible();

    await modal.locator('.ant-modal-close').click();
    await expect(modal).not.toBeVisible();
    await openModalWithButton(page, '绑定账号');

    const reopenedModal = page.locator('.ant-modal-content').filter({ hasText: '绑定平台账号' });
    await expect(reopenedModal.getByText('获取二维码失败：模拟扫码服务故障')).toHaveCount(0);
    await expect(reopenedModal.getByRole('button', { name: '重新获取二维码' })).toHaveCount(0);
    await expect(reopenedModal.getByRole('button', { name: '获取二维码' })).toBeVisible();
    await expect(reopenedModal.getByPlaceholder('用于系统内显示；扫码后会优先使用平台昵称')).toHaveValue('');
  });

  test('整张平台登录页截图不会被误显示为二维码', async ({ page }) => {
    const loginPageScreenshot = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="white"/></svg>',
    )}`;
    let statusRequestCount = 0;

    await page.route('**/api/accounts/scan/rectangular-session/status', async (route) => {
      statusRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { status: 'waiting' } }),
      });
    });
    await page.route('**/api/accounts/scan/rectangular-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: null }),
      });
    });
    await page.route('**/api/accounts/scan/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            sessionId: 'rectangular-session',
            platform: 'xiaohongshu',
            qrImage: loginPageScreenshot,
            expiresIn: 300,
            qrVersion: 1,
          },
        }),
      });
    });

    await page.goto('/accounts');
    await expect(page.getByText('账号矩阵管理').first()).toBeVisible({ timeout: 20_000 });
    await openModalWithButton(page, '绑定账号');

    const modal = page.locator('.ant-modal-content').filter({ hasText: '绑定平台账号' });
    await antSelectOption(page, modal.locator('.ant-select').first(), '小红书');
    await modal.getByPlaceholder('用于系统内显示；扫码后会优先使用平台昵称').fill('登录页截图拦截测试');
    await modal.getByRole('button', { name: '获取二维码' }).click();

    await expect(modal.getByText('获取二维码失败：平台未返回可扫描二维码，请重新获取')).toBeVisible();
    await expect(modal.getByAltText('平台登录二维码')).toHaveCount(0);
    await expect(modal.getByRole('button', { name: '重新获取二维码' })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(statusRequestCount).toBe(0);
  });

  test('抖音安全验证使用已打开的 Edge 官方窗口而不是黑屏 VNC', async ({ page }) => {
    const squareQrImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">'
      + '<rect width="160" height="160" fill="white"/>'
      + '<rect x="16" y="16" width="48" height="48" fill="black"/>'
      + '<rect x="96" y="16" width="48" height="48" fill="black"/>'
      + '<rect x="16" y="96" width="48" height="48" fill="black"/>'
      + '</svg>',
    )}`;
    await page.route('**/api/accounts/scan/edge-session/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            status: 'security_verification',
            message: '请完成抖音官方安全验证',
          },
        }),
      });
    });
    await page.route('**/api/accounts/scan/edge-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: null }),
      });
    });
    await page.route('**/api/accounts/scan/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            sessionId: 'edge-session',
            platform: 'douyin',
            qrImage: squareQrImage,
            expiresIn: 300,
            qrVersion: 1,
          },
        }),
      });
    });

    await page.goto('/accounts');
    await expect(page.getByText('账号矩阵管理').first()).toBeVisible({ timeout: 20_000 });
    await openModalWithButton(page, '绑定账号');
    const modal = page.locator('.ant-modal-content').filter({ hasText: '绑定平台账号' });
    await antSelectOption(page, modal.locator('.ant-select').first(), '抖音');
    await modal.getByPlaceholder('用于系统内显示；扫码后会优先使用平台昵称').fill('Edge官方验证测试');
    await modal.getByRole('button', { name: '获取二维码' }).click();

    await expect(modal.getByText('请在已打开的 Edge 官方窗口完成验证')).toBeVisible({ timeout: 10_000 });
    await expect(modal.getByText('验证成功后系统会保存登录态并自动关闭窗口')).toBeVisible();
    await expect(modal.getByRole('button', { name: '打开抖音官方身份验证窗口' })).toHaveCount(0);
    expect(await page.locator('a[href*="6080"], a[href*="vnc.html"]').count()).toBe(0);
  });
});
