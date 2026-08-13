import { expect, test, type Page } from '@playwright/test';

const CORE_PAGES = [
  { path: '/dashboard', title: '数据总览' },
  { path: '/accounts', title: '账号矩阵管理' },
  { path: '/distribution/contents', title: '内容库' },
  { path: '/leads/pool', title: '线索池' },
  { path: '/system/security', title: '安全设置' },
] as const;

async function expectHealthyPage(page: Page, path: string, title: string) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(path);
  await page.waitForLoadState('networkidle');

  await expect(page.getByText(title).first()).toBeVisible();
  expect(pageErrors, `${path} 不应出现未捕获异常`).toHaveLength(0);

  const visibleText = await page.locator('body').innerText();
  expect(visibleText, `${path} 不应出现 Unicode 替换字符`).not.toContain('\uFFFD');

  const sidebar = page.locator('.ant-layout-sider').filter({ visible: true }).first();
  await expect(sidebar).toBeVisible();
  const sidebarCanScroll = await sidebar.evaluate((element) => {
    let current: Element | null = element;
    while (current) {
      const style = getComputedStyle(current);
      if (
        current.scrollHeight <= current.clientHeight + 1
        || ['auto', 'scroll', 'overlay'].includes(style.overflowY)
      ) {
        return true;
      }
      current = current.firstElementChild;
    }
    return false;
  });
  expect(sidebarCanScroll, `${path} 侧栏内容应可见或可垂直滚动`).toBeTruthy();
}

const evidencePath = (projectName: string, name: string) =>
  `../../test-artifacts/GLM-20260721-0947/UI-171-${projectName}-${name}-20260729-rebuild2.png`;

async function expectModalInsideViewport(
  page: Page,
  openButtonName: string | RegExp,
  screenshotPath?: string,
) {
  await page.getByRole('button', { name: openButtonName }).click();
  const dialog = page.getByRole('dialog').filter({ visible: true }).first();
  const modal = page.locator('.ant-modal-content').filter({ visible: true }).first();
  await expect(dialog).toBeVisible();
  await expect(modal).toBeVisible();

  const box = await modal.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + Math.min(box!.height, viewport!.height)).toBeLessThanOrEqual(viewport!.height + 1);

  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  }
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(modal).toBeHidden();
}

test.describe('UI-171 WebKit 与响应式兼容性', () => {
  test('1440×900 核心后台页面、中文与弹窗边界', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of CORE_PAGES) {
      await expectHealthyPage(page, route.path, route.title);
    }

    await page.goto('/accounts');
    await expectModalInsideViewport(page, '绑定账号');

    await page.goto('/distribution/contents');
    await expectModalInsideViewport(
      page,
      '创建内容',
      evidencePath(testInfo.project.name, '1440x900-content-modal-fixed'),
    );
  });

  test('1024 宽度侧栏、表格横向滚动与操作按钮', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    for (const route of CORE_PAGES) {
      await expectHealthyPage(page, route.path, route.title);
    }

    for (const route of ['/accounts', '/distribution/contents', '/leads/pool']) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const table = page.locator('.ant-table-container').first();
      await expect(table).toBeVisible();

      const horizontalScrollIsContained = await table.evaluate((element) => {
        const candidates = [
          element,
          ...Array.from(element.querySelectorAll('.ant-table-content, .ant-table-body')),
        ];
        return candidates.some((candidate) => {
          const style = getComputedStyle(candidate);
          return (
            candidate.scrollWidth <= candidate.clientWidth + 1
            || ['auto', 'scroll', 'overlay'].includes(style.overflowX)
          );
        });
      });
      expect(horizontalScrollIsContained, `${route} 表格应在自身容器内横向滚动`).toBeTruthy();
    }

    await page.goto('/accounts');
    await expectModalInsideViewport(page, '绑定账号');
    await page.goto('/distribution/contents');
    await expectModalInsideViewport(page, '创建内容');
    await page.goto('/accounts');
    const search = page.getByPlaceholder('搜索账号昵称');
    await search.fill('UI-171');
    await search.press('Enter');
    await expect(search).toHaveValue('UI-171');
    await page.screenshot({
      path: evidencePath(testInfo.project.name, '1024x900-table-scroll-fixed'),
      fullPage: false,
    });
  });

  test('移动端公开留资表单无横向溢出且可提交', async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    const token = await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('mvms-auth') || '{}');
      return auth.state?.accessToken as string;
    });

    const created = await page.request.post('/api/lead-forms', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: `UI-171移动端留资-${Date.now()}`,
        template: 'consult',
        fields: [
          { name: 'name', label: '姓名', type: 'text', required: true },
          { name: 'phone', label: '电话', type: 'tel', required: true },
        ],
      },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json() as { data: { id: string } };

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/lead/${body.data.id}`);
    await expect(page.getByText('请填写以下信息，专业顾问将为您服务')).toBeVisible();

    const viewportMetrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(viewportMetrics.documentWidth).toBeLessThanOrEqual(viewportMetrics.viewportWidth + 1);

    await page.getByLabel('姓名').fill('UI-171客户');
    await page.getByLabel('电话').fill('13900000171');
    const submit = page.getByRole('button', { name: /提\s*交/ });
    await submit.scrollIntoViewIfNeeded();

    const submitBox = await submit.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.x).toBeGreaterThanOrEqual(0);
    expect(submitBox!.x + submitBox!.width).toBeLessThanOrEqual(391);

    const response = page.waitForResponse(
      (candidate) => candidate.url().includes('/lead-forms/submit')
        && candidate.request().method() === 'POST',
    );
    await submit.click();
    expect((await response).status()).toBeLessThan(400);
    await expect(page.locator('.ant-message-notice').filter({ hasText: '提交成功' }).first()).toBeVisible();
    await page.screenshot({
      path: evidencePath(testInfo.project.name, 'mobile-form-390x844-fixed'),
      fullPage: false,
    });
  });
});
