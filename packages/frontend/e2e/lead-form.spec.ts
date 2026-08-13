import { test, expect } from '@playwright/test';

test.describe('P1 公开留资表单', () => {
  test('公开页加载并提交留资', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('数据总览').first()).toBeVisible({ timeout: 20_000 });

    const token = await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('mvms-auth') || '{}');
      return auth.state?.accessToken as string;
    });
    const created = await page.request.post('/api/lead-forms', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: `E2E公开留资表单-${Date.now()}`,
        template: 'consult',
        fields: [
          { name: 'name', label: '姓名', type: 'text', required: true },
          { name: 'phone', label: '电话', type: 'tel', required: true },
        ],
      },
    });
    expect(created.ok()).toBeTruthy();
    const createdBody = await created.json() as { data: { id: string } };
    const formId = createdBody.data.id;

    await page.goto(`/lead/${formId}`);
    await expect(page.locator('h3.ant-typography').first()).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('姓名').fill('E2E客户');
    await page.getByLabel('电话').fill('13900000999');

    const respPromise = page.waitForResponse(
      (r) => r.url().includes('/lead-forms/submit') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: /提\s?交/ }).click();
    const resp = await respPromise;
    expect(resp.status()).toBeLessThan(400);

    await expect(page.locator('.ant-message-notice').filter({ hasText: '提交成功' }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('无效表单 id 显示 404', async ({ page }) => {
    await page.goto('/lead/non-existent-form-id');
    await expect(page.getByText('表单不存在').first()).toBeVisible({ timeout: 15_000 });
  });
});
