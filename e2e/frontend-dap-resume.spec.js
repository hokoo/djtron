const { test, expect } = require('@playwright/test');
const {
  assertNoClientErrors,
  bootstrapHostPage,
  setSelectValueAndCommit,
  setupClientErrorCapture,
} = require('./support/frontend-helpers');

function toLegacyFilePathFromTrack(track) {
  if (typeof track === 'string' && track.trim()) {
    let normalizedString = track.trim();
    if (normalizedString.startsWith('/audio/')) normalizedString = normalizedString.slice('/audio/'.length);
    else if (normalizedString.startsWith('audio/')) normalizedString = normalizedString.slice('audio/'.length);
    else normalizedString = normalizedString.replace(/^\/+/, '');
    return normalizedString.trim();
  }

  if (track && track.meta && typeof track.meta.originalPath === 'string' && track.meta.originalPath.trim()) {
    return track.meta.originalPath.trim();
  }

  const src = typeof (track && track.src) === 'string' ? track.src.trim() : '';
  if (!src) return '';

  let normalized = src.replace(/^https?:\/\/[^/]+/i, '');
  const queryIndex = normalized.indexOf('?');
  if (queryIndex >= 0) normalized = normalized.slice(0, queryIndex);
  const hashIndex = normalized.indexOf('#');
  if (hashIndex >= 0) normalized = normalized.slice(0, hashIndex);
  if (normalized.startsWith('/audio/')) normalized = normalized.slice('/audio/'.length);
  else if (normalized.startsWith('audio/')) normalized = normalized.slice('audio/'.length);
  else normalized = normalized.replace(/^\/+/, '');
  return normalized.trim();
}

function pickFirstPlayableTrack(playlist) {
  const tracks = Array.isArray(playlist && playlist.tracks) ? playlist.tracks : [];
  for (let index = 0; index < tracks.length; index += 1) {
    const file = toLegacyFilePathFromTrack(tracks[index]);
    if (!file) continue;
    return {
      file,
      playlistPosition: index,
    };
  }
  return null;
}

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

test('DAP resumes after pausing non-DAP track and playback remains controllable', async ({ page, request }) => {
  const capture = setupClientErrorCapture(page);
  await bootstrapHostPage(page, request, { resetBeforeLoad: false, clearStorage: true });

  await expect.poll(() => page.locator('.track-card').count(), { timeout: 30000 }).toBeGreaterThan(0);

  const layoutResult = await page.evaluate(async () => {
    const res = await fetch('/api/layout');
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
  expect(
    layoutResult && layoutResult.ok,
    `GET /api/layout failed with status ${layoutResult ? layoutResult.status : 'unknown'}`,
  ).toBe(true);
  const layoutPayload =
    layoutResult && layoutResult.body && typeof layoutResult.body === 'object'
      ? layoutResult.body
      : {};
  const playlists = Array.isArray(layoutPayload.playlists) ? layoutPayload.playlists : [];

  const playable = playlists
    .map((playlist, playlistIndex) => ({
      playlistIndex,
      playlistId: typeof (playlist && playlist.id) === 'string' ? playlist.id : null,
      track: pickFirstPlayableTrack(playlist),
    }))
    .filter((entry) => Boolean(entry.track));

  test.skip(playable.length < 2, 'requires at least two non-empty playlists');

  const dapCandidate = playable[0];
  const liveCandidate =
    playable.find(
      (entry) =>
        entry.playlistIndex !== dapCandidate.playlistIndex &&
        entry.track.file !== dapCandidate.track.file,
    ) ||
    playable.find((entry) => entry.playlistIndex !== dapCandidate.playlistIndex);

  test.skip(!liveCandidate, 'requires two distinct playable playlists');

  const dapTrackSelector = `.track-card[data-playlist-index="${dapCandidate.playlistIndex}"][data-playlist-position="${dapCandidate.track.playlistPosition}"] .play`;
  const liveTrackSelector = `.track-card[data-playlist-index="${liveCandidate.playlistIndex}"][data-playlist-position="${liveCandidate.track.playlistPosition}"] .play`;
  const dapTrackButton = page.locator(dapTrackSelector).first();
  const liveTrackButton = page.locator(liveTrackSelector).first();

  await expect(dapTrackButton).toBeVisible();
  await expect(liveTrackButton).toBeVisible();

  const dapEnabledToggle = page.locator('#dapEnabled');
  if (!(await dapEnabledToggle.isChecked())) {
    await dapEnabledToggle.click();
  }
  await expect(dapEnabledToggle).toBeChecked();

  const dapPlaylistSelect = page.locator('#dapPlaylistSelect');
  const targetDapPlaylistValue = String(dapCandidate.playlistIndex);
  if ((await dapPlaylistSelect.inputValue()) !== targetDapPlaylistValue) {
    await setSelectValueAndCommit(page, '#dapPlaylistSelect', targetDapPlaylistValue);
  }

  await dapTrackButton.click();
  await waitForPlaybackSnapshot(
    page,
    (snapshot) =>
      snapshot &&
      snapshot.trackFile === dapCandidate.track.file &&
      snapshot.playlistId === dapCandidate.playlistId &&
      snapshot.paused === false,
    'DAP track should start',
  );

  await liveTrackButton.click();
  await waitForPlaybackSnapshot(
    page,
    (snapshot) =>
      snapshot &&
      snapshot.trackFile === liveCandidate.track.file &&
      snapshot.playlistId === liveCandidate.playlistId &&
      snapshot.paused === false,
    'Live playback should switch to non-DAP track',
  );

  await expect(page.locator('#nowPlayingControl')).toBeEnabled();
  await page.click('#nowPlayingControl');

  await waitForPlaybackSnapshot(
    page,
    (snapshot) =>
      snapshot &&
      snapshot.trackFile === dapCandidate.track.file &&
      snapshot.playlistId === dapCandidate.playlistId &&
      snapshot.paused === false,
    'DAP should auto-resume after pausing non-DAP track',
  );

  await liveTrackButton.click();
  await waitForPlaybackSnapshot(
    page,
    (snapshot) =>
      snapshot &&
      snapshot.trackFile === liveCandidate.track.file &&
      snapshot.playlistId === liveCandidate.playlistId &&
      snapshot.paused === false,
    'Playback commands should stay responsive after DAP auto-resume',
  );

  assertNoClientErrors(capture);
});
