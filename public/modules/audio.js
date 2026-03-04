// public/modules/audio.js — audio playback, fading, and volume helpers

import { state, AUTOPLAY_OVERLAY_STATE_IDLE, AUTOPLAY_OVERLAY_STATE_PENDING,
  AUTOPLAY_OVERLAY_STATE_STARTED, AUTOPLAY_OVERLAY_STATE_FAILED,
  AUTOPLAY_OVERLAY_TRIGGER_EPSILON_SECONDS, DEFAULT_LIVE_VOLUME,
  DAP_DEFAULT_VOLUME_PERCENT } from './state.js';
import { clampVolume, normalizeLiveVolumePreset, formatVolumePresetLabel } from './config.js';
import { isHostRole, isCoHostRole } from './roles.js';
import { trackKey } from './utils.js';

const _deps = {};

export function setAudioDeps(d) {
  Object.assign(_deps, d);
}

// ── volume / transition settings ──────────────────────────────────────

export function isOverlayEnabled() {
  const el = _deps.overlayEnabledToggle;
  return el ? el.checked : true;
}

export function isStopFadeEnabled() {
  const el = _deps.stopFadeEnabledToggle;
  return el ? el.checked : true;
}

export function getOverlaySeconds() {
  if (!isOverlayEnabled()) return 0;
  const el = _deps.overlayTimeInput;
  return Math.max(0, parseFloat(el ? el.value : '0') || 0);
}

export function getStopFadeSeconds() {
  if (!isStopFadeEnabled()) return 0;
  const el = _deps.stopFadeInput;
  return Math.max(0, parseFloat(el ? el.value : '0') || 0);
}

export function getTransitionCurve() {
  const el = _deps.overlayCurveSelect;
  const curve = el && typeof el.value === 'string' ? el.value : '';
  return curve || 'linear';
}

export function getEffectiveLiveVolumeForTrack(trackOrContext = null) {
  if (!isHostRole()) {
    return normalizeLiveVolumePreset(state.livePlaybackVolume, DEFAULT_LIVE_VOLUME);
  }
  if (!_deps.isDapTrackContext(trackOrContext)) {
    return normalizeLiveVolumePreset(state.livePlaybackVolume, DEFAULT_LIVE_VOLUME);
  }
  return clampVolume(_deps.normalizeDapVolumePercent(state.dapConfig.volumePercent, DAP_DEFAULT_VOLUME_PERCENT) / 100);
}

export function getEffectiveLiveVolume(trackOrContext = null) {
  return getEffectiveLiveVolumeForTrack(trackOrContext);
}

export function applyLiveVolumeToCurrentAudio() {
  if (!state.currentAudio) return;
  state.currentAudio.volume = getEffectiveLiveVolume(state.currentTrack);
}

export function setLivePlaybackVolume(volume, { sync = false, announce = false } = {}) {
  const normalized = normalizeLiveVolumePreset(volume, state.livePlaybackVolume);
  const changed = Math.abs(normalized - state.livePlaybackVolume) >= 0.0001;
  state.livePlaybackVolume = normalized;

  if (isHostRole()) {
    applyLiveVolumeToCurrentAudio();
    if (sync && changed) {
      _deps.requestHostPlaybackSync(true);
    }
  }

  _deps.updateVolumePresetsUi();
  if (announce) {
    _deps.setStatus(`Громкость: ${formatVolumePresetLabel(state.livePlaybackVolume)}.`);
  }
  return changed;
}

// ── core audio / fade functions ───────────────────────────────────────

export function resetFadeState() {
  state.fadeCancel.cancelled = true;
  state.fadeCancel = { cancelled: false };
  state.overlayHandoffInFlight = false;
}

export function fadeOutAndStop(audio, durationSeconds, curve, track) {
  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    if (!audio) return resolve();
    const duration = Math.max(0, durationSeconds || 0) * 1000;
    if (duration === 0) {
      audio.pause();
      audio.currentTime = 0;
      _deps.setButtonPlaying(track.key, false, track);
      _deps.setTrackPaused(track.key, false, track);
      _deps.stopProgressLoop();
      _deps.resetProgress(track.key);
      if (state.currentTrack && state.currentTrack.key === track.key) {
        state.currentAudio = null;
        state.currentTrack = null;
      }
      _deps.syncNowPlayingPanel();
      _deps.requestHostPlaybackSync(true);
      return safeResolve();
    }
    resetFadeState();
    const token = state.fadeCancel;
    const start = performance.now();
    const startVolume = clampVolume(audio.volume);

    function step(now) {
      if (token.cancelled) return safeResolve();
      const progress = Math.min((now - start) / duration, 1);
      const eased = _deps.easing(progress, curve);
      audio.volume = clampVolume(startVolume * (1 - eased));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        audio.pause();
        audio.currentTime = 0;
        _deps.setButtonPlaying(track.key, false, track);
        _deps.setTrackPaused(track.key, false, track);
        _deps.stopProgressLoop();
        _deps.resetProgress(track.key);
        if (state.currentTrack && state.currentTrack.key === track.key) {
          state.currentAudio = null;
          state.currentTrack = null;
        }
        _deps.syncNowPlayingPanel();
        _deps.requestHostPlaybackSync(true);
        safeResolve();
      }
    }

    requestAnimationFrame(step);
  });
}

export function fadeOutAndPause(audio, durationSeconds, curve) {
  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (pausedWithFade) => {
      if (settled) return;
      settled = true;
      resolve(pausedWithFade);
    };

    if (!audio) return safeResolve(false);
    const duration = Math.max(0, durationSeconds || 0) * 1000;
    if (duration === 0) {
      audio.pause();
      return safeResolve(true);
    }

    resetFadeState();
    const token = state.fadeCancel;
    const start = performance.now();
    const startVolume = clampVolume(audio.volume);

    function step(now) {
      if (token.cancelled) return safeResolve(false);
      const progress = Math.min((now - start) / duration, 1);
      const eased = _deps.easing(progress, curve);
      audio.volume = clampVolume(startVolume * (1 - eased));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        audio.pause();
        audio.volume = startVolume;
        safeResolve(true);
      }
    }

    requestAnimationFrame(step);
  });
}

export async function pauseCurrentPlayback(track, audio) {
  if (!track || !audio) return false;
  if (_deps.isDapPauseLocked(track, audio)) {
    _deps.setStatus('DAP: пауза текущего трека запрещена. Включите другой трек.');
    return false;
  }

  const stopFadeSeconds = getStopFadeSeconds();
  const curve = getTransitionCurve();

  if (!audio.paused && stopFadeSeconds > 0) {
    const pausedWithFade = await fadeOutAndPause(audio, stopFadeSeconds, curve);
    if (!pausedWithFade) return false;
  } else if (!audio.paused) {
    audio.pause();
  }

  _deps.stopProgressLoop();
  _deps.setButtonPlaying(track.key, false, track);
  _deps.setTrackPaused(track.key, true, track);
  _deps.setStatus(`Пауза: ${track.file}`);
  return true;
}

export function shouldTriggerAutoplayOverlayTransition(audio, track) {
  if (!audio || !track) return false;
  if (!isHostRole()) return false;
  if (audio.paused) return false;
  if (state.currentAudio !== audio) return false;
  if (!state.currentTrack || state.currentTrack.key !== track.key) return false;
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return false;
  if (!Number.isFinite(audio.currentTime) || audio.currentTime < 0) return false;

  const nextTrack = _deps.resolveAutoplayNextTrack(track);
  if (!nextTrack) return false;

  const overlaySeconds = Math.max(0, getOverlaySeconds());
  const readyDspSliceWindowSeconds = _deps.resolveReadyDspSliceWindowSeconds(nextTrack);
  const triggerWindowSeconds = Number.isFinite(readyDspSliceWindowSeconds)
    ? Math.max(overlaySeconds, readyDspSliceWindowSeconds)
    : overlaySeconds;
  if (triggerWindowSeconds <= 0) return false;

  const remainingSeconds = audio.duration - audio.currentTime;
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return false;

  return remainingSeconds <= triggerWindowSeconds + AUTOPLAY_OVERLAY_TRIGGER_EPSILON_SECONDS;
}

export function maybeTriggerAutoplayOverlayTransition(audio, track) {
  if (!shouldTriggerAutoplayOverlayTransition(audio, track)) return;
  if (audio.dataset.autoplayOverlayState !== AUTOPLAY_OVERLAY_STATE_IDLE) return;

  audio.dataset.autoplayOverlayState = AUTOPLAY_OVERLAY_STATE_PENDING;
  _deps.tryAutoplayNextTrack(track)
    .then((started) => {
      audio.dataset.autoplayOverlayState = started
        ? AUTOPLAY_OVERLAY_STATE_STARTED
        : AUTOPLAY_OVERLAY_STATE_FAILED;
    })
    .catch((err) => {
      audio.dataset.autoplayOverlayState = AUTOPLAY_OVERLAY_STATE_FAILED;
      console.error('Autoplay overlay transition failed', err);
    });
}

export function createAudio(track) {
  const { file, basePath, key } = track;
  const encoded = encodeURIComponent(file);
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const audio = _deps.trackLiveAudioInstance(new Audio(`${normalizedBase}/${encoded}`));
  audio.preload = 'metadata';
  audio.load();
  audio.dataset.autoplayOverlayState = AUTOPLAY_OVERLAY_STATE_IDLE;

  audio.addEventListener('timeupdate', () => {
    maybeTriggerAutoplayOverlayTransition(audio, track);
  });

  audio.addEventListener('ended', () => {
    const isCurrentAudioInstance = state.currentAudio === audio;
    const wasCurrentTrack = isCurrentAudioInstance && Boolean(state.currentTrack && state.currentTrack.key === key);
    if (!wasCurrentTrack) return;

    const overlayState = audio.dataset.autoplayOverlayState;
    const isAutoplayOverlayHandoff =
      overlayState === AUTOPLAY_OVERLAY_STATE_PENDING || overlayState === AUTOPLAY_OVERLAY_STATE_STARTED;

    if (!isAutoplayOverlayHandoff) {
      state.currentAudio = null;
      state.currentTrack = null;
      _deps.resetLiveDspNextTrackPreview();
    }
    _deps.setButtonPlaying(key, false, track);
    _deps.setTrackPaused(key, false, track);
    if (isAutoplayOverlayHandoff) {
      return;
    }
    _deps.stopProgressLoop();
    _deps.resetProgress(key);
    _deps.syncNowPlayingPanel();
    _deps.requestHostPlaybackSync(true);

    _deps.tryAutoplayNextTrack(track)
      .then((started) => {
        if (!started) {
          _deps.setStatus(`Воспроизведение завершено: ${file}`);
          _deps.ensureDapNoSilencePlayback({ reason: 'track-ended' }).catch(() => {});
        }
      })
      .catch((err) => {
        console.error('Autoplay failed', err);
        _deps.setStatus(`Воспроизведение завершено: ${file}`);
        _deps.ensureDapNoSilencePlayback({ reason: 'track-ended-error' }).catch(() => {});
      });
  });

  audio.addEventListener('error', () => {
    _deps.setStatus(`Ошибка воспроизведения: ${file}`);
    _deps.setButtonPlaying(key, false, track);
    _deps.setTrackPaused(key, false, track);
    _deps.stopProgressLoop();
    _deps.resetProgress(key);
    if (state.currentTrack && state.currentTrack.key === key) {
      state.currentAudio = null;
      state.currentTrack = null;
      _deps.resetLiveDspNextTrackPreview();
    }
    _deps.syncNowPlayingPanel();
    _deps.requestHostPlaybackSync(true);
    _deps.ensureDapNoSilencePlayback({ reason: 'track-error' }).catch(() => {});
  });

  _deps.bindProgress(audio, key);
  return audio;
}

export function applyOverlay(oldAudio, newAudio, targetVolume, overlaySeconds, curve, newTrack, oldTrack) {
  const safeTargetVolume = clampVolume(targetVolume);
  const start = performance.now();
  const duration = overlaySeconds * 1000;
  const initialOldVolume = clampVolume(oldAudio ? oldAudio.volume : 1);
  resetFadeState();
  const token = state.fadeCancel;
  state.overlayHandoffInFlight = true;

  function step(now) {
    if (token.cancelled) {
      state.overlayHandoffInFlight = false;
      return;
    }
    const progress = Math.min((now - start) / duration, 1);
    const eased = _deps.easing(progress, curve);
    newAudio.volume = clampVolume(safeTargetVolume * eased);
    if (oldAudio) {
      oldAudio.volume = clampVolume(initialOldVolume * (1 - eased));
    }
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      state.overlayHandoffInFlight = false;
      if (oldAudio) {
        oldAudio.pause();
        oldAudio.currentTime = 0;
        oldAudio.volume = initialOldVolume;
        if (oldTrack) {
          _deps.setButtonPlaying(oldTrack.key, false, oldTrack);
          _deps.setTrackPaused(oldTrack.key, false, oldTrack);
        }
      }
      state.currentAudio = newAudio;
      state.currentTrack = newTrack;
      _deps.setButtonPlaying(newTrack.key, true, newTrack);
      _deps.setTrackPaused(newTrack.key, false, newTrack);
      _deps.startProgressLoop(newAudio, newTrack.key);
      _deps.stopUnexpectedLiveAudios([newAudio]);
      _deps.setStatus(`Играет: ${newTrack.file}`);
      _deps.syncNowPlayingPanel();
      _deps.requestHostPlaybackSync(true);
    }
  }

  requestAnimationFrame(step);
}

export async function handlePlay(file, button, basePath = '/audio', playbackContext = {}) {
  const baseOverlaySeconds = getOverlaySeconds();
  const curve = getTransitionCurve();
  const startAtSeconds = _deps.normalizeAudioStartOffsetSeconds(playbackContext.startAtSeconds);
  const resolvedPlaylistIndex =
    Number.isInteger(playbackContext.playlistIndex) && playbackContext.playlistIndex >= 0
      ? playbackContext.playlistIndex
      : null;
  const resolvedPlaylistPosition =
    Number.isInteger(playbackContext.playlistPosition) && playbackContext.playlistPosition >= 0
      ? playbackContext.playlistPosition
      : null;
  const track = {
    file,
    basePath,
    key: trackKey(file, basePath),
    playlistIndex: resolvedPlaylistIndex,
    playlistPosition: resolvedPlaylistPosition,
  };
  const isTargetDapTrack = _deps.isDapTrackContext(track, state.dapConfig);
  if (isHostRole() && isTargetDapTrack && !Boolean(playbackContext && playbackContext.fromDapInterruptedResume)) {
    _deps.clearDapInterruptedPlaybackSnapshot();
  }
  const shouldArmDapNoSilence =
    isHostRole() &&
    _deps.isDapEnabled(state.dapConfig) &&
    isTargetDapTrack &&
    !Boolean(playbackContext && playbackContext.fromAutoplay) &&
    !Boolean(playbackContext && playbackContext.fromDapNoSilence);
  if (shouldArmDapNoSilence) {
    _deps.armDapNoSilenceByPlaylistIndex(track.playlistIndex, state.dapConfig);
  }
  const isSwitchingAwayFromDap =
    isHostRole() &&
    _deps.isDapNoSilenceActive() &&
    state.currentTrack &&
    state.currentAudio &&
    !state.currentAudio.paused &&
    _deps.isDapTrackContext(state.currentTrack) &&
    !isTargetDapTrack;
  if (isSwitchingAwayFromDap) {
    _deps.captureDapInterruptedPlaybackSnapshot(state.currentTrack, state.currentAudio, state.dapConfig);
  }
  const overlaySeconds = isSwitchingAwayFromDap ? 0 : baseOverlaySeconds;
  const targetVolume = getEffectiveLiveVolume(track);

  button.disabled = true;

  if (_deps.isDspTransitionPlaybackActive()) {
    _deps.stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
    _deps.resetLiveDspNextTrackPreview();
  }

  if (isCoHostRole()) {
    try {
      await _deps.requestCoHostPlayTrack(file, basePath, {
        playlistIndex: resolvedPlaylistIndex,
        playlistPosition: resolvedPlaylistPosition,
      });
      _deps.setStatus(`Live-команда отправлена: ${file}`);
    } catch (err) {
      console.error(err);
      _deps.setStatus(err && err.message ? err.message : 'Не удалось отправить live-команду.');
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (state.currentTrack && state.currentTrack.key === track.key && state.currentAudio && !state.currentAudio.paused) {
    const paused = await pauseCurrentPlayback(track, state.currentAudio);
    if (paused) {
      await _deps.ensureDapNoSilencePlayback({ reason: 'track-toggle-pause' });
    }
    _deps.syncNowPlayingPanel();
    _deps.requestHostPlaybackSync(true);
    button.disabled = false;
    return;
  }

  if (state.currentTrack && state.currentTrack.key === track.key && state.currentAudio && state.currentAudio.paused) {
    try {
      _deps.setTrackPaused(track.key, false, track);
      await state.currentAudio.play();
      _deps.setButtonPlaying(track.key, true, track);
      _deps.startProgressLoop(state.currentAudio, track.key);
      _deps.stopUnexpectedLiveAudios([state.currentAudio]);
      _deps.setStatus(`Играет: ${file}`);
      _deps.triggerLiveDspTransitionForTrack(track);
    } catch (err) {
      console.error(err);
      _deps.setStatus('Не удалось продолжить воспроизведение.');
      _deps.setButtonPlaying(track.key, false, track);
      _deps.setTrackPaused(track.key, true, track);
    } finally {
      _deps.syncNowPlayingPanel();
      _deps.requestHostPlaybackSync(true);
      button.disabled = false;
    }
    return;
  }

  const audio = createAudio(track);
  audio.dataset.filename = file;
  audio.volume = overlaySeconds > 0 && state.currentAudio && !state.currentAudio.paused ? 0 : targetVolume;

  try {
    if (startAtSeconds !== null) {
      await _deps.seekAudioToOffset(audio, startAtSeconds);
    }
    await audio.play();

    if (state.currentAudio && !state.currentAudio.paused && overlaySeconds > 0) {
      const oldTrack = state.currentTrack;
      _deps.setButtonPlaying(track.key, true, track);
      _deps.setTrackPaused(track.key, false, track);
      _deps.startProgressLoop(audio, track.key);
      _deps.triggerLiveDspTransitionForTrack(track);
      applyOverlay(state.currentAudio, audio, targetVolume, overlaySeconds, curve, track, oldTrack);
    } else {
      if (state.currentAudio) {
        state.currentAudio.pause();
        if (!isSwitchingAwayFromDap) {
          state.currentAudio.currentTime = 0;
        }
        if (state.currentTrack) {
          _deps.setButtonPlaying(state.currentTrack.key, false, state.currentTrack);
          if (isSwitchingAwayFromDap) {
            _deps.setTrackPausedByContext(state.currentTrack.key, true, state.currentTrack);
          } else {
            _deps.setTrackPaused(state.currentTrack.key, false, state.currentTrack);
          }
        }
      }
      resetFadeState();
      audio.volume = targetVolume;
      state.currentAudio = audio;
      state.currentTrack = track;
      _deps.setButtonPlaying(track.key, true, track);
      _deps.setTrackPaused(track.key, false, track);
      _deps.startProgressLoop(audio, track.key);
      _deps.stopUnexpectedLiveAudios([audio]);
      _deps.setStatus(`Играет: ${file}`);
      _deps.triggerLiveDspTransitionForTrack(track);
      _deps.syncNowPlayingPanel();
      _deps.requestHostPlaybackSync(true);
    }
  } catch (err) {
    console.error(err);
    _deps.setStatus('Не удалось начать воспроизведение.');
    _deps.setButtonPlaying(track.key, false, track);
    _deps.setTrackPaused(track.key, false, track);
    _deps.stopProgressLoop();
    _deps.resetProgress(track.key);
    _deps.syncNowPlayingPanel();
    _deps.requestHostPlaybackSync(true);
  } finally {
    button.disabled = false;
  }
}
