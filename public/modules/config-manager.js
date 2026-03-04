/**
 * ConfigManager — client-side runtime configuration.
 * Loads config from server and merges with localStorage overrides.
 */

const STORAGE_KEY = 'djtron_config';

const DEFAULTS = {
  liveVolume: 1.0,
  overlaySeconds: 0,
  fadeCurve: 'linear',
  stopFadeSeconds: 0,
  liveSeekEnabled: false,
  showVolumePresets: false,
  volumePresets: [0.25, 0.5, 0.75, 1.0],
  trackTitleMode: 'filename',
  dapVolumePercent: 5,
};

export class ConfigManager {
  constructor() {
    this._config = { ...DEFAULTS };
    this._listeners = [];
  }

  async loadFromServer(apiFn) {
    try {
      const serverConfig = await apiFn();
      Object.assign(this._config, serverConfig);
    } catch (err) {
      console.warn('ConfigManager: failed to load server config', err);
    }
    this._loadLocal();
    return this._config;
  }

  get(key) {
    return key ? this._config[key] : { ...this._config };
  }

  set(key, value) {
    this._config[key] = value;
    this._saveLocal();
    this._notify(key, value);
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  }

  _notify(key, value) {
    this._listeners.forEach(fn => { try { fn(key, value); } catch(e) { console.error(e); } });
  }

  _loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(this._config, JSON.parse(raw));
    } catch (_) { /* ignore corrupt storage */ }
  }

  _saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._config));
    } catch (_) { /* quota exceeded etc */ }
  }
}
