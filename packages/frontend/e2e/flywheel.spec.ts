import { test, expect } from '@playwright/test';

test.describe('P1 爆款二创数据飞轮', () => {
  test('飞轮统计数据加载', async ({ page }) => {
    const respPromise = page.waitForResponse(
      (r) => r.url().includes('/hit-recreation/flywheel/stats'),
      { timeout: 20_000 },
    );
    await page.goto('/hit-recreation/flywheel');
    const resp = await respPromise;
    expect(resp.status()).toBeLessThan(400);

    await expect(page.getByText('数据飞轮').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle');
  });
});
