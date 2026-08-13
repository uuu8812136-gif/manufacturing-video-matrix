import { test, expect } from '@playwright/test';

test.describe('P1 AI 智能写作', () => {
  test('敏感词检测流程', async ({ page }) => {
    await page.goto('/ai-creation/writing', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('AI 智能写作').first()).toBeVisible({ timeout: 20_000 });

    await page.locator('.ant-segmented').getByText('敏感词', { exact: true }).click();
    const textarea = page.getByPlaceholder('粘贴文案进行敏感词检测（8万+词库）');
    await textarea.fill('断桥铝门窗隔音40分贝源头工厂直发');

    const respPromise = page.waitForResponse(
      (r) => r.url().includes('/ai-creation/sensitive-check') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: '开始检测' }).click();
    const resp = await respPromise;
    expect(resp.status()).toBeLessThan(400);

    await expect(page.getByText('未检测到敏感词').first()).toBeVisible({ timeout: 15_000 });
  });

  test('生成标题流程', async ({ page }) => {
    await page.goto('/ai-creation/writing', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('AI 智能写作').first()).toBeVisible({ timeout: 20_000 });

    await page.locator('.ant-segmented').getByText('标题', { exact: true }).click();
    await page.getByPlaceholder('输入主题').first().fill('断桥铝门窗隔音实测');

    const respPromise = page.waitForResponse(
      (r) => r.url().includes('/ai-creation/generate-titles') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: /生成/ }).click();
    const resp = await respPromise;
    expect(resp.status()).toBeLessThan(400);

    await expect(page.getByText('生成结果').first()).toBeVisible({ timeout: 15_000 });
  });
});
