// public/modules/dsp-live.js — live DSP transition logic

import { LIVE_DSP_CONTINUATION_WARMUP_MAX_TRACKED, LIVE_DSP_HANDOFF_LEAD_SECONDS, LIVE_DSP_POLL_INTERVAL_MS, LIVE_DSP_POLL_TIMEOUT_MS, LIVE_DSP_RENDER_SOURCE, LIVE_DSP_WARMUP_MAX_TRACKED, LIVE_DSP_WARMUP_TIMEOUT_MS, state } from './state.js';
import * as api from './api.js';
import { createAudio, getEffectiveLiveVolume, handlePlay, resetFadeState } from './audio.js';
import { isHostRole } from './roles.js';
import { syncDspTransitionTrackHighlight, syncLiveDspNextTrackHighlight } from './ui/dsp.js';
import { syncNowPlayingPanel } from './ui/nowplaying.js';
import { setStatus } from './ui/status.js';
import { trackKey } from './utils.js';

const _deps = {};

function waitMs(ms) {
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

export function setDspLiveDeps(d) {
  Object.assign(_deps, d);
}

export function isPlaylistDspEnabled(playlistIndex) {
  const normalizedIndex = _deps.normalizePlaylistTrackIndex(playlistIndex);
  if (normalizedIndex === null) return false;
  if (normalizedIndex < 0 || normalizedIndex >= state.playlistDsp.length) return false;
  return Boolean(state.playlistDsp[normalizedIndex]);
}

export function setLiveDspNextTrackReady(nextTrack, details = null) {
  if (!nextTrack || typeof nextTrack.file !== 'string') {
    state.liveDspNextReadyDescriptor = '';
    state.liveDspNextReadySliceSeconds = null;
    syncLiveDspNextTrackHighlight();
    return;
  }

  state.liveDspNextReadyDescriptor = _deps.buildLiveDspNextTrackDescriptor(
    nextTrack.file,
    {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
    },
    nextTrack.basePath || '/audio',
  );
  const normalizedSliceSeconds = normalizeDspTransitionSliceSeconds(details && details.sliceSeconds);
  state.liveDspNextReadySliceSeconds = normalizedSliceSeconds > 0 ? normalizedSliceSeconds : null;
  syncLiveDspNextTrackHighlight();
}

export function resolveReadyDspSliceWindowSeconds(nextTrack) {
  if (!nextTrack || typeof nextTrack.file !== 'string') return null;
  if (nextTrack.basePath && nextTrack.basePath !== '/audio') return null;
  if (!state.liveDspNextReadyDescriptor) return null;

  const expectedDescriptor = _deps.buildLiveDspNextTrackDescriptor(
    nextTrack.file,
    {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
    },
    nextTrack.basePath || '/audio',
  );
  if (!expectedDescriptor || expectedDescriptor !== state.liveDspNextReadyDescriptor) return null;

  const sliceSeconds = normalizeDspTransitionSliceSeconds(state.liveDspNextReadySliceSeconds);
  if (sliceSeconds <= 0) return null;
  return sliceSeconds;
}

export function normalizeDspTransitionSliceSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, numeric);
}

export async function warmupDspTransitionOutput(outputUrl, { urgent = false } = {}) {
  const normalizedUrl = typeof outputUrl === 'string' ? outputUrl.trim() : '';
  if (!normalizedUrl) return false;

  const existingPromise = state.dspTransitionWarmupPromises.get(normalizedUrl);
  if (existingPromise) {
    return existingPromise;
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = urgent ? Math.max(3000, LIVE_DSP_WARMUP_TIMEOUT_MS) : LIVE_DSP_WARMUP_TIMEOUT_MS;
  const timeoutId = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (err) {
          // ignore abort failures
        }
      }, timeoutMs)
    : null;

  const warmupPromise = fetch(normalizedUrl, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'force-cache',
    signal: controller ? controller.signal : undefined,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    });

  state.dspTransitionWarmupPromises.set(normalizedUrl, warmupPromise);
  if (state.dspTransitionWarmupPromises.size > LIVE_DSP_WARMUP_MAX_TRACKED) {
    const firstKey = state.dspTransitionWarmupPromises.keys().next().value;
    if (firstKey && firstKey !== normalizedUrl) {
      state.dspTransitionWarmupPromises.delete(firstKey);
    }
  }

  return warmupPromise;
}

export function disposePreparedContinuationAudio(audio) {
  if (!audio) return;
  try {
    audio.pause();
  } catch (err) {
    // ignore pause failures for detached audio elements
  }
  try {
    audio.currentTime = 0;
  } catch (err) {
    // ignore seek failures for detached audio elements
  }
}

export function buildLiveDspContinuationWarmupKey(track, sliceSeconds = 0) {
  if (!track || typeof track.file !== 'string' || !track.file.trim()) return '';
  const descriptor = _deps.buildLiveDspNextTrackDescriptor(
    track.file,
    {
      playlistIndex: _deps.normalizePlaylistTrackIndex(track.playlistIndex),
      playlistPosition: _deps.normalizePlaylistTrackIndex(track.playlistPosition),
    },
    track.basePath || '/audio',
  );
  if (!descriptor) return '';
  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  return `${descriptor}|slice=${normalizedSlice.toFixed(3)}`;
}

export function clearLiveDspContinuationWarmups() {
  const pendingPromises = Array.from(state.liveDspContinuationWarmupPromises.values());
  state.liveDspContinuationWarmupPromises.clear();
  pendingPromises.forEach((promise) => {
    Promise.resolve(promise)
      .then((audio) => {
        if (audio) disposePreparedContinuationAudio(audio);
      })
      .catch(() => {});
  });
}

export function primeLiveDspContinuationWarmup(nextTrack, sliceSeconds = 0) {
  const targetTrack = toPlaybackTrackDescriptor(nextTrack, '/audio');
  const key = buildLiveDspContinuationWarmupKey(targetTrack, sliceSeconds);
  if (!key) return null;

  const existing = state.liveDspContinuationWarmupPromises.get(key);
  if (existing) return existing;

  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  const basePromise = (async () => {
    const preparedAudio = createAudio(targetTrack);
    preparedAudio.preload = 'auto';
    preparedAudio.volume = getEffectiveLiveVolume(targetTrack);
    if (normalizedSlice > 0) {
      await _deps.seekAudioToOffset(preparedAudio, normalizedSlice);
    }
    return preparedAudio;
  })();

  let trackedPromise = null;
  trackedPromise = basePromise
    .then((audio) => {
      const stillTracked = state.liveDspContinuationWarmupPromises.get(key) === trackedPromise;
      if (!stillTracked) {
        if (audio) disposePreparedContinuationAudio(audio);
        return null;
      }
      if (!audio) {
        state.liveDspContinuationWarmupPromises.delete(key);
        return null;
      }
      return audio;
    })
    .catch(() => {
      if (state.liveDspContinuationWarmupPromises.get(key) === trackedPromise) {
        state.liveDspContinuationWarmupPromises.delete(key);
      }
      return null;
    });

  state.liveDspContinuationWarmupPromises.set(key, trackedPromise);
  while (state.liveDspContinuationWarmupPromises.size > LIVE_DSP_CONTINUATION_WARMUP_MAX_TRACKED) {
    const oldestKey = state.liveDspContinuationWarmupPromises.keys().next().value;
    if (!oldestKey || oldestKey === key) break;
    state.liveDspContinuationWarmupPromises.delete(oldestKey);
  }

  return trackedPromise;
}

export function consumeLiveDspContinuationWarmup(nextTrack, sliceSeconds = 0) {
  const targetTrack = toPlaybackTrackDescriptor(nextTrack, '/audio');
  const key = buildLiveDspContinuationWarmupKey(targetTrack, sliceSeconds);
  if (!key) return null;

  const warmupPromise = state.liveDspContinuationWarmupPromises.get(key);
  if (!warmupPromise) return null;
  state.liveDspContinuationWarmupPromises.delete(key);
  return warmupPromise;
}

export function toPlaybackTrackDescriptor(track, fallbackBasePath = '/audio') {
  const file = track && typeof track.file === 'string' ? track.file : '';
  const basePath = track && typeof track.basePath === 'string' && track.basePath ? track.basePath : fallbackBasePath;
  const playlistId = track && typeof track.playlistId === 'string' && track.playlistId.trim() ? track.playlistId.trim() : null;
  const trackId = track && typeof track.trackId === 'string' && track.trackId.trim() ? track.trackId.trim() : null;
  return {
    file,
    basePath,
    key: trackKey(file, basePath),
    playlistId,
    trackId,
    playlistIndex: _deps.normalizePlaylistTrackIndex(track ? track.playlistIndex : null),
    playlistPosition: _deps.normalizePlaylistTrackIndex(track ? track.playlistPosition : null),
  };
}

export async function fetchDspTransitionPairDetails(fromFile, toFile) {
  const { ok, data } = await api.fetchDspTransitionPair(fromFile, toFile);
  if (!ok) {
    const message = data && typeof data.error === 'string' ? data.error : 'Не удалось получить статус DSP transition.';
    throw new Error(message);
  }

  const transition = data && data.transition && typeof data.transition === 'object' ? data.transition : null;
  const status = transition && typeof transition.status === 'string' ? transition.status.trim().toLowerCase() : 'missing';
  const outputUrl = transition && typeof transition.outputUrl === 'string' ? transition.outputUrl : null;
  const sliceSeconds = normalizeDspTransitionSliceSeconds(transition && transition.sliceSeconds);

  return {
    status: status || 'missing',
    outputUrl,
    sliceSeconds,
    transition,
  };
}

export async function pollLiveDspTransitionUntilReady(fromTrack, nextTrack, tokenAtStart) {
  const startedAt = Date.now();

  while (state.liveDspRenderToken === tokenAtStart && Date.now() - startedAt <= LIVE_DSP_POLL_TIMEOUT_MS) {
    let details = null;
    let status = 'missing';
    try {
      details = await fetchDspTransitionPairDetails(fromTrack.file, nextTrack.file);
      status = details.status;
    } catch (err) {
      // keep waiting during transient API errors
    }

    if (state.liveDspRenderToken !== tokenAtStart) return;
    if (status === 'ready') {
      if (details && details.outputUrl) {
        warmupDspTransitionOutput(details.outputUrl).catch(() => {});
      }
      if (details) {
        primeLiveDspContinuationWarmup(nextTrack, details.sliceSeconds);
      }
      setLiveDspNextTrackReady(nextTrack, details);
      return;
    }
    if (status === 'failed') {
      setLiveDspNextTrackReady(null);
      return;
    }

    await waitMs(LIVE_DSP_POLL_INTERVAL_MS);
  }
}

export async function queueLiveDspTransitionForTrack(fromTrack, nextTrack, tokenAtStart) {
  try {
    const { ok } = await api.postDspTransitions({
      from: fromTrack.file,
      to: nextTrack.file,
      force: true,
      source: LIVE_DSP_RENDER_SOURCE,
      priority: 'high',
    });

    if (!ok) {
      return;
    }
  } catch (err) {
    return;
  }

  await pollLiveDspTransitionUntilReady(fromTrack, nextTrack, tokenAtStart);
}

export function triggerLiveDspTransitionForTrack(track) {
  if (!isHostRole()) return;
  if (!track || typeof track.file !== 'string') return;
  if ((track.basePath || '/audio') !== '/audio') return;

  const token = state.liveDspRenderToken + 1;
  state.liveDspRenderToken = token;
  setLiveDspNextTrackReady(null);

  const nextTrack = _deps.resolveAutoplayNextTrack(track);
  if (!nextTrack) return;
  if (!isPlaylistDspEnabled(nextTrack.playlistIndex)) return;

  queueLiveDspTransitionForTrack(track, nextTrack, token).catch((err) => {
    console.error('Не удалось подготовить DSP transition на старте трека', err);
  });
}

export function resolveDspSourceSegmentSeconds(sliceSeconds, transitionDetails = null) {
  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  if (normalizedSlice <= 0) return 0;

  const aggressiveJoin =
    transitionDetails && typeof transitionDetails === 'object' && transitionDetails.aggressiveJoin
      ? transitionDetails.aggressiveJoin
      : null;
  const rawTailTrim = aggressiveJoin ? Number(aggressiveJoin.sourceTailTrimSeconds) : NaN;
  if (!Number.isFinite(rawTailTrim) || rawTailTrim <= 0) {
    return normalizedSlice;
  }

  const maxTrim = Math.max(0, normalizedSlice - 0.05);
  const safeTailTrim = Math.max(0, Math.min(maxTrim, rawTailTrim));
  return Math.max(0.05, normalizedSlice - safeTailTrim);
}

function isCurrentSourceTrackActive(sourceTrack) {
  return Boolean(
    sourceTrack &&
    sourceTrack.key &&
    state.currentTrack &&
    state.currentTrack.key === sourceTrack.key &&
    state.currentAudio &&
    !state.currentAudio.paused,
  );
}

export function resolveDspTransitionStartOffsetSeconds(sourceTrack, sliceSeconds, transitionDetails = null) {
  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  if (normalizedSlice <= 0) return 0;
  const sourceSegmentSeconds = resolveDspSourceSegmentSeconds(normalizedSlice, transitionDetails);

  if (!isCurrentSourceTrackActive(sourceTrack)) {
    // Source track already ended: start transition fragment from its beginning.
    return 0;
  }

  const sourceDuration = _deps.getDuration(state.currentAudio) || _deps.getKnownDurationSeconds(sourceTrack.key);
  const sourceCurrentTime = Number.isFinite(state.currentAudio.currentTime) ? Math.max(0, state.currentAudio.currentTime) : null;
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || sourceCurrentTime === null) {
    return 0;
  }

  const remainingSeconds = Math.max(0, sourceDuration - sourceCurrentTime);
  const offsetSeconds = normalizedSlice - remainingSeconds;
  if (!Number.isFinite(offsetSeconds) || offsetSeconds <= 0) return 0;
  return Math.max(0, Math.min(offsetSeconds, sourceSegmentSeconds));
}

export async function tryStartAutoplayWithDspTransition(finishedTrack, nextTrack) {
  if (!isHostRole()) return false;
  if (!finishedTrack || !nextTrack) return false;
  if ((finishedTrack.basePath || '/audio') !== '/audio') return false;
  if ((nextTrack.basePath || '/audio') !== '/audio') return false;
  if (!isPlaylistDspEnabled(nextTrack.playlistIndex)) return false;

  let details;
  try {
    details = await fetchDspTransitionPairDetails(finishedTrack.file, nextTrack.file);
  } catch (err) {
    return false;
  }

  if (details.status !== 'ready' || !details.outputUrl) {
    return false;
  }
  warmupDspTransitionOutput(details.outputUrl, { urgent: true }).catch(() => {});

  const sourceTrack = toPlaybackTrackDescriptor(finishedTrack, '/audio');
  const targetTrack = toPlaybackTrackDescriptor(nextTrack, '/audio');
  const targetButton = _deps.getTrackButton(
    nextTrack.file,
    nextTrack.playlistIndex,
    nextTrack.playlistPosition,
    nextTrack.basePath || '/audio',
  );
  if (!targetButton) return false;
  const sliceSeconds = normalizeDspTransitionSliceSeconds(details.sliceSeconds);
  let cachedContinuationWarmup = consumeLiveDspContinuationWarmup(nextTrack, sliceSeconds);
  if (!cachedContinuationWarmup) {
    cachedContinuationWarmup = primeLiveDspContinuationWarmup(nextTrack, sliceSeconds);
  }
  const transitionStartOffsetSeconds = resolveDspTransitionStartOffsetSeconds(
    sourceTrack,
    sliceSeconds,
    details.transition,
  );
  const sourceSegmentSeconds = resolveDspSourceSegmentSeconds(sliceSeconds, details.transition);
  const sourceTrackActiveAtPlanning = isCurrentSourceTrackActive(sourceTrack);
  const transitionOffsetPlannedAt = performance.now();

  if (_deps.isDspTransitionPlaybackActive()) {
    _deps.stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
  }

  const previousAudio = state.currentAudio;
  resetFadeState();
  _deps.stopProgressLoop();
  state.currentAudio = null;
  state.currentTrack = null;

  _deps.setButtonPlaying(sourceTrack.key, true, sourceTrack);
  _deps.setTrackPaused(sourceTrack.key, false, sourceTrack);
  _deps.setButtonPlaying(targetTrack.key, true, targetTrack);
  _deps.setTrackPaused(targetTrack.key, false, targetTrack);

  const transitionAudio = _deps.trackLiveAudioInstance(new Audio(details.outputUrl));
  transitionAudio.preload = 'auto';
  transitionAudio.volume = getEffectiveLiveVolume(targetTrack);
  state.dspTransitionPlayback = {
    audio: transitionAudio,
    fromTrack: sourceTrack,
    toTrack: targetTrack,
    duration: null,
    sliceSeconds,
    startOffsetSeconds: transitionStartOffsetSeconds,
    outputUrl: details.outputUrl,
  };
  syncDspTransitionTrackHighlight();
  syncNowPlayingPanel();

  const hasSourceTrackReachedEndBeforeTransitionStart = () => {
    if (!sourceTrackActiveAtPlanning || !previousAudio) return true;
    if (previousAudio.ended) return true;

    const duration = _deps.getDuration(previousAudio);
    const currentTime = Number.isFinite(previousAudio.currentTime) ? Math.max(0, previousAudio.currentTime) : null;
    if (!Number.isFinite(duration) || duration <= 0 || currentTime === null) {
      return Boolean(previousAudio.paused);
    }

    const remainingSeconds = duration - currentTime;
    return Boolean(previousAudio.paused) || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0.03;
  };

  const resolveAdjustedTransitionStartOffsetSeconds = () => {
    if (hasSourceTrackReachedEndBeforeTransitionStart()) {
      return 0;
    }

    const startupDelaySeconds = Math.max(0, (performance.now() - transitionOffsetPlannedAt) / 1000);
    const rawOffset = Math.max(
      0,
      transitionStartOffsetSeconds + startupDelaySeconds + state.liveDspEntryCompensationSeconds,
    );
    const clampedToSourceSegment = Math.max(0, Math.min(rawOffset, sourceSegmentSeconds));
    const knownDuration =
      _deps.getDuration(transitionAudio) ||
      (state.dspTransitionPlayback && Number.isFinite(state.dspTransitionPlayback.duration) && state.dspTransitionPlayback.duration > 0
        ? state.dspTransitionPlayback.duration
        : null);
    if (!knownDuration) return clampedToSourceSegment;
    return Math.max(0, Math.min(clampedToSourceSegment, Math.max(0, knownDuration - 0.02)));
  };

  let handoffStarted = false;
  let continuationAudio = null;
  let continuationPreparePromise = null;
  let cachedContinuationResolved = false;

  const prepareContinuationAudio = async () => {
    if (continuationAudio) return continuationAudio;
    if (continuationPreparePromise) return continuationPreparePromise;

    continuationPreparePromise = (async () => {
      if (!cachedContinuationResolved && cachedContinuationWarmup) {
        cachedContinuationResolved = true;
        try {
          const cachedAudio = await cachedContinuationWarmup;
          if (cachedAudio) {
            cachedAudio.volume = getEffectiveLiveVolume(targetTrack);
            continuationAudio = cachedAudio;
            return cachedAudio;
          }
        } catch (err) {
          // ignore cache warmup errors and fallback to direct prepare
        }
      }

      const preparedAudio = createAudio(targetTrack);
      preparedAudio.preload = 'auto';
      preparedAudio.volume = getEffectiveLiveVolume(targetTrack);
      if (sliceSeconds > 0) {
        await _deps.seekAudioToOffset(preparedAudio, sliceSeconds);
      }
      continuationAudio = preparedAudio;
      return preparedAudio;
    })().finally(() => {
      continuationPreparePromise = null;
    });

    return continuationPreparePromise;
  };

  const fallbackToRegularNextTrackStart = async () => {
    _deps.stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
    const refreshedButton = _deps.getTrackButton(
      nextTrack.file,
      nextTrack.playlistIndex,
      nextTrack.playlistPosition,
      nextTrack.basePath || '/audio',
    );
    if (!refreshedButton) {
      setStatus('Не удалось продолжить после перехода: следующий трек не найден.');
      syncNowPlayingPanel();
      return;
    }

    await handlePlay(nextTrack.file, refreshedButton, nextTrack.basePath || '/audio', {
      playlistId: nextTrack.playlistId,
      trackId: nextTrack.trackId,
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
      fromAutoplay: true,
      fromDspTransition: true,
      startAtSeconds: sliceSeconds,
    });
  };

  const startNextTrackFromTransition = async ({ reason = 'ended' } = {}) => {
    if (handoffStarted) return;
    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) {
      return;
    }
    handoffStarted = true;

    let preparedAudio = continuationAudio;
    if (!preparedAudio) {
      try {
        preparedAudio = await prepareContinuationAudio();
      } catch (err) {
        preparedAudio = null;
      }
    }

    if (!preparedAudio) {
      await fallbackToRegularNextTrackStart();
      return;
    }

    try {
      preparedAudio.volume = getEffectiveLiveVolume(targetTrack);
      try {
        transitionAudio.pause();
      } catch (err) {
        // ignore pause errors while switching from DSP transition
      }
      await preparedAudio.play();
    } catch (err) {
      await fallbackToRegularNextTrackStart();
      return;
    }

    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) {
      return;
    }

    _deps.stopDspTransitionPlayback({ stopAudio: true, clearTrackState: false });
    state.currentAudio = preparedAudio;
    state.currentTrack = targetTrack;
    _deps.setButtonPlaying(sourceTrack.key, false, sourceTrack);
    _deps.setTrackPaused(sourceTrack.key, false, sourceTrack);
    _deps.setButtonPlaying(targetTrack.key, true, targetTrack);
    _deps.setTrackPaused(targetTrack.key, false, targetTrack);
    _deps.startProgressLoop(preparedAudio, targetTrack.key);
    _deps.stopUnexpectedLiveAudios([preparedAudio]);
    setStatus(`Играет: ${nextTrack.file}`);
    triggerLiveDspTransitionForTrack(targetTrack);
    syncNowPlayingPanel();
    _deps.requestHostPlaybackSync(true);
  };

  transitionAudio.addEventListener('loadedmetadata', () => {
    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) return;
    const duration = _deps.getDuration(transitionAudio);
    if (duration) {
      state.dspTransitionPlayback.duration = duration;
    }
    syncNowPlayingPanel();
  });

  transitionAudio.addEventListener('timeupdate', () => {
    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) return;
    if (!handoffStarted) {
      const activeDuration = _deps.getDuration(transitionAudio) || state.dspTransitionPlayback.duration;
      const currentTime =
        Number.isFinite(transitionAudio.currentTime) && transitionAudio.currentTime >= 0
          ? transitionAudio.currentTime
          : 0;
      if (Number.isFinite(activeDuration) && activeDuration > 0) {
        const remaining = Math.max(0, activeDuration - currentTime);
        const handoffLeadSeconds = Math.max(0, LIVE_DSP_HANDOFF_LEAD_SECONDS + state.liveDspExitCompensationSeconds);
        if (remaining <= handoffLeadSeconds) {
          startNextTrackFromTransition({ reason: 'near-end' }).catch((err) => {
            console.error('Не удалось переключиться с DSP transition (near-end)', err);
          });
        }
      }
    }
    syncNowPlayingPanel();
  });

  transitionAudio.addEventListener('ended', () => {
    startNextTrackFromTransition({ reason: 'ended' }).catch((err) => {
      console.error('Не удалось завершить DSP transition', err);
      _deps.stopDspTransitionPlayback({ stopAudio: false, clearTrackState: true });
      syncNowPlayingPanel();
    });
  });

  transitionAudio.addEventListener('error', () => {
    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) return;
    _deps.stopDspTransitionPlayback({ stopAudio: false, clearTrackState: true });
    setStatus('Ошибка воспроизведения DSP перехода. Переходим к следующему треку.');
    handlePlay(nextTrack.file, targetButton, nextTrack.basePath || '/audio', {
      playlistId: nextTrack.playlistId,
      trackId: nextTrack.trackId,
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
      fromAutoplay: true,
    }).catch((err) => {
      console.error('Не удалось запустить следующий трек после ошибки DSP transition', err);
    });
  });

  prepareContinuationAudio().catch(() => {});

  try {
    let adjustedTransitionStartOffsetSeconds = resolveAdjustedTransitionStartOffsetSeconds();
    if (adjustedTransitionStartOffsetSeconds > 0) {
      await _deps.seekAudioToOffset(transitionAudio, adjustedTransitionStartOffsetSeconds);
    }
    if (adjustedTransitionStartOffsetSeconds > 0 && hasSourceTrackReachedEndBeforeTransitionStart()) {
      adjustedTransitionStartOffsetSeconds = 0;
      try {
        transitionAudio.currentTime = 0;
      } catch (err) {
        // ignore seek reset failures for unsupported formats/devices
      }
    }
    if (state.dspTransitionPlayback && state.dspTransitionPlayback.audio === transitionAudio) {
      state.dspTransitionPlayback.startOffsetSeconds = adjustedTransitionStartOffsetSeconds;
    }
    if (previousAudio) {
      try {
        previousAudio.pause();
      } catch (err) {
        // ignore pause errors while switching to DSP transition
      }
    }
    await transitionAudio.play();
    setStatus(`Переход: ${finishedTrack.file} -> ${nextTrack.file}`);
    return true;
  } catch (err) {
    _deps.stopDspTransitionPlayback({ stopAudio: false, clearTrackState: true });
    return false;
  }
}

export async function tryAutoplayNextTrack(finishedTrack) {
  if (!isHostRole()) return false;
  if (state.autoplayStartInFlight) return false;

  state.autoplayStartInFlight = true;
  try {
    const nextTrack = _deps.resolveAutoplayNextTrack(finishedTrack);
    if (!nextTrack) return false;

    const transitionStarted = await tryStartAutoplayWithDspTransition(finishedTrack, nextTrack);
    if (transitionStarted) return true;

    const button = _deps.getTrackButton(nextTrack.file, nextTrack.playlistIndex, nextTrack.playlistPosition, nextTrack.basePath);
    if (!button) return false;

    await handlePlay(nextTrack.file, button, nextTrack.basePath, {
      playlistId: nextTrack.playlistId,
      trackId: nextTrack.trackId,
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
      fromAutoplay: true,
    });
    const expectedKey = trackKey(nextTrack.file, nextTrack.basePath || '/audio');
    return Boolean(state.currentTrack && state.currentAudio && !state.currentAudio.paused && state.currentTrack.key === expectedKey);
  } finally {
    state.autoplayStartInFlight = false;
  }
}
