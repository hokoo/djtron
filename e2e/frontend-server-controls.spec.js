const { test, expect } = require('@playwright/test');
const {
  assertNoClientErrors,
  bootstrapHostPage,
  setupClientErrorCapture,
} = require('./support/frontend-helpers');

test('host stop-server button sends shutdown request and shows status', async ({ page, request }) => {
  const capture = setupClientErrorCapture(page);
  let shutdownCalls = 0;

  await page.route('**/api/shutdown', async (route) => {
    shutdownCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ message: 'Server is stopping' }),
    });
  });

  await page.addInitScript(() => {
    window.open = () => window;
    window.close = () => {};
  });

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await bootstrapHostPage(page, request, { resetBeforeLoad: true, clearStorage: true });
  await expect(page.locator('#stopServer')).toBeVisible();
  await expect(page.locator('#stopServer')).toBeEnabled();

  await page.click('#stopServer');
  await expect.poll(() => shutdownCalls).toBe(1);
  await expect(page.locator('#status')).toContainText('Сервер останавливается');

  assertNoClientErrors(capture);
});
