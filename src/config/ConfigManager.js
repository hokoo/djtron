'use strict';

const path = require('node:path');
const fs = require('node:fs');

/**
 * ConfigManager — centralises config loading, parsing, and access.
 *
 * Encapsulates .env loading, extra.conf parsing, and typed value resolution
 * so the rest of the codebase accesses config through a single facade.
 */
class ConfigManager {
  /**
   * @param {object} options
   * @param {string} options.appDir - __dirname of the application
   * @param {string[]} [options.confCandidates] - config file names to try (default: ['extra.conf'])
   */
  constructor({ appDir, confCandidates }) {
    this._appDir = appDir;
    this._confCandidates = confCandidates || ['extra.conf'];
    this._rootConfig = null;
    this._cache = new Map();
  }

  /** Load .env file into process.env (without overwriting existing vars). */
  loadEnvFile() {
    const envPath = path.join(this._appDir, '.env');
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

  /** Load the root config file (extra.conf). Returns the parsed key-value object. */
  loadRootConfig() {
    if (this._rootConfig !== null) return this._rootConfig;

    let confPath = null;
    for (const candidate of this._confCandidates) {
      const absolutePath = path.join(this._appDir, candidate);
      if (fs.existsSync(absolutePath)) {
        confPath = absolutePath;
        break;
      }
    }

    if (!confPath) {
      this._rootConfig = {};
      return this._rootConfig;
    }

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
        result[rawKey] = ConfigManager.stripWrappingQuotes(rawValue);
      });

      this._rootConfig = result;
      return this._rootConfig;
    } catch (err) {
      console.error('Failed to read extra.conf file', err);
      this._rootConfig = {};
      return this._rootConfig;
    }
  }

  /** Get the raw root config object. */
  get rootConfig() {
    if (this._rootConfig === null) this.loadRootConfig();
    return this._rootConfig;
  }

  /**
   * Pick the first matching config value for a list of key aliases.
   * @param {string[]} keys - config key aliases in priority order
   * @returns {string|undefined}
   */
  pick(keys) {
    return ConfigManager.pickConfigValue(this.rootConfig, keys);
  }

  /**
   * Get a boolean config value.
   * @param {string[]} keys - config key aliases
   * @param {boolean} fallback
   * @returns {boolean}
   */
  getBoolean(keys, fallback = false) {
    return ConfigManager.parseBooleanConfigValue(this.pick(keys), fallback);
  }

  /**
   * Get a bounded numeric config value.
   * @param {string[]} keys - config key aliases
   * @param {number} fallback
   * @param {{ min?: number, max?: number }} bounds
   * @returns {number}
   */
  getNumber(keys, fallback, bounds = {}) {
    return ConfigManager.parseBoundedNumberConfigValue(this.pick(keys), fallback, bounds);
  }

  /**
   * Get a truncated integer config value.
   * @param {string[]} keys
   * @param {number} fallback
   * @param {{ min?: number, max?: number }} bounds
   * @returns {number}
   */
  getInt(keys, fallback, bounds = {}) {
    return Math.trunc(this.getNumber(keys, fallback, bounds));
  }

  /**
   * Get a string config value with optional stripping of quotes.
   * @param {string[]} keys
   * @param {string} fallback
   * @returns {string}
   */
  getString(keys, fallback = '') {
    const raw = this.pick(keys);
    if (raw === undefined || raw === null) return fallback;
    const stripped = ConfigManager.stripWrappingQuotes(String(raw));
    return stripped || fallback;
  }

  // ── Static parsing helpers (reusable outside the instance) ──

  static stripWrappingQuotes(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }

  static pickConfigValue(config, keys) {
    if (!config || typeof config !== 'object' || !Array.isArray(keys)) return undefined;
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        return config[key];
      }
    }
    return undefined;
  }

  static parseBooleanConfigValue(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized)) return false;
    return fallback;
  }

  static parseBoundedNumberConfigValue(value, fallback, { min = null, max = null } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (Number.isFinite(min) && numeric < min) return fallback;
    if (Number.isFinite(max) && numeric > max) return fallback;
    return numeric;
  }

  static parseDspTransitionOutputFormat(value, fallback = 'wav') {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'mp3') return 'mp3';
    if (normalized === 'wav') return 'wav';
    return fallback;
  }

  static parsePortCandidate(value) {
    if (value === null || value === undefined) return null;
    const numeric = Number.parseInt(String(value).trim(), 10);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return null;
    return numeric;
  }

  static resolvePortValue(envValue, configValue, fallback = 3000) {
    const fromEnv = ConfigManager.parsePortCandidate(envValue);
    if (fromEnv !== null) return fromEnv;
    const fromConfig = ConfigManager.parsePortCandidate(configValue);
    if (fromConfig !== null) return fromConfig;
    return fallback;
  }

  // ── Volume preset helpers ──

  static normalizeVolumePresetValues(values, fallback) {
    const DEFAULT = Object.freeze([0.1, 0.3, 0.5]);
    const effectiveFallback = Array.isArray(fallback) && fallback.length ? fallback : DEFAULT;
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
    return effectiveFallback.slice();
  }

  static parseVolumePresetsConfigValue(value, fallback) {
    const DEFAULT = Object.freeze([0.1, 0.3, 0.5]);
    const effectiveFallback = Array.isArray(fallback) && fallback.length ? fallback : DEFAULT;

    if (Array.isArray(value)) {
      return ConfigManager.normalizeVolumePresetValues(value, effectiveFallback);
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return ConfigManager.normalizeVolumePresetValues([value], effectiveFallback);
    }

    if (typeof value !== 'string') {
      return ConfigManager.normalizeVolumePresetValues([], effectiveFallback);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return ConfigManager.normalizeVolumePresetValues([], effectiveFallback);
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return ConfigManager.normalizeVolumePresetValues(parsed, effectiveFallback);
        }
      } catch (_err) {
        // fallback to token parsing
      }
    }

    const tokens = trimmed.split(/[,\s;|]+/).filter(Boolean);
    return ConfigManager.normalizeVolumePresetValues(tokens, effectiveFallback);
  }

  static serializeVolumePresetPercentValues(values) {
    const DEFAULT = Object.freeze([0.1, 0.3, 0.5]);
    const source = Array.isArray(values) && values.length ? values : DEFAULT;
    return source
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0 && value < 1)
      .map((value) => Math.round(value * 1000) / 10);
  }

  // ── Materialization ──

  /**
   * Compute all config constants from env vars, root config, and defaults.
   * After calling this, use getAll() / get(key) to access values.
   */
  materialize() {
    this.loadEnvFile();
    const rootConfig = this.loadRootConfig();

    const DEFAULT_PORT = 3000;
    const DEFAULT_LIVE_VOLUME_PRESET_VALUES = Object.freeze([0.1, 0.3, 0.5]);

    const pick = (keys) => ConfigManager.pickConfigValue(rootConfig, keys);
    const bool = (keys, fb) => ConfigManager.parseBooleanConfigValue(pick(keys), fb);
    const num = (keys, fb, bounds) => ConfigManager.parseBoundedNumberConfigValue(pick(keys), fb, bounds);
    const int = (keys, fb, bounds) => Math.trunc(ConfigManager.parseBoundedNumberConfigValue(pick(keys), fb, bounds));
    const str = (keys, fb) => {
      const raw = pick(keys);
      if (raw === undefined || raw === null) return fb;
      const stripped = ConfigManager.stripWrappingQuotes(String(raw));
      return stripped || fb;
    };

    const PORT = ConfigManager.resolvePortValue(
      process.env.PORT,
      pick(['port']),
      DEFAULT_PORT,
    );

    const AUDIO_DIR = path.join(this._appDir, 'audio');
    const PUBLIC_DIR = path.join(this._appDir, 'public');
    const USERS_DIR = path.join(this._appDir, 'users');
    const DSP_CACHE_DIR = path.join(this._appDir, '.cache', 'dsp');

    const AUDIO_DIR_RESOLVED = path.resolve(AUDIO_DIR);
    const PUBLIC_DIR_RESOLVED = path.resolve(PUBLIC_DIR);
    const USERS_DIR_RESOLVED = path.resolve(USERS_DIR);

    const REPO_OWNER = 'hokoo';
    const REPO_NAME = 'djtron';
    const githubToken = process.env.GITHUB_TOKEN || null;
    const ONE_HOUR_MS = 60 * 60 * 1000;

    const DAP_DEFAULT_VOLUME_PERCENT = 5;
    const DAP_MIN_VOLUME_PERCENT = 0;
    const DAP_MAX_VOLUME_PERCENT = 100;

    const RUNTIME_OVERRIDE_SCOPE_NONE = 'none';
    const RUNTIME_OVERRIDE_SCOPE_CLIENT = 'client';
    const RUNTIME_OVERRIDE_SCOPE_HOST = 'host';

    const DSP_TEMPO_MAX_ADJUST_PERCENT = num(
      ['dsp_tempo_max_adjust_percent', 'tempo_max_adjust_percent'],
      12,
      { min: 0, max: 40 },
    );

    const DSP_TEMPO_MIN_BPM = num(
      ['dsp_tempo_min_bpm', 'tempo_min_bpm'],
      70,
      { min: 40, max: 220 },
    );

    const DSP_TRIM_SILENCE_THRESHOLD_DB = num(
      ['dsp_trim_silence_db', 'trim_silence_db'],
      -36,
      { min: -90, max: -8 },
    );

    const DSP_TRANSITION_OUTPUT_FORMAT = ConfigManager.parseDspTransitionOutputFormat(
      pick(['dsp_transition_output_format', 'dsp_output_format', 'dsp_transition_format', 'dsp_format']),
      'wav',
    );

    const LIVE_VOLUME_PRESET_VALUES = ConfigManager.parseVolumePresetsConfigValue(
      pick(['volume_presets', 'live_volume_presets', 'presets']),
      DEFAULT_LIVE_VOLUME_PRESET_VALUES,
    );

    this._values = {
      DEFAULT_PORT,
      DEFAULT_LIVE_VOLUME_PRESET_VALUES,
      PORT,
      AUDIO_DIR,
      PUBLIC_DIR,
      USERS_DIR,
      AUDIO_DIR_RESOLVED,
      PUBLIC_DIR_RESOLVED,
      USERS_DIR_RESOLVED,
      AUDIO_EXTENSIONS: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']),
      REPO_OWNER,
      REPO_NAME,
      GITHUB_API_URL: `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`,
      ONE_HOUR_MS,
      githubToken,
      UPDATE_CACHE_WINDOW_MS: githubToken ? 0 : ONE_HOUR_MS,
      UPDATE_STATE_PATH: path.join(this._appDir, 'update-state.json'),
      LAYOUT_STATE_PATH: path.join(this._appDir, 'layout-state.json'),
      SESSIONS_STATE_PATH: path.join(this._appDir, 'sessions-state.json'),
      DSP_CACHE_DIR,
      DSP_TRANSITIONS_DIR: path.join(DSP_CACHE_DIR, 'transitions'),
      DSP_LOG_PATH: path.join(this._appDir, 'dsp.log'),
      DSP_TEMPO_CACHE_PATH: path.join(DSP_CACHE_DIR, 'tempo-cache.json'),
      DSP_STATUS_QUEUED: 'queued',
      DSP_STATUS_PROCESSING: 'processing',
      DSP_STATUS_READY: 'ready',
      DSP_STATUS_FAILED: 'failed',
      SESSION_COOKIE_NAME: 'chkg_session',
      SESSION_TTL_MS: 12 * 60 * 60 * 1000,
      AUTH_BODY_LIMIT_BYTES: 8 * 1024,
      LAYOUT_BODY_LIMIT_BYTES: 512 * 1024,
      PLAYBACK_BODY_LIMIT_BYTES: 32 * 1024,
      PLAYBACK_COMMAND_BODY_LIMIT_BYTES: 16 * 1024,
      DSP_BODY_LIMIT_BYTES: 128 * 1024,
      AUDIO_TAG_SCAN_BYTES: 256 * 1024,
      PLAYLIST_NAME_MAX_LENGTH: 80,
      TRACK_TITLE_MODE_ATTRIBUTES: 'attributes',
      TRACK_TITLE_KEY_MAX_LENGTH: 1024,
      USERNAME_PATTERN: /^[a-zA-Z0-9._-]{1,64}$/,
      SESSION_TOKEN_PATTERN: /^[a-f0-9]{64}$/,
      ROLE_HOST: 'host',
      ROLE_SLAVE: 'slave',
      ROLE_COHOST: 'co-host',
      DAP_DEFAULT_VOLUME_PERCENT,
      DAP_MIN_VOLUME_PERCENT,
      DAP_MAX_VOLUME_PERCENT,
      DEFAULT_DAP_CONFIG: Object.freeze({
        enabled: false,
        playlistIndex: null,
        volumePercent: DAP_DEFAULT_VOLUME_PERCENT,
      }),
      RUNTIME_OVERRIDE_SCOPE_NONE,
      RUNTIME_OVERRIDE_SCOPE_CLIENT,
      RUNTIME_OVERRIDE_SCOPE_HOST,
      LIVE_VOLUME_PRESET_VALUES,
      ALLOW_CONTEXT_MENU: bool(
        ['allow_context_menu', 'context_menu'],
        false,
      ),
      RUNTIME_CONFIG_SCHEMA: Object.freeze({
        port: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
        allowContextMenu: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_CLIENT }),
        volumePresets: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_HOST }),
        dspEntryCompensationMs: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
        dspExitCompensationMs: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
      }),
      DEFAULT_LIVE_VOLUME: 1,
      DSP_ENABLED: bool(['dsp_enabled', 'dsp'], true),
      DSP_FFMPEG_BINARY: str(['dsp_ffmpeg_path', 'ffmpeg_path'], 'ffmpeg'),
      DSP_FFPROBE_BINARY: str(['dsp_ffprobe_path', 'ffprobe_path'], 'ffprobe'),
      DSP_TRANSITION_OUTPUT_FORMAT,
      DSP_TRANSITION_OUTPUT_CODEC: DSP_TRANSITION_OUTPUT_FORMAT === 'wav' ? 'pcm_s16le' : 'libmp3lame',
      DSP_DEFAULT_TRANSITION_SECONDS: num(
        ['dsp_transition_seconds', 'transition_seconds'],
        5,
        { min: 0.2, max: 30 },
      ),
      DSP_DEFAULT_SLICE_SECONDS: num(
        ['dsp_slice_seconds', 'slice_seconds'],
        15,
        { min: 1, max: 120 },
      ),
      DSP_JOB_TIMEOUT_MS: num(
        ['dsp_job_timeout_ms', 'job_timeout_ms'],
        90 * 1000,
        { min: 5 * 1000, max: 15 * 60 * 1000 },
      ),
      DSP_MAX_QUEUE_LENGTH: int(
        ['dsp_max_queue', 'max_queue'],
        500,
        { min: 10, max: 10_000 },
      ),
      DSP_HISTORY_LIMIT: int(
        ['dsp_history_limit', 'history_limit'],
        2000,
        { min: 100, max: 50_000 },
      ),
      DSP_PROBE_CACHE_MS: 60 * 1000,
      DSP_LOG_MAX_BYTES: int(
        ['dsp_log_max_bytes', 'log_max_bytes'],
        4 * 1024 * 1024,
        { min: 256 * 1024, max: 64 * 1024 * 1024 },
      ),
      DSP_TEMPO_ALIGN_ENABLED: bool(
        ['dsp_tempo_align_enabled', 'dsp_tempo_align', 'tempo_align'],
        true,
      ),
      DSP_TEMPO_ANALYSIS_SECONDS: num(
        ['dsp_tempo_analysis_seconds', 'tempo_analysis_seconds'],
        90,
        { min: 15, max: 240 },
      ),
      DSP_TEMPO_SAMPLE_RATE: int(
        ['dsp_tempo_sample_rate', 'tempo_sample_rate'],
        11025,
        { min: 4000, max: 48000 },
      ),
      DSP_TEMPO_MIN_BPM,
      DSP_TEMPO_MAX_BPM: Math.max(
        DSP_TEMPO_MIN_BPM + 1,
        num(
          ['dsp_tempo_max_bpm', 'tempo_max_bpm'],
          170,
          { min: 60, max: 260 },
        ),
      ),
      DSP_TEMPO_MAX_ADJUST_PERCENT,
      DSP_TEMPO_MIN_RATIO: Math.max(0.6, 1 - DSP_TEMPO_MAX_ADJUST_PERCENT / 100),
      DSP_TEMPO_MAX_RATIO: Math.min(1.8, 1 + DSP_TEMPO_MAX_ADJUST_PERCENT / 100),
      DSP_TEMPO_MIN_DELTA_RATIO: num(
        ['dsp_tempo_min_delta_ratio', 'tempo_min_delta_ratio'],
        0.012,
        { min: 0.001, max: 0.2 },
      ),
      DSP_TEMPO_GLIDE_ENABLED: bool(
        ['dsp_tempo_glide_enabled', 'dsp_tempo_glide', 'tempo_glide'],
        true,
      ),
      DSP_TEMPO_GLIDE_SEGMENTS: int(
        ['dsp_tempo_glide_segments', 'tempo_glide_segments'],
        4,
        { min: 2, max: 12 },
      ),
      DSP_TEMPO_GLIDE_ANCHOR_SECONDS: num(
        ['dsp_tempo_glide_anchor_seconds', 'tempo_glide_anchor_seconds'],
        0.22,
        { min: 0, max: 2 },
      ),
      DSP_AGGRESSIVE_JOIN_ENABLED: bool(
        ['dsp_aggressive_join', 'dsp_aggressive_join_enabled', 'aggressive_join'],
        true,
      ),
      DSP_JOIN_INTENSITY: num(
        ['dsp_join_intensity', 'join_intensity'],
        0.78,
        { min: 0, max: 1 },
      ),
      DSP_JOIN_MIN_TRANSITION_SECONDS: num(
        ['dsp_join_min_transition_seconds', 'join_min_transition_seconds'],
        0.3,
        { min: 0.05, max: 10 },
      ),
      DSP_TRIM_SILENCE_ENABLED: bool(
        ['dsp_trim_silence_enabled', 'trim_silence_enabled'],
        true,
      ),
      DSP_TRIM_SILENCE_THRESHOLD_DB,
      DSP_TRIM_MIN_SILENCE_SECONDS: num(
        ['dsp_trim_min_silence_seconds', 'trim_min_silence_seconds'],
        0.14,
        { min: 0.02, max: 3 },
      ),
      DSP_TRIM_MAX_SECONDS: num(
        ['dsp_trim_max_seconds', 'trim_max_seconds'],
        4.8,
        { min: 0, max: 20 },
      ),
      DSP_NO_GAP_GUARD_ENABLED: bool(
        ['dsp_no_gap_guard', 'dsp_trim_no_gap_guard', 'trim_no_gap_guard'],
        true,
      ),
      DSP_TRIM_GUARD_THRESHOLD_BOOST_DB: num(
        ['dsp_trim_guard_threshold_boost_db', 'trim_guard_threshold_boost_db'],
        10,
        { min: 0, max: 30 },
      ),
      DSP_NO_GAP_ENERGY_TRIM_ENABLED: bool(
        ['dsp_no_gap_energy_trim', 'dsp_trim_energy_guard', 'trim_energy_guard'],
        true,
      ),
      DSP_NO_GAP_ENERGY_SAMPLE_RATE: int(
        ['dsp_no_gap_energy_sample_rate', 'trim_energy_sample_rate'],
        12000,
        { min: 4000, max: 48000 },
      ),
      DSP_NO_GAP_ENERGY_FRAME_MS: num(
        ['dsp_no_gap_energy_frame_ms', 'trim_energy_frame_ms'],
        20,
        { min: 5, max: 100 },
      ),
      DSP_NO_GAP_ENERGY_FLOOR_RATIO: num(
        ['dsp_no_gap_energy_floor_ratio', 'trim_energy_floor_ratio'],
        0.18,
        { min: 0.03, max: 0.9 },
      ),
      DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER: num(
        ['dsp_no_gap_energy_mean_multiplier', 'trim_energy_mean_multiplier'],
        1.7,
        { min: 1, max: 6 },
      ),
      LIVE_DSP_ENTRY_COMPENSATION_MS: int(
        ['dsp_live_entry_compensation_ms', 'dsp_entry_compensation_ms', 'live_dsp_entry_compensation_ms', 'entry_compensation_ms'],
        22,
        { min: 0, max: 250 },
      ),
      LIVE_DSP_EXIT_COMPENSATION_MS: int(
        ['dsp_live_exit_compensation_ms', 'dsp_exit_compensation_ms', 'live_dsp_exit_compensation_ms', 'exit_compensation_ms'],
        19,
        { min: 0, max: 250 },
      ),
      DSP_TEMPO_FRAME_SAMPLES: 1024,
      DSP_TEMPO_HOP_SAMPLES: 512,
    };
  }

  /** Get all materialized config values. */
  getAll() {
    return this._values;
  }

  /** Get a single materialized config value by key. */
  get(key) {
    return this._values[key];
  }
}

module.exports = { ConfigManager };
