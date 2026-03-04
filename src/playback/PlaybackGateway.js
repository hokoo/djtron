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
   * Dispatch a playback command (host|cohost, enforced by router auth).
   * @returns {{ ok: boolean, status: number, payload?: object, error?: string }}
   */
  async dispatchCommand(body, auth) {
    const command = this._sanitizeCommand(body);
    if (!command) {
      return { ok: false, status: 400, error: 'Некорректная команда воспроизведения' };
    }

    const payload = {
      ...command,
      issuedAt: Date.now(),
      sourceClientId: this._sanitizeClientId(body.clientId),
      sourceRole: auth.isServer ? this._ROLE_HOST : this._sanitizeSessionRole(auth.role),
      sourceUsername: auth.username,
    };

    const result = await this._commandBus.dispatch(
      {
        sourceRole: payload.sourceRole,
        commandType: payload.type,
        isServer: auth.isServer,
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
    if (commandType === 'toggle-current') {
      return { type: 'toggle-current' };
    }

    if (commandType === 'set-volume') {
      const volume = layoutService.normalizeLiveVolumePreset(rawCommand.volume, null);
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
      const { LayoutStateService } = require('../layout/LayoutStateService');
      const positionRatio = LayoutStateService.normalizePlaybackSeekRatio(rawCommand.positionRatio);
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

    const { LayoutStateService } = require('../layout/LayoutStateService');
    const file = typeof rawCommand.file === 'string' ? rawCommand.file.trim() : '';
    if (!file) return null;

    return {
      type: 'play-track',
      file,
      basePath: '/audio',
      playlistIndex: LayoutStateService.normalizePlaylistTrackIndex(rawCommand.playlistIndex),
      playlistPosition: LayoutStateService.normalizePlaylistTrackIndex(rawCommand.playlistPosition),
    };
  }
}

module.exports = { PlaybackGateway };
