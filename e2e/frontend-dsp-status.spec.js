const { test, expect } = require('@playwright/test');
const {
  assertNoClientErrors,
  bootstrapHostPage,
  setupClientErrorCapture,
} = require('./support/frontend-helpers');

test('ffmpeg setup warning reacts to DSP status changes', async ({ page, request }) => {
  const capture = setupClientErrorCapture(page);
  let ffmpegAvailable = false;

  await page.route('**/api/dsp/transitions*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        transitions: [],
        queue: {
          enabled: true,
          ffmpegAvailable,
          ffmpegError: ffmpegAvailable ? null : 'ffmpeg not found',
          wingetCommand: 'winget install "FFmpeg (Essentials Build)"',
        },
      }),
    });
  });

  await bootstrapHostPage(page, request, { resetBeforeLoad: true, clearStorage: true });

  await expect(page.locator('#dspSetupPanel')).toBeVisible();
  await expect(page.locator('#dspSetupStatus')).toContainText('ffmpeg не найден');

  ffmpegAvailable = true;
  await page.click('#dspCheckInstall');
  await expect(page.locator('#dspSetupPanel')).toBeHidden();

  assertNoClientErrors(capture);
});
