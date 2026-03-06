const { test, expect } = require('@playwright/test');
const {
  assertNoClientErrors,
  bootstrapHostPage,
  localStorageValue,
  setCheckboxValue,
  setupClientErrorCapture,
} = require('./support/frontend-helpers');

function collectUpdateCheckFlags(page, target) {
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    if (!request.url().includes('/api/update/check')) return;
    const parsed = new URL(request.url());
    target.push(parsed.searchParams.get('allowPrerelease'));
  });
}

test('app version is shown and prerelease toggle persists and affects update-check', async ({ page, request }) => {
  const capture = setupClientErrorCapture(page);
  const updateCheckFlags = [];
  collectUpdateCheckFlags(page, updateCheckFlags);

  const versionResponse = await request.get('/api/version');
  expect(versionResponse.ok()).toBeTruthy();
  const { version } = await versionResponse.json();

  await bootstrapHostPage(page, request, { resetBeforeLoad: true, clearStorage: true });
  await expect(page.locator('#appVersion')).toHaveText(`Версия: ${version}`);

  await expect.poll(() => updateCheckFlags.length).toBeGreaterThan(0);
  expect(updateCheckFlags).toContain('false');

  await setCheckboxValue(page, '#allowPrerelease', true);
  await expect.poll(() => updateCheckFlags.includes('true')).toBeTruthy();
  expect(await localStorageValue(page, 'player:allowPrerelease')).toBe('true');

  const checksBeforeReload = updateCheckFlags.length;
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#allowPrerelease')).toBeChecked();
  await expect.poll(() => updateCheckFlags.length).toBeGreaterThan(checksBeforeReload);
  expect(updateCheckFlags.slice(checksBeforeReload)).toContain('true');

  assertNoClientErrors(capture);
});
