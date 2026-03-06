const { test, expect } = require('@playwright/test');
const {
  assertNoClientErrors,
  bootstrapHostPage,
  setupClientErrorCapture,
} = require('./support/frontend-helpers');

test('frontend bootstraps playlists from /audio and applies default settings', async ({ page, request }) => {
  const capture = setupClientErrorCapture(page);

  const audioResponse = await request.get('/api/audio');
  expect(audioResponse.ok()).toBeTruthy();
  const audioCatalog = await audioResponse.json();
  const folderCount = Array.isArray(audioCatalog.folders) ? audioCatalog.folders.length : 0;
  const fileCount = Array.isArray(audioCatalog.files) ? audioCatalog.files.length : 0;

  await bootstrapHostPage(page, request, { resetBeforeLoad: true, clearStorage: true });

  const zoneCount = await page.locator('.zone').count();
  expect(zoneCount).toBeGreaterThanOrEqual(Math.max(1, folderCount + 1));

  if (fileCount > 0) {
    await expect.poll(() => page.locator('.track-card').count()).toBeGreaterThan(0);
  }

  await expect(page.locator('#overlayTime')).toHaveValue('0.3');
  await expect(page.locator('#stopFadeTime')).toHaveValue('0.4');
  await expect(page.locator('#overlayEnabled')).toBeChecked();
  await expect(page.locator('#stopFadeEnabled')).toBeChecked();

  assertNoClientErrors(capture);
});
