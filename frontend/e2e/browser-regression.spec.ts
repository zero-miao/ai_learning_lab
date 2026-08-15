import { expect, test, type Page } from '@playwright/test';

async function expectNoPageOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1);
}

test('桌面端可完成话题到长材料阅读的核心导航', async ({ page }) => {
  const materialCollectionRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/materials/') {
      materialCollectionRequests.push(url.toString());
    }
  });
  await page.goto('/topics');
  await expect(page.getByText('浏览器回归：长材料学习')).toBeVisible();

  await page.goto('/topics/1');
  await expect(page.getByRole('heading', { name: '浏览器回归：长材料学习' }))
    .toBeVisible();
  await expect(page.getByText('可重复回归长材料', { exact: true })).toBeVisible();
  expect(materialCollectionRequests).toEqual([]);

  await page.goto('/topics/1/materials/1');
  await expect(page.getByRole('heading', { name: '可重复回归长材料' }))
    .toBeVisible();
  await expect(page.getByText('第 80 节：长材料上下文 80')).toBeVisible();
  await expect(page.getByText('回归高亮备注')).toBeAttached();
  await expectNoPageOverflow(page);
});

test('Markdown 草稿停止输入后自动保存', async ({ page }) => {
  await page.goto('/topics/1');
  await page.getByRole('button', { name: 'Markdown 写作' }).click();
  await expect(page.getByRole('dialog', { name: 'Markdown 沉浸写作' })).toBeVisible();

  await page.getByLabel('输入材料标题').fill('浏览器自动保存草稿');
  const editor = page.locator('.vditor-wysiwyg [contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('# 自动保存正文');
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 10_000 });

  const response = await page.request.get('/api/material-drafts/?topic=1&page_size=100');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: '浏览器自动保存草稿',
      }),
    ]),
  );
});

test('390px 手机视口关键页面无页面级横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    '/topics',
    '/topics/1',
    '/materials',
    '/tasks',
    '/reviews',
    '/settings',
    '/topics/1/materials/1',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoPageOverflow(page);
  }
  await expect(page.getByRole('button', { name: '退出沉浸阅读' })).toBeVisible();
});
