'use strict';

const { formatFfmpegFilterNumber } = require('./tempo');

function parseSilencedetectIntervals(stderr) {
  if (typeof stderr !== 'string' || !stderr.trim()) return [];

  const lines = stderr.split(/\r?\n/);
  const intervals = [];
  let pendingStart = null;

  const startPattern = /silence_start:\s*([0-9.+-eE]+)/;
  const endPattern = /silence_end:\s*([0-9.+-eE]+)\s*\|\s*silence_duration:\s*([0-9.+-eE]+)/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const startMatch = line.match(startPattern);
    if (startMatch) {
      const startValue = Number(startMatch[1]);
      pendingStart = Number.isFinite(startValue) ? Math.max(0, startValue) : null;
      continue;
    }

    const endMatch = line.match(endPattern);
    if (!endMatch) continue;

    const endValue = Number(endMatch[1]);
    const durationValue = Number(endMatch[2]);
    if (!Number.isFinite(endValue) || endValue < 0) {
      pendingStart = null;
      continue;
    }

    let startValue = pendingStart;
    if (!Number.isFinite(startValue) || startValue < 0) {
      if (Number.isFinite(durationValue) && durationValue >= 0) {
        startValue = Math.max(0, endValue - durationValue);
      } else {
        startValue = 0;
      }
    }

    const safeEnd = Math.max(startValue, endValue);
    intervals.push({
      start: startValue,
      end: safeEnd,
      duration: safeEnd - startValue,
    });
    pendingStart = null;
  }

  if (Number.isFinite(pendingStart) && pendingStart >= 0) {
    intervals.push({
      start: pendingStart,
      end: null,
      duration: null,
    });
  }

  intervals.sort((left, right) => {
    const leftStart = Number.isFinite(left.start) ? left.start : Number.POSITIVE_INFINITY;
    const rightStart = Number.isFinite(right.start) ? right.start : Number.POSITIVE_INFINITY;
    return leftStart - rightStart;
  });
  return intervals;
}

function detectLeadingSilenceSecondsFromIntervals(intervals, sliceSeconds) {
  if (!Array.isArray(intervals) || !intervals.length) return 0;
  const safeSlice = Number.isFinite(sliceSeconds) && sliceSeconds > 0 ? sliceSeconds : 0;
  if (safeSlice <= 0) return 0;

  const epsilon = 0.05;
  for (const interval of intervals) {
    if (!interval || !Number.isFinite(interval.start)) continue;
    if (interval.start > epsilon) break;

    const intervalEnd =
      Number.isFinite(interval.end) && interval.end >= interval.start ? interval.end : safeSlice;
    return Math.max(0, Math.min(safeSlice, intervalEnd));
  }
  return 0;
}

function detectTrailingSilenceSecondsFromIntervals(intervals, sliceSeconds) {
  if (!Array.isArray(intervals) || !intervals.length) return 0;
  const safeSlice = Number.isFinite(sliceSeconds) && sliceSeconds > 0 ? sliceSeconds : 0;
  if (safeSlice <= 0) return 0;

  const epsilon = 0.05;
  for (let index = intervals.length - 1; index >= 0; index -= 1) {
    const interval = intervals[index];
    if (!interval || !Number.isFinite(interval.start)) continue;
    const intervalEnd =
      Number.isFinite(interval.end) && interval.end >= interval.start ? interval.end : safeSlice;
    if (intervalEnd + epsilon < safeSlice) continue;
    return Math.max(0, Math.min(safeSlice, safeSlice - interval.start));
  }
  return 0;
}

function buildDspTrimCacheKey({
  trackFile,
  trackStat,
  mode,
  sliceSeconds,
  silenceThresholdDb,
  minSilenceSeconds,
}, deps) {
  const normalizedTrackFile = deps.normalizeAudioRelativePath(trackFile || '');
  if (!normalizedTrackFile) return null;
  if (!trackStat || !Number.isFinite(trackStat.mtimeMs) || !Number.isFinite(trackStat.size)) return null;

  return [
    normalizedTrackFile,
    mode === 'tail' ? 'tail' : 'head',
    Number(trackStat.mtimeMs).toFixed(3),
    Number(trackStat.size).toFixed(0),
    formatFfmpegFilterNumber(sliceSeconds),
    formatFfmpegFilterNumber(silenceThresholdDb),
    formatFfmpegFilterNumber(minSilenceSeconds),
  ].join('|');
}

async function detectSegmentSilenceSeconds({
  absolutePath,
  mode,
  sliceSeconds,
  silenceThresholdDb,
  minSilenceSeconds,
}, cfg, deps) {
  const safeSliceSeconds = Number.isFinite(sliceSeconds) && sliceSeconds > 0 ? sliceSeconds : null;
  if (!safeSliceSeconds) return 0;
  const safeThresholdDb = Number.isFinite(silenceThresholdDb) ? silenceThresholdDb : cfg.DSP_TRIM_SILENCE_THRESHOLD_DB;
  const safeMinSilence = Number.isFinite(minSilenceSeconds) ? minSilenceSeconds : cfg.DSP_TRIM_MIN_SILENCE_SECONDS;
  const normalizedMode = mode === 'tail' ? 'tail' : 'head';

  const args = [
    '-hide_banner',
    '-loglevel',
    'info',
    '-nostats',
    '-y',
  ];

  if (normalizedMode === 'tail') {
    args.push('-sseof', `-${safeSliceSeconds}`);
  }

  args.push(
    '-i',
    absolutePath,
  );

  if (normalizedMode === 'head') {
    args.push('-t', String(safeSliceSeconds));
  }

  args.push(
    '-af',
    `silencedetect=n=${formatFfmpegFilterNumber(safeThresholdDb)}dB:d=${formatFfmpegFilterNumber(safeMinSilence)}`,
    '-f',
    'null',
    '-',
  );

  try {
    const { stderr } = await deps.execFileAsync(cfg.DSP_FFMPEG_BINARY, args, {
      windowsHide: true,
      timeout: Math.min(cfg.DSP_JOB_TIMEOUT_MS, 35 * 1000),
      maxBuffer: 8 * 1024 * 1024,
    });
    const intervals = parseSilencedetectIntervals(stderr || '');
    if (!intervals.length) return 0;

    return normalizedMode === 'tail'
      ? detectTrailingSilenceSecondsFromIntervals(intervals, safeSliceSeconds)
      : detectLeadingSilenceSecondsFromIntervals(intervals, safeSliceSeconds);
  } catch (err) {
    return 0;
  }
}

async function computeDspTrimSeconds({
  trackFile,
  absolutePath,
  trackStat,
  mode,
  sliceSeconds,
  silenceThresholdDb,
  minSilenceSeconds,
  maxTrimSeconds,
  maxAllowedTrimSeconds,
}, state, cfg, deps) {
  const safeMaxTrim = Number.isFinite(maxTrimSeconds) ? Math.max(0, maxTrimSeconds) : 0;
  const safeMaxAllowed = Number.isFinite(maxAllowedTrimSeconds) ? Math.max(0, maxAllowedTrimSeconds) : 0;
  if (safeMaxTrim <= 0 || safeMaxAllowed <= 0) {
    return { trimSeconds: 0, rawSeconds: 0, source: 'disabled' };
  }

  const cacheKey = buildDspTrimCacheKey({
    trackFile,
    trackStat,
    mode,
    sliceSeconds,
    silenceThresholdDb,
    minSilenceSeconds,
  }, deps);

  let rawSeconds = 0;
  let source = 'analysis';

  if (cacheKey && state.dspSilenceTrimCache.has(cacheKey)) {
    const cachedValue = Number(state.dspSilenceTrimCache.get(cacheKey));
    rawSeconds = Number.isFinite(cachedValue) ? Math.max(0, cachedValue) : 0;
    source = 'cache';
  } else {
    rawSeconds = await detectSegmentSilenceSeconds({
      absolutePath,
      mode,
      sliceSeconds,
      silenceThresholdDb,
      minSilenceSeconds,
    }, cfg, deps);
    if (cacheKey) {
      state.dspSilenceTrimCache.set(cacheKey, rawSeconds);
      if (state.dspSilenceTrimCache.size > 15_000) {
        const firstKey = state.dspSilenceTrimCache.keys().next().value;
        if (firstKey) state.dspSilenceTrimCache.delete(firstKey);
      }
    }
  }

  const trimmed = Math.min(rawSeconds, safeMaxTrim, safeMaxAllowed);
  const normalizedTrim = trimmed >= 0.03 ? Math.round(trimmed * 1000) / 1000 : 0;
  return {
    trimSeconds: normalizedTrim,
    rawSeconds: Math.round(rawSeconds * 1000) / 1000,
    source,
  };
}

async function decodeSegmentPcmForBoundaryAnalysis({
  absolutePath,
  mode,
  sliceSeconds,
  sampleRate,
}, cfg, deps) {
  const safeSliceSeconds = Number.isFinite(sliceSeconds) && sliceSeconds > 0 ? sliceSeconds : null;
  if (!safeSliceSeconds) return Buffer.alloc(0);
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate >= 4000 ? Math.trunc(sampleRate) : cfg.DSP_NO_GAP_ENERGY_SAMPLE_RATE;
  const normalizedMode = mode === 'tail' ? 'tail' : 'head';
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
  ];

  if (normalizedMode === 'tail') {
    args.push('-sseof', `-${safeSliceSeconds}`);
  }

  args.push('-i', absolutePath);
  if (normalizedMode === 'head') {
    args.push('-t', String(safeSliceSeconds));
  }

  args.push(
    '-ac',
    '1',
    '-ar',
    String(safeSampleRate),
    '-f',
    's16le',
    '-',
  );

  try {
    const { stdout } = await deps.execFileAsync(cfg.DSP_FFMPEG_BINARY, args, {
      windowsHide: true,
      timeout: Math.min(cfg.DSP_JOB_TIMEOUT_MS, 45 * 1000),
      maxBuffer: 96 * 1024 * 1024,
      encoding: 'buffer',
    });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
  } catch (err) {
    return Buffer.alloc(0);
  }
}

function percentileFromSortedArray(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || !sortedValues.length) return 0;
  const safePercentile = Number.isFinite(percentile) ? Math.max(0, Math.min(1, percentile)) : 0;
  const position = Math.round((sortedValues.length - 1) * safePercentile);
  return sortedValues[position] || 0;
}

function estimateEnergyBoundaryTrimFromPcm({
  rawPcm,
  sampleRate,
  mode,
  sliceSeconds,
  frameMs,
  floorRatio,
  meanMultiplier,
}, cfg) {
  if (!Buffer.isBuffer(rawPcm) || rawPcm.length < 2048) return 0;
  const safeSampleRate = Number.isFinite(sampleRate) ? sampleRate : cfg.DSP_NO_GAP_ENERGY_SAMPLE_RATE;
  const safeSliceSeconds = Number.isFinite(sliceSeconds) && sliceSeconds > 0 ? sliceSeconds : 0;
  if (safeSampleRate < 4000 || safeSliceSeconds <= 0) return 0;

  const sampleCount = Math.floor(rawPcm.length / 2);
  const samplesPerFrame = Math.max(64, Math.round(safeSampleRate * Math.max(0.005, frameMs / 1000)));
  const frameCount = Math.floor(sampleCount / samplesPerFrame);
  if (frameCount < 6) return 0;

  const energies = new Array(frameCount).fill(0);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStartSample = frameIndex * samplesPerFrame;
    let sumSquares = 0;
    for (let offset = 0; offset < samplesPerFrame; offset += 1) {
      const sampleIndex = (frameStartSample + offset) * 2;
      const sampleValue = rawPcm.readInt16LE(sampleIndex) / 32768;
      sumSquares += sampleValue * sampleValue;
    }
    energies[frameIndex] = Math.sqrt(sumSquares / samplesPerFrame);
  }

  const smoothed = new Array(frameCount).fill(0);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const left = frameIndex > 0 ? energies[frameIndex - 1] : energies[frameIndex];
    const center = energies[frameIndex];
    const right = frameIndex + 1 < frameCount ? energies[frameIndex + 1] : energies[frameIndex];
    smoothed[frameIndex] = (left + center + right) / 3;
  }

  const sorted = smoothed.slice().sort((left, right) => left - right);
  const maxEnergy = sorted[sorted.length - 1] || 0;
  if (!Number.isFinite(maxEnergy) || maxEnergy <= 0) return 0;

  const p90 = percentileFromSortedArray(sorted, 0.9);
  const p75 = percentileFromSortedArray(sorted, 0.75);
  let meanEnergy = 0;
  for (const value of smoothed) {
    meanEnergy += value;
  }
  meanEnergy /= smoothed.length;

  const signalReference = Math.max(maxEnergy * 0.65, p90, p75);
  const thresholdByPeak = signalReference * Math.max(0.03, Math.min(0.95, floorRatio));
  const thresholdByMean = meanEnergy * Math.max(1, meanMultiplier);
  let threshold = Math.max(thresholdByPeak, thresholdByMean);
  threshold = Math.min(threshold, maxEnergy * 0.92);
  threshold = Math.max(threshold, maxEnergy * 0.04);

  const normalizedMode = mode === 'tail' ? 'tail' : 'head';
  const frameDurationSeconds = samplesPerFrame / safeSampleRate;
  if (!Number.isFinite(frameDurationSeconds) || frameDurationSeconds <= 0) return 0;

  if (normalizedMode === 'head') {
    let firstActiveFrameIndex = -1;
    for (let frameIndex = 0; frameIndex < smoothed.length; frameIndex += 1) {
      if (smoothed[frameIndex] >= threshold) {
        firstActiveFrameIndex = frameIndex;
        break;
      }
    }
    if (firstActiveFrameIndex <= 0) return 0;
    return Math.max(0, Math.min(safeSliceSeconds, firstActiveFrameIndex * frameDurationSeconds));
  }

  let lastActiveFrameIndex = -1;
  for (let frameIndex = smoothed.length - 1; frameIndex >= 0; frameIndex -= 1) {
    if (smoothed[frameIndex] >= threshold) {
      lastActiveFrameIndex = frameIndex;
      break;
    }
  }
  if (lastActiveFrameIndex < 0 || lastActiveFrameIndex >= smoothed.length - 1) return 0;

  const lastActiveEndSeconds = (lastActiveFrameIndex + 1) * frameDurationSeconds;
  const trimSeconds = Math.max(0, safeSliceSeconds - lastActiveEndSeconds);
  return Math.max(0, Math.min(safeSliceSeconds, trimSeconds));
}

function buildDspEnergyTrimCacheKey({
  trackFile,
  trackStat,
  mode,
  sliceSeconds,
  sampleRate,
  frameMs,
  floorRatio,
  meanMultiplier,
}, deps) {
  const normalizedTrackFile = deps.normalizeAudioRelativePath(trackFile || '');
  if (!normalizedTrackFile) return null;
  if (!trackStat || !Number.isFinite(trackStat.mtimeMs) || !Number.isFinite(trackStat.size)) return null;

  return [
    normalizedTrackFile,
    mode === 'tail' ? 'tail' : 'head',
    Number(trackStat.mtimeMs).toFixed(3),
    Number(trackStat.size).toFixed(0),
    formatFfmpegFilterNumber(sliceSeconds),
    String(Math.trunc(sampleRate)),
    formatFfmpegFilterNumber(frameMs),
    formatFfmpegFilterNumber(floorRatio),
    formatFfmpegFilterNumber(meanMultiplier),
  ].join('|');
}

async function computeDspEnergyTrimSeconds({
  trackFile,
  absolutePath,
  trackStat,
  mode,
  sliceSeconds,
  sampleRate,
  frameMs,
  floorRatio,
  meanMultiplier,
  maxTrimSeconds,
  maxAllowedTrimSeconds,
}, state, cfg, deps) {
  const safeMaxTrim = Number.isFinite(maxTrimSeconds) ? Math.max(0, maxTrimSeconds) : 0;
  const safeMaxAllowed = Number.isFinite(maxAllowedTrimSeconds) ? Math.max(0, maxAllowedTrimSeconds) : 0;
  if (safeMaxTrim <= 0 || safeMaxAllowed <= 0) {
    return { trimSeconds: 0, rawSeconds: 0, source: 'disabled' };
  }

  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate >= 4000
    ? Math.trunc(sampleRate)
    : cfg.DSP_NO_GAP_ENERGY_SAMPLE_RATE;
  const safeFrameMs = Number.isFinite(frameMs) ? Math.max(5, Math.min(100, frameMs)) : cfg.DSP_NO_GAP_ENERGY_FRAME_MS;
  const safeFloorRatio = Number.isFinite(floorRatio) ? Math.max(0.03, Math.min(0.95, floorRatio)) : cfg.DSP_NO_GAP_ENERGY_FLOOR_RATIO;
  const safeMeanMultiplier = Number.isFinite(meanMultiplier)
    ? Math.max(1, Math.min(6, meanMultiplier))
    : cfg.DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER;

  const cacheKey = buildDspEnergyTrimCacheKey({
    trackFile,
    trackStat,
    mode,
    sliceSeconds,
    sampleRate: safeSampleRate,
    frameMs: safeFrameMs,
    floorRatio: safeFloorRatio,
    meanMultiplier: safeMeanMultiplier,
  }, deps);

  let rawSeconds = 0;
  let source = 'analysis';

  if (cacheKey && state.dspEnergyTrimCache.has(cacheKey)) {
    const cachedValue = Number(state.dspEnergyTrimCache.get(cacheKey));
    rawSeconds = Number.isFinite(cachedValue) ? Math.max(0, cachedValue) : 0;
    source = 'cache';
  } else {
    const rawPcm = await decodeSegmentPcmForBoundaryAnalysis({
      absolutePath,
      mode,
      sliceSeconds,
      sampleRate: safeSampleRate,
    }, cfg, deps);
    rawSeconds = estimateEnergyBoundaryTrimFromPcm({
      rawPcm,
      sampleRate: safeSampleRate,
      mode,
      sliceSeconds,
      frameMs: safeFrameMs,
      floorRatio: safeFloorRatio,
      meanMultiplier: safeMeanMultiplier,
    }, cfg);
    if (cacheKey) {
      state.dspEnergyTrimCache.set(cacheKey, rawSeconds);
      if (state.dspEnergyTrimCache.size > 15_000) {
        const firstKey = state.dspEnergyTrimCache.keys().next().value;
        if (firstKey) state.dspEnergyTrimCache.delete(firstKey);
      }
    }
  }

  const trimmed = Math.min(rawSeconds, safeMaxTrim, safeMaxAllowed);
  const normalizedTrim = trimmed >= 0.03 ? Math.round(trimmed * 1000) / 1000 : 0;
  return {
    trimSeconds: normalizedTrim,
    rawSeconds: Math.round(rawSeconds * 1000) / 1000,
    source,
  };
}

module.exports = {
  parseSilencedetectIntervals,
  detectLeadingSilenceSecondsFromIntervals,
  detectTrailingSilenceSecondsFromIntervals,
  buildDspTrimCacheKey,
  detectSegmentSilenceSeconds,
  computeDspTrimSeconds,
  decodeSegmentPcmForBoundaryAnalysis,
  percentileFromSortedArray,
  estimateEnergyBoundaryTrimFromPcm,
  buildDspEnergyTrimCacheKey,
  computeDspEnergyTrimSeconds,
};
