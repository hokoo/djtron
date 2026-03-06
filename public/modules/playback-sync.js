// public/modules/playback-sync.js — playback state synchronization

import { COHOST_SEEK_COMMAND_INTERVAL_MS, DEFAULT_DAP_CONFIG, DEFAULT_LIVE_VOLUME, HOST_LIVE_SEEK_SYNC_INTERVAL_MS, HOST_PLAYBACK_SYNC_INTERVAL_MS, LAYOUT_STORAGE_KEY, MOBILE_PROGRESS_UI_MIN_INTERVAL_MS, PLAYBACK_COMMAND_PLAY_NEXT_REQUEST, PLAYBACK_COMMAND_PLAY_TRACK, PLAYBACK_COMMAND_SEEK_CURRENT, PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED, PLAYBACK_COMMAND_SET_VOLUME, PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE, PLAYBACK_COMMAND_STOP, PLAYBACK_COMMAND_TOGGLE_CURRENT, PLAYLIST_TYPE_FOLDER, PLAYLIST_TYPE_MANUAL, ROLE_COHOST, ROLE_HOST, ROLE_SLAVE, deriveLegacyStateFromPlaylists, state } from './state.js';
import * as api from './api.js';
import { applyLiveVolumeToCurrentAudio,
  clearAudioEngineCurrentSource, getEffectiveLiveVolume, handlePlay, pauseCurrentPlayback, resetFadeState,
  resumeCurrentPlayback, stopCurrentPlaybackImmediately,
  seekCurrentPlaybackToSeconds, setLivePlaybackVolume
} from './audio.js';
import { canDisableVolumePresetsSetting,
  formatVolumePresetLabel, getActiveVolumePresetValue, isDapVolumePresetPlaybackActive, normalizeLiveVolumePreset,
  normalizePlaybackSeekRatio
} from './config.js';
import { isCoHostRole, isHostRole, isRemoteLiveMirrorRole } from './roles.js';
import { createLayoutStream, scheduleReconnect } from './sse.js';
import { applyIncomingAuthUsers } from './ui/auth.js';
import { isDapEnabled, isDapTrackContext, updateDapSettingsUi } from './ui/dap.js';
import { syncLiveDspNextTrackHighlight } from './ui/dsp.js';
import { setLiveSeekEnabled, syncHostNowPlayingPanel, syncNowPlayingPanel } from './ui/nowplaying.js';
import { setStatus } from './ui/status.js';
import { setShowVolumePresetsEnabled, updateVolumePresetsUi } from './ui/volume.js';
import { trackKey } from './utils.js';
import { createPlaybackControllerAdapter } from './playback-controller-adapter.js';
import { PlaybackCommandBus, canDispatchLivePlaybackCommand } from '/shared/playback/index.js';

const _deps = {};

function normalizeCommandSourceRole(rawRole) {
  if (rawRole === ROLE_HOST || rawRole === ROLE_COHOST || rawRole === ROLE_SLAVE) {
    return rawRole;
  }
  return null;
}

function normalizeCommandOrigin(rawOrigin, fallback = 'ui') {
  if (rawOrigin === 'ui' || rawOrigin === 'api' || rawOrigin === 'system') {
    return rawOrigin;
  }
  return fallback;
}

function normalizePlaybackIdentity(value, maxLength = 64) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, Math.max(1, maxLength));
}

function normalizePlaybackStartOffsetSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

function resolvePlaylistTrackContextByIds({
  file = '',
  playlistId = null,
  trackId = null,
  playlistIndex = null,
  playlistPosition = null,
} = {}) {
  const normalizedFile = typeof file === 'string' ? file.trim() : '';
  const normalizedPlaylistId = normalizePlaybackIdentity(playlistId, 64);
  const normalizedTrackId = normalizePlaybackIdentity(trackId, 80);
  const preferredPlaylistIndex = normalizePlaylistTrackIndex(playlistIndex);
  const preferredPlaylistPosition = normalizePlaylistTrackIndex(playlistPosition);
  const safePlaylists = Array.isArray(state.playlists) ? state.playlists : [];

  const toResolvedContext = (candidatePlaylistIndex, candidateTrackIndex) => {
    if (!Number.isInteger(candidatePlaylistIndex) || candidatePlaylistIndex < 0 || candidatePlaylistIndex >= safePlaylists.length) {
      return null;
    }
    const playlist = safePlaylists[candidatePlaylistIndex];
    if (!playlist || !Array.isArray(playlist.tracks)) return null;
    if (!Number.isInteger(candidateTrackIndex) || candidateTrackIndex < 0 || candidateTrackIndex >= playlist.tracks.length) {
      return null;
    }
    const track = playlist.tracks[candidateTrackIndex];
    const resolvedPlaylistId = normalizePlaybackIdentity(playlist && playlist.id, 64);
    const resolvedTrackId = normalizePlaybackIdentity(track && track.id, 80);
    return {
      playlistIndex: candidatePlaylistIndex,
      playlistPosition: candidateTrackIndex,
      playlistId: resolvedPlaylistId,
      trackId: resolvedTrackId,
    };
  };

  if (preferredPlaylistIndex !== null && preferredPlaylistPosition !== null) {
    const fromPreferred = toResolvedContext(preferredPlaylistIndex, preferredPlaylistPosition);
    if (fromPreferred) {
      const playlistMatches = !normalizedPlaylistId || fromPreferred.playlistId === normalizedPlaylistId;
      const trackMatches = !normalizedTrackId || fromPreferred.trackId === normalizedTrackId;
      const fileMatches =
        !normalizedFile ||
        (() => {
          const playlist = safePlaylists[fromPreferred.playlistIndex];
          const track = playlist && Array.isArray(playlist.tracks) ? playlist.tracks[fromPreferred.playlistPosition] : null;
          return toLegacyFilePathFromTrack(track) === normalizedFile;
        })();
      if (playlistMatches && trackMatches && fileMatches) {
        return fromPreferred;
      }
    }
  }

  let playlistByIdIndex = null;
  if (normalizedPlaylistId) {
    playlistByIdIndex = safePlaylists.findIndex((playlist) => playlist && playlist.id === normalizedPlaylistId);
    if (playlistByIdIndex >= 0) {
      const playlist = safePlaylists[playlistByIdIndex];
      const tracks = Array.isArray(playlist && playlist.tracks) ? playlist.tracks : [];
      if (normalizedTrackId) {
        const matchIndex = tracks.findIndex((track) => track && track.id === normalizedTrackId);
        const resolved = toResolvedContext(playlistByIdIndex, matchIndex);
        if (resolved) return resolved;
      }
      if (normalizedFile) {
        const matchIndex = tracks.findIndex((track) => toLegacyFilePathFromTrack(track) === normalizedFile);
        const resolved = toResolvedContext(playlistByIdIndex, matchIndex);
        if (resolved) return resolved;
      }
    }
  }

  if (normalizedTrackId) {
    for (let pIndex = 0; pIndex < safePlaylists.length; pIndex += 1) {
      const playlist = safePlaylists[pIndex];
      const tracks = Array.isArray(playlist && playlist.tracks) ? playlist.tracks : [];
      const matchIndex = tracks.findIndex((track) => track && track.id === normalizedTrackId);
      const resolved = toResolvedContext(pIndex, matchIndex);
      if (resolved) return resolved;
    }
  }

  if (normalizedFile) {
    const resolvedByFile = resolveTrackContextInLayoutByFile(normalizedFile, {
      preferredPlaylistIndex: preferredPlaylistIndex !== null ? preferredPlaylistIndex : playlistByIdIndex,
      preferredPlaylistPosition,
    });
    if (resolvedByFile) {
      const resolved = toResolvedContext(resolvedByFile.playlistIndex, resolvedByFile.playlistPosition);
      if (resolved) return resolved;
    }
  }

  return {
    playlistIndex: preferredPlaylistIndex,
    playlistPosition: preferredPlaylistPosition,
    playlistId:
      normalizedPlaylistId ||
      (preferredPlaylistIndex !== null && safePlaylists[preferredPlaylistIndex]
        ? normalizePlaybackIdentity(safePlaylists[preferredPlaylistIndex].id, 64)
        : null),
    trackId:
      normalizedTrackId ||
      (() => {
        if (
          preferredPlaylistIndex === null ||
          preferredPlaylistPosition === null ||
          !safePlaylists[preferredPlaylistIndex] ||
          !Array.isArray(safePlaylists[preferredPlaylistIndex].tracks)
        ) {
          return null;
        }
        const track = safePlaylists[preferredPlaylistIndex].tracks[preferredPlaylistPosition];
        return normalizePlaybackIdentity(track && track.id, 80);
      })(),
  };
}

const outgoingLiveCommandBus = new PlaybackCommandBus({
  authorize: ({ commandType, target }) =>
    canDispatchLivePlaybackCommand({
      sourceRole: state.currentRole,
      commandType,
      isServer: false,
      target,
    }),
  execute: async (payload) => {
    const commandPayload = payload && typeof payload === 'object' ? { ...payload } : payload;
    if (commandPayload && typeof commandPayload === 'object') {
      // Keep sourceRole as backward-compatible inbound alias only.
      delete commandPayload.sourceRole;
    }
    const { ok, data } = await api.postPlaybackCommand({
      ...commandPayload,
      clientId: _deps.clientId,
    });
    if (!ok) {
      const message = data && (data.error || data.message);
      throw new Error(message || 'Не удалось отправить live-команду');
    }
  },
});

const hostLocalPlaybackCommandBus = new PlaybackCommandBus({
  authorize: ({ commandType, target }) =>
    canDispatchLivePlaybackCommand({
      sourceRole: ROLE_HOST,
      commandType,
      isServer: false,
      target,
    }),
  execute: (payload) => executeHostPlaybackCommandLocally(payload),
});

const localSelfPlaybackCommandBus = new PlaybackCommandBus({
  authorize: ({ sourceRole, commandType, target }) =>
    canDispatchLivePlaybackCommand({
      sourceRole: normalizeCommandSourceRole(sourceRole) || state.currentRole || ROLE_SLAVE,
      commandType,
      isServer: false,
      target: target === 'self' ? 'self' : 'host',
    }),
  execute: (payload, context) => executeSelfPlaybackCommandLocally(payload, context),
});

const incomingLiveCommandBus = new PlaybackCommandBus({
  authorize: ({ sourceRole, commandType, target }) =>
    canDispatchLivePlaybackCommand({
      sourceRole: normalizeCommandSourceRole(sourceRole) || ROLE_COHOST,
      commandType,
      isServer: false,
      target,
    }),
  execute: (payload) => executeHostPlaybackCommandLocally(payload),
});

const playbackControllerAdapter = createPlaybackControllerAdapter({
  getSnapshot: () => ({
    layout: _deps.ensurePlaylists(state.layout),
    playlistAutoplay: Array.isArray(state.playlistAutoplay) ? state.playlistAutoplay.slice() : [],
    playlistDsp: Array.isArray(state.playlistDsp) ? state.playlistDsp.slice() : [],
  }),
  resolvePlayTrackContext: (command) =>
    resolvePlaylistTrackContextByIds({
      file: command && command.file,
      playlistId: command && command.playlistId,
      trackId: command && command.trackId,
      playlistIndex: command && command.playlistIndex,
      playlistPosition: command && command.playlistPosition,
    }),
  resolvePlayNextAnchorContext: () => resolvePlayNextAnchorContext(),
  isTransitionPlaybackActive: () => isDspTransitionPlaybackActive(),
  onStop: async (_command, { sourceTag = '' } = {}) => {
    clearPlayNextInsertSession();
    clearPlayNextScheduledSwitch();
    stopAndClearLocalPlayback();
    requestHostPlaybackSync(true);
    setStatus(sourceTag ? `Live управление${sourceTag}: стоп.` : 'Воспроизведение остановлено.');
  },
  onToggle: async (_command, { sourceTag = '' } = {}) => {
    await toggleNowPlayingPlaybackLocally();
    if (sourceTag) {
      setStatus(`Live управление${sourceTag}.`);
    }
  },
  onPlayNext: async (command, { sourceTag = '' } = {}) => {
    await applyPlayNextRequestLocally(command);
    if (sourceTag) {
      setStatus(`Live управление${sourceTag}: Play Next.`);
    }
  },
  onPlayTrack: async (command, { sourceTag = '', target = 'host' } = {}) => {
    const resolvedContext = resolvePlaylistTrackContextByIds({
      file: command.file,
      playlistId: command.playlistId,
      trackId: command.trackId,
      playlistIndex: command.playlistIndex,
      playlistPosition: command.playlistPosition,
    });
    const button = _deps.getTrackButton(
      command.file,
      resolvedContext.playlistIndex,
      resolvedContext.playlistPosition,
      command.basePath,
    );
    if (!button) {
      if (sourceTag) {
        setStatus(`Не удалось выполнить live-команду: трек ${command.file} не найден.`);
      } else if (target === 'self') {
        setStatus(`Не удалось выполнить локальную команду: трек ${command.file} не найден.`);
      } else {
        setStatus(`Не удалось выполнить playback-команду: трек ${command.file} не найден.`);
      }
      return;
    }

    await handlePlay(command.file, button, command.basePath, {
      playlistId: resolvedContext.playlistId,
      trackId: resolvedContext.trackId,
      playlistIndex: resolvedContext.playlistIndex,
      playlistPosition: resolvedContext.playlistPosition,
      startAtSeconds: normalizePlaybackStartOffsetSeconds(command.startAtSeconds),
      fromAutoplay: Boolean(command.fromAutoplay),
      fromDspTransition: Boolean(command.fromDspTransition),
      fromDapNoSilence: Boolean(command.fromDapNoSilence),
      fromDapInterruptedResume: Boolean(command.fromDapInterruptedResume),
    });

    if (sourceTag) {
      setStatus(`Live управление${sourceTag}.`);
    }
  },
});

export function setPlaybackSyncDeps(d) {
  Object.assign(_deps, d);
}

export function resetTrackReferences() {
  _deps.hideTrashDropzone();
  _deps.clearDesktopDragGhost();
  _deps.clearDragModeBadge();
  _deps.clearDragPreviewCard();
  _deps.clearTouchCopyHold();
  _deps.clearPlaylistReorderHold();
  if (state.touchCopyDragActive) {
    _deps.cleanupTouchCopyDrag({ restoreLayout: false });
  }
  state.buttonsByFile = new Map();
  state.cardsByFile = new Map();
  state.durationLabelsByFile = new Map();
  state.playlistDurationLabelsByIndex = new Map();
  state.trackNameLabelsByFile = new Map();
  state.hostHighlightedDescriptor = '';
}

export function applyIncomingLayoutState(
  nextLayout,
  nextPlaylistNames,
  nextPlaylistMeta,
  nextPlaylistAutoplay,
  nextPlaylistDsp,
  nextDapConfig,
  nextTrackTitleModesByTrack = null,
  version = null,
  render = true,
  nextPlaylists = null,
) {
  const previousDap = { ...state.dapConfig };
  const previousLayout = _deps.ensurePlaylists(state.layout);
  const previousMeta = _deps.normalizePlaylistMeta(state.playlistMeta, previousLayout.length);
  const previousCurrentTrackWasDap = isDapTrackContext(state.currentTrack, previousDap);
  if (!Array.isArray(nextPlaylists)) {
    throw new Error('Неверный формат playlists в layout payload.');
  }

  const incomingLegacyState = deriveLegacyStateFromPlaylists(nextPlaylists, {
    dapConfig: nextDapConfig,
    trackTitleModesByTrack:
      nextTrackTitleModesByTrack !== null && nextTrackTitleModesByTrack !== undefined
        ? nextTrackTitleModesByTrack
        : state.trackTitleModesByTrack,
  });
  const normalizedLayout = _deps.normalizeLayoutForFiles(incomingLegacyState.layout, state.availableFiles);
  const normalizedNames = _deps.normalizePlaylistNames(incomingLegacyState.playlistNames, normalizedLayout.length);
  const normalizedMeta = _deps.normalizePlaylistMeta(incomingLegacyState.playlistMeta, normalizedLayout.length);
  const normalizedDap = _deps.normalizeDapConfig(incomingLegacyState.dapConfig, normalizedLayout.length, state.dapConfig);
  const normalizedAutoplay = _deps.normalizePlaylistAutoplayWithDap(
    incomingLegacyState.playlistAutoplay,
    normalizedDap,
    normalizedLayout.length,
  );
  const normalizedDsp = _deps.normalizePlaylistDspFlags(
    incomingLegacyState.playlistDsp,
    normalizedAutoplay,
    normalizedLayout.length,
  );
  const normalizedTrackTitleModes = _deps.normalizeTrackTitleModesByTrackForFiles(
    incomingLegacyState.trackTitleModesByTrack,
    state.availableFiles,
    '/audio',
  );
  const withFolderCoverage = _deps.ensureFolderPlaylistsCoverage(normalizedLayout, normalizedNames, normalizedMeta);
  const changed =
    !_deps.layoutsEqual(state.layout, withFolderCoverage.layout) ||
    !_deps.playlistNamesEqual(state.playlistNames, withFolderCoverage.playlistNames, withFolderCoverage.layout.length) ||
    !_deps.playlistMetaEqual(state.playlistMeta, withFolderCoverage.playlistMeta, withFolderCoverage.layout.length) ||
    !_deps.playlistAutoplayEqual(state.playlistAutoplay, normalizedAutoplay, withFolderCoverage.layout.length) ||
    !_deps.playlistDspEqual(state.playlistDsp, normalizedDsp, normalizedAutoplay, withFolderCoverage.layout.length) ||
    !_deps.dapConfigEqual(state.dapConfig, normalizedDap, withFolderCoverage.layout.length) ||
    !_deps.trackTitleModesByTrackEqual(state.trackTitleModesByTrack, normalizedTrackTitleModes);

  state.layout = withFolderCoverage.layout;
  state.playlistNames = withFolderCoverage.playlistNames;
  state.playlistMeta = withFolderCoverage.playlistMeta;
  state.dapConfig = _deps.normalizeDapConfig(normalizedDap, state.layout.length, normalizedDap);
  if (!isDapEnabled(state.dapConfig)) {
    _deps.disarmDapNoSilence();
    _deps.clearDapInterruptedPlaybackSnapshot();
  } else {
    const previousDapIndex = normalizePlaylistTrackIndex(previousDap.playlistIndex);
    const nextDapIndex = normalizePlaylistTrackIndex(state.dapConfig.playlistIndex);
    const previousDapIdentity =
      previousDapIndex !== null ? buildPlaylistSelectionIdentity(previousLayout, previousMeta, previousDapIndex) : '';
    const nextDapIdentity =
      nextDapIndex !== null ? buildPlaylistSelectionIdentity(state.layout, state.playlistMeta, nextDapIndex) : '';
    const isDapSelectionPreservedByShift =
      Boolean(previousDapIdentity) && Boolean(nextDapIdentity) && previousDapIdentity === nextDapIdentity;
    if (
      !Boolean(previousDap.enabled) ||
      previousDapIndex === null ||
      nextDapIndex === null ||
      (previousDapIndex !== nextDapIndex && !isDapSelectionPreservedByShift)
    ) {
      _deps.disarmDapNoSilence();
      _deps.clearDapInterruptedPlaybackSnapshot();
    }
  }
  state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(normalizedAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = _deps.normalizePlaylistDspFlags(normalizedDsp, state.playlistAutoplay, state.layout.length);
  state.trackTitleModesByTrack = normalizedTrackTitleModes;
  state.playlists = nextPlaylists;
  const preferredCurrentTrackPlaylistIndex = previousCurrentTrackWasDap ? _deps.getDapPlaylistIndex(state.dapConfig) : null;
  const currentTrackContextChanged = reconcileTrackContextWithLayout(state.currentTrack, {
    preferredPlaylistIndex: preferredCurrentTrackPlaylistIndex,
  });
  const dapSnapshotContextChanged = reconcileDapInterruptedSnapshotWithLayout();
  if (currentTrackContextChanged && state.currentAudio) {
    applyLiveVolumeToCurrentAudio();
  }
  if (state.dspTransitionPlayback && state.dspTransitionPlayback.audio) {
    state.dspTransitionPlayback.audio.volume = getEffectiveLiveVolume(state.dspTransitionPlayback.toTrack || null);
  }
  _deps.saveTrackTitleModesByTrackSetting();

  const numericVersion = Number(version);
  if (Number.isFinite(numericVersion)) {
    state.layoutVersion = numericVersion;
  }

  if (changed && render) {
    _deps.renderZones();
  }

  if (!render) {
    updateDapSettingsUi(state.currentRole);
  }

  if (currentTrackContextChanged && isHostRole()) {
    requestHostPlaybackSync(true);
  }

  if (changed && isHostRole()) {
    _deps.ensureDapNoSilencePlayback({ reason: 'layout-sync' }).catch(() => {});
  }

  return changed || currentTrackContextChanged || dapSnapshotContextChanged;
}

export function applyIncomingHostPlaybackState(nextState, sync = true) {
  const previousHostTrackKey =
    state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string' && state.hostPlaybackState.trackFile.trim()
      ? trackKey(state.hostPlaybackState.trackFile, '/audio')
      : null;
  const previousDapTrackKey =
    state.hostPlaybackState &&
    state.hostPlaybackState.dapPlayback &&
    typeof state.hostPlaybackState.dapPlayback.trackFile === 'string' &&
    state.hostPlaybackState.dapPlayback.trackFile.trim()
      ? trackKey(state.hostPlaybackState.dapPlayback.trackFile, '/audio')
      : null;
  const normalizedState = sanitizeIncomingHostPlaybackState(nextState);
  if (isHostRole()) {
    normalizedState.showVolumePresets = Boolean(state.showVolumePresetsEnabled);
    normalizedState.allowLiveSeek = Boolean(state.liveSeekEnabled);
  }
  const changed = serializeHostPlaybackState(state.hostPlaybackState) !== serializeHostPlaybackState(normalizedState);
  state.hostPlaybackState = normalizedState;
  const nextHostTrackKey =
    typeof state.hostPlaybackState.trackFile === 'string' && state.hostPlaybackState.trackFile.trim()
      ? trackKey(state.hostPlaybackState.trackFile, '/audio')
      : null;
  const nextDapTrackKey =
    state.hostPlaybackState.dapPlayback &&
    typeof state.hostPlaybackState.dapPlayback.trackFile === 'string' &&
    state.hostPlaybackState.dapPlayback.trackFile.trim()
      ? trackKey(state.hostPlaybackState.dapPlayback.trackFile, '/audio')
      : null;
  setLivePlaybackVolume(normalizedState.volume, { sync: false, announce: false });
  setShowVolumePresetsEnabled(normalizedState.showVolumePresets, { persist: isHostRole(), sync: false });
  setLiveSeekEnabled(normalizedState.allowLiveSeek, { persist: isHostRole(), sync: false });

  if (sync || changed) {
    if (isCoHostRole()) {
      syncNowPlayingPanel();
    }
    syncHostNowPlayingPanel();
  }
  if (previousHostTrackKey && previousHostTrackKey !== nextHostTrackKey) {
    refreshTrackDurationLabels(previousHostTrackKey);
  }
  if (previousDapTrackKey && previousDapTrackKey !== nextDapTrackKey && previousDapTrackKey !== nextHostTrackKey) {
    refreshTrackDurationLabels(previousDapTrackKey);
  }
  if (nextHostTrackKey) {
    refreshTrackDurationLabels(nextHostTrackKey);
  }
  if (nextDapTrackKey && nextDapTrackKey !== nextHostTrackKey) {
    refreshTrackDurationLabels(nextDapTrackKey);
  }
  _deps.syncDapInterruptedTrackState();
  _deps.syncPlaylistHeaderActiveState();

  return changed;
}

export function buildLocalPlaybackSnapshot() {
  const dapPlayback = buildDapPlaybackSnapshotForSync(state.dapConfig);

  if (!state.currentTrack || !state.currentAudio) {
    return {
      trackFile: null,
      trackId: null,
      paused: false,
      currentTime: 0,
      duration: null,
      volume: getEffectiveLiveVolume(),
      showVolumePresets: state.showVolumePresetsEnabled,
      allowLiveSeek: state.liveSeekEnabled,
      dapPlayback,
      playlistId: null,
    };
  }

  const rawCurrentTime = Number(state.currentAudio.currentTime);
  const currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;
  const resolvedDuration = _deps.getDuration(state.currentAudio) || getKnownDurationSeconds(state.currentTrack.key);

  return {
    trackFile: state.currentTrack.file,
    trackId: normalizePlaybackIdentity(state.currentTrack.trackId, 80),
    paused: Boolean(state.currentAudio.paused),
    currentTime,
    duration: Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : null,
    volume: getEffectiveLiveVolume(),
    showVolumePresets: state.showVolumePresetsEnabled,
    allowLiveSeek: state.liveSeekEnabled,
    dapPlayback,
    playlistId: normalizePlaybackIdentity(state.currentTrack.playlistId, 64),
  };
}

export async function fetchSharedPlaybackState() {
  const { ok, data } = await api.fetchPlayback();

  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось получить состояние воспроизведения хоста');
  }

  return sanitizeIncomingHostPlaybackState(data);
}

export async function pushSharedPlaybackState(snapshot) {
  const { ok, data } = await api.postPlayback({ ...snapshot, clientId: _deps.clientId });

  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось синхронизировать состояние воспроизведения');
  }

  applyIncomingHostPlaybackState(data, true);
}

function normalizePlayNextTrackFile(rawCommand) {
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

  return toLegacyFilePathFromTrack({ src: srcFromRef });
}

export function normalizeIncomingPlaybackCommand(
  rawCommand,
  { defaultOrigin = 'ui', defaultRole = null } = {},
) {
  if (!rawCommand || typeof rawCommand !== 'object') return null;

  const type = typeof rawCommand.type === 'string' ? rawCommand.type.trim() : '';
  const sourceRole = normalizeCommandSourceRole(rawCommand.sourceRole)
    || normalizeCommandSourceRole(rawCommand.actorRole)
    || normalizeCommandSourceRole(defaultRole);
  const actorRole = normalizeCommandSourceRole(rawCommand.actorRole) || sourceRole;
  const origin = normalizeCommandOrigin(rawCommand.origin, defaultOrigin);
  const sourceClientId = typeof rawCommand.sourceClientId === 'string' ? rawCommand.sourceClientId : null;
  const sourceUsername = typeof rawCommand.sourceUsername === 'string' ? rawCommand.sourceUsername : null;
  const target = typeof rawCommand.target === 'string' && rawCommand.target.trim() ? rawCommand.target.trim() : 'host';
  if (type === PLAYBACK_COMMAND_STOP) {
    return {
      type: PLAYBACK_COMMAND_STOP,
      origin,
      actorRole,
      sourceRole,
      sourceClientId,
      sourceUsername,
      target,
    };
  }

  if (type === PLAYBACK_COMMAND_TOGGLE_CURRENT) {
    return {
      type: PLAYBACK_COMMAND_TOGGLE_CURRENT,
      origin,
      actorRole,
      sourceRole,
      sourceClientId,
      sourceUsername,
      target,
    };
  }

  if (type === PLAYBACK_COMMAND_SET_VOLUME) {
    const volume = normalizeLiveVolumePreset(rawCommand.volume, null);
    if (volume === null) return null;

    return {
      type: PLAYBACK_COMMAND_SET_VOLUME,
      volume,
      announce: Boolean(rawCommand.announce),
      origin,
      actorRole,
      sourceRole,
      sourceClientId,
      sourceUsername,
      target,
    };
  }

  if (type === PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE) {
    return {
      type: PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE,
      showVolumePresets: Boolean(rawCommand.showVolumePresets),
      origin,
      actorRole,
      sourceRole,
      sourceClientId,
      sourceUsername,
      target,
    };
  }

  if (type === PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED) {
    return {
      type: PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED,
      allowLiveSeek: Boolean(rawCommand.allowLiveSeek),
      origin,
      actorRole,
      sourceRole,
      sourceClientId,
      sourceUsername,
      target,
    };
  }

  if (type === PLAYBACK_COMMAND_SEEK_CURRENT) {
    const positionRatio = normalizePlaybackSeekRatio(rawCommand.positionRatio);
    if (positionRatio === null) return null;

    return {
      type: PLAYBACK_COMMAND_SEEK_CURRENT,
      positionRatio,
      finalize: Boolean(rawCommand.finalize),
      origin,
      actorRole,
      sourceRole,
      sourceClientId,
      sourceUsername,
      target,
    };
  }

  if (type === PLAYBACK_COMMAND_PLAY_NEXT_REQUEST) {
    const file = normalizePlayNextTrackFile(rawCommand);
    if (!file) return null;

    const strategy = rawCommand.strategy === 'create-new-playnext-playlist'
      ? 'create-new-playnext-playlist'
      : 'copy-into-active';
    return {
      type: PLAYBACK_COMMAND_PLAY_NEXT_REQUEST,
      file,
      strategy,
      fifoSession: Boolean(rawCommand.fifoSession),
      origin,
      actorRole,
      sourceRole,
      sourceClientId,
      sourceUsername,
      target,
    };
  }

  if (type !== PLAYBACK_COMMAND_PLAY_TRACK) {
    return null;
  }

  const file = typeof rawCommand.file === 'string' ? rawCommand.file.trim() : '';
  if (!file) return null;
  const playlistIndex = normalizePlaylistTrackIndex(rawCommand.playlistIndex);
  const playlistPosition = normalizePlaylistTrackIndex(rawCommand.playlistPosition);
  const startAtSeconds = normalizePlaybackStartOffsetSeconds(rawCommand.startAtSeconds);

  return {
    type: PLAYBACK_COMMAND_PLAY_TRACK,
    file,
    basePath: '/audio',
    playlistId: normalizePlaybackIdentity(rawCommand.playlistId, 64),
    trackId: normalizePlaybackIdentity(rawCommand.trackId, 80),
    playlistIndex,
    playlistPosition,
    startAtSeconds,
    fromAutoplay: Boolean(rawCommand.fromAutoplay),
    fromDspTransition: Boolean(rawCommand.fromDspTransition),
    fromDapNoSilence: Boolean(rawCommand.fromDapNoSilence),
    fromDapInterruptedResume: Boolean(rawCommand.fromDapInterruptedResume),
    origin,
    actorRole,
    sourceRole,
    sourceClientId,
    sourceUsername,
    target,
  };
}

export async function sendLivePlaybackCommand(command) {
  const normalizedCommand = normalizeIncomingPlaybackCommand(command, {
    defaultOrigin: 'ui',
    defaultRole: state.currentRole || ROLE_SLAVE,
  });
  if (!normalizedCommand) {
    throw new Error('Некорректная live-команда');
  }
  const result = await outgoingLiveCommandBus.dispatch(
    {
      sourceRole: normalizedCommand.actorRole || normalizedCommand.sourceRole || state.currentRole,
      commandType: normalizedCommand.type,
      target: normalizedCommand.target || 'host',
    },
    normalizedCommand,
  );
  if (!result.ok) {
    throw new Error(result.message || 'Недостаточно прав для отправки live-команды');
  }
  return normalizedCommand;
}

export async function dispatchHostPlaybackCommand(command) {
  if (!isHostRole()) {
    throw new Error('Только хост может отправлять локальные playback-команды.');
  }
  const normalizedCommand = normalizeIncomingPlaybackCommand({
    ...command,
    sourceRole: ROLE_HOST,
    actorRole: ROLE_HOST,
    target: 'self',
  }, {
    defaultOrigin: 'ui',
    defaultRole: ROLE_HOST,
  });
  if (!normalizedCommand) {
    throw new Error('Некорректная playback-команда хоста');
  }
  const result = await hostLocalPlaybackCommandBus.dispatch(
    {
      sourceRole: ROLE_HOST,
      commandType: normalizedCommand.type,
      target: 'self',
    },
    normalizedCommand,
  );
  if (!result.ok) {
    throw new Error(result.message || 'Команда хоста отклонена политикой доступа.');
  }
  return normalizedCommand;
}

export async function dispatchLocalPlaybackCommand(command) {
  const sourceRole = normalizeCommandSourceRole(state.currentRole) || ROLE_SLAVE;
  const normalizedCommand = normalizeIncomingPlaybackCommand({
    ...command,
    sourceRole,
    actorRole: sourceRole,
    target: 'self',
  }, {
    defaultOrigin: 'ui',
    defaultRole: sourceRole,
  });
  if (!normalizedCommand) {
    throw new Error('Некорректная локальная playback-команда');
  }

  const result = await localSelfPlaybackCommandBus.dispatch(
    {
      sourceRole,
      commandType: normalizedCommand.type,
      target: 'self',
    },
    normalizedCommand,
  );
  if (!result.ok) {
    throw new Error(result.message || 'Локальная playback-команда отклонена политикой доступа.');
  }
  return normalizedCommand;
}

export async function requestHostPlayTrack(file, basePath = '/audio', playbackContext = {}) {
  if (!isHostRole()) return false;
  const resolvedContext = resolvePlaylistTrackContextByIds({
    file,
    playlistId: playbackContext.playlistId,
    trackId: playbackContext.trackId,
    playlistIndex: playbackContext.playlistIndex,
    playlistPosition: playbackContext.playlistPosition,
  });
  const command = {
    type: PLAYBACK_COMMAND_PLAY_TRACK,
    file,
    basePath,
    playlistId: resolvedContext.playlistId,
    trackId: resolvedContext.trackId,
    playlistIndex: resolvedContext.playlistIndex,
    playlistPosition: resolvedContext.playlistPosition,
    startAtSeconds: normalizePlaybackStartOffsetSeconds(playbackContext.startAtSeconds),
    fromAutoplay: Boolean(playbackContext.fromAutoplay),
    fromDspTransition: Boolean(playbackContext.fromDspTransition),
    fromDapNoSilence: Boolean(playbackContext.fromDapNoSilence),
    fromDapInterruptedResume: Boolean(playbackContext.fromDapInterruptedResume),
  };
  await dispatchHostPlaybackCommand(command);
  return true;
}

export async function requestLocalPlayTrack(file, basePath = '/audio', playbackContext = {}) {
  if (isHostRole()) {
    return requestHostPlayTrack(file, basePath, playbackContext);
  }
  if (isCoHostRole()) {
    throw new Error('Co-host не может запускать локальное воспроизведение.');
  }

  const resolvedContext = resolvePlaylistTrackContextByIds({
    file,
    playlistId: playbackContext.playlistId,
    trackId: playbackContext.trackId,
    playlistIndex: playbackContext.playlistIndex,
    playlistPosition: playbackContext.playlistPosition,
  });

  const command = {
    type: PLAYBACK_COMMAND_PLAY_TRACK,
    file,
    basePath,
    playlistId: resolvedContext.playlistId,
    trackId: resolvedContext.trackId,
    playlistIndex: resolvedContext.playlistIndex,
    playlistPosition: resolvedContext.playlistPosition,
    startAtSeconds: normalizePlaybackStartOffsetSeconds(playbackContext.startAtSeconds),
    fromAutoplay: Boolean(playbackContext.fromAutoplay),
    fromDspTransition: Boolean(playbackContext.fromDspTransition),
    fromDapNoSilence: Boolean(playbackContext.fromDapNoSilence),
    fromDapInterruptedResume: Boolean(playbackContext.fromDapInterruptedResume),
  };

  await dispatchLocalPlaybackCommand(command);
  return true;
}

export async function requestTrackPlaybackForCurrentRole(file, basePath = '/audio', playbackContext = {}) {
  if (isHostRole()) {
    return requestHostPlayTrack(file, basePath, playbackContext);
  }
  if (isCoHostRole()) {
    return requestCoHostPlayTrack(file, basePath, playbackContext);
  }
  return requestLocalPlayTrack(file, basePath, playbackContext);
}

export async function requestPlayNextOnHost(
  file,
  { strategy = 'copy-into-active', fifoSession = false } = {},
) {
  const normalizedFile = typeof file === 'string' ? file.trim() : '';
  if (!normalizedFile) return false;

  const command = {
    type: PLAYBACK_COMMAND_PLAY_NEXT_REQUEST,
    file: normalizedFile,
    strategy: strategy === 'create-new-playnext-playlist' ? 'create-new-playnext-playlist' : 'copy-into-active',
    fifoSession: Boolean(fifoSession),
  };

  if (isHostRole()) {
    await dispatchHostPlaybackCommand({ ...command, target: 'self' });
    return true;
  }

  await sendLivePlaybackCommand(command);
  return true;
}

export async function requestHostSetLiveVolume(volume, { announce = false } = {}) {
  if (!isHostRole()) return false;
  const normalized = normalizeLiveVolumePreset(volume, null);
  if (normalized === null) return false;
  await dispatchHostPlaybackCommand({
    type: PLAYBACK_COMMAND_SET_VOLUME,
    volume: normalized,
    announce: Boolean(announce),
  });
  return true;
}

export async function requestHostSeekCurrentPlayback(positionRatio, { finalize = false } = {}) {
  if (!isHostRole()) return false;
  const normalizedRatio = normalizePlaybackSeekRatio(positionRatio);
  if (normalizedRatio === null) return false;
  await dispatchHostPlaybackCommand({
    type: PLAYBACK_COMMAND_SEEK_CURRENT,
    positionRatio: normalizedRatio,
    finalize: Boolean(finalize),
  });
  return true;
}

export async function executeIncomingPlaybackCommand(commandPayload) {
  if (!isHostRole()) return;

  const command = normalizeIncomingPlaybackCommand(commandPayload, {
    defaultOrigin: 'api',
    defaultRole: ROLE_COHOST,
  });
  if (!command) return;
  if (command.sourceClientId && command.sourceClientId === _deps.clientId) return;

  const result = await incomingLiveCommandBus.dispatch(
    {
      sourceRole: command.sourceRole || command.actorRole || ROLE_COHOST,
      commandType: command.type,
      target: command.target || 'host',
    },
    command,
  );
  if (!result.ok) {
    setStatus(result.message || 'Live-команда отклонена политикой доступа.');
    return;
  }
}

function clearPlayNextInsertSession() {
  state.playNextInsertSession = null;
}

function clearPlayNextScheduledSwitch() {
  state.playNextScheduledSwitch = null;
}

function buildPlayNextScheduledSwitch(anchorContext, toPlaylistIndex) {
  const anchorPlaylistIndex = normalizePlaylistTrackIndex(anchorContext && anchorContext.playlistIndex);
  const anchorPlaylistPosition = normalizePlaylistTrackIndex(anchorContext && anchorContext.playlistPosition);
  const normalizedTargetPlaylistIndex = normalizePlaylistTrackIndex(toPlaylistIndex);
  if (anchorPlaylistIndex === null || anchorPlaylistPosition === null || normalizedTargetPlaylistIndex === null) {
    return null;
  }
  return {
    toPlaylistIndex: normalizedTargetPlaylistIndex,
    afterPlaylistIndex: anchorPlaylistIndex,
    afterPlaylistPosition: anchorPlaylistPosition,
    afterTrackFile: typeof anchorContext?.file === 'string' ? anchorContext.file.trim() : '',
    switchMode: 'autoplay',
  };
}

function resolvePlayNextAnchorContext() {
  const normalizedLayout = _deps.ensurePlaylists(state.layout);
  if (!normalizedLayout.length) return null;

  if (isDspTransitionPlaybackActive()) {
    const transitionTargetTrack = state.dspTransitionPlayback && state.dspTransitionPlayback.toTrack
      ? state.dspTransitionPlayback.toTrack
      : null;
    if (transitionTargetTrack && typeof transitionTargetTrack.file === 'string' && transitionTargetTrack.file.trim()) {
      const resolvedTransitionContext = resolveTrackContextInLayoutByFile(transitionTargetTrack.file, {
        preferredPlaylistIndex: normalizePlaylistTrackIndex(transitionTargetTrack.playlistIndex),
        preferredPlaylistPosition: normalizePlaylistTrackIndex(transitionTargetTrack.playlistPosition),
      });
      if (resolvedTransitionContext) {
        return {
          ...resolvedTransitionContext,
          file: transitionTargetTrack.file.trim(),
        };
      }
    }
  }

  if (!state.currentTrack || typeof state.currentTrack.file !== 'string' || !state.currentTrack.file.trim()) {
    return null;
  }

  const resolvedCurrentContext = resolveTrackContextInLayoutByFile(state.currentTrack.file, {
    preferredPlaylistIndex: normalizePlaylistTrackIndex(state.currentTrack.playlistIndex),
    preferredPlaylistPosition: normalizePlaylistTrackIndex(state.currentTrack.playlistPosition),
  });
  if (!resolvedCurrentContext) return null;

  return {
    ...resolvedCurrentContext,
    file: state.currentTrack.file.trim(),
  };
}

function resolvePlayNextInsertIndex(anchorContext, { fifoSession = false } = {}) {
  const playlistIndex = normalizePlaylistTrackIndex(anchorContext && anchorContext.playlistIndex);
  const playlistPosition = normalizePlaylistTrackIndex(anchorContext && anchorContext.playlistPosition);
  if (playlistIndex === null || playlistPosition === null) return null;

  const normalizedLayout = _deps.ensurePlaylists(state.layout);
  const playlist = Array.isArray(normalizedLayout[playlistIndex]) ? normalizedLayout[playlistIndex] : null;
  if (!playlist) return null;

  const baseInsertIndex = Math.max(0, Math.min(playlistPosition + 1, playlist.length));
  const anchorSignature = `${playlistIndex}:${playlistPosition}:${anchorContext && anchorContext.file ? anchorContext.file : ''}`;

  if (!fifoSession) {
    clearPlayNextInsertSession();
    return baseInsertIndex;
  }

  if (
    !state.playNextInsertSession ||
    state.playNextInsertSession.playlistIndex !== playlistIndex ||
    state.playNextInsertSession.anchorSignature !== anchorSignature
  ) {
    state.playNextInsertSession = {
      playlistIndex,
      anchorSignature,
      baseInsertIndex,
      insertedCount: 0,
    };
  }

  const session = state.playNextInsertSession;
  const insertIndex = Math.max(
    0,
    Math.min(
      session.baseInsertIndex + session.insertedCount,
      Array.isArray(normalizedLayout[playlistIndex]) ? normalizedLayout[playlistIndex].length : 0,
    ),
  );
  session.insertedCount += 1;
  return insertIndex;
}

async function applyPlayNextRequestLocally(command) {
  if (!command || command.type !== PLAYBACK_COMMAND_PLAY_NEXT_REQUEST) return false;

  const requestedFile = typeof command.file === 'string' ? command.file.trim() : '';
  if (!requestedFile) {
    setStatus('Live Play Next отклонен: не указан трек.');
    return false;
  }

  const strategy = command.strategy === 'create-new-playnext-playlist'
    ? 'create-new-playnext-playlist'
    : 'copy-into-active';

  const anchorContext = resolvePlayNextAnchorContext();
  if (!anchorContext) {
    clearPlayNextInsertSession();
    clearPlayNextScheduledSwitch();
    setStatus('Live Play Next недоступен: нет активного трека/якоря.');
    return false;
  }

  const anchorPlaylistIndex = normalizePlaylistTrackIndex(anchorContext.playlistIndex);
  if (anchorPlaylistIndex === null) {
    clearPlayNextInsertSession();
    clearPlayNextScheduledSwitch();
    setStatus('Live Play Next недоступен: не определен активный плей-лист.');
    return false;
  }

  const isAutoplayEnabled =
    Array.isArray(state.playlistAutoplay) &&
    anchorPlaylistIndex >= 0 &&
    anchorPlaylistIndex < state.playlistAutoplay.length &&
    Boolean(state.playlistAutoplay[anchorPlaylistIndex]);
  if (!isAutoplayEnabled) {
    clearPlayNextInsertSession();
    clearPlayNextScheduledSwitch();
    setStatus('Live Play Next доступен только в AutoPlay/DSP режиме.');
    return false;
  }

  const previousLayout = _deps.ensurePlaylists(state.layout).map((playlist) => playlist.slice());
  const previousNames = Array.isArray(state.playlistNames) ? state.playlistNames.slice() : [];
  const previousMeta = _deps.normalizePlaylistMeta(state.playlistMeta, previousLayout.length).map((entry) => ({ ...entry }));
  const previousAutoplay = Array.isArray(state.playlistAutoplay) ? state.playlistAutoplay.slice() : [];
  const previousDsp = Array.isArray(state.playlistDsp) ? state.playlistDsp.slice() : [];
  const previousDap = { ...(state.dapConfig || DEFAULT_DAP_CONFIG) };
  const previousScheduledSwitch = state.playNextScheduledSwitch && typeof state.playNextScheduledSwitch === 'object'
    ? { ...state.playNextScheduledSwitch }
    : null;
  const previousPlaylists = Array.isArray(state.playlists)
    ? state.playlists.map((playlist) => (playlist && typeof playlist === 'object' ? { ...playlist } : playlist))
    : [];

  const nextLayout = previousLayout.map((playlist) => playlist.slice());
  let successMessage = '';

  if (strategy === 'copy-into-active') {
    const insertIndex = resolvePlayNextInsertIndex(anchorContext, { fifoSession: Boolean(command.fifoSession) });
    if (!Number.isInteger(insertIndex) || insertIndex < 0) {
      clearPlayNextInsertSession();
      clearPlayNextScheduledSwitch();
      setStatus('Live Play Next отклонен: не удалось определить позицию вставки.');
      return false;
    }
    if (!Array.isArray(nextLayout[anchorPlaylistIndex])) {
      clearPlayNextInsertSession();
      clearPlayNextScheduledSwitch();
      setStatus('Live Play Next отклонен: целевой плей-лист недоступен.');
      return false;
    }

    const boundedInsertIndex = Math.max(0, Math.min(insertIndex, nextLayout[anchorPlaylistIndex].length));
    nextLayout[anchorPlaylistIndex].splice(boundedInsertIndex, 0, requestedFile);
    clearPlayNextScheduledSwitch();
    successMessage = `Live Play Next: ${requestedFile} поставлен следующим.`;
  } else {
    clearPlayNextInsertSession();
    const quickBuildPlaylistIndex = nextLayout.length;
    nextLayout.push([requestedFile]);

    const nextNames = _deps.normalizePlaylistNames(
      [...previousNames, `Play Next ${quickBuildPlaylistIndex + 1}`],
      nextLayout.length,
    );
    const nextMeta = _deps.normalizePlaylistMeta(
      [...previousMeta, { type: PLAYLIST_TYPE_MANUAL }],
      nextLayout.length,
    );
    const nextDap = _deps.normalizeDapConfig(previousDap, nextLayout.length, previousDap);
    const nextAutoplay = _deps.normalizePlaylistAutoplayWithDap(
      [...previousAutoplay, true],
      nextDap,
      nextLayout.length,
    );
    const nextDsp = _deps.normalizePlaylistDspFlags(
      [...previousDsp, false],
      nextAutoplay,
      nextLayout.length,
    );

    const scheduledSwitch = buildPlayNextScheduledSwitch(anchorContext, quickBuildPlaylistIndex);
    if (!scheduledSwitch) {
      setStatus('Live Play Next отклонен: не удалось подготовить переключение плей-листа.');
      return false;
    }

    state.layout = _deps.ensurePlaylists(nextLayout);
    state.playlistNames = nextNames;
    state.playlistMeta = nextMeta;
    state.dapConfig = nextDap;
    state.playlistAutoplay = nextAutoplay;
    state.playlistDsp = nextDsp;
    state.playNextScheduledSwitch = scheduledSwitch;
    const nextPlaylists = previousPlaylists.map((playlist) => (
      playlist && typeof playlist === 'object'
        ? {
            ...playlist,
            tracks: Array.isArray(playlist.tracks) ? playlist.tracks.map((track) => ({ ...track })) : [],
          }
        : playlist
    ));
    while (nextPlaylists.length < nextLayout.length) {
      nextPlaylists.push(null);
    }
    const existingQuickBuild = nextPlaylists[quickBuildPlaylistIndex];
    const quickBuildId =
      existingQuickBuild && typeof existingQuickBuild.id === 'string' && existingQuickBuild.id
        ? existingQuickBuild.id
        : `p-${quickBuildPlaylistIndex}`;
    nextPlaylists[quickBuildPlaylistIndex] = {
      id: quickBuildId,
      name: state.playlistNames[quickBuildPlaylistIndex] || `Play Next ${quickBuildPlaylistIndex + 1}`,
      type: PLAYLIST_TYPE_MANUAL,
      tracks:
        existingQuickBuild && Array.isArray(existingQuickBuild.tracks) && existingQuickBuild.tracks.length
          ? existingQuickBuild.tracks.map((track) => ({ ...track }))
          : [
              {
                id: `${quickBuildId}-t-0`,
                src: `/audio/${encodeURIComponent(requestedFile)}`,
                meta: { originalPath: requestedFile },
              },
            ],
      settings: {
        autoPlayEnabled: true,
        dspEnabled: false,
      },
      uiState: 'quick_build_armed',
    };
    state.playlists = nextPlaylists;
    _deps.renderZones();
    try {
      await pushSharedLayout();
      setStatus(`Live Play Next: создан quick build плей-лист #${quickBuildPlaylistIndex + 1}.`);
      return true;
    } catch (err) {
      console.error(err);
      state.layout = previousLayout;
      state.playlistNames = previousNames;
      state.playlistMeta = previousMeta;
      state.dapConfig = _deps.normalizeDapConfig(previousDap, state.layout.length, previousDap);
      state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
      state.playlistDsp = _deps.normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
      state.playNextScheduledSwitch = previousScheduledSwitch;
      state.playlists = previousPlaylists;
      _deps.renderZones();
      setStatus('Не удалось синхронизировать Live Play Next.');
      return false;
    }
  }

  state.layout = _deps.ensurePlaylists(nextLayout);
  state.playlistNames = _deps.normalizePlaylistNames(previousNames, state.layout.length);
  state.playlistMeta = _deps.normalizePlaylistMeta(previousMeta, state.layout.length);
  state.dapConfig = _deps.normalizeDapConfig(previousDap, state.layout.length, previousDap);
  state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = _deps.normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
  _deps.renderZones();

  try {
    await pushSharedLayout();
    setStatus(successMessage || `Live Play Next: ${requestedFile} поставлен следующим.`);
    return true;
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = previousNames;
    state.playlistMeta = previousMeta;
    state.dapConfig = _deps.normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = _deps.normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    state.playNextScheduledSwitch = previousScheduledSwitch;
    state.playlists = previousPlaylists;
    _deps.renderZones();
    setStatus('Не удалось синхронизировать Live Play Next.');
    return false;
  }
}

async function executeSelfPlaybackCommandLocally(command, commandContext = {}) {
  const sourceRole = normalizeCommandSourceRole(commandContext.sourceRole)
    || normalizeCommandSourceRole(command && command.sourceRole)
    || state.currentRole
    || ROLE_SLAVE;
  const target = commandContext.target === 'self' || (command && command.target === 'self') ? 'self' : 'host';
  if (sourceRole === ROLE_HOST) {
    await executeHostPlaybackCommandLocally(command);
    return;
  }
  if (target !== 'self') {
    throw new Error('Локальная playback-команда должна иметь target=self.');
  }

  try {
    const handledByControllerAdapter = await playbackControllerAdapter.execute(command, {
      sourceRole,
      target,
      sourceTag: '',
    });
    if (handledByControllerAdapter) {
      return;
    }
  } catch (err) {
    if (err && err.message === 'NOT_SUPPORTED_IN_LOCAL_CONTEXT') {
      throw new Error('Slave может играть локально только в Simple режиме.');
    }
    throw err;
  }

  if (command.type === PLAYBACK_COMMAND_STOP) {
    setStatus('Локальное воспроизведение остановлено.');
    return;
  }

  if (command.type === PLAYBACK_COMMAND_TOGGLE_CURRENT) {
    return;
  }

  setStatus('Неизвестная локальная playback-команда.');
}

async function executeHostPlaybackCommandLocally(command) {
  const sourceTag = command.sourceUsername ? ` (co-host: ${command.sourceUsername})` : '';

  try {
    const handledByControllerAdapter = await playbackControllerAdapter.execute(command, {
      sourceTag,
      sourceRole: normalizeCommandSourceRole(command && command.sourceRole) || ROLE_HOST,
      target: command && command.target === 'host' ? 'host' : 'self',
    });
    if (handledByControllerAdapter) {
      return;
    }

    if (command.type === PLAYBACK_COMMAND_SET_VOLUME) {
      if (isDapVolumePresetPlaybackActive(ROLE_HOST)) {
        updateVolumePresetsUi();
        if (sourceTag) {
          setStatus(`Live управление${sourceTag}: громкость зафиксирована во время DAP.`);
        }
        return;
      }
      setLivePlaybackVolume(command.volume, { sync: true, announce: Boolean(command.announce) && !sourceTag });
      if (sourceTag) {
        setStatus(`Live управление${sourceTag}: громкость ${formatVolumePresetLabel(command.volume)}.`);
      }
      return;
    }

    if (command.type === PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE) {
      if (!command.showVolumePresets && !canDisableVolumePresetsSetting()) {
        setStatus('Нельзя скрыть пресеты, пока активен выбранный уровень громкости.');
        updateVolumePresetsUi();
        return;
      }
      setShowVolumePresetsEnabled(command.showVolumePresets, { persist: true, sync: true });
      if (sourceTag) {
        setStatus(`Live управление${sourceTag}: пресеты громкости ${command.showVolumePresets ? 'включены' : 'выключены'}.`);
      }
      return;
    }

    if (command.type === PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED) {
      setLiveSeekEnabled(command.allowLiveSeek, { persist: true, sync: true });
      if (sourceTag) {
        setStatus(`Live управление${sourceTag}: seek ${command.allowLiveSeek ? 'включен' : 'выключен'}.`);
      }
      return;
    }

    if (command.type === PLAYBACK_COMMAND_SEEK_CURRENT) {
      if (!state.liveSeekEnabled) {
        return;
      }
      const ratio = normalizePlaybackSeekRatio(command.positionRatio);
      if (ratio === null) {
        return;
      }
      if (isDspTransitionPlaybackActive()) {
        seekDspTransitionPlaybackByRatio(ratio);
        return;
      }
      if (!state.currentTrack || !state.currentAudio) {
        return;
      }
      const duration = getCurrentTrackDurationSeconds();
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }
      const nextTime = Math.max(0, Math.min(duration, ratio * duration));
      if (!seekCurrentPlaybackToSeconds(nextTime)) return;

      _deps.updateProgress(state.currentTrack.key, nextTime, duration);
      syncNowPlayingPanel();
      requestHostLiveSeekSync({ finalize: Boolean(command.finalize) });
      return;
    }

    setStatus('Неизвестная live-команда воспроизведения.');
  } catch (err) {
    console.error('Не удалось выполнить live-команду', err);
    setStatus('Не удалось выполнить live-команду co-host.');
  }
}

export async function requestCoHostPlayTrack(file, basePath = '/audio', playbackContext = {}) {
  if (!isCoHostRole()) return false;
  const resolvedContext = resolvePlaylistTrackContextByIds({
    file,
    playlistId: playbackContext.playlistId,
    trackId: playbackContext.trackId,
    playlistIndex: playbackContext.playlistIndex,
    playlistPosition: playbackContext.playlistPosition,
  });

  const command = {
    type: PLAYBACK_COMMAND_PLAY_TRACK,
    file,
    basePath,
    playlistId: resolvedContext.playlistId,
    trackId: resolvedContext.trackId,
    playlistIndex: resolvedContext.playlistIndex,
    playlistPosition: resolvedContext.playlistPosition,
  };
  await sendLivePlaybackCommand(command);
  return true;
}

export async function requestCoHostStopPlayback() {
  if (!isCoHostRole()) return false;
  await sendLivePlaybackCommand({ type: PLAYBACK_COMMAND_STOP });
  return true;
}

export async function requestStopPlaybackForCurrentRole() {
  if (isHostRole()) {
    await dispatchHostPlaybackCommand({ type: PLAYBACK_COMMAND_STOP });
    return true;
  }
  if (isCoHostRole()) {
    await requestCoHostStopPlayback();
    return true;
  }
  await dispatchLocalPlaybackCommand({ type: PLAYBACK_COMMAND_STOP });
  return true;
}

export async function requestCoHostSetLiveVolume(volume) {
  if (!isCoHostRole()) return false;
  const normalized = normalizeLiveVolumePreset(volume, null);
  if (normalized === null) return false;
  await sendLivePlaybackCommand({ type: PLAYBACK_COMMAND_SET_VOLUME, volume: normalized });
  return true;
}

export async function requestCoHostSetVolumePresetsVisibility(showVolumePresets) {
  if (!isCoHostRole()) return false;
  await sendLivePlaybackCommand({
    type: PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE,
    showVolumePresets: Boolean(showVolumePresets),
  });
  return true;
}

export async function requestCoHostSetLiveSeekEnabled(allowLiveSeek) {
  if (!isCoHostRole()) return false;
  await sendLivePlaybackCommand({
    type: PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED,
    allowLiveSeek: Boolean(allowLiveSeek),
  });
  return true;
}

export async function requestCoHostSeekCurrentPlayback(positionRatio, { finalize = false } = {}) {
  if (!isCoHostRole()) return false;
  const normalizedRatio = normalizePlaybackSeekRatio(positionRatio);
  if (normalizedRatio === null) return false;
  await sendLivePlaybackCommand({
    type: PLAYBACK_COMMAND_SEEK_CURRENT,
    positionRatio: normalizedRatio,
    finalize: Boolean(finalize),
  });
  return true;
}

export function scheduleCoHostSeekFlush(delayMs = 0) {
  if (state.cohostSeekCommandTimer !== null) return;
  state.cohostSeekCommandTimer = setTimeout(() => {
    state.cohostSeekCommandTimer = null;
    flushQueuedCoHostSeekCommands().catch(() => {});
  }, Math.max(0, delayMs));
}

export function clearQueuedCoHostSeekCommands() {
  if (state.cohostSeekCommandTimer !== null) {
    clearTimeout(state.cohostSeekCommandTimer);
    state.cohostSeekCommandTimer = null;
  }
  state.cohostSeekPendingRatio = null;
  state.cohostSeekPendingFinalize = false;
  state.cohostSeekCommandInFlight = false;
  state.cohostSeekLastSentAt = 0;
}

export async function flushQueuedCoHostSeekCommands() {
  if (!isCoHostRole()) {
    clearQueuedCoHostSeekCommands();
    return;
  }
  if (state.cohostSeekCommandInFlight) return;
  if (state.cohostSeekPendingRatio === null) return;

  const ratioToSend = state.cohostSeekPendingRatio;
  const shouldFinalize = state.cohostSeekPendingFinalize;
  state.cohostSeekPendingRatio = null;
  state.cohostSeekPendingFinalize = false;
  state.cohostSeekCommandInFlight = true;

  try {
    await requestCoHostSeekCurrentPlayback(ratioToSend, { finalize: shouldFinalize });
    state.cohostSeekLastSentAt = Date.now();
  } catch (err) {
    console.error(err);
  } finally {
    state.cohostSeekCommandInFlight = false;

    if (state.cohostSeekPendingRatio !== null && isCoHostRole()) {
      const elapsed = Date.now() - state.cohostSeekLastSentAt;
      const delay = state.cohostSeekPendingFinalize ? 0 : Math.max(0, COHOST_SEEK_COMMAND_INTERVAL_MS - elapsed);
      scheduleCoHostSeekFlush(delay);
    }
  }
}

export function queueCoHostSeekCurrentPlayback(positionRatio, { immediate = false, finalize = false } = {}) {
  if (!isCoHostRole()) return false;
  const normalizedRatio = normalizePlaybackSeekRatio(positionRatio);
  if (normalizedRatio === null) return false;

  state.cohostSeekPendingRatio = normalizedRatio;
  state.cohostSeekPendingFinalize = state.cohostSeekPendingFinalize || Boolean(finalize);

  if (immediate) {
    if (state.cohostSeekCommandTimer !== null) {
      clearTimeout(state.cohostSeekCommandTimer);
      state.cohostSeekCommandTimer = null;
    }
    flushQueuedCoHostSeekCommands().catch(() => {});
    return true;
  }

  if (state.cohostSeekCommandInFlight) return true;

  const elapsed = Date.now() - state.cohostSeekLastSentAt;
  const delay = Math.max(0, COHOST_SEEK_COMMAND_INTERVAL_MS - elapsed);
  scheduleCoHostSeekFlush(delay);
  return true;
}

export function requestHostLiveSeekSync({ finalize = false } = {}) {
  if (!isHostRole()) return;

  const now = Date.now();
  if (!finalize && now - state.lastHostLiveSeekSyncAt < HOST_LIVE_SEEK_SYNC_INTERVAL_MS) {
    return;
  }
  state.lastHostLiveSeekSyncAt = now;
  requestHostPlaybackSync(true);
}

export function requestHostPlaybackSync(force = false) {
  if (!isHostRole()) return;
  if (!state.hostPlaybackSyncReady) return;

  const now = Date.now();
  if (!force && now - state.lastHostPlaybackSyncAt < HOST_PLAYBACK_SYNC_INTERVAL_MS) {
    return;
  }

  if (state.hostPlaybackSyncInFlight) {
    state.hostPlaybackSyncQueued = true;
    state.hostPlaybackSyncQueuedForce = state.hostPlaybackSyncQueuedForce || force;
    return;
  }

  state.hostPlaybackSyncInFlight = true;
  state.lastHostPlaybackSyncAt = now;
  const snapshot = buildLocalPlaybackSnapshot();

  pushSharedPlaybackState(snapshot)
    .catch((err) => {
      console.error('Не удалось синхронизировать playback хоста', err);
    })
    .finally(() => {
      state.hostPlaybackSyncInFlight = false;

      if (!state.hostPlaybackSyncQueued) return;
      const queuedForce = state.hostPlaybackSyncQueuedForce;
      state.hostPlaybackSyncQueued = false;
      state.hostPlaybackSyncQueuedForce = false;
      requestHostPlaybackSync(queuedForce);
    });
}

function toLegacyFilePathFromTrack(track) {
  if (track && track.meta && typeof track.meta.originalPath === 'string' && track.meta.originalPath.trim()) {
    return track.meta.originalPath.trim();
  }
  const src = typeof track?.src === 'string' ? track.src.trim() : '';
  if (!src) return '';

  let normalized = src.replace(/^https?:\/\/[^/]+/i, '');
  const queryIndex = normalized.indexOf('?');
  if (queryIndex >= 0) normalized = normalized.slice(0, queryIndex);
  const hashIndex = normalized.indexOf('#');
  if (hashIndex >= 0) normalized = normalized.slice(0, hashIndex);
  if (normalized.startsWith('/audio/')) normalized = normalized.slice('/audio/'.length);
  else if (normalized.startsWith('audio/')) normalized = normalized.slice('audio/'.length);
  else normalized = normalized.replace(/^\/+/, '');
  return normalized.trim();
}

function buildLegacyShapeFromPlaylists(playlists, explicitTrackTitleModes = null) {
  const normalizedPlaylists = Array.isArray(playlists) ? playlists : [];
  const layout = [];
  const playlistNames = [];
  const playlistMeta = [];
  const playlistAutoplay = [];
  const playlistDsp = [];
  const trackTitleModesByTrack =
    explicitTrackTitleModes && typeof explicitTrackTitleModes === 'object'
      ? { ...explicitTrackTitleModes }
      : {};

  normalizedPlaylists.forEach((playlist, playlistIndex) => {
    const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
    const files = [];
    tracks.forEach((track) => {
      const filePath = toLegacyFilePathFromTrack(track);
      if (!filePath) return;
      files.push(filePath);
      if (track?.meta?.titleMode === 'attributes') {
        trackTitleModesByTrack[filePath] = 'attributes';
      }
    });
    layout.push(files);
    playlistNames.push(typeof playlist?.name === 'string' && playlist.name.trim() ? playlist.name.trim() : `Плей-лист ${playlistIndex + 1}`);
    if (playlist?.type === PLAYLIST_TYPE_FOLDER) {
      playlistMeta.push({
        type: PLAYLIST_TYPE_FOLDER,
        folderKey: typeof playlist?.folderKey === 'string' ? playlist.folderKey : undefined,
        folderOriginalName: typeof playlist?.folderOriginalName === 'string' ? playlist.folderOriginalName : undefined,
      });
    } else {
      playlistMeta.push({ type: 'manual' });
    }
    playlistAutoplay.push(Boolean(playlist?.settings?.autoPlayEnabled));
    playlistDsp.push(Boolean(playlist?.settings?.dspEnabled) && Boolean(playlist?.settings?.autoPlayEnabled));
  });

  return {
    layout,
    playlistNames,
    playlistMeta,
    playlistAutoplay,
    playlistDsp,
    trackTitleModesByTrack,
  };
}

function buildPlaylistsFromLegacyShape({
  layout,
  playlistNames,
  playlistMeta,
  playlistAutoplay,
  playlistDsp,
  trackTitleModesByTrack,
} = {}) {
  const safeLayout = Array.isArray(layout) ? layout : [[]];
  const names = Array.isArray(playlistNames) ? playlistNames : [];
  const meta = Array.isArray(playlistMeta) ? playlistMeta : [];
  const autoplay = Array.isArray(playlistAutoplay) ? playlistAutoplay : [];
  const dsp = Array.isArray(playlistDsp) ? playlistDsp : [];
  const titleModes = trackTitleModesByTrack && typeof trackTitleModesByTrack === 'object' ? trackTitleModesByTrack : {};
  const previousPlaylists = Array.isArray(state.playlists) ? state.playlists : [];

  return safeLayout.map((files, playlistIndex) => {
    const previousPlaylist = previousPlaylists[playlistIndex];
    const playlistId =
      previousPlaylist && typeof previousPlaylist.id === 'string' && previousPlaylist.id
        ? previousPlaylist.id
        : `p-${playlistIndex}`;
    const tracks = (Array.isArray(files) ? files : []).map((filePath, trackIndex) => {
      const previousTrack = previousPlaylist && Array.isArray(previousPlaylist.tracks) ? previousPlaylist.tracks[trackIndex] : null;
      const cleanPath = typeof filePath === 'string' ? filePath.trim() : '';
      return {
        id: previousTrack && typeof previousTrack.id === 'string' && previousTrack.id ? previousTrack.id : `${playlistId}-t-${trackIndex}`,
        src: `/audio/${cleanPath.replace(/^\/+/, '')}`,
        meta: {
          originalPath: cleanPath,
          ...(titleModes[cleanPath] ? { titleMode: titleModes[cleanPath] } : {}),
        },
      };
    });
    const metaEntry = meta[playlistIndex] || {};
    const playlist = {
      id: playlistId,
      name: typeof names[playlistIndex] === 'string' && names[playlistIndex].trim() ? names[playlistIndex].trim() : `Плей-лист ${playlistIndex + 1}`,
      type: metaEntry.type === PLAYLIST_TYPE_FOLDER ? PLAYLIST_TYPE_FOLDER : 'manual',
      tracks,
      settings: {
        autoPlayEnabled: Boolean(autoplay[playlistIndex]),
        dspEnabled: Boolean(dsp[playlistIndex]) && Boolean(autoplay[playlistIndex]),
      },
      uiState: previousPlaylist?.uiState || null,
    };
    if (playlist.type === PLAYLIST_TYPE_FOLDER) {
      if (typeof metaEntry.folderKey === 'string' && metaEntry.folderKey) {
        playlist.folderKey = metaEntry.folderKey;
      }
      if (typeof metaEntry.folderOriginalName === 'string' && metaEntry.folderOriginalName) {
        playlist.folderOriginalName = metaEntry.folderOriginalName;
      }
    }
    return playlist;
  });
}

function buildLegacyDapConfigFromM2A(dapConfig, playlists) {
  const safeConfig = dapConfig && typeof dapConfig === 'object' ? dapConfig : {};
  const safePlaylists = Array.isArray(playlists) ? playlists : [];
  let playlistIndex = null;

  if (typeof safeConfig.playlistId === 'string' && safeConfig.playlistId.trim()) {
    const normalizedId = safeConfig.playlistId.trim();
    const foundIndex = safePlaylists.findIndex((playlist) => playlist && playlist.id === normalizedId);
    if (foundIndex >= 0) {
      playlistIndex = foundIndex;
    } else {
      const idxMatch = normalizedId.match(/^p-(\d+)$/);
      playlistIndex = idxMatch ? parseInt(idxMatch[1], 10) : null;
    }
  }

  return {
    enabled: Boolean(safeConfig.enabled) && playlistIndex !== null,
    playlistIndex,
    playlistId: typeof safeConfig.playlistId === 'string' ? safeConfig.playlistId : null,
    volumePercent: Number.isFinite(Number(safeConfig.volumePercent))
      ? Number(safeConfig.volumePercent)
      : (DEFAULT_DAP_CONFIG.volumePercent || 5),
  };
}

function buildM2ADapConfigFromLegacy(dapConfig, playlists) {
  const safeConfig = dapConfig && typeof dapConfig === 'object' ? dapConfig : {};
  const safePlaylists = Array.isArray(playlists) ? playlists : [];

  let playlistId =
    typeof safeConfig.playlistId === 'string' && safeConfig.playlistId.trim()
      ? safeConfig.playlistId.trim()
      : null;

  if (!playlistId) {
    const playlistIndex = normalizePlaylistTrackIndex(safeConfig.playlistIndex);
    if (playlistIndex !== null && safePlaylists[playlistIndex] && typeof safePlaylists[playlistIndex].id === 'string') {
      playlistId = safePlaylists[playlistIndex].id;
    }
  }

  return {
    enabled: Boolean(safeConfig.enabled) && Boolean(playlistId),
    playlistId: playlistId || null,
    volumePercent: Number.isFinite(Number(safeConfig.volumePercent))
      ? Number(safeConfig.volumePercent)
      : (DEFAULT_DAP_CONFIG.volumePercent || 5),
  };
}

function normalizeServerLayoutPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  if (!Array.isArray(payload.playlists)) {
    throw new Error('Неверный формат layout payload: playlists обязательны.');
  }

  const playlists = payload.playlists;
  const legacy = buildLegacyShapeFromPlaylists(playlists, payload.trackTitleModesByTrack);
  const explicitTrackTitleModes =
    payload.trackTitleModesByTrack && typeof payload.trackTitleModesByTrack === 'object'
      ? payload.trackTitleModesByTrack
      : null;
  return {
    playlists,
    layout: Array.isArray(legacy.layout) ? legacy.layout : [[]],
    playlistNames: Array.isArray(legacy.playlistNames) ? legacy.playlistNames : [],
    playlistMeta: Array.isArray(legacy.playlistMeta) ? legacy.playlistMeta : [],
    playlistAutoplay: Array.isArray(legacy.playlistAutoplay) ? legacy.playlistAutoplay : [],
    playlistDsp: Array.isArray(legacy.playlistDsp) ? legacy.playlistDsp : [],
    dapConfig: buildLegacyDapConfigFromM2A(payload.dapConfig, playlists),
    trackTitleModesByTrack: explicitTrackTitleModes || legacy.trackTitleModesByTrack || {},
    version: Number.isFinite(Number(payload.version)) ? Number(payload.version) : 0,
  };
}

export async function fetchSharedLayoutState() {
  const { ok, data } = await api.fetchLayout();

  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось получить конфигурацию плей-листов');
  }

  return normalizeServerLayoutPayload(data);
}

export async function pushSharedLayout({ renderOnApply = true } = {}) {
  const payloadTrackTitleModes = _deps.serializeTrackTitleModesByTrack();
  const sourceLegacyState = (() => {
    if (Array.isArray(state.playlists) && state.playlists.length) {
      return buildLegacyShapeFromPlaylists(state.playlists, payloadTrackTitleModes);
    }
    return {
      layout: _deps.ensurePlaylists(state.layout),
      playlistNames: Array.isArray(state.playlistNames) ? state.playlistNames.slice() : [],
      playlistMeta: _deps.normalizePlaylistMeta(state.playlistMeta, _deps.ensurePlaylists(state.layout).length),
      playlistAutoplay: Array.isArray(state.playlistAutoplay) ? state.playlistAutoplay.slice() : [],
      playlistDsp: Array.isArray(state.playlistDsp) ? state.playlistDsp.slice() : [],
      trackTitleModesByTrack: payloadTrackTitleModes,
    };
  })();
  const payloadState = _deps.ensureFolderPlaylistsCoverage(
    sourceLegacyState.layout,
    sourceLegacyState.playlistNames,
    sourceLegacyState.playlistMeta,
  );
  const payloadDapConfig = _deps.normalizeDapConfig(state.dapConfig, payloadState.layout.length, state.dapConfig);
  const payloadAutoplay = _deps.normalizePlaylistAutoplayWithDap(
    sourceLegacyState.playlistAutoplay,
    payloadDapConfig,
    payloadState.layout.length,
  );
  const payloadDsp = _deps.normalizePlaylistDspFlags(
    sourceLegacyState.playlistDsp,
    payloadAutoplay,
    payloadState.layout.length,
  );
  state.layout = payloadState.layout;
  state.playlistNames = payloadState.playlistNames;
  state.playlistMeta = payloadState.playlistMeta;
  state.playlistAutoplay = payloadAutoplay;
  state.playlistDsp = payloadDsp;
  state.dapConfig = payloadDapConfig;
  const payloadPlaylists = buildPlaylistsFromLegacyShape({
    layout: payloadState.layout,
    playlistNames: payloadState.playlistNames,
    playlistMeta: payloadState.playlistMeta,
    playlistAutoplay: payloadAutoplay,
    playlistDsp: payloadDsp,
    trackTitleModesByTrack: payloadTrackTitleModes,
  });
  state.playlists = payloadPlaylists;

  const { ok, data } = await api.postLayout({
    playlists: payloadPlaylists,
    dapConfig: buildM2ADapConfigFromLegacy(payloadDapConfig, payloadPlaylists),
    trackTitleModesByTrack: payloadTrackTitleModes,
    clientId: _deps.clientId,
    version: state.layoutVersion,
  });

  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось синхронизировать плей-листы');
  }

  const normalizedResponse = normalizeServerLayoutPayload(data);
  applyIncomingLayoutState(
    normalizedResponse.layout,
    normalizedResponse.playlistNames,
    normalizedResponse.playlistMeta,
    normalizedResponse.playlistAutoplay,
    normalizedResponse.playlistDsp,
    normalizedResponse.dapConfig,
    normalizedResponse.trackTitleModesByTrack,
    normalizedResponse.version,
    renderOnApply,
    normalizedResponse.playlists,
  );
}

export function connectLayoutStream() {
  createLayoutStream({
    onLayout(payload) {
      if (!payload) return;
      let normalizedPayload;
      try {
        normalizedPayload = normalizeServerLayoutPayload(payload);
      } catch (err) {
        console.error('Игнорируем неподдерживаемый layout payload', err);
        return;
      }
      applyIncomingLayoutState(
        normalizedPayload.layout,
        normalizedPayload.playlistNames,
        normalizedPayload.playlistMeta,
        normalizedPayload.playlistAutoplay,
        normalizedPayload.playlistDsp,
        normalizedPayload.dapConfig,
        normalizedPayload.trackTitleModesByTrack,
        normalizedPayload.version,
        true,
        normalizedPayload.playlists,
      );
    },
    onPlayback(payload) {
      applyIncomingHostPlaybackState(payload, true);
    },
    onAuthUsers(payload) {
      applyIncomingAuthUsers(payload, { syncOwnRole: true });
    },
    onPlaybackCommand(payload) {
      executeIncomingPlaybackCommand(payload).catch(() => {});
    },
    onError() {
      scheduleReconnect(connectLayoutStream);
    },
  });
}

export async function initializePlaybackState() {
  const serverPlayback = await fetchSharedPlaybackState();
  applyIncomingHostPlaybackState(serverPlayback, true);
}

export async function initializeLayoutState() {
  const serverState = await fetchSharedLayoutState();
  const incomingLegacyState = deriveLegacyStateFromPlaylists(serverState.playlists, {
    dapConfig: serverState.dapConfig,
    trackTitleModesByTrack: serverState.trackTitleModesByTrack,
  });
  const incomingLayout = _deps.ensurePlaylists(incomingLegacyState.layout);
  const incomingNames = _deps.normalizePlaylistNames(incomingLegacyState.playlistNames, incomingLayout.length);
  const incomingMeta = _deps.normalizePlaylistMeta(incomingLegacyState.playlistMeta, incomingLayout.length);
  const incomingDap = _deps.normalizeDapConfig(incomingLegacyState.dapConfig, incomingLayout.length, DEFAULT_DAP_CONFIG);
  const incomingAutoplay = _deps.normalizePlaylistAutoplayWithDap(incomingLegacyState.playlistAutoplay, incomingDap, incomingLayout.length);
  const incomingDsp = _deps.normalizePlaylistDspFlags(incomingLegacyState.playlistDsp, incomingAutoplay, incomingLayout.length);
  const incomingTrackTitleModes = _deps.normalizeTrackTitleModesByTrackForFiles(
    incomingLegacyState.trackTitleModesByTrack,
    state.availableFiles,
    '/audio',
  );

  let nextLayout = _deps.normalizeLayoutForFiles(incomingLayout, state.availableFiles);
  let nextNames = _deps.normalizePlaylistNames(incomingNames, nextLayout.length);
  let nextMeta = _deps.normalizePlaylistMeta(incomingMeta, nextLayout.length);
  let nextDap = _deps.normalizeDapConfig(incomingDap, nextLayout.length, incomingDap);
  let nextAutoplay = _deps.normalizePlaylistAutoplayWithDap(incomingAutoplay, nextDap, nextLayout.length);
  let nextDsp = _deps.normalizePlaylistDspFlags(incomingDsp, nextAutoplay, nextLayout.length);
  let nextTrackTitleModes = _deps.normalizeTrackTitleModesByTrackForFiles(incomingTrackTitleModes, state.availableFiles, '/audio');
  let shouldPush =
    !_deps.layoutsEqual(incomingLayout, nextLayout) ||
    !_deps.playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !_deps.playlistMetaEqual(incomingMeta, nextMeta, nextLayout.length) ||
    !_deps.playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length) ||
    !_deps.playlistDspEqual(incomingDsp, nextDsp, nextAutoplay, nextLayout.length) ||
    !_deps.dapConfigEqual(incomingDap, nextDap, nextLayout.length) ||
    !_deps.trackTitleModesByTrackEqual(incomingTrackTitleModes, nextTrackTitleModes);

  const withFolderCoverage = _deps.ensureFolderPlaylistsCoverage(nextLayout, nextNames, nextMeta);
  nextLayout = withFolderCoverage.layout;
  nextNames = withFolderCoverage.playlistNames;
  nextMeta = withFolderCoverage.playlistMeta;
  nextDap = _deps.normalizeDapConfig(nextDap, nextLayout.length, nextDap);
  nextAutoplay = _deps.normalizePlaylistAutoplayWithDap(nextAutoplay, nextDap, nextLayout.length);
  nextDsp = _deps.normalizePlaylistDspFlags(nextDsp, nextAutoplay, nextLayout.length);
  nextTrackTitleModes = _deps.normalizeTrackTitleModesByTrackForFiles(nextTrackTitleModes, state.availableFiles, '/audio');

  shouldPush =
    shouldPush ||
    !_deps.layoutsEqual(incomingLayout, nextLayout) ||
    !_deps.playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !_deps.playlistMetaEqual(incomingMeta, nextMeta, nextLayout.length) ||
    !_deps.playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length) ||
    !_deps.playlistDspEqual(incomingDsp, nextDsp, nextAutoplay, nextLayout.length) ||
    !_deps.dapConfigEqual(incomingDap, nextDap, nextLayout.length) ||
    !_deps.trackTitleModesByTrackEqual(incomingTrackTitleModes, nextTrackTitleModes);

  state.layout = nextLayout;
  state.playlistNames = nextNames;
  state.playlistMeta = nextMeta;
  state.dapConfig = _deps.normalizeDapConfig(nextDap, state.layout.length, nextDap);
  state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(nextAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = _deps.normalizePlaylistDspFlags(nextDsp, state.playlistAutoplay, state.layout.length);
  state.trackTitleModesByTrack = nextTrackTitleModes;
  state.playlists = serverState.playlists;
  _deps.saveTrackTitleModesByTrackSetting();
  state.layoutVersion = serverState.version;

  if (shouldPush) {
    await pushSharedLayout({ renderOnApply: false });
  }

  try {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  } catch (err) {
    // Ignore storage cleanup errors.
  }
}

export function getDefaultHostPlaybackState() {
  return {
    trackFile: null,
    trackId: null,
    paused: false,
    currentTime: 0,
    duration: null,
    volume: DEFAULT_LIVE_VOLUME,
    showVolumePresets: false,
    allowLiveSeek: false,
    dapPlayback: getDefaultDapPlaybackState(),
    playlistId: null,
    updatedAt: 0,
    sourceClientId: null,
  };
}

export function getDefaultDapPlaybackState() {
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

export function sanitizeIncomingDapPlaybackState(rawState) {
  const base = getDefaultDapPlaybackState();
  if (!rawState || typeof rawState !== 'object') {
    return base;
  }

  const rawTrackFile = typeof rawState.trackFile === 'string' ? rawState.trackFile.trim() : '';
  const trackId = normalizePlaybackIdentity(rawState.trackId, 80);
  const playlistId = normalizePlaybackIdentity(rawState.playlistId, 64);
  if (!rawTrackFile) {
    const updatedAt = Number(rawState.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0) {
      base.updatedAt = updatedAt;
    }
    base.trackId = trackId;
    base.playlistId = playlistId;
    return base;
  }

  const rawCurrentTime = Number(rawState.currentTime);
  let currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;

  const rawDuration = Number(rawState.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  if (duration !== null && currentTime > duration) {
    currentTime = duration;
  }

  const resolvedContext = resolvePlaylistTrackContextByIds({
    file: rawTrackFile,
    playlistId,
    trackId,
    playlistIndex: rawState.playlistIndex,
    playlistPosition: rawState.playlistPosition,
  });
  const updatedAt = Number(rawState.updatedAt);
  return {
    trackFile: rawTrackFile,
    trackId: resolvedContext.trackId || trackId,
    paused: Boolean(rawState.paused),
    currentTime,
    duration,
    playlistId: resolvedContext.playlistId || playlistId,
    interrupted: Boolean(rawState.interrupted),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
  };
}

export function sanitizeIncomingHostPlaybackState(rawState) {
  const base = getDefaultHostPlaybackState();
  if (!rawState || typeof rawState !== 'object') {
    base.updatedAt = Date.now();
    return base;
  }

  base.volume = normalizeLiveVolumePreset(rawState.volume, DEFAULT_LIVE_VOLUME);
  const hasExplicitShowVolumePresets = Object.prototype.hasOwnProperty.call(rawState, 'showVolumePresets');
  let showVolumePresets = hasExplicitShowVolumePresets
    ? Boolean(rawState.showVolumePresets)
    : getActiveVolumePresetValue(base.volume) !== null;
  if (!showVolumePresets && getActiveVolumePresetValue(base.volume) !== null) {
    showVolumePresets = true;
  }
  base.showVolumePresets = showVolumePresets;
  base.allowLiveSeek = Boolean(rawState.allowLiveSeek);

  const rawTrackFile = typeof rawState.trackFile === 'string' ? rawState.trackFile.trim() : '';
  const trackId = normalizePlaybackIdentity(rawState.trackId, 80);
  const playlistId = normalizePlaybackIdentity(rawState.playlistId, 64);
  if (!rawTrackFile) {
    base.dapPlayback = sanitizeIncomingDapPlaybackState(rawState.dapPlayback);
    base.trackId = trackId;
    base.playlistId = playlistId;
    base.updatedAt = Number.isFinite(Number(rawState.updatedAt)) ? Number(rawState.updatedAt) : Date.now();
    return base;
  }

  const rawCurrentTime = Number(rawState.currentTime);
  let currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;

  const rawDuration = Number(rawState.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  if (duration !== null && currentTime > duration) {
    currentTime = duration;
  }

  const updatedAt = Number(rawState.updatedAt);
  const sourceClientId = typeof rawState.sourceClientId === 'string' ? rawState.sourceClientId.slice(0, 128) : null;
  const resolvedContext = resolvePlaylistTrackContextByIds({
    file: rawTrackFile,
    playlistId,
    trackId,
    playlistIndex: rawState.playlistIndex,
    playlistPosition: rawState.playlistPosition,
  });

  return {
    trackFile: rawTrackFile,
    trackId: resolvedContext.trackId || trackId,
    paused: Boolean(rawState.paused),
    currentTime,
    duration,
    volume: base.volume,
    showVolumePresets: base.showVolumePresets,
    allowLiveSeek: base.allowLiveSeek,
    dapPlayback: sanitizeIncomingDapPlaybackState(rawState.dapPlayback),
    playlistId: resolvedContext.playlistId || playlistId,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    sourceClientId,
  };
}

export function serializeHostPlaybackState(state) {
  const normalized = sanitizeIncomingHostPlaybackState(state);
  return JSON.stringify({
    trackFile: normalized.trackFile,
    trackId: normalized.trackId,
    paused: normalized.paused,
    currentTime: normalized.currentTime,
    duration: normalized.duration,
    volume: normalized.volume,
    showVolumePresets: normalized.showVolumePresets,
    allowLiveSeek: normalized.allowLiveSeek,
    dapPlayback: {
      trackFile: normalized.dapPlayback.trackFile,
      trackId: normalized.dapPlayback.trackId,
      paused: normalized.dapPlayback.paused,
      currentTime: normalized.dapPlayback.currentTime,
      duration: normalized.dapPlayback.duration,
      playlistId: normalized.dapPlayback.playlistId,
      interrupted: normalized.dapPlayback.interrupted,
    },
    playlistId: normalized.playlistId,
    updatedAt: normalized.updatedAt,
  });
}

export function getKnownDurationSeconds(fileKey) {
  const value = state.knownTrackDurations.get(fileKey);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function getCurrentTrackRemainingSeconds() {
  if (!state.currentTrack || !state.currentAudio) return null;
  const duration = _deps.getDuration(state.currentAudio);
  if (!duration) {
    return getKnownDurationSeconds(state.currentTrack.key);
  }

  const currentTime = Number.isFinite(state.currentAudio.currentTime) ? state.currentAudio.currentTime : 0;
  return Math.max(0, duration - Math.max(0, currentTime));
}

export function isTrackPlaybackContextEqual(leftContext = null, rightContext = null) {
  const left = normalizeTrackPlaybackContext(leftContext);
  const right = normalizeTrackPlaybackContext(rightContext);
  if (left.playlistIndex === null || left.playlistPosition === null) return false;
  if (right.playlistIndex === null || right.playlistPosition === null) return false;
  return left.playlistIndex === right.playlistIndex && left.playlistPosition === right.playlistPosition;
}

export function resolveDurationLabelPlaybackContext(label) {
  if (!label || typeof label.closest !== 'function') return null;
  const card = label.closest('.track-card');
  if (!card) return null;
  const context = normalizeTrackPlaybackContext({
    playlistIndex: card.dataset.playlistIndex,
    playlistPosition: card.dataset.playlistPosition,
  });
  if (context.playlistIndex === null || context.playlistPosition === null) return null;
  return context;
}

export function getDapInterruptedPlaybackDisplayState(config = state.dapConfig) {
  const interruptedTrack = _deps.resolveDapInterruptedPlaybackTrack(config);
  if (!interruptedTrack) return null;

  const playbackContext = normalizeTrackPlaybackContext(interruptedTrack);
  if (playbackContext.playlistIndex === null || playbackContext.playlistPosition === null) return null;

  const fileKey = trackKey(interruptedTrack.file, interruptedTrack.basePath || '/audio');
  if (
    state.currentTrack &&
    state.currentAudio &&
    !state.currentAudio.paused &&
    state.currentTrack.key === fileKey &&
    isTrackPlaybackContextEqual(state.currentTrack, playbackContext)
  ) {
    return null;
  }

  const rawStartAtSeconds =
    state.dapInterruptedPlaybackSnapshot && Number.isFinite(Number(state.dapInterruptedPlaybackSnapshot.startAtSeconds))
      ? Number(state.dapInterruptedPlaybackSnapshot.startAtSeconds)
      : 0;
  const startAtSeconds = Math.max(0, rawStartAtSeconds);
  const knownDuration = getKnownDurationSeconds(fileKey);
  const remainingSeconds =
    Number.isFinite(knownDuration) && knownDuration > 0 ? Math.max(0, knownDuration - startAtSeconds) : null;

  return {
    fileKey,
    playbackContext,
    remainingSeconds,
  };
}

export function getHostDapInterruptedPlaybackDisplayState() {
  const dapPlaybackState = sanitizeIncomingDapPlaybackState(
    state.hostPlaybackState && typeof state.hostPlaybackState === 'object' ? state.hostPlaybackState.dapPlayback : null,
  );
  if (!dapPlaybackState.trackFile || !dapPlaybackState.paused || !dapPlaybackState.interrupted) {
    return null;
  }

  const playbackContext = normalizeTrackPlaybackContext(dapPlaybackState);
  if (playbackContext.playlistIndex === null || playbackContext.playlistPosition === null) {
    return null;
  }

  const fileKey = trackKey(dapPlaybackState.trackFile, '/audio');
  const knownDuration = getKnownDurationSeconds(fileKey);
  const duration =
    Number.isFinite(dapPlaybackState.duration) && dapPlaybackState.duration > 0
      ? dapPlaybackState.duration
      : knownDuration;
  const elapsed = getDapPlaybackElapsedSeconds(dapPlaybackState);
  const remainingSeconds = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - elapsed) : null;

  return {
    fileKey,
    playbackContext,
    remainingSeconds,
  };
}

export function getVisibleDapInterruptedPlaybackDisplayState(config = state.dapConfig) {
  if (isHostRole()) {
    return getDapInterruptedPlaybackDisplayState(config);
  }
  return getHostDapInterruptedPlaybackDisplayState();
}

export function buildDapPlaybackSnapshotForSync(config = state.dapConfig) {
  const snapshot = getDefaultDapPlaybackState();

  if (state.currentTrack && state.currentAudio && isDapTrackContext(state.currentTrack, config) && typeof state.currentTrack.file === 'string') {
    const trackFile = state.currentTrack.file.trim();
    if (trackFile) {
      const rawCurrentTime = Number(state.currentAudio.currentTime);
      let currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;
      const resolvedDuration = _deps.getDuration(state.currentAudio) || getKnownDurationSeconds(state.currentTrack.key);
      const duration = Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : null;
      if (duration !== null && currentTime > duration) {
        currentTime = duration;
      }
      return {
        trackFile,
        trackId: normalizePlaybackIdentity(state.currentTrack.trackId, 80),
        paused: Boolean(state.currentAudio.paused),
        currentTime,
        duration,
        playlistId: normalizePlaybackIdentity(state.currentTrack.playlistId, 64),
        interrupted: false,
        updatedAt: Date.now(),
      };
    }
  }

  const interruptedTrack = _deps.resolveDapInterruptedPlaybackTrack(config);
  if (!interruptedTrack || typeof interruptedTrack.file !== 'string') {
    return snapshot;
  }

  const trackFile = interruptedTrack.file.trim();
  if (!trackFile) {
    return snapshot;
  }

  const fileKey = trackKey(trackFile, interruptedTrack.basePath || '/audio');
  const knownDuration = getKnownDurationSeconds(fileKey);
  const duration = Number.isFinite(knownDuration) && knownDuration > 0 ? knownDuration : null;
  const rawCurrentTime = Number(interruptedTrack.startAtSeconds);
  let currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;
  if (duration !== null && currentTime > duration) {
    currentTime = duration;
  }

  return {
    trackFile,
    trackId: normalizePlaybackIdentity(interruptedTrack.trackId, 80),
    paused: true,
    currentTime,
    duration,
    playlistId: normalizePlaybackIdentity(interruptedTrack.playlistId, 64),
    interrupted: true,
    updatedAt: Date.now(),
  };
}

export function getDapPlaybackElapsedSeconds(playbackState) {
  const normalized = sanitizeIncomingDapPlaybackState(playbackState);
  if (!normalized.trackFile) return 0;

  const baseElapsed = Number.isFinite(normalized.currentTime) && normalized.currentTime >= 0 ? normalized.currentTime : 0;
  if (normalized.paused) {
    return baseElapsed;
  }

  const deltaSeconds = Math.max(0, Date.now() - normalized.updatedAt) / 1000;
  const elapsed = baseElapsed + deltaSeconds;
  if (Number.isFinite(normalized.duration) && normalized.duration > 0) {
    return Math.min(elapsed, normalized.duration);
  }

  return elapsed;
}

export function getHostPlaybackElapsedSeconds() {
  if (!state.hostPlaybackState || !state.hostPlaybackState.trackFile) return 0;

  const baseElapsed =
    Number.isFinite(state.hostPlaybackState.currentTime) && state.hostPlaybackState.currentTime >= 0 ? state.hostPlaybackState.currentTime : 0;

  if (state.hostPlaybackState.paused) {
    return baseElapsed;
  }

  const deltaSeconds = Math.max(0, Date.now() - state.hostPlaybackState.updatedAt) / 1000;
  const elapsed = baseElapsed + deltaSeconds;

  if (Number.isFinite(state.hostPlaybackState.duration) && state.hostPlaybackState.duration > 0) {
    return Math.min(elapsed, state.hostPlaybackState.duration);
  }

  return elapsed;
}

export function getProgressUiFrameIntervalMs() {
  if (typeof window !== 'object' || typeof window.matchMedia !== 'function') return 0;
  return window.matchMedia('(pointer: coarse)').matches ? MOBILE_PROGRESS_UI_MIN_INTERVAL_MS : 0;
}

export function clearHostTrackHighlight() {
  for (const cards of state.cardsByFile.values()) {
    if (!cards || !cards.size) continue;
    for (const card of cards) {
      card.classList.remove('is-host-playing', 'is-host-paused');
    }
  }
}

export function clearLiveDspNextTrackHighlight() {
  for (const cards of state.cardsByFile.values()) {
    if (!cards || !cards.size) continue;
    for (const card of cards) {
      card.classList.remove('is-dsp-next-ready');
    }
  }
}

export function normalizeTrackPlaybackContext(playbackContext = null) {
  const playlistIndex = normalizePlaylistTrackIndex(playbackContext ? playbackContext.playlistIndex : null);
  const playlistPosition = normalizePlaylistTrackIndex(playbackContext ? playbackContext.playlistPosition : null);
  if (playlistIndex !== null && playlistPosition !== null) {
    return { playlistIndex, playlistPosition };
  }

  const resolvedContext = resolvePlaylistTrackContextByIds({
    file: playbackContext && (playbackContext.file || playbackContext.trackFile),
    playlistId: playbackContext ? playbackContext.playlistId : null,
    trackId: playbackContext ? playbackContext.trackId : null,
    playlistIndex,
    playlistPosition,
  });
  return {
    playlistIndex: normalizePlaylistTrackIndex(resolvedContext.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(resolvedContext.playlistPosition),
  };
}

export function resolveTrackContextInLayoutByFile(
  file,
  { preferredPlaylistIndex = null, preferredPlaylistPosition = null } = {},
) {
  const normalizedFile = typeof file === 'string' ? file.trim() : '';
  if (!normalizedFile) return null;

  const normalizedLayout = _deps.ensurePlaylists(state.layout);
  if (!normalizedLayout.length) return null;

  const candidateIndices = [];
  const pushCandidate = (rawIndex) => {
    const index = normalizePlaylistTrackIndex(rawIndex);
    if (index === null || index < 0 || index >= normalizedLayout.length) return;
    if (candidateIndices.includes(index)) return;
    const playlist = Array.isArray(normalizedLayout[index]) ? normalizedLayout[index] : [];
    if (!playlist.includes(normalizedFile)) return;
    candidateIndices.push(index);
  };

  pushCandidate(preferredPlaylistIndex);
  for (let index = 0; index < normalizedLayout.length; index += 1) {
    pushCandidate(index);
  }

  for (const playlistIndex of candidateIndices) {
    const playlist = Array.isArray(normalizedLayout[playlistIndex]) ? normalizedLayout[playlistIndex] : [];
    let playlistPosition =
      playlistIndex === normalizePlaylistTrackIndex(preferredPlaylistIndex)
        ? normalizePlaylistTrackIndex(preferredPlaylistPosition)
        : null;
    if (
      playlistPosition === null ||
      playlistPosition < 0 ||
      playlistPosition >= playlist.length ||
      playlist[playlistPosition] !== normalizedFile
    ) {
      playlistPosition = playlist.indexOf(normalizedFile);
    }
    if (playlistPosition === -1) continue;
    return {
      playlistIndex,
      playlistPosition,
    };
  }

  return null;
}

export function reconcileTrackContextWithLayout(track, { preferredPlaylistIndex = null } = {}) {
  if (!track || typeof track !== 'object') return false;

  const file = typeof track.file === 'string' ? track.file.trim() : '';
  const previousPlaylistIndex = normalizePlaylistTrackIndex(track.playlistIndex);
  const previousPlaylistPosition = normalizePlaylistTrackIndex(track.playlistPosition);
  if (!file) {
    const changed = previousPlaylistIndex !== null || previousPlaylistPosition !== null;
    track.playlistIndex = null;
    track.playlistPosition = null;
    return changed;
  }

  const preferredIndex = normalizePlaylistTrackIndex(preferredPlaylistIndex);
  const fallbackPreferredIndex = preferredIndex !== null ? preferredIndex : previousPlaylistIndex;
  const resolvedContext = resolveTrackContextInLayoutByFile(file, {
    preferredPlaylistIndex: fallbackPreferredIndex,
    preferredPlaylistPosition: previousPlaylistPosition,
  });

  const nextPlaylistIndex = resolvedContext ? resolvedContext.playlistIndex : null;
  const nextPlaylistPosition = resolvedContext ? resolvedContext.playlistPosition : null;
  const changed = previousPlaylistIndex !== nextPlaylistIndex || previousPlaylistPosition !== nextPlaylistPosition;
  if (!changed) return false;

  track.playlistIndex = nextPlaylistIndex;
  track.playlistPosition = nextPlaylistPosition;
  return true;
}

export function reconcileDapInterruptedSnapshotWithLayout() {
  if (!state.dapInterruptedPlaybackSnapshot || typeof state.dapInterruptedPlaybackSnapshot !== 'object') return false;

  const dapPlaylistIndex = _deps.getDapPlaylistIndex(state.dapConfig);
  const previousPlaylistIndex = normalizePlaylistTrackIndex(state.dapInterruptedPlaybackSnapshot.playlistIndex);
  const previousPlaylistPosition = normalizePlaylistTrackIndex(state.dapInterruptedPlaybackSnapshot.playlistPosition);
  const snapshotFile =
    typeof state.dapInterruptedPlaybackSnapshot.file === 'string' ? state.dapInterruptedPlaybackSnapshot.file.trim() : '';

  if (dapPlaylistIndex === null || !snapshotFile) {
    state.dapInterruptedPlaybackSnapshot = null;
    return true;
  }

  const resolvedContext = resolveTrackContextInLayoutByFile(snapshotFile, {
    preferredPlaylistIndex: dapPlaylistIndex,
    preferredPlaylistPosition: previousPlaylistPosition,
  });

  if (!resolvedContext || resolvedContext.playlistIndex !== dapPlaylistIndex) {
    state.dapInterruptedPlaybackSnapshot = null;
    return true;
  }

  const changed =
    previousPlaylistIndex !== resolvedContext.playlistIndex || previousPlaylistPosition !== resolvedContext.playlistPosition;
  if (!changed) return false;

  state.dapInterruptedPlaybackSnapshot.playlistIndex = resolvedContext.playlistIndex;
  state.dapInterruptedPlaybackSnapshot.playlistPosition = resolvedContext.playlistPosition;
  return true;
}

export function buildPlaylistSelectionIdentity(layoutState, metaState, playlistIndex) {
  const normalizedLayout = _deps.ensurePlaylists(layoutState);
  const normalizedIndex = normalizePlaylistTrackIndex(playlistIndex);
  if (normalizedIndex === null || normalizedIndex < 0 || normalizedIndex >= normalizedLayout.length) return '';

  const normalizedMeta = _deps.normalizePlaylistMeta(metaState, normalizedLayout.length);
  const metaEntry = normalizedMeta[normalizedIndex] || _deps.defaultPlaylistMeta();
  const playlist = Array.isArray(normalizedLayout[normalizedIndex]) ? normalizedLayout[normalizedIndex] : [];
  return JSON.stringify({
    type: metaEntry.type,
    folderKey: metaEntry.type === PLAYLIST_TYPE_FOLDER ? metaEntry.folderKey || '' : '',
    files: playlist,
  });
}

export function buildLiveDspNextTrackDescriptor(trackFile, playbackContext = null, basePath = '/audio') {
  const { playlistIndex, playlistPosition } = normalizeTrackPlaybackContext(playbackContext);
  if (typeof trackFile !== 'string' || !trackFile.trim()) return '';
  if (playlistIndex === null || playlistPosition === null) return '';
  const fileKey = trackKey(trackFile, basePath);
  return [fileKey, String(playlistIndex), String(playlistPosition)].join('|');
}

export function parseLiveDspNextTrackDescriptor(descriptor) {
  if (typeof descriptor !== 'string' || !descriptor) return null;
  const parts = descriptor.split('|');
  if (parts.length < 3) return null;

  const playlistIndex = normalizePlaylistTrackIndex(parts[parts.length - 2]);
  const playlistPosition = normalizePlaylistTrackIndex(parts[parts.length - 1]);
  if (playlistIndex === null || playlistPosition === null) return null;

  const fileKey = parts.slice(0, parts.length - 2).join('|');
  if (!fileKey) return null;

  return {
    fileKey,
    playbackContext: {
      playlistIndex,
      playlistPosition,
    },
  };
}

export function resetLiveDspNextTrackPreview() {
  state.liveDspRenderToken += 1;
  state.liveDspNextReadyDescriptor = '';
  state.liveDspNextReadySliceSeconds = null;
  _deps.clearLiveDspContinuationWarmups();
  syncLiveDspNextTrackHighlight();
}

export function isDspTransitionPlaybackActive() {
  return Boolean(state.dspTransitionPlayback && state.dspTransitionPlayback.audio);
}

export function clearDspTransitionTrackHighlight() {
  for (const cards of state.cardsByFile.values()) {
    if (!cards || !cards.size) continue;
    for (const card of cards) {
      card.classList.remove('is-dsp-transition-source', 'is-dsp-transition-target');
    }
  }
}

export function setDspTransitionReelReverse(active) {
  const enabled = Boolean(active);
  if (_deps.nowPlayingControlBtn) {
    _deps.nowPlayingControlBtn.classList.toggle('is-dsp-transition-reverse', enabled);
  }
  if (_deps.hostNowPlayingControlEl) {
    _deps.hostNowPlayingControlEl.classList.toggle('is-dsp-transition-reverse', enabled);
  }
}

export function stopDspTransitionPlayback({ stopAudio = true, clearTrackState = true } = {}) {
  if (!state.dspTransitionPlayback) return;

  const activePlayback = state.dspTransitionPlayback;
  state.dspTransitionPlayback = null;
  setDspTransitionReelReverse(false);
  clearDspTransitionTrackHighlight();

  if (clearTrackState) {
    const sourceTrack = activePlayback.fromTrack || null;
    const targetTrack = activePlayback.toTrack || null;
    if (sourceTrack && sourceTrack.key) {
      _deps.setButtonPlaying(sourceTrack.key, false, sourceTrack);
      _deps.setTrackPaused(sourceTrack.key, false, sourceTrack);
    }
    if (targetTrack && targetTrack.key) {
      _deps.setButtonPlaying(targetTrack.key, false, targetTrack);
      _deps.setTrackPaused(targetTrack.key, false, targetTrack);
    }
  }

  if (stopAudio && activePlayback.audio) {
    try {
      activePlayback.audio.pause();
      activePlayback.audio.currentTime = 0;
    } catch (err) {
      // ignore stop errors for detached audio nodes
    }
  }
}

export function buildHostTrackHighlightDescriptor() {
  if (!isRemoteLiveMirrorRole()) return 'none';
  if (!state.hostPlaybackState || !state.hostPlaybackState.trackFile) return 'none';

  const hostPlaybackContext = normalizeTrackPlaybackContext(state.hostPlaybackState);
  const playlistIndex = normalizePlaylistTrackIndex(hostPlaybackContext.playlistIndex);
  const playlistPosition = normalizePlaylistTrackIndex(hostPlaybackContext.playlistPosition);
  return [
    trackKey(state.hostPlaybackState.trackFile, '/audio'),
    playlistIndex === null ? '' : String(playlistIndex),
    playlistPosition === null ? '' : String(playlistPosition),
    state.hostPlaybackState.paused ? 'paused' : 'playing',
  ].join('|');
}

export function getTrackDurationTextByKey(fileKey, playbackContext = null) {
  const normalizedContext = normalizeTrackPlaybackContext(playbackContext);
  const hasContext = normalizedContext.playlistIndex !== null && normalizedContext.playlistPosition !== null;

  const isCurrent = Boolean(
    state.currentTrack &&
      state.currentAudio &&
      state.currentTrack.key === fileKey &&
      (!hasContext || isTrackPlaybackContextEqual(state.currentTrack, normalizedContext)),
  );

  if (isCurrent) {
    const remaining = getCurrentTrackRemainingSeconds();
    return formatDuration(remaining, { useCeil: true });
  }

  const interruptedDap = getVisibleDapInterruptedPlaybackDisplayState(state.dapConfig);
  if (
    interruptedDap &&
    interruptedDap.fileKey === fileKey &&
    hasContext &&
    isTrackPlaybackContextEqual(interruptedDap.playbackContext, normalizedContext)
  ) {
    return formatDuration(interruptedDap.remainingSeconds, { useCeil: true });
  }

  const isRemoteLiveCurrent =
    isRemoteLiveMirrorRole() &&
    state.hostPlaybackState &&
    typeof state.hostPlaybackState.trackFile === 'string' &&
    state.hostPlaybackState.trackFile.trim()
      ? trackKey(state.hostPlaybackState.trackFile, '/audio') === fileKey
      : false;
  const remoteLiveContextMatches = !hasContext || isTrackPlaybackContextEqual(state.hostPlaybackState, normalizedContext);
  if (isRemoteLiveCurrent && remoteLiveContextMatches) {
    const knownDuration = getKnownDurationSeconds(fileKey);
    const duration =
      Number.isFinite(state.hostPlaybackState.duration) && state.hostPlaybackState.duration > 0 ? state.hostPlaybackState.duration : knownDuration;
    if (Number.isFinite(duration) && duration > 0) {
      const remaining = Math.max(0, duration - getHostPlaybackElapsedSeconds());
      return formatDuration(remaining, { useCeil: true });
    }
  }

  return formatDuration(getKnownDurationSeconds(fileKey), { useCeil: false });
}

export function refreshTrackDurationLabels(fileKey) {
  if (!fileKey) return;
  const labels = state.durationLabelsByFile.get(fileKey);
  if (!labels || !labels.size) return;

  for (const label of labels) {
    const context = resolveDurationLabelPlaybackContext(label);
    label.textContent = getTrackDurationTextByKey(fileKey, context);
  }
}

export function getPlaylistTotalDurationSeconds(playlistIndex) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return 0;
  const playlist = Array.isArray(state.layout[playlistIndex]) ? state.layout[playlistIndex] : [];
  let totalSeconds = 0;

  for (const file of playlist) {
    if (typeof file !== 'string' || !file) continue;
    const knownDuration = getKnownDurationSeconds(trackKey(file, '/audio'));
    if (!Number.isFinite(knownDuration) || knownDuration <= 0) continue;
    totalSeconds += knownDuration;
  }

  return totalSeconds;
}

export function getPlaylistDurationText(playlistIndex) {
  return formatPlaylistDuration(getPlaylistTotalDurationSeconds(playlistIndex));
}

export function refreshPlaylistDurationLabel(playlistIndex) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return;
  const label = state.playlistDurationLabelsByIndex.get(playlistIndex);
  if (!label) return;
  label.textContent = getPlaylistDurationText(playlistIndex);
}

export function refreshAllPlaylistDurationLabels() {
  for (const playlistIndex of state.playlistDurationLabelsByIndex.keys()) {
    refreshPlaylistDurationLabel(playlistIndex);
  }
}

export function cacheTrackDuration(fileKey, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

  const previous = state.knownTrackDurations.get(fileKey);
  if (Number.isFinite(previous) && Math.abs(previous - durationSeconds) < 0.05) return;

  state.knownTrackDurations.set(fileKey, durationSeconds);
  refreshTrackDurationLabels(fileKey);
  refreshAllPlaylistDurationLabels();

  if (state.currentTrack && state.currentTrack.key === fileKey) {
    syncNowPlayingPanel();
  }
}

export function loadTrackDurationMetadata(file, basePath = '/audio') {
  const key = trackKey(file, basePath);
  const cached = getKnownDurationSeconds(key);
  if (cached !== null) return Promise.resolve(cached);

  const pending = state.durationLoadPromises.get(key);
  if (pending) return pending;

  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const encoded = encodeURIComponent(file);
  const source = `${normalizedBase}/${encoded}`;

  const request = new Promise((resolve) => {
    const probe = new Audio();
    let settled = false;

    const finish = (durationValue = null) => {
      if (settled) return;
      settled = true;
      probe.removeEventListener('loadedmetadata', handleLoadedMetadata);
      probe.removeEventListener('durationchange', handleLoadedMetadata);
      probe.removeEventListener('error', handleError);
      probe.removeEventListener('abort', handleError);
      state.durationLoadPromises.delete(key);
      resolve(durationValue);
    };

    const handleLoadedMetadata = () => {
      const durationValue = _deps.getDuration(probe);
      if (durationValue) {
        cacheTrackDuration(key, durationValue);
        finish(durationValue);
        return;
      }
      finish(null);
    };

    const handleError = () => {
      finish(null);
    };

    probe.preload = 'metadata';
    probe.src = source;
    probe.addEventListener('loadedmetadata', handleLoadedMetadata);
    probe.addEventListener('durationchange', handleLoadedMetadata);
    probe.addEventListener('error', handleError);
    probe.addEventListener('abort', handleError);
    probe.load();
  });

  state.durationLoadPromises.set(key, request);
  return request;
}

export function preloadTrackDurations(files, basePath = '/audio') {
  if (!Array.isArray(files) || files.length === 0) return;
  files.forEach((file) => {
    if (typeof file !== 'string' || !file.trim()) return;
    loadTrackDurationMetadata(file, basePath).catch(() => {});
  });
}

export function keepKnownDurationsForFiles(files, basePath = '/audio') {
  const allowedKeys = new Set(
    Array.isArray(files)
      ? files
          .filter((file) => typeof file === 'string' && file.trim())
          .map((file) => trackKey(file, basePath))
      : [],
  );

  for (const key of state.knownTrackDurations.keys()) {
    if (!allowedKeys.has(key)) {
      state.knownTrackDurations.delete(key);
    }
  }
}

export function stopAndClearLocalPlayback() {
  if (isDspTransitionPlaybackActive()) {
    stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
  }

  if (state.currentAudio) {
    const stoppedByEngine = stopCurrentPlaybackImmediately(state.currentTrack, state.currentAudio);
    if (!stoppedByEngine) {
      try {
        state.currentAudio.pause();
      } catch (err) {
        // ignore audio pause errors during role switch
      }
    }
  }

  if (state.currentTrack) {
    _deps.setButtonPlaying(state.currentTrack.key, false, state.currentTrack);
    _deps.setTrackPaused(state.currentTrack.key, false, state.currentTrack);
    _deps.resetProgress(state.currentTrack.key);
  }

  resetFadeState();
  _deps.stopProgressLoop();
  state.currentAudio = null;
  state.currentTrack = null;
  clearAudioEngineCurrentSource();
  _deps.stopUnexpectedLiveAudios([]);
  resetLiveDspNextTrackPreview();
  _deps.clearDapInterruptedPlaybackSnapshot();
  syncNowPlayingPanel();
}

export function getCurrentTrackDurationSeconds() {
  if (!state.currentTrack || !state.currentAudio) return null;
  return _deps.getDuration(state.currentAudio) || getKnownDurationSeconds(state.currentTrack.key);
}

export function getHostPlaybackDurationSeconds() {
  const duration = Number(state.hostPlaybackState && state.hostPlaybackState.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return duration;
}

export function getDspTransitionDurationSeconds() {
  if (!isDspTransitionPlaybackActive()) return null;
  const playback = state.dspTransitionPlayback;
  const transitionAudio = playback && playback.audio ? playback.audio : null;
  if (!transitionAudio) return null;

  const resolvedDuration =
    _deps.getDuration(transitionAudio) ||
    (Number.isFinite(playback.duration) && playback.duration > 0 ? playback.duration : null);
  if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) return null;

  playback.duration = resolvedDuration;
  return resolvedDuration;
}

export function seekDspTransitionPlaybackByRatio(positionRatio) {
  if (!isDspTransitionPlaybackActive()) return false;

  const playback = state.dspTransitionPlayback;
  const transitionAudio = playback && playback.audio ? playback.audio : null;
  if (!transitionAudio) return false;

  const ratio = normalizePlaybackSeekRatio(positionRatio);
  if (ratio === null) return false;

  const duration = getDspTransitionDurationSeconds();
  if (!Number.isFinite(duration) || duration <= 0) return false;

  const nextTime = Math.max(0, Math.min(duration, ratio * duration));
  try {
    if (typeof transitionAudio.fastSeek === 'function') {
      transitionAudio.fastSeek(nextTime);
    } else {
      transitionAudio.currentTime = nextTime;
    }
  } catch (err) {
    try {
      transitionAudio.currentTime = nextTime;
    } catch (fallbackErr) {
      return false;
    }
  }

  syncNowPlayingPanel();
  return true;
}

async function toggleNowPlayingPlaybackLocally() {
  if (isDspTransitionPlaybackActive()) return;
  if (!state.currentTrack || !state.currentAudio) return;
  try {
    if (state.currentAudio.paused) {
      _deps.setTrackPaused(state.currentTrack.key, false, state.currentTrack);
      const resumed = await resumeCurrentPlayback(state.currentTrack, state.currentAudio);
      if (!resumed) {
        throw new Error('RESUME_FAILED');
      }
      _deps.setButtonPlaying(state.currentTrack.key, true, state.currentTrack);
      _deps.startProgressLoop(state.currentAudio, state.currentTrack.key);
      setStatus(`Играет: ${state.currentTrack.file}`);
    } else {
      const paused = await pauseCurrentPlayback(state.currentTrack, state.currentAudio);
      if (paused) {
        await _deps.ensureDapNoSilencePlayback({ reason: 'toggle-current-pause' });
      }
    }
  } catch (err) {
    console.error(err);
    setStatus('Не удалось изменить состояние воспроизведения.');
  } finally {
    syncNowPlayingPanel();
    requestHostPlaybackSync(true);
  }
}

export async function toggleNowPlayingPlayback() {
  if (isCoHostRole()) {
    try {
      const hostTrackFile =
        state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string'
          ? state.hostPlaybackState.trackFile.trim()
          : '';
      if (!hostTrackFile) {
        setStatus('Нет активного live-трека для управления.');
        return;
      }

      if (state.hostPlaybackState.paused) {
        await requestCoHostPlayTrack(hostTrackFile, '/audio', {
          playlistId: state.hostPlaybackState.playlistId,
          trackId: state.hostPlaybackState.trackId,
        });
      } else {
        await requestCoHostStopPlayback();
      }
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось отправить live-команду.');
    }
    return;
  }

  if (!isHostRole()) return;

  try {
    await dispatchHostPlaybackCommand({ type: PLAYBACK_COMMAND_TOGGLE_CURRENT });
  } catch (err) {
    console.error(err);
    setStatus(err && err.message ? err.message : 'Не удалось выполнить playback-команду хоста.');
  }
}

export function setNowPlayingProgress(percent) {
  if (!_deps.nowPlayingProgressEl) return;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  _deps.nowPlayingProgressEl.style.setProperty('--progress-ratio', String(safePercent / 100));
}

export function setNowPlayingReelActive(active, paused = false) {
  const isActive = Boolean(active);
  const isPaused = Boolean(paused);
  if (_deps.nowPlayingControlBtn) {
    _deps.nowPlayingControlBtn.classList.toggle('has-active-track', isActive);
    _deps.nowPlayingControlBtn.classList.toggle('is-paused', isActive && isPaused);
  }
  if (_deps.nowPlayingReelEl) {
    _deps.nowPlayingReelEl.hidden = !isActive;
  }
}

export function formatNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  return formatDuration(seconds, { useCeil });
}

export function setNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!_deps.nowPlayingTimeEl) return;
  _deps.nowPlayingTimeEl.textContent = formatNowPlayingTime(seconds, { useCeil });
}

export function setHostNowPlayingProgress(percent) {
  if (!_deps.hostNowPlayingProgressEl) return;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  _deps.hostNowPlayingProgressEl.style.setProperty('--progress-ratio', String(safePercent / 100));
}

export function setHostNowPlayingReelActive(active, paused = false) {
  const isActive = Boolean(active);
  const isPaused = Boolean(paused);
  if (_deps.hostNowPlayingControlEl) {
    _deps.hostNowPlayingControlEl.classList.toggle('has-active-track', isActive);
    _deps.hostNowPlayingControlEl.classList.toggle('is-paused', isActive && isPaused);
  }
  if (_deps.hostNowPlayingReelEl) {
    _deps.hostNowPlayingReelEl.hidden = !isActive;
  }
}

export function setHostNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!_deps.hostNowPlayingTimeEl) return;
  _deps.hostNowPlayingTimeEl.textContent = formatNowPlayingTime(seconds, { useCeil });
}

export function setDapNowPlayingProgress(percent) {
  if (!_deps.dapNowPlayingProgressEl) return;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  _deps.dapNowPlayingProgressEl.style.setProperty('--progress-ratio', String(safePercent / 100));
}

export function setDapNowPlayingReelActive(active, paused = false) {
  const isActive = Boolean(active);
  const isPaused = Boolean(paused);
  if (_deps.dapNowPlayingControlEl) {
    _deps.dapNowPlayingControlEl.classList.toggle('has-active-track', isActive);
    _deps.dapNowPlayingControlEl.classList.toggle('is-paused', isActive && isPaused);
  }
  if (_deps.dapNowPlayingReelEl) {
    _deps.dapNowPlayingReelEl.hidden = !isActive;
  }
}

export function setDapNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!_deps.dapNowPlayingTimeEl) return;
  _deps.dapNowPlayingTimeEl.textContent = formatNowPlayingTime(seconds, { useCeil });
}

export function formatDuration(seconds, { useCeil = false } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const rounded = useCeil ? Math.ceil(seconds) : Math.floor(seconds);
  const totalSeconds = Math.max(0, rounded);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
}

export function formatPlaylistDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const restSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
}

export function normalizePlaylistTrackIndex(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}
