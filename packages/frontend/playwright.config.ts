import { defineConfig, devices } from '@playwright/test';

const E2E_PORT = Number(process.env.E2E_PORT || 5174);
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${E2E_PORT}`;
const isCI = !!process.env.CI;
const reuseExistingServer = process.env.E2E_REUSE_SERVER === 'true';
const backendCommand = process.env.E2E_BACKEND_COMMAND || 'pnpm --filter @mvms/backend dev';
const useExternalServers = process.env.E2E_EXTERNAL_SERVERS === 'true';
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL || 'mysql://local:placeholder@localhost:3307/mvms_e2e';
const e2eDatabaseName = new URL(E2E_DATABASE_URL).pathname.replace(/^\//, '');

if (!e2eDatabaseName.endsWith('_e2e')) {
  throw new Error('E2E_DATABASE_URL 必须指向以 _e2e 结尾的隔离数据库，拒绝运行以免污染业务数据');
}

const backendEnv = {
  ...process.env,
  DATABASE_URL: E2E_DATABASE_URL,
  NODE_ENV: 'test',
  AI_MODE: 'mock',
  PLATFORM_MODE: 'mock',
  DIGITAL_HUMAN_MODE: 'mock',
  GEO_MODE: 'mock',
  CRAWL_MODE: 'mock',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    channel: process.env.PLAYWRIGHT_CHANNEL as 'chrome' | undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'auth',
      testMatch: /auth\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'chromium',
      testMatch: /^(?!.*auth\.spec\.ts).*\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: 'e2e/.auth/user.json',
      },
    },
    {
      name: 'webkit-ui171',
      testMatch: /ui-171\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
        storageState: 'e2e/.auth/user.json',
      },
    },
  ],
  webServer: useExternalServers ? undefined : [
    {
      command: backendCommand,
      url: 'http://127.0.0.1:3000/api/docs',
      reuseExistingServer,
      timeout: 180_000,
      cwd: '../..',
      env: backendEnv,
    },
    {
      command: `pnpm --filter @mvms/frontend dev --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer,
      timeout: 60_000,
      cwd: '../..',
    },
  ],
});
