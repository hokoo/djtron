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
const { HttpRouter } = require('./src/http/HttpRouter');
const { AuthService } = require('./src/auth/AuthService');
const { createAuthGuard } = require('./src/http/middlewares/auth');
const { ConfigManager } = require('./src/config/ConfigManager');
const { PlaybackGateway } = require('./src/playback/PlaybackGateway');
const { DspJobManager } = require('./src/dsp/DspJobManager');
const { AudioCatalogService } = require('./src/catalog/AudioCatalogService');
const { UpdateService } = require('./src/update/UpdateService');

const configManager = new ConfigManager({ appDir: __dirname });

function loadEnvFile() {
  configManager.loadEnvFile();
}

const DEFAULT_PORT = 3000;
const DEFAULT_LIVE_VOLUME_PRESET_VALUES = Object.freeze([0.1, 0.3, 0.5]);
const ROOT_CONF_CANDIDATES = ['extra.conf'];

function stripWrappingQuotes(value) {
  return ConfigManager.stripWrappingQuotes(value);
}

function loadRootConfig() {
  return configManager.loadRootConfig();
}

function pickConfigValue(config, keys) {
  return ConfigManager.pickConfigValue(config, keys);
}

function parseBooleanConfigValue(value, fallback = false) {
  return ConfigManager.parseBooleanConfigValue(value, fallback);
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
  return ConfigManager.parsePortCandidate(value);
}

function resolvePortValue(envValue, configValue, fallback = DEFAULT_PORT) {
  return ConfigManager.resolvePortValue(envValue, configValue, fallback);
}

function parseBoundedNumberConfigValue(value, fallback, bounds = {}) {
  return ConfigManager.parseBoundedNumberConfigValue(value, fallback, bounds);
}

function parseDspTransitionOutputFormat(value, fallback = 'wav') {
  return ConfigManager.parseDspTransitionOutputFormat(value, fallback);
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

const playbackGateway = new PlaybackGateway({
  getState: () => sharedPlaybackState,
  setState: (next) => { sharedPlaybackState = next; },
  sanitizeState: sanitizePlaybackState,
  serializeState: serializePlaybackState,
  buildPayload: buildPlaybackPayload,
  broadcastUpdate: broadcastPlaybackUpdate,
  sanitizeCommand: sanitizePlaybackCommand,
  sanitizeClientId,
  sanitizeSessionRole,
  commandBus: livePlaybackCommandBus,
  ROLE_HOST,
});

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

const updateService = new UpdateService({
  currentVersion: appVersion,
  getLatestReleaseInfo,
  compareVersions,
  downloadFile,
  extractTarball,
  findExtractedRoot,
  copyReleaseContents,
  appDir: __dirname,
  parseBooleanParam,
});

function safeResolve(baseDirResolved, requestPath) {
  // requestPath must be without leading slashes
  const resolved = path.resolve(baseDirResolved, requestPath);
  return isInside(baseDirResolved, resolved) ? resolved : null;
}

const dspJobManager = new DspJobManager({
  config: {
    DSP_ENABLED,
    DSP_FFMPEG_BINARY,
    DSP_FFPROBE_BINARY,
    DSP_TRANSITION_OUTPUT_FORMAT,
    DSP_TRANSITION_OUTPUT_CODEC,
    DSP_DEFAULT_TRANSITION_SECONDS,
    DSP_DEFAULT_SLICE_SECONDS,
    DSP_JOB_TIMEOUT_MS,
    DSP_MAX_QUEUE_LENGTH,
    DSP_HISTORY_LIMIT,
    DSP_PROBE_CACHE_MS,
    DSP_LOG_PATH,
    DSP_LOG_MAX_BYTES,
    DSP_CACHE_DIR,
    DSP_TRANSITIONS_DIR,
    DSP_TEMPO_CACHE_PATH,
    DSP_TEMPO_ALIGN_ENABLED,
    DSP_TEMPO_ANALYSIS_SECONDS,
    DSP_TEMPO_SAMPLE_RATE,
    DSP_TEMPO_MIN_BPM,
    DSP_TEMPO_MAX_BPM,
    DSP_TEMPO_MAX_ADJUST_PERCENT,
    DSP_TEMPO_MIN_RATIO,
    DSP_TEMPO_MAX_RATIO,
    DSP_TEMPO_MIN_DELTA_RATIO,
    DSP_TEMPO_GLIDE_ENABLED,
    DSP_TEMPO_GLIDE_SEGMENTS,
    DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
    DSP_AGGRESSIVE_JOIN_ENABLED,
    DSP_JOIN_INTENSITY,
    DSP_JOIN_MIN_TRANSITION_SECONDS,
    DSP_TRIM_SILENCE_ENABLED,
    DSP_TRIM_SILENCE_THRESHOLD_DB,
    DSP_TRIM_MIN_SILENCE_SECONDS,
    DSP_TRIM_MAX_SECONDS,
    DSP_NO_GAP_GUARD_ENABLED,
    DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
    DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    DSP_NO_GAP_ENERGY_SAMPLE_RATE,
    DSP_NO_GAP_ENERGY_FRAME_MS,
    DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
  },
  deps: {
    fs,
    path,
    crypto,
    execFileAsync,
    normalizeAudioRelativePath,
    safeResolve,
    isAudioFile,
    AUDIO_DIR_RESOLVED,
  },
});

async function handleApiDspTransitionsGet(req, res, requestUrl) {
  await dspJobManager.ensureReady();

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
    const lookup = dspJobManager.getTransitionByPair(fromFile, toFile, {});
    if (!lookup.ok) {
      sendJson(res, 400, { error: lookup.error || 'Некорректный запрос transition.' });
      return;
    }

    let inferredReadyTransition = null;
    if (!lookup.item && lookup.descriptor && fs.existsSync(lookup.descriptor.outputPath)) {
      inferredReadyTransition = dspJobManager.buildInferredReadyStub(lookup.descriptor);
    }

    const transition =
      lookup.item ||
      inferredReadyTransition ||
      (lookup.descriptor ? dspJobManager.buildMissingTransitionStub(lookup.descriptor) : null);

    sendJson(res, 200, {
      transition: lookup.item ? dspJobManager.serializeTransition(lookup.item) : transition,
      queue: dspJobManager.getQueueSummary(),
    });
    return;
  }

  const transitions = dspJobManager.listTransitions(limit);
  sendJson(res, 200, {
    transitions,
    queue: dspJobManager.getQueueSummary(),
  });
}

async function handleApiDspTransitionsPost(req, res) {
  if (!dspJobManager.enabled) {
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

  const result = dspJobManager.enqueueBatch(body, {
    layout: sharedLayoutState.layout,
    playlistDsp: sharedLayoutState.playlistDsp,
  });

  if (result.error) {
    sendJson(res, 400, { error: result.error });
    return;
  }

  sendJson(res, 200, result);
  dspJobManager.appendLog('transition.request', {
    source: result.request.source,
    force: result.request.force,
    priority: result.request.priority,
    fromLayout: result.request.fromLayout,
    totalPairs: result.request.totalPairs,
    uniquePairs: result.request.uniquePairs,
    created: result.summary.created,
    enqueued: result.summary.enqueued,
    failed: result.summary.failed,
  });
}

function handleApiDspTransitionFile(req, res, pathname) {
  const id = req.params && req.params.id ? req.params.id.trim() : '';
  if (!/^[a-f0-9]{40}$/.test(id)) {
    sendJson(res, 400, { error: 'Некорректный transition id' });
    return;
  }

  const filePath = dspJobManager.resolveOutputPath(id);
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

const audioCatalog = new AudioCatalogService({
  collectCatalog: collectAudioCatalog,
  getAttributesCached: getAudioAttributesCached,
  buildDisplayName: buildAudioAttributeDisplayName,
  normalizePath: normalizeAudioRelativePath,
  safeResolve: safeResolve,
  isAudioFile: isAudioFile,
  stripExtension: stripFileExtension,
  audioDir: AUDIO_DIR_RESOLVED,
});

async function handleApiAudio(req, res) {
  try {
    const catalog = await audioCatalog.getCatalog();
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

  const normalizedFile = audioCatalog.normalizePath(rawFile.trim());
  if (!normalizedFile) {
    sendJson(res, 400, { error: 'Неверное имя файла' });
    return;
  }

  const absoluteFilePath = audioCatalog.resolveAudioPath(normalizedFile);
  if (!absoluteFilePath) {
    sendJson(res, 400, { error: 'Неверный путь к файлу' });
    return;
  }

  if (!audioCatalog.isAudioFile(absoluteFilePath)) {
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
    const attributes = await audioCatalog.getAttributes(normalizedFile, absoluteFilePath, fileStat);
    const fallbackName = audioCatalog.stripExtension(path.basename(normalizedFile));
    const displayName = audioCatalog.buildDisplayName(attributes, fallbackName);

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
  sharedLayoutState = {
    ...getDefaultLayoutState(),
    version: sharedLayoutState.version + 1,
    updatedAt: Date.now(),
  };

  persistLayoutState(sharedLayoutState);
  broadcastLayoutUpdate(null);
  dspJobManager.scheduleFromLayout(sharedLayoutState.layout, {
    source: 'layout-update',
    priority: 'normal',
    force: false,
    playlistDspFlags: sharedLayoutState.playlistDsp,
  });

  sendJson(res, 200, buildLayoutPayload(null));
}

function handleApiPlaybackGet(req, res) {
  sendJson(res, 200, playbackGateway.getSnapshot(null));
}

async function handleApiLayoutUpdate(req, res) {
  const auth = req.auth;
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
    dspJobManager.scheduleFromLayout(sharedLayoutState.layout, {
      source: 'layout-update',
      priority: 'normal',
      force: false,
      playlistDspFlags: sharedLayoutState.playlistDsp,
    });
  }

  sendJson(res, 200, buildLayoutPayload(sourceClientId));
}

async function handleApiPlaybackUpdate(req, res) {
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

  const result = playbackGateway.updateState(body);
  sendJson(res, 200, result.payload);
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
  sendJson(res, 200, {
    authenticated: req.auth.authenticated,
    isServer: req.auth.isServer,
    role: req.auth.role,
    username: req.auth.username,
  });
}

async function handleAuthLogin(req, res) {
  if (req.auth.isServer) {
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
  sendJson(res, 200, buildAuthUsersPayload(null));
}

async function handleAuthClientsRoleUpdate(req, res) {
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
  const auth = req.auth;

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

  const result = await playbackGateway.dispatchCommand(body, auth);
  sendJson(res, result.status, result.ok ? result.payload : { error: result.error });
}

async function handleUpdateCheck(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const result = await updateService.checkForUpdate(url);
    sendJson(res, 200, result);
  } catch (err) {
    console.error('Update check failed', err);
    sendJson(res, 500, { error: 'Не удалось проверить наличие обновлений', details: err.message });
  }
}

async function handleUpdateApply(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { status, body } = await updateService.applyUpdate(url);
    sendJson(res, status, body);
  } catch (err) {
    console.error('Update apply failed', err);
    sendJson(res, 500, { error: 'Не удалось выполнить обновление', details: err.message });
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


// --- HttpRouter + AuthService wiring (PR1) ---
const authService = new AuthService({ getAuthStateFn: getAuthState });
const authGuard = createAuthGuard(authService);
const router = new HttpRouter({ authGuard });

// Auth endpoints
router.register('GET', '/api/auth/session', handleAuthSession, { auth: 'none' });
router.register('POST', '/api/auth/login', handleAuthLogin, { auth: 'none' });
router.register('POST', '/api/auth/logout', handleAuthLogout, { auth: 'none' });
router.register('GET', '/api/auth/clients', handleAuthClientsGet, { auth: 'host' });
router.register('POST', '/api/auth/clients/role', handleAuthClientsRoleUpdate, { auth: 'host' });
router.register('POST', '/api/auth/clients/disconnect', handleAuthClientsDisconnect, { auth: 'host' });

// Layout/playback endpoints
router.register('GET', '/api/layout/stream', handleApiLayoutStream, { auth: 'session' });
router.register('POST', '/api/layout/reset', handleApiLayoutReset, { auth: 'host' });
router.register('GET', '/api/layout', handleApiLayoutGet, { auth: 'session' });
router.register('POST', '/api/layout', handleApiLayoutUpdate, { auth: 'session' });
router.register('GET', '/api/playback', handleApiPlaybackGet, { auth: 'session' });
router.register('POST', '/api/playback', handleApiPlaybackUpdate, { auth: 'host' });
router.register('POST', '/api/playback/command', handleApiPlaybackCommand, { auth: 'host|cohost' });
router.register('POST', '/api/shutdown', handleShutdown, { auth: 'host' });

// Catalog/DSP/config/update endpoints
router.register('GET', '/api/audio', handleApiAudio, { auth: 'session' });
router.register('GET', '/api/audio/attributes', (req, res) => handleApiAudioAttributes(req, res, req.parsedUrl), { auth: 'session' });
router.register('GET', '/api/dsp/transitions', (req, res) => handleApiDspTransitionsGet(req, res, req.parsedUrl), { auth: 'session' });
router.register('POST', '/api/dsp/transitions', handleApiDspTransitionsPost, { auth: 'host' });
router.register('GET|HEAD', '/api/dsp/transitions/file/:id', (req, res) => handleApiDspTransitionFile(req, res, req.pathname), { auth: 'session' });
router.register('GET', '/api/config', handleApiConfig, { auth: 'session' });
router.register('GET', '/api/version', handleApiVersion, { auth: 'session' });
router.register('GET', '/api/update/check', handleUpdateCheck, { auth: 'session' });
router.register('POST', '/api/update/apply', handleUpdateApply, { auth: 'session' });

// Wildcard routes (catch-alls, order matters: more specific first)
router.register('GET|HEAD', '/api/*', (req, res) => handlePublic(req, res, req.pathname), { auth: 'session' });
router.register('GET|HEAD', '/audio/*', (req, res) => handleAudioFile(req, res, req.pathname, AUDIO_DIR_RESOLVED, '/audio/'), { auth: 'session', authResponseKind: 'text' });
router.register('GET|HEAD', '/*', (req, res) => handlePublic(req, res, req.pathname), { auth: 'none' });

const server = http.createServer((req, res) => {
  router.dispatch(req, res);
});

if (DSP_ENABLED) {
  dspJobManager.appendLog('dsp.startup', {
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
    tempoCacheItems: dspJobManager.getTempoCacheSize(),
  });
  dspJobManager.scheduleFromLayout(sharedLayoutState.layout, {
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
