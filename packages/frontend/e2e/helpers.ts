import { expect, type Page, type Locator } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

try {
  loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI may inject credentials directly without mounting a workspace .env file.
}

export const DEMO = {
  phone: process.env.SEED_ADMIN_PHONE || '13800000000',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
};

export async function waitForPageReady(page: Page, titleText?: string) {
  await page.waitForLoadState('networkidle');
  if (titleText) {
    await expect(page.getByText(titleText).first()).toBeVisible({ timeout: 20_000 });
  }
}

export async function antMessage(page: Page, text: string) {
  await expect(page.locator('.ant-message-notice').filter({ hasText: text }).first()).toBeVisible({
    timeout: 10_000,
  });
}

export async function openModalWithButton(page: Page, buttonText: string) {
  await page.getByRole('button', { name: buttonText }).click();
  await expect(page.locator('.ant-modal-content').first()).toBeVisible({ timeout: 10_000 });
}

export async function antSelectOption(page: Page, selectLocator: Locator, optionText: string) {
  await selectLocator.click();
  await page.locator('.ant-select-item').filter({ hasText: optionText }).first().click();
}

export function antTableDataRows(page: Page) {
  return page.locator('.ant-table-tbody tr:not(.ant-table-measure-row)');
}

export async function expectNoConsoleErrors(page: Page, ignore: RegExp[] = []) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!ignore.some((r) => r.test(t))) errors.push(t);
    }
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}
