const { test, expect } = require('@playwright/test');
const {
  assertNoClientErrors,
  setupClientErrorCapture,
} = require('./support/frontend-helpers');

const REMOTE_CLIENT_IP = '203.0.113.10';

async function ensureAtLeastOneTrack(page) {
  await expect.poll(() => page.locator('.track-card').count(), { timeout: 30000 }).toBeGreaterThan(0);
}

test('slave local playback starts real audio after play click', async ({ page, request }) => {
  const capture = setupClientErrorCapture(page);

  await request.post('/api/layout/reset');

  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    const createdAudios = [];

    function WrappedAudio(...args) {
      const audio = new NativeAudio(...args);
      createdAudios.push(audio);
      return audio;
    }

    WrappedAudio.prototype = NativeAudio.prototype;
    window.Audio = WrappedAudio;
    window.__djtronCreatedAudios = createdAudios;
  });

  await page.route('**/*', async (route) => {
    const headers = {
      ...route.request().headers(),
      'x-forwarded-for': REMOTE_CLIENT_IP,
    };
    await route.continue({ headers });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#authOverlay')).toBeVisible();
  await page.fill('#authUsername', 'tablet');
  await page.fill('#authPassword', '123456');
  await page.click('#authSubmit');
  await expect(page.locator('#authOverlay')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-role', 'slave');

  await ensureAtLeastOneTrack(page);
  await page.locator('.track-card .play').first().click();

  await expect.poll(() => page.evaluate(() => {
    const pool = Array.isArray(window.__djtronCreatedAudios) ? window.__djtronCreatedAudios : [];
    return pool.some((audio) => audio && audio.paused === false);
  }), { timeout: 10000 }).toBe(true);

  assertNoClientErrors(capture);
});
