import { test as setup, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');

setup('authenticate via login', async ({ page }) => {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  await page.goto('/login');
  await page.getByPlaceholder('手机号').fill(DEMO.phone);
  await page.getByPlaceholder('密码').fill(DEMO.password);
  await page.getByRole('button', { name: /登\s?录/ }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('数据总览').first()).toBeVisible({ timeout: 20_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
