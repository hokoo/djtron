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
}

module.exports = { ConfigManager };
