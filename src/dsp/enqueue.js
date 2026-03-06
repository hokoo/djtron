'use strict';

const { DSP_STATUS_QUEUED, DSP_STATUS_PROCESSING, DSP_STATUS_READY, DSP_STATUS_FAILED } = require('./constants');
const { buildDspTransitionDescriptor } = require('./descriptor');
const { appendDspLog } = require('./log');
const { toDspErrorMessage, queueDspTransition, scheduleDspWorker, markDspTransitionFailed, trimDspHistory } = require('./queue');

function buildBinaryProbeCandidates(binaryName) {
  const normalized = typeof binaryName === 'string' ? binaryName.trim() : '';
  if (!normalized) return [];
  if (/\.exe$/i.test(normalized)) return [normalized];
  return [normalized, `${normalized}.exe`];
}

async function probeBinaryVersion(binaryName, deps) {
  let lastError = null;
  const candidates = buildBinaryProbeCandidates(binaryName);
  for (const candidate of candidates) {
    try {
      await deps.execFileAsync(candidate, ['-version'], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 512 * 1024,
      });
      return { ok: true, binary: candidate, error: null };
    } catch (err) {
      lastError = err;
    }
  }
  return { ok: false, binary: null, error: lastError };
}

async function ensureFfmpegAvailable(state, cfg, deps) {
  if (!cfg.DSP_ENABLED) {
    state.dspProbeState.available = false;
    state.dspProbeState.error = 'DSP disabled';
    state.dspProbeState.checkedAt = Date.now();
    return false;
  }

  const now = Date.now();
  if (now - state.dspProbeState.checkedAt < cfg.DSP_PROBE_CACHE_MS && state.dspProbeState.available !== null) {
    return state.dspProbeState.available;
  }

  const previousAvailable = state.dspProbeState.available;
  const previousError = state.dspProbeState.error;

  const ffmpegProbe = await probeBinaryVersion(cfg.DSP_FFMPEG_BINARY, deps);
  if (ffmpegProbe.ok) {
    cfg.DSP_FFMPEG_BINARY = ffmpegProbe.binary;
    const ffprobeProbe = await probeBinaryVersion(cfg.DSP_FFPROBE_BINARY, deps);
    if (ffprobeProbe.ok) {
      cfg.DSP_FFPROBE_BINARY = ffprobeProbe.binary;
    }
    state.dspProbeState.checkedAt = now;
    state.dspProbeState.available = true;
    state.dspProbeState.error = null;
    if (previousAvailable !== true || previousError) {
      appendDspLog('ffmpeg.ready', {
        binary: cfg.DSP_FFMPEG_BINARY,
      }, state, cfg, deps);
    }
    return true;
  }

  const probeTargetLabel = buildBinaryProbeCandidates(cfg.DSP_FFMPEG_BINARY)[0] || cfg.DSP_FFMPEG_BINARY || 'ffmpeg';
  state.dspProbeState.checkedAt = now;
  state.dspProbeState.available = false;
  state.dspProbeState.error = toDspErrorMessage(ffmpegProbe.error, `Не удалось запустить ${probeTargetLabel}.`);
  if (previousAvailable !== false || previousError !== state.dspProbeState.error) {
    appendDspLog('ffmpeg.error', {
      binary: probeTargetLabel,
      error: state.dspProbeState.error,
    }, state, cfg, deps);
  }
  return false;
}

function enqueueDspTransition(fromFile, toFile, options, state, cfg, deps) {
  const descriptor = buildDspTransitionDescriptor(fromFile, toFile, options, cfg, deps);
  if (descriptor.error) {
    return {
      ok: false,
      created: false,
      enqueued: false,
      error: descriptor.error,
      item: null,
    };
  }

  const now = Date.now();
  const existing = state.dspTransitions.get(descriptor.id);
  const force = Boolean(options.force);
  const priority = options.priority === 'high' ? 'high' : 'normal';
  const sourceLabel = typeof options.source === 'string' && options.source ? options.source.slice(0, 64) : 'api';

  if (existing) {
    existing.lastRequestedAt = now;
    existing.source = sourceLabel;

    if (force && existing.status !== DSP_STATUS_PROCESSING) {
      existing.error = null;
      existing.status = DSP_STATUS_QUEUED;
      const enqueued = queueDspTransition(existing, priority, state, cfg);
      if (enqueued) {
        scheduleDspWorker(state, cfg, deps);
      } else if (state.dspQueue.length >= cfg.DSP_MAX_QUEUE_LENGTH) {
        markDspTransitionFailed(existing, 'DSP queue is full. Increase dsp_max_queue.');
      }
      appendDspLog('transition.enqueue', {
        id: existing.id,
        from: existing.fromFile,
        to: existing.toFile,
        source: existing.source || 'unknown',
        created: false,
        force,
        priority,
        enqueued,
        status: existing.status,
      }, state, cfg, deps);

      return {
        ok: true,
        created: false,
        enqueued,
        error: enqueued ? null : existing.error || 'Не удалось поставить задачу в очередь.',
        item: existing,
      };
    }

    if (existing.status === DSP_STATUS_READY && !deps.fs.existsSync(existing.outputPath)) {
      const enqueued = queueDspTransition(existing, priority, state, cfg);
      if (enqueued) scheduleDspWorker(state, cfg, deps);
      appendDspLog('transition.enqueue', {
        id: existing.id,
        from: existing.fromFile,
        to: existing.toFile,
        source: existing.source || 'unknown',
        created: false,
        force,
        priority,
        enqueued,
        status: existing.status,
      }, state, cfg, deps);
      return {
        ok: true,
        created: false,
        enqueued,
        error: enqueued ? null : 'Не удалось восстановить задачу из кэша.',
        item: existing,
      };
    }
    appendDspLog('transition.enqueue', {
      id: existing.id,
      from: existing.fromFile,
      to: existing.toFile,
      source: existing.source || 'unknown',
      created: false,
      force,
      priority,
      enqueued: false,
      status: existing.status,
    }, state, cfg, deps);

    return {
      ok: true,
      created: false,
      enqueued: false,
      error: null,
      item: existing,
    };
  }

  const item = {
    id: descriptor.id,
    fromFile: descriptor.fromFile,
    toFile: descriptor.toFile,
    fromAbsolutePath: descriptor.fromAbsolutePath,
    toAbsolutePath: descriptor.toAbsolutePath,
    transitionSeconds: descriptor.transitionSeconds,
    sliceSeconds: descriptor.sliceSeconds,
    outputFileName: descriptor.outputFileName,
    outputPath: descriptor.outputPath,
    status: DSP_STATUS_QUEUED,
    inQueue: false,
    attempts: 0,
    error: null,
    tempoAlignment: null,
    aggressiveJoin: null,
    outputSizeBytes: null,
    sourceMtimeMs: null,
    createdAt: now,
    updatedAt: now,
    lastRequestedAt: now,
    source: sourceLabel,
  };

  state.dspTransitions.set(item.id, item);
  const enqueued = queueDspTransition(item, priority, state, cfg);
  if (enqueued) {
    scheduleDspWorker(state, cfg, deps);
  } else if (state.dspQueue.length >= cfg.DSP_MAX_QUEUE_LENGTH) {
    markDspTransitionFailed(item, 'DSP queue is full. Increase dsp_max_queue.');
  }
  appendDspLog('transition.enqueue', {
    id: item.id,
    from: item.fromFile,
    to: item.toFile,
    source: item.source || 'unknown',
    created: true,
    force,
    priority,
    enqueued,
    status: item.status,
  }, state, cfg, deps);
  trimDspHistory(state, cfg);

  return {
    ok: true,
    created: true,
    enqueued,
    error: enqueued ? null : item.error || 'Не удалось поставить задачу в очередь.',
    item,
  };
}

function collectAdjacentLayoutTransitions(layout, playlistDspFlags, deps) {
  if (!Array.isArray(layout)) return [];

  const seen = new Set();
  const transitions = [];

  layout.forEach((playlist, playlistIndex) => {
    if (Array.isArray(playlistDspFlags) && !Boolean(playlistDspFlags[playlistIndex])) return;
    if (!Array.isArray(playlist) || playlist.length < 2) return;

    for (let index = 0; index < playlist.length - 1; index += 1) {
      const fromRaw = typeof playlist[index] === 'string' ? playlist[index].trim() : '';
      const toRaw = typeof playlist[index + 1] === 'string' ? playlist[index + 1].trim() : '';
      if (!fromRaw || !toRaw) continue;

      const fromFile = deps.normalizeAudioRelativePath(fromRaw);
      const toFile = deps.normalizeAudioRelativePath(toRaw);
      if (!fromFile || !toFile) continue;

      const dedupeKey = `${fromFile}\n${toFile}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      transitions.push({ fromFile, toFile });
    }
  });

  return transitions;
}

function toRelativeAudioFileFromTrack(track, deps) {
  if (!track || typeof track !== 'object') return '';
  const fromMeta = track.meta && typeof track.meta.originalPath === 'string' ? track.meta.originalPath.trim() : '';
  if (fromMeta) {
    return deps.normalizeAudioRelativePath(fromMeta);
  }

  const src = typeof track.src === 'string' ? track.src.trim() : '';
  if (!src) return '';

  let normalized = src.replace(/^https?:\/\/[^/]+/i, '');
  const queryIndex = normalized.indexOf('?');
  if (queryIndex >= 0) normalized = normalized.slice(0, queryIndex);
  const hashIndex = normalized.indexOf('#');
  if (hashIndex >= 0) normalized = normalized.slice(0, hashIndex);
  if (normalized.startsWith('/audio/')) normalized = normalized.slice('/audio/'.length);
  else if (normalized.startsWith('audio/')) normalized = normalized.slice('audio/'.length);
  else normalized = normalized.replace(/^\/+/, '');

  return deps.normalizeAudioRelativePath(normalized.trim());
}

function collectAdjacentPlaylistTransitions(playlists, deps) {
  if (!Array.isArray(playlists)) return [];

  const seen = new Set();
  const transitions = [];

  playlists.forEach((playlist) => {
    if (!playlist || typeof playlist !== 'object') return;
    const settings = playlist.settings && typeof playlist.settings === 'object' ? playlist.settings : {};
    const dspEnabled = Boolean(settings.autoPlayEnabled) && Boolean(settings.dspEnabled);
    if (!dspEnabled) return;

    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    if (tracks.length < 2) return;

    for (let index = 0; index < tracks.length - 1; index += 1) {
      const fromFile = toRelativeAudioFileFromTrack(tracks[index], deps);
      const toFile = toRelativeAudioFileFromTrack(tracks[index + 1], deps);
      if (!fromFile || !toFile) continue;

      const dedupeKey = `${fromFile}\n${toFile}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      transitions.push({ fromFile, toFile });
    }
  });

  return transitions;
}

function scheduleDspTransitionsFromLayout(layout, options, state, cfg, deps) {
  const transitions = collectAdjacentLayoutTransitions(layout, options.playlistDspFlags, deps);
  if (!transitions.length) {
    return { total: 0, accepted: 0, created: 0, enqueued: 0, failed: 0 };
  }

  let accepted = 0;
  let created = 0;
  let enqueued = 0;
  let failed = 0;

  transitions.forEach((entry) => {
    const result = enqueueDspTransition(entry.fromFile, entry.toFile, {
      transitionSeconds: options.transitionSeconds,
      sliceSeconds: options.sliceSeconds,
      force: Boolean(options.force),
      source: options.source || 'layout',
      priority: options.priority || 'normal',
    }, state, cfg, deps);
    if (!result.ok) {
      failed += 1;
      return;
    }
    accepted += 1;
    if (result.created) created += 1;
    if (result.enqueued) enqueued += 1;
  });

  return {
    total: transitions.length,
    accepted,
    created,
    enqueued,
    failed,
  };
}

function scheduleDspTransitionsFromPlaylists(playlists, options, state, cfg, deps) {
  const transitions = collectAdjacentPlaylistTransitions(playlists, deps);
  if (!transitions.length) {
    return { total: 0, accepted: 0, created: 0, enqueued: 0, failed: 0 };
  }

  let accepted = 0;
  let created = 0;
  let enqueued = 0;
  let failed = 0;

  transitions.forEach((entry) => {
    const result = enqueueDspTransition(entry.fromFile, entry.toFile, {
      transitionSeconds: options.transitionSeconds,
      sliceSeconds: options.sliceSeconds,
      force: Boolean(options.force),
      source: options.source || 'layout',
      priority: options.priority || 'normal',
    }, state, cfg, deps);
    if (!result.ok) {
      failed += 1;
      return;
    }
    accepted += 1;
    if (result.created) created += 1;
    if (result.enqueued) enqueued += 1;
  });

  return {
    total: transitions.length,
    accepted,
    created,
    enqueued,
    failed,
  };
}

function getDspTransitionByPair(fromFile, toFile, options, state, cfg, deps) {
  const descriptor = buildDspTransitionDescriptor(fromFile, toFile, options, cfg, deps);
  if (descriptor.error) {
    return { ok: false, error: descriptor.error, item: null, descriptor: null };
  }

  const existing = state.dspTransitions.get(descriptor.id);
  if (!existing) {
    return { ok: true, error: null, item: null, descriptor };
  }

  return { ok: true, error: null, item: existing, descriptor };
}

module.exports = {
  ensureFfmpegAvailable,
  enqueueDspTransition,
  collectAdjacentLayoutTransitions,
  collectAdjacentPlaylistTransitions,
  scheduleDspTransitionsFromLayout,
  scheduleDspTransitionsFromPlaylists,
  getDspTransitionByPair,
};
