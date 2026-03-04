// public/modules/ui/nowplaying.js — now playing panel + seek

import { state, SETTINGS_KEYS, NOW_PLAYING_IDLE_TITLE, HOST_NOW_PLAYING_IDLE_TITLE,
  DAP_NOW_PLAYING_IDLE_TITLE, NOW_PLAYING_SEEK_DRAG_THRESHOLD_PX,
  NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS, NOW_PLAYING_TOGGLE_ZONE_HALF_WIDTH_PX,
  NOW_PLAYING_REEL_BASE_SPIN_SECONDS, NOW_PLAYING_REEL_FAST_SPIN_SECONDS,
  NOW_PLAYING_REEL_MAX_SCRUB_SPEED_PX_PER_SEC,
  COHOST_SEEK_COMMAND_INTERVAL_MS, HOST_LIVE_SEEK_SYNC_INTERVAL_MS,
  MOBILE_PROGRESS_UI_MAX_FPS, MOBILE_PROGRESS_UI_MIN_INTERVAL_MS } from '../state.js';
import { isHostRole, isSlaveRole, isCoHostRole, isRemoteLiveMirrorRole,
  updateDapNowPlayingVisibility } from '../roles.js';
import { normalizePlaybackSeekRatio } from '../config.js';
import { trackKey } from '../utils.js';

let _deps = {};

export function setNowPlayingDeps(d) {
  Object.assign(_deps, d);
}

export function stopHostProgressLoop() {
  if (state.hostProgressRaf === null) return;
  cancelAnimationFrame(state.hostProgressRaf);
  state.hostProgressRaf = null;
}

export function startHostProgressLoop() {
  if (state.hostProgressRaf !== null) return;
  const minFrameIntervalMs = _deps.getProgressUiFrameIntervalMs();
  let lastRenderTimestamp = 0;

  const tick = (timestamp) => {
    if (state.hostProgressRaf === null) return;
    const nowTimestamp = Number.isFinite(timestamp) ? timestamp : performance.now();
    if (
      minFrameIntervalMs > 0 &&
      lastRenderTimestamp > 0 &&
      nowTimestamp - lastRenderTimestamp < minFrameIntervalMs
    ) {
      state.hostProgressRaf = requestAnimationFrame(tick);
      return;
    }
    lastRenderTimestamp = nowTimestamp;
    syncHostNowPlayingPanel();
    if (state.hostProgressRaf === null) return;
    state.hostProgressRaf = requestAnimationFrame(tick);
  };
  state.hostProgressRaf = requestAnimationFrame(tick);
}

export function stopCoHostProgressLoop() {
  if (state.cohostProgressRaf === null) return;
  cancelAnimationFrame(state.cohostProgressRaf);
  state.cohostProgressRaf = null;
}

export function startCoHostProgressLoop() {
  if (state.cohostProgressRaf !== null) return;
  const minFrameIntervalMs = _deps.getProgressUiFrameIntervalMs();
  let lastRenderTimestamp = 0;

  const tick = (timestamp) => {
    if (state.cohostProgressRaf === null) return;
    const nowTimestamp = Number.isFinite(timestamp) ? timestamp : performance.now();
    if (
      minFrameIntervalMs > 0 &&
      lastRenderTimestamp > 0 &&
      nowTimestamp - lastRenderTimestamp < minFrameIntervalMs
    ) {
      state.cohostProgressRaf = requestAnimationFrame(tick);
      return;
    }
    lastRenderTimestamp = nowTimestamp;
    syncNowPlayingPanel();
    if (state.cohostProgressRaf === null) return;
    state.cohostProgressRaf = requestAnimationFrame(tick);
  };
  state.cohostProgressRaf = requestAnimationFrame(tick);
}

export function syncHostTrackHighlight(force = false) {
  const descriptor = _deps.buildHostTrackHighlightDescriptor();
  if (!force && descriptor === state.hostHighlightedDescriptor) return;
  state.hostHighlightedDescriptor = descriptor;

  _deps.clearHostTrackHighlight();
  if (descriptor === 'none') return;

  const playbackContext = {
    playlistIndex: _deps.normalizePlaylistTrackIndex(state.hostPlaybackState.playlistIndex),
    playlistPosition: _deps.normalizePlaylistTrackIndex(state.hostPlaybackState.playlistPosition),
  };
  const hostTrackKey = trackKey(state.hostPlaybackState.trackFile, '/audio');
  const targetCard = _deps.getTrackCardByContext(hostTrackKey, playbackContext);
  if (!targetCard) return;

  if (state.hostPlaybackState.paused) {
    targetCard.classList.add('is-host-paused');
    targetCard.classList.remove('is-host-playing');
    return;
  }

  targetCard.classList.add('is-host-playing');
  targetCard.classList.remove('is-host-paused');
}

export function syncHostNowPlayingPanel() {
  if (!_deps.hostNowPlayingTitleEl || !_deps.hostNowPlayingControlLabelEl) return;

  if (!isSlaveRole()) {
    stopHostProgressLoop();
    _deps.setHostNowPlayingReelActive(false);
    syncHostTrackHighlight();
    return;
  }

  if (!state.hostPlaybackState || !state.hostPlaybackState.trackFile) {
    _deps.hostNowPlayingTitleEl.textContent = HOST_NOW_PLAYING_IDLE_TITLE;
    _deps.hostNowPlayingControlLabelEl.textContent = '▶';
    _deps.setHostNowPlayingReelActive(false);
    _deps.setHostNowPlayingProgress(0);
    _deps.setHostNowPlayingTime(null);
    stopHostProgressLoop();
    syncHostTrackHighlight();
    return;
  }

  _deps.hostNowPlayingTitleEl.textContent = `Live: ${_deps.trackDisplayName(state.hostPlaybackState.trackFile)}`;
  _deps.hostNowPlayingControlLabelEl.textContent = state.hostPlaybackState.paused ? '▶' : '❚❚';
  _deps.setHostNowPlayingReelActive(true, state.hostPlaybackState.paused);

  const elapsed = _deps.getHostPlaybackElapsedSeconds();
  const duration = Number.isFinite(state.hostPlaybackState.duration) && state.hostPlaybackState.duration > 0 ? state.hostPlaybackState.duration : null;
  const progressPercent = duration ? Math.min(100, (elapsed / duration) * 100) : 0;
  const remaining = duration ? Math.max(0, duration - elapsed) : null;

  _deps.setHostNowPlayingProgress(progressPercent);
  _deps.setHostNowPlayingTime(remaining, { useCeil: true });
  _deps.refreshTrackDurationLabels(trackKey(state.hostPlaybackState.trackFile, '/audio'));
  syncHostTrackHighlight();

  if (!state.hostPlaybackState.paused && duration && remaining > 0) {
    startHostProgressLoop();
  } else {
    stopHostProgressLoop();
  }
}

export function syncDapNowPlayingPanel() {
  if (!_deps.dapNowPlayingTitleEl || !_deps.dapNowPlayingControlLabelEl) return;

  if (!updateDapNowPlayingVisibility(state.currentRole)) {
    _deps.setDapNowPlayingReelActive(false);
    _deps.setDapNowPlayingProgress(0);
    _deps.setDapNowPlayingTime(null);
    return;
  }

  const sourceState = isHostRole()
    ? _deps.buildDapPlaybackSnapshotForSync(state.dapConfig)
    : state.hostPlaybackState && typeof state.hostPlaybackState === 'object'
      ? state.hostPlaybackState.dapPlayback
      : null;
  const dapPlaybackState = _deps.sanitizeIncomingDapPlaybackState(sourceState);

  if (!dapPlaybackState.trackFile) {
    _deps.dapNowPlayingTitleEl.textContent = DAP_NOW_PLAYING_IDLE_TITLE;
    _deps.dapNowPlayingControlLabelEl.textContent = '▶';
    _deps.setDapNowPlayingReelActive(false);
    _deps.setDapNowPlayingProgress(0);
    _deps.setDapNowPlayingTime(null);
    return;
  }

  const titlePrefix = isCoHostRole() ? 'LIVE (DAP): ' : dapPlaybackState.interrupted ? 'DAP (пауза): ' : 'DAP: ';
  _deps.dapNowPlayingTitleEl.textContent = `${titlePrefix}${_deps.trackDisplayName(dapPlaybackState.trackFile)}`;
  _deps.dapNowPlayingControlLabelEl.textContent = dapPlaybackState.paused ? '▶' : '❚❚';
  _deps.setDapNowPlayingReelActive(true, dapPlaybackState.paused);

  const elapsed = _deps.getDapPlaybackElapsedSeconds(dapPlaybackState);
  const duration = Number.isFinite(dapPlaybackState.duration) && dapPlaybackState.duration > 0 ? dapPlaybackState.duration : null;
  const progressPercent = duration ? Math.min(100, (elapsed / duration) * 100) : 0;
  const remaining = duration ? Math.max(0, duration - elapsed) : null;

  _deps.setDapNowPlayingProgress(progressPercent);
  _deps.setDapNowPlayingTime(remaining, { useCeil: true });
  _deps.refreshTrackDurationLabels(trackKey(dapPlaybackState.trackFile, '/audio'));
}

export function syncNowPlayingPanelForCoHost() {
  if (!_deps.nowPlayingTitleEl || !_deps.nowPlayingControlBtn || !_deps.nowPlayingControlLabelEl) return;

  const hostTrackFile =
    state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string' ? state.hostPlaybackState.trackFile.trim() : '';
  if (!hostTrackFile) {
    if (state.nowPlayingSeekActive) {
      cleanupNowPlayingSeekInteraction();
    }
    _deps.nowPlayingTitleEl.textContent = HOST_NOW_PLAYING_IDLE_TITLE;
    _deps.nowPlayingControlLabelEl.textContent = '▶';
    _deps.nowPlayingControlBtn.disabled = true;
    _deps.setNowPlayingReelActive(false);
    _deps.setNowPlayingProgress(0);
    _deps.setNowPlayingTime(null);
    stopCoHostProgressLoop();
    return;
  }

  if (_deps.isDapTrackContext(state.hostPlaybackState, state.dapConfig)) {
    if (state.nowPlayingSeekActive) {
      cleanupNowPlayingSeekInteraction();
    }
    const dapPlaybackState = _deps.sanitizeIncomingDapPlaybackState(
      state.hostPlaybackState && typeof state.hostPlaybackState === 'object' ? state.hostPlaybackState.dapPlayback : null,
    );
    _deps.nowPlayingTitleEl.textContent = '';
    _deps.nowPlayingControlLabelEl.textContent = '▶';
    _deps.nowPlayingControlBtn.disabled = true;
    _deps.setNowPlayingReelActive(false);
    _deps.setNowPlayingProgress(0);
    _deps.setNowPlayingTime(null);
    if (dapPlaybackState.trackFile && !dapPlaybackState.paused) {
      startCoHostProgressLoop();
    } else {
      stopCoHostProgressLoop();
    }
    return;
  }

  _deps.nowPlayingTitleEl.textContent = `Live: ${_deps.trackDisplayName(hostTrackFile)}`;
  _deps.nowPlayingControlBtn.disabled = false;
  _deps.nowPlayingControlLabelEl.textContent = state.hostPlaybackState.paused ? '▶' : '❚❚';
  _deps.setNowPlayingReelActive(true, state.hostPlaybackState.paused);

  const elapsed = _deps.getHostPlaybackElapsedSeconds();
  const duration = Number.isFinite(state.hostPlaybackState.duration) && state.hostPlaybackState.duration > 0 ? state.hostPlaybackState.duration : null;
  const progressPercent = duration ? Math.min(100, (elapsed / duration) * 100) : 0;
  const remaining = duration ? Math.max(0, duration - elapsed) : null;

  _deps.setNowPlayingProgress(progressPercent);
  _deps.setNowPlayingTime(remaining, { useCeil: true });

  if (!state.hostPlaybackState.paused && duration && remaining > 0) {
    startCoHostProgressLoop();
  } else {
    stopCoHostProgressLoop();
  }
}

export function syncNowPlayingPanel() {
  if (!_deps.nowPlayingTitleEl || !_deps.nowPlayingControlBtn || !_deps.nowPlayingControlLabelEl) return;
  const isPauseLocked = _deps.isDapPauseLocked(state.currentTrack, state.currentAudio, state.dapConfig);
  _deps.nowPlayingControlBtn.classList.toggle('is-pause-locked', isPauseLocked);
  syncDapNowPlayingPanel();
  _deps.updateVolumePresetsUi();

  if (isCoHostRole()) {
    _deps.setDspTransitionReelReverse(false);
    const hostTrackKey =
      state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string' && state.hostPlaybackState.trackFile.trim()
        ? trackKey(state.hostPlaybackState.trackFile, '/audio')
        : null;
    if (state.activeDurationTrackKey && state.activeDurationTrackKey !== hostTrackKey) {
      _deps.refreshTrackDurationLabels(state.activeDurationTrackKey);
    }
    state.activeDurationTrackKey = hostTrackKey;
    syncNowPlayingPanelForCoHost();
    if (hostTrackKey) {
      _deps.refreshTrackDurationLabels(hostTrackKey);
    }
    return;
  }

  if (_deps.isDspTransitionPlaybackActive()) {
    const playback = state.dspTransitionPlayback;
    const transitionAudio = playback && playback.audio ? playback.audio : null;
    const sourceTrack = playback && playback.fromTrack ? playback.fromTrack : null;
    const targetTrack = playback && playback.toTrack ? playback.toTrack : null;

    _deps.nowPlayingTitleEl.textContent =
      sourceTrack && targetTrack
        ? `Переход: ${_deps.trackDisplayName(sourceTrack.file)} -> ${_deps.trackDisplayName(targetTrack.file)}`
        : 'Переход...';
    _deps.nowPlayingControlLabelEl.textContent = '❚❚';
    _deps.setNowPlayingReelActive(true, false);
    _deps.setDspTransitionReelReverse(true);

    const activeDuration = _deps.getDspTransitionDurationSeconds();
    const currentTime =
      transitionAudio && Number.isFinite(transitionAudio.currentTime) && transitionAudio.currentTime >= 0
        ? transitionAudio.currentTime
        : 0;
    const progressPercent = activeDuration ? Math.min(100, (currentTime / activeDuration) * 100) : 0;
    const remaining = activeDuration ? Math.max(0, activeDuration - currentTime) : null;

    _deps.nowPlayingControlBtn.disabled = !canSeekNowPlaying();
    _deps.setNowPlayingProgress(progressPercent);
    _deps.setNowPlayingTime(remaining, { useCeil: true });
    return;
  }

  _deps.setDspTransitionReelReverse(false);

  const nextActiveKey = state.currentTrack && state.currentAudio ? state.currentTrack.key : null;
  if (state.activeDurationTrackKey && state.activeDurationTrackKey !== nextActiveKey) {
    _deps.refreshTrackDurationLabels(state.activeDurationTrackKey);
  }
  state.activeDurationTrackKey = nextActiveKey;

  if (!state.currentTrack || !state.currentAudio) {
    if (state.nowPlayingSeekActive) {
      cleanupNowPlayingSeekInteraction();
    }
    _deps.nowPlayingTitleEl.textContent = NOW_PLAYING_IDLE_TITLE;
    _deps.nowPlayingControlLabelEl.textContent = '▶';
    _deps.nowPlayingControlBtn.disabled = true;
    _deps.setNowPlayingReelActive(false);
    _deps.setNowPlayingProgress(0);
    _deps.setNowPlayingTime(null);
    _deps.requestHostPlaybackSync(false);
    return;
  }

  if (isHostRole() && _deps.isDapTrackContext(state.currentTrack, state.dapConfig)) {
    if (state.nowPlayingSeekActive) {
      cleanupNowPlayingSeekInteraction();
    }
    _deps.nowPlayingTitleEl.textContent = '';
    _deps.nowPlayingControlLabelEl.textContent = '▶';
    _deps.nowPlayingControlBtn.disabled = true;
    _deps.setNowPlayingReelActive(false);
    _deps.setNowPlayingProgress(0);
    _deps.setNowPlayingTime(null);
    _deps.requestHostPlaybackSync(false);
    return;
  }

  _deps.nowPlayingTitleEl.textContent = _deps.trackDisplayName(state.currentTrack.file);
  _deps.nowPlayingControlBtn.disabled = false;
  _deps.nowPlayingControlLabelEl.textContent = state.currentAudio.paused ? '▶' : '❚❚';
  _deps.setNowPlayingReelActive(true, state.currentAudio.paused);
  _deps.setNowPlayingTime(_deps.getCurrentTrackRemainingSeconds(), { useCeil: true });
  _deps.refreshTrackDurationLabels(state.currentTrack.key);
  _deps.requestHostPlaybackSync(false);
}

export function updateLiveSeekUi() {
  const isHost = isHostRole();
  if (_deps.liveSeekToggleRow) {
    _deps.liveSeekToggleRow.style.display = isHost ? 'flex' : 'none';
  }

  if (_deps.liveSeekEnabledToggle) {
    _deps.liveSeekEnabledToggle.checked = state.liveSeekEnabled;
    _deps.liveSeekEnabledToggle.disabled = !isHost;
  }

  if (_deps.nowPlayingControlBtn) {
    const canTouchSeek =
      isSlaveRole() ||
      ((isHostRole() || isCoHostRole()) && state.liveSeekEnabled);
    _deps.nowPlayingControlBtn.dataset.liveSeekEnabled = canTouchSeek ? 'true' : 'false';
  }
}

function canSeekNowPlaying() {
  if (isSlaveRole()) {
    if (!state.currentTrack || !state.currentAudio) return false;
    const duration = _deps.getCurrentTrackDurationSeconds();
    return Boolean(Number.isFinite(duration) && duration > 0);
  }

  if (isHostRole()) {
    if (!state.liveSeekEnabled) return false;
    if (_deps.isDspTransitionPlaybackActive()) {
      const transitionDuration = _deps.getDspTransitionDurationSeconds();
      return Boolean(Number.isFinite(transitionDuration) && transitionDuration > 0);
    }
    if (!state.currentTrack || !state.currentAudio) return false;
    const duration = _deps.getCurrentTrackDurationSeconds();
    return Boolean(Number.isFinite(duration) && duration > 0);
  }

  if (isCoHostRole()) {
    if (!state.liveSeekEnabled) return false;
    const hasHostTrack = Boolean(
      state.hostPlaybackState &&
        typeof state.hostPlaybackState.trackFile === 'string' &&
        state.hostPlaybackState.trackFile.trim(),
    );
    if (!hasHostTrack) return false;
    const duration = _deps.getHostPlaybackDurationSeconds();
    return Boolean(Number.isFinite(duration) && duration > 0);
  }

  return false;
}

function resolveNowPlayingSeekRatioFromClientX(clientX) {
  if (!_deps.nowPlayingControlBtn || !Number.isFinite(clientX)) return null;
  const rect = _deps.nowPlayingControlBtn.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width <= 0) return null;
  const ratio = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(1, ratio));
}

function isNowPlayingToggleZone(clientX, clientY) {
  if (!_deps.nowPlayingControlBtn || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const rect = _deps.nowPlayingControlBtn.getBoundingClientRect();
  if (clientY < rect.top || clientY > rect.bottom) return false;
  const centerX = rect.left + rect.width / 2;
  return Math.abs(clientX - centerX) <= NOW_PLAYING_TOGGLE_ZONE_HALF_WIDTH_PX;
}

function setNowPlayingReelScrubSpeed(speedPxPerSecond) {
  if (!_deps.nowPlayingControlBtn) return;
  const safeSpeed = Number.isFinite(speedPxPerSecond) ? Math.max(0, speedPxPerSecond) : 0;
  const ratio = Math.min(1, safeSpeed / NOW_PLAYING_REEL_MAX_SCRUB_SPEED_PX_PER_SEC);
  const durationSeconds =
    NOW_PLAYING_REEL_BASE_SPIN_SECONDS -
    ratio * (NOW_PLAYING_REEL_BASE_SPIN_SECONDS - NOW_PLAYING_REEL_FAST_SPIN_SECONDS);
  _deps.nowPlayingControlBtn.style.setProperty('--reel-spin-inline-duration', `${durationSeconds.toFixed(3)}s`);
}

function resetNowPlayingReelScrubSpeed() {
  if (!_deps.nowPlayingControlBtn) return;
  _deps.nowPlayingControlBtn.style.removeProperty('--reel-spin-inline-duration');
}

function updateNowPlayingReelScrubSpeed(clientX, timestampMs) {
  if (!Number.isFinite(clientX) || !Number.isFinite(timestampMs)) return;
  if (!Number.isFinite(state.nowPlayingSeekLastAt) || state.nowPlayingSeekLastAt <= 0) {
    state.nowPlayingSeekLastX = clientX;
    state.nowPlayingSeekLastAt = timestampMs;
    return;
  }

  const deltaMs = timestampMs - state.nowPlayingSeekLastAt;
  const deltaPx = Math.abs(clientX - state.nowPlayingSeekLastX);
  state.nowPlayingSeekLastX = clientX;
  state.nowPlayingSeekLastAt = timestampMs;

  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  const instantSpeed = (deltaPx * 1000) / deltaMs;
  state.nowPlayingSeekSmoothedSpeed =
    state.nowPlayingSeekSmoothedSpeed > 0 ? state.nowPlayingSeekSmoothedSpeed * 0.65 + instantSpeed * 0.35 : instantSpeed;
  setNowPlayingReelScrubSpeed(state.nowPlayingSeekSmoothedSpeed);
}

function applyNowPlayingSeekFromClientX(clientX, { finalize = false } = {}) {
  if (!canSeekNowPlaying()) return false;
  const ratio = resolveNowPlayingSeekRatioFromClientX(clientX);
  if (ratio === null) return false;

  if (isCoHostRole()) {
    const duration = _deps.getHostPlaybackDurationSeconds();
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const nextTime = Math.max(0, Math.min(duration, ratio * duration));

    state.hostPlaybackState = {
      ...state.hostPlaybackState,
      currentTime: nextTime,
      updatedAt: Date.now(),
    };
    syncNowPlayingPanel();
    _deps.queueCoHostSeekCurrentPlayback(ratio, { immediate: Boolean(finalize), finalize: Boolean(finalize) });
    return true;
  }

  if (isHostRole() && _deps.isDspTransitionPlaybackActive()) {
    return _deps.seekDspTransitionPlaybackByRatio(ratio);
  }

  if (!state.currentTrack || !state.currentAudio) return false;

  const duration = _deps.getCurrentTrackDurationSeconds();
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const nextTime = Math.max(0, Math.min(duration, ratio * duration));

  try {
    if (typeof state.currentAudio.fastSeek === 'function') {
      state.currentAudio.fastSeek(nextTime);
    } else {
      state.currentAudio.currentTime = nextTime;
    }
  } catch (err) {
    try {
      state.currentAudio.currentTime = nextTime;
    } catch (fallbackErr) {
      return false;
    }
  }

  _deps.updateProgress(state.currentTrack.key, nextTime, duration);
  syncNowPlayingPanel();
  if (isHostRole()) {
    _deps.requestHostLiveSeekSync({ finalize: Boolean(finalize) });
  }
  return true;
}

export function cleanupNowPlayingSeekInteraction() {
  if (_deps.nowPlayingControlBtn) {
    _deps.nowPlayingControlBtn.classList.remove('is-seeking');
    if (state.nowPlayingSeekPointerId !== null && typeof _deps.nowPlayingControlBtn.releasePointerCapture === 'function') {
      try {
        if (_deps.nowPlayingControlBtn.hasPointerCapture && _deps.nowPlayingControlBtn.hasPointerCapture(state.nowPlayingSeekPointerId)) {
          _deps.nowPlayingControlBtn.releasePointerCapture(state.nowPlayingSeekPointerId);
        }
      } catch (err) {
        // ignore pointer capture release errors
      }
    }
  }
  resetNowPlayingReelScrubSpeed();

  state.nowPlayingSeekActive = false;
  state.nowPlayingSeekMoved = false;
  state.nowPlayingSeekPointerId = null;
  state.nowPlayingSeekStartX = 0;
  state.nowPlayingSeekLastX = 0;
  state.nowPlayingSeekLastAt = 0;
  state.nowPlayingSeekSmoothedSpeed = 0;
  window.removeEventListener('pointermove', onNowPlayingSeekPointerMove, true);
  window.removeEventListener('pointerup', onNowPlayingSeekPointerUp, true);
  window.removeEventListener('pointercancel', onNowPlayingSeekPointerCancel, true);
}

function onNowPlayingSeekPointerMove(event) {
  if (!state.nowPlayingSeekActive || event.pointerId !== state.nowPlayingSeekPointerId) return;
  const threshold = event.pointerType === 'touch' ? 2 : NOW_PLAYING_SEEK_DRAG_THRESHOLD_PX;
  const distance = Math.abs(event.clientX - state.nowPlayingSeekStartX);
  if (!state.nowPlayingSeekMoved && distance < threshold) return;
  state.nowPlayingSeekMoved = true;
  if (_deps.nowPlayingControlBtn) {
    _deps.nowPlayingControlBtn.classList.add('is-seeking');
  }
  event.preventDefault();
  updateNowPlayingReelScrubSpeed(
    event.clientX,
    Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(),
  );
  applyNowPlayingSeekFromClientX(event.clientX, { finalize: false });
}

function onNowPlayingSeekPointerUp(event) {
  if (!state.nowPlayingSeekActive || event.pointerId !== state.nowPlayingSeekPointerId) return;

  if (state.nowPlayingSeekMoved) {
    event.preventDefault();
    applyNowPlayingSeekFromClientX(event.clientX, { finalize: true });
    state.nowPlayingSeekSuppressClickUntil = Date.now() + NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS;
  } else if (
    event.pointerType === 'touch' &&
    !isNowPlayingToggleZone(event.clientX, event.clientY) &&
    applyNowPlayingSeekFromClientX(event.clientX, { finalize: true })
  ) {
    state.nowPlayingSeekSuppressClickUntil = Date.now() + NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS;
  }

  cleanupNowPlayingSeekInteraction();
}

function onNowPlayingSeekPointerCancel(event) {
  if (!state.nowPlayingSeekActive || event.pointerId !== state.nowPlayingSeekPointerId) return;
  cleanupNowPlayingSeekInteraction();
}

function onNowPlayingControlPointerDown(event) {
  if (!_deps.nowPlayingControlBtn) return;
  if (!canSeekNowPlaying()) return;
  if (!event.isPrimary) return;
  if (event.button !== undefined && event.button !== 0) return;
  if (state.nowPlayingSeekActive) {
    cleanupNowPlayingSeekInteraction();
  }

  state.nowPlayingSeekActive = true;
  state.nowPlayingSeekMoved = false;
  state.nowPlayingSeekPointerId = event.pointerId;
  state.nowPlayingSeekStartX = event.clientX;
  state.nowPlayingSeekLastX = event.clientX;
  state.nowPlayingSeekLastAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  state.nowPlayingSeekSmoothedSpeed = 0;
  setNowPlayingReelScrubSpeed(0);

  if (typeof _deps.nowPlayingControlBtn.setPointerCapture === 'function') {
    try {
      _deps.nowPlayingControlBtn.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors
    }
  }

  window.addEventListener('pointermove', onNowPlayingSeekPointerMove, true);
  window.addEventListener('pointerup', onNowPlayingSeekPointerUp, true);
  window.addEventListener('pointercancel', onNowPlayingSeekPointerCancel, true);
}

function onNowPlayingControlClick(event) {
  if (Date.now() < state.nowPlayingSeekSuppressClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  _deps.toggleNowPlayingPlayback();
}

export function setLiveSeekEnabled(
  enabled,
  { persist = false, sync = false, announce = false } = {},
) {
  const normalized = Boolean(enabled);
  const changed = normalized !== state.liveSeekEnabled;
  state.liveSeekEnabled = normalized;

  if (!normalized && state.nowPlayingSeekActive) {
    cleanupNowPlayingSeekInteraction();
  }

  if (!normalized) {
    _deps.clearQueuedCoHostSeekCommands();
  }

  if (persist) {
    _deps.saveSetting(SETTINGS_KEYS.liveSeekEnabled, normalized ? 'true' : 'false');
  }

  updateLiveSeekUi();

  if (sync && changed && isHostRole()) {
    _deps.requestHostPlaybackSync(true);
  }

  if (announce) {
    _deps.setStatus(normalized ? 'Live seek включен.' : 'Live seek выключен.');
  }

  return changed;
}

export function initLiveSeekControls() {
  if (isHostRole()) {
    setLiveSeekEnabled(_deps.loadBooleanSetting(SETTINGS_KEYS.liveSeekEnabled, false), {
      persist: false,
      sync: false,
    });
  } else {
    setLiveSeekEnabled(false, { persist: false, sync: false });
  }

  if (_deps.liveSeekEnabledToggle) {
    _deps.liveSeekEnabledToggle.checked = state.liveSeekEnabled;
    _deps.liveSeekEnabledToggle.addEventListener('change', async () => {
      const nextEnabled = Boolean(_deps.liveSeekEnabledToggle.checked);

      if (!isHostRole()) {
        setLiveSeekEnabled(state.hostPlaybackState.allowLiveSeek, { persist: false, sync: false });
        _deps.setStatus('Только хост может менять настройку live seek.');
        return;
      }

      setLiveSeekEnabled(nextEnabled, { persist: true, sync: true, announce: true });
    });
  }

  updateLiveSeekUi();
}

export function initNowPlayingControls() {
  if (!_deps.nowPlayingControlBtn) return;
  _deps.nowPlayingControlBtn.addEventListener('pointerdown', onNowPlayingControlPointerDown);
  _deps.nowPlayingControlBtn.addEventListener('click', onNowPlayingControlClick);
  initLiveSeekControls();
  _deps.initVolumePresetControls();
  syncNowPlayingPanel();
  syncHostNowPlayingPanel();
}
