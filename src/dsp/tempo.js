'use strict';

const path = require('path');
const { DSP_TEMPO_FRAME_SAMPLES, DSP_TEMPO_HOP_SAMPLES } = require('./constants');

function normalizeTempoBpmValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 40 || numeric > 260) return null;
  return Math.round(numeric * 1000) / 1000;
}

function normalizeTempoCacheTrackKey(trackFile, deps) {
  const normalized = deps.normalizeAudioRelativePath(trackFile || '');
  return normalized || null;
}

function loadDspTempoCache(state, cfg, deps) {
  try {
    if (!deps.fs.existsSync(cfg.DSP_TEMPO_CACHE_PATH)) return;
    const raw = deps.fs.readFileSync(cfg.DSP_TEMPO_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    for (const [rawTrackFile, rawEntry] of Object.entries(parsed)) {
      const trackFile = normalizeTempoCacheTrackKey(rawTrackFile, deps);
      if (!trackFile) continue;
      if (!rawEntry || typeof rawEntry !== 'object') continue;

      const bpm = normalizeTempoBpmValue(rawEntry.bpm);
      const mtimeMs = Number(rawEntry.mtimeMs);
      const size = Number(rawEntry.size);
      if (!bpm || !Number.isFinite(mtimeMs) || !Number.isFinite(size)) continue;

      const source = typeof rawEntry.source === 'string' && rawEntry.source ? rawEntry.source : 'analysis';
      state.dspTempoCache.set(trackFile, {
        bpm,
        mtimeMs,
        size,
        source,
        updatedAt: Number.isFinite(Number(rawEntry.updatedAt)) ? Number(rawEntry.updatedAt) : Date.now(),
      });
    }
  } catch (err) {
    console.error('Failed to load DSP tempo cache', err);
  }
}

function persistDspTempoCache(state, cfg, deps) {
  try {
    if (!state.dspTempoCache.size) return;
    const payload = {};
    for (const [trackFile, entry] of state.dspTempoCache.entries()) {
      if (!trackFile || !entry || typeof entry !== 'object') continue;
      const bpm = normalizeTempoBpmValue(entry.bpm);
      if (!bpm) continue;
      payload[trackFile] = {
        bpm,
        mtimeMs: Number(entry.mtimeMs) || 0,
        size: Number(entry.size) || 0,
        source: typeof entry.source === 'string' && entry.source ? entry.source : 'analysis',
        updatedAt: Number(entry.updatedAt) || Date.now(),
      };
    }
    deps.fs.mkdirSync(cfg.DSP_CACHE_DIR, { recursive: true });
    deps.fs.writeFileSync(cfg.DSP_TEMPO_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist DSP tempo cache', err);
  }
}

function parseBpmCandidate(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;
  const value = String(rawValue).trim();
  if (!value) return null;
  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const numeric = Number(match[1].replace(',', '.'));
  return normalizeTempoBpmValue(numeric);
}

function parseBpmFromTrackFileName(trackFile) {
  if (typeof trackFile !== 'string' || !trackFile.trim()) return null;
  const fileName = path.basename(trackFile);
  const match = fileName.match(/(?:^|[^0-9])(\d{2,3}(?:[.,]\d+)?)\s*bpm\b/i);
  if (!match) return null;
  return parseBpmCandidate(match[1]);
}

function collectTagBpmCandidates(tags, target) {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return;
  for (const [rawKey, rawValue] of Object.entries(tags)) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key) continue;
    if (key !== 'bpm' && key !== 'tbpm' && key !== 'tempo') continue;
    const bpm = parseBpmCandidate(rawValue);
    if (bpm) {
      target.push(bpm);
    }
  }
}

function parseBpmFromFfprobePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [];
  if (payload.format && payload.format.tags) {
    collectTagBpmCandidates(payload.format.tags, candidates);
  }

  if (Array.isArray(payload.streams)) {
    for (const stream of payload.streams) {
      if (!stream || typeof stream !== 'object' || !stream.tags) continue;
      collectTagBpmCandidates(stream.tags, candidates);
    }
  }

  if (!candidates.length) return null;
  candidates.sort((left, right) => left - right);
  return candidates[Math.floor(candidates.length / 2)] || null;
}

async function probeTrackTempoBpmFromMetadata(absolutePath, cfg, deps) {
  try {
    const { stdout } = await deps.execFileAsync(
      cfg.DSP_FFPROBE_BINARY,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_entries',
        'format_tags=BPM:format_tags=TBPM:format_tags=TEMPO:stream_tags=BPM:stream_tags=TBPM:stream_tags=TEMPO',
        absolutePath,
      ],
      {
        windowsHide: true,
        timeout: 10 * 1000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const parsed = JSON.parse(stdout);
    return parseBpmFromFfprobePayload(parsed);
  } catch (err) {
    return null;
  }
}

async function decodeTrackPcmForTempoAnalysis(absolutePath, cfg, deps) {
  const analysisDuration = Math.max(15, Math.round(cfg.DSP_TEMPO_ANALYSIS_SECONDS));
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-t',
    String(analysisDuration),
    '-i',
    absolutePath,
    '-ac',
    '1',
    '-ar',
    String(cfg.DSP_TEMPO_SAMPLE_RATE),
    '-f',
    's16le',
    '-',
  ];
  const { stdout } = await deps.execFileAsync(cfg.DSP_FFMPEG_BINARY, args, {
    windowsHide: true,
    timeout: Math.max(45 * 1000, cfg.DSP_JOB_TIMEOUT_MS),
    maxBuffer: 96 * 1024 * 1024,
    encoding: 'buffer',
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
}

function estimateTempoBpmFromPcmBuffer(rawPcm, sampleRate, minBpm, maxBpm) {
  if (!Buffer.isBuffer(rawPcm) || rawPcm.length < 4096) return null;
  if (!Number.isFinite(sampleRate) || sampleRate < 2000) return null;

  const sampleCount = Math.floor(rawPcm.length / 2);
  if (sampleCount < DSP_TEMPO_FRAME_SAMPLES * 4) return null;

  const envelope = [];
  for (let start = 0; start + DSP_TEMPO_FRAME_SAMPLES <= sampleCount; start += DSP_TEMPO_HOP_SAMPLES) {
    let sum = 0;
    for (let offset = 0; offset < DSP_TEMPO_FRAME_SAMPLES; offset += 1) {
      const index = (start + offset) * 2;
      sum += Math.abs(rawPcm.readInt16LE(index));
    }
    envelope.push(sum / DSP_TEMPO_FRAME_SAMPLES);
  }

  if (envelope.length < 32) return null;

  let mean = 0;
  for (const value of envelope) {
    mean += value;
  }
  mean /= envelope.length;

  const onset = new Float64Array(envelope.length);
  for (let index = 0; index < envelope.length; index += 1) {
    const centered = Math.max(0, envelope[index] - mean);
    onset[index] = centered;
  }

  for (let index = onset.length - 1; index >= 1; index -= 1) {
    onset[index] = Math.max(0, onset[index] - onset[index - 1]);
  }
  onset[0] = 0;

  const frameRate = sampleRate / DSP_TEMPO_HOP_SAMPLES;
  const resolvedMinBpm = Number.isFinite(minBpm) ? minBpm : 70;
  const resolvedMaxBpm = Number.isFinite(maxBpm) ? maxBpm : 170;
  const minLag = Math.max(1, Math.round((60 / resolvedMaxBpm) * frameRate));
  const maxLag = Math.min(onset.length - 2, Math.round((60 / resolvedMinBpm) * frameRate));
  if (maxLag <= minLag) return null;

  let bestLag = 0;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let index = lag; index < onset.length; index += 1) {
      score += onset[index] * onset[index - lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestScore <= 0) return null;
  let bpm = (60 * frameRate) / bestLag;

  while (bpm < resolvedMinBpm && bpm * 2 <= resolvedMaxBpm) bpm *= 2;
  while (bpm > resolvedMaxBpm && bpm / 2 >= resolvedMinBpm) bpm /= 2;

  return normalizeTempoBpmValue(bpm);
}

async function detectTrackTempoBpm(trackFile, absolutePath, trackStat, state, cfg, deps) {
  const normalizedTrackFile = normalizeTempoCacheTrackKey(trackFile, deps);
  if (!normalizedTrackFile) return null;
  if (!trackStat || !Number.isFinite(trackStat.mtimeMs) || !Number.isFinite(trackStat.size)) return null;

  const cached = state.dspTempoCache.get(normalizedTrackFile);
  if (
    cached &&
    Number.isFinite(cached.mtimeMs) &&
    Number.isFinite(cached.size) &&
    cached.mtimeMs === trackStat.mtimeMs &&
    cached.size === trackStat.size &&
    normalizeTempoBpmValue(cached.bpm)
  ) {
    return { bpm: normalizeTempoBpmValue(cached.bpm), source: 'cache' };
  }

  let bpm = await probeTrackTempoBpmFromMetadata(absolutePath, cfg, deps);
  let source = 'metadata';

  if (!bpm) {
    try {
      const rawPcm = await decodeTrackPcmForTempoAnalysis(absolutePath, cfg, deps);
      bpm = estimateTempoBpmFromPcmBuffer(rawPcm, cfg.DSP_TEMPO_SAMPLE_RATE, cfg.DSP_TEMPO_MIN_BPM, cfg.DSP_TEMPO_MAX_BPM);
      source = 'analysis';
    } catch (err) {
      bpm = null;
    }
  }

  if (!bpm) {
    bpm = parseBpmFromTrackFileName(trackFile);
    source = bpm ? 'filename' : source;
  }

  if (!bpm) return null;

  const normalizedBpm = normalizeTempoBpmValue(bpm);
  if (!normalizedBpm) return null;

  state.dspTempoCache.set(normalizedTrackFile, {
    bpm: normalizedBpm,
    mtimeMs: trackStat.mtimeMs,
    size: trackStat.size,
    source,
    updatedAt: Date.now(),
  });
  persistDspTempoCache(state, cfg, deps);

  return { bpm: normalizedBpm, source };
}

function formatFfmpegFilterNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '1';
  return numeric.toFixed(6).replace(/\.?0+$/, '');
}

function interpolateNumber(startValue, endValue, progress) {
  const safeStart = Number.isFinite(startValue) ? startValue : 0;
  const safeEnd = Number.isFinite(endValue) ? endValue : safeStart;
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return safeStart + (safeEnd - safeStart) * safeProgress;
}

function buildTempoAlignedTargetFilter({
  inputLabel,
  outputLabel,
  trimStartSeconds,
  trimEndSeconds,
  tempoRatio,
}, cfg) {
  const safeInputLabel = typeof inputLabel === 'string' && inputLabel ? inputLabel : '1:a';
  const safeOutputLabel = typeof outputLabel === 'string' && outputLabel ? outputLabel : 'a1';
  const safeTrimStart = Number.isFinite(trimStartSeconds) ? Math.max(0, trimStartSeconds) : 0;
  const safeTrimEnd = Number.isFinite(trimEndSeconds) ? Math.max(safeTrimStart + 0.05, trimEndSeconds) : safeTrimStart + 0.05;
  const tempoValue = Number.isFinite(tempoRatio) && tempoRatio > 0 ? tempoRatio : 1;
  const baseChain =
    `[${safeInputLabel}]atrim=start=${formatFfmpegFilterNumber(safeTrimStart)}:end=${formatFfmpegFilterNumber(safeTrimEnd)},` +
    `asetpts=PTS-STARTPTS`;

  if (Math.abs(tempoValue - 1) < cfg.DSP_TEMPO_MIN_DELTA_RATIO) {
    return {
      filter: `${baseChain}[${safeOutputLabel}]`,
      glideApplied: false,
      glideSegments: null,
      glideStartRatio: 1,
      glideEndRatio: 1,
    };
  }

  const safeGlideSegments = Math.max(2, Math.min(12, cfg.DSP_TEMPO_GLIDE_SEGMENTS));
  const sourceDurationSeconds = Math.max(0, safeTrimEnd - safeTrimStart);
  const ratioStart = tempoValue;
  const ratioEnd = 1;

  // Keep an untouched anchor tail so transition end matches the original track timing.
  const maxAnchorByDuration = Math.max(0, sourceDurationSeconds - 0.08);
  const anchorSeconds = Math.max(0, Math.min(cfg.DSP_TEMPO_GLIDE_ANCHOR_SECONDS, maxAnchorByDuration));
  const hasAnchorTail = anchorSeconds >= 0.06;
  const glideSourceStart = safeTrimStart;
  const glideSourceEnd = hasAnchorTail ? safeTrimEnd - anchorSeconds : safeTrimEnd;
  const glideDurationSeconds = Math.max(0, glideSourceEnd - glideSourceStart);
  const minSegmentSeconds = 0.35;
  const maxSegmentsByDuration = Math.max(1, Math.floor(glideDurationSeconds / minSegmentSeconds));
  const glideSegments = Math.max(2, Math.min(safeGlideSegments, maxSegmentsByDuration));
  const canApplyGlide =
    cfg.DSP_TEMPO_GLIDE_ENABLED &&
    glideSegments >= 2 &&
    glideDurationSeconds >= minSegmentSeconds * 1.1;

  if (!canApplyGlide) {
    return {
      filter: `${baseChain},rubberband=tempo=${formatFfmpegFilterNumber(tempoValue)}[${safeOutputLabel}]`,
      glideApplied: false,
      glideSegments: null,
      glideStartRatio: tempoValue,
      glideEndRatio: 1,
    };
  }

  const segmentFilters = [];
  const segmentInputs = [];
  let writtenSegments = 0;
  let rubberbandSegments = 0;

  for (let segmentIndex = 0; segmentIndex < glideSegments; segmentIndex += 1) {
    const segmentStart = glideSourceStart + (glideDurationSeconds * segmentIndex) / glideSegments;
    const rawSegmentEnd = glideSourceStart + (glideDurationSeconds * (segmentIndex + 1)) / glideSegments;
    const segmentEnd = segmentIndex === glideSegments - 1 ? glideSourceEnd : Math.min(glideSourceEnd, rawSegmentEnd);
    if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) continue;
    if (segmentEnd - segmentStart < 0.03) continue;

    const progress = glideSegments > 1 ? segmentIndex / (glideSegments - 1) : 1;
    const segmentRatio = interpolateNumber(ratioStart, ratioEnd, progress);
    const needsRubberband = Math.abs(segmentRatio - 1) >= cfg.DSP_TEMPO_MIN_DELTA_RATIO;
    if (needsRubberband) rubberbandSegments += 1;
    const segmentLabel = `a1g${writtenSegments}`;
    const rubberbandChain = needsRubberband
      ? `,rubberband=tempo=${formatFfmpegFilterNumber(segmentRatio)}`
      : '';
    segmentFilters.push(
      `[${safeInputLabel}]atrim=start=${formatFfmpegFilterNumber(segmentStart)}:end=${formatFfmpegFilterNumber(segmentEnd)},` +
        `asetpts=PTS-STARTPTS${rubberbandChain}[${segmentLabel}]`,
    );
    segmentInputs.push(`[${segmentLabel}]`);
    writtenSegments += 1;
  }

  if (hasAnchorTail) {
    const anchorStart = glideSourceEnd;
    const anchorEnd = safeTrimEnd;
    if (anchorEnd - anchorStart >= 0.03) {
      const anchorLabel = `a1g${writtenSegments}`;
      segmentFilters.push(
        `[${safeInputLabel}]atrim=start=${formatFfmpegFilterNumber(anchorStart)}:end=${formatFfmpegFilterNumber(anchorEnd)},` +
          `asetpts=PTS-STARTPTS[${anchorLabel}]`,
      );
      segmentInputs.push(`[${anchorLabel}]`);
      writtenSegments += 1;
    }
  }

  if (writtenSegments < 2 || rubberbandSegments < 1) {
    return {
      filter: `${baseChain},rubberband=tempo=${formatFfmpegFilterNumber(tempoValue)}[${safeOutputLabel}]`,
      glideApplied: false,
      glideSegments: null,
      glideStartRatio: tempoValue,
      glideEndRatio: 1,
    };
  }

  segmentFilters.push(`${segmentInputs.join('')}concat=n=${writtenSegments}:v=0:a=1[${safeOutputLabel}]`);
  return {
    filter: segmentFilters.join(';'),
    glideApplied: rubberbandSegments > 0,
    glideSegments: writtenSegments,
    glideStartRatio: ratioStart,
    glideEndRatio: ratioEnd,
  };
}

module.exports = {
  normalizeTempoBpmValue,
  normalizeTempoCacheTrackKey,
  loadDspTempoCache,
  persistDspTempoCache,
  parseBpmCandidate,
  parseBpmFromTrackFileName,
  collectTagBpmCandidates,
  parseBpmFromFfprobePayload,
  probeTrackTempoBpmFromMetadata,
  decodeTrackPcmForTempoAnalysis,
  estimateTempoBpmFromPcmBuffer,
  detectTrackTempoBpm,
  formatFfmpegFilterNumber,
  interpolateNumber,
  buildTempoAlignedTargetFilter,
};
