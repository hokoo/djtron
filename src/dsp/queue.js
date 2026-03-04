'use strict';

const path = require('path');
const { DSP_STATUS_QUEUED, DSP_STATUS_PROCESSING, DSP_STATUS_READY, DSP_STATUS_FAILED } = require('./constants');
const { buildDspTransitionOutputUrl, buildDspOutputEncodingArgs } = require('./descriptor');
const { appendDspLog } = require('./log');
const { formatFfmpegFilterNumber, detectTrackTempoBpm, buildTempoAlignedTargetFilter } = require('./tempo');
const { computeDspTrimSeconds, computeDspEnergyTrimSeconds } = require('./trim');

function buildDspQueueSummary(state, cfg) {
  let processing = 0;
  let ready = 0;
  let failed = 0;

  for (const item of state.dspTransitions.values()) {
    if (item.status === DSP_STATUS_PROCESSING) processing += 1;
    if (item.status === DSP_STATUS_READY) ready += 1;
    if (item.status === DSP_STATUS_FAILED) failed += 1;
  }

  return {
    enabled: cfg.DSP_ENABLED,
    ffmpegBinary: cfg.DSP_FFMPEG_BINARY,
    ffprobeBinary: cfg.DSP_FFPROBE_BINARY,
    ffmpegAvailable: state.dspProbeState.available,
    ffmpegError: state.dspProbeState.error,
    wingetCommand: 'winget install "FFmpeg (Essentials Build)"',
    logFile: path.basename(cfg.DSP_LOG_PATH),
    transitionOutputFormat: cfg.DSP_TRANSITION_OUTPUT_FORMAT,
    transitionOutputCodec: cfg.DSP_TRANSITION_OUTPUT_CODEC,
    tempoAlignEnabled: cfg.DSP_TEMPO_ALIGN_ENABLED,
    tempoMaxAdjustPercent: cfg.DSP_TEMPO_MAX_ADJUST_PERCENT,
    tempoGlideEnabled: cfg.DSP_TEMPO_GLIDE_ENABLED,
    tempoGlideSegments: cfg.DSP_TEMPO_GLIDE_SEGMENTS,
    tempoGlideAnchorSeconds: cfg.DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
    aggressiveJoinEnabled: cfg.DSP_AGGRESSIVE_JOIN_ENABLED,
    joinIntensity: cfg.DSP_JOIN_INTENSITY,
    trimSilenceEnabled: cfg.DSP_TRIM_SILENCE_ENABLED,
    trimSilenceDb: cfg.DSP_TRIM_SILENCE_THRESHOLD_DB,
    trimMaxSeconds: cfg.DSP_TRIM_MAX_SECONDS,
    noGapGuardEnabled: cfg.DSP_NO_GAP_GUARD_ENABLED,
    trimGuardThresholdBoostDb: cfg.DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
    noGapEnergyTrimEnabled: cfg.DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    noGapEnergyFloorRatio: cfg.DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    pending: state.dspQueue.length,
    processing,
    ready,
    failed,
    total: state.dspTransitions.size,
  };
}

function serializeDspTransition(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: item.id,
    fromFile: item.fromFile,
    toFile: item.toFile,
    status: item.status,
    transitionSeconds: item.transitionSeconds,
    sliceSeconds: item.sliceSeconds,
    attempts: item.attempts || 0,
    error: item.error || null,
    outputUrl: item.status === DSP_STATUS_READY ? buildDspTransitionOutputUrl(item.id) : null,
    outputFileName: item.status === DSP_STATUS_READY ? item.outputFileName : null,
    outputSizeBytes: Number.isFinite(item.outputSizeBytes) ? item.outputSizeBytes : null,
    sourceMtimeMs: Number.isFinite(item.sourceMtimeMs) ? item.sourceMtimeMs : null,
    tempoAlignment:
      item.tempoAlignment && typeof item.tempoAlignment === 'object'
        ? {
            enabled: Boolean(item.tempoAlignment.enabled),
            applied: Boolean(item.tempoAlignment.applied),
            ratio: Number.isFinite(item.tempoAlignment.ratio) ? item.tempoAlignment.ratio : null,
            fromBpm: Number.isFinite(item.tempoAlignment.fromBpm) ? item.tempoAlignment.fromBpm : null,
            toBpm: Number.isFinite(item.tempoAlignment.toBpm) ? item.tempoAlignment.toBpm : null,
            fromSource: typeof item.tempoAlignment.fromSource === 'string' ? item.tempoAlignment.fromSource : null,
            toSource: typeof item.tempoAlignment.toSource === 'string' ? item.tempoAlignment.toSource : null,
            glideEnabled: Boolean(item.tempoAlignment.glideEnabled),
            glideApplied: Boolean(item.tempoAlignment.glideApplied),
            glideSegments: Number.isFinite(item.tempoAlignment.glideSegments)
              ? item.tempoAlignment.glideSegments
              : null,
            glideStartRatio: Number.isFinite(item.tempoAlignment.glideStartRatio)
              ? item.tempoAlignment.glideStartRatio
              : null,
            glideEndRatio: Number.isFinite(item.tempoAlignment.glideEndRatio)
              ? item.tempoAlignment.glideEndRatio
              : null,
            reason: typeof item.tempoAlignment.reason === 'string' ? item.tempoAlignment.reason : null,
          }
        : null,
    aggressiveJoin:
      item.aggressiveJoin && typeof item.aggressiveJoin === 'object'
        ? {
            enabled: Boolean(item.aggressiveJoin.enabled),
            applied: Boolean(item.aggressiveJoin.applied),
            intensity: Number.isFinite(item.aggressiveJoin.intensity) ? item.aggressiveJoin.intensity : null,
            effectiveTransitionSeconds: Number.isFinite(item.aggressiveJoin.effectiveTransitionSeconds)
              ? item.aggressiveJoin.effectiveTransitionSeconds
              : null,
            sourceTailTrimSeconds: Number.isFinite(item.aggressiveJoin.sourceTailTrimSeconds)
              ? item.aggressiveJoin.sourceTailTrimSeconds
              : null,
            targetHeadTrimSeconds: Number.isFinite(item.aggressiveJoin.targetHeadTrimSeconds)
              ? item.aggressiveJoin.targetHeadTrimSeconds
              : null,
            sourceTrimSource: typeof item.aggressiveJoin.sourceTrimSource === 'string'
              ? item.aggressiveJoin.sourceTrimSource
              : null,
            targetTrimSource: typeof item.aggressiveJoin.targetTrimSource === 'string'
              ? item.aggressiveJoin.targetTrimSource
              : null,
            sourceRawTailSilenceSeconds: Number.isFinite(item.aggressiveJoin.sourceRawTailSilenceSeconds)
              ? item.aggressiveJoin.sourceRawTailSilenceSeconds
              : null,
            targetRawHeadSilenceSeconds: Number.isFinite(item.aggressiveJoin.targetRawHeadSilenceSeconds)
              ? item.aggressiveJoin.targetRawHeadSilenceSeconds
              : null,
            curveOut: typeof item.aggressiveJoin.curveOut === 'string' ? item.aggressiveJoin.curveOut : null,
            curveIn: typeof item.aggressiveJoin.curveIn === 'string' ? item.aggressiveJoin.curveIn : null,
            noGapGuardEnabled: Boolean(item.aggressiveJoin.noGapGuardEnabled),
            noGapGuardApplied: Boolean(item.aggressiveJoin.noGapGuardApplied),
            guardThresholdDb: Number.isFinite(item.aggressiveJoin.guardThresholdDb)
              ? item.aggressiveJoin.guardThresholdDb
              : null,
            noGapEnergyTrimEnabled: Boolean(item.aggressiveJoin.noGapEnergyTrimEnabled),
            noGapEnergyTrimApplied: Boolean(item.aggressiveJoin.noGapEnergyTrimApplied),
            energyFloorRatio: Number.isFinite(item.aggressiveJoin.energyFloorRatio)
              ? item.aggressiveJoin.energyFloorRatio
              : null,
            reason: typeof item.aggressiveJoin.reason === 'string' ? item.aggressiveJoin.reason : null,
          }
        : null,
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : null,
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : null,
    lastRequestedAt: Number.isFinite(item.lastRequestedAt) ? item.lastRequestedAt : null,
  };
}

function trimDspHistory(state, cfg) {
  if (state.dspTransitions.size <= cfg.DSP_HISTORY_LIMIT) return;

  const candidates = Array.from(state.dspTransitions.values())
    .filter((item) => item && !item.inQueue && item.status !== DSP_STATUS_PROCESSING)
    .sort((left, right) => {
      const leftUpdated = Number.isFinite(left.updatedAt) ? left.updatedAt : 0;
      const rightUpdated = Number.isFinite(right.updatedAt) ? right.updatedAt : 0;
      return leftUpdated - rightUpdated;
    });

  while (state.dspTransitions.size > cfg.DSP_HISTORY_LIMIT && candidates.length > 0) {
    const victim = candidates.shift();
    if (!victim || !victim.id) continue;
    state.dspTransitions.delete(victim.id);
  }
}

function queueDspTransition(item, priority, state, cfg) {
  if (!item || typeof item !== 'object') return false;
  if (item.status === DSP_STATUS_PROCESSING || item.inQueue) return false;
  if (state.dspQueue.length >= cfg.DSP_MAX_QUEUE_LENGTH) return false;

  item.status = DSP_STATUS_QUEUED;
  item.inQueue = true;
  item.updatedAt = Date.now();

  if (priority === 'high') {
    state.dspQueue.unshift(item);
  } else {
    state.dspQueue.push(item);
  }
  return true;
}

function toDspErrorMessage(err, fallback) {
  const fromStderrLines =
    err && typeof err.stderr === 'string' ? err.stderr.trim().split(/\r?\n/).filter(Boolean) : [];
  const fromStderr = fromStderrLines.length ? fromStderrLines[fromStderrLines.length - 1] : '';
  const fromMessage = err && typeof err.message === 'string' ? err.message.trim() : '';
  const resolved = fromStderr || fromMessage || fallback || 'Unknown DSP error';
  return resolved.slice(0, 400);
}

function markDspTransitionReady(item, outputStat, sourceMtimeMs) {
  item.status = DSP_STATUS_READY;
  item.inQueue = false;
  item.error = null;
  item.updatedAt = Date.now();
  item.outputSizeBytes = outputStat && Number.isFinite(outputStat.size) ? outputStat.size : null;
  item.sourceMtimeMs = Number.isFinite(sourceMtimeMs) ? sourceMtimeMs : null;
}

function markDspTransitionFailed(item, errorMessage) {
  item.status = DSP_STATUS_FAILED;
  item.inQueue = false;
  item.error = errorMessage || 'DSP transition failed';
  item.updatedAt = Date.now();
}

async function processDspTransition(item, state, cfg, deps) {
  if (!item || typeof item !== 'object') return;
  const startedAt = Date.now();

  item.inQueue = false;
  item.status = DSP_STATUS_PROCESSING;
  item.updatedAt = Date.now();
  item.attempts = (item.attempts || 0) + 1;
  appendDspLog('transition.start', {
    id: item.id,
    from: item.fromFile,
    to: item.toFile,
    source: item.source || 'unknown',
    attempt: item.attempts,
  }, state, cfg, deps);

  let fromStat;
  let toStat;
  try {
    [fromStat, toStat] = await Promise.all([
      deps.fs.promises.stat(item.fromAbsolutePath),
      deps.fs.promises.stat(item.toAbsolutePath),
    ]);
  } catch (err) {
    markDspTransitionFailed(item, 'Один из исходных треков не найден на диске.');
    appendDspLog('transition.failed', {
      id: item.id,
      from: item.fromFile,
      to: item.toFile,
      source: item.source || 'unknown',
      elapsedMs: Date.now() - startedAt,
      error: item.error,
    }, state, cfg, deps);
    return;
  }

  if (!fromStat.isFile() || !toStat.isFile()) {
    markDspTransitionFailed(item, 'Один из исходных треков недоступен.');
    appendDspLog('transition.failed', {
      id: item.id,
      from: item.fromFile,
      to: item.toFile,
      source: item.source || 'unknown',
      elapsedMs: Date.now() - startedAt,
      error: item.error,
    }, state, cfg, deps);
    return;
  }

  const sourceMtimeMs = Math.max(fromStat.mtimeMs, toStat.mtimeMs);
  try {
    const outputStat = await deps.fs.promises.stat(item.outputPath);
    if (outputStat.isFile() && outputStat.size > 0 && outputStat.mtimeMs >= sourceMtimeMs) {
      markDspTransitionReady(item, outputStat, sourceMtimeMs);
      appendDspLog('transition.ready', {
        id: item.id,
        from: item.fromFile,
        to: item.toFile,
        source: item.source || 'unknown',
        elapsedMs: Date.now() - startedAt,
        cacheHit: true,
        outputSizeBytes: outputStat.size,
        tempoAlignment: item.tempoAlignment || null,
        aggressiveJoin: item.aggressiveJoin || null,
      }, state, cfg, deps);
      return;
    }
  } catch (err) {
    // cache miss
  }

  const ffmpegAvailable = await deps.ensureFfmpegAvailable();
  if (!ffmpegAvailable) {
    markDspTransitionFailed(item, state.dspProbeState.error || 'ffmpeg недоступен.');
    appendDspLog('transition.failed', {
      id: item.id,
      from: item.fromFile,
      to: item.toFile,
      source: item.source || 'unknown',
      elapsedMs: Date.now() - startedAt,
      error: item.error,
    }, state, cfg, deps);
    return;
  }

  try {
    await deps.fs.promises.mkdir(cfg.DSP_TRANSITIONS_DIR, { recursive: true });
  } catch (err) {
    markDspTransitionFailed(item, 'Не удалось создать каталог DSP-кэша.');
    appendDspLog('transition.failed', {
      id: item.id,
      from: item.fromFile,
      to: item.toFile,
      source: item.source || 'unknown',
      elapsedMs: Date.now() - startedAt,
      error: item.error,
    }, state, cfg, deps);
    return;
  }

  const tempoAlignment = {
    enabled: cfg.DSP_TEMPO_ALIGN_ENABLED,
    applied: false,
    ratio: 1,
    fromBpm: null,
    toBpm: null,
    fromSource: null,
    toSource: null,
    glideEnabled: cfg.DSP_TEMPO_GLIDE_ENABLED,
    glideApplied: false,
    glideSegments: null,
    glideStartRatio: null,
    glideEndRatio: 1,
    reason: cfg.DSP_TEMPO_ALIGN_ENABLED ? 'pending' : 'disabled',
  };

  if (cfg.DSP_TEMPO_ALIGN_ENABLED) {
    try {
      const [fromTempoInfo, toTempoInfo] = await Promise.all([
        detectTrackTempoBpm(item.fromFile, item.fromAbsolutePath, fromStat, state, cfg, deps),
        detectTrackTempoBpm(item.toFile, item.toAbsolutePath, toStat, state, cfg, deps),
      ]);

      if (fromTempoInfo && Number.isFinite(fromTempoInfo.bpm)) {
        tempoAlignment.fromBpm = fromTempoInfo.bpm;
        tempoAlignment.fromSource = fromTempoInfo.source || null;
      }
      if (toTempoInfo && Number.isFinite(toTempoInfo.bpm)) {
        tempoAlignment.toBpm = toTempoInfo.bpm;
        tempoAlignment.toSource = toTempoInfo.source || null;
      }

      if (!tempoAlignment.fromBpm && !tempoAlignment.toBpm) {
        tempoAlignment.reason = 'missing-bpm-both';
      } else if (!tempoAlignment.fromBpm) {
        tempoAlignment.reason = 'missing-from-bpm';
      } else if (!tempoAlignment.toBpm) {
        tempoAlignment.reason = 'missing-to-bpm';
      } else {
        const rawRatio = tempoAlignment.fromBpm / tempoAlignment.toBpm;
        if (!Number.isFinite(rawRatio) || rawRatio <= 0) {
          tempoAlignment.reason = 'invalid-ratio';
        } else {
          const clampedRatio = Math.max(cfg.DSP_TEMPO_MIN_RATIO, Math.min(cfg.DSP_TEMPO_MAX_RATIO, rawRatio));
          const normalizedRatio = Math.round(clampedRatio * 10000) / 10000;
          tempoAlignment.ratio = normalizedRatio;

          if (Math.abs(normalizedRatio - 1) >= cfg.DSP_TEMPO_MIN_DELTA_RATIO) {
            tempoAlignment.applied = true;
            tempoAlignment.reason = clampedRatio !== rawRatio ? 'applied-clamped' : 'applied';
          } else {
            tempoAlignment.reason = 'delta-too-small';
          }
        }
      }
    } catch (err) {
      tempoAlignment.reason = 'analysis-error';
    }
  }

  item.tempoAlignment = tempoAlignment;
  const tempoRatio = tempoAlignment.applied && Number.isFinite(tempoAlignment.ratio) && tempoAlignment.ratio > 0
    ? tempoAlignment.ratio
    : 1;

  const aggressiveJoin = {
    enabled: cfg.DSP_AGGRESSIVE_JOIN_ENABLED,
    applied: false,
    intensity: cfg.DSP_JOIN_INTENSITY,
    effectiveTransitionSeconds: item.transitionSeconds,
    sourceTailTrimSeconds: 0,
    targetHeadTrimSeconds: 0,
    sourceTrimSource: 'disabled',
    targetTrimSource: 'disabled',
    sourceRawTailSilenceSeconds: 0,
    targetRawHeadSilenceSeconds: 0,
    curveOut: 'tri',
    curveIn: 'tri',
    noGapGuardEnabled: cfg.DSP_NO_GAP_GUARD_ENABLED,
    noGapGuardApplied: false,
    guardThresholdDb: null,
    noGapEnergyTrimEnabled: cfg.DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    noGapEnergyTrimApplied: false,
    energyFloorRatio: cfg.DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    reason: cfg.DSP_AGGRESSIVE_JOIN_ENABLED ? 'pending' : 'disabled',
  };

  let effectiveTransitionSeconds = item.transitionSeconds;
  let sourceTailTrimSeconds = 0;
  let targetHeadTrimSeconds = 0;
  let sourceTrimSource = 'disabled';
  let targetTrimSource = 'disabled';
  let sourceRawTailSilenceSeconds = 0;
  let targetRawHeadSilenceSeconds = 0;
  let crossfadeCurveOut = 'tri';
  let crossfadeCurveIn = 'tri';
  let noGapGuardApplied = false;
  let guardThresholdDb = null;
  let noGapEnergyTrimApplied = false;

  if (cfg.DSP_AGGRESSIVE_JOIN_ENABLED) {
    const intensityFactor = 1 - cfg.DSP_JOIN_INTENSITY * 0.45;
    const normalizedFactor = Math.max(0.35, Math.min(1, intensityFactor));
    const minTransitionFloor = Math.min(cfg.DSP_JOIN_MIN_TRANSITION_SECONDS, item.transitionSeconds);
    const scaledTransition = Math.round(item.transitionSeconds * normalizedFactor * 1000) / 1000;
    effectiveTransitionSeconds = Math.max(
      minTransitionFloor,
      Math.min(item.transitionSeconds, scaledTransition),
    );
    // Keep crossfade energy stable to avoid perceived "holes" at the splice point.
    crossfadeCurveOut = cfg.DSP_JOIN_INTENSITY >= 0.55 ? 'qsin' : 'tri';
    crossfadeCurveIn = cfg.DSP_JOIN_INTENSITY >= 0.55 ? 'qsin' : 'tri';

    if (cfg.DSP_TRIM_SILENCE_ENABLED) {
      const minSliceOutSeconds = effectiveTransitionSeconds + 0.2;
      const maxSourceTailTrimByLength = Math.max(0, item.sliceSeconds - minSliceOutSeconds);
      const shortestTargetTempoRatio = tempoAlignment.applied
        ? (cfg.DSP_TEMPO_GLIDE_ENABLED ? Math.max(1, tempoRatio) : tempoRatio)
        : 1;
      const minTargetInputSeconds = minSliceOutSeconds * shortestTargetTempoRatio;
      const maxTargetHeadTrimByLength = Math.max(0, item.sliceSeconds - minTargetInputSeconds);

      const [sourceTrimResult, targetTrimResult] = await Promise.all([
        computeDspTrimSeconds({
          trackFile: item.fromFile,
          absolutePath: item.fromAbsolutePath,
          trackStat: fromStat,
          mode: 'tail',
          sliceSeconds: item.sliceSeconds,
          silenceThresholdDb: cfg.DSP_TRIM_SILENCE_THRESHOLD_DB,
          minSilenceSeconds: cfg.DSP_TRIM_MIN_SILENCE_SECONDS,
          maxTrimSeconds: cfg.DSP_TRIM_MAX_SECONDS,
          maxAllowedTrimSeconds: maxSourceTailTrimByLength,
        }, state, cfg, deps),
        computeDspTrimSeconds({
          trackFile: item.toFile,
          absolutePath: item.toAbsolutePath,
          trackStat: toStat,
          mode: 'head',
          sliceSeconds: item.sliceSeconds,
          silenceThresholdDb: cfg.DSP_TRIM_SILENCE_THRESHOLD_DB,
          minSilenceSeconds: cfg.DSP_TRIM_MIN_SILENCE_SECONDS,
          maxTrimSeconds: cfg.DSP_TRIM_MAX_SECONDS,
          maxAllowedTrimSeconds: maxTargetHeadTrimByLength,
        }, state, cfg, deps),
      ]);

      sourceTailTrimSeconds = sourceTrimResult.trimSeconds;
      targetHeadTrimSeconds = targetTrimResult.trimSeconds;
      sourceTrimSource = sourceTrimResult.source;
      targetTrimSource = targetTrimResult.source;
      sourceRawTailSilenceSeconds = sourceTrimResult.rawSeconds;
      targetRawHeadSilenceSeconds = targetTrimResult.rawSeconds;

      if (cfg.DSP_NO_GAP_GUARD_ENABLED) {
        // Guard pass: lift silence threshold and remove trim cap to avoid dead-air between beat anchors.
        const boostedThresholdDb = Math.min(
          -8,
          cfg.DSP_TRIM_SILENCE_THRESHOLD_DB + cfg.DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
        );
        guardThresholdDb = Math.max(cfg.DSP_TRIM_SILENCE_THRESHOLD_DB, boostedThresholdDb);
        const guardMinSilenceSeconds = Math.max(
          0.03,
          Math.min(cfg.DSP_TRIM_MIN_SILENCE_SECONDS, cfg.DSP_TRIM_MIN_SILENCE_SECONDS * 0.7),
        );

        const [sourceGuardTrimResult, targetGuardTrimResult] = await Promise.all([
          computeDspTrimSeconds({
            trackFile: item.fromFile,
            absolutePath: item.fromAbsolutePath,
            trackStat: fromStat,
            mode: 'tail',
            sliceSeconds: item.sliceSeconds,
            silenceThresholdDb: guardThresholdDb,
            minSilenceSeconds: guardMinSilenceSeconds,
            maxTrimSeconds: maxSourceTailTrimByLength,
            maxAllowedTrimSeconds: maxSourceTailTrimByLength,
          }, state, cfg, deps),
          computeDspTrimSeconds({
            trackFile: item.toFile,
            absolutePath: item.toAbsolutePath,
            trackStat: toStat,
            mode: 'head',
            sliceSeconds: item.sliceSeconds,
            silenceThresholdDb: guardThresholdDb,
            minSilenceSeconds: guardMinSilenceSeconds,
            maxTrimSeconds: maxTargetHeadTrimByLength,
            maxAllowedTrimSeconds: maxTargetHeadTrimByLength,
          }, state, cfg, deps),
        ]);

        if (sourceGuardTrimResult.trimSeconds > sourceTailTrimSeconds + 0.02) {
          sourceTailTrimSeconds = sourceGuardTrimResult.trimSeconds;
          sourceTrimSource = sourceGuardTrimResult.source ? `${sourceGuardTrimResult.source}+guard` : 'guard';
          noGapGuardApplied = true;
        }
        if (targetGuardTrimResult.trimSeconds > targetHeadTrimSeconds + 0.02) {
          targetHeadTrimSeconds = targetGuardTrimResult.trimSeconds;
          targetTrimSource = targetGuardTrimResult.source ? `${targetGuardTrimResult.source}+guard` : 'guard';
          noGapGuardApplied = true;
        }

        sourceRawTailSilenceSeconds = Math.max(sourceRawTailSilenceSeconds, sourceGuardTrimResult.rawSeconds);
        targetRawHeadSilenceSeconds = Math.max(targetRawHeadSilenceSeconds, targetGuardTrimResult.rawSeconds);
      }

      if (cfg.DSP_NO_GAP_ENERGY_TRIM_ENABLED) {
        const [sourceEnergyTrimResult, targetEnergyTrimResult] = await Promise.all([
          computeDspEnergyTrimSeconds({
            trackFile: item.fromFile,
            absolutePath: item.fromAbsolutePath,
            trackStat: fromStat,
            mode: 'tail',
            sliceSeconds: item.sliceSeconds,
            sampleRate: cfg.DSP_NO_GAP_ENERGY_SAMPLE_RATE,
            frameMs: cfg.DSP_NO_GAP_ENERGY_FRAME_MS,
            floorRatio: cfg.DSP_NO_GAP_ENERGY_FLOOR_RATIO,
            meanMultiplier: cfg.DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
            maxTrimSeconds: maxSourceTailTrimByLength,
            maxAllowedTrimSeconds: maxSourceTailTrimByLength,
          }, state, cfg, deps),
          computeDspEnergyTrimSeconds({
            trackFile: item.toFile,
            absolutePath: item.toAbsolutePath,
            trackStat: toStat,
            mode: 'head',
            sliceSeconds: item.sliceSeconds,
            sampleRate: cfg.DSP_NO_GAP_ENERGY_SAMPLE_RATE,
            frameMs: cfg.DSP_NO_GAP_ENERGY_FRAME_MS,
            floorRatio: cfg.DSP_NO_GAP_ENERGY_FLOOR_RATIO,
            meanMultiplier: cfg.DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
            maxTrimSeconds: maxTargetHeadTrimByLength,
            maxAllowedTrimSeconds: maxTargetHeadTrimByLength,
          }, state, cfg, deps),
        ]);

        if (sourceEnergyTrimResult.trimSeconds > sourceTailTrimSeconds + 0.02) {
          sourceTailTrimSeconds = sourceEnergyTrimResult.trimSeconds;
          sourceTrimSource = sourceEnergyTrimResult.source
            ? `${sourceEnergyTrimResult.source}+energy`
            : 'energy';
          noGapEnergyTrimApplied = true;
        }
        if (targetEnergyTrimResult.trimSeconds > targetHeadTrimSeconds + 0.02) {
          targetHeadTrimSeconds = targetEnergyTrimResult.trimSeconds;
          targetTrimSource = targetEnergyTrimResult.source
            ? `${targetEnergyTrimResult.source}+energy`
            : 'energy';
          noGapEnergyTrimApplied = true;
        }

        sourceRawTailSilenceSeconds = Math.max(sourceRawTailSilenceSeconds, sourceEnergyTrimResult.rawSeconds);
        targetRawHeadSilenceSeconds = Math.max(targetRawHeadSilenceSeconds, targetEnergyTrimResult.rawSeconds);
      }

      aggressiveJoin.reason = noGapEnergyTrimApplied
        ? 'trim-energy-applied'
        : noGapGuardApplied
          ? 'trim-guard-applied'
          : sourceTailTrimSeconds > 0 || targetHeadTrimSeconds > 0
            ? 'trim-applied'
            : 'trim-not-needed';
    } else {
      sourceTrimSource = 'trim-disabled';
      targetTrimSource = 'trim-disabled';
      aggressiveJoin.reason = 'trim-disabled';
    }

    aggressiveJoin.applied =
      sourceTailTrimSeconds > 0 ||
      targetHeadTrimSeconds > 0 ||
      Math.abs(effectiveTransitionSeconds - item.transitionSeconds) >= 0.001 ||
      crossfadeCurveOut !== 'tri' ||
      crossfadeCurveIn !== 'tri';
  }

  aggressiveJoin.effectiveTransitionSeconds = effectiveTransitionSeconds;
  aggressiveJoin.sourceTailTrimSeconds = sourceTailTrimSeconds;
  aggressiveJoin.targetHeadTrimSeconds = targetHeadTrimSeconds;
  aggressiveJoin.sourceTrimSource = sourceTrimSource;
  aggressiveJoin.targetTrimSource = targetTrimSource;
  aggressiveJoin.sourceRawTailSilenceSeconds = sourceRawTailSilenceSeconds;
  aggressiveJoin.targetRawHeadSilenceSeconds = targetRawHeadSilenceSeconds;
  aggressiveJoin.curveOut = crossfadeCurveOut;
  aggressiveJoin.curveIn = crossfadeCurveIn;
  aggressiveJoin.noGapGuardApplied = noGapGuardApplied;
  aggressiveJoin.guardThresholdDb = guardThresholdDb;
  aggressiveJoin.noGapEnergyTrimApplied = noGapEnergyTrimApplied;
  item.aggressiveJoin = aggressiveJoin;

  const tempOutputPath = `${item.outputPath}.${Date.now()}.tmp.${cfg.DSP_TRANSITION_OUTPUT_FORMAT}`;
  const sourceTrimEndSeconds = Math.max(0.05, item.sliceSeconds - sourceTailTrimSeconds);
  const targetTrimStartSeconds = Math.max(0, targetHeadTrimSeconds);
  const sourceTrimEndText = formatFfmpegFilterNumber(sourceTrimEndSeconds);
  const effectiveTransitionText = formatFfmpegFilterNumber(effectiveTransitionSeconds);
  const targetTempoFilterDescriptor = buildTempoAlignedTargetFilter({
    inputLabel: '1:a',
    outputLabel: 'a1',
    trimStartSeconds: targetTrimStartSeconds,
    trimEndSeconds: item.sliceSeconds,
    tempoRatio: tempoAlignment.applied ? tempoRatio : 1,
  }, cfg);

  tempoAlignment.glideApplied = Boolean(tempoAlignment.applied && targetTempoFilterDescriptor.glideApplied);
  tempoAlignment.glideSegments = tempoAlignment.glideApplied
    ? targetTempoFilterDescriptor.glideSegments
    : null;
  tempoAlignment.glideStartRatio = tempoAlignment.applied
    ? targetTempoFilterDescriptor.glideStartRatio
    : null;
  tempoAlignment.glideEndRatio = tempoAlignment.applied
    ? targetTempoFilterDescriptor.glideEndRatio
    : 1;
  if (tempoAlignment.glideApplied) {
    tempoAlignment.reason = tempoAlignment.reason === 'applied-clamped' ? 'applied-glide-clamped' : 'applied-glide';
  }

  const filter = [
    `[0:a]atrim=start=0:end=${sourceTrimEndText},asetpts=PTS-STARTPTS[a0]`,
    targetTempoFilterDescriptor.filter,
    `[a0][a1]acrossfade=d=${effectiveTransitionText}:c1=${crossfadeCurveOut}:c2=${crossfadeCurveIn}`,
  ].join(';');
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-sseof',
    `-${item.sliceSeconds}`,
    '-i',
    item.fromAbsolutePath,
    '-t',
    `${item.sliceSeconds}`,
    '-i',
    item.toAbsolutePath,
    '-filter_complex',
    filter,
    ...buildDspOutputEncodingArgs(cfg),
    tempOutputPath,
  ];

  try {
    await deps.execFileAsync(cfg.DSP_FFMPEG_BINARY, args, {
      windowsHide: true,
      timeout: cfg.DSP_JOB_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    await deps.fs.promises.rename(tempOutputPath, item.outputPath);
    const outputStat = await deps.fs.promises.stat(item.outputPath);
    if (!outputStat.isFile() || outputStat.size < 1) {
      markDspTransitionFailed(item, 'DSP output file is empty.');
      appendDspLog('transition.failed', {
        id: item.id,
        from: item.fromFile,
        to: item.toFile,
        source: item.source || 'unknown',
        elapsedMs: Date.now() - startedAt,
        error: item.error,
      }, state, cfg, deps);
      return;
    }
    markDspTransitionReady(item, outputStat, sourceMtimeMs);
    appendDspLog('transition.ready', {
      id: item.id,
      from: item.fromFile,
      to: item.toFile,
      source: item.source || 'unknown',
      elapsedMs: Date.now() - startedAt,
      cacheHit: false,
      outputSizeBytes: outputStat.size,
      tempoAlignment: tempoAlignment,
      aggressiveJoin: aggressiveJoin,
    }, state, cfg, deps);
  } catch (err) {
    try {
      await deps.fs.promises.unlink(tempOutputPath);
    } catch (unlinkErr) {
      // ignore cleanup failures
    }
    markDspTransitionFailed(item, toDspErrorMessage(err, 'Не удалось собрать DSP transition.'));
    appendDspLog('transition.failed', {
      id: item.id,
      from: item.fromFile,
      to: item.toFile,
      source: item.source || 'unknown',
      elapsedMs: Date.now() - startedAt,
      error: item.error,
      tempoAlignment: tempoAlignment,
      aggressiveJoin: aggressiveJoin,
    }, state, cfg, deps);
  }
}

async function processDspQueue(state, cfg, deps) {
  if (state.dspWorkerRunning) return;
  state.dspWorkerRunning = true;

  try {
    while (state.dspQueue.length > 0) {
      const next = state.dspQueue.shift();
      if (!next || typeof next !== 'object') continue;
      await processDspTransition(next, state, cfg, deps);
    }
  } finally {
    state.dspWorkerRunning = false;
    state.dspWorkerScheduled = false;
    trimDspHistory(state, cfg);
    if (state.dspQueue.length > 0) {
      scheduleDspWorker(state, cfg, deps);
    }
  }
}

function scheduleDspWorker(state, cfg, deps) {
  if (!cfg.DSP_ENABLED) return;
  if (state.dspWorkerScheduled || state.dspWorkerRunning) return;
  state.dspWorkerScheduled = true;
  setImmediate(() => {
    processDspQueue(state, cfg, deps).catch((err) => {
      console.error('DSP queue worker failed', err);
      state.dspWorkerRunning = false;
      state.dspWorkerScheduled = false;
    });
  });
}

module.exports = {
  buildDspQueueSummary,
  serializeDspTransition,
  trimDspHistory,
  queueDspTransition,
  toDspErrorMessage,
  markDspTransitionReady,
  markDspTransitionFailed,
  processDspTransition,
  processDspQueue,
  scheduleDspWorker,
};
