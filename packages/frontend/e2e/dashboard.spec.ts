import { test, expect } from '@playwright/test';
import { antTableDataRows } from './helpers';

test.describe('P0 工作台与退出登录', () => {
  test('S05 Dashboard 加载:KPI/趋势图/排行榜渲染', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('数据总览').first()).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('矩阵账号数').first()).toBeVisible();
    await expect(page.getByText('累计播放量').first()).toBeVisible();

    const trendChartOrEmpty = page.locator('canvas').or(page.getByText('暂无真实趋势数据', { exact: true }));
    await expect(trendChartOrEmpty).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('账号影响力排行').first()).toBeVisible();
    await expect(antTableDataRows(page).first()).toBeVisible({ timeout: 20_000 });
  });

  test('S06 退出登录回到登录页', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('数据总览').first()).toBeVisible({ timeout: 20_000 });

    await page.locator('.ant-dropdown-trigger').first().click();
    await page.getByText('退出登录').click();

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('mvms-auth');
      if (!raw) return null;
      try {
        return JSON.parse(raw).state?.accessToken ?? null;
      } catch {
        return null;
      }
    });
    expect(stored).toBeNull();
  });
});
