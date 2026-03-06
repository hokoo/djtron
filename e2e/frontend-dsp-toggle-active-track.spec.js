const { test, expect } = require('@playwright/test');
const {
  assertNoClientErrors,
  bootstrapHostPage,
  setupClientErrorCapture,
} = require('./support/frontend-helpers');

async function fetchPlaybackSnapshot(page) {
  const response = await page.evaluate(async () => {
    const res = await fetch('/api/playback');
    let body = null;
    try {
      body = await res.json();
    } catch (err) {
      body = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      body,
    };
  });
  expect(response && response.ok, `GET /api/playback failed with status ${response ? response.status : 'unknown'}`).toBe(true);
  return response.body;
}

async function waitForPlaybackSnapshot(page, predicate, message) {
  await expect.poll(
    async () => {
      const snapshot = await fetchPlaybackSnapshot(page);
      return Boolean(predicate(snapshot));
    },
    { timeout: 20000, message },
  ).toBe(true);
}

test('enabling DSP on active playing playlist queues live DSP transition', async ({ page, request }) => {
  const capture = setupClientErrorCapture(page);
  let dspTransitionPostCalls = 0;

  await page.route('**/api/dsp/transitions*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      dspTransitionPostCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ queued: true }),
      });
      return;
    }

    if (req.method() === 'GET') {
      const url = new URL(req.url());
      const toFile = url.searchParams.get('to') || '';
      const fromFile = url.searchParams.get('from') || '';
      if (!fromFile || !toFile) {
        await route.continue();
        return;
      }
      const normalizedTo = toFile.replace(/^\/+/, '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          transition: {
            status: 'ready',
            outputUrl: normalizedTo ? `/audio/${normalizedTo}` : null,
            sliceSeconds: 1,
          },
        }),
      });
      return;
    }

    await route.continue();
  });

  await bootstrapHostPage(page, request, { resetBeforeLoad: true, clearStorage: true });
  await expect.poll(() => page.locator('.track-card').count(), { timeout: 30000 }).toBeGreaterThan(1);

  const candidate = await page.evaluate(() => {
    const zones = Array.from(document.querySelectorAll('.zone'));
    for (const zone of zones) {
      const index = Number.parseInt(zone.dataset.zoneIndex || '', 10);
      if (!Number.isInteger(index) || index < 0) continue;
      const trackCards = Array.from(zone.querySelectorAll('.track-card'));
      if (trackCards.length < 2) continue;
      const autoplayToggle = zone.querySelector('.playlist-autoplay-toggle');
      const dspToggle = zone.querySelector('.playlist-dsp-toggle');
      if (!(autoplayToggle instanceof HTMLButtonElement) || !(dspToggle instanceof HTMLButtonElement)) continue;
      const firstCard = trackCards.find(
        (card) => Number.parseInt(card.dataset.playlistPosition || '-1', 10) === 0,
      );
      if (!firstCard) continue;
      const firstFile = typeof firstCard.dataset.file === 'string' ? firstCard.dataset.file.trim() : '';
      if (!firstFile) continue;
      return {
        playlistIndex: index,
        firstFile,
      };
    }
    return null;
  });

  test.skip(!candidate, 'requires at least one playlist with 2+ tracks and controls');

  const zoneSelector = `.zone[data-zone-index="${candidate.playlistIndex}"]`;
  const autoplayToggle = page.locator(`${zoneSelector} .playlist-autoplay-toggle`);
  const dspToggle = page.locator(`${zoneSelector} .playlist-dsp-toggle`);
  const firstTrackButton = page.locator(
    `.track-card[data-playlist-index="${candidate.playlistIndex}"][data-playlist-position="0"] .play`,
  ).first();

  await expect(autoplayToggle).toBeVisible();
  await expect(dspToggle).toBeVisible();
  await expect(firstTrackButton).toBeVisible();

  if ((await autoplayToggle.getAttribute('data-state')) !== 'on') {
    await autoplayToggle.click();
    await expect(autoplayToggle).toHaveAttribute('data-state', 'on');
  }

  if ((await dspToggle.getAttribute('data-state')) !== 'off') {
    await dspToggle.click();
    await expect(dspToggle).toHaveAttribute('data-state', 'off');
  }

  await firstTrackButton.click();
  await waitForPlaybackSnapshot(
    page,
    (snapshot) =>
      snapshot &&
      snapshot.trackFile === candidate.firstFile &&
      snapshot.playlistId !== null &&
      snapshot.paused === false,
    'first track should be playing before toggling DSP',
  );

  const callsBeforeToggle = dspTransitionPostCalls;
  await dspToggle.click();
  await expect(dspToggle).toHaveAttribute('data-state', 'on');

  await expect.poll(() => dspTransitionPostCalls).toBeGreaterThan(callsBeforeToggle);
  assertNoClientErrors(capture);
});
