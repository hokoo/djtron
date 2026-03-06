'use strict';

/**
 * PlaybackGateway — facade between HTTP transport and playback domain.
 *
 * Encapsulates playback state mutations, snapshot building, command dispatch,
 * and broadcast. Handlers call gateway methods instead of touching shared state
 * or broadcast functions directly.
 */
class PlaybackGateway {
  /**
   * @param {object} deps
   * @param {function} deps.getState - () => sharedPlaybackState
   * @param {function} deps.setState - (nextState) => void
   * @param {function} deps.sanitizeState - (raw) => sanitized playback state
   * @param {function} deps.serializeState - (state) => string (for change detection)
   * @param {function} deps.buildPayload - (sourceClientId) => payload object
   * @param {function} deps.broadcastUpdate - (sourceClientId) => void
   * @param {function} deps.sanitizeCommand - (rawCommand) => command | null
   * @param {function} deps.sanitizeClientId - (value) => string | null
   * @param {function} deps.sanitizeSessionRole - (value) => string
   * @param {object} deps.commandBus - { dispatch(context, payload) }
   * @param {string} deps.ROLE_HOST
   */
  constructor(deps) {
    this._getState = deps.getState;
    this._setState = deps.setState;
    this._sanitizeState = deps.sanitizeState;
    this._serializeState = deps.serializeState;
    this._buildPayload = deps.buildPayload;
    this._broadcastUpdate = deps.broadcastUpdate;
    this._sanitizeCommand = deps.sanitizeCommand;
    this._sanitizeClientId = deps.sanitizeClientId;
    this._sanitizeSessionRole = deps.sanitizeSessionRole;
    this._commandBus = deps.commandBus;
    this._ROLE_HOST = deps.ROLE_HOST;
  }

  /** Build a playback state snapshot. */
  getSnapshot(sourceClientId) {
    return this._buildPayload(sourceClientId || null);
  }

  /**
   * Apply a full playback state update (host-only, enforced by router auth).
   * @returns {{ payload: object, changed: boolean }}
   */
  updateState(body) {
    const nextState = this._sanitizeState(body);
    const sourceClientId = this._sanitizeClientId(body.clientId);
    const currentState = this._getState();
    const hasChanged = this._serializeState(nextState) !== this._serializeState(currentState);

    if (hasChanged) {
      this._setState(nextState);
      this._broadcastUpdate(sourceClientId);
    }

    return { payload: this._buildPayload(sourceClientId), changed: hasChanged };
  }

  /**
   * Dispatch a playback command (session auth; role policy is enforced by command bus).
   * @returns {{ ok: boolean, status: number, payload?: object, error?: string }}
   */
  async dispatchCommand(body, auth) {
    const command = this._sanitizeCommand(body);
    if (!command) {
      return { ok: false, status: 400, error: 'Некорректная команда воспроизведения' };
    }
    const normalizeOrigin = (value, fallback = 'api') => {
      if (value === 'ui' || value === 'api' || value === 'system') return value;
      return fallback;
    };
    const sourceRole = auth.isServer ? this._ROLE_HOST : this._sanitizeSessionRole(auth.role);
    const explicitActorRole = body && Object.prototype.hasOwnProperty.call(body, 'actorRole')
      ? this._sanitizeSessionRole(body.actorRole)
      : null;
    const actorRole = explicitActorRole || sourceRole;

    const payload = {
      ...command,
      origin: normalizeOrigin(body && body.origin, auth.isServer ? 'system' : 'api'),
      actorRole,
      issuedAt: Date.now(),
      sourceClientId: this._sanitizeClientId(body.clientId),
      sourceRole,
      sourceUsername: auth.username,
    };

    const result = await this._commandBus.dispatch(
      {
        sourceRole: payload.sourceRole,
        commandType: payload.type,
        isServer: auth.isServer,
        target: payload.target || 'host',
      },
      payload,
    );

    if (!result.ok) {
      return { ok: false, status: 403, error: result.message };
    }

    return { ok: true, status: 200, payload: { ok: true, command: payload } };
  }
  /**
   * Sanitize a raw playback command into a normalized form.
   * @param {object} rawCommand
   * @param {object} layoutService - LayoutStateService instance for volume/seek helpers
   * @returns {object|null}
   */
  static sanitizePlaybackCommand(rawCommand, layoutService) {
    if (!rawCommand || typeof rawCommand !== 'object') return null;

    const commandType = typeof rawCommand.type === 'string' ? rawCommand.type.trim() : '';
    const targetRaw = typeof rawCommand.target === 'string' ? rawCommand.target.trim() : '';
    const target = targetRaw === 'self' ? 'self' : 'host';
    const normalizeIdentity = (value, maxLength) =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;
    const normalizeTrackIndex = (value) => {
      const numeric = Number.parseInt(value, 10);
      if (!Number.isInteger(numeric) || numeric < 0) return null;
      return numeric;
    };
    const normalizeStartOffset = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) return null;
      return numeric;
    };
    const normalizePlayNextTrackFile = () => {
      const directFile = typeof rawCommand.file === 'string' ? rawCommand.file.trim() : '';
      if (directFile) return directFile;

      const rawTrackRef =
        rawCommand.trackRef && typeof rawCommand.trackRef === 'object'
          ? rawCommand.trackRef
          : (rawCommand.track && typeof rawCommand.track === 'object' ? rawCommand.track : null);
      if (!rawTrackRef) return '';

      const fileFromRef = typeof rawTrackRef.file === 'string' ? rawTrackRef.file.trim() : '';
      if (fileFromRef) return fileFromRef;

      const srcFromRef = typeof rawTrackRef.src === 'string' ? rawTrackRef.src.trim() : '';
      if (!srcFromRef) return '';

      let normalizedSrc = srcFromRef;
      if (normalizedSrc.startsWith('/audio/')) {
        normalizedSrc = normalizedSrc.slice('/audio/'.length);
      } else if (normalizedSrc.startsWith('audio/')) {
        normalizedSrc = normalizedSrc.slice('audio/'.length);
      }

      try {
        normalizedSrc = decodeURIComponent(normalizedSrc);
      } catch (_) {
        // Keep undecoded value if payload contains malformed percent-encoding.
      }

      return normalizedSrc.replace(/^\/+/, '').trim();
    };

    if (commandType === 'stop') {
      return { type: 'stop', target };
    }

    if (commandType === 'toggle-current') {
      return { type: 'toggle-current', target };
    }

    if (commandType === 'set-volume') {
      const volume = layoutService.normalizeLiveVolumePreset(rawCommand.volume, null);
      if (volume === null) return null;
      return { type: 'set-volume', volume, target };
    }

    if (commandType === 'set-volume-presets-visible') {
      return {
        type: 'set-volume-presets-visible',
        showVolumePresets: Boolean(rawCommand.showVolumePresets),
        target,
      };
    }

    if (commandType === 'set-live-seek-enabled') {
      return {
        type: 'set-live-seek-enabled',
        allowLiveSeek: Boolean(rawCommand.allowLiveSeek),
        target,
      };
    }

    if (commandType === 'seek-current') {
      const { LayoutStateService } = require('../layout/LayoutStateService');
      const positionRatio = LayoutStateService.normalizePlaybackSeekRatio(rawCommand.positionRatio);
      if (positionRatio === null) return null;
      return {
        type: 'seek-current',
        positionRatio,
        finalize: Boolean(rawCommand.finalize),
        target,
      };
    }

    if (commandType === 'play-next-request') {
      const file = normalizePlayNextTrackFile();
      if (!file) return null;
      const strategy = rawCommand.strategy === 'create-new-playnext-playlist'
        ? 'create-new-playnext-playlist'
        : 'copy-into-active';

      return {
        type: 'play-next-request',
        file,
        strategy,
        fifoSession: Boolean(rawCommand.fifoSession),
        playlistId: normalizeIdentity(rawCommand.playlistId, 64),
        trackId: normalizeIdentity(rawCommand.trackId, 80),
        target,
      };
    }

    if (commandType !== 'play-track') {
      return null;
    }

    const file = typeof rawCommand.file === 'string' ? rawCommand.file.trim() : '';
    if (!file) return null;
    const playlistId = normalizeIdentity(rawCommand.playlistId, 64);
    const trackId = normalizeIdentity(rawCommand.trackId, 80);
    const playlistIndex = normalizeTrackIndex(rawCommand.playlistIndex);
    const playlistPosition = normalizeTrackIndex(rawCommand.playlistPosition);
    const startAtSeconds = normalizeStartOffset(rawCommand.startAtSeconds);

    return {
      type: 'play-track',
      file,
      basePath: '/audio',
      playlistId: playlistId || null,
      trackId: trackId || null,
      playlistIndex,
      playlistPosition,
      startAtSeconds,
      fromAutoplay: Boolean(rawCommand.fromAutoplay),
      fromDspTransition: Boolean(rawCommand.fromDspTransition),
      fromDapNoSilence: Boolean(rawCommand.fromDapNoSilence),
      fromDapInterruptedResume: Boolean(rawCommand.fromDapInterruptedResume),
      target,
    };
  }
}

module.exports = { PlaybackGateway };
