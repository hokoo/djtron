const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { version: appVersion } = require('./package.json');
const { PlaybackCommandBus } = require('./lib/playback/commandBus');
const { canDispatchLivePlaybackCommand } = require('./lib/playback/rolePolicy');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || line.startsWith('#')) return;

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) return;

      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();

      if (key && process.env[key] === undefined) {
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    });
}

const DEFAULT_PORT = 3000;
const DEFAULT_LIVE_VOLUME_PRESET_VALUES = Object.freeze([0.1, 0.3, 0.5]);
const ROOT_CONF_CANDIDATES = ['extra.conf'];

function stripWrappingQuotes(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function loadRootConfig() {
  let confPath = null;
  for (const candidate of ROOT_CONF_CANDIDATES) {
    const absolutePath = path.join(__dirname, candidate);
    if (fs.existsSync(absolutePath)) {
      confPath = absolutePath;
      break;
    }
  }

  if (!confPath) return {};

  try {
    const content = fs.readFileSync(confPath, 'utf8');
    const result = {};

    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const eqIndex = trimmed.indexOf('=');
      const colonIndex = trimmed.indexOf(':');
      const delimiterIndex =
        eqIndex > 0 && colonIndex > 0 ? Math.min(eqIndex, colonIndex) : Math.max(eqIndex, colonIndex);

      if (delimiterIndex <= 0) return;

      const rawKey = trimmed.slice(0, delimiterIndex).trim().toLowerCase();
      if (!rawKey) return;

      const rawValue = trimmed.slice(delimiterIndex + 1).trim();
      result[rawKey] = stripWrappingQuotes(rawValue);
    });

    return result;
  } catch (err) {
    console.error('Failed to read extra.conf file', err);
    return {};
  }
}

function pickConfigValue(config, keys) {
  if (!config || typeof config !== 'object' || !Array.isArray(keys)) return undefined;
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      return config[key];
    }
  }
  return undefined;
}

function parseBooleanConfigValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function normalizeVolumePresetValues(values, fallback = DEFAULT_LIVE_VOLUME_PRESET_VALUES) {
  const source = Array.isArray(values) ? values : [];
  const normalized = [];
  const seen = new Set();

  for (const rawValue of source) {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) continue;

    let ratioValue = null;
    if (numericValue > 0 && numericValue < 1) {
      ratioValue = numericValue;
    } else if (numericValue >= 1 && numericValue < 100) {
      ratioValue = numericValue / 100;
    }
    if (!Number.isFinite(ratioValue)) continue;

    const rounded = Math.round(ratioValue * 1000) / 1000;
    if (rounded <= 0 || rounded >= 1) continue;
    const dedupeKey = rounded.toFixed(3);
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    normalized.push(rounded);
    if (normalized.length >= 8) break;
  }

  if (normalized.length) return normalized;
  return Array.isArray(fallback) && fallback.length ? fallback.slice() : DEFAULT_LIVE_VOLUME_PRESET_VALUES.slice();
}

function parseVolumePresetsConfigValue(value, fallback = DEFAULT_LIVE_VOLUME_PRESET_VALUES) {
  if (Array.isArray(value)) {
    return normalizeVolumePresetValues(value, fallback);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeVolumePresetValues([value], fallback);
  }

  if (typeof value !== 'string') {
    return normalizeVolumePresetValues([], fallback);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return normalizeVolumePresetValues([], fallback);
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeVolumePresetValues(parsed, fallback);
      }
    } catch (err) {
      // fallback to token parsing
    }
  }

  const tokens = trimmed.split(/[,\s;|]+/).filter(Boolean);
  return normalizeVolumePresetValues(tokens, fallback);
}

function serializeVolumePresetPercentValues(values) {
  const source = Array.isArray(values) && values.length ? values : DEFAULT_LIVE_VOLUME_PRESET_VALUES;
  return source
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 1)
    .map((value) => Math.round(value * 1000) / 10);
}

function parsePortCandidate(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return null;
  return numeric;
}

function resolvePortValue(envValue, configValue, fallback = DEFAULT_PORT) {
  const fromEnv = parsePortCandidate(envValue);
  if (fromEnv !== null) return fromEnv;
  const fromConfig = parsePortCandidate(configValue);
  if (fromConfig !== null) return fromConfig;
  return fallback;
}

function parseBoundedNumberConfigValue(value, fallback, { min = null, max = null } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (Number.isFinite(min) && numeric < min) return fallback;
  if (Number.isFinite(max) && numeric > max) return fallback;
  return numeric;
}

function parseDspTransitionOutputFormat(value, fallback = 'wav') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'mp3') return 'mp3';
  if (normalized === 'wav') return 'wav';
  return fallback;
}

loadEnvFile();
const ROOT_CONFIG = loadRootConfig();

const PORT = resolvePortValue(
  process.env.PORT,
  pickConfigValue(ROOT_CONFIG, ['port']),
  DEFAULT_PORT,
);
const AUDIO_DIR = path.join(__dirname, 'audio');
const PUBLIC_DIR = path.join(__dirname, 'public');
const USERS_DIR = path.join(__dirname, 'users');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
const REPO_OWNER = 'hokoo';
const REPO_NAME = 'djtron';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const ONE_HOUR_MS = 60 * 60 * 1000;
const githubToken = process.env.GITHUB_TOKEN || null;
const UPDATE_CACHE_WINDOW_MS = githubToken ? 0 : ONE_HOUR_MS;
const UPDATE_STATE_PATH = path.join(__dirname, 'update-state.json');
const LAYOUT_STATE_PATH = path.join(__dirname, 'layout-state.json');
const SESSIONS_STATE_PATH = path.join(__dirname, 'sessions-state.json');
const DSP_CACHE_DIR = path.join(__dirname, '.cache', 'dsp');
const DSP_TRANSITIONS_DIR = path.join(DSP_CACHE_DIR, 'transitions');
const DSP_LOG_PATH = path.join(__dirname, 'dsp.log');
const DSP_TEMPO_CACHE_PATH = path.join(DSP_CACHE_DIR, 'tempo-cache.json');
const DSP_STATUS_QUEUED = 'queued';
const DSP_STATUS_PROCESSING = 'processing';
const DSP_STATUS_READY = 'ready';
const DSP_STATUS_FAILED = 'failed';

const execFileAsync = promisify(execFile);
const pipelineAsync = promisify(pipeline);

const AUDIO_DIR_RESOLVED = path.resolve(AUDIO_DIR);
const PUBLIC_DIR_RESOLVED = path.resolve(PUBLIC_DIR);
const USERS_DIR_RESOLVED = path.resolve(USERS_DIR);
const SESSION_COOKIE_NAME = 'chkg_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const AUTH_BODY_LIMIT_BYTES = 8 * 1024;
const LAYOUT_BODY_LIMIT_BYTES = 512 * 1024;
const PLAYBACK_BODY_LIMIT_BYTES = 32 * 1024;
const PLAYBACK_COMMAND_BODY_LIMIT_BYTES = 16 * 1024;
const DSP_BODY_LIMIT_BYTES = 128 * 1024;
const AUDIO_TAG_SCAN_BYTES = 256 * 1024;
const PLAYLIST_NAME_MAX_LENGTH = 80;
const TRACK_TITLE_MODE_ATTRIBUTES = 'attributes';
const TRACK_TITLE_KEY_MAX_LENGTH = 1024;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const ROLE_HOST = 'host';
const ROLE_SLAVE = 'slave';
const ROLE_COHOST = 'co-host';
const DAP_DEFAULT_VOLUME_PERCENT = 5;
const DAP_MIN_VOLUME_PERCENT = 0;
const DAP_MAX_VOLUME_PERCENT = 100;
const DEFAULT_DAP_CONFIG = Object.freeze({
  enabled: false,
  playlistIndex: null,
  volumePercent: DAP_DEFAULT_VOLUME_PERCENT,
});
const RUNTIME_OVERRIDE_SCOPE_NONE = 'none';
const RUNTIME_OVERRIDE_SCOPE_CLIENT = 'client';
const RUNTIME_OVERRIDE_SCOPE_HOST = 'host';
const LIVE_VOLUME_PRESET_VALUES = parseVolumePresetsConfigValue(
  pickConfigValue(ROOT_CONFIG, ['volume_presets', 'live_volume_presets', 'presets']),
  DEFAULT_LIVE_VOLUME_PRESET_VALUES,
);
const ALLOW_CONTEXT_MENU = parseBooleanConfigValue(
  pickConfigValue(ROOT_CONFIG, ['allow_context_menu', 'context_menu']),
  false,
);
const RUNTIME_CONFIG_SCHEMA = Object.freeze({
  port: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
  allowContextMenu: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_CLIENT }),
  volumePresets: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_HOST }),
  dspEntryCompensationMs: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
  dspExitCompensationMs: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
});
const DEFAULT_LIVE_VOLUME = 1;
const DSP_ENABLED = parseBooleanConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_enabled', 'dsp']),
  true,
);
const DSP_FFMPEG_BINARY = stripWrappingQuotes(
  String(pickConfigValue(ROOT_CONFIG, ['dsp_ffmpeg_path', 'ffmpeg_path']) || ''),
) || 'ffmpeg';
const DSP_FFPROBE_BINARY = stripWrappingQuotes(
  String(pickConfigValue(ROOT_CONFIG, ['dsp_ffprobe_path', 'ffprobe_path']) || ''),
) || 'ffprobe';
const DSP_TRANSITION_OUTPUT_FORMAT = parseDspTransitionOutputFormat(
  pickConfigValue(ROOT_CONFIG, ['dsp_transition_output_format', 'dsp_output_format', 'dsp_transition_format', 'dsp_format']),
  'wav',
);
const DSP_TRANSITION_OUTPUT_CODEC = DSP_TRANSITION_OUTPUT_FORMAT === 'wav' ? 'pcm_s16le' : 'libmp3lame';
const DSP_DEFAULT_TRANSITION_SECONDS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_transition_seconds', 'transition_seconds']),
  5,
  { min: 0.2, max: 30 },
);
const DSP_DEFAULT_SLICE_SECONDS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_slice_seconds', 'slice_seconds']),
  15,
  { min: 1, max: 120 },
);
const DSP_JOB_TIMEOUT_MS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_job_timeout_ms', 'job_timeout_ms']),
  90 * 1000,
  { min: 5 * 1000, max: 15 * 60 * 1000 },
);
const DSP_MAX_QUEUE_LENGTH = Math.trunc(
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, ['dsp_max_queue', 'max_queue']),
    500,
    { min: 10, max: 10_000 },
  ),
);
const DSP_HISTORY_LIMIT = Math.trunc(
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, ['dsp_history_limit', 'history_limit']),
    2000,
    { min: 100, max: 50_000 },
  ),
);
const DSP_PROBE_CACHE_MS = 60 * 1000;
const DSP_LOG_MAX_BYTES = Math.trunc(
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, ['dsp_log_max_bytes', 'log_max_bytes']),
    4 * 1024 * 1024,
    { min: 256 * 1024, max: 64 * 1024 * 1024 },
  ),
);
const DSP_TEMPO_ALIGN_ENABLED = parseBooleanConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_tempo_align_enabled', 'dsp_tempo_align', 'tempo_align']),
  true,
);
const DSP_TEMPO_ANALYSIS_SECONDS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_tempo_analysis_seconds', 'tempo_analysis_seconds']),
  90,
  { min: 15, max: 240 },
);
const DSP_TEMPO_SAMPLE_RATE = Math.trunc(
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, ['dsp_tempo_sample_rate', 'tempo_sample_rate']),
    11025,
    { min: 4000, max: 48000 },
  ),
);
const DSP_TEMPO_MIN_BPM = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_tempo_min_bpm', 'tempo_min_bpm']),
  70,
  { min: 40, max: 220 },
);
const DSP_TEMPO_MAX_BPM = Math.max(
  DSP_TEMPO_MIN_BPM + 1,
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, ['dsp_tempo_max_bpm', 'tempo_max_bpm']),
    170,
    { min: 60, max: 260 },
  ),
);
const DSP_TEMPO_MAX_ADJUST_PERCENT = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_tempo_max_adjust_percent', 'tempo_max_adjust_percent']),
  12,
  { min: 0, max: 40 },
);
const DSP_TEMPO_MIN_RATIO = Math.max(0.6, 1 - DSP_TEMPO_MAX_ADJUST_PERCENT / 100);
const DSP_TEMPO_MAX_RATIO = Math.min(1.8, 1 + DSP_TEMPO_MAX_ADJUST_PERCENT / 100);
const DSP_TEMPO_MIN_DELTA_RATIO = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_tempo_min_delta_ratio', 'tempo_min_delta_ratio']),
  0.012,
  { min: 0.001, max: 0.2 },
);
const DSP_TEMPO_GLIDE_ENABLED = parseBooleanConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_tempo_glide_enabled', 'dsp_tempo_glide', 'tempo_glide']),
  true,
);
const DSP_TEMPO_GLIDE_SEGMENTS = Math.trunc(
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, ['dsp_tempo_glide_segments', 'tempo_glide_segments']),
    4,
    { min: 2, max: 12 },
  ),
);
const DSP_TEMPO_GLIDE_ANCHOR_SECONDS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_tempo_glide_anchor_seconds', 'tempo_glide_anchor_seconds']),
  0.22,
  { min: 0, max: 2 },
);
const DSP_AGGRESSIVE_JOIN_ENABLED = parseBooleanConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_aggressive_join', 'dsp_aggressive_join_enabled', 'aggressive_join']),
  true,
);
const DSP_JOIN_INTENSITY = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_join_intensity', 'join_intensity']),
  0.78,
  { min: 0, max: 1 },
);
const DSP_JOIN_MIN_TRANSITION_SECONDS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_join_min_transition_seconds', 'join_min_transition_seconds']),
  0.3,
  { min: 0.05, max: 10 },
);
const DSP_TRIM_SILENCE_ENABLED = parseBooleanConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_trim_silence_enabled', 'trim_silence_enabled']),
  true,
);
const DSP_TRIM_SILENCE_THRESHOLD_DB = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_trim_silence_db', 'trim_silence_db']),
  -36,
  { min: -90, max: -8 },
);
const DSP_TRIM_MIN_SILENCE_SECONDS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_trim_min_silence_seconds', 'trim_min_silence_seconds']),
  0.14,
  { min: 0.02, max: 3 },
);
const DSP_TRIM_MAX_SECONDS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_trim_max_seconds', 'trim_max_seconds']),
  4.8,
  { min: 0, max: 20 },
);
const DSP_NO_GAP_GUARD_ENABLED = parseBooleanConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_no_gap_guard', 'dsp_trim_no_gap_guard', 'trim_no_gap_guard']),
  true,
);
const DSP_TRIM_GUARD_THRESHOLD_BOOST_DB = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_trim_guard_threshold_boost_db', 'trim_guard_threshold_boost_db']),
  10,
  { min: 0, max: 30 },
);
const DSP_NO_GAP_ENERGY_TRIM_ENABLED = parseBooleanConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_no_gap_energy_trim', 'dsp_trim_energy_guard', 'trim_energy_guard']),
  true,
);
const DSP_NO_GAP_ENERGY_SAMPLE_RATE = Math.trunc(
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, ['dsp_no_gap_energy_sample_rate', 'trim_energy_sample_rate']),
    12000,
    { min: 4000, max: 48000 },
  ),
);
const DSP_NO_GAP_ENERGY_FRAME_MS = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_no_gap_energy_frame_ms', 'trim_energy_frame_ms']),
  20,
  { min: 5, max: 100 },
);
const DSP_NO_GAP_ENERGY_FLOOR_RATIO = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_no_gap_energy_floor_ratio', 'trim_energy_floor_ratio']),
  0.18,
  { min: 0.03, max: 0.9 },
);
const DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER = parseBoundedNumberConfigValue(
  pickConfigValue(ROOT_CONFIG, ['dsp_no_gap_energy_mean_multiplier', 'trim_energy_mean_multiplier']),
  1.7,
  { min: 1, max: 6 },
);
const LIVE_DSP_ENTRY_COMPENSATION_MS = Math.trunc(
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, [
      'dsp_live_entry_compensation_ms',
      'dsp_entry_compensation_ms',
      'live_dsp_entry_compensation_ms',
      'entry_compensation_ms',
    ]),
    22,
    { min: 0, max: 250 },
  ),
);
const LIVE_DSP_EXIT_COMPENSATION_MS = Math.trunc(
  parseBoundedNumberConfigValue(
    pickConfigValue(ROOT_CONFIG, [
      'dsp_live_exit_compensation_ms',
      'dsp_exit_compensation_ms',
      'live_dsp_exit_compensation_ms',
      'exit_compensation_ms',
    ]),
    19,
    { min: 0, max: 250 },
  ),
);
const DSP_TEMPO_FRAME_SAMPLES = 1024;
const DSP_TEMPO_HOP_SAMPLES = 512;

let shuttingDown = false;
let updateInProgress = false;
const authSessions = new Map();
const audioAttributesCache = new Map();
const layoutSubscribers = new Set();
const dspTransitions = new Map();
const dspQueue = [];
let dspWorkerScheduled = false;
let dspWorkerRunning = false;
const dspProbeState = {
  checkedAt: 0,
  available: null,
  error: null,
};
const dspTempoCache = new Map();
const dspSilenceTrimCache = new Map();
const dspEnergyTrimCache = new Map();
let dspLogWriteErrorShown = false;
const githubCache = {
  latestRelease: { etag: null, data: null },
  releasesList: { etag: null, data: null },
};
function getDefaultUpdateState() {
  return {
    stable: { lastChecked: 0, result: null },
    prerelease: { lastChecked: 0, result: null },
  };
}

function sanitizeCachedResult(result) {
  if (!result || typeof result !== 'object') return null;

  const clean = {
    latestVersion: typeof result.latestVersion === 'string' ? result.latestVersion : null,
    tarballUrl: typeof result.tarballUrl === 'string' ? result.tarballUrl : null,
    htmlUrl: typeof result.htmlUrl === 'string' ? result.htmlUrl : null,
    isPrerelease: Boolean(result.isPrerelease),
    releaseName: typeof result.releaseName === 'string' ? result.releaseName : null,
  };

  if (!clean.latestVersion && !clean.tarballUrl && !clean.htmlUrl && !clean.releaseName) {
    return null;
  }

  return clean;
}

function loadPersistedUpdateState() {
  try {
    if (!fs.existsSync(UPDATE_STATE_PATH)) {
      return getDefaultUpdateState();
    }

    const raw = fs.readFileSync(UPDATE_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    const state = getDefaultUpdateState();

    ['stable', 'prerelease'].forEach((key) => {
      if (!parsed[key] || typeof parsed[key] !== 'object') return;

      const lastChecked = Number(parsed[key].lastChecked);
      if (Number.isFinite(lastChecked) && lastChecked > 0) {
        state[key].lastChecked = lastChecked;
      }

      const cachedResult = sanitizeCachedResult(parsed[key].result);
      if (cachedResult) {
        state[key].result = cachedResult;
      }
    });

    return state;
  } catch (err) {
    console.error('Failed to load update state cache', err);
    return getDefaultUpdateState();
  }
}

function persistUpdateState(state) {
  try {
    fs.writeFileSync(UPDATE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist update state cache', err);
  }
}

const persistedUpdateState = loadPersistedUpdateState();
const updateCheckCache = {
  stable: { lastChecked: persistedUpdateState.stable.lastChecked, result: persistedUpdateState.stable.result },
  prerelease: { lastChecked: persistedUpdateState.prerelease.lastChecked, result: persistedUpdateState.prerelease.result },
};

function getDefaultLayoutState() {
  return {
    version: 0,
    updatedAt: 0,
    layout: [[]],
    playlistNames: ['Плей-лист 1'],
    playlistMeta: [{ type: 'manual' }],
    playlistAutoplay: [false],
    playlistDsp: [false],
    dapConfig: { ...DEFAULT_DAP_CONFIG },
    trackTitleModesByTrack: {},
  };
}

function getDefaultPlaybackState() {
  return {
    trackFile: null,
    paused: false,
    currentTime: 0,
    duration: null,
    volume: DEFAULT_LIVE_VOLUME,
    showVolumePresets: false,
    allowLiveSeek: false,
    dapPlayback: getDefaultDapPlaybackState(),
    overlaySeconds: 0,
    nextDspSliceSeconds: 0,
    nextDspSourceSeconds: 0,
    playlistIndex: null,
    playlistPosition: null,
    updatedAt: 0,
  };
}

function getDefaultDapPlaybackState() {
  return {
    trackFile: null,
    paused: false,
    currentTime: 0,
    duration: null,
    playlistIndex: null,
    playlistPosition: null,
    interrupted: false,
    updatedAt: 0,
  };
}

function defaultPlaylistName(index) {
  return `Плей-лист ${index + 1}`;
}

function sanitizePlaylistName(value, index) {
  if (typeof value !== 'string') {
    return defaultPlaylistName(index);
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return defaultPlaylistName(index);
  }

  return normalized.slice(0, PLAYLIST_NAME_MAX_LENGTH);
}

function sanitizeLayout(layout) {
  if (!Array.isArray(layout)) return null;

  const normalized = [];

  layout.forEach((playlist) => {
    if (!Array.isArray(playlist)) return;

    const clean = [];
    playlist.forEach((value) => {
      if (typeof value !== 'string') return;
      const file = value.trim();
      if (!file) return;
      clean.push(file);
    });

    normalized.push(clean);
  });

  return normalized;
}

function normalizePlaylistNames(playlistNames, layoutLength) {
  const result = [];

  for (let index = 0; index < layoutLength; index += 1) {
    const rawName = Array.isArray(playlistNames) ? playlistNames[index] : null;
    result.push(sanitizePlaylistName(rawName, index));
  }

  return result;
}

function normalizePlaylistAutoplayFlags(playlistAutoplay, layoutLength) {
  const result = [];

  for (let index = 0; index < layoutLength; index += 1) {
    const rawValue = Array.isArray(playlistAutoplay) ? playlistAutoplay[index] : false;
    result.push(Boolean(rawValue));
  }

  return result;
}

function normalizePlaylistDspFlags(playlistDsp, playlistAutoplay, layoutLength) {
  const normalizedAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, layoutLength);
  const result = [];

  for (let index = 0; index < layoutLength; index += 1) {
    const rawValue = Array.isArray(playlistDsp) ? playlistDsp[index] : false;
    result.push(Boolean(rawValue) && Boolean(normalizedAutoplay[index]));
  }

  return result;
}

function normalizeDapVolumePercent(value, fallback = DAP_DEFAULT_VOLUME_PERCENT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return normalizeDapVolumePercent(fallback, DAP_DEFAULT_VOLUME_PERCENT);
  }

  const rounded = Math.round(numeric);
  if (rounded < DAP_MIN_VOLUME_PERCENT) return DAP_MIN_VOLUME_PERCENT;
  if (rounded > DAP_MAX_VOLUME_PERCENT) return DAP_MAX_VOLUME_PERCENT;
  return rounded;
}

function sanitizeDapConfig(dapConfig, layoutLength, fallback = DEFAULT_DAP_CONFIG) {
  const expectedLayoutLength = Number.isInteger(layoutLength) && layoutLength >= 0 ? layoutLength : 0;
  const safeFallback =
    fallback && typeof fallback === 'object'
      ? {
          enabled: Boolean(fallback.enabled),
          playlistIndex: normalizePlaylistTrackIndex(fallback.playlistIndex),
          volumePercent: normalizeDapVolumePercent(fallback.volumePercent, DAP_DEFAULT_VOLUME_PERCENT),
        }
      : { ...DEFAULT_DAP_CONFIG };
  const rawConfig = dapConfig && typeof dapConfig === 'object' ? dapConfig : null;

  const requestedEnabled =
    rawConfig && Object.prototype.hasOwnProperty.call(rawConfig, 'enabled')
      ? Boolean(rawConfig.enabled)
      : safeFallback.enabled;
  const requestedPlaylistIndex =
    rawConfig && Object.prototype.hasOwnProperty.call(rawConfig, 'playlistIndex')
      ? normalizePlaylistTrackIndex(rawConfig.playlistIndex)
      : safeFallback.playlistIndex;
  const playlistIndex =
    requestedPlaylistIndex !== null &&
    requestedPlaylistIndex >= 0 &&
    requestedPlaylistIndex < expectedLayoutLength
      ? requestedPlaylistIndex
      : null;
  const volumePercent = normalizeDapVolumePercent(
    rawConfig && Object.prototype.hasOwnProperty.call(rawConfig, 'volumePercent')
      ? rawConfig.volumePercent
      : safeFallback.volumePercent,
    safeFallback.volumePercent,
  );
  const enabled = Boolean(requestedEnabled && playlistIndex !== null);

  return {
    enabled,
    playlistIndex,
    volumePercent,
  };
}

function normalizePlaylistAutoplayWithDap(playlistAutoplay, dapConfig, layoutLength) {
  const normalized = normalizePlaylistAutoplayFlags(playlistAutoplay, layoutLength);
  const sanitizedDap = sanitizeDapConfig(dapConfig, layoutLength, DEFAULT_DAP_CONFIG);
  if (sanitizedDap.enabled && sanitizedDap.playlistIndex !== null) {
    normalized[sanitizedDap.playlistIndex] = true;
  }
  return normalized;
}

function sanitizeTrackTitleMode(value) {
  return value === TRACK_TITLE_MODE_ATTRIBUTES ? TRACK_TITLE_MODE_ATTRIBUTES : null;
}

function sanitizeTrackTitleModesByTrack(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result = {};
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'ru'));

  for (const [rawKey, rawMode] of entries) {
    if (typeof rawKey !== 'string') continue;
    const normalizedKey = rawKey.trim().slice(0, TRACK_TITLE_KEY_MAX_LENGTH);
    if (!normalizedKey) continue;

    const normalizedMode = sanitizeTrackTitleMode(rawMode);
    if (!normalizedMode) continue;

    result[normalizedKey] = normalizedMode;
  }

  return result;
}

function sanitizeFolderKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (!normalized) return null;
  return normalized.slice(0, 512);
}

function sanitizeFolderOriginalName(value, fallback) {
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized) {
      return normalized.slice(0, PLAYLIST_NAME_MAX_LENGTH);
    }
  }

  if (typeof fallback === 'string') {
    const normalizedFallback = fallback.trim().replace(/\s+/g, ' ');
    if (normalizedFallback) {
      return normalizedFallback.slice(0, PLAYLIST_NAME_MAX_LENGTH);
    }
  }

  return '';
}

function sanitizePlaylistMetaEntry(value) {
  if (!value || typeof value !== 'object') {
    return { type: 'manual' };
  }

  if (value.type !== 'folder') {
    return { type: 'manual' };
  }

  const folderKey = sanitizeFolderKey(value.folderKey);
  if (!folderKey) {
    return { type: 'manual' };
  }

  const fallbackName = path.basename(folderKey) || folderKey;
  return {
    type: 'folder',
    folderKey,
    folderOriginalName: sanitizeFolderOriginalName(value.folderOriginalName, fallbackName),
  };
}

function normalizePlaylistMeta(playlistMeta, layoutLength) {
  const result = [];

  for (let index = 0; index < layoutLength; index += 1) {
    const rawValue = Array.isArray(playlistMeta) ? playlistMeta[index] : null;
    result.push(sanitizePlaylistMetaEntry(rawValue));
  }

  return result;
}

function normalizePlaylistTrackIndex(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function normalizeLiveVolumePreset(value, fallback = DEFAULT_LIVE_VOLUME) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.max(0, Math.min(1, numeric));

  if (Math.abs(normalized - 1) < 0.0001) {
    return 1;
  }
  return normalized;
}

function hasActiveVolumePreset(value) {
  const normalized = normalizeLiveVolumePreset(value, DEFAULT_LIVE_VOLUME);
  for (const preset of LIVE_VOLUME_PRESET_VALUES) {
    if (Math.abs(normalized - preset) < 0.0001) {
      return true;
    }
  }
  return false;
}

function normalizePlaybackSeekRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return 0;
  if (numeric >= 1) return 1;
  return numeric;
}

function sanitizeDapPlaybackState(rawPlayback) {
  const base = getDefaultDapPlaybackState();
  if (!rawPlayback || typeof rawPlayback !== 'object') {
    return base;
  }

  const trackFile = typeof rawPlayback.trackFile === 'string' ? rawPlayback.trackFile.trim() : '';
  if (!trackFile) {
    const updatedAt = Number(rawPlayback.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0) {
      base.updatedAt = updatedAt;
    }
    return base;
  }

  const rawCurrentTime = Number(rawPlayback.currentTime);
  let currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;

  const rawDuration = Number(rawPlayback.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  if (duration !== null && currentTime > duration) {
    currentTime = duration;
  }

  const updatedAt = Number(rawPlayback.updatedAt);
  return {
    trackFile,
    paused: Boolean(rawPlayback.paused),
    currentTime,
    duration,
    playlistIndex: normalizePlaylistTrackIndex(rawPlayback.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(rawPlayback.playlistPosition),
    interrupted: Boolean(rawPlayback.interrupted),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
  };
}

function sanitizePlaybackState(rawPlayback) {
  if (!rawPlayback || typeof rawPlayback !== 'object') {
    return {
      ...getDefaultPlaybackState(),
      updatedAt: Date.now(),
    };
  }

  const dapPlayback = sanitizeDapPlaybackState(rawPlayback.dapPlayback);
  const volume = normalizeLiveVolumePreset(rawPlayback.volume, DEFAULT_LIVE_VOLUME);
  const hasExplicitShowVolumePresets = Object.prototype.hasOwnProperty.call(rawPlayback, 'showVolumePresets');
  let showVolumePresets = hasExplicitShowVolumePresets ? Boolean(rawPlayback.showVolumePresets) : hasActiveVolumePreset(volume);
  if (!showVolumePresets && hasActiveVolumePreset(volume)) {
    showVolumePresets = true;
  }
  const allowLiveSeek = Boolean(rawPlayback.allowLiveSeek);
  const overlaySeconds = parseBoundedNumberConfigValue(rawPlayback.overlaySeconds, 0, { min: 0, max: 120 });
  const nextDspSliceSeconds = parseBoundedNumberConfigValue(rawPlayback.nextDspSliceSeconds, 0, { min: 0, max: 120 });
  let nextDspSourceSeconds = parseBoundedNumberConfigValue(rawPlayback.nextDspSourceSeconds, 0, {
    min: 0,
    max: 120,
  });
  if (nextDspSliceSeconds <= 0) {
    nextDspSourceSeconds = 0;
  } else if (nextDspSourceSeconds > nextDspSliceSeconds) {
    nextDspSourceSeconds = nextDspSliceSeconds;
  }
  const trackFile = typeof rawPlayback.trackFile === 'string' ? rawPlayback.trackFile.trim() : '';
  if (!trackFile) {
    return {
      ...getDefaultPlaybackState(),
      volume,
      showVolumePresets,
      allowLiveSeek,
      dapPlayback,
      overlaySeconds,
      nextDspSliceSeconds: 0,
      nextDspSourceSeconds: 0,
      updatedAt: Date.now(),
    };
  }

  const rawCurrentTime = Number(rawPlayback.currentTime);
  let currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;

  const rawDuration = Number(rawPlayback.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  if (duration !== null && currentTime > duration) {
    currentTime = duration;
  }

  return {
    trackFile,
    paused: Boolean(rawPlayback.paused),
    currentTime,
    duration,
    volume,
    showVolumePresets,
    allowLiveSeek,
    dapPlayback,
    overlaySeconds,
    nextDspSliceSeconds,
    nextDspSourceSeconds,
    playlistIndex: normalizePlaylistTrackIndex(rawPlayback.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(rawPlayback.playlistPosition),
    updatedAt: Date.now(),
  };
}

function hasLivePlaybackTrack(state) {
  return Boolean(state && typeof state.trackFile === 'string' && state.trackFile.trim());
}

function isDeletingLivePlaybackPlaylist(nextLayout) {
  if (!hasLivePlaybackTrack(sharedPlaybackState)) return false;

  const livePlaylistIndex = normalizePlaylistTrackIndex(sharedPlaybackState.playlistIndex);
  if (livePlaylistIndex === null) return false;

  if (!Array.isArray(sharedLayoutState.layout[livePlaylistIndex])) return false;
  return !Array.isArray(nextLayout[livePlaylistIndex]);
}

function detectRemovedPlaylistIndex(previousLayout, nextLayout) {
  if (!Array.isArray(previousLayout) || !Array.isArray(nextLayout)) return null;
  if (previousLayout.length !== nextLayout.length + 1) return null;

  const serializedPrevious = previousLayout.map((playlist) => JSON.stringify(Array.isArray(playlist) ? playlist : []));
  const serializedNext = nextLayout.map((playlist) => JSON.stringify(Array.isArray(playlist) ? playlist : []));

  let removedIndex = -1;
  for (let index = 0; index < serializedNext.length; index += 1) {
    if (serializedPrevious[index] === serializedNext[index]) continue;
    removedIndex = index;
    break;
  }

  if (removedIndex === -1) {
    return previousLayout.length - 1;
  }

  for (let index = removedIndex; index < serializedNext.length; index += 1) {
    if (serializedPrevious[index + 1] !== serializedNext[index]) {
      return null;
    }
  }

  return removedIndex;
}

function loadPersistedLayoutState() {
  try {
    if (!fs.existsSync(LAYOUT_STATE_PATH)) {
      return getDefaultLayoutState();
    }

    const raw = fs.readFileSync(LAYOUT_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const sanitizedLayout = sanitizeLayout(parsed.layout);
    if (!sanitizedLayout) {
      return getDefaultLayoutState();
    }
    const sanitizedNames = normalizePlaylistNames(parsed.playlistNames, sanitizedLayout.length);
    const sanitizedMeta = normalizePlaylistMeta(parsed.playlistMeta, sanitizedLayout.length);
    const persistedDap = sanitizeDapConfig(parsed.dapConfig, sanitizedLayout.length, DEFAULT_DAP_CONFIG);
    // DAP must always start disabled after server reboot, while preserving selected playlist/volume.
    const sanitizedDap = {
      ...persistedDap,
      enabled: false,
    };
    const sanitizedAutoplay = normalizePlaylistAutoplayWithDap(
      parsed.playlistAutoplay,
      sanitizedDap,
      sanitizedLayout.length,
    );
    const sanitizedDsp = normalizePlaylistDspFlags(parsed.playlistDsp, sanitizedAutoplay, sanitizedLayout.length);
    const sanitizedTrackTitleModes = sanitizeTrackTitleModesByTrack(parsed.trackTitleModesByTrack);

    const version = Number(parsed.version);
    const updatedAt = Number(parsed.updatedAt);

    return {
      version: Number.isFinite(version) && version >= 0 ? version : 0,
      updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
      layout: sanitizedLayout,
      playlistNames: sanitizedNames,
      playlistMeta: sanitizedMeta,
      playlistAutoplay: sanitizedAutoplay,
      playlistDsp: sanitizedDsp,
      dapConfig: sanitizedDap,
      trackTitleModesByTrack: sanitizedTrackTitleModes,
    };
  } catch (err) {
    console.error('Failed to load layout state cache', err);
    return getDefaultLayoutState();
  }
}

function persistLayoutState(state) {
  try {
    fs.writeFileSync(LAYOUT_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist layout state cache', err);
  }
}

function sanitizeClientId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, 128);
}

function serializePlaybackState(state) {
  return JSON.stringify({
    trackFile: typeof state.trackFile === 'string' ? state.trackFile : null,
    paused: Boolean(state.paused),
    currentTime: Number.isFinite(state.currentTime) && state.currentTime >= 0 ? state.currentTime : 0,
    duration: Number.isFinite(state.duration) && state.duration > 0 ? state.duration : null,
    volume: normalizeLiveVolumePreset(state.volume, DEFAULT_LIVE_VOLUME),
    showVolumePresets: Boolean(state.showVolumePresets),
    allowLiveSeek: Boolean(state.allowLiveSeek),
    dapPlayback: (() => {
      const normalizedDap = sanitizeDapPlaybackState(state.dapPlayback);
      return {
        trackFile: normalizedDap.trackFile,
        paused: normalizedDap.paused,
        currentTime: normalizedDap.currentTime,
        duration: normalizedDap.duration,
        playlistIndex: normalizedDap.playlistIndex,
        playlistPosition: normalizedDap.playlistPosition,
        interrupted: normalizedDap.interrupted,
      };
    })(),
    overlaySeconds: parseBoundedNumberConfigValue(state.overlaySeconds, 0, { min: 0, max: 120 }),
    nextDspSliceSeconds: parseBoundedNumberConfigValue(state.nextDspSliceSeconds, 0, { min: 0, max: 120 }),
    nextDspSourceSeconds: parseBoundedNumberConfigValue(state.nextDspSourceSeconds, 0, { min: 0, max: 120 }),
    playlistIndex: normalizePlaylistTrackIndex(state.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(state.playlistPosition),
  });
}

function buildLayoutPayload(sourceClientId = null) {
  return {
    layout: sharedLayoutState.layout,
    playlistNames: sharedLayoutState.playlistNames,
    playlistMeta: sharedLayoutState.playlistMeta,
    playlistAutoplay: sharedLayoutState.playlistAutoplay,
    playlistDsp: sharedLayoutState.playlistDsp,
    dapConfig: sharedLayoutState.dapConfig,
    trackTitleModesByTrack: sharedLayoutState.trackTitleModesByTrack,
    version: sharedLayoutState.version,
    updatedAt: sharedLayoutState.updatedAt,
    sourceClientId,
  };
}

function buildPlaybackPayload(sourceClientId = null) {
  const normalizedDapPlayback = sanitizeDapPlaybackState(sharedPlaybackState.dapPlayback);
  return {
    trackFile: sharedPlaybackState.trackFile,
    paused: sharedPlaybackState.paused,
    currentTime: sharedPlaybackState.currentTime,
    duration: sharedPlaybackState.duration,
    volume: sharedPlaybackState.volume,
    showVolumePresets: Boolean(sharedPlaybackState.showVolumePresets),
    allowLiveSeek: Boolean(sharedPlaybackState.allowLiveSeek),
    dapPlayback: {
      trackFile: normalizedDapPlayback.trackFile,
      paused: normalizedDapPlayback.paused,
      currentTime: normalizedDapPlayback.currentTime,
      duration: normalizedDapPlayback.duration,
      playlistIndex: normalizedDapPlayback.playlistIndex,
      playlistPosition: normalizedDapPlayback.playlistPosition,
      interrupted: normalizedDapPlayback.interrupted,
      updatedAt: normalizedDapPlayback.updatedAt,
    },
    overlaySeconds: parseBoundedNumberConfigValue(sharedPlaybackState.overlaySeconds, 0, { min: 0, max: 120 }),
    nextDspSliceSeconds: parseBoundedNumberConfigValue(sharedPlaybackState.nextDspSliceSeconds, 0, {
      min: 0,
      max: 120,
    }),
    nextDspSourceSeconds: parseBoundedNumberConfigValue(sharedPlaybackState.nextDspSourceSeconds, 0, {
      min: 0,
      max: 120,
    }),
    playlistIndex: sharedPlaybackState.playlistIndex,
    playlistPosition: sharedPlaybackState.playlistPosition,
    updatedAt: sharedPlaybackState.updatedAt,
    sourceClientId,
  };
}

function sendSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastLayoutUpdate(sourceClientId = null) {
  const payload = buildLayoutPayload(sourceClientId);

  for (const res of layoutSubscribers) {
    try {
      sendSseEvent(res, 'layout', payload);
    } catch (err) {
      layoutSubscribers.delete(res);
    }
  }
}

function broadcastPlaybackUpdate(sourceClientId = null) {
  const payload = buildPlaybackPayload(sourceClientId);

  for (const res of layoutSubscribers) {
    try {
      sendSseEvent(res, 'playback', payload);
    } catch (err) {
      layoutSubscribers.delete(res);
    }
  }
}

function broadcastAuthUsersUpdate(sourceClientId = null) {
  const payload = buildAuthUsersPayload(sourceClientId);

  for (const res of layoutSubscribers) {
    try {
      sendSseEvent(res, 'auth-users', payload);
    } catch (err) {
      layoutSubscribers.delete(res);
    }
  }
}

function broadcastPlaybackCommand(commandPayload) {
  if (!commandPayload || typeof commandPayload !== 'object') return;

  for (const res of layoutSubscribers) {
    try {
      sendSseEvent(res, 'playback-command', commandPayload);
    } catch (err) {
      layoutSubscribers.delete(res);
    }
  }
}

const livePlaybackCommandBus = new PlaybackCommandBus({
  authorize: ({ sourceRole, commandType, isServer }) =>
    canDispatchLivePlaybackCommand({
      sourceRole,
      commandType,
      isServer,
    }),
  execute: (payload) => {
    broadcastPlaybackCommand(payload);
  },
});

function keepLayoutStreamAlive() {
  for (const res of layoutSubscribers) {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      layoutSubscribers.delete(res);
    }
  }
}

let sharedLayoutState = loadPersistedLayoutState();
let sharedPlaybackState = getDefaultPlaybackState();
setInterval(keepLayoutStreamAlive, 25 * 1000).unref();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAudioFile(filenameOrPath) {
  return AUDIO_EXTENSIONS.has(path.extname(filenameOrPath).toLowerCase());
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
  };
  return map[ext] || 'application/octet-stream';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function isInside(baseResolved, targetResolved) {
  const rel = path.relative(baseResolved, targetResolved);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function normalizeIpAddress(ip) {
  if (typeof ip !== 'string') return '';
  let normalized = ip.trim().toLowerCase();
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) {
    normalized = normalized.slice(0, zoneIndex);
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }
  return normalized;
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);

function isLoopbackAddress(ip) {
  return ip !== '' && LOOPBACK_ADDRESSES.has(ip);
}

function collectForwardedAddresses(req) {
  const result = [];

  const pushHeaderValues = (headerValue) => {
    if (typeof headerValue === 'string') {
      headerValue
        .split(',')
        .map((item) => normalizeIpAddress(item))
        .filter(Boolean)
        .forEach((item) => result.push(item));
      return;
    }

    if (Array.isArray(headerValue)) {
      headerValue.forEach((entry) => pushHeaderValues(entry));
    }
  };

  pushHeaderValues(req.headers['x-forwarded-for']);
  pushHeaderValues(req.headers['x-real-ip']);
  return result;
}

function isServerRequest(req) {
  const remoteAddress = normalizeIpAddress(req.socket && req.socket.remoteAddress);
  if (!isLoopbackAddress(remoteAddress)) return false;

  const forwardedAddresses = collectForwardedAddresses(req);
  if (forwardedAddresses.some((address) => !isLoopbackAddress(address))) {
    return false;
  }

  return true;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};

  return header.split(';').reduce((acc, chunk) => {
    const [rawName, ...rawValueParts] = chunk.split('=');
    const name = rawName ? rawName.trim() : '';
    if (!name) return acc;

    const value = rawValueParts.join('=').trim();
    try {
      acc[name] = decodeURIComponent(value);
    } catch (err) {
      acc[name] = value;
    }
    return acc;
  }, {});
}

function safeCompareStrings(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeSessionRole(value) {
  return value === ROLE_COHOST ? ROLE_COHOST : ROLE_SLAVE;
}

function sanitizeSessionRecord(token, rawSession, now) {
  if (!SESSION_TOKEN_PATTERN.test(token)) return null;
  if (!rawSession || typeof rawSession !== 'object') return null;

  const username = typeof rawSession.username === 'string' ? rawSession.username : '';
  const expiresAt = Number(rawSession.expiresAt);
  const role = sanitizeSessionRole(rawSession.role);

  if (!USERNAME_PATTERN.test(username)) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  return { username, expiresAt, role };
}

function collectActiveAuthUsers() {
  const now = Date.now();
  const groupedByUsername = new Map();
  let hasInvalidEntries = false;

  for (const [token, rawSession] of authSessions.entries()) {
    const session = sanitizeSessionRecord(token, rawSession, now);
    if (!session) {
      authSessions.delete(token);
      hasInvalidEntries = true;
      continue;
    }

    const existing = groupedByUsername.get(session.username) || {
      username: session.username,
      role: ROLE_SLAVE,
      sessionCount: 0,
      expiresAt: 0,
    };
    existing.sessionCount += 1;
    if (session.role === ROLE_COHOST) {
      existing.role = ROLE_COHOST;
    }
    if (session.expiresAt > existing.expiresAt) {
      existing.expiresAt = session.expiresAt;
    }
    groupedByUsername.set(session.username, existing);
  }

  if (hasInvalidEntries) {
    persistSessions();
  }

  return Array.from(groupedByUsername.values()).sort((left, right) => left.username.localeCompare(right.username, 'ru'));
}

function buildAuthUsersPayload(sourceClientId = null) {
  return {
    users: collectActiveAuthUsers(),
    sourceClientId,
  };
}

function persistSessions() {
  try {
    const now = Date.now();
    const serialized = {};

    for (const [token, rawSession] of authSessions.entries()) {
      const session = sanitizeSessionRecord(token, rawSession, now);
      if (!session) {
        authSessions.delete(token);
        continue;
      }

      serialized[token] = session;
    }

    fs.writeFileSync(SESSIONS_STATE_PATH, JSON.stringify(serialized, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist auth sessions cache', err);
  }
}

function loadPersistedSessions() {
  try {
    if (!fs.existsSync(SESSIONS_STATE_PATH)) return;

    const raw = fs.readFileSync(SESSIONS_STATE_PATH, 'utf8');
    if (!raw.trim()) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid auth sessions cache format');
    }

    const now = Date.now();
    let hasInvalidEntries = false;

    for (const [token, rawSession] of Object.entries(parsed)) {
      const session = sanitizeSessionRecord(token, rawSession, now);
      if (!session) {
        hasInvalidEntries = true;
        continue;
      }

      authSessions.set(token, session);
    }

    if (hasInvalidEntries) {
      persistSessions();
    }
  } catch (err) {
    console.error('Failed to load auth sessions cache', err);
  }
}

function resolveDefaultRoleForUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return ROLE_SLAVE;

  for (const session of authSessions.values()) {
    if (!session || session.username !== normalizedUsername) continue;
    if (sanitizeSessionRole(session.role) === ROLE_COHOST) {
      return ROLE_COHOST;
    }
  }

  return ROLE_SLAVE;
}

function createSession(username) {
  const sessionRole = resolveDefaultRoleForUsername(username);
  const token = createSessionToken();
  authSessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_TTL_MS,
    role: sessionRole,
  });
  persistSessions();
  broadcastAuthUsersUpdate();
  return { token, role: sessionRole };
}

function getSessionByToken(token) {
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    persistSessions();
    broadcastAuthUsersUpdate();
    return null;
  }
  return session;
}

function destroySession(token) {
  if (!token) return;
  if (authSessions.delete(token)) {
    persistSessions();
    broadcastAuthUsersUpdate();
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  let changed = false;

  for (const [token, session] of authSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      authSessions.delete(token);
      changed = true;
    }
  }

  if (changed) {
    persistSessions();
    broadcastAuthUsersUpdate();
  }
}

loadPersistedSessions();
setInterval(cleanupExpiredSessions, 5 * 60 * 1000).unref();

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function extractPasswordFromFile(content) {
  if (typeof content !== 'string') return null;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return null;
}

async function getUserPassword(username) {
  const candidates = [`${username}.txt`, username];

  for (const fileName of candidates) {
    const fullPath = path.resolve(USERS_DIR_RESOLVED, fileName);
    if (!isInside(USERS_DIR_RESOLVED, fullPath)) continue;

    try {
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) continue;
      const raw = await fs.promises.readFile(fullPath, 'utf8');
      return extractPasswordFromFile(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Failed to read user file', fullPath, err);
      }
    }
  }

  return null;
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim();
  if (!USERNAME_PATTERN.test(username)) return null;
  return username;
}

function readJsonBody(req, limitBytes = AUTH_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;

    req.on('data', (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > limitBytes) {
        done = true;
        req.resume();
        reject(new Error('BODY_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (done) return;
      done = true;
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (err) {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function getAuthState(req) {
  if (isServerRequest(req)) {
    return {
      authenticated: true,
      isServer: true,
      role: ROLE_HOST,
      username: 'server',
    };
  }

  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  const session = getSessionByToken(token);

  if (!session) {
    return {
      authenticated: false,
      isServer: false,
      role: null,
      username: null,
      token: null,
    };
  }

  return {
    authenticated: true,
    isServer: false,
    role: sanitizeSessionRole(session.role),
    username: session.username,
    token,
  };
}

function requireAuthorizedRequest(req, res, responseKind = 'json') {
  const auth = getAuthState(req);
  if (auth.authenticated) return auth;

  if (responseKind === 'text') {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Unauthorized');
    return null;
  }

  sendJson(res, 401, { error: 'Требуется авторизация' });
  return null;
}

function requireHostRequest(req, res) {
  const auth = getAuthState(req);
  if (!auth.authenticated) {
    sendJson(res, 401, { error: 'Требуется авторизация' });
    return null;
  }
  if (auth.isServer) return auth;
  sendJson(res, 403, { error: 'Только хост может выполнять это действие' });
  return null;
}

function sanitizeManagedUserRole(value) {
  return value === ROLE_COHOST ? ROLE_COHOST : ROLE_SLAVE;
}

function setRoleForActiveUserSessions(username, role) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { matchedSessions: 0, changed: false };
  }

  const nextRole = sanitizeManagedUserRole(role);
  const now = Date.now();
  let matchedSessions = 0;
  let changed = false;
  let hasInvalidEntries = false;

  for (const [token, rawSession] of authSessions.entries()) {
    const session = sanitizeSessionRecord(token, rawSession, now);
    if (!session) {
      authSessions.delete(token);
      hasInvalidEntries = true;
      continue;
    }

    if (session.username !== normalizedUsername) continue;
    matchedSessions += 1;
    const currentRole = session.role;
    if (currentRole === nextRole) continue;
    rawSession.role = nextRole;
    changed = true;
  }

  if (hasInvalidEntries || changed) {
    persistSessions();
  }
  if (changed || hasInvalidEntries) {
    broadcastAuthUsersUpdate();
  }

  return { matchedSessions, changed };
}

function disconnectActiveUserSessions(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { removedSessions: 0 };
  }

  const now = Date.now();
  let removedSessions = 0;
  let hasInvalidEntries = false;

  for (const [token, rawSession] of authSessions.entries()) {
    const session = sanitizeSessionRecord(token, rawSession, now);
    if (!session) {
      authSessions.delete(token);
      hasInvalidEntries = true;
      continue;
    }

    if (session.username !== normalizedUsername) continue;
    authSessions.delete(token);
    removedSessions += 1;
  }

  if (removedSessions > 0 || hasInvalidEntries) {
    persistSessions();
    broadcastAuthUsersUpdate();
  }

  return { removedSessions };
}

function sanitizePlaybackCommand(rawCommand) {
  if (!rawCommand || typeof rawCommand !== 'object') return null;

  const commandType = typeof rawCommand.type === 'string' ? rawCommand.type.trim() : '';
  if (commandType === 'toggle-current') {
    return { type: 'toggle-current' };
  }

  if (commandType === 'set-volume') {
    const volume = normalizeLiveVolumePreset(rawCommand.volume, null);
    if (volume === null) return null;
    return { type: 'set-volume', volume };
  }

  if (commandType === 'set-volume-presets-visible') {
    return {
      type: 'set-volume-presets-visible',
      showVolumePresets: Boolean(rawCommand.showVolumePresets),
    };
  }

  if (commandType === 'set-live-seek-enabled') {
    return {
      type: 'set-live-seek-enabled',
      allowLiveSeek: Boolean(rawCommand.allowLiveSeek),
    };
  }

  if (commandType === 'seek-current') {
    const positionRatio = normalizePlaybackSeekRatio(rawCommand.positionRatio);
    if (positionRatio === null) return null;
    return {
      type: 'seek-current',
      positionRatio,
      finalize: Boolean(rawCommand.finalize),
    };
  }

  if (commandType !== 'play-track') {
    return null;
  }

  const file = typeof rawCommand.file === 'string' ? rawCommand.file.trim() : '';
  if (!file) return null;

  return {
    type: 'play-track',
    file,
    basePath: '/audio',
    playlistIndex: normalizePlaylistTrackIndex(rawCommand.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(rawCommand.playlistPosition),
  };
}

function normalizeVersion(version) {
  if (typeof version !== 'string') return null;
  return version.replace(/^v/i, '').trim();
}

function parseBooleanParam(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function compareVersions(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);

  if (!left || !right) return 0;

  const leftParts = left.split('.').map((p) => parseInt(p, 10) || 0);
  const rightParts = right.split('.').map((p) => parseInt(p, 10) || 0);
  const maxLen = Math.max(leftParts.length, rightParts.length);

  for (let i = 0; i < maxLen; i += 1) {
    const l = leftParts[i] || 0;
    const r = rightParts[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  return 0;
}

function computeRateLimitDelay(headers, fallbackMs) {
  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const retrySeconds = parseFloat(retryAfter);
    if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
      return retrySeconds * 1000;
    }
  }

  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];

  if (remaining === '0' && reset) {
    const resetMs = parseInt(reset, 10) * 1000 - Date.now();
    if (Number.isFinite(resetMs) && resetMs > 0) {
      return resetMs;
    }
  }

  return fallbackMs;
}

async function fetchGithubJsonWithETag(url, cacheEntry, attempt = 1, backoffMs = 1000) {
  const headers = { 'User-Agent': 'djtron-updater', Accept: 'application/vnd.github+json' };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }
  if (cacheEntry && cacheEntry.etag) {
    headers['If-None-Match'] = cacheEntry.etag;
  }

  const performRequest = () =>
    new Promise((resolve, reject) => {
      const request = https.get(url, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchGithubJsonWithETag(res.headers.location, cacheEntry, attempt, backoffMs).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode === 304) {
          res.resume();
          if (cacheEntry && cacheEntry.data) {
            resolve({ data: cacheEntry.data, etag: cacheEntry.etag, fromCache: true });
          } else {
            reject(new Error('Получен 304 без сохраненных данных'));
          }
          return;
        }

        if (res.statusCode === 403 || res.statusCode === 429) {
          const waitMs = computeRateLimitDelay(res.headers, backoffMs);
          res.resume();
          if (attempt < 3) {
            delay(waitMs)
              .then(() => fetchGithubJsonWithETag(url, cacheEntry, attempt + 1, Math.min(backoffMs * 2, 16000)))
              .then(resolve)
              .catch(reject);
            return;
          }
          reject(new Error('Превышены лимиты GitHub API, попробуйте позже'));
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API responded with status ${res.statusCode}`));
          res.resume();
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve({ data: parsed, etag: res.headers.etag || null, fromCache: false });
          } catch (err) {
            reject(err);
          }
        });
      });

      request.on('error', reject);
    });

  return performRequest();
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);

    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        https.get(res.headers.location, { headers: { 'User-Agent': 'djtron-updater' } }, handleResponse).on(
          'error',
          reject
        );
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with status ${res.statusCode}`));
        res.resume();
        return;
      }

      pipelineAsync(res, file)
        .then(resolve)
        .catch((err) => {
          fs.unlink(destination, () => reject(err));
        });
    };

    https
      .get(url, { headers: { 'User-Agent': 'djtron-updater' } }, handleResponse)
      .on('error', (err) => {
        fs.unlink(destination, () => reject(err));
      });
  });
}

function parseReleaseVersion(release) {
  if (!release) return null;
  const candidates = [release.tag_name, release.name];

  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const match = /v(\d+(?:\.\d+)*)/i.exec(value);
    if (match) return match[1];
  }

  return null;
}

async function fetchLatestRelease() {
  const result = await fetchGithubJsonWithETag(`${GITHUB_API_URL}/releases/latest`, githubCache.latestRelease);
  githubCache.latestRelease.etag = result.etag || githubCache.latestRelease.etag;
  githubCache.latestRelease.data = result.data || githubCache.latestRelease.data;
  return githubCache.latestRelease.data;
}

async function fetchLatestPrerelease() {
  const result = await fetchGithubJsonWithETag(`${GITHUB_API_URL}/releases?per_page=20`, githubCache.releasesList);
  githubCache.releasesList.etag = result.etag || githubCache.releasesList.etag;
  githubCache.releasesList.data = result.data || githubCache.releasesList.data;

  const releases = result.data;
  if (!Array.isArray(releases)) return null;

  return releases.find((rel) => rel && !rel.draft && rel.prerelease) || null;
}

async function getLatestReleaseInfo(currentVersion, allowPrerelease = false) {
  const cacheKey = allowPrerelease ? 'prerelease' : 'stable';
  const cacheEntry = updateCheckCache[cacheKey];
  const now = Date.now();

  if (cacheEntry.result && UPDATE_CACHE_WINDOW_MS > 0 && now - cacheEntry.lastChecked < UPDATE_CACHE_WINDOW_MS) {
    return cacheEntry.result;
  }

  const release = await fetchLatestRelease();
  const releaseVersion = parseReleaseVersion(release);

  let latest = {
    latestVersion: releaseVersion,
    tarballUrl: release && release.tarball_url,
    htmlUrl: release && release.html_url,
    isPrerelease: false,
    releaseName: release && release.name,
  };

  if (allowPrerelease) {
    const prerelease = await fetchLatestPrerelease();
    const prereleaseVersion = parseReleaseVersion(prerelease);

    if (prerelease && prereleaseVersion && compareVersions(prereleaseVersion, currentVersion) > 0) {
      latest = {
        latestVersion: prereleaseVersion,
        tarballUrl: prerelease && prerelease.tarball_url,
        htmlUrl: prerelease && prerelease.html_url,
        isPrerelease: true,
        releaseName: prerelease && prerelease.name,
      };
    }
  }

  cacheEntry.lastChecked = now;
  cacheEntry.result = latest;
  persistUpdateState(updateCheckCache);

  return latest;
}

async function extractTarball(archivePath, targetDir) {
  await execFileAsync('tar', ['-xzf', archivePath, '-C', targetDir]);
}

async function findExtractedRoot(tempDir) {
  const entries = await fs.promises.readdir(tempDir, { withFileTypes: true });
  const folder = entries.find((entry) => entry.isDirectory());
  if (!folder) {
    throw new Error('Не удалось найти содержимое распакованного архива');
  }
  return path.join(tempDir, folder.name);
}

async function copyReleaseContents(sourceDir, targetDir) {
  await fs.promises.cp(sourceDir, targetDir, { recursive: true, force: true });
}

function safeResolve(baseDirResolved, requestPath) {
  // requestPath must be without leading slashes
  const resolved = path.resolve(baseDirResolved, requestPath);
  return isInside(baseDirResolved, resolved) ? resolved : null;
}

function normalizeDspTransitionSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DSP_DEFAULT_TRANSITION_SECONDS;
  return Math.max(0.2, Math.min(30, Math.round(numeric * 1000) / 1000));
}

function normalizeDspSliceSeconds(value, transitionSeconds = DSP_DEFAULT_TRANSITION_SECONDS) {
  const numeric = Number(value);
  const fallback = Math.max(DSP_DEFAULT_SLICE_SECONDS, transitionSeconds + 0.2);
  if (!Number.isFinite(numeric)) return fallback;
  const bounded = Math.max(transitionSeconds + 0.2, Math.min(120, numeric));
  return Math.round(bounded * 1000) / 1000;
}

function normalizeDspTransitionInputFile(rawFile) {
  if (typeof rawFile !== 'string') return null;
  const normalized = normalizeAudioRelativePath(rawFile.trim());
  if (!normalized) return null;

  const absolutePath = safeResolve(AUDIO_DIR_RESOLVED, normalized);
  if (!absolutePath) return null;
  if (!isAudioFile(absolutePath)) return null;

  return {
    file: normalized,
    absolutePath,
  };
}

function buildDspTransitionId(fromFile, toFile, transitionSeconds, sliceSeconds) {
  const hashInput = JSON.stringify({
    v: 7,
    fromFile,
    toFile,
    transitionSeconds,
    sliceSeconds,
    tempoAlignEnabled: DSP_TEMPO_ALIGN_ENABLED,
    tempoMaxAdjustPercent: DSP_TEMPO_MAX_ADJUST_PERCENT,
    tempoGlideEnabled: DSP_TEMPO_GLIDE_ENABLED,
    tempoGlideSegments: DSP_TEMPO_GLIDE_SEGMENTS,
    tempoGlideAnchorSeconds: DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
    tempoMinDeltaRatio: DSP_TEMPO_MIN_DELTA_RATIO,
    aggressiveJoinEnabled: DSP_AGGRESSIVE_JOIN_ENABLED,
    joinIntensity: DSP_JOIN_INTENSITY,
    joinMinTransitionSeconds: DSP_JOIN_MIN_TRANSITION_SECONDS,
    trimSilenceEnabled: DSP_TRIM_SILENCE_ENABLED,
    trimSilenceThresholdDb: DSP_TRIM_SILENCE_THRESHOLD_DB,
    trimMinSilenceSeconds: DSP_TRIM_MIN_SILENCE_SECONDS,
    trimMaxSeconds: DSP_TRIM_MAX_SECONDS,
    noGapGuardEnabled: DSP_NO_GAP_GUARD_ENABLED,
    trimGuardThresholdBoostDb: DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
    noGapEnergyTrimEnabled: DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    noGapEnergyFloorRatio: DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    noGapEnergyMeanMultiplier: DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
    format: DSP_TRANSITION_OUTPUT_FORMAT,
    codec: DSP_TRANSITION_OUTPUT_CODEC,
  });
  return crypto.createHash('sha1').update(hashInput).digest('hex');
}

function buildDspTransitionDescriptor(rawFrom, rawTo, options = {}) {
  if (!DSP_ENABLED) {
    return { error: 'DSP отключен в конфигурации (dsp_enabled=false).' };
  }

  const fromTrack = normalizeDspTransitionInputFile(rawFrom);
  const toTrack = normalizeDspTransitionInputFile(rawTo);
  if (!fromTrack || !toTrack) {
    return { error: 'Некорректные пути треков для transition.' };
  }

  const transitionSeconds = normalizeDspTransitionSeconds(options.transitionSeconds);
  const sliceSeconds = normalizeDspSliceSeconds(options.sliceSeconds, transitionSeconds);
  const id = buildDspTransitionId(fromTrack.file, toTrack.file, transitionSeconds, sliceSeconds);
  const outputFileName = `${id}.${DSP_TRANSITION_OUTPUT_FORMAT}`;
  const outputPath = path.join(DSP_TRANSITIONS_DIR, outputFileName);

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

function buildDspOutputEncodingArgs() {
  if (DSP_TRANSITION_OUTPUT_FORMAT === 'wav') {
    return ['-c:a', 'pcm_s16le'];
  }
  return ['-c:a', 'libmp3lame', '-q:a', '2'];
}

function resolveDspTransitionOutputPathById(id) {
  if (!id) return null;

  const knownItem = dspTransitions.get(id);
  if (knownItem && typeof knownItem.outputPath === 'string' && knownItem.outputPath) {
    const knownPath = safeResolve(DSP_TRANSITIONS_DIR, path.basename(knownItem.outputPath));
    if (knownPath && fs.existsSync(knownPath)) {
      return knownPath;
    }
  }

  const preferredPath = safeResolve(DSP_TRANSITIONS_DIR, `${id}.${DSP_TRANSITION_OUTPUT_FORMAT}`);
  if (preferredPath && fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  const fallbackExts = DSP_TRANSITION_OUTPUT_FORMAT === 'wav' ? ['mp3'] : ['wav'];
  for (const ext of fallbackExts) {
    const fallbackPath = safeResolve(DSP_TRANSITIONS_DIR, `${id}.${ext}`);
    if (fallbackPath && fs.existsSync(fallbackPath)) {
      return fallbackPath;
    }
  }

  return preferredPath;
}

function safeSerializeDspLogPayload(payload) {
  const normalizedPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload };

  try {
    return JSON.stringify(normalizedPayload);
  } catch (err) {
    return JSON.stringify({ error: 'Failed to serialize DSP log payload' });
  }
}

function appendDspLog(eventName, payload = {}) {
  const event = typeof eventName === 'string' && eventName.trim() ? eventName.trim() : 'event';
  const line = `${new Date().toISOString()} ${event} ${safeSerializeDspLogPayload(payload)}\n`;
  try {
    fs.appendFileSync(DSP_LOG_PATH, line, 'utf8');
  } catch (err) {
    if (dspLogWriteErrorShown) return;
    dspLogWriteErrorShown = true;
    console.error('Failed to write DSP log file', err);
  }
}

function initializeDspLogFile() {
  try {
    const stat = fs.statSync(DSP_LOG_PATH);
    if (!stat.isFile()) return;
    if (stat.size <= DSP_LOG_MAX_BYTES) return;

    const backupPath = `${DSP_LOG_PATH}.prev`;
    try {
      fs.unlinkSync(backupPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // keep going even if old backup cleanup fails
      }
    }
    fs.renameSync(DSP_LOG_PATH, backupPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to initialize DSP log file', err);
    }
  }
}

function normalizeTempoBpmValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 40 || numeric > 260) return null;
  return Math.round(numeric * 1000) / 1000;
}

function normalizeTempoCacheTrackKey(trackFile) {
  const normalized = normalizeAudioRelativePath(trackFile || '');
  return normalized || null;
}

function loadDspTempoCache() {
  try {
    if (!fs.existsSync(DSP_TEMPO_CACHE_PATH)) return;
    const raw = fs.readFileSync(DSP_TEMPO_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    for (const [rawTrackFile, rawEntry] of Object.entries(parsed)) {
      const trackFile = normalizeTempoCacheTrackKey(rawTrackFile);
      if (!trackFile) continue;
      if (!rawEntry || typeof rawEntry !== 'object') continue;

      const bpm = normalizeTempoBpmValue(rawEntry.bpm);
      const mtimeMs = Number(rawEntry.mtimeMs);
      const size = Number(rawEntry.size);
      if (!bpm || !Number.isFinite(mtimeMs) || !Number.isFinite(size)) continue;

      const source = typeof rawEntry.source === 'string' && rawEntry.source ? rawEntry.source : 'analysis';
      dspTempoCache.set(trackFile, {
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

function persistDspTempoCache() {
  try {
    if (!dspTempoCache.size) return;
    const payload = {};
    for (const [trackFile, entry] of dspTempoCache.entries()) {
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
    fs.mkdirSync(DSP_CACHE_DIR, { recursive: true });
    fs.writeFileSync(DSP_TEMPO_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
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

async function probeTrackTempoBpmFromMetadata(absolutePath) {
  try {
    const { stdout } = await execFileAsync(
      DSP_FFPROBE_BINARY,
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

async function decodeTrackPcmForTempoAnalysis(absolutePath) {
  const analysisDuration = Math.max(15, Math.round(DSP_TEMPO_ANALYSIS_SECONDS));
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
    String(DSP_TEMPO_SAMPLE_RATE),
    '-f',
    's16le',
    '-',
  ];
  const { stdout } = await execFileAsync(DSP_FFMPEG_BINARY, args, {
    windowsHide: true,
    timeout: Math.max(45 * 1000, DSP_JOB_TIMEOUT_MS),
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

async function detectTrackTempoBpm(trackFile, absolutePath, trackStat) {
  const normalizedTrackFile = normalizeTempoCacheTrackKey(trackFile);
  if (!normalizedTrackFile) return null;
  if (!trackStat || !Number.isFinite(trackStat.mtimeMs) || !Number.isFinite(trackStat.size)) return null;

  const cached = dspTempoCache.get(normalizedTrackFile);
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

  let bpm = await probeTrackTempoBpmFromMetadata(absolutePath);
  let source = 'metadata';

  if (!bpm) {
    try {
      const rawPcm = await decodeTrackPcmForTempoAnalysis(absolutePath);
      bpm = estimateTempoBpmFromPcmBuffer(rawPcm, DSP_TEMPO_SAMPLE_RATE, DSP_TEMPO_MIN_BPM, DSP_TEMPO_MAX_BPM);
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

  dspTempoCache.set(normalizedTrackFile, {
    bpm: normalizedBpm,
    mtimeMs: trackStat.mtimeMs,
    size: trackStat.size,
    source,
    updatedAt: Date.now(),
  });
  persistDspTempoCache();

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
}) {
  const safeInputLabel = typeof inputLabel === 'string' && inputLabel ? inputLabel : '1:a';
  const safeOutputLabel = typeof outputLabel === 'string' && outputLabel ? outputLabel : 'a1';
  const safeTrimStart = Number.isFinite(trimStartSeconds) ? Math.max(0, trimStartSeconds) : 0;
  const safeTrimEnd = Number.isFinite(trimEndSeconds) ? Math.max(safeTrimStart + 0.05, trimEndSeconds) : safeTrimStart + 0.05;
  const tempoValue = Number.isFinite(tempoRatio) && tempoRatio > 0 ? tempoRatio : 1;
  const baseChain =
    `[${safeInputLabel}]atrim=start=${formatFfmpegFilterNumber(safeTrimStart)}:end=${formatFfmpegFilterNumber(safeTrimEnd)},` +
    `asetpts=PTS-STARTPTS`;

  if (Math.abs(tempoValue - 1) < DSP_TEMPO_MIN_DELTA_RATIO) {
    return {
      filter: `${baseChain}[${safeOutputLabel}]`,
      glideApplied: false,
      glideSegments: null,
      glideStartRatio: 1,
      glideEndRatio: 1,
    };
  }

  const safeGlideSegments = Math.max(2, Math.min(12, DSP_TEMPO_GLIDE_SEGMENTS));
  const sourceDurationSeconds = Math.max(0, safeTrimEnd - safeTrimStart);
  const ratioStart = tempoValue;
  const ratioEnd = 1;

  // Keep an untouched anchor tail so transition end matches the original track timing.
  const maxAnchorByDuration = Math.max(0, sourceDurationSeconds - 0.08);
  const anchorSeconds = Math.max(0, Math.min(DSP_TEMPO_GLIDE_ANCHOR_SECONDS, maxAnchorByDuration));
  const hasAnchorTail = anchorSeconds >= 0.06;
  const glideSourceStart = safeTrimStart;
  const glideSourceEnd = hasAnchorTail ? safeTrimEnd - anchorSeconds : safeTrimEnd;
  const glideDurationSeconds = Math.max(0, glideSourceEnd - glideSourceStart);
  const minSegmentSeconds = 0.35;
  const maxSegmentsByDuration = Math.max(1, Math.floor(glideDurationSeconds / minSegmentSeconds));
  const glideSegments = Math.max(2, Math.min(safeGlideSegments, maxSegmentsByDuration));
  const canApplyGlide =
    DSP_TEMPO_GLIDE_ENABLED &&
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
    const needsRubberband = Math.abs(segmentRatio - 1) >= DSP_TEMPO_MIN_DELTA_RATIO;
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
}) {
  const normalizedTrackFile = normalizeAudioRelativePath(trackFile || '');
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
}) {
  const safeSliceSeconds = Number.isFinite(sliceSeconds) && sliceSeconds > 0 ? sliceSeconds : null;
  if (!safeSliceSeconds) return 0;
  const safeThresholdDb = Number.isFinite(silenceThresholdDb) ? silenceThresholdDb : DSP_TRIM_SILENCE_THRESHOLD_DB;
  const safeMinSilence = Number.isFinite(minSilenceSeconds) ? minSilenceSeconds : DSP_TRIM_MIN_SILENCE_SECONDS;
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
    const { stderr } = await execFileAsync(DSP_FFMPEG_BINARY, args, {
      windowsHide: true,
      timeout: Math.min(DSP_JOB_TIMEOUT_MS, 35 * 1000),
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
}) {
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
  });

  let rawSeconds = 0;
  let source = 'analysis';

  if (cacheKey && dspSilenceTrimCache.has(cacheKey)) {
    const cachedValue = Number(dspSilenceTrimCache.get(cacheKey));
    rawSeconds = Number.isFinite(cachedValue) ? Math.max(0, cachedValue) : 0;
    source = 'cache';
  } else {
    rawSeconds = await detectSegmentSilenceSeconds({
      absolutePath,
      mode,
      sliceSeconds,
      silenceThresholdDb,
      minSilenceSeconds,
    });
    if (cacheKey) {
      dspSilenceTrimCache.set(cacheKey, rawSeconds);
      if (dspSilenceTrimCache.size > 15_000) {
        const firstKey = dspSilenceTrimCache.keys().next().value;
        if (firstKey) dspSilenceTrimCache.delete(firstKey);
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
}) {
  const safeSliceSeconds = Number.isFinite(sliceSeconds) && sliceSeconds > 0 ? sliceSeconds : null;
  if (!safeSliceSeconds) return Buffer.alloc(0);
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate >= 4000 ? Math.trunc(sampleRate) : DSP_NO_GAP_ENERGY_SAMPLE_RATE;
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
    const { stdout } = await execFileAsync(DSP_FFMPEG_BINARY, args, {
      windowsHide: true,
      timeout: Math.min(DSP_JOB_TIMEOUT_MS, 45 * 1000),
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
}) {
  if (!Buffer.isBuffer(rawPcm) || rawPcm.length < 2048) return 0;
  const safeSampleRate = Number.isFinite(sampleRate) ? sampleRate : DSP_NO_GAP_ENERGY_SAMPLE_RATE;
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
}) {
  const normalizedTrackFile = normalizeAudioRelativePath(trackFile || '');
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
}) {
  const safeMaxTrim = Number.isFinite(maxTrimSeconds) ? Math.max(0, maxTrimSeconds) : 0;
  const safeMaxAllowed = Number.isFinite(maxAllowedTrimSeconds) ? Math.max(0, maxAllowedTrimSeconds) : 0;
  if (safeMaxTrim <= 0 || safeMaxAllowed <= 0) {
    return { trimSeconds: 0, rawSeconds: 0, source: 'disabled' };
  }

  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate >= 4000
    ? Math.trunc(sampleRate)
    : DSP_NO_GAP_ENERGY_SAMPLE_RATE;
  const safeFrameMs = Number.isFinite(frameMs) ? Math.max(5, Math.min(100, frameMs)) : DSP_NO_GAP_ENERGY_FRAME_MS;
  const safeFloorRatio = Number.isFinite(floorRatio) ? Math.max(0.03, Math.min(0.95, floorRatio)) : DSP_NO_GAP_ENERGY_FLOOR_RATIO;
  const safeMeanMultiplier = Number.isFinite(meanMultiplier)
    ? Math.max(1, Math.min(6, meanMultiplier))
    : DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER;

  const cacheKey = buildDspEnergyTrimCacheKey({
    trackFile,
    trackStat,
    mode,
    sliceSeconds,
    sampleRate: safeSampleRate,
    frameMs: safeFrameMs,
    floorRatio: safeFloorRatio,
    meanMultiplier: safeMeanMultiplier,
  });

  let rawSeconds = 0;
  let source = 'analysis';

  if (cacheKey && dspEnergyTrimCache.has(cacheKey)) {
    const cachedValue = Number(dspEnergyTrimCache.get(cacheKey));
    rawSeconds = Number.isFinite(cachedValue) ? Math.max(0, cachedValue) : 0;
    source = 'cache';
  } else {
    const rawPcm = await decodeSegmentPcmForBoundaryAnalysis({
      absolutePath,
      mode,
      sliceSeconds,
      sampleRate: safeSampleRate,
    });
    rawSeconds = estimateEnergyBoundaryTrimFromPcm({
      rawPcm,
      sampleRate: safeSampleRate,
      mode,
      sliceSeconds,
      frameMs: safeFrameMs,
      floorRatio: safeFloorRatio,
      meanMultiplier: safeMeanMultiplier,
    });
    if (cacheKey) {
      dspEnergyTrimCache.set(cacheKey, rawSeconds);
      if (dspEnergyTrimCache.size > 15_000) {
        const firstKey = dspEnergyTrimCache.keys().next().value;
        if (firstKey) dspEnergyTrimCache.delete(firstKey);
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

function buildDspQueueSummary() {
  let processing = 0;
  let ready = 0;
  let failed = 0;

  for (const item of dspTransitions.values()) {
    if (item.status === DSP_STATUS_PROCESSING) processing += 1;
    if (item.status === DSP_STATUS_READY) ready += 1;
    if (item.status === DSP_STATUS_FAILED) failed += 1;
  }

  return {
    enabled: DSP_ENABLED,
    ffmpegBinary: DSP_FFMPEG_BINARY,
    ffprobeBinary: DSP_FFPROBE_BINARY,
    ffmpegAvailable: dspProbeState.available,
    ffmpegError: dspProbeState.error,
    wingetCommand: 'winget install "FFmpeg (Essentials Build)"',
    logFile: path.basename(DSP_LOG_PATH),
    transitionOutputFormat: DSP_TRANSITION_OUTPUT_FORMAT,
    transitionOutputCodec: DSP_TRANSITION_OUTPUT_CODEC,
    tempoAlignEnabled: DSP_TEMPO_ALIGN_ENABLED,
    tempoMaxAdjustPercent: DSP_TEMPO_MAX_ADJUST_PERCENT,
    tempoGlideEnabled: DSP_TEMPO_GLIDE_ENABLED,
    tempoGlideSegments: DSP_TEMPO_GLIDE_SEGMENTS,
    tempoGlideAnchorSeconds: DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
    aggressiveJoinEnabled: DSP_AGGRESSIVE_JOIN_ENABLED,
    joinIntensity: DSP_JOIN_INTENSITY,
    trimSilenceEnabled: DSP_TRIM_SILENCE_ENABLED,
    trimSilenceDb: DSP_TRIM_SILENCE_THRESHOLD_DB,
    trimMaxSeconds: DSP_TRIM_MAX_SECONDS,
    noGapGuardEnabled: DSP_NO_GAP_GUARD_ENABLED,
    trimGuardThresholdBoostDb: DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
    noGapEnergyTrimEnabled: DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    noGapEnergyFloorRatio: DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    pending: dspQueue.length,
    processing,
    ready,
    failed,
    total: dspTransitions.size,
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

function trimDspHistory() {
  if (dspTransitions.size <= DSP_HISTORY_LIMIT) return;

  const candidates = Array.from(dspTransitions.values())
    .filter((item) => item && !item.inQueue && item.status !== DSP_STATUS_PROCESSING)
    .sort((left, right) => {
      const leftUpdated = Number.isFinite(left.updatedAt) ? left.updatedAt : 0;
      const rightUpdated = Number.isFinite(right.updatedAt) ? right.updatedAt : 0;
      return leftUpdated - rightUpdated;
    });

  while (dspTransitions.size > DSP_HISTORY_LIMIT && candidates.length > 0) {
    const victim = candidates.shift();
    if (!victim || !victim.id) continue;
    dspTransitions.delete(victim.id);
  }
}

function queueDspTransition(item, priority = 'normal') {
  if (!item || typeof item !== 'object') return false;
  if (item.status === DSP_STATUS_PROCESSING || item.inQueue) return false;
  if (dspQueue.length >= DSP_MAX_QUEUE_LENGTH) return false;

  item.status = DSP_STATUS_QUEUED;
  item.inQueue = true;
  item.updatedAt = Date.now();

  if (priority === 'high') {
    dspQueue.unshift(item);
  } else {
    dspQueue.push(item);
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

async function ensureFfmpegAvailable() {
  if (!DSP_ENABLED) {
    dspProbeState.available = false;
    dspProbeState.error = 'DSP disabled';
    dspProbeState.checkedAt = Date.now();
    return false;
  }

  const now = Date.now();
  if (now - dspProbeState.checkedAt < DSP_PROBE_CACHE_MS && dspProbeState.available !== null) {
    return dspProbeState.available;
  }

  const previousAvailable = dspProbeState.available;
  const previousError = dspProbeState.error;

  try {
    await execFileAsync(DSP_FFMPEG_BINARY, ['-version'], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 512 * 1024,
    });
    dspProbeState.checkedAt = now;
    dspProbeState.available = true;
    dspProbeState.error = null;
    if (previousAvailable !== true || previousError) {
      appendDspLog('ffmpeg.ready', {
        binary: DSP_FFMPEG_BINARY,
      });
    }
    return true;
  } catch (err) {
    dspProbeState.checkedAt = now;
    dspProbeState.available = false;
    dspProbeState.error = toDspErrorMessage(err, `Не удалось запустить ${DSP_FFMPEG_BINARY}.`);
    if (previousAvailable !== false || previousError !== dspProbeState.error) {
      appendDspLog('ffmpeg.error', {
        binary: DSP_FFMPEG_BINARY,
        error: dspProbeState.error,
      });
    }
    return false;
  }
}

async function processDspTransition(item) {
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
  });

  let fromStat;
  let toStat;
  try {
    [fromStat, toStat] = await Promise.all([
      fs.promises.stat(item.fromAbsolutePath),
      fs.promises.stat(item.toAbsolutePath),
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
    });
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
    });
    return;
  }

  const sourceMtimeMs = Math.max(fromStat.mtimeMs, toStat.mtimeMs);
  try {
    const outputStat = await fs.promises.stat(item.outputPath);
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
      });
      return;
    }
  } catch (err) {
    // cache miss
  }

  const ffmpegAvailable = await ensureFfmpegAvailable();
  if (!ffmpegAvailable) {
    markDspTransitionFailed(item, dspProbeState.error || 'ffmpeg недоступен.');
    appendDspLog('transition.failed', {
      id: item.id,
      from: item.fromFile,
      to: item.toFile,
      source: item.source || 'unknown',
      elapsedMs: Date.now() - startedAt,
      error: item.error,
    });
    return;
  }

  try {
    await fs.promises.mkdir(DSP_TRANSITIONS_DIR, { recursive: true });
  } catch (err) {
    markDspTransitionFailed(item, 'Не удалось создать каталог DSP-кэша.');
    appendDspLog('transition.failed', {
      id: item.id,
      from: item.fromFile,
      to: item.toFile,
      source: item.source || 'unknown',
      elapsedMs: Date.now() - startedAt,
      error: item.error,
    });
    return;
  }

  const tempoAlignment = {
    enabled: DSP_TEMPO_ALIGN_ENABLED,
    applied: false,
    ratio: 1,
    fromBpm: null,
    toBpm: null,
    fromSource: null,
    toSource: null,
    glideEnabled: DSP_TEMPO_GLIDE_ENABLED,
    glideApplied: false,
    glideSegments: null,
    glideStartRatio: null,
    glideEndRatio: 1,
    reason: DSP_TEMPO_ALIGN_ENABLED ? 'pending' : 'disabled',
  };

  if (DSP_TEMPO_ALIGN_ENABLED) {
    try {
      const [fromTempoInfo, toTempoInfo] = await Promise.all([
        detectTrackTempoBpm(item.fromFile, item.fromAbsolutePath, fromStat),
        detectTrackTempoBpm(item.toFile, item.toAbsolutePath, toStat),
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
          const clampedRatio = Math.max(DSP_TEMPO_MIN_RATIO, Math.min(DSP_TEMPO_MAX_RATIO, rawRatio));
          const normalizedRatio = Math.round(clampedRatio * 10000) / 10000;
          tempoAlignment.ratio = normalizedRatio;

          if (Math.abs(normalizedRatio - 1) >= DSP_TEMPO_MIN_DELTA_RATIO) {
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
    enabled: DSP_AGGRESSIVE_JOIN_ENABLED,
    applied: false,
    intensity: DSP_JOIN_INTENSITY,
    effectiveTransitionSeconds: item.transitionSeconds,
    sourceTailTrimSeconds: 0,
    targetHeadTrimSeconds: 0,
    sourceTrimSource: 'disabled',
    targetTrimSource: 'disabled',
    sourceRawTailSilenceSeconds: 0,
    targetRawHeadSilenceSeconds: 0,
    curveOut: 'tri',
    curveIn: 'tri',
    noGapGuardEnabled: DSP_NO_GAP_GUARD_ENABLED,
    noGapGuardApplied: false,
    guardThresholdDb: null,
    noGapEnergyTrimEnabled: DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    noGapEnergyTrimApplied: false,
    energyFloorRatio: DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    reason: DSP_AGGRESSIVE_JOIN_ENABLED ? 'pending' : 'disabled',
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

  if (DSP_AGGRESSIVE_JOIN_ENABLED) {
    const intensityFactor = 1 - DSP_JOIN_INTENSITY * 0.45;
    const normalizedFactor = Math.max(0.35, Math.min(1, intensityFactor));
    const minTransitionFloor = Math.min(DSP_JOIN_MIN_TRANSITION_SECONDS, item.transitionSeconds);
    const scaledTransition = Math.round(item.transitionSeconds * normalizedFactor * 1000) / 1000;
    effectiveTransitionSeconds = Math.max(
      minTransitionFloor,
      Math.min(item.transitionSeconds, scaledTransition),
    );
    // Keep crossfade energy stable to avoid perceived "holes" at the splice point.
    crossfadeCurveOut = DSP_JOIN_INTENSITY >= 0.55 ? 'qsin' : 'tri';
    crossfadeCurveIn = DSP_JOIN_INTENSITY >= 0.55 ? 'qsin' : 'tri';

    if (DSP_TRIM_SILENCE_ENABLED) {
      const minSliceOutSeconds = effectiveTransitionSeconds + 0.2;
      const maxSourceTailTrimByLength = Math.max(0, item.sliceSeconds - minSliceOutSeconds);
      const shortestTargetTempoRatio = tempoAlignment.applied
        ? (DSP_TEMPO_GLIDE_ENABLED ? Math.max(1, tempoRatio) : tempoRatio)
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
          silenceThresholdDb: DSP_TRIM_SILENCE_THRESHOLD_DB,
          minSilenceSeconds: DSP_TRIM_MIN_SILENCE_SECONDS,
          maxTrimSeconds: DSP_TRIM_MAX_SECONDS,
          maxAllowedTrimSeconds: maxSourceTailTrimByLength,
        }),
        computeDspTrimSeconds({
          trackFile: item.toFile,
          absolutePath: item.toAbsolutePath,
          trackStat: toStat,
          mode: 'head',
          sliceSeconds: item.sliceSeconds,
          silenceThresholdDb: DSP_TRIM_SILENCE_THRESHOLD_DB,
          minSilenceSeconds: DSP_TRIM_MIN_SILENCE_SECONDS,
          maxTrimSeconds: DSP_TRIM_MAX_SECONDS,
          maxAllowedTrimSeconds: maxTargetHeadTrimByLength,
        }),
      ]);

      sourceTailTrimSeconds = sourceTrimResult.trimSeconds;
      targetHeadTrimSeconds = targetTrimResult.trimSeconds;
      sourceTrimSource = sourceTrimResult.source;
      targetTrimSource = targetTrimResult.source;
      sourceRawTailSilenceSeconds = sourceTrimResult.rawSeconds;
      targetRawHeadSilenceSeconds = targetTrimResult.rawSeconds;

      if (DSP_NO_GAP_GUARD_ENABLED) {
        // Guard pass: lift silence threshold and remove trim cap to avoid dead-air between beat anchors.
        const boostedThresholdDb = Math.min(
          -8,
          DSP_TRIM_SILENCE_THRESHOLD_DB + DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
        );
        guardThresholdDb = Math.max(DSP_TRIM_SILENCE_THRESHOLD_DB, boostedThresholdDb);
        const guardMinSilenceSeconds = Math.max(
          0.03,
          Math.min(DSP_TRIM_MIN_SILENCE_SECONDS, DSP_TRIM_MIN_SILENCE_SECONDS * 0.7),
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
          }),
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
          }),
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

      if (DSP_NO_GAP_ENERGY_TRIM_ENABLED) {
        const [sourceEnergyTrimResult, targetEnergyTrimResult] = await Promise.all([
          computeDspEnergyTrimSeconds({
            trackFile: item.fromFile,
            absolutePath: item.fromAbsolutePath,
            trackStat: fromStat,
            mode: 'tail',
            sliceSeconds: item.sliceSeconds,
            sampleRate: DSP_NO_GAP_ENERGY_SAMPLE_RATE,
            frameMs: DSP_NO_GAP_ENERGY_FRAME_MS,
            floorRatio: DSP_NO_GAP_ENERGY_FLOOR_RATIO,
            meanMultiplier: DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
            maxTrimSeconds: maxSourceTailTrimByLength,
            maxAllowedTrimSeconds: maxSourceTailTrimByLength,
          }),
          computeDspEnergyTrimSeconds({
            trackFile: item.toFile,
            absolutePath: item.toAbsolutePath,
            trackStat: toStat,
            mode: 'head',
            sliceSeconds: item.sliceSeconds,
            sampleRate: DSP_NO_GAP_ENERGY_SAMPLE_RATE,
            frameMs: DSP_NO_GAP_ENERGY_FRAME_MS,
            floorRatio: DSP_NO_GAP_ENERGY_FLOOR_RATIO,
            meanMultiplier: DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
            maxTrimSeconds: maxTargetHeadTrimByLength,
            maxAllowedTrimSeconds: maxTargetHeadTrimByLength,
          }),
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

  const tempOutputPath = `${item.outputPath}.${Date.now()}.tmp.${DSP_TRANSITION_OUTPUT_FORMAT}`;
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
  });

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
    ...buildDspOutputEncodingArgs(),
    tempOutputPath,
  ];

  try {
    await execFileAsync(DSP_FFMPEG_BINARY, args, {
      windowsHide: true,
      timeout: DSP_JOB_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    await fs.promises.rename(tempOutputPath, item.outputPath);
    const outputStat = await fs.promises.stat(item.outputPath);
    if (!outputStat.isFile() || outputStat.size < 1) {
      markDspTransitionFailed(item, 'DSP output file is empty.');
      appendDspLog('transition.failed', {
        id: item.id,
        from: item.fromFile,
        to: item.toFile,
        source: item.source || 'unknown',
        elapsedMs: Date.now() - startedAt,
        error: item.error,
      });
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
    });
  } catch (err) {
    try {
      await fs.promises.unlink(tempOutputPath);
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
    });
  }
}

async function processDspQueue() {
  if (dspWorkerRunning) return;
  dspWorkerRunning = true;

  try {
    while (dspQueue.length > 0) {
      const next = dspQueue.shift();
      if (!next || typeof next !== 'object') continue;
      await processDspTransition(next);
    }
  } finally {
    dspWorkerRunning = false;
    dspWorkerScheduled = false;
    trimDspHistory();
    if (dspQueue.length > 0) {
      scheduleDspWorker();
    }
  }
}

function scheduleDspWorker() {
  if (!DSP_ENABLED) return;
  if (dspWorkerScheduled || dspWorkerRunning) return;
  dspWorkerScheduled = true;
  setImmediate(() => {
    processDspQueue().catch((err) => {
      console.error('DSP queue worker failed', err);
      dspWorkerRunning = false;
      dspWorkerScheduled = false;
    });
  });
}

function enqueueDspTransition(fromFile, toFile, options = {}) {
  const descriptor = buildDspTransitionDescriptor(fromFile, toFile, options);
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
  const existing = dspTransitions.get(descriptor.id);
  const force = Boolean(options.force);
  const priority = options.priority === 'high' ? 'high' : 'normal';
  const sourceLabel = typeof options.source === 'string' && options.source ? options.source.slice(0, 64) : 'api';

  if (existing) {
    existing.lastRequestedAt = now;
    existing.source = sourceLabel;

    if (force && existing.status !== DSP_STATUS_PROCESSING) {
      existing.error = null;
      existing.status = DSP_STATUS_QUEUED;
      const enqueued = queueDspTransition(existing, priority);
      if (enqueued) {
        scheduleDspWorker();
      } else if (dspQueue.length >= DSP_MAX_QUEUE_LENGTH) {
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
      });

      return {
        ok: true,
        created: false,
        enqueued,
        error: enqueued ? null : existing.error || 'Не удалось поставить задачу в очередь.',
        item: existing,
      };
    }

    if (existing.status === DSP_STATUS_READY && !fs.existsSync(existing.outputPath)) {
      const enqueued = queueDspTransition(existing, priority);
      if (enqueued) scheduleDspWorker();
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
      });
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
    });

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

  dspTransitions.set(item.id, item);
  const enqueued = queueDspTransition(item, priority);
  if (enqueued) {
    scheduleDspWorker();
  } else if (dspQueue.length >= DSP_MAX_QUEUE_LENGTH) {
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
  });
  trimDspHistory();

  return {
    ok: true,
    created: true,
    enqueued,
    error: enqueued ? null : item.error || 'Не удалось поставить задачу в очередь.',
    item,
  };
}

function collectAdjacentLayoutTransitions(layout, playlistDspFlags = null) {
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

      const fromFile = normalizeAudioRelativePath(fromRaw);
      const toFile = normalizeAudioRelativePath(toRaw);
      if (!fromFile || !toFile) continue;

      const dedupeKey = `${fromFile}\n${toFile}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      transitions.push({ fromFile, toFile });
    }
  });

  return transitions;
}

function scheduleDspTransitionsFromLayout(layout, options = {}) {
  const transitions = collectAdjacentLayoutTransitions(layout, options.playlistDspFlags);
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
    });
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

function getDspTransitionByPair(fromFile, toFile, options = {}) {
  const descriptor = buildDspTransitionDescriptor(fromFile, toFile, options);
  if (descriptor.error) {
    return { ok: false, error: descriptor.error, item: null, descriptor: null };
  }

  const existing = dspTransitions.get(descriptor.id);
  if (!existing) {
    return { ok: true, error: null, item: null, descriptor };
  }

  return { ok: true, error: null, item: existing, descriptor };
}

async function handleApiDspTransitionsGet(req, res, requestUrl) {
  if (DSP_ENABLED) {
    await ensureFfmpegAvailable();
  }

  const fromFile = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get('from') : null;
  const toFile = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get('to') : null;
  const limitRaw = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get('limit') : null;
  const limitParsed = Number.parseInt(limitRaw, 10);
  const limit = Number.isInteger(limitParsed) ? Math.max(1, Math.min(limitParsed, 500)) : 100;

  if ((fromFile && !toFile) || (!fromFile && toFile)) {
    sendJson(res, 400, { error: 'Параметры from и to нужно передавать вместе.' });
    return;
  }

  if (fromFile && toFile) {
    const lookup = getDspTransitionByPair(fromFile, toFile, {});
    if (!lookup.ok) {
      sendJson(res, 400, { error: lookup.error || 'Некорректный запрос transition.' });
      return;
    }

    let inferredReadyTransition = null;
    if (!lookup.item && lookup.descriptor && fs.existsSync(lookup.descriptor.outputPath)) {
      inferredReadyTransition = {
        id: lookup.descriptor.id,
        fromFile: lookup.descriptor.fromFile,
        toFile: lookup.descriptor.toFile,
        status: DSP_STATUS_READY,
        transitionSeconds: lookup.descriptor.transitionSeconds,
        sliceSeconds: lookup.descriptor.sliceSeconds,
        attempts: 0,
        error: null,
        outputUrl: buildDspTransitionOutputUrl(lookup.descriptor.id),
        outputFileName: lookup.descriptor.outputFileName,
        outputSizeBytes: null,
        sourceMtimeMs: null,
        createdAt: null,
        updatedAt: null,
        lastRequestedAt: null,
      };
    }

    const transition =
      lookup.item ||
      inferredReadyTransition ||
      (lookup.descriptor
        ? {
            id: lookup.descriptor.id,
            fromFile: lookup.descriptor.fromFile,
            toFile: lookup.descriptor.toFile,
            status: 'missing',
            transitionSeconds: lookup.descriptor.transitionSeconds,
            sliceSeconds: lookup.descriptor.sliceSeconds,
            attempts: 0,
            error: null,
            outputUrl: null,
            outputFileName: null,
            outputSizeBytes: null,
            sourceMtimeMs: null,
            createdAt: null,
            updatedAt: null,
            lastRequestedAt: null,
          }
        : null);

    sendJson(res, 200, {
      transition: lookup.item ? serializeDspTransition(lookup.item) : transition,
      queue: buildDspQueueSummary(),
    });
    return;
  }

  const transitions = Array.from(dspTransitions.values())
    .sort((left, right) => {
      const leftUpdated = Number.isFinite(left.updatedAt) ? left.updatedAt : 0;
      const rightUpdated = Number.isFinite(right.updatedAt) ? right.updatedAt : 0;
      return rightUpdated - leftUpdated;
    })
    .slice(0, limit)
    .map((item) => serializeDspTransition(item))
    .filter(Boolean);

  sendJson(res, 200, {
    transitions,
    queue: buildDspQueueSummary(),
  });
}

async function handleApiDspTransitionsPost(req, res) {
  const auth = getAuthState(req);
  if (!auth.isServer) {
    sendJson(res, 403, { error: 'Только хост может запускать DSP-подготовку.' });
    return;
  }
  if (!DSP_ENABLED) {
    sendJson(res, 503, { error: 'DSP отключен в extra.conf (dsp_enabled=false).' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, DSP_BODY_LIMIT_BYTES);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const force = Boolean(body.force);
  const transitionSeconds = body.transitionSeconds;
  const sliceSeconds = body.sliceSeconds;
  const priority = body.priority === 'high' ? 'high' : 'normal';
  const sourceLabel = typeof body.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 64) : 'api';
  const requestTransitions = [];

  if (typeof body.from === 'string' || typeof body.to === 'string') {
    if (typeof body.from !== 'string' || typeof body.to !== 'string') {
      sendJson(res, 400, { error: 'Для одиночного transition нужны оба поля: from и to.' });
      return;
    }
    requestTransitions.push({ fromFile: body.from, toFile: body.to });
  }

  if (Array.isArray(body.transitions)) {
    for (const entry of body.transitions) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.from !== 'string' || typeof entry.to !== 'string') continue;
      requestTransitions.push({ fromFile: entry.from, toFile: entry.to });
      if (requestTransitions.length >= 2000) break;
    }
  }

  const includeLayout = Boolean(body.fromLayout) || requestTransitions.length === 0;
  if (includeLayout) {
    const layoutTransitions = collectAdjacentLayoutTransitions(sharedLayoutState.layout, sharedLayoutState.playlistDsp);
    layoutTransitions.forEach((entry) => requestTransitions.push(entry));
  }

  if (!requestTransitions.length) {
    sendJson(res, 400, { error: 'Не переданы transition-пары для обработки.' });
    return;
  }

  const dedupe = new Set();
  const accepted = [];
  requestTransitions.forEach((entry) => {
    const fromFile = typeof entry.fromFile === 'string' ? entry.fromFile.trim() : '';
    const toFile = typeof entry.toFile === 'string' ? entry.toFile.trim() : '';
    if (!fromFile || !toFile) return;
    const key = `${fromFile}\n${toFile}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    accepted.push({ fromFile, toFile });
  });

  let created = 0;
  let enqueued = 0;
  let failed = 0;
  const transitions = [];

  accepted.forEach((entry) => {
    const result = enqueueDspTransition(entry.fromFile, entry.toFile, {
      force,
      transitionSeconds,
      sliceSeconds,
      source: sourceLabel,
      priority,
    });
    if (!result.ok || !result.item) {
      failed += 1;
      return;
    }
    if (result.created) created += 1;
    if (result.enqueued) enqueued += 1;
    transitions.push(serializeDspTransition(result.item));
  });

  sendJson(res, 200, {
    request: {
      totalPairs: requestTransitions.length,
      uniquePairs: accepted.length,
      force,
      priority,
      source: sourceLabel,
      fromLayout: includeLayout,
    },
    summary: {
      created,
      enqueued,
      failed,
    },
    queue: buildDspQueueSummary(),
    transitions: transitions.slice(0, 200),
  });
  appendDspLog('transition.request', {
    source: sourceLabel,
    force,
    priority,
    fromLayout: includeLayout,
    totalPairs: requestTransitions.length,
    uniquePairs: accepted.length,
    created,
    enqueued,
    failed,
  });
}

function handleApiDspTransitionFile(req, res, pathname) {
  const prefix = '/api/dsp/transitions/file/';
  const id = pathname.startsWith(prefix) ? pathname.slice(prefix.length).trim() : '';
  if (!/^[a-f0-9]{40}$/.test(id)) {
    sendJson(res, 400, { error: 'Некорректный transition id' });
    return;
  }

  const filePath = resolveDspTransitionOutputPathById(id);
  if (!filePath) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  serveAudioWithRange(req, res, filePath, getContentType(filePath));
}

function serveFile(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stat.size,
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveAudioWithRange(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const total = stat.size;
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;

    // No Range: serve the entire file.
    if (!range) {
      const headers = {
        'Content-Type': contentType,
        'Content-Length': total,
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
      }

      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Range: bytes=start-end
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }

    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }

    end = Math.min(end, total - 1);

    const chunkSize = end - start + 1;

    const headers = {
      'Content-Type': contentType,
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${start}-${end}/${total}`,
    };

    if (req.method === 'HEAD') {
      res.writeHead(206, headers);
      res.end();
      return;
    }

    res.writeHead(206, headers);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  });
}

function normalizeAudioRelativePath(relativePath) {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function stripFileExtension(fileName) {
  if (typeof fileName !== 'string') return '';
  const extension = path.extname(fileName);
  if (!extension) return fileName;
  return fileName.slice(0, -extension.length);
}

function sanitizeAudioAttributeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function decodeUtf16Be(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return '';
  const evenLength = buffer.length - (buffer.length % 2);
  if (evenLength <= 0) return '';

  const swapped = Buffer.allocUnsafe(evenLength);
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = buffer[index + 1];
    swapped[index + 1] = buffer[index];
  }
  return swapped.toString('utf16le');
}

function decodeId3TextFrame(frameData) {
  if (!Buffer.isBuffer(frameData) || frameData.length <= 1) return '';

  const encoding = frameData[0];
  const payload = frameData.subarray(1);
  let decoded = '';

  switch (encoding) {
    case 0:
      decoded = payload.toString('latin1');
      break;
    case 1:
      if (payload.length >= 2 && payload[0] === 0xfe && payload[1] === 0xff) {
        decoded = decodeUtf16Be(payload.subarray(2));
      } else if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe) {
        decoded = payload.subarray(2).toString('utf16le');
      } else {
        decoded = payload.toString('utf16le');
      }
      break;
    case 2:
      decoded = decodeUtf16Be(payload);
      break;
    case 3:
      decoded = payload.toString('utf8');
      break;
    default:
      decoded = payload.toString('utf8');
      break;
  }

  const firstToken = decoded
    .split(/\u0000+/)
    .map((part) => sanitizeAudioAttributeText(part))
    .find(Boolean);
  return firstToken || sanitizeAudioAttributeText(decoded);
}

function readSynchsafeInt(buffer, offset) {
  if (!Buffer.isBuffer(buffer) || offset < 0 || offset + 4 > buffer.length) return 0;
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

function parseId3v2Attributes(buffer) {
  const empty = { title: '', artist: '' };
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return empty;
  if (buffer.toString('latin1', 0, 3) !== 'ID3') return empty;

  const versionMajor = buffer[3];
  const flags = buffer[5];
  const hasFooter = (flags & 0x10) === 0x10;
  const declaredTagSize = readSynchsafeInt(buffer, 6);
  const maxTagSize = buffer.length - 10;
  const tagBodySize = Math.max(0, Math.min(declaredTagSize, maxTagSize));
  const totalTagBytes = 10 + tagBodySize + (hasFooter ? 10 : 0);
  const maxOffset = Math.min(totalTagBytes, buffer.length);

  let cursor = 10;
  let title = '';
  let artist = '';

  while (cursor + 10 <= maxOffset) {
    if (
      buffer[cursor] === 0 &&
      buffer[cursor + 1] === 0 &&
      buffer[cursor + 2] === 0 &&
      buffer[cursor + 3] === 0
    ) {
      break;
    }

    const frameId = buffer.toString('latin1', cursor, cursor + 4);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) {
      break;
    }

    const frameSize = versionMajor === 4 ? readSynchsafeInt(buffer, cursor + 4) : buffer.readUInt32BE(cursor + 4);
    if (!Number.isFinite(frameSize) || frameSize <= 0) {
      cursor += 10;
      continue;
    }

    const frameStart = cursor + 10;
    const frameEnd = frameStart + frameSize;
    if (frameEnd > maxOffset || frameStart >= frameEnd) {
      break;
    }

    const frameData = buffer.subarray(frameStart, frameEnd);
    if (frameId === 'TIT2' && !title) {
      title = decodeId3TextFrame(frameData);
    } else if (frameId === 'TPE1' && !artist) {
      artist = decodeId3TextFrame(frameData);
    }

    if (title && artist) {
      break;
    }

    cursor = frameEnd;
  }

  return {
    title: sanitizeAudioAttributeText(title),
    artist: sanitizeAudioAttributeText(artist),
  };
}

function parseId3v1Attributes(buffer) {
  const empty = { title: '', artist: '' };
  if (!Buffer.isBuffer(buffer) || buffer.length < 128) return empty;
  if (buffer.toString('latin1', 0, 3) !== 'TAG') return empty;

  return {
    title: sanitizeAudioAttributeText(buffer.toString('latin1', 3, 33)),
    artist: sanitizeAudioAttributeText(buffer.toString('latin1', 33, 63)),
  };
}

async function readFileSlice(filePath, start, length) {
  const safeLength = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  if (safeLength <= 0) return Buffer.alloc(0);

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(safeLength);
    const safeStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
    const { bytesRead } = await handle.read(buffer, 0, safeLength, safeStart);
    return bytesRead === safeLength ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function extractAudioAttributes(filePath, stat) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.mp3') {
    return { title: '', artist: '' };
  }

  const size = Number.isFinite(stat && stat.size) ? Math.max(0, stat.size) : 0;
  let result = { title: '', artist: '' };

  if (size > 0) {
    const headLength = Math.min(size, AUDIO_TAG_SCAN_BYTES);
    const head = await readFileSlice(filePath, 0, headLength);
    result = parseId3v2Attributes(head);
  }

  if ((!result.title || !result.artist) && size >= 128) {
    const tail = await readFileSlice(filePath, size - 128, 128);
    const id3v1 = parseId3v1Attributes(tail);
    if (!result.title && id3v1.title) {
      result.title = id3v1.title;
    }
    if (!result.artist && id3v1.artist) {
      result.artist = id3v1.artist;
    }
  }

  return {
    title: sanitizeAudioAttributeText(result.title),
    artist: sanitizeAudioAttributeText(result.artist),
  };
}

function buildAudioAttributeDisplayName(attributes, fallbackName) {
  const title = sanitizeAudioAttributeText(attributes && attributes.title);
  const artist = sanitizeAudioAttributeText(attributes && attributes.artist);
  if (title && artist) return `${artist} - ${title}`;
  return title || artist || fallbackName;
}

async function getAudioAttributesCached(relativeFile, absoluteFile, stat) {
  const normalizedRelative = normalizeAudioRelativePath(relativeFile || '');
  if (!normalizedRelative) {
    return { title: '', artist: '' };
  }

  const fileStat = stat || (await fs.promises.stat(absoluteFile));
  const cached = audioAttributesCache.get(normalizedRelative);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.attributes;
  }

  const attributes = await extractAudioAttributes(absoluteFile, fileStat);
  audioAttributesCache.set(normalizedRelative, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    attributes,
  });

  return attributes;
}

async function collectAudioCatalog() {
  const files = [];
  const folders = [];

  const walk = async (absoluteDir, relativeDir = '') => {
    let entries;
    try {
      entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    const sortedEntries = entries.slice().sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    const folderFiles = [];
    const childFolders = [];

    for (const entry of sortedEntries) {
      if (entry.name.startsWith('.')) continue;

      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const normalizedChildRelative = normalizeAudioRelativePath(childRelative);

      if (entry.isDirectory()) {
        childFolders.push({ absolute: path.join(absoluteDir, entry.name), relative: normalizedChildRelative });
        continue;
      }

      if (!entry.isFile() || !isAudioFile(entry.name)) continue;
      files.push(normalizedChildRelative);
      if (relativeDir) {
        folderFiles.push(normalizedChildRelative);
      }
    }

    if (relativeDir && folderFiles.length) {
      const normalizedKey = normalizeAudioRelativePath(relativeDir);
      const folderName = path.basename(normalizedKey) || normalizedKey;
      folders.push({
        key: normalizedKey,
        name: folderName,
        files: folderFiles,
      });
    }

    for (const childFolder of childFolders) {
      await walk(childFolder.absolute, childFolder.relative);
    }
  };

  await walk(AUDIO_DIR_RESOLVED, '');

  return {
    files,
    folders: folders.sort((left, right) => left.key.localeCompare(right.key, 'ru')),
  };
}

async function handleApiAudio(req, res) {
  try {
    const catalog = await collectAudioCatalog();
    sendJson(res, 200, catalog);
  } catch (err) {
    console.error('Failed to read audio directory', err);
    sendJson(res, 500, { error: 'Failed to read audio directory' });
  }
}

async function handleApiAudioAttributes(req, res, requestUrl) {
  const rawFile = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get('file') : null;
  if (typeof rawFile !== 'string') {
    sendJson(res, 400, { error: 'Нужен параметр file' });
    return;
  }

  const normalizedFile = normalizeAudioRelativePath(rawFile.trim());
  if (!normalizedFile) {
    sendJson(res, 400, { error: 'Неверное имя файла' });
    return;
  }

  const absoluteFilePath = safeResolve(AUDIO_DIR_RESOLVED, normalizedFile);
  if (!absoluteFilePath) {
    sendJson(res, 400, { error: 'Неверный путь к файлу' });
    return;
  }

  if (!isAudioFile(absoluteFilePath)) {
    sendJson(res, 400, { error: 'Неверный тип файла' });
    return;
  }

  let fileStat;
  try {
    fileStat = await fs.promises.stat(absoluteFilePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      sendJson(res, 404, { error: 'Файл не найден' });
      return;
    }
    console.error('Failed to read file stats', err);
    sendJson(res, 500, { error: 'Не удалось прочитать файл' });
    return;
  }

  if (!fileStat.isFile()) {
    sendJson(res, 404, { error: 'Файл не найден' });
    return;
  }

  try {
    const attributes = await getAudioAttributesCached(normalizedFile, absoluteFilePath, fileStat);
    const fallbackName = stripFileExtension(path.basename(normalizedFile));
    const displayName = buildAudioAttributeDisplayName(attributes, fallbackName);

    sendJson(res, 200, {
      file: normalizedFile,
      title: attributes.title || null,
      artist: attributes.artist || null,
      displayName,
    });
  } catch (err) {
    console.error('Failed to extract audio attributes', err);
    sendJson(res, 500, { error: 'Не удалось прочитать атрибуты трека' });
  }
}

function handleApiVersion(req, res) {
  sendJson(res, 200, { version: appVersion });
}

function handleApiConfig(req, res) {
  const values = {
    port: PORT,
    allowContextMenu: ALLOW_CONTEXT_MENU,
    volumePresets: serializeVolumePresetPercentValues(LIVE_VOLUME_PRESET_VALUES),
    dspEntryCompensationMs: LIVE_DSP_ENTRY_COMPENSATION_MS,
    dspExitCompensationMs: LIVE_DSP_EXIT_COMPENSATION_MS,
  };

  sendJson(res, 200, {
    ...values,
    values,
    schema: RUNTIME_CONFIG_SCHEMA,
  });
}

function handleApiLayoutGet(req, res) {
  sendJson(res, 200, buildLayoutPayload(null));
}

function handleApiLayoutReset(req, res) {
  const auth = requireHostRequest(req, res);
  if (!auth) return;

  sharedLayoutState = {
    ...getDefaultLayoutState(),
    version: sharedLayoutState.version + 1,
    updatedAt: Date.now(),
  };

  persistLayoutState(sharedLayoutState);
  broadcastLayoutUpdate(null);
  scheduleDspTransitionsFromLayout(sharedLayoutState.layout, {
    source: 'layout-update',
    priority: 'normal',
    force: false,
    playlistDspFlags: sharedLayoutState.playlistDsp,
  });

  sendJson(res, 200, buildLayoutPayload(null));
}

function handleApiPlaybackGet(req, res) {
  sendJson(res, 200, buildPlaybackPayload(null));
}

async function handleApiLayoutUpdate(req, res) {
  const auth = getAuthState(req);
  let body;
  try {
    body = await readJsonBody(req, LAYOUT_BODY_LIMIT_BYTES);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const nextLayout = sanitizeLayout(body.layout);
  if (!nextLayout) {
    sendJson(res, 400, { error: 'Неверный формат плей-листов' });
    return;
  }

  if (isDeletingLivePlaybackPlaylist(nextLayout)) {
    sendJson(res, 409, { error: 'Нельзя удалить плей-лист, который сейчас играет на лайве.' });
    return;
  }

  const nextPlaylistNames = normalizePlaylistNames(body.playlistNames, nextLayout.length);
  const nextPlaylistMeta = normalizePlaylistMeta(
    Array.isArray(body.playlistMeta) ? body.playlistMeta : sharedLayoutState.playlistMeta,
    nextLayout.length,
  );
  let nextDapConfig = auth.isServer
    ? sanitizeDapConfig(
        body && Object.prototype.hasOwnProperty.call(body, 'dapConfig') ? body.dapConfig : sharedLayoutState.dapConfig,
        nextLayout.length,
        sharedLayoutState.dapConfig,
      )
    : sanitizeDapConfig(sharedLayoutState.dapConfig, nextLayout.length, sharedLayoutState.dapConfig);
  if (!auth.isServer) {
    const currentDapIndex = normalizePlaylistTrackIndex(sharedLayoutState.dapConfig && sharedLayoutState.dapConfig.playlistIndex);
    const isCurrentDapEnabled = Boolean(sharedLayoutState.dapConfig && sharedLayoutState.dapConfig.enabled);
    const removedPlaylistIndex = detectRemovedPlaylistIndex(sharedLayoutState.layout, nextLayout);
    if (currentDapIndex !== null && removedPlaylistIndex !== null) {
      if (isCurrentDapEnabled && removedPlaylistIndex === currentDapIndex) {
        sendJson(res, 409, { error: 'Нельзя удалить плей-лист, выбранный для DAP.' });
        return;
      }

      if (removedPlaylistIndex < currentDapIndex) {
        nextDapConfig = sanitizeDapConfig(
          {
            ...sharedLayoutState.dapConfig,
            enabled: isCurrentDapEnabled,
            playlistIndex: currentDapIndex - 1,
          },
          nextLayout.length,
          sharedLayoutState.dapConfig,
        );
      }
    }
  }
  const nextPlaylistAutoplay = auth.isServer
    ? normalizePlaylistAutoplayWithDap(body.playlistAutoplay, nextDapConfig, nextLayout.length)
    : normalizePlaylistAutoplayWithDap(sharedLayoutState.playlistAutoplay, nextDapConfig, nextLayout.length);
  const nextPlaylistDsp = auth.isServer
    ? normalizePlaylistDspFlags(
        body && Object.prototype.hasOwnProperty.call(body, 'playlistDsp')
          ? body.playlistDsp
          : sharedLayoutState.playlistDsp,
        nextPlaylistAutoplay,
        nextLayout.length,
      )
    : normalizePlaylistDspFlags(sharedLayoutState.playlistDsp, nextPlaylistAutoplay, nextLayout.length);
  const nextTrackTitleModesByTrack = sanitizeTrackTitleModesByTrack(
    body && Object.prototype.hasOwnProperty.call(body, 'trackTitleModesByTrack')
      ? body.trackTitleModesByTrack
      : sharedLayoutState.trackTitleModesByTrack,
  );

  const sourceClientId = sanitizeClientId(body.clientId);
  const hasChanged =
    JSON.stringify(nextLayout) !== JSON.stringify(sharedLayoutState.layout) ||
    JSON.stringify(nextPlaylistNames) !== JSON.stringify(sharedLayoutState.playlistNames) ||
    JSON.stringify(nextPlaylistMeta) !== JSON.stringify(sharedLayoutState.playlistMeta) ||
    JSON.stringify(nextPlaylistAutoplay) !== JSON.stringify(sharedLayoutState.playlistAutoplay) ||
    JSON.stringify(nextPlaylistDsp) !== JSON.stringify(sharedLayoutState.playlistDsp) ||
    JSON.stringify(nextDapConfig) !== JSON.stringify(sharedLayoutState.dapConfig) ||
    JSON.stringify(nextTrackTitleModesByTrack) !== JSON.stringify(sharedLayoutState.trackTitleModesByTrack);

  if (hasChanged) {
    sharedLayoutState = {
      layout: nextLayout,
      playlistNames: nextPlaylistNames,
      playlistMeta: nextPlaylistMeta,
      playlistAutoplay: nextPlaylistAutoplay,
      playlistDsp: nextPlaylistDsp,
      dapConfig: nextDapConfig,
      trackTitleModesByTrack: nextTrackTitleModesByTrack,
      version: sharedLayoutState.version + 1,
      updatedAt: Date.now(),
    };
    persistLayoutState(sharedLayoutState);
    broadcastLayoutUpdate(sourceClientId);
    scheduleDspTransitionsFromLayout(sharedLayoutState.layout, {
      source: 'layout-update',
      priority: 'normal',
      force: false,
      playlistDspFlags: sharedLayoutState.playlistDsp,
    });
  }

  sendJson(res, 200, buildLayoutPayload(sourceClientId));
}

async function handleApiPlaybackUpdate(req, res) {
  const auth = getAuthState(req);
  if (!auth.isServer) {
    sendJson(res, 403, { error: 'Только хост может обновлять состояние воспроизведения' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, PLAYBACK_BODY_LIMIT_BYTES);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const nextState = sanitizePlaybackState(body);
  const sourceClientId = sanitizeClientId(body.clientId);
  const hasChanged = serializePlaybackState(nextState) !== serializePlaybackState(sharedPlaybackState);

  if (hasChanged) {
    sharedPlaybackState = nextState;
    broadcastPlaybackUpdate(sourceClientId);
  }

  sendJson(res, 200, buildPlaybackPayload(sourceClientId));
}

function handleApiLayoutStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  layoutSubscribers.add(res);
  sendSseEvent(res, 'layout', buildLayoutPayload(null));
  sendSseEvent(res, 'playback', buildPlaybackPayload(null));
  sendSseEvent(res, 'auth-users', buildAuthUsersPayload(null));

  req.on('close', () => {
    layoutSubscribers.delete(res);
  });
}

function handleAuthSession(req, res) {
  const auth = getAuthState(req);
  sendJson(res, 200, {
    authenticated: auth.authenticated,
    isServer: auth.isServer,
    role: auth.role,
    username: auth.username,
  });
}

async function handleAuthLogin(req, res) {
  if (isServerRequest(req)) {
    sendJson(res, 200, { authenticated: true, isServer: true, role: ROLE_HOST, username: 'server' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || password.length === 0) {
    sendJson(res, 400, { error: 'Укажите логин и пароль' });
    return;
  }

  try {
    const expectedPassword = await getUserPassword(username);
    const isValid = expectedPassword !== null && safeCompareStrings(expectedPassword, password);

    if (!isValid) {
      sendJson(res, 401, { error: 'Неверный логин или пароль' });
      return;
    }

    const session = createSession(username);
    setSessionCookie(res, session.token);
    sendJson(res, 200, { authenticated: true, isServer: false, role: session.role, username });
  } catch (err) {
    console.error('Auth login failed', err);
    sendJson(res, 500, { error: 'Ошибка авторизации' });
  }
}

function handleAuthLogout(req, res) {
  const cookies = parseCookies(req);
  destroySession(cookies[SESSION_COOKIE_NAME]);
  clearSessionCookie(res);
  sendJson(res, 200, { authenticated: false });
}

function handleAuthClientsGet(req, res) {
  const auth = requireHostRequest(req, res);
  if (!auth) return;

  sendJson(res, 200, buildAuthUsersPayload(null));
}

async function handleAuthClientsRoleUpdate(req, res) {
  const auth = requireHostRequest(req, res);
  if (!auth) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const username = normalizeUsername(body.username);
  if (!username) {
    sendJson(res, 400, { error: 'Некорректный логин пользователя' });
    return;
  }

  const nextRole = sanitizeManagedUserRole(body.role);
  const result = setRoleForActiveUserSessions(username, nextRole);

  if (result.matchedSessions < 1) {
    sendJson(res, 404, { error: 'Пользователь не найден среди активных сессий' });
    return;
  }

  sendJson(res, 200, {
    users: collectActiveAuthUsers(),
    updated: {
      username,
      role: nextRole,
      changed: result.changed,
    },
  });
}

async function handleAuthClientsDisconnect(req, res) {
  const auth = requireHostRequest(req, res);
  if (!auth) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const username = normalizeUsername(body.username);
  if (!username) {
    sendJson(res, 400, { error: 'Некорректный логин пользователя' });
    return;
  }

  const result = disconnectActiveUserSessions(username);
  if (result.removedSessions < 1) {
    sendJson(res, 404, { error: 'Пользователь не найден среди активных сессий' });
    return;
  }

  sendJson(res, 200, {
    users: collectActiveAuthUsers(),
    disconnected: {
      username,
      removedSessions: result.removedSessions,
    },
  });
}

async function handleApiPlaybackCommand(req, res) {
  const auth = getAuthState(req);
  const canControlLivePlayback = Boolean(auth.isServer || auth.role === ROLE_COHOST);
  if (!canControlLivePlayback) {
    sendJson(res, 403, { error: 'Только хост или co-host может отправлять live-команды' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, PLAYBACK_COMMAND_BODY_LIMIT_BYTES);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const command = sanitizePlaybackCommand(body);
  if (!command) {
    sendJson(res, 400, { error: 'Некорректная команда воспроизведения' });
    return;
  }

  const payload = {
    ...command,
    issuedAt: Date.now(),
    sourceClientId: sanitizeClientId(body.clientId),
    sourceRole: auth.isServer ? ROLE_HOST : sanitizeSessionRole(auth.role),
    sourceUsername: auth.username,
  };
  const commandResult = await livePlaybackCommandBus.dispatch(
    {
      sourceRole: payload.sourceRole,
      commandType: payload.type,
      isServer: auth.isServer,
    },
    payload,
  );
  if (!commandResult.ok) {
    sendJson(res, 403, { error: commandResult.message });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    command: payload,
  });
}

async function handleUpdateCheck(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const allowPrerelease = parseBooleanParam(url, 'allowPrerelease');
    const { latestVersion, htmlUrl, isPrerelease, releaseName } = await getLatestReleaseInfo(appVersion, allowPrerelease);
    const comparableLatest = latestVersion || null;
    const hasUpdate = comparableLatest ? compareVersions(comparableLatest, appVersion) > 0 : false;

    sendJson(res, 200, {
      currentVersion: appVersion,
      latestVersion: comparableLatest,
      hasUpdate,
      releaseUrl: htmlUrl || null,
      isPrerelease: Boolean(isPrerelease),
      releaseName: releaseName || null,
    });
  } catch (err) {
    console.error('Update check failed', err);
    sendJson(res, 500, { error: 'Не удалось проверить наличие обновлений', details: err.message });
  }
}

async function handleUpdateApply(req, res) {
  if (updateInProgress) {
    sendJson(res, 409, { message: 'Обновление уже выполняется' });
    return;
  }

  updateInProgress = true;

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const allowPrerelease = parseBooleanParam(url, 'allowPrerelease');
    const { latestVersion, tarballUrl } = await getLatestReleaseInfo(appVersion, allowPrerelease);
    const comparableLatest = latestVersion || null;
    const hasUpdate = comparableLatest ? compareVersions(comparableLatest, appVersion) > 0 : false;

    if (!hasUpdate) {
      sendJson(res, 200, { message: 'Установлена последняя версия приложения' });
      return;
    }

    if (!tarballUrl) {
      throw new Error('Не удалось найти архив релиза для загрузки');
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'djtron-update-'));
    const archivePath = path.join(tempDir, 'release.tar.gz');

    await downloadFile(tarballUrl, archivePath);
    await extractTarball(archivePath, tempDir);
    const extractedRoot = await findExtractedRoot(tempDir);
    await copyReleaseContents(extractedRoot, __dirname);

    sendJson(res, 200, { message: 'Обновление установлено. Приложение будет закрыто.' });
  } catch (err) {
    console.error('Update apply failed', err);
    sendJson(res, 500, { error: 'Не удалось выполнить обновление', details: err.message });
  } finally {
    updateInProgress = false;
  }
}

function handleShutdown(req, res) {
  if (shuttingDown) {
    sendJson(res, 409, { message: 'Server is already stopping' });
    return;
  }

  shuttingDown = true;
  sendJson(res, 200, { message: 'Server is stopping' });
  console.log('Shutdown requested. Stopping server...');

  const exit = () => process.exit(0);
  server.close(exit);
  setTimeout(exit, 1000).unref();
}

function handleAudioFile(req, res, pathname, baseResolved, basePrefix) {
  const prefix = basePrefix.endsWith('/') ? basePrefix : `${basePrefix}/`;
  const requested = pathname.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '').replace(/^\/+/, '');
  const filePath = safeResolve(baseResolved, requested);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!isAudioFile(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  serveAudioWithRange(req, res, filePath, getContentType(filePath));
}

function handlePublic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = safeResolve(PUBLIC_DIR_RESOLVED, requested);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveFile(req, res, filePath, getContentType(filePath));
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  let requestUrl = null;

  try {
    requestUrl = new URL(req.url, `http://${req.headers.host}`);
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (pathname === '/api/auth/session') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthSession(req, res);
    return;
  }

  if (pathname === '/api/auth/login') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthLogin(req, res);
    return;
  }

  if (pathname === '/api/auth/logout') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthLogout(req, res);
    return;
  }

  if (pathname === '/api/auth/clients') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthClientsGet(req, res);
    return;
  }

  if (pathname === '/api/auth/clients/role') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthClientsRoleUpdate(req, res);
    return;
  }

  if (pathname === '/api/auth/clients/disconnect') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthClientsDisconnect(req, res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    const auth = requireAuthorizedRequest(req, res, 'json');
    if (!auth) return;
  }

  if (pathname.startsWith('/audio/')) {
    const auth = requireAuthorizedRequest(req, res, 'text');
    if (!auth) return;
  }

  if (pathname === '/api/layout/stream') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiLayoutStream(req, res);
    return;
  }

  if (pathname === '/api/layout/reset') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    handleApiLayoutReset(req, res);
    return;
  }

  if (pathname === '/api/layout') {
    if (req.method === 'GET') {
      handleApiLayoutGet(req, res);
      return;
    }

    if (req.method === 'POST') {
      handleApiLayoutUpdate(req, res);
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/api/playback') {
    if (req.method === 'GET') {
      handleApiPlaybackGet(req, res);
      return;
    }

    if (req.method === 'POST') {
      handleApiPlaybackUpdate(req, res);
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/api/playback/command') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiPlaybackCommand(req, res);
    return;
  }

  if (pathname === '/api/shutdown') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    const auth = getAuthState(req);
    if (!auth.isServer) {
      sendJson(res, 403, { error: 'Только хост может останавливать сервер' });
      return;
    }

    handleShutdown(req, res);
    return;
  }

  if (pathname === '/api/audio') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiAudio(req, res);
    return;
  }

  if (pathname === '/api/audio/attributes') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiAudioAttributes(req, res, requestUrl);
    return;
  }

  if (pathname === '/api/dsp/transitions') {
    if (req.method === 'GET') {
      handleApiDspTransitionsGet(req, res, requestUrl);
      return;
    }

    if (req.method === 'POST') {
      handleApiDspTransitionsPost(req, res);
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  if (pathname.startsWith('/api/dsp/transitions/file/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiDspTransitionFile(req, res, pathname);
    return;
  }

  if (pathname === '/api/config') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiConfig(req, res);
    return;
  }

  if (pathname === '/api/version') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiVersion(req, res);
    return;
  }

  if (pathname === '/api/update/check') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleUpdateCheck(req, res);
    return;
  }

  if (pathname === '/api/update/apply') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleUpdateApply(req, res);
    return;
  }

  if (pathname.startsWith('/audio/')) {
    // Allow GET and HEAD for proper metadata fetching.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAudioFile(req, res, pathname, AUDIO_DIR_RESOLVED, '/audio/');
    return;
  }

  // Public files: allow GET and HEAD.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  handlePublic(req, res, pathname);
});

if (DSP_ENABLED) {
  loadDspTempoCache();
  initializeDspLogFile();
  appendDspLog('dsp.startup', {
    enabled: DSP_ENABLED,
    ffmpegBinary: DSP_FFMPEG_BINARY,
    ffprobeBinary: DSP_FFPROBE_BINARY,
    transitionOutputFormat: DSP_TRANSITION_OUTPUT_FORMAT,
    transitionOutputCodec: DSP_TRANSITION_OUTPUT_CODEC,
    transitionSeconds: DSP_DEFAULT_TRANSITION_SECONDS,
    sliceSeconds: DSP_DEFAULT_SLICE_SECONDS,
    queueLimit: DSP_MAX_QUEUE_LENGTH,
    tempoAlignEnabled: DSP_TEMPO_ALIGN_ENABLED,
    tempoMaxAdjustPercent: DSP_TEMPO_MAX_ADJUST_PERCENT,
    tempoGlideEnabled: DSP_TEMPO_GLIDE_ENABLED,
    tempoGlideSegments: DSP_TEMPO_GLIDE_SEGMENTS,
    tempoGlideAnchorSeconds: DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
    aggressiveJoinEnabled: DSP_AGGRESSIVE_JOIN_ENABLED,
    joinIntensity: DSP_JOIN_INTENSITY,
    trimSilenceEnabled: DSP_TRIM_SILENCE_ENABLED,
    trimSilenceDb: DSP_TRIM_SILENCE_THRESHOLD_DB,
    trimMinSilenceSeconds: DSP_TRIM_MIN_SILENCE_SECONDS,
    trimMaxSeconds: DSP_TRIM_MAX_SECONDS,
    noGapGuardEnabled: DSP_NO_GAP_GUARD_ENABLED,
    trimGuardThresholdBoostDb: DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
    noGapEnergyTrimEnabled: DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    noGapEnergySampleRate: DSP_NO_GAP_ENERGY_SAMPLE_RATE,
    noGapEnergyFrameMs: DSP_NO_GAP_ENERGY_FRAME_MS,
    noGapEnergyFloorRatio: DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    noGapEnergyMeanMultiplier: DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
    tempoCacheItems: dspTempoCache.size,
  });
  scheduleDspTransitionsFromLayout(sharedLayoutState.layout, {
    source: 'startup',
    priority: 'normal',
    force: false,
    playlistDspFlags: sharedLayoutState.playlistDsp,
  });
}

function isPrivateIpv4Address(address) {
  if (typeof address !== 'string') return false;
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true;
  if (!address.startsWith('172.')) return false;
  const secondOctet = Number.parseInt(address.split('.')[1], 10);
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

function resolveLocalNetworkIp() {
  let privateFallbackAddress = null;
  let fallbackAddress = null;
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
      if (entry.address.startsWith('192.168.')) return entry.address;
      if (!privateFallbackAddress && isPrivateIpv4Address(entry.address)) privateFallbackAddress = entry.address;
      if (!fallbackAddress) fallbackAddress = entry.address;
    }
  }

  return privateFallbackAddress || fallbackAddress;
}

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  const localNetworkIp = resolveLocalNetworkIp();
  if (localNetworkIp) {
    console.log(`Local network URL for slaves: http://${localNetworkIp}:${PORT}`);
  } else {
    console.log('Local network URL for slaves: not detected');
  }
});
