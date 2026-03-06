'use strict';

function normalizeDspTransitionSeconds(value, cfg) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return cfg.DSP_DEFAULT_TRANSITION_SECONDS;
  return Math.max(0.2, Math.min(30, Math.round(numeric * 1000) / 1000));
}

function normalizeDspSliceSeconds(value, transitionSeconds, cfg) {
  const numeric = Number(value);
  const fallback = Math.max(cfg.DSP_DEFAULT_SLICE_SECONDS, transitionSeconds + 0.2);
  if (!Number.isFinite(numeric)) return fallback;
  const bounded = Math.max(transitionSeconds + 0.2, Math.min(120, numeric));
  return Math.round(bounded * 1000) / 1000;
}

function normalizeDspTransitionInputFile(rawFile, deps) {
  if (typeof rawFile !== 'string') return null;
  const normalized = deps.normalizeAudioRelativePath(rawFile.trim());
  if (!normalized) return null;

  const absolutePath = deps.safeResolve(deps.AUDIO_DIR_RESOLVED, normalized);
  if (!absolutePath) return null;
  if (!deps.isAudioFile(absolutePath)) return null;

  return {
    file: normalized,
    absolutePath,
  };
}

function buildDspTransitionId(fromFile, toFile, transitionSeconds, sliceSeconds, cfg, deps) {
  const hashInput = JSON.stringify({
    v: 7,
    fromFile,
    toFile,
    transitionSeconds,
    sliceSeconds,
    tempoAlignEnabled: cfg.DSP_TEMPO_ALIGN_ENABLED,
    tempoMaxAdjustPercent: cfg.DSP_TEMPO_MAX_ADJUST_PERCENT,
    tempoGlideEnabled: cfg.DSP_TEMPO_GLIDE_ENABLED,
    tempoGlideSegments: cfg.DSP_TEMPO_GLIDE_SEGMENTS,
    tempoGlideAnchorSeconds: cfg.DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
    tempoMinDeltaRatio: cfg.DSP_TEMPO_MIN_DELTA_RATIO,
    aggressiveJoinEnabled: cfg.DSP_AGGRESSIVE_JOIN_ENABLED,
    joinIntensity: cfg.DSP_JOIN_INTENSITY,
    joinMinTransitionSeconds: cfg.DSP_JOIN_MIN_TRANSITION_SECONDS,
    trimSilenceEnabled: cfg.DSP_TRIM_SILENCE_ENABLED,
    trimSilenceThresholdDb: cfg.DSP_TRIM_SILENCE_THRESHOLD_DB,
    trimMinSilenceSeconds: cfg.DSP_TRIM_MIN_SILENCE_SECONDS,
    trimMaxSeconds: cfg.DSP_TRIM_MAX_SECONDS,
    noGapGuardEnabled: cfg.DSP_NO_GAP_GUARD_ENABLED,
    trimGuardThresholdBoostDb: cfg.DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
    noGapEnergyTrimEnabled: cfg.DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    noGapEnergyFloorRatio: cfg.DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    noGapEnergyMeanMultiplier: cfg.DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
    format: cfg.DSP_TRANSITION_OUTPUT_FORMAT,
    codec: cfg.DSP_TRANSITION_OUTPUT_CODEC,
  });
  return deps.crypto.createHash('sha1').update(hashInput).digest('hex');
}

function buildDspTransitionDescriptor(rawFrom, rawTo, options, cfg, deps) {
  if (!cfg.DSP_ENABLED) {
    return { error: 'DSP отключен в конфигурации (dsp_enabled=false).' };
  }

  const fromTrack = normalizeDspTransitionInputFile(rawFrom, deps);
  const toTrack = normalizeDspTransitionInputFile(rawTo, deps);
  if (!fromTrack || !toTrack) {
    return { error: 'Некорректные пути треков для transition.' };
  }

  const transitionSeconds = normalizeDspTransitionSeconds(options.transitionSeconds, cfg);
  const sliceSeconds = normalizeDspSliceSeconds(options.sliceSeconds, transitionSeconds, cfg);
  const id = buildDspTransitionId(fromTrack.file, toTrack.file, transitionSeconds, sliceSeconds, cfg, deps);
  const outputFileName = `${id}.${cfg.DSP_TRANSITION_OUTPUT_FORMAT}`;
  const outputPath = deps.path.join(cfg.DSP_TRANSITIONS_DIR, outputFileName);

  return {
    id,
    fromFile: fromTrack.file,
    toFile: toTrack.file,
    fromAbsolutePath: fromTrack.absolutePath,
    toAbsolutePath: toTrack.absolutePath,
    transitionSeconds,
    sliceSeconds,
    outputFileName,
    outputPath,
  };
}

function buildDspTransitionOutputUrl(id) {
  return `/api/dsp/transitions/file/${id}`;
}

function buildDspOutputEncodingArgs(cfg) {
  if (cfg.DSP_TRANSITION_OUTPUT_FORMAT === 'wav') {
    return ['-c:a', 'pcm_s16le'];
  }
  return ['-c:a', 'libmp3lame', '-q:a', '2'];
}

function resolveDspTransitionOutputPathById(id, state, cfg, deps) {
  if (!id) return null;

  const knownItem = state.dspTransitions.get(id);
  if (knownItem && typeof knownItem.outputPath === 'string' && knownItem.outputPath) {
    const knownPath = deps.safeResolve(cfg.DSP_TRANSITIONS_DIR, deps.path.basename(knownItem.outputPath));
    if (knownPath && deps.fs.existsSync(knownPath)) {
      return knownPath;
    }
  }

  const preferredPath = deps.safeResolve(cfg.DSP_TRANSITIONS_DIR, `${id}.${cfg.DSP_TRANSITION_OUTPUT_FORMAT}`);
  if (preferredPath && deps.fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  const fallbackExts = cfg.DSP_TRANSITION_OUTPUT_FORMAT === 'wav' ? ['mp3'] : ['wav'];
  for (const ext of fallbackExts) {
    const fallbackPath = deps.safeResolve(cfg.DSP_TRANSITIONS_DIR, `${id}.${ext}`);
    if (fallbackPath && deps.fs.existsSync(fallbackPath)) {
      return fallbackPath;
    }
  }

  return preferredPath;
}

module.exports = {
  normalizeDspTransitionSeconds,
  normalizeDspSliceSeconds,
  normalizeDspTransitionInputFile,
  buildDspTransitionId,
  buildDspTransitionDescriptor,
  buildDspTransitionOutputUrl,
  buildDspOutputEncodingArgs,
  resolveDspTransitionOutputPathById,
};
