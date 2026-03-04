'use strict';

const { ConfigManager } = require('../config/ConfigManager');

class LayoutStateService {
  /**
   * @param {object} options
   * @param {object} options.config - All needed constants
   * @param {object} options.deps - { fs, path, buildAuthUsersPayload }
   */
  constructor({ config, deps }) {
    this._config = config;
    this._fs = deps.fs;
    this._path = deps.path;
    this._buildAuthUsersPayload = deps.buildAuthUsersPayload || null;

    this._layoutState = null;
    this._playbackState = null;
    this._layoutSubscribers = new Set();
    this._trackTitleModes = {};
  }

  // ── Accessors ──────────────────────────────────────────────────────

  get layoutState() { return this._layoutState; }
  set layoutState(value) { this._layoutState = value; }

  get playbackState() { return this._playbackState; }
  set playbackState(value) { this._playbackState = value; }

  get layoutSubscribers() { return this._layoutSubscribers; }

  get trackTitleModes() { return this._trackTitleModes; }
  set trackTitleModes(value) { this._trackTitleModes = value; }

  // ── Group 1: Default state factories (static) ─────────────────────

  getDefaultLayoutState() {
    return {
      version: 0,
      updatedAt: 0,
      layout: [[]],
      playlistNames: ['Плей-лист 1'],
      playlistMeta: [{ type: 'manual' }],
      playlistAutoplay: [false],
      playlistDsp: [false],
      dapConfig: { ...this._config.DEFAULT_DAP_CONFIG },
      trackTitleModesByTrack: {},
    };
  }

  getDefaultPlaybackState() {
    return {
      trackFile: null,
      paused: false,
      currentTime: 0,
      duration: null,
      volume: this._config.DEFAULT_LIVE_VOLUME,
      showVolumePresets: false,
      allowLiveSeek: false,
      dapPlayback: LayoutStateService.getDefaultDapPlaybackState(),
      overlaySeconds: 0,
      nextDspSliceSeconds: 0,
      nextDspSourceSeconds: 0,
      playlistIndex: null,
      playlistPosition: null,
      updatedAt: 0,
    };
  }

  static getDefaultDapPlaybackState() {
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

  static defaultPlaylistName(index) {
    return `Плей-лист ${index + 1}`;
  }

  // ── Group 2: Layout sanitization/normalization (static where possible) ──

  sanitizePlaylistName(value, index) {
    if (typeof value !== 'string') {
      return LayoutStateService.defaultPlaylistName(index);
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      return LayoutStateService.defaultPlaylistName(index);
    }

    return normalized.slice(0, this._config.PLAYLIST_NAME_MAX_LENGTH);
  }

  static sanitizeLayout(layout) {
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

  normalizePlaylistNames(playlistNames, layoutLength) {
    const result = [];

    for (let index = 0; index < layoutLength; index += 1) {
      const rawName = Array.isArray(playlistNames) ? playlistNames[index] : null;
      result.push(this.sanitizePlaylistName(rawName, index));
    }

    return result;
  }

  static normalizePlaylistAutoplayFlags(playlistAutoplay, layoutLength) {
    const result = [];

    for (let index = 0; index < layoutLength; index += 1) {
      const rawValue = Array.isArray(playlistAutoplay) ? playlistAutoplay[index] : false;
      result.push(Boolean(rawValue));
    }

    return result;
  }

  static normalizePlaylistDspFlags(playlistDsp, playlistAutoplay, layoutLength) {
    const normalizedAutoplay = LayoutStateService.normalizePlaylistAutoplayFlags(playlistAutoplay, layoutLength);
    const result = [];

    for (let index = 0; index < layoutLength; index += 1) {
      const rawValue = Array.isArray(playlistDsp) ? playlistDsp[index] : false;
      result.push(Boolean(rawValue) && Boolean(normalizedAutoplay[index]));
    }

    return result;
  }

  normalizeDapVolumePercent(value, fallback) {
    const effectiveFallback = fallback !== undefined ? fallback : this._config.DAP_DEFAULT_VOLUME_PERCENT;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return this.normalizeDapVolumePercent(effectiveFallback, this._config.DAP_DEFAULT_VOLUME_PERCENT);
    }

    const rounded = Math.round(numeric);
    if (rounded < this._config.DAP_MIN_VOLUME_PERCENT) return this._config.DAP_MIN_VOLUME_PERCENT;
    if (rounded > this._config.DAP_MAX_VOLUME_PERCENT) return this._config.DAP_MAX_VOLUME_PERCENT;
    return rounded;
  }

  sanitizeDapConfig(dapConfig, layoutLength, fallback) {
    const effectiveFallback = fallback !== undefined ? fallback : this._config.DEFAULT_DAP_CONFIG;
    const expectedLayoutLength = Number.isInteger(layoutLength) && layoutLength >= 0 ? layoutLength : 0;
    const safeFallback =
      effectiveFallback && typeof effectiveFallback === 'object'
        ? {
            enabled: Boolean(effectiveFallback.enabled),
            playlistIndex: LayoutStateService.normalizePlaylistTrackIndex(effectiveFallback.playlistIndex),
            volumePercent: this.normalizeDapVolumePercent(effectiveFallback.volumePercent, this._config.DAP_DEFAULT_VOLUME_PERCENT),
          }
        : { ...this._config.DEFAULT_DAP_CONFIG };
    const rawConfig = dapConfig && typeof dapConfig === 'object' ? dapConfig : null;

    const requestedEnabled =
      rawConfig && Object.prototype.hasOwnProperty.call(rawConfig, 'enabled')
        ? Boolean(rawConfig.enabled)
        : safeFallback.enabled;
    const requestedPlaylistIndex =
      rawConfig && Object.prototype.hasOwnProperty.call(rawConfig, 'playlistIndex')
        ? LayoutStateService.normalizePlaylistTrackIndex(rawConfig.playlistIndex)
        : safeFallback.playlistIndex;
    const playlistIndex =
      requestedPlaylistIndex !== null &&
      requestedPlaylistIndex >= 0 &&
      requestedPlaylistIndex < expectedLayoutLength
        ? requestedPlaylistIndex
        : null;
    const volumePercent = this.normalizeDapVolumePercent(
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

  normalizePlaylistAutoplayWithDap(playlistAutoplay, dapConfig, layoutLength) {
    const normalized = LayoutStateService.normalizePlaylistAutoplayFlags(playlistAutoplay, layoutLength);
    const sanitizedDap = this.sanitizeDapConfig(dapConfig, layoutLength, this._config.DEFAULT_DAP_CONFIG);
    if (sanitizedDap.enabled && sanitizedDap.playlistIndex !== null) {
      normalized[sanitizedDap.playlistIndex] = true;
    }
    return normalized;
  }

  sanitizeTrackTitleMode(value) {
    return value === this._config.TRACK_TITLE_MODE_ATTRIBUTES ? this._config.TRACK_TITLE_MODE_ATTRIBUTES : null;
  }

  sanitizeTrackTitleModesByTrack(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const result = {};
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'ru'));

    for (const [rawKey, rawMode] of entries) {
      if (typeof rawKey !== 'string') continue;
      const normalizedKey = rawKey.trim().slice(0, this._config.TRACK_TITLE_KEY_MAX_LENGTH);
      if (!normalizedKey) continue;

      const normalizedMode = this.sanitizeTrackTitleMode(rawMode);
      if (!normalizedMode) continue;

      result[normalizedKey] = normalizedMode;
    }

    return result;
  }

  static sanitizeFolderKey(value) {
    if (typeof value !== 'string') return null;
    const normalized = value
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/');
    if (!normalized) return null;
    return normalized.slice(0, 512);
  }

  sanitizeFolderOriginalName(value, fallback) {
    if (typeof value === 'string') {
      const normalized = value.trim().replace(/\s+/g, ' ');
      if (normalized) {
        return normalized.slice(0, this._config.PLAYLIST_NAME_MAX_LENGTH);
      }
    }

    if (typeof fallback === 'string') {
      const normalizedFallback = fallback.trim().replace(/\s+/g, ' ');
      if (normalizedFallback) {
        return normalizedFallback.slice(0, this._config.PLAYLIST_NAME_MAX_LENGTH);
      }
    }

    return '';
  }

  sanitizePlaylistMetaEntry(value) {
    if (!value || typeof value !== 'object') {
      return { type: 'manual' };
    }

    if (value.type !== 'folder') {
      return { type: 'manual' };
    }

    const folderKey = LayoutStateService.sanitizeFolderKey(value.folderKey);
    if (!folderKey) {
      return { type: 'manual' };
    }

    const fallbackName = this._path.basename(folderKey) || folderKey;
    return {
      type: 'folder',
      folderKey,
      folderOriginalName: this.sanitizeFolderOriginalName(value.folderOriginalName, fallbackName),
    };
  }

  normalizePlaylistMeta(playlistMeta, layoutLength) {
    const result = [];

    for (let index = 0; index < layoutLength; index += 1) {
      const rawValue = Array.isArray(playlistMeta) ? playlistMeta[index] : null;
      result.push(this.sanitizePlaylistMetaEntry(rawValue));
    }

    return result;
  }

  static normalizePlaylistTrackIndex(value) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isInteger(numeric) || numeric < 0) return null;
    return numeric;
  }

  normalizeLiveVolumePreset(value, fallback) {
    const effectiveFallback = fallback !== undefined ? fallback : this._config.DEFAULT_LIVE_VOLUME;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return effectiveFallback;
    const normalized = Math.max(0, Math.min(1, numeric));

    if (Math.abs(normalized - 1) < 0.0001) {
      return 1;
    }
    return normalized;
  }

  hasActiveVolumePreset(value) {
    const normalized = this.normalizeLiveVolumePreset(value, this._config.DEFAULT_LIVE_VOLUME);
    for (const preset of this._config.LIVE_VOLUME_PRESET_VALUES) {
      if (Math.abs(normalized - preset) < 0.0001) {
        return true;
      }
    }
    return false;
  }

  static normalizePlaybackSeekRatio(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric <= 0) return 0;
    if (numeric >= 1) return 1;
    return numeric;
  }

  sanitizeDapPlaybackState(rawPlayback) {
    const base = LayoutStateService.getDefaultDapPlaybackState();
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
      playlistIndex: LayoutStateService.normalizePlaylistTrackIndex(rawPlayback.playlistIndex),
      playlistPosition: LayoutStateService.normalizePlaylistTrackIndex(rawPlayback.playlistPosition),
      interrupted: Boolean(rawPlayback.interrupted),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    };
  }

  sanitizePlaybackState(rawPlayback) {
    if (!rawPlayback || typeof rawPlayback !== 'object') {
      return {
        ...this.getDefaultPlaybackState(),
        updatedAt: Date.now(),
      };
    }

    const dapPlayback = this.sanitizeDapPlaybackState(rawPlayback.dapPlayback);
    const volume = this.normalizeLiveVolumePreset(rawPlayback.volume, this._config.DEFAULT_LIVE_VOLUME);
    const hasExplicitShowVolumePresets = Object.prototype.hasOwnProperty.call(rawPlayback, 'showVolumePresets');
    let showVolumePresets = hasExplicitShowVolumePresets ? Boolean(rawPlayback.showVolumePresets) : this.hasActiveVolumePreset(volume);
    if (!showVolumePresets && this.hasActiveVolumePreset(volume)) {
      showVolumePresets = true;
    }
    const allowLiveSeek = Boolean(rawPlayback.allowLiveSeek);
    const overlaySeconds = ConfigManager.parseBoundedNumberConfigValue(rawPlayback.overlaySeconds, 0, { min: 0, max: 120 });
    const nextDspSliceSeconds = ConfigManager.parseBoundedNumberConfigValue(rawPlayback.nextDspSliceSeconds, 0, { min: 0, max: 120 });
    let nextDspSourceSeconds = ConfigManager.parseBoundedNumberConfigValue(rawPlayback.nextDspSourceSeconds, 0, {
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
        ...this.getDefaultPlaybackState(),
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
      playlistIndex: LayoutStateService.normalizePlaylistTrackIndex(rawPlayback.playlistIndex),
      playlistPosition: LayoutStateService.normalizePlaylistTrackIndex(rawPlayback.playlistPosition),
      updatedAt: Date.now(),
    };
  }

  // ── Group 3: Playback helpers ─────────────────────────────────────

  static hasLivePlaybackTrack(state) {
    return Boolean(state && typeof state.trackFile === 'string' && state.trackFile.trim());
  }

  isDeletingLivePlaybackPlaylist(nextLayout) {
    if (!LayoutStateService.hasLivePlaybackTrack(this._playbackState)) return false;

    const livePlaylistIndex = LayoutStateService.normalizePlaylistTrackIndex(this._playbackState.playlistIndex);
    if (livePlaylistIndex === null) return false;

    if (!Array.isArray(this._layoutState.layout[livePlaylistIndex])) return false;
    return !Array.isArray(nextLayout[livePlaylistIndex]);
  }

  static detectRemovedPlaylistIndex(previousLayout, nextLayout) {
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

  // ── Group 4: Layout persistence ───────────────────────────────────

  loadPersistedLayoutState() {
    try {
      if (!this._fs.existsSync(this._config.LAYOUT_STATE_PATH)) {
        return this.getDefaultLayoutState();
      }

      const raw = this._fs.readFileSync(this._config.LAYOUT_STATE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const sanitizedLayout = LayoutStateService.sanitizeLayout(parsed.layout);
      if (!sanitizedLayout) {
        return this.getDefaultLayoutState();
      }
      const sanitizedNames = this.normalizePlaylistNames(parsed.playlistNames, sanitizedLayout.length);
      const sanitizedMeta = this.normalizePlaylistMeta(parsed.playlistMeta, sanitizedLayout.length);
      const persistedDap = this.sanitizeDapConfig(parsed.dapConfig, sanitizedLayout.length, this._config.DEFAULT_DAP_CONFIG);
      // DAP must always start disabled after server reboot, while preserving selected playlist/volume.
      const sanitizedDap = {
        ...persistedDap,
        enabled: false,
      };
      const sanitizedAutoplay = this.normalizePlaylistAutoplayWithDap(
        parsed.playlistAutoplay,
        sanitizedDap,
        sanitizedLayout.length,
      );
      const sanitizedDsp = LayoutStateService.normalizePlaylistDspFlags(parsed.playlistDsp, sanitizedAutoplay, sanitizedLayout.length);
      const sanitizedTrackTitleModes = this.sanitizeTrackTitleModesByTrack(parsed.trackTitleModesByTrack);

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
      return this.getDefaultLayoutState();
    }
  }

  persistLayoutState(state) {
    try {
      this._fs.writeFileSync(this._config.LAYOUT_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to persist layout state cache', err);
    }
  }

  // ── Group 5: Serialization + broadcasting ─────────────────────────

  static sanitizeClientId(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    return normalized.slice(0, 128);
  }

  serializePlaybackState(state) {
    return JSON.stringify({
      trackFile: typeof state.trackFile === 'string' ? state.trackFile : null,
      paused: Boolean(state.paused),
      currentTime: Number.isFinite(state.currentTime) && state.currentTime >= 0 ? state.currentTime : 0,
      duration: Number.isFinite(state.duration) && state.duration > 0 ? state.duration : null,
      volume: this.normalizeLiveVolumePreset(state.volume, this._config.DEFAULT_LIVE_VOLUME),
      showVolumePresets: Boolean(state.showVolumePresets),
      allowLiveSeek: Boolean(state.allowLiveSeek),
      dapPlayback: (() => {
        const normalizedDap = this.sanitizeDapPlaybackState(state.dapPlayback);
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
      overlaySeconds: ConfigManager.parseBoundedNumberConfigValue(state.overlaySeconds, 0, { min: 0, max: 120 }),
      nextDspSliceSeconds: ConfigManager.parseBoundedNumberConfigValue(state.nextDspSliceSeconds, 0, { min: 0, max: 120 }),
      nextDspSourceSeconds: ConfigManager.parseBoundedNumberConfigValue(state.nextDspSourceSeconds, 0, { min: 0, max: 120 }),
      playlistIndex: LayoutStateService.normalizePlaylistTrackIndex(state.playlistIndex),
      playlistPosition: LayoutStateService.normalizePlaylistTrackIndex(state.playlistPosition),
    });
  }

  buildLayoutPayload(sourceClientId = null) {
    return {
      layout: this._layoutState.layout,
      playlistNames: this._layoutState.playlistNames,
      playlistMeta: this._layoutState.playlistMeta,
      playlistAutoplay: this._layoutState.playlistAutoplay,
      playlistDsp: this._layoutState.playlistDsp,
      dapConfig: this._layoutState.dapConfig,
      trackTitleModesByTrack: this._layoutState.trackTitleModesByTrack,
      version: this._layoutState.version,
      updatedAt: this._layoutState.updatedAt,
      sourceClientId,
    };
  }

  buildPlaybackPayload(sourceClientId = null) {
    const normalizedDapPlayback = this.sanitizeDapPlaybackState(this._playbackState.dapPlayback);
    return {
      trackFile: this._playbackState.trackFile,
      paused: this._playbackState.paused,
      currentTime: this._playbackState.currentTime,
      duration: this._playbackState.duration,
      volume: this._playbackState.volume,
      showVolumePresets: Boolean(this._playbackState.showVolumePresets),
      allowLiveSeek: Boolean(this._playbackState.allowLiveSeek),
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
      overlaySeconds: ConfigManager.parseBoundedNumberConfigValue(this._playbackState.overlaySeconds, 0, { min: 0, max: 120 }),
      nextDspSliceSeconds: ConfigManager.parseBoundedNumberConfigValue(this._playbackState.nextDspSliceSeconds, 0, {
        min: 0,
        max: 120,
      }),
      nextDspSourceSeconds: ConfigManager.parseBoundedNumberConfigValue(this._playbackState.nextDspSourceSeconds, 0, {
        min: 0,
        max: 120,
      }),
      playlistIndex: this._playbackState.playlistIndex,
      playlistPosition: this._playbackState.playlistPosition,
      updatedAt: this._playbackState.updatedAt,
      sourceClientId,
    };
  }

  static sendSseEvent(res, eventName, payload) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  broadcastLayoutUpdate(sourceClientId = null) {
    const payload = this.buildLayoutPayload(sourceClientId);

    for (const res of this._layoutSubscribers) {
      try {
        LayoutStateService.sendSseEvent(res, 'layout', payload);
      } catch (err) {
        this._layoutSubscribers.delete(res);
      }
    }
  }

  broadcastPlaybackUpdate(sourceClientId = null) {
    const payload = this.buildPlaybackPayload(sourceClientId);

    for (const res of this._layoutSubscribers) {
      try {
        LayoutStateService.sendSseEvent(res, 'playback', payload);
      } catch (err) {
        this._layoutSubscribers.delete(res);
      }
    }
  }

  broadcastAuthUsersUpdate(sourceClientId = null) {
    const payload = this._buildAuthUsersPayload(sourceClientId);

    for (const res of this._layoutSubscribers) {
      try {
        LayoutStateService.sendSseEvent(res, 'auth-users', payload);
      } catch (err) {
        this._layoutSubscribers.delete(res);
      }
    }
  }

  broadcastPlaybackCommand(commandPayload) {
    if (!commandPayload || typeof commandPayload !== 'object') return;

    for (const res of this._layoutSubscribers) {
      try {
        LayoutStateService.sendSseEvent(res, 'playback-command', commandPayload);
      } catch (err) {
        this._layoutSubscribers.delete(res);
      }
    }
  }

  keepLayoutStreamAlive() {
    for (const res of this._layoutSubscribers) {
      try {
        res.write(': ping\n\n');
      } catch (err) {
        this._layoutSubscribers.delete(res);
      }
    }
  }
}

module.exports = { LayoutStateService };
