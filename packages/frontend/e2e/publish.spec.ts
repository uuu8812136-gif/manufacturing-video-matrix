import { test, expect } from '@playwright/test';

test.describe('P1 一键发布', () => {
  test('单条发布表单加载与校验', async ({ page }) => {
    await page.goto('/distribution/publish');
    await expect(page.getByText('一键发布').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('单条发布').first()).toBeVisible();

    await page.getByRole('button', { name: '立即发布 / 定时' }).click();
    await expect(page.locator('.ant-form-item-explain-error').first()).toBeVisible({ timeout: 10_000 });
  });

  test('批量导入 Tab 切换与添加条目', async ({ page }) => {
    await page.goto('/distribution/publish');
    await expect(page.getByText('一键发布').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('tab', { name: /批量导入/ }).click();
    await page.getByRole('button', { name: '添加一条' }).click();
    await expect(page.getByPlaceholder('视频标题 1')).toBeVisible();
  });
});
