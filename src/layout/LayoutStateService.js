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

  // ── Group 1: Defaults ──────────────────────────────────────────────

  static defaultPlaylistId(index) {
    return `p-${Math.max(0, index)}`;
  }

  static defaultPlaylistName(index) {
    return `Плей-лист ${index + 1}`;
  }

  createDefaultPlaylist(index = 0) {
    return {
      id: LayoutStateService.defaultPlaylistId(index),
      name: LayoutStateService.defaultPlaylistName(index),
      type: 'manual',
      tracks: [],
      settings: {
        autoPlayEnabled: false,
        dspEnabled: false,
      },
      uiState: null,
    };
  }

  getDefaultLayoutState() {
    return {
      version: 0,
      updatedAt: 0,
      playlists: [this.createDefaultPlaylist(0)],
      dapConfig: {
        enabled: false,
        playlistId: null,
        volumePercent: this.normalizeDapVolumePercent(this._config.DAP_DEFAULT_VOLUME_PERCENT),
      },
      trackTitleModesByTrack: {},
    };
  }

  getDefaultPlaybackState() {
    return {
      trackFile: null,
      trackId: null,
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
      playlistId: null,
      updatedAt: 0,
    };
  }

  static getDefaultDapPlaybackState() {
    return {
      trackFile: null,
      trackId: null,
      paused: false,
      currentTime: 0,
      duration: null,
      playlistId: null,
      interrupted: false,
      updatedAt: 0,
    };
  }

  // ── Group 2: Layout sanitization/normalization ─────────────────────

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

  sanitizePlaylistId(value, index = 0) {
    if (typeof value === 'string') {
      const normalized = value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 64);
      if (normalized) return normalized;
    }
    return LayoutStateService.defaultPlaylistId(index);
  }

  sanitizeTrackId(value, playlistId, index = 0) {
    if (typeof value === 'string') {
      const normalized = value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
      if (normalized) return normalized;
    }
    return `${playlistId}-t-${Math.max(0, index)}`;
  }

  sanitizeTrackSrc(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('/audio/')) {
      return trimmed;
    }
    if (trimmed.startsWith('audio/')) {
      return `/${trimmed}`;
    }
    return `/audio/${trimmed.replace(/^\/+/, '')}`;
  }

  static trackSrcToRelativePath(src) {
    if (typeof src !== 'string') return '';
    let normalized = src.trim();
    if (!normalized) return '';

    normalized = normalized.replace(/^https?:\/\/[^/]+/i, '');
    const queryIndex = normalized.indexOf('?');
    if (queryIndex >= 0) normalized = normalized.slice(0, queryIndex);
    const hashIndex = normalized.indexOf('#');
    if (hashIndex >= 0) normalized = normalized.slice(0, hashIndex);

    if (normalized.startsWith('/audio/')) {
      normalized = normalized.slice('/audio/'.length);
    } else if (normalized.startsWith('audio/')) {
      normalized = normalized.slice('audio/'.length);
    } else {
      normalized = normalized.replace(/^\/+/, '');
    }

    return normalized.trim();
  }

  sanitizePlaylistTrack(rawTrack, playlistId, trackIndex, usedTrackIds) {
    const raw = rawTrack && typeof rawTrack === 'object' ? rawTrack : null;
    const rawSrc = raw
      ? (typeof raw.src === 'string' ? raw.src : (typeof raw.file === 'string' ? raw.file : raw.path))
      : rawTrack;
    const src = this.sanitizeTrackSrc(rawSrc);
    if (!src) return null;

    let trackId = this.sanitizeTrackId(raw ? raw.id : null, playlistId, trackIndex);
    if (usedTrackIds.has(trackId)) {
      let suffix = 1;
      while (usedTrackIds.has(`${trackId}-${suffix}`)) suffix += 1;
      trackId = `${trackId}-${suffix}`;
    }
    usedTrackIds.add(trackId);

    const meta = {};
    const titleMode = this.sanitizeTrackTitleMode(raw && raw.meta ? raw.meta.titleMode : null);
    if (titleMode) {
      meta.titleMode = titleMode;
    }

    const originalPath = LayoutStateService.trackSrcToRelativePath(src);
    if (originalPath) {
      meta.originalPath = originalPath;
    }

    return {
      id: trackId,
      src,
      meta,
    };
  }

  sanitizePlaylist(rawPlaylist, index, usedPlaylistIds) {
    const raw = rawPlaylist && typeof rawPlaylist === 'object' && !Array.isArray(rawPlaylist)
      ? rawPlaylist
      : {};

    let playlistId = this.sanitizePlaylistId(raw.id, index);
    if (usedPlaylistIds.has(playlistId)) {
      let suffix = 1;
      while (usedPlaylistIds.has(`${playlistId}-${suffix}`)) suffix += 1;
      playlistId = `${playlistId}-${suffix}`;
    }
    usedPlaylistIds.add(playlistId);

    const type = raw.type === 'folder' ? 'folder' : 'manual';

    const tracksRaw = Array.isArray(raw.tracks) ? raw.tracks : [];
    const usedTrackIds = new Set();
    const tracks = [];
    tracksRaw.forEach((track, trackIndex) => {
      const normalized = this.sanitizePlaylistTrack(track, playlistId, trackIndex, usedTrackIds);
      if (normalized) tracks.push(normalized);
    });

    const settingsRaw = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const autoPlayEnabled = Boolean(settingsRaw.autoPlayEnabled);
    const dspEnabled = Boolean(settingsRaw.dspEnabled) && autoPlayEnabled;

    const playlist = {
      id: playlistId,
      name: this.sanitizePlaylistName(raw.name, index),
      type,
      tracks,
      settings: {
        autoPlayEnabled,
        dspEnabled,
      },
      uiState: typeof raw.uiState === 'string' && raw.uiState.trim() ? raw.uiState.trim().slice(0, 64) : null,
    };

    if (type === 'folder') {
      const folderKey = LayoutStateService.sanitizeFolderKey(raw.folderKey);
      if (folderKey) {
        const fallbackName = this._path.basename(folderKey) || folderKey;
        playlist.folderKey = folderKey;
        playlist.folderOriginalName = this.sanitizeFolderOriginalName(raw.folderOriginalName, fallbackName);
      } else {
        playlist.type = 'manual';
      }
    }

    return playlist;
  }

  sanitizePlaylists(playlists) {
    if (!Array.isArray(playlists)) return null;

    const usedPlaylistIds = new Set();
    const normalized = [];
    playlists.forEach((playlist, index) => {
      const sanitized = this.sanitizePlaylist(playlist, index, usedPlaylistIds);
      if (sanitized) normalized.push(sanitized);
    });

    if (!normalized.length) {
      normalized.push(this.createDefaultPlaylist(0));
    }

    return normalized;
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

  sanitizeDapConfig(dapConfig, playlists, fallback) {
    const availablePlaylists = Array.isArray(playlists) ? playlists : [];
    const playlistIds = new Set(availablePlaylists.map((item) => item.id));

    const safeFallbackRaw = fallback && typeof fallback === 'object' ? fallback : this._config.DEFAULT_DAP_CONFIG || {};
    const safeFallbackId =
      typeof safeFallbackRaw.playlistId === 'string' && safeFallbackRaw.playlistId.trim()
        ? safeFallbackRaw.playlistId.trim()
        : (() => {
            const fallbackIndex = LayoutStateService.normalizePlaylistTrackIndex(safeFallbackRaw.playlistIndex);
            if (fallbackIndex === null || !availablePlaylists[fallbackIndex]) return null;
            return availablePlaylists[fallbackIndex].id;
          })();

    const raw = dapConfig && typeof dapConfig === 'object' ? dapConfig : null;
    const requestedEnabled = raw && Object.prototype.hasOwnProperty.call(raw, 'enabled')
      ? Boolean(raw.enabled)
      : Boolean(safeFallbackRaw.enabled);

    let requestedPlaylistId = raw && typeof raw.playlistId === 'string' ? raw.playlistId.trim() : '';
    if (!requestedPlaylistId && raw && Object.prototype.hasOwnProperty.call(raw, 'playlistIndex')) {
      const rawIndex = LayoutStateService.normalizePlaylistTrackIndex(raw.playlistIndex);
      if (rawIndex !== null && availablePlaylists[rawIndex]) {
        requestedPlaylistId = availablePlaylists[rawIndex].id;
      }
    }
    if (!requestedPlaylistId && typeof safeFallbackId === 'string') {
      requestedPlaylistId = safeFallbackId;
    }

    const playlistId = requestedPlaylistId && playlistIds.has(requestedPlaylistId) ? requestedPlaylistId : null;
    const enabled = Boolean(requestedEnabled && playlistId);

    const volumePercent = this.normalizeDapVolumePercent(
      raw && Object.prototype.hasOwnProperty.call(raw, 'volumePercent') ? raw.volumePercent : safeFallbackRaw.volumePercent,
      safeFallbackRaw.volumePercent,
    );

    return {
      enabled,
      playlistId,
      volumePercent,
    };
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
    const trackId = typeof rawPlayback.trackId === 'string' ? rawPlayback.trackId.trim().slice(0, 80) : null;
    const playlistId = typeof rawPlayback.playlistId === 'string' ? rawPlayback.playlistId.trim().slice(0, 64) : null;

    if (!trackFile) {
      const updatedAt = Number(rawPlayback.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt > 0) {
        base.updatedAt = updatedAt;
      }
      base.trackId = trackId || null;
      base.playlistId = playlistId || null;
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
      trackId: trackId || null,
      paused: Boolean(rawPlayback.paused),
      currentTime,
      duration,
      playlistId: playlistId || null,
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
    const trackId = typeof rawPlayback.trackId === 'string' ? rawPlayback.trackId.trim().slice(0, 80) : null;
    const playlistId = typeof rawPlayback.playlistId === 'string' ? rawPlayback.playlistId.trim().slice(0, 64) : null;
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
        trackId,
        playlistId,
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
      trackId,
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
      playlistId,
      updatedAt: Date.now(),
    };
  }

  // ── Group 3: Playback/Layout constraints ───────────────────────────

  static hasLivePlaybackTrack(state) {
    return Boolean(state && typeof state.trackFile === 'string' && state.trackFile.trim());
  }

  isDeletingLivePlaybackPlaylist(nextPlaylists) {
    if (!LayoutStateService.hasLivePlaybackTrack(this._playbackState)) return false;

    const playlistId = typeof this._playbackState.playlistId === 'string' ? this._playbackState.playlistId.trim() : '';
    if (playlistId) {
      return !Array.isArray(nextPlaylists) || !nextPlaylists.some((playlist) => playlist && playlist.id === playlistId);
    }

    const trackId = typeof this._playbackState.trackId === 'string' ? this._playbackState.trackId.trim() : '';
    if (!trackId) return false;
    if (!Array.isArray(nextPlaylists)) return true;
    return !nextPlaylists.some((playlist) =>
      Array.isArray(playlist && playlist.tracks) &&
      playlist.tracks.some((track) => track && track.id === trackId),
    );
  }

  // ── Group 4: Persistence ────────────────────────────────────────────

  loadPersistedLayoutState() {
    try {
      if (!this._fs.existsSync(this._config.LAYOUT_STATE_PATH)) {
        return this.getDefaultLayoutState();
      }

      const raw = this._fs.readFileSync(this._config.LAYOUT_STATE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const playlists = this.sanitizePlaylists(parsed.playlists);
      if (!playlists) {
        return this.getDefaultLayoutState();
      }

      const persistedDap = this.sanitizeDapConfig(parsed.dapConfig, playlists, this._config.DEFAULT_DAP_CONFIG);
      const sanitizedDap = {
        ...persistedDap,
        enabled: false,
      };
      const sanitizedTrackTitleModes = this.sanitizeTrackTitleModesByTrack(parsed.trackTitleModesByTrack);

      const version = Number(parsed.version);
      const updatedAt = Number(parsed.updatedAt);

      return {
        version: Number.isFinite(version) && version >= 0 ? version : 0,
        updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
        playlists,
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
      trackId: typeof state.trackId === 'string' ? state.trackId : null,
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
          trackId: normalizedDap.trackId,
          paused: normalizedDap.paused,
          currentTime: normalizedDap.currentTime,
          duration: normalizedDap.duration,
          playlistId: normalizedDap.playlistId,
          interrupted: normalizedDap.interrupted,
        };
      })(),
      overlaySeconds: ConfigManager.parseBoundedNumberConfigValue(state.overlaySeconds, 0, { min: 0, max: 120 }),
      nextDspSliceSeconds: ConfigManager.parseBoundedNumberConfigValue(state.nextDspSliceSeconds, 0, { min: 0, max: 120 }),
      nextDspSourceSeconds: ConfigManager.parseBoundedNumberConfigValue(state.nextDspSourceSeconds, 0, { min: 0, max: 120 }),
      playlistId: typeof state.playlistId === 'string' ? state.playlistId : null,
    });
  }

  buildLayoutPayload(sourceClientId = null) {
    return {
      playlists: this._layoutState.playlists,
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
      trackId: this._playbackState.trackId,
      paused: this._playbackState.paused,
      currentTime: this._playbackState.currentTime,
      duration: this._playbackState.duration,
      volume: this._playbackState.volume,
      showVolumePresets: Boolean(this._playbackState.showVolumePresets),
      allowLiveSeek: Boolean(this._playbackState.allowLiveSeek),
      dapPlayback: {
        trackFile: normalizedDapPlayback.trackFile,
        trackId: normalizedDapPlayback.trackId,
        paused: normalizedDapPlayback.paused,
        currentTime: normalizedDapPlayback.currentTime,
        duration: normalizedDapPlayback.duration,
        playlistId: normalizedDapPlayback.playlistId,
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
      playlistId: this._playbackState.playlistId,
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

  buildDspLayoutSnapshot(layoutState = this._layoutState) {
    const playlists = layoutState && Array.isArray(layoutState.playlists) ? layoutState.playlists : [];

    const layout = playlists.map((playlist) => {
      const tracks = Array.isArray(playlist && playlist.tracks) ? playlist.tracks : [];
      return tracks
        .map((track) => LayoutStateService.trackSrcToRelativePath(track && track.src))
        .filter(Boolean);
    });

    const playlistDsp = playlists.map((playlist) => {
      const settings = playlist && playlist.settings && typeof playlist.settings === 'object' ? playlist.settings : {};
      return Boolean(settings.dspEnabled) && Boolean(settings.autoPlayEnabled);
    });

    return { layout, playlistDsp };
  }

  /**
   * Apply a layout update from the API handler.
   * @param {object} body - parsed request body
   * @param {object} options
   * @param {boolean} options.isServer - whether request comes from server
   * @param {function} [options.onLayoutChanged] - called with layoutState after a change is persisted
   * @returns {{ status: number, payload: object }}
   */
  applyLayoutUpdate(body, { isServer, onLayoutChanged } = {}) {
    if (!body || typeof body !== 'object') {
      return { status: 400, payload: { error: 'Неверный формат состояния layout' } };
    }

    const nextPlaylists = this.sanitizePlaylists(body.playlists);
    if (!nextPlaylists) {
      return { status: 400, payload: { error: 'Неверный формат playlists' } };
    }

    if (this.isDeletingLivePlaybackPlaylist(nextPlaylists)) {
      return { status: 409, payload: { error: 'Нельзя удалить плей-лист, который сейчас играет на лайве.' } };
    }

    const currentDapConfig = this.sanitizeDapConfig(
      this._layoutState.dapConfig,
      this._layoutState.playlists,
      this._config.DEFAULT_DAP_CONFIG,
    );

    if (
      !isServer &&
      currentDapConfig.enabled &&
      currentDapConfig.playlistId &&
      !nextPlaylists.some((playlist) => playlist.id === currentDapConfig.playlistId)
    ) {
      return { status: 409, payload: { error: 'Нельзя удалить плей-лист, выбранный для DAP.' } };
    }

    const nextDapConfig = isServer
      ? this.sanitizeDapConfig(
          body && Object.prototype.hasOwnProperty.call(body, 'dapConfig') ? body.dapConfig : this._layoutState.dapConfig,
          nextPlaylists,
          currentDapConfig,
        )
      : this.sanitizeDapConfig(currentDapConfig, nextPlaylists, currentDapConfig);

    const nextTrackTitleModesByTrack = this.sanitizeTrackTitleModesByTrack(
      body && Object.prototype.hasOwnProperty.call(body, 'trackTitleModesByTrack')
        ? body.trackTitleModesByTrack
        : this._layoutState.trackTitleModesByTrack,
    );

    const sourceClientId = LayoutStateService.sanitizeClientId(body.clientId);
    const hasChanged =
      JSON.stringify(nextPlaylists) !== JSON.stringify(this._layoutState.playlists) ||
      JSON.stringify(nextDapConfig) !== JSON.stringify(this._layoutState.dapConfig) ||
      JSON.stringify(nextTrackTitleModesByTrack) !== JSON.stringify(this._layoutState.trackTitleModesByTrack);

    if (hasChanged) {
      this._layoutState = {
        playlists: nextPlaylists,
        dapConfig: nextDapConfig,
        trackTitleModesByTrack: nextTrackTitleModesByTrack,
        version: this._layoutState.version + 1,
        updatedAt: Date.now(),
      };

      this.persistLayoutState(this._layoutState);
      this.broadcastLayoutUpdate(sourceClientId);
      if (typeof onLayoutChanged === 'function') {
        onLayoutChanged(this._layoutState);
      }
    }

    return { status: 200, payload: this.buildLayoutPayload(sourceClientId) };
  }
}

module.exports = { LayoutStateService };
