// public/modules/playlists.js — playlist management, track cards, audio catalog

import { AUDIO_CATALOG_POLL_INTERVAL_MS, DAP_DEFAULT_VOLUME_PERCENT, DAP_MAX_VOLUME_PERCENT, DAP_MIN_VOLUME_PERCENT, DEFAULT_DAP_CONFIG, PLAYLIST_NAME_MAX_LENGTH, PLAYLIST_TYPE_FOLDER, PLAYLIST_TYPE_MANUAL, PLAYLIST_VIRTUALIZATION_FALLBACK_VIEWPORT_PX, PLAYLIST_VIRTUALIZATION_MIN_ITEMS, PLAYLIST_VIRTUALIZATION_OVERSCAN_ROWS, PLAYLIST_VIRTUALIZATION_ROW_HEIGHT_PX, ROLE_HOST, SETTINGS_KEYS, TRACK_RELOCATE_HIGHLIGHT_MS, TRACK_TITLE_MODE_ATTRIBUTES, TRACK_TITLE_MODE_FILE, state, syncLegacyStateFromPlaylists, syncPlaylistsFromLegacyState } from './state.js';
import * as api from './api.js';
import { applyLiveVolumeToCurrentAudio, getEffectiveLiveVolume, setLivePlaybackVolume } from './audio.js';
import { isCoHostRole, isHostRole, isRemoteLiveMirrorRole, isSlaveRole } from './roles.js';
import { closeLayoutStream } from './sse.js';
import { isDapEnabled, isDapTrackContext, updateDapSettingsUi } from './ui/dap.js';
import { syncDspTransitionTrackHighlight, syncLiveDspNextTrackHighlight } from './ui/dsp.js';
import { syncDapNowPlayingPanel,
  syncHostNowPlayingPanel, syncHostTrackHighlight, syncNowPlayingPanel
} from './ui/nowplaying.js';
import { hideCollapsedPlaylistsOverlay, removeCollapsedPlaylistsHint, setStatus } from './ui/status.js';
import { updateVolumePresetsUi } from './ui/volume.js';
import { addToMultiMap, getFirstFromSet, trackKey } from './utils.js';
import { PlaybackCommandBus } from '/shared/playback/index.js';

const _deps = {};
const PLAYLIST_COMMAND_ADD = 'playlist-add';
const PLAYLIST_COMMAND_RENAME = 'playlist-rename';
const PLAYLIST_COMMAND_TOGGLE_AUTOPLAY = 'playlist-toggle-autoplay';
const PLAYLIST_COMMAND_TOGGLE_DSP = 'playlist-toggle-dsp';
const PLAYLIST_COMMAND_DELETE = 'playlist-delete';

function normalizePlaylistMutationCommand(rawCommand) {
  if (!rawCommand || typeof rawCommand !== 'object') return null;
  const type = typeof rawCommand.type === 'string' ? rawCommand.type.trim() : '';
  if (type === PLAYLIST_COMMAND_ADD) {
    return { type: PLAYLIST_COMMAND_ADD };
  }

  const playlistIndex =
    Number.isInteger(rawCommand.playlistIndex) && rawCommand.playlistIndex >= 0
      ? rawCommand.playlistIndex
      : null;
  if (playlistIndex === null) return null;

  if (type === PLAYLIST_COMMAND_RENAME) {
    return {
      type: PLAYLIST_COMMAND_RENAME,
      playlistIndex,
      rawName: typeof rawCommand.rawName === 'string' ? rawCommand.rawName : '',
    };
  }
  if (type === PLAYLIST_COMMAND_TOGGLE_AUTOPLAY) {
    return { type: PLAYLIST_COMMAND_TOGGLE_AUTOPLAY, playlistIndex };
  }
  if (type === PLAYLIST_COMMAND_TOGGLE_DSP) {
    return { type: PLAYLIST_COMMAND_TOGGLE_DSP, playlistIndex };
  }
  if (type === PLAYLIST_COMMAND_DELETE) {
    return { type: PLAYLIST_COMMAND_DELETE, playlistIndex };
  }
  return null;
}

async function executeHostPlaylistMutationCommand(command) {
  if (command.type === PLAYLIST_COMMAND_ADD) {
    await addPlaylistLocally();
    return;
  }
  if (command.type === PLAYLIST_COMMAND_RENAME) {
    await renamePlaylistLocally(command.playlistIndex, command.rawName);
    return;
  }
  if (command.type === PLAYLIST_COMMAND_TOGGLE_AUTOPLAY) {
    await togglePlaylistAutoplayLocally(command.playlistIndex);
    return;
  }
  if (command.type === PLAYLIST_COMMAND_TOGGLE_DSP) {
    await togglePlaylistDspLocally(command.playlistIndex);
    return;
  }
  if (command.type === PLAYLIST_COMMAND_DELETE) {
    await deletePlaylistLocally(command.playlistIndex);
  }
}

const hostPlaylistMutationCommandBus = new PlaybackCommandBus({
  authorize: ({ sourceRole }) =>
    sourceRole === ROLE_HOST
      ? { allowed: true }
      : { allowed: false, reason: 'ACCESS_DENIED', message: 'Только хост может менять плей-листы.' },
  execute: (payload) => executeHostPlaylistMutationCommand(payload),
});

async function dispatchHostPlaylistMutationCommand(command) {
  const normalizedCommand = normalizePlaylistMutationCommand(command);
  if (!normalizedCommand) {
    throw new Error('Некорректная команда мутации плей-листа.');
  }
  const result = await hostPlaylistMutationCommandBus.dispatch(
    {
      sourceRole: ROLE_HOST,
      commandType: normalizedCommand.type,
      target: 'self',
    },
    normalizedCommand,
  );
  if (!result.ok) {
    throw new Error(result.message || 'Команда мутации плей-листа отклонена.');
  }
}

export function setPlaylistsDeps(d) {
  Object.assign(_deps, d);
}

function cloneTracksForMutation(tracks, playlistIndex) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((track, trackIndex) => ({
    ...(track && typeof track === 'object' ? track : {}),
    id:
      track && typeof track.id === 'string' && track.id.trim()
        ? track.id.trim()
        : `t-${playlistIndex}-${trackIndex}`,
    src: typeof track?.src === 'string' ? track.src : '',
    meta: track && track.meta && typeof track.meta === 'object' ? { ...track.meta } : {},
  }));
}

function clonePlaylistsForMutation(playlistsState = state.playlists) {
  const safePlaylists = Array.isArray(playlistsState) ? playlistsState : [];
  return safePlaylists.map((playlist, playlistIndex) => {
    const safePlaylist = playlist && typeof playlist === 'object' ? playlist : {};
    const safeSettings = safePlaylist.settings && typeof safePlaylist.settings === 'object' ? safePlaylist.settings : {};
    return {
      ...safePlaylist,
      id:
        typeof safePlaylist.id === 'string' && safePlaylist.id.trim()
          ? safePlaylist.id.trim()
          : `p-${playlistIndex}`,
      name:
        typeof safePlaylist.name === 'string'
          ? safePlaylist.name
          : defaultPlaylistName(playlistIndex),
      type: safePlaylist.type === PLAYLIST_TYPE_FOLDER ? PLAYLIST_TYPE_FOLDER : PLAYLIST_TYPE_MANUAL,
      settings: {
        autoPlayEnabled: Boolean(safeSettings.autoPlayEnabled),
        dspEnabled: Boolean(safeSettings.dspEnabled),
      },
      tracks: cloneTracksForMutation(safePlaylist.tracks, playlistIndex),
      uiState:
        typeof safePlaylist.uiState === 'string' && safePlaylist.uiState
          ? safePlaylist.uiState
          : null,
    };
  });
}

function ensurePlaylistsForMutation() {
  if (Array.isArray(state.playlists)) {
    return clonePlaylistsForMutation(state.playlists);
  }
  return clonePlaylistsForMutation(syncPlaylistsFromLegacyState());
}

function buildNextPlaylistId(playlistsState) {
  const usedIds = new Set();
  const safePlaylists = Array.isArray(playlistsState) ? playlistsState : [];
  safePlaylists.forEach((playlist) => {
    if (!playlist || typeof playlist !== 'object') return;
    if (typeof playlist.id !== 'string') return;
    const normalizedId = playlist.id.trim();
    if (!normalizedId) return;
    usedIds.add(normalizedId);
  });
  let cursor = safePlaylists.length;
  let candidate = `p-${cursor}`;
  while (usedIds.has(candidate)) {
    cursor += 1;
    candidate = `p-${cursor}`;
  }
  return candidate;
}

function resolveDapPlaylistId(config, playlistsState) {
  const safeConfig = config && typeof config === 'object' ? config : {};
  const safePlaylists = Array.isArray(playlistsState) ? playlistsState : [];
  if (typeof safeConfig.playlistId === 'string' && safeConfig.playlistId.trim()) {
    const explicitId = safeConfig.playlistId.trim();
    if (safePlaylists.some((playlist) => playlist && playlist.id === explicitId)) {
      return explicitId;
    }
  }
  const playlistIndex = _deps.normalizePlaylistTrackIndex(safeConfig.playlistIndex);
  if (playlistIndex !== null && playlistIndex >= 0 && playlistIndex < safePlaylists.length) {
    const playlistEntry = safePlaylists[playlistIndex];
    if (playlistEntry && typeof playlistEntry.id === 'string' && playlistEntry.id.trim()) {
      return playlistEntry.id.trim();
    }
  }
  return null;
}

function normalizeDapConfigForPlaylistsMutation(config, playlistsState) {
  const safeConfig = config && typeof config === 'object' ? config : {};
  const playlistId = resolveDapPlaylistId(safeConfig, playlistsState);
  const playlistIndex = _deps.normalizePlaylistTrackIndex(safeConfig.playlistIndex);
  const volumePercent = normalizeDapVolumePercent(safeConfig.volumePercent, DAP_DEFAULT_VOLUME_PERCENT);
  const enabled = Boolean(safeConfig.enabled && playlistId);
  return {
    ...safeConfig,
    enabled,
    playlistIndex,
    playlistId,
    volumePercent,
  };
}

function syncPlaylistsStateForMutation(playlistsState, { dapConfig = state.dapConfig } = {}) {
  const nextPlaylists = clonePlaylistsForMutation(playlistsState);
  const normalizedDapConfig = normalizeDapConfigForPlaylistsMutation(dapConfig, nextPlaylists);

  if (normalizedDapConfig.enabled && normalizedDapConfig.playlistId) {
    const dapPlaylistIndex = nextPlaylists.findIndex(
      (playlist) => playlist && playlist.id === normalizedDapConfig.playlistId,
    );
    if (dapPlaylistIndex >= 0) {
      const playlistEntry = nextPlaylists[dapPlaylistIndex];
      const settings = playlistEntry.settings && typeof playlistEntry.settings === 'object'
        ? playlistEntry.settings
        : {};
      nextPlaylists[dapPlaylistIndex] = {
        ...playlistEntry,
        settings: {
          ...settings,
          autoPlayEnabled: true,
          dspEnabled: Boolean(settings.dspEnabled),
        },
      };
    }
  }

  if (nextPlaylists.length === 0) {
    applyLegacyLayoutProjection({
      layout: [],
      playlistNames: [],
      playlistMeta: [],
      playlistAutoplay: [],
      playlistDsp: [],
      dapConfig: {
        ...normalizedDapConfig,
        enabled: false,
        playlistIndex: null,
        playlistId: null,
      },
    });
    return state.playlists;
  }

  syncLegacyStateFromPlaylists(nextPlaylists, {
    dapConfig: normalizedDapConfig,
    trackTitleModesByTrack: state.trackTitleModesByTrack,
  });
  return state.playlists;
}

function applyLegacyLayoutProjection({
  layout,
  playlistNames,
  playlistMeta,
  playlistAutoplay,
  playlistDsp,
  dapConfig,
}) {
  state.layout = ensurePlaylists(layout);
  state.playlistNames = normalizePlaylistNames(playlistNames, state.layout.length);
  state.playlistMeta = normalizePlaylistMeta(playlistMeta, state.layout.length);
  state.dapConfig = normalizeDapConfig(dapConfig, state.layout.length, dapConfig);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(playlistAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(playlistDsp, state.playlistAutoplay, state.layout.length);
  syncPlaylistsFromLegacyState();
  return state.playlists;
}

export function cloneLayoutState(layoutState) {
  return ensurePlaylists(layoutState).map((playlist) => playlist.slice());
}

export function clonePlaylistMetaState(metaState, lengthHint = null) {
  const expectedLength =
    Number.isInteger(lengthHint) && lengthHint >= 0
      ? lengthHint
      : Array.isArray(metaState)
        ? metaState.length
        : ensurePlaylists(state.layout).length;
  return normalizePlaylistMeta(metaState, expectedLength).map((meta) => ({ ...meta }));
}

export function defaultPlaylistMeta() {
  return { type: PLAYLIST_TYPE_MANUAL };
}

export function sanitizeFolderKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (!normalized) return null;
  return normalized;
}

export function sanitizeFolderOriginalName(value, fallback = '') {
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

export function sanitizePlaylistMetaEntry(value) {
  if (!value || typeof value !== 'object') {
    return defaultPlaylistMeta();
  }

  if (value.type !== PLAYLIST_TYPE_FOLDER) {
    return defaultPlaylistMeta();
  }

  const folderKey = sanitizeFolderKey(value.folderKey);
  if (!folderKey) {
    return defaultPlaylistMeta();
  }

  const fallbackName = folderKey.split('/').filter(Boolean).pop() || folderKey;
  return {
    type: PLAYLIST_TYPE_FOLDER,
    folderKey,
    folderOriginalName: sanitizeFolderOriginalName(value.folderOriginalName, fallbackName),
  };
}

export function normalizePlaylistMeta(meta, expectedLength) {
  const result = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const rawValue = Array.isArray(meta) ? meta[index] : null;
    result.push(sanitizePlaylistMetaEntry(rawValue));
  }

  return result;
}

export function serializePlaylistMeta(meta, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizePlaylistMeta(meta, expectedLength));
}

export function playlistMetaEqual(left, right, expectedLength) {
  return serializePlaylistMeta(left, expectedLength) === serializePlaylistMeta(right, expectedLength);
}

export function getPlaylistMetaEntry(playlistIndex) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return defaultPlaylistMeta();
  const normalized = normalizePlaylistMeta(state.playlistMeta, ensurePlaylists(state.layout).length);
  return normalized[playlistIndex] || defaultPlaylistMeta();
}

export function isFolderPlaylistIndex(playlistIndex) {
  return getPlaylistMetaEntry(playlistIndex).type === PLAYLIST_TYPE_FOLDER;
}

export function normalizeAudioFolderTemplates(rawFolders, files) {
  const allowedFiles = new Set(Array.isArray(files) ? files : []);
  const folderByKey = new Map();

  if (!Array.isArray(rawFolders)) return [];

  rawFolders.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const folderKey = sanitizeFolderKey(entry.key);
    if (!folderKey) return;

    const folderNameFallback = folderKey.split('/').filter(Boolean).pop() || folderKey;
    const folderName = sanitizeFolderOriginalName(entry.name, folderNameFallback);
    const folderFiles = Array.isArray(entry.files)
      ? entry.files
          .filter((file) => typeof file === 'string' && file && allowedFiles.has(file))
          .slice()
          .sort((left, right) => left.localeCompare(right, 'ru'))
      : [];

    if (!folderFiles.length) return;

    const existing = folderByKey.get(folderKey);
    if (!existing) {
      folderByKey.set(folderKey, {
        key: folderKey,
        name: folderName || folderNameFallback,
        files: folderFiles,
      });
      return;
    }

    const merged = new Set(existing.files);
    folderFiles.forEach((file) => merged.add(file));
    existing.files = Array.from(merged).sort((left, right) => left.localeCompare(right, 'ru'));
    if (!existing.name && (folderName || folderNameFallback)) {
      existing.name = folderName || folderNameFallback;
    }
  });

  const result = Array.from(folderByKey.values());
  result.sort((left, right) => left.key.localeCompare(right.key, 'ru'));
  return result;
}

export function getManualPlaylistIndex(metaState, layoutState) {
  const normalizedLayout = ensurePlaylists(layoutState);
  const normalizedMeta = normalizePlaylistMeta(metaState, normalizedLayout.length);
  const existingIndex = normalizedMeta.findIndex((meta) => meta.type !== PLAYLIST_TYPE_FOLDER);
  if (existingIndex >= 0) return existingIndex;
  return -1;
}

export function buildFileOccurrenceMap(layoutState) {
  const occurrence = new Map();
  const normalizedLayout = ensurePlaylists(layoutState);

  normalizedLayout.forEach((playlist) => {
    playlist.forEach((file) => {
      if (typeof file !== 'string' || !file) return;
      occurrence.set(file, (occurrence.get(file) || 0) + 1);
    });
  });

  return occurrence;
}

export function ensureFolderPlaylistsCoverage(layoutState, namesState, metaState) {
  let nextLayout = ensurePlaylists(layoutState).map((playlist) => playlist.slice());
  let nextNames = normalizePlaylistNames(namesState, nextLayout.length);
  let nextMeta = normalizePlaylistMeta(metaState, nextLayout.length);

  const folderIndexByKey = new Map();
  nextMeta.forEach((meta, index) => {
    if (meta.type !== PLAYLIST_TYPE_FOLDER || !meta.folderKey || folderIndexByKey.has(meta.folderKey)) return;
    folderIndexByKey.set(meta.folderKey, index);
  });

  state.availableFolders.forEach((folder) => {
    if (!folderIndexByKey.has(folder.key)) {
      nextLayout.push(folder.files.slice());
      nextNames.push(folder.name);
      nextMeta.push({
        type: PLAYLIST_TYPE_FOLDER,
        folderKey: folder.key,
        folderOriginalName: folder.name,
      });
      folderIndexByKey.set(folder.key, nextLayout.length - 1);
      return;
    }

    const folderIndex = folderIndexByKey.get(folder.key);
    nextMeta[folderIndex] = {
      ...nextMeta[folderIndex],
      type: PLAYLIST_TYPE_FOLDER,
      folderKey: folder.key,
      folderOriginalName: folder.name,
    };
  });

  nextLayout = ensurePlaylists(nextLayout);
  nextNames = normalizePlaylistNames(nextNames, nextLayout.length);
  nextMeta = normalizePlaylistMeta(nextMeta, nextLayout.length);

  const rootFiles = state.availableFiles.filter((file) => typeof file === 'string' && file && !file.includes('/'));

  let manualIndex = getManualPlaylistIndex(nextMeta, nextLayout);
  if (manualIndex < 0 && rootFiles.length > 0) {
    nextLayout.push([]);
    nextNames.push(defaultPlaylistName(nextLayout.length - 1));
    nextMeta.push(defaultPlaylistMeta());
    manualIndex = nextLayout.length - 1;
  }

  const occurrence = buildFileOccurrenceMap(nextLayout);
  if (manualIndex >= 0 && manualIndex < nextLayout.length) {
    rootFiles.forEach((file) => {
      if ((occurrence.get(file) || 0) > 0) return;
      nextLayout[manualIndex].push(file);
      occurrence.set(file, (occurrence.get(file) || 0) + 1);
    });
  }

  state.availableFolders.forEach((folder) => {
    const folderIndex = folderIndexByKey.get(folder.key);
    if (!Number.isInteger(folderIndex) || folderIndex < 0 || folderIndex >= nextLayout.length) return;

    folder.files.forEach((file) => {
      if ((occurrence.get(file) || 0) > 0) return;
      nextLayout[folderIndex].push(file);
      occurrence.set(file, (occurrence.get(file) || 0) + 1);
    });
  });

  return {
    layout: ensurePlaylists(nextLayout),
    playlistNames: normalizePlaylistNames(nextNames, nextLayout.length),
    playlistMeta: normalizePlaylistMeta(nextMeta, nextLayout.length),
  };
}

export function ensurePlaylists(playlists) {
  return Array.isArray(playlists) ? playlists.map((playlist) => (Array.isArray(playlist) ? playlist : [])) : [];
}

export function defaultPlaylistName(index) {
  return `Плей-лист ${index + 1}`;
}

export function sanitizePlaylistName(value, index) {
  if (typeof value !== 'string') return defaultPlaylistName(index);

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return defaultPlaylistName(index);
  return normalized.slice(0, PLAYLIST_NAME_MAX_LENGTH);
}

export function normalizePlaylistNames(names, expectedLength) {
  const result = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const rawName = Array.isArray(names) ? names[index] : null;
    result.push(sanitizePlaylistName(rawName, index));
  }

  return result;
}

export function normalizePlaylistAutoplayFlags(flags, expectedLength) {
  const result = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const rawValue = Array.isArray(flags) ? flags[index] : false;
    result.push(Boolean(rawValue));
  }

  return result;
}

export function normalizePlaylistDspFlags(flags, autoplayFlags, expectedLength) {
  const normalizedAutoplay = normalizePlaylistAutoplayFlags(autoplayFlags, expectedLength);
  const result = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const rawValue = Array.isArray(flags) ? flags[index] : false;
    result.push(Boolean(rawValue) && Boolean(normalizedAutoplay[index]));
  }

  return result;
}

export function serializeLayout(playlists) {
  return JSON.stringify(ensurePlaylists(playlists));
}

export function layoutsEqual(left, right) {
  return serializeLayout(left) === serializeLayout(right);
}

export function serializePlaylistNames(names, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizePlaylistNames(names, expectedLength));
}

export function playlistNamesEqual(left, right, expectedLength) {
  return serializePlaylistNames(left, expectedLength) === serializePlaylistNames(right, expectedLength);
}

export function serializePlaylistAutoplay(flags, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizePlaylistAutoplayFlags(flags, expectedLength));
}

export function playlistAutoplayEqual(left, right, expectedLength) {
  return serializePlaylistAutoplay(left, expectedLength) === serializePlaylistAutoplay(right, expectedLength);
}

export function serializePlaylistDsp(flags, autoplayFlags, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizePlaylistDspFlags(flags, autoplayFlags, expectedLength));
}

export function playlistDspEqual(left, right, autoplayFlags, expectedLength) {
  return serializePlaylistDsp(left, autoplayFlags, expectedLength) === serializePlaylistDsp(right, autoplayFlags, expectedLength);
}

export function serializeDapConfig(config, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizeDapConfig(config, expectedLength, DEFAULT_DAP_CONFIG));
}

export function dapConfigEqual(left, right, expectedLength) {
  return serializeDapConfig(left, expectedLength) === serializeDapConfig(right, expectedLength);
}

export function applyDapConstraintsForCurrentLayout() {
  applyLegacyLayoutProjection({
    layout: state.layout,
    playlistNames: state.playlistNames,
    playlistMeta: state.playlistMeta,
    playlistAutoplay: state.playlistAutoplay,
    playlistDsp: state.playlistDsp,
    dapConfig: state.dapConfig,
  });
}

export function normalizeLayoutForFiles(rawLayout, files) {
  const normalized = ensurePlaylists(rawLayout);
  const allowedFiles = new Set(Array.isArray(files) ? files : []);
  return ensurePlaylists(
    normalized.map((playlist) => {
      const clean = [];
      playlist.forEach((file) => {
        if (typeof file !== 'string') return;
        if (!allowedFiles.has(file)) return;
        clean.push(file);
      });
      return clean;
    }),
  );
}

export function isServerLayoutEmpty(playlists) {
  const normalized = ensurePlaylists(playlists);
  if (normalized.length === 0) return true;
  return normalized.length === 1 && normalized[0].length === 0;
}

export function syncLayoutFromDom() {
  const zonesContainer = _deps.zonesContainer;
  if (!zonesContainer) return;
  const zones = Array.from(zonesContainer.querySelectorAll('.zone'));
  const nextLayout = ensurePlaylists(state.layout).map(() => []);

  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (!Number.isInteger(zoneIndex) || zoneIndex < 0 || zoneIndex >= nextLayout.length) return;
    const body = zone.querySelector('.zone-body');
    if (!body) return;
    nextLayout[zoneIndex] = Array.from(body.querySelectorAll('.track-card'))
      .map((card) => card.dataset.file)
      .filter(Boolean);
  });

  applyLegacyLayoutProjection({
    layout: nextLayout,
    playlistNames: state.playlistNames,
    playlistMeta: state.playlistMeta,
    playlistAutoplay: state.playlistAutoplay,
    playlistDsp: state.playlistDsp,
    dapConfig: state.dapConfig,
  });
}

export function normalizeDapVolumePercent(value, fallback = DAP_DEFAULT_VOLUME_PERCENT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return normalizeDapVolumePercent(fallback, DAP_DEFAULT_VOLUME_PERCENT);
  }

  const rounded = Math.round(numeric);
  if (rounded < DAP_MIN_VOLUME_PERCENT) return DAP_MIN_VOLUME_PERCENT;
  if (rounded > DAP_MAX_VOLUME_PERCENT) return DAP_MAX_VOLUME_PERCENT;
  return rounded;
}

export function normalizeDapConfig(config, layoutLength, fallback = DEFAULT_DAP_CONFIG) {
  const expectedLength = Number.isInteger(layoutLength) && layoutLength >= 0 ? layoutLength : 0;
  const safeFallback =
    fallback && typeof fallback === 'object'
      ? {
          enabled: Boolean(fallback.enabled),
          playlistIndex: _deps.normalizePlaylistTrackIndex(fallback.playlistIndex),
          volumePercent: normalizeDapVolumePercent(fallback.volumePercent, DAP_DEFAULT_VOLUME_PERCENT),
        }
      : { ...DEFAULT_DAP_CONFIG };
  const raw = config && typeof config === 'object' ? config : null;

  const requestedEnabled =
    raw && Object.prototype.hasOwnProperty.call(raw, 'enabled') ? Boolean(raw.enabled) : safeFallback.enabled;
  const requestedPlaylistIndex =
    raw && Object.prototype.hasOwnProperty.call(raw, 'playlistIndex')
      ? _deps.normalizePlaylistTrackIndex(raw.playlistIndex)
      : safeFallback.playlistIndex;
  const playlistIndex =
    requestedPlaylistIndex !== null &&
    requestedPlaylistIndex >= 0 &&
    requestedPlaylistIndex < expectedLength
      ? requestedPlaylistIndex
      : null;
  const volumePercent = normalizeDapVolumePercent(
    raw && Object.prototype.hasOwnProperty.call(raw, 'volumePercent') ? raw.volumePercent : safeFallback.volumePercent,
    safeFallback.volumePercent,
  );
  const enabled = Boolean(requestedEnabled && playlistIndex !== null);

  return {
    enabled,
    playlistIndex,
    volumePercent,
  };
}

export function normalizePlaylistAutoplayWithDap(flags, dapState, expectedLength) {
  const normalized = normalizePlaylistAutoplayFlags(flags, expectedLength);
  const normalizedDap = normalizeDapConfig(dapState, expectedLength, DEFAULT_DAP_CONFIG);
  if (normalizedDap.enabled && normalizedDap.playlistIndex !== null) {
    normalized[normalizedDap.playlistIndex] = true;
  }
  return normalized;
}

export function getDapPlaylistIndex(config = state.dapConfig) {
  if (!isDapEnabled(config)) return null;
  return _deps.normalizePlaylistTrackIndex(config.playlistIndex);
}

export function isDapPlaylistIndex(playlistIndex, config = state.dapConfig) {
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  return dapPlaylistIndex !== null && dapPlaylistIndex === _deps.normalizePlaylistTrackIndex(playlistIndex);
}

export function buildPlaylistRenderOrder(length, config = state.dapConfig) {
  const expectedLength = Number.isInteger(length) && length > 0 ? length : 0;
  const order = Array.from({ length: expectedLength }, (_, index) => index);
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null) return order;
  if (dapPlaylistIndex < 0 || dapPlaylistIndex >= expectedLength) return order;
  return [dapPlaylistIndex, ...order.filter((index) => index !== dapPlaylistIndex)];
}

export function getDapPlaylistFiles(config = state.dapConfig) {
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null) return [];
  if (dapPlaylistIndex < 0 || dapPlaylistIndex >= state.layout.length) return [];
  const playlist = Array.isArray(state.layout[dapPlaylistIndex]) ? state.layout[dapPlaylistIndex] : [];
  return playlist.filter((file) => typeof file === 'string' && file.trim());
}

export function disarmDapNoSilence() {
  state.dapNoSilenceArmedPlaylistIndex = null;
}

export function clearDapInterruptedPlaybackSnapshot() {
  const previousSnapshot =
    state.dapInterruptedPlaybackSnapshot && typeof state.dapInterruptedPlaybackSnapshot === 'object'
      ? { ...state.dapInterruptedPlaybackSnapshot }
      : null;
  state.dapInterruptedPlaybackSnapshot = null;

  if (!previousSnapshot) return;
  const previousFile = typeof previousSnapshot.file === 'string' ? previousSnapshot.file.trim() : '';
  if (!previousFile) return;

  const previousContext = _deps.normalizeTrackPlaybackContext(previousSnapshot);
  if (previousContext.playlistIndex !== null && previousContext.playlistPosition !== null) {
    setTrackPausedByContext(trackKey(previousFile, '/audio'), false, previousContext);
  }
  _deps.refreshTrackDurationLabels(trackKey(previousFile, '/audio'));
}

export function captureDapInterruptedPlaybackSnapshot(track = state.currentTrack, audio = state.currentAudio, config = state.dapConfig) {
  if (!track || !audio) return false;
  if (!isDapTrackContext(track, config)) return false;

  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null || dapPlaylistIndex < 0 || dapPlaylistIndex >= state.layout.length) return false;

  const dapPlaylist = Array.isArray(state.layout[dapPlaylistIndex]) ? state.layout[dapPlaylistIndex] : [];
  if (!dapPlaylist.length) return false;

  const trackFile = typeof track.file === 'string' ? track.file.trim() : '';
  if (!trackFile) return false;

  let trackPosition = _deps.normalizePlaylistTrackIndex(track.playlistPosition);
  if (
    trackPosition === null ||
    trackPosition < 0 ||
    trackPosition >= dapPlaylist.length ||
    dapPlaylist[trackPosition] !== trackFile
  ) {
    trackPosition = dapPlaylist.indexOf(trackFile);
  }
  if (trackPosition < 0) return false;

  const rawCurrentTime = Number(audio.currentTime);
  const startAtSeconds = Number.isFinite(rawCurrentTime) && rawCurrentTime > 0 ? rawCurrentTime : 0;

  state.dapInterruptedPlaybackSnapshot = {
    file: trackFile,
    playlistIndex: dapPlaylistIndex,
    playlistPosition: trackPosition,
    startAtSeconds,
  };
  return true;
}

export function resolveDapInterruptedPlaybackTrack(config = state.dapConfig) {
  if (!state.dapInterruptedPlaybackSnapshot || typeof state.dapInterruptedPlaybackSnapshot !== 'object') return null;

  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null || dapPlaylistIndex < 0 || dapPlaylistIndex >= state.layout.length) {
    clearDapInterruptedPlaybackSnapshot();
    return null;
  }

  const dapPlaylist = Array.isArray(state.layout[dapPlaylistIndex]) ? state.layout[dapPlaylistIndex] : [];
  if (!dapPlaylist.length) {
    clearDapInterruptedPlaybackSnapshot();
    return null;
  }

  const storedFile = typeof state.dapInterruptedPlaybackSnapshot.file === 'string' ? state.dapInterruptedPlaybackSnapshot.file.trim() : '';
  let resolvedPosition = _deps.normalizePlaylistTrackIndex(state.dapInterruptedPlaybackSnapshot.playlistPosition);
  let resolvedFile = storedFile;

  if (
    resolvedPosition !== null &&
    resolvedPosition >= 0 &&
    resolvedPosition < dapPlaylist.length &&
    dapPlaylist[resolvedPosition] === storedFile
  ) {
    resolvedFile = storedFile;
  } else {
    const byFilePosition = storedFile ? dapPlaylist.indexOf(storedFile) : -1;
    if (byFilePosition !== -1) {
      resolvedPosition = byFilePosition;
      resolvedFile = storedFile;
    } else if (resolvedPosition !== null && resolvedPosition >= 0 && resolvedPosition < dapPlaylist.length) {
      resolvedFile = dapPlaylist[resolvedPosition];
    } else {
      clearDapInterruptedPlaybackSnapshot();
      return null;
    }
  }

  if (typeof resolvedFile !== 'string' || !resolvedFile.trim()) {
    clearDapInterruptedPlaybackSnapshot();
    return null;
  }

  return {
    file: resolvedFile,
    basePath: '/audio',
    playlistIndex: dapPlaylistIndex,
    playlistPosition: resolvedPosition,
    startAtSeconds: normalizeAudioStartOffsetSeconds(state.dapInterruptedPlaybackSnapshot.startAtSeconds),
    fromInterruptedDap: true,
  };
}

export function armDapNoSilenceByPlaylistIndex(playlistIndex, config = state.dapConfig) {
  if (!isDapEnabled(config)) return false;
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  const normalizedPlaylistIndex = _deps.normalizePlaylistTrackIndex(playlistIndex);
  if (dapPlaylistIndex === null || normalizedPlaylistIndex === null) return false;
  if (dapPlaylistIndex !== normalizedPlaylistIndex) return false;
  state.dapNoSilenceArmedPlaylistIndex = dapPlaylistIndex;
  return true;
}

export function isDapNoSilenceArmed(config = state.dapConfig) {
  if (!isDapEnabled(config)) return false;
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null) return false;
  return state.dapNoSilenceArmedPlaylistIndex === dapPlaylistIndex;
}

export function isDapNoSilenceActive(config = state.dapConfig) {
  if (!isHostRole()) return false;
  if (!isDapEnabled(config)) return false;
  if (!isDapNoSilenceArmed(config)) return false;
  return getDapPlaylistFiles(config).length > 0;
}

export function isDapPauseLocked(track = state.currentTrack, audio = state.currentAudio, config = state.dapConfig) {
  if (!isDapNoSilenceActive(config)) return false;
  if (!track || !audio) return false;
  if (audio.paused) return false;
  return isDapTrackContext(track, config);
}

export function resolveDapNoSilenceTrack(config = state.dapConfig) {
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null) return null;
  if (dapPlaylistIndex < 0 || dapPlaylistIndex >= state.layout.length) return null;

  const dapPlaylist = Array.isArray(state.layout[dapPlaylistIndex]) ? state.layout[dapPlaylistIndex] : [];
  if (!dapPlaylist.length) return null;

  const interruptedTrack = resolveDapInterruptedPlaybackTrack(config);
  if (interruptedTrack) {
    return interruptedTrack;
  }

  if (
    state.currentTrack &&
    state.currentAudio &&
    state.currentAudio.paused &&
    isDapTrackContext(state.currentTrack, config) &&
    typeof state.currentTrack.file === 'string' &&
    state.currentTrack.file.trim()
  ) {
    let pausedPosition = _deps.normalizePlaylistTrackIndex(state.currentTrack.playlistPosition);
    if (
      pausedPosition === null ||
      pausedPosition < 0 ||
      pausedPosition >= dapPlaylist.length ||
      dapPlaylist[pausedPosition] !== state.currentTrack.file
    ) {
      pausedPosition = dapPlaylist.indexOf(state.currentTrack.file);
    }
    if (pausedPosition !== -1) {
      return {
        file: state.currentTrack.file,
        basePath: '/audio',
        playlistIndex: dapPlaylistIndex,
        playlistPosition: pausedPosition,
      };
    }
  }

  for (let index = 0; index < dapPlaylist.length; index += 1) {
    const file = dapPlaylist[index];
    if (typeof file !== 'string' || !file.trim()) continue;
    return {
      file,
      basePath: '/audio',
      playlistIndex: dapPlaylistIndex,
      playlistPosition: index,
    };
  }

  return null;
}

export async function ensureDapNoSilencePlayback({ reason = 'guard' } = {}) {
  if (!isDapNoSilenceActive()) return false;
  if (state.dapAutoStartInFlight) return false;
  if (state.autoplayStartInFlight) return false;
  if (state.overlayHandoffInFlight) return false;
  if (_deps.isDspTransitionPlaybackActive()) return false;
  if (state.currentTrack && state.currentAudio && !state.currentAudio.paused) return false;

  const targetTrack = resolveDapNoSilenceTrack(state.dapConfig);
  if (!targetTrack) return false;

  const targetButton = getTrackButton(
    targetTrack.file,
    targetTrack.playlistIndex,
    targetTrack.playlistPosition,
    targetTrack.basePath || '/audio',
  );
  if (!targetButton) return false;

  state.dapAutoStartInFlight = true;
  try {
    if (typeof _deps.requestHostPlayTrack !== 'function') {
      return false;
    }
    await _deps.requestHostPlayTrack(targetTrack.file, targetTrack.basePath || '/audio', {
      playlistIndex: targetTrack.playlistIndex,
      playlistPosition: targetTrack.playlistPosition,
      startAtSeconds: targetTrack.startAtSeconds,
      fromAutoplay: true,
      fromDapNoSilence: true,
      fromDapInterruptedResume: Boolean(targetTrack.fromInterruptedDap),
    });
    const targetKey = trackKey(targetTrack.file, targetTrack.basePath || '/audio');
    const started = Boolean(state.currentTrack && state.currentAudio && !state.currentAudio.paused && state.currentTrack.key === targetKey);
    if (started && targetTrack.fromInterruptedDap) {
      clearDapInterruptedPlaybackSnapshot();
    }
    return started;
  } catch (err) {
    console.error(`DAP fallback (${reason}) failed`, err);
    return false;
  } finally {
    state.dapAutoStartInFlight = false;
  }
}

export async function resetPlaylists() {
  const confirmed = window.confirm('Сбросить все плей-листы и заново загрузить их из папки /audio?');
  if (!confirmed) return;

  try {
    const { ok, data } = await api.postLayoutReset();
    if (!ok) {
      const message = data.error || data.message;
      throw new Error(message || 'Не удалось сбросить плей-листы');
    }

    setStatus('Плей-листы сброшены. Загружаем состояние из /audio...');
    requestTracksReload({ reason: 'manual' });
  } catch (err) {
    console.error(err);
    setStatus(err?.message || 'Не удалось сбросить плей-листы.');
  }
}

export async function addPlaylist() {
  if (isHostRole()) {
    try {
      await dispatchHostPlaylistMutationCommand({ type: PLAYLIST_COMMAND_ADD });
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось добавить плей-лист.');
    }
    return;
  }
  await addPlaylistLocally();
}

async function addPlaylistLocally() {
  const previousPlaylists = ensurePlaylistsForMutation();
  const nextPlaylists = clonePlaylistsForMutation(previousPlaylists);
  const nextPlaylistIndex = nextPlaylists.length;
  nextPlaylists.push({
    id: buildNextPlaylistId(nextPlaylists),
    name: defaultPlaylistName(nextPlaylistIndex),
    type: PLAYLIST_TYPE_MANUAL,
    tracks: [],
    settings: {
      autoPlayEnabled: false,
      dspEnabled: false,
    },
    uiState: null,
  });
  syncPlaylistsStateForMutation(nextPlaylists);
  renderZones();

  try {
    await _deps.pushSharedLayout();
    setStatus(`Добавлен плей-лист ${nextPlaylistIndex + 1}.`);
  } catch (err) {
    console.error(err);
    syncPlaylistsStateForMutation(previousPlaylists);
    renderZones();
    setStatus('Не удалось синхронизировать новый плей-лист.');
  }
}

export async function renamePlaylist(playlistIndex, rawName) {
  if (isHostRole()) {
    try {
      await dispatchHostPlaylistMutationCommand({
        type: PLAYLIST_COMMAND_RENAME,
        playlistIndex,
        rawName,
      });
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось переименовать плей-лист.');
    }
    return;
  }
  await renamePlaylistLocally(playlistIndex, rawName);
}

async function renamePlaylistLocally(playlistIndex, rawName) {
  const previousPlaylists = ensurePlaylistsForMutation();
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= previousPlaylists.length) return;

  const playlistEntry = previousPlaylists[playlistIndex];
  const normalizedName = sanitizePlaylistName(rawName, playlistIndex);
  if (sanitizePlaylistName(playlistEntry && playlistEntry.name, playlistIndex) === normalizedName) {
    renderZones();
    return;
  }

  const nextPlaylists = clonePlaylistsForMutation(previousPlaylists);
  nextPlaylists[playlistIndex] = {
    ...nextPlaylists[playlistIndex],
    name: normalizedName,
  };
  syncPlaylistsStateForMutation(nextPlaylists);
  renderZones();

  try {
    await _deps.pushSharedLayout();
    setStatus(`Переименован плей-лист ${playlistIndex + 1}.`);
  } catch (err) {
    console.error(err);
    syncPlaylistsStateForMutation(previousPlaylists);
    renderZones();
    setStatus('Не удалось синхронизировать название плей-листа.');
  }
}

export async function togglePlaylistAutoplay(playlistIndex) {
  if (!isHostRole()) {
    setStatus('Автовоспроизведение может менять только хост.');
    return;
  }
  try {
    await dispatchHostPlaylistMutationCommand({
      type: PLAYLIST_COMMAND_TOGGLE_AUTOPLAY,
      playlistIndex,
    });
  } catch (err) {
    console.error(err);
    setStatus(err && err.message ? err.message : 'Не удалось изменить автопроигрывание плей-листа.');
  }
}

async function togglePlaylistAutoplayLocally(playlistIndex) {
  const previousPlaylists = ensurePlaylistsForMutation();
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= previousPlaylists.length) return;
  if (isDapPlaylistIndex(playlistIndex)) {
    setStatus('Для DAP-плей-листа автовоспроизведение всегда включено.');
    return;
  }

  const nextPlaylists = clonePlaylistsForMutation(previousPlaylists);
  const playlistEntry = nextPlaylists[playlistIndex];
  const currentSettings = playlistEntry.settings && typeof playlistEntry.settings === 'object'
    ? playlistEntry.settings
    : {};
  const nextAutoPlay = !Boolean(currentSettings.autoPlayEnabled);
  const nextDspEnabled = nextAutoPlay ? Boolean(currentSettings.dspEnabled) : false;
  if (
    Boolean(currentSettings.autoPlayEnabled) === nextAutoPlay &&
    Boolean(currentSettings.dspEnabled) === nextDspEnabled
  ) {
    return;
  }
  nextPlaylists[playlistIndex] = {
    ...playlistEntry,
    settings: {
      ...currentSettings,
      autoPlayEnabled: nextAutoPlay,
      dspEnabled: nextDspEnabled,
    },
  };
  syncPlaylistsStateForMutation(nextPlaylists);
  renderZones();

  try {
    await _deps.pushSharedLayout();
    setStatus(
      `Автовоспроизведение для плей-листа ${playlistIndex + 1}: ${
        state.playlistAutoplay[playlistIndex] ? 'включено' : 'выключено'
      }.`,
    );
  } catch (err) {
    console.error(err);
    syncPlaylistsStateForMutation(previousPlaylists);
    renderZones();
    setStatus('Не удалось синхронизировать автопроигрывание плей-листа.');
  }
}

export async function togglePlaylistDsp(playlistIndex) {
  if (!isHostRole()) {
    setStatus('DSP для плей-листа может менять только хост.');
    return;
  }
  try {
    await dispatchHostPlaylistMutationCommand({
      type: PLAYLIST_COMMAND_TOGGLE_DSP,
      playlistIndex,
    });
  } catch (err) {
    console.error(err);
    setStatus(err && err.message ? err.message : 'Не удалось изменить DSP для плей-листа.');
  }
}

async function togglePlaylistDspLocally(playlistIndex) {
  const previousPlaylists = ensurePlaylistsForMutation();
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= previousPlaylists.length) return;
  const playlistEntry = previousPlaylists[playlistIndex];
  const currentSettings = playlistEntry && playlistEntry.settings && typeof playlistEntry.settings === 'object'
    ? playlistEntry.settings
    : {};
  if (!Boolean(currentSettings.autoPlayEnabled)) {
    setStatus('DSP можно включить только при активном автопроигрывании.');
    return;
  }

  const nextPlaylists = clonePlaylistsForMutation(previousPlaylists);
  const nextPlaylistEntry = nextPlaylists[playlistIndex];
  const nextSettings = nextPlaylistEntry.settings && typeof nextPlaylistEntry.settings === 'object'
    ? nextPlaylistEntry.settings
    : {};
  const nextDspEnabled = !Boolean(nextSettings.dspEnabled);
  if (Boolean(nextSettings.dspEnabled) === nextDspEnabled) return;
  nextPlaylists[playlistIndex] = {
    ...nextPlaylistEntry,
    settings: {
      ...nextSettings,
      autoPlayEnabled: true,
      dspEnabled: nextDspEnabled,
    },
  };
  syncPlaylistsStateForMutation(nextPlaylists);
  renderZones();

  try {
    await _deps.pushSharedLayout();
    setStatus(`DSP для плей-листа ${playlistIndex + 1}: ${state.playlistDsp[playlistIndex] ? 'включен' : 'выключен'}.`);
  } catch (err) {
    console.error(err);
    syncPlaylistsStateForMutation(previousPlaylists);
    renderZones();
    setStatus('Не удалось синхронизировать DSP плей-листа.');
  }
}

export async function syncDapConfig(nextDapConfig, { successMessage = 'DAP обновлен.' } = {}) {
  if (!isHostRole()) {
    setStatus('DAP может менять только хост.');
    return false;
  }

  const previousPlaylists = ensurePlaylistsForMutation();
  const playlistsLength = previousPlaylists.length;
  const normalizedNextDap = normalizeDapConfig(nextDapConfig, playlistsLength, state.dapConfig);
  const nextAutoplay = normalizePlaylistAutoplayWithDap(state.playlistAutoplay, normalizedNextDap, playlistsLength);
  const nextDsp = normalizePlaylistDspFlags(state.playlistDsp, nextAutoplay, playlistsLength);

  if (
    dapConfigEqual(state.dapConfig, normalizedNextDap, playlistsLength) &&
    playlistAutoplayEqual(state.playlistAutoplay, nextAutoplay, playlistsLength) &&
    playlistDspEqual(state.playlistDsp, nextDsp, nextAutoplay, playlistsLength)
  ) {
    updateDapSettingsUi(state.currentRole);
    return false;
  }

  const previousDap = { ...state.dapConfig };
  const previousDapInterruptedPlaybackSnapshot = state.dapInterruptedPlaybackSnapshot
    ? { ...state.dapInterruptedPlaybackSnapshot }
    : null;
  const previousDapEnabled = Boolean(previousDap.enabled);
  const previousDapIndex = _deps.normalizePlaylistTrackIndex(previousDap.playlistIndex);
  const nextDapEnabled = Boolean(normalizedNextDap.enabled);
  const nextDapIndex = _deps.normalizePlaylistTrackIndex(normalizedNextDap.playlistIndex);
  const shouldResetNoSilenceArm =
    !nextDapEnabled || !previousDapEnabled || previousDapIndex !== nextDapIndex;
  const shouldStopDapPlaybackOnDisable =
    isDapEnabled(previousDap) &&
    !normalizedNextDap.enabled &&
    ((state.currentTrack && state.currentAudio && !state.currentAudio.paused && isDapTrackContext(state.currentTrack, previousDap)) ||
      (_deps.isDspTransitionPlaybackActive() &&
        state.dspTransitionPlayback &&
        (isDapTrackContext(state.dspTransitionPlayback.fromTrack, previousDap) ||
          isDapTrackContext(state.dspTransitionPlayback.toTrack, previousDap))));

  const nextPlaylists = clonePlaylistsForMutation(previousPlaylists);
  nextPlaylists.forEach((playlist, index) => {
    const settings = playlist && playlist.settings && typeof playlist.settings === 'object'
      ? playlist.settings
      : {};
    nextPlaylists[index] = {
      ...playlist,
      settings: {
        ...settings,
        autoPlayEnabled: Boolean(nextAutoplay[index]),
        dspEnabled: Boolean(nextDsp[index]),
      },
    };
  });
  syncPlaylistsStateForMutation(nextPlaylists, { dapConfig: normalizedNextDap });
  if (shouldResetNoSilenceArm) {
    disarmDapNoSilence();
    clearDapInterruptedPlaybackSnapshot();
  }
  if (shouldStopDapPlaybackOnDisable) {
    _deps.stopAndClearLocalPlayback();
    _deps.requestHostPlaybackSync(true);
  }
  applyLiveVolumeToCurrentAudio();
  if (state.dspTransitionPlayback && state.dspTransitionPlayback.audio) {
    state.dspTransitionPlayback.audio.volume = getEffectiveLiveVolume(state.dspTransitionPlayback.toTrack || null);
  }
  updateDapSettingsUi(state.currentRole);
  renderZones();
  updateVolumePresetsUi();

  try {
    await _deps.pushSharedLayout();
    if (successMessage) {
      setStatus(successMessage);
    }
    if (normalizedNextDap.enabled) {
      ensureDapNoSilencePlayback({ reason: 'dap-config-updated' }).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error(err);
    syncPlaylistsStateForMutation(previousPlaylists, { dapConfig: previousDap });
    state.dapInterruptedPlaybackSnapshot = previousDapInterruptedPlaybackSnapshot;
    updateDapSettingsUi(state.currentRole);
    renderZones();
    updateVolumePresetsUi();
    setStatus('Не удалось синхронизировать DAP.');
    return false;
  }
}

export async function togglePlaylistDap(playlistIndex) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return;

  const isCurrentlySelected = isDapPlaylistIndex(playlistIndex, state.dapConfig);
  const nextDap = {
    enabled: !isCurrentlySelected,
    playlistIndex,
    volumePercent: state.dapConfig.volumePercent,
  };

  const statusMessage = isCurrentlySelected
    ? 'DAP выключен.'
    : `DAP включен для плей-листа ${playlistIndex + 1}.`;
  await syncDapConfig(nextDap, { successMessage: statusMessage });
}

export function buildPlaylistCoverage(layoutState) {
  const coverage = new Map();
  const normalizedLayout = ensurePlaylists(layoutState);

  normalizedLayout.forEach((playlist, playlistIndex) => {
    const filesInPlaylist = new Set();

    playlist.forEach((file) => {
      if (typeof file !== 'string' || !file || filesInPlaylist.has(file)) return;
      filesInPlaylist.add(file);

      if (!coverage.has(file)) {
        coverage.set(file, new Set([playlistIndex]));
        return;
      }

      coverage.get(file).add(playlistIndex);
    });
  });

  return coverage;
}

export function getLiveLockedPlaylistIndex() {
  if (state.currentTrack && typeof state.currentTrack.file === 'string' && state.currentTrack.file.trim()) {
    const currentPlaylistIndex = _deps.normalizePlaylistTrackIndex(state.currentTrack.playlistIndex);
    if (currentPlaylistIndex !== null) {
      return currentPlaylistIndex;
    }
  }

  const hostPlaybackContext = _deps.normalizeTrackPlaybackContext(state.hostPlaybackState);
  const hostPlaybackIndex =
    state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string' && state.hostPlaybackState.trackFile.trim()
      ? _deps.normalizePlaylistTrackIndex(hostPlaybackContext.playlistIndex)
      : null;

  if (hostPlaybackIndex !== null) {
    return hostPlaybackIndex;
  }

  return null;
}

export function syncPlaylistHeaderActiveState() {
  const zonesContainer = _deps.zonesContainer;
  if (!zonesContainer) return;

  const dapPlaylistIndex = getDapPlaylistIndex(state.dapConfig);
  const localPlaybackIndex =
    state.currentTrack && typeof state.currentTrack.file === 'string' && state.currentTrack.file.trim()
      ? _deps.normalizePlaylistTrackIndex(state.currentTrack.playlistIndex)
      : null;
  const isLocalPlaybackPaused = Boolean(state.currentTrack && state.currentAudio && state.currentAudio.paused);
  const hostPlaybackContext = _deps.normalizeTrackPlaybackContext(state.hostPlaybackState);
  const hostPlaybackIndex =
    state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string' && state.hostPlaybackState.trackFile.trim()
      ? _deps.normalizePlaylistTrackIndex(hostPlaybackContext.playlistIndex)
      : null;
  const livePlaybackIndex = isHostRole() ? localPlaybackIndex : hostPlaybackIndex;
  const isLivePlaybackPaused = isHostRole() ? isLocalPlaybackPaused : Boolean(state.hostPlaybackState.paused);
  const dapPlaybackState = _deps.sanitizeIncomingDapPlaybackState(
    isHostRole()
      ? _deps.buildDapPlaybackSnapshotForSync(state.dapConfig)
      : state.hostPlaybackState && typeof state.hostPlaybackState === 'object'
        ? state.hostPlaybackState.dapPlayback
        : null,
  );
  const dapPlaybackContext = _deps.normalizeTrackPlaybackContext(dapPlaybackState);
  const dapPlaybackIndex = dapPlaybackState.trackFile
    ? _deps.normalizePlaylistTrackIndex(dapPlaybackContext.playlistIndex)
    : null;
  const isDapPlaybackPaused = Boolean(!dapPlaybackState.trackFile || dapPlaybackState.paused);
  const zones = zonesContainer.querySelectorAll('.zone');
  zones.forEach((zone) => {
    if (!(zone instanceof HTMLElement)) return;
    const playlistIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return;

    const deleteButton = zone.querySelector('.playlist-delete-btn');
    const activeReel = zone.querySelector('.playlist-active-reel');
    if (!(deleteButton instanceof HTMLElement) || !(activeReel instanceof HTMLElement)) return;

    const isDapPlaylist = dapPlaylistIndex !== null && dapPlaylistIndex === playlistIndex;
    const isLiveOnPlaylist = livePlaybackIndex !== null && livePlaybackIndex === playlistIndex;
    const isLocalOnPlaylist = localPlaybackIndex !== null && localPlaybackIndex === playlistIndex;
    const isDapPlaybackOnPlaylist =
      isDapPlaylist &&
      Boolean(dapPlaybackState.trackFile) &&
      (dapPlaybackIndex === null || dapPlaybackIndex === playlistIndex);
    const isHostSourceOnSlave = isSlaveRole() && !isDapPlaylist && isLiveOnPlaylist;
    activeReel.classList.toggle('is-host-source', isHostSourceOnSlave);
    if (isDapPlaylist) {
      deleteButton.style.display = 'none';
      activeReel.style.display = 'inline-flex';
      activeReel.classList.toggle('is-rotating', isDapPlaybackOnPlaylist && !isDapPlaybackPaused);
      return;
    }

    const shouldShowActiveReel = isLiveOnPlaylist || isLocalOnPlaylist;
    const shouldUseLiveState = isLiveOnPlaylist;
    const isPaused = shouldUseLiveState ? isLivePlaybackPaused : isLocalPlaybackPaused;

    deleteButton.style.display = shouldShowActiveReel ? 'none' : 'inline-flex';
    activeReel.style.display = shouldShowActiveReel ? 'inline-flex' : 'none';
    activeReel.classList.toggle('is-rotating', shouldShowActiveReel && !isPaused);
  });
}

export function getPlaylistDeleteEligibility(playlistIndex) {
  const normalizedLayout = ensurePlaylists(state.layout);
  const normalizedMeta = normalizePlaylistMeta(state.playlistMeta, normalizedLayout.length);

  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= normalizedLayout.length) {
    return { canDelete: false, reason: 'Плей-лист не найден.' };
  }

  const metaEntry = normalizedMeta[playlistIndex];
  const isLinkedFolderPlaylist =
    metaEntry &&
    metaEntry.type === PLAYLIST_TYPE_FOLDER &&
    state.availableFolders.some((folder) => folder.key === metaEntry.folderKey);
  if (isLinkedFolderPlaylist) {
    return { canDelete: false, reason: 'Нельзя удалить авто-плей-лист папки, пока папка есть в /audio.' };
  }

  const liveLockedPlaylistIndex = getLiveLockedPlaylistIndex();
  if (liveLockedPlaylistIndex !== null && liveLockedPlaylistIndex === playlistIndex) {
    return { canDelete: false, reason: 'Нельзя удалить плей-лист, который сейчас играет на лайве.' };
  }

  if (isDapPlaylistIndex(playlistIndex)) {
    return { canDelete: false, reason: 'Нельзя удалить плей-лист, выбранный для DAP.' };
  }

  const playlist = normalizedLayout[playlistIndex];
  if (playlist.length === 0) {
    return { canDelete: true, reason: '' };
  }

  const coverage = buildPlaylistCoverage(normalizedLayout);
  const everyTrackExistsInOtherPlaylists = playlist.every((file) => {
    const owners = coverage.get(file);
    if (!owners) return false;
    if (owners.size > 1) return true;
    return !owners.has(playlistIndex);
  });

  if (everyTrackExistsInOtherPlaylists) {
    return { canDelete: true, reason: '' };
  }

  return { canDelete: false, reason: 'В этом плей-листе есть треки, которых нет в других плей-листах.' };
}

export async function deletePlaylist(playlistIndex) {
  if (isHostRole()) {
    try {
      await dispatchHostPlaylistMutationCommand({
        type: PLAYLIST_COMMAND_DELETE,
        playlistIndex,
      });
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось удалить плей-лист.');
    }
    return;
  }
  await deletePlaylistLocally(playlistIndex);
}

async function deletePlaylistLocally(playlistIndex) {
  const eligibility = getPlaylistDeleteEligibility(playlistIndex);
  if (!eligibility.canDelete) {
    setStatus(`Удаление запрещено: ${eligibility.reason}`);
    return;
  }

  const previousPlaylists = ensurePlaylistsForMutation();
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= previousPlaylists.length) return;
  const targetPlaylist = previousPlaylists[playlistIndex];
  const safeTitle = sanitizePlaylistName(targetPlaylist && targetPlaylist.name, playlistIndex);
  const confirmed = window.confirm(`Удалить плей-лист "${safeTitle}"?`);
  if (!confirmed) {
    return;
  }

  const previousDap = { ...state.dapConfig };
  const previousCurrentTrackWasDap = isDapTrackContext(state.currentTrack, previousDap);
  const previousCurrentTrackContext =
    state.currentTrack && typeof state.currentTrack === 'object'
      ? {
          playlistIndex: state.currentTrack.playlistIndex,
          playlistPosition: state.currentTrack.playlistPosition,
        }
      : null;
  const previousDapInterruptedSnapshot = state.dapInterruptedPlaybackSnapshot
    ? { ...state.dapInterruptedPlaybackSnapshot }
    : null;

  const nextPlaylists = clonePlaylistsForMutation(previousPlaylists);
  const removedPlaylists = nextPlaylists.splice(playlistIndex, 1);
  const removedPlaylistId =
    removedPlaylists.length && removedPlaylists[0] && typeof removedPlaylists[0].id === 'string'
      ? removedPlaylists[0].id
      : null;
  const nextDapRaw = { ...previousDap };
  const selectedPlaylistId = resolveDapPlaylistId(previousDap, previousPlaylists);
  if (selectedPlaylistId) {
    nextDapRaw.playlistId = selectedPlaylistId;
  }
  if (removedPlaylistId && selectedPlaylistId && removedPlaylistId === selectedPlaylistId) {
    nextDapRaw.enabled = false;
    nextDapRaw.playlistIndex = null;
    nextDapRaw.playlistId = null;
  }

  syncPlaylistsStateForMutation(nextPlaylists, { dapConfig: nextDapRaw });
  const preferredCurrentTrackPlaylistIndex = previousCurrentTrackWasDap ? getDapPlaylistIndex(state.dapConfig) : null;
  const currentTrackContextChanged = _deps.reconcileTrackContextWithLayout(state.currentTrack, {
    preferredPlaylistIndex: preferredCurrentTrackPlaylistIndex,
  });
  _deps.reconcileDapInterruptedSnapshotWithLayout();
  if (currentTrackContextChanged && state.currentAudio) {
    applyLiveVolumeToCurrentAudio();
  }
  updateDapSettingsUi(state.currentRole);
  renderZones();
  if (currentTrackContextChanged && isHostRole()) {
    _deps.requestHostPlaybackSync(true);
  }

  try {
    await _deps.pushSharedLayout();
    setStatus(`Плей-лист "${safeTitle}" удален.`);
  } catch (err) {
    console.error(err);
    syncPlaylistsStateForMutation(previousPlaylists, { dapConfig: previousDap });
    if (state.currentTrack && previousCurrentTrackContext) {
      state.currentTrack.playlistIndex = previousCurrentTrackContext.playlistIndex;
      state.currentTrack.playlistPosition = previousCurrentTrackContext.playlistPosition;
    }
    state.dapInterruptedPlaybackSnapshot = previousDapInterruptedSnapshot ? { ...previousDapInterruptedSnapshot } : null;
    const rollbackPreferredIndex = previousCurrentTrackWasDap ? getDapPlaylistIndex(state.dapConfig) : null;
    const rollbackTrackContextChanged = _deps.reconcileTrackContextWithLayout(state.currentTrack, {
      preferredPlaylistIndex: rollbackPreferredIndex,
    });
    const rollbackSnapshotContextChanged = _deps.reconcileDapInterruptedSnapshotWithLayout();
    if ((rollbackTrackContextChanged || rollbackSnapshotContextChanged) && state.currentAudio) {
      applyLiveVolumeToCurrentAudio();
    }
    updateDapSettingsUi(state.currentRole);
    renderZones();
    setStatus(err && err.message ? err.message : 'Не удалось синхронизировать удаление плей-листа.');
  }
}

export function shouldVirtualizePlaylist(playlistFiles) {
  if (!Array.isArray(playlistFiles) || playlistFiles.length < PLAYLIST_VIRTUALIZATION_MIN_ITEMS) {
    return false;
  }
  if (typeof window !== 'object' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(pointer: coarse)').matches;
}

export function syncVirtualizedRenderedTrackState() {
  if (state.currentTrack) {
    const isPlaying = Boolean(state.currentAudio && !state.currentAudio.paused);
    setButtonPlaying(state.currentTrack.key, isPlaying, state.currentTrack);
    setTrackPaused(state.currentTrack.key, !isPlaying && Boolean(state.currentAudio), state.currentTrack);
  }
  syncDapInterruptedTrackState();
  syncDspTransitionTrackHighlight();
  syncLiveDspNextTrackHighlight();
  syncHostTrackHighlight();
  syncPlaylistHeaderActiveState();
}

export function mountVirtualizedPlaylistCards(zoneBody, playlistCards) {
  if (!zoneBody || !Array.isArray(playlistCards) || playlistCards.length === 0) {
    if (zoneBody) {
      zoneBody.style.paddingTop = '';
      zoneBody.style.paddingBottom = '';
    }
    return;
  }

  const totalCards = playlistCards.length;
  let renderedStart = -1;
  let renderedEnd = -1;
  let rafId = null;

  const renderWindow = () => {
    if (!zoneBody.isConnected || state.draggingCard) return;

    const viewportHeight = Math.max(1, zoneBody.clientHeight || PLAYLIST_VIRTUALIZATION_FALLBACK_VIEWPORT_PX);
    const visibleRows = Math.max(1, Math.ceil(viewportHeight / PLAYLIST_VIRTUALIZATION_ROW_HEIGHT_PX));
    let start = Math.max(
      0,
      Math.floor(zoneBody.scrollTop / PLAYLIST_VIRTUALIZATION_ROW_HEIGHT_PX) - PLAYLIST_VIRTUALIZATION_OVERSCAN_ROWS,
    );
    let end = Math.min(
      totalCards,
      start + visibleRows + PLAYLIST_VIRTUALIZATION_OVERSCAN_ROWS * 2,
    );

    if (end <= start) {
      end = Math.min(totalCards, start + visibleRows);
    }

    if (start === renderedStart && end === renderedEnd) return;
    renderedStart = start;
    renderedEnd = end;

    zoneBody.style.paddingTop = `${Math.max(0, start * PLAYLIST_VIRTUALIZATION_ROW_HEIGHT_PX)}px`;
    zoneBody.style.paddingBottom = `${Math.max(0, (totalCards - end) * PLAYLIST_VIRTUALIZATION_ROW_HEIGHT_PX)}px`;

    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      fragment.appendChild(playlistCards[index]);
    }
    zoneBody.replaceChildren(fragment);
    syncVirtualizedRenderedTrackState();
  };

  const scheduleRender = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderWindow();
    });
  };

  zoneBody.addEventListener('scroll', scheduleRender, { passive: true });
  requestAnimationFrame(renderWindow);
}

export function renderZones() {
  const zonesContainer = _deps.zonesContainer;
  if (!zonesContainer) return;
  const normalizedLayoutLength = ensurePlaylists(state.layout).length;
  state.zoneBodiesCache = [];
  hideCollapsedPlaylistsOverlay();
  zonesContainer.innerHTML = '';
  _deps.resetTrackReferences();
  if (_deps.isTouchPlaylistCollapseEnabled()) {
    if (state.collapsedPlaylistLayoutLength !== null && state.collapsedPlaylistLayoutLength !== normalizedLayoutLength) {
      state.collapsedPlaylistIndices.clear();
      hideCollapsedPlaylistsOverlay();
    }
    state.collapsedPlaylistLayoutLength = normalizedLayoutLength;
    _deps.pruneCollapsedPlaylistIndices(normalizedLayoutLength);
  } else {
    state.collapsedPlaylistLayoutLength = null;
    if (state.collapsedPlaylistIndices.size) {
      state.collapsedPlaylistIndices.clear();
    }
    hideCollapsedPlaylistsOverlay();
    removeCollapsedPlaylistsHint();
  }
  applyDapConstraintsForCurrentLayout();
  updateDapSettingsUi(state.currentRole);
  const trackOccurrence = _deps.buildTrackOccurrenceMap(state.layout);
  const renderOrder = buildPlaylistRenderOrder(state.layout.length, state.dapConfig);
  const visibleRenderOrder = renderOrder.filter((playlistIndex) => !_deps.isPlaylistCollapsedForLocalView(playlistIndex));

  visibleRenderOrder.forEach((playlistIndex) => {
    const playlistFiles = Array.isArray(state.layout[playlistIndex]) ? state.layout[playlistIndex] : [];
    const metaEntry = state.playlistMeta[playlistIndex] || defaultPlaylistMeta();
    const isDapPlaylist = isDapPlaylistIndex(playlistIndex);
    const zone = document.createElement('div');
    zone.className = 'zone';
    zone.dataset.zoneIndex = playlistIndex.toString();
    zone.dataset.playlistType = metaEntry.type;
    if (metaEntry.type === PLAYLIST_TYPE_FOLDER) {
      zone.classList.add('zone--folder');
    }
    if (isDapPlaylist) {
      zone.classList.add('zone--dap');
    }

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      _deps.setDropEffectFromEvent(e, playlistIndex);
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => _deps.handleDrop(e, playlistIndex));

    const header = document.createElement('div');
    header.className = 'playlist-header';
    if (isHostRole()) {
      header.classList.add('playlist-header--reorder-enabled');
      header.addEventListener('pointerdown', (event) => {
        _deps.startPlaylistReorderHold(event, playlistIndex);
      });
    }
    const titleWrap = document.createElement('div');
    titleWrap.className = 'playlist-title-wrap';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'playlist-title-input';
    titleInput.value = sanitizePlaylistName(state.playlistNames[playlistIndex], playlistIndex);
    titleInput.maxLength = PLAYLIST_NAME_MAX_LENGTH;
    titleInput.addEventListener('change', () => {
      renamePlaylist(playlistIndex, titleInput.value);
    });
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        titleInput.blur();
      }
    });
    titleInput.addEventListener('blur', () => {
      const normalized = sanitizePlaylistName(titleInput.value, playlistIndex);
      if (titleInput.value !== normalized) {
        titleInput.value = normalized;
      }
    });
    const bindCollapseTouchHold = (targetElement) => {
      if (!(targetElement instanceof HTMLElement)) return;
      targetElement.addEventListener('pointerdown', (event) => {
        _deps.startPlaylistCollapseHold(event, playlistIndex);
      });
    };
    bindCollapseTouchHold(titleInput);

    if (metaEntry.type === PLAYLIST_TYPE_FOLDER) {
      const folderIcon = document.createElement('span');
      folderIcon.className = 'playlist-folder-icon';
      folderIcon.innerHTML =
        '<svg viewBox="0 0 24 18" aria-hidden="true" focusable="false"><path d="M1.5 16.5V3.5h7l2 2h12v11z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M1.5 5.5h21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      const originalFolderName = sanitizeFolderOriginalName(metaEntry.folderOriginalName, metaEntry.folderKey);
      folderIcon.title = originalFolderName || metaEntry.folderKey || 'Папка';
      folderIcon.setAttribute('aria-label', 'Плей-лист папки');
      bindCollapseTouchHold(folderIcon);
      titleWrap.appendChild(folderIcon);
    }

    titleWrap.appendChild(titleInput);

    const count = document.createElement('button');
    count.type = 'button';
    count.className = 'playlist-header-control playlist-count';
    count.disabled = true;
    count.tabIndex = -1;
    count.setAttribute('aria-hidden', 'true');
    count.textContent = _deps.getPlaylistDurationText(playlistIndex);
    state.playlistDurationLabelsByIndex.set(playlistIndex, count);

    const headerMeta = document.createElement('div');
    headerMeta.className = 'playlist-header-meta';

    const autoplayButton = document.createElement('button');
    autoplayButton.type = 'button';
    autoplayButton.className = 'playlist-header-control playlist-autoplay-toggle';
    autoplayButton.textContent = 'A';
    autoplayButton.setAttribute('aria-label', 'Автовоспроизведение плей-листа');
    const isAutoplayEnabled = Boolean(state.playlistAutoplay[playlistIndex]);
    const isDspEnabled = Boolean(state.playlistDsp[playlistIndex]);
    const hideModeTogglesOnCoHost = isCoHostRole();
    const hideInactiveIndicatorsOnSlave = isSlaveRole();
    const canManageAutoplay = isHostRole() && !isDapPlaylist;
    const canManageDsp = isHostRole() && isAutoplayEnabled;
    autoplayButton.dataset.state = isAutoplayEnabled ? 'on' : 'off';
    autoplayButton.setAttribute('aria-pressed', isAutoplayEnabled ? 'true' : 'false');
    autoplayButton.title = isDapPlaylist
      ? 'Для DAP-плей-листа автопроигрывание всегда включено'
      : canManageAutoplay
        ? `Автовоспроизведение: ${isAutoplayEnabled ? 'вкл' : 'выкл'}`
        : `Автовоспроизведение: ${isAutoplayEnabled ? 'вкл' : 'выкл'} (только хост)`;
    autoplayButton.classList.toggle('is-on', isAutoplayEnabled);
    autoplayButton.hidden = hideModeTogglesOnCoHost || isDapPlaylist || (hideInactiveIndicatorsOnSlave && !isAutoplayEnabled);
    autoplayButton.disabled = !canManageAutoplay;
    autoplayButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canManageAutoplay) return;
      togglePlaylistAutoplay(playlistIndex);
    });

    const dapButton = document.createElement('button');
    dapButton.type = 'button';
    dapButton.className = 'playlist-header-control playlist-dap-toggle';
    dapButton.disabled = true;
    dapButton.tabIndex = -1;
    dapButton.textContent = 'DAP';
    const isDapEnabledForPlaylist = isDapPlaylist;
    dapButton.dataset.state = isDapEnabledForPlaylist ? 'on' : 'off';
    dapButton.classList.toggle('is-on', isDapEnabledForPlaylist);
    dapButton.title = `DAP: ${isDapEnabledForPlaylist ? 'вкл' : 'выкл'}`;
    dapButton.setAttribute('aria-hidden', 'true');

    const dspButton = document.createElement('button');
    dspButton.type = 'button';
    dspButton.className = 'playlist-header-control playlist-dsp-toggle';
    dspButton.textContent = 'DSP';
    dspButton.setAttribute('aria-label', 'DSP переходы для плей-листа');
    dspButton.dataset.state = isDspEnabled ? 'on' : 'off';
    dspButton.setAttribute('aria-pressed', isDspEnabled ? 'true' : 'false');
    dspButton.classList.toggle('is-on', isDspEnabled);
    dspButton.hidden = hideModeTogglesOnCoHost || (hideInactiveIndicatorsOnSlave && !isDspEnabled);
    dspButton.disabled = !canManageDsp;
    if (!isAutoplayEnabled) {
      dspButton.title = canManageAutoplay
        ? 'DSP: недоступно, пока выключено автопроигрывание'
        : 'DSP: недоступно (только хост)';
    } else {
      dspButton.title = canManageDsp
        ? `DSP: ${isDspEnabled ? 'вкл' : 'выкл'}`
        : `DSP: ${isDspEnabled ? 'вкл' : 'выкл'} (только хост)`;
    }
    dspButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canManageDsp) return;
      togglePlaylistDsp(playlistIndex);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'playlist-delete-btn';
    deleteButton.setAttribute('aria-label', 'Удалить плей-лист');
    const deleteEligibility = getPlaylistDeleteEligibility(playlistIndex);
    deleteButton.title = deleteEligibility.canDelete
      ? 'Удалить плей-лист'
      : `Удаление недоступно: ${deleteEligibility.reason}`;
    if (!deleteEligibility.canDelete) {
      deleteButton.classList.add('is-blocked');
    }
    deleteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      deletePlaylist(playlistIndex);
    });

    const activeReel = document.createElement('span');
    activeReel.className = 'playlist-active-reel';
    activeReel.title = isDapPlaylist ? 'DAP плей-лист' : 'Активный плей-лист';
    activeReel.setAttribute('aria-hidden', 'true');
    if (isDapPlaylist) {
      activeReel.classList.add('playlist-active-reel--dap');
      activeReel.style.display = 'inline-flex';
      deleteButton.style.display = 'none';
    } else {
      activeReel.style.display = 'none';
    }

    if (!isDapPlaylist) {
      headerMeta.append(autoplayButton);
    }
    if (isDapPlaylist) {
      headerMeta.append(dapButton);
    }
    headerMeta.append(dspButton, count, deleteButton, activeReel);
    header.append(titleWrap, headerMeta);

    const body = document.createElement('div');
    body.className = 'zone-body';
    const playlistEntry = Array.isArray(state.playlists) ? state.playlists[playlistIndex] : null;

    const playlistCards = playlistFiles.map((file, rowIndex) => {
      const canDeleteTrack = (trackOccurrence.get(file) || 0) > 1;
      const trackEntry =
        playlistEntry &&
        Array.isArray(playlistEntry.tracks) &&
        rowIndex >= 0 &&
        rowIndex < playlistEntry.tracks.length
          ? playlistEntry.tracks[rowIndex]
          : null;
      return buildTrackCard(file, '/audio', {
        draggable: true,
        orderNumber: rowIndex + 1,
        playlistIndex,
        playlistPosition: rowIndex,
        playlistId: typeof playlistEntry?.id === 'string' ? playlistEntry.id : null,
        trackId: typeof trackEntry?.id === 'string' ? trackEntry.id : null,
        canDelete: canDeleteTrack,
      });
    });

    if (shouldVirtualizePlaylist(playlistFiles)) {
      mountVirtualizedPlaylistCards(body, playlistCards);
    } else if (playlistCards.length > 0) {
      const fragment = document.createDocumentFragment();
      playlistCards.forEach((card) => fragment.appendChild(card));
      body.appendChild(fragment);
    }

    body.addEventListener('dragover', (e) => _deps.applyDragPreview(body, e));

    zone.append(header, body);
    zonesContainer.appendChild(zone);
  });
  state.zoneBodiesCache = Array.from(zonesContainer.querySelectorAll('.zone-body'));

  syncPlaylistHeaderActiveState();
  syncCurrentTrackState();
  syncTrackRelocationHighlights();
}

export function syncCurrentTrackState() {
  if (state.currentTrack) {
    const isPlaying = Boolean(state.currentAudio && !state.currentAudio.paused);
    setButtonPlaying(state.currentTrack.key, isPlaying, state.currentTrack);
    setTrackPaused(state.currentTrack.key, !isPlaying && Boolean(state.currentAudio), state.currentTrack);
  }
  syncDapInterruptedTrackState();
  syncDspTransitionTrackHighlight();
  syncLiveDspNextTrackHighlight();
  syncPlaylistHeaderActiveState();
  syncNowPlayingPanel();
  syncHostNowPlayingPanel();
}

export function syncDapInterruptedTrackState() {
  const interruptedState = _deps.getVisibleDapInterruptedPlaybackDisplayState(state.dapConfig);
  const previousState = state.syncedDapInterruptedUiState;

  if (
    previousState &&
    (!interruptedState ||
      interruptedState.fileKey !== previousState.fileKey ||
      !_deps.isTrackPlaybackContextEqual(interruptedState.playbackContext, previousState.playbackContext))
  ) {
    setTrackPausedByContext(previousState.fileKey, false, previousState.playbackContext);
    _deps.refreshTrackDurationLabels(previousState.fileKey);
    state.syncedDapInterruptedUiState = null;
  }

  if (!interruptedState) return;

  setTrackPausedByContext(interruptedState.fileKey, true, interruptedState.playbackContext);
  _deps.refreshTrackDurationLabels(interruptedState.fileKey);
  state.syncedDapInterruptedUiState = {
    fileKey: interruptedState.fileKey,
    playbackContext: _deps.normalizeTrackPlaybackContext(interruptedState.playbackContext),
  };
}

export async function fetchFileList(url, { logErrors = true } = {}) {
  try {
    const { ok, data } = await api.fetchFileList(url);
    if (!ok) throw new Error('Не удалось получить список файлов');
    return {
      files: Array.isArray(data.files) ? data.files : [],
      folders: Array.isArray(data.folders) ? data.folders : [],
      ok: true,
    };
  } catch (err) {
    if (logErrors) {
      console.error(err);
    }
    return { files: [], folders: [], ok: false };
  }
}

export function buildAudioCatalogSignature(files, folders) {
  const normalizedFiles = Array.isArray(files)
    ? files.filter((file) => typeof file === 'string' && file.trim()).slice().sort((left, right) => left.localeCompare(right, 'ru'))
    : [];
  const normalizedFolders = Array.isArray(folders)
    ? folders
        .map((folder) => ({
          key: typeof folder.key === 'string' ? folder.key : '',
          files: Array.isArray(folder.files)
            ? folder.files
                .filter((file) => typeof file === 'string' && file.trim())
                .slice()
                .sort((left, right) => left.localeCompare(right, 'ru'))
            : [],
        }))
        .filter((folder) => folder.key)
        .sort((left, right) => left.key.localeCompare(right.key, 'ru'))
    : [];

  return JSON.stringify({ files: normalizedFiles, folders: normalizedFolders });
}

export function setPlaylistControlsLoading(isLoading) {
  if (_deps.refreshPlaylistsBtn) {
    _deps.refreshPlaylistsBtn.disabled = isLoading;
    _deps.refreshPlaylistsBtn.dataset.loading = isLoading ? 'true' : 'false';
    _deps.refreshPlaylistsBtn.textContent = isLoading ? 'Обновление...' : 'Обновить';
  }
  if (_deps.addPlaylistBtn) {
    _deps.addPlaylistBtn.disabled = isLoading;
  }
  if (_deps.resetPlaylistsBtn) {
    _deps.resetPlaylistsBtn.disabled = isLoading;
  }
}

export function getTrackReloadStatusMessage(reason, fileCount) {
  if (reason === 'manual') {
    return `Список обновлен: ${fileCount} треков.`;
  }
  if (reason === 'auto') {
    return `Обнаружены изменения в /audio. Треков: ${fileCount}.`;
  }
  return `Найдено файлов: ${fileCount}`;
}

export async function loadTracks({ reason = 'manual', audioResult = null } = {}) {
  closeLayoutStream();
  const catalogResult = audioResult || (await fetchFileList('/api/audio'));
  _deps.resetTrackReferences();

  if (!catalogResult.ok) {
    renderEmpty();
    syncCurrentTrackState();
    setStatus('Ошибка загрузки списка файлов. Проверьте сервер.');
    return;
  }

  state.audioCatalogSignature = buildAudioCatalogSignature(catalogResult.files, catalogResult.folders);
  state.availableFiles = catalogResult.files;
  state.availableFolders = normalizeAudioFolderTemplates(catalogResult.folders, state.availableFiles);
  _deps.keepKnownDurationsForFiles(state.availableFiles);
  keepKnownTrackAttributesForFiles(state.availableFiles, '/audio');
  keepTrackTitleModesForFiles(state.availableFiles, '/audio');
  _deps.preloadTrackDurations(state.availableFiles);
  preloadTrackAttributesForConfiguredTracks(state.availableFiles, '/audio');

  if (!state.availableFiles.length) {
    renderEmpty();
    syncCurrentTrackState();
    setStatus('Файлы не найдены. Добавьте аудио в папку /audio и обновите страницу.');
    return;
  }

  try {
    await _deps.initializeLayoutState();
  } catch (err) {
    console.error(err);
    const fallback = ensureFolderPlaylistsCoverage([state.availableFiles.filter((file) => !file.includes('/'))], [], []);
    const fallbackLayout = normalizeLayoutForFiles(fallback.layout, state.availableFiles);
    applyLegacyLayoutProjection({
      layout: fallbackLayout,
      playlistNames: fallback.playlistNames,
      playlistMeta: fallback.playlistMeta,
      playlistAutoplay: [],
      playlistDsp: [],
      dapConfig: DEFAULT_DAP_CONFIG,
    });
    setStatus('Не удалось загрузить состояние плей-листов, используется локальная раскладка.');
  }

  try {
    await _deps.initializePlaybackState();
  } catch (err) {
    console.error(err);
    state.hostPlaybackState = _deps.getDefaultHostPlaybackState();
    setLivePlaybackVolume(state.hostPlaybackState.volume, { sync: false, announce: false });
  }

  renderZones();
  syncCurrentTrackState();
  setStatus(getTrackReloadStatusMessage(reason, state.availableFiles.length));
  ensureDapNoSilencePlayback({ reason: 'tracks-loaded' }).catch(() => {});
  _deps.connectLayoutStream();
}

export function requestTracksReload({ reason = 'manual', audioResult = null } = {}) {
  if (state.tracksReloadInFlight) {
    state.tracksReloadQueued = true;
    if (reason === 'manual') {
      state.tracksReloadQueuedReason = 'manual';
    }
    return;
  }

  state.tracksReloadInFlight = true;
  setPlaylistControlsLoading(true);

  loadTracks({ reason, audioResult })
    .catch((err) => {
      console.error('Не удалось обновить список треков', err);
      setStatus('Не удалось обновить список треков.');
    })
    .finally(() => {
      state.tracksReloadInFlight = false;
      setPlaylistControlsLoading(false);

      if (!state.tracksReloadQueued) return;
      const queuedReason = state.tracksReloadQueuedReason === 'manual' ? 'manual' : 'auto';
      state.tracksReloadQueued = false;
      state.tracksReloadQueuedReason = 'auto';
      requestTracksReload({ reason: queuedReason });
    });
}

export async function pollAudioCatalogChanges() {
  if (state.audioCatalogPollInFlight || state.tracksReloadInFlight) return;
  if (!state.audioCatalogSignature) return;

  state.audioCatalogPollInFlight = true;
  try {
    const catalogResult = await fetchFileList('/api/audio', { logErrors: false });
    if (!catalogResult.ok) return;

    const nextSignature = buildAudioCatalogSignature(catalogResult.files, catalogResult.folders);
    if (nextSignature === state.audioCatalogSignature) return;

    requestTracksReload({ reason: 'auto', audioResult: catalogResult });
  } finally {
    state.audioCatalogPollInFlight = false;
  }
}

export function startAudioCatalogAutoRefresh() {
  stopAudioCatalogAutoRefresh();
  state.audioCatalogPollTimer = setInterval(() => {
    pollAudioCatalogChanges();
  }, AUDIO_CATALOG_POLL_INTERVAL_MS);
}

export function stopAudioCatalogAutoRefresh() {
  if (state.audioCatalogPollTimer !== null) {
    clearInterval(state.audioCatalogPollTimer);
    state.audioCatalogPollTimer = null;
  }
}

export function initPlaylistControls() {
  if (_deps.addPlaylistBtn) {
    _deps.addPlaylistBtn.addEventListener('click', addPlaylist);
  }

  if (_deps.refreshPlaylistsBtn) {
    _deps.refreshPlaylistsBtn.addEventListener('click', () => {
      setStatus('Обновляем список файлов и плей-листов...');
      requestTracksReload({ reason: 'manual' });
    });
  }

  if (_deps.resetPlaylistsBtn) {
    _deps.resetPlaylistsBtn.addEventListener('click', resetPlaylists);
  }

  setPlaylistControlsLoading(false);
}

export function getPlaylistDisplayLabel(playlistIndex) {
  const safeIndex = Number.isInteger(playlistIndex) && playlistIndex >= 0 ? playlistIndex : 0;
  return sanitizePlaylistName(state.playlistNames[safeIndex], safeIndex);
}

export async function copyTextToClipboard(text) {
  if (!text) return false;

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
  }

  if (!copied) {
    throw new Error('Clipboard API недоступен');
  }

  return true;
}

export function normalizeTrackTitleMode(value) {
  return value === TRACK_TITLE_MODE_ATTRIBUTES ? TRACK_TITLE_MODE_ATTRIBUTES : TRACK_TITLE_MODE_FILE;
}

export function normalizeTrackTitleModesByTrackPayload(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return new Map();

  const result = new Map();
  const keys = Object.keys(rawValue).sort((left, right) => left.localeCompare(right, 'ru'));
  keys.forEach((rawKey) => {
    if (typeof rawKey !== 'string' || !rawKey.trim()) return;
    const mode = normalizeTrackTitleMode(rawValue[rawKey]);
    if (mode !== TRACK_TITLE_MODE_ATTRIBUTES) return;
    result.set(rawKey, TRACK_TITLE_MODE_ATTRIBUTES);
  });
  return result;
}

export function parseTrackTitleModesByTrack(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return new Map();

  try {
    return normalizeTrackTitleModesByTrackPayload(JSON.parse(rawValue));
  } catch (err) {
    return new Map();
  }
}

export function serializeTrackTitleModesByTrack(trackModesState = state.trackTitleModesByTrack) {
  const normalized = trackModesState instanceof Map ? trackModesState : new Map();
  const serialized = {};
  const keys = Array.from(normalized.keys()).sort((left, right) => left.localeCompare(right, 'ru'));
  for (const fileKey of keys) {
    const mode = normalized.get(fileKey);
    if (normalizeTrackTitleMode(mode) !== TRACK_TITLE_MODE_ATTRIBUTES) continue;
    serialized[fileKey] = TRACK_TITLE_MODE_ATTRIBUTES;
  }
  return serialized;
}

export function saveTrackTitleModesByTrackSetting() {
  const serialized = serializeTrackTitleModesByTrack();
  if (typeof _deps.saveSetting === 'function') {
    _deps.saveSetting(SETTINGS_KEYS.trackTitleModesByTrack, JSON.stringify(serialized));
  }
}

export function loadTrackTitleModesByTrackSetting() {
  const rawValue =
    typeof _deps.loadSetting === 'function'
      ? _deps.loadSetting(SETTINGS_KEYS.trackTitleModesByTrack, '{}')
      : '{}';
  state.trackTitleModesByTrack = parseTrackTitleModesByTrack(rawValue);
}

export function trackTitleModesByTrackEqual(leftState, rightState) {
  const leftSerialized = serializeTrackTitleModesByTrack(leftState);
  const rightSerialized = serializeTrackTitleModesByTrack(rightState);
  return JSON.stringify(leftSerialized) === JSON.stringify(rightSerialized);
}

export function normalizeTrackTitleModesByTrackForFiles(trackModesState, files, basePath = '/audio') {
  const normalizedState =
    trackModesState instanceof Map ? new Map(trackModesState) : normalizeTrackTitleModesByTrackPayload(trackModesState);
  const allowedKeys = new Set(
    Array.isArray(files)
      ? files
          .filter((file) => typeof file === 'string' && file.trim())
          .map((file) => trackKey(file, basePath))
      : [],
  );

  const result = new Map();
  const keys = Array.from(normalizedState.keys()).sort((left, right) => left.localeCompare(right, 'ru'));
  keys.forEach((key) => {
    if (!allowedKeys.has(key)) return;
    if (normalizeTrackTitleMode(normalizedState.get(key)) !== TRACK_TITLE_MODE_ATTRIBUTES) return;
    result.set(key, TRACK_TITLE_MODE_ATTRIBUTES);
  });

  return result;
}

export function getTrackTitleModeByKey(fileKey) {
  if (typeof fileKey !== 'string' || !fileKey) return TRACK_TITLE_MODE_FILE;
  return normalizeTrackTitleMode(state.trackTitleModesByTrack.get(fileKey));
}

export function getTrackTitleModeForTrack(file, basePath = '/audio') {
  return getTrackTitleModeByKey(trackKey(file, basePath));
}

export function keepTrackTitleModesForFiles(files, basePath = '/audio') {
  const normalized = normalizeTrackTitleModesByTrackForFiles(state.trackTitleModesByTrack, files, basePath);
  if (!trackTitleModesByTrackEqual(state.trackTitleModesByTrack, normalized)) {
    state.trackTitleModesByTrack = normalized;
    saveTrackTitleModesByTrackSetting();
  }
}

export function sanitizeTrackAttributeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function trackFileDisplayName(file) {
  const normalized = typeof file === 'string' ? file.replace(/\\/g, '/') : '';
  const basename = normalized.split('/').filter(Boolean).pop() || normalized;
  return stripExtension(basename);
}

export function buildTrackAttributesDisplayName(attributes, file) {
  const safeTitle = sanitizeTrackAttributeText(attributes && attributes.title);
  const safeArtist = sanitizeTrackAttributeText(attributes && attributes.artist);
  const fallback = trackFileDisplayName(file);
  if (safeTitle && safeArtist) {
    return `${safeArtist} - ${safeTitle}`;
  }
  return safeTitle || safeArtist || fallback;
}

export function normalizeTrackAttributesPayload(payload, file) {
  const title = sanitizeTrackAttributeText(payload && payload.title);
  const artist = sanitizeTrackAttributeText(payload && payload.artist);
  const displayName = sanitizeTrackAttributeText(payload && payload.displayName) || buildTrackAttributesDisplayName({ title, artist }, file);
  return { title, artist, displayName };
}

export function refreshTrackNameLabelsByKey(fileKey) {
  if (!fileKey) return;
  const labels = state.trackNameLabelsByFile.get(fileKey);
  if (!labels || !labels.size) return;

  for (const label of labels) {
    if (!(label instanceof HTMLElement)) continue;
    const file = typeof label.dataset.file === 'string' ? label.dataset.file : '';
    const basePath = typeof label.dataset.basePath === 'string' ? label.dataset.basePath : '/audio';
    label.textContent = getTrackDisplayNameForMode(file, basePath, { triggerLoad: true });
  }
}

export function preloadTrackAttributesForConfiguredTracks(files, basePath = '/audio') {
  if (!Array.isArray(files) || !files.length) return;

  files.forEach((file) => {
    if (typeof file !== 'string' || !file.trim()) return;
    if (getTrackTitleModeForTrack(file, basePath) !== TRACK_TITLE_MODE_ATTRIBUTES) return;
    loadTrackAttributes(file, basePath).catch(() => {});
  });
}

export function keepKnownTrackAttributesForFiles(files, basePath = '/audio') {
  const allowedKeys = new Set(
    Array.isArray(files)
      ? files
          .filter((file) => typeof file === 'string' && file.trim())
          .map((file) => trackKey(file, basePath))
      : [],
  );

  for (const key of state.trackAttributesByFile.keys()) {
    if (!allowedKeys.has(key)) {
      state.trackAttributesByFile.delete(key);
    }
  }

  for (const key of state.trackAttributeLoadPromisesByFile.keys()) {
    if (!allowedKeys.has(key)) {
      state.trackAttributeLoadPromisesByFile.delete(key);
    }
  }
}

export async function loadTrackAttributes(file, basePath = '/audio') {
  const key = trackKey(file, basePath);
  const cached = state.trackAttributesByFile.get(key);
  if (cached) return cached;

  const pending = state.trackAttributeLoadPromisesByFile.get(key);
  if (pending) return pending;

  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const fallback = normalizeTrackAttributesPayload(null, file);

  const request = (async () => {
    if (normalizedBase !== '/audio') {
      state.trackAttributesByFile.set(key, fallback);
      return fallback;
    }

    try {
      const { ok: attrOk, data: attrPayload } = await api.fetchAudioAttributes(file);
      if (!attrOk) {
        state.trackAttributesByFile.set(key, fallback);
        return fallback;
      }
      const payload = attrPayload;
      const normalizedAttributes = normalizeTrackAttributesPayload(payload, file);
      state.trackAttributesByFile.set(key, normalizedAttributes);
      return normalizedAttributes;
    } catch (err) {
      console.error('Не удалось загрузить атрибуты трека', err);
      state.trackAttributesByFile.set(key, fallback);
      return fallback;
    }
  })();

  state.trackAttributeLoadPromisesByFile.set(key, request);

  try {
    const attributes = await request;
    if (getTrackTitleModeByKey(key) === TRACK_TITLE_MODE_ATTRIBUTES) {
      refreshTrackNameLabelsByKey(key);
      if (state.currentTrack && state.currentTrack.key === key) {
        syncNowPlayingPanel();
      }
      if (isRemoteLiveMirrorRole() && state.hostPlaybackState && state.hostPlaybackState.trackFile) {
        const hostTrackKey = trackKey(state.hostPlaybackState.trackFile, '/audio');
        if (hostTrackKey === key) {
          if (isCoHostRole()) {
            syncNowPlayingPanel();
          } else {
            syncHostNowPlayingPanel();
          }
        }
      }
    }
    return attributes;
  } finally {
    state.trackAttributeLoadPromisesByFile.delete(key);
  }
}

export function getTrackDisplayNameForMode(file, basePath = '/audio', { triggerLoad = true } = {}) {
  const fallback = trackFileDisplayName(file);
  const key = trackKey(file, basePath);
  if (getTrackTitleModeByKey(key) !== TRACK_TITLE_MODE_ATTRIBUTES) {
    return fallback;
  }

  const attributes = state.trackAttributesByFile.get(key);
  if (attributes && attributes.displayName) {
    return attributes.displayName;
  }

  if (triggerLoad) {
    loadTrackAttributes(file, basePath).catch(() => {});
  }

  return fallback;
}

export function setTrackTitleModeForTrack(file, basePath = '/audio', mode, { persist = true, announce = false } = {}) {
  const fileKey = trackKey(file, basePath);
  const normalizedMode = normalizeTrackTitleMode(mode);
  const previousMode = getTrackTitleModeByKey(fileKey);
  const changed = previousMode !== normalizedMode;

  if (normalizedMode === TRACK_TITLE_MODE_ATTRIBUTES) {
    state.trackTitleModesByTrack.set(fileKey, TRACK_TITLE_MODE_ATTRIBUTES);
  } else {
    state.trackTitleModesByTrack.delete(fileKey);
  }

  if (persist) {
    saveTrackTitleModesByTrackSetting();
  }

  if (changed) {
    refreshTrackNameLabelsByKey(fileKey);
    if (state.currentTrack && state.currentTrack.key === fileKey) {
      syncNowPlayingPanel();
    }
    if (isRemoteLiveMirrorRole() && state.hostPlaybackState && state.hostPlaybackState.trackFile) {
      const hostTrackKey = trackKey(state.hostPlaybackState.trackFile, '/audio');
      if (hostTrackKey === fileKey) {
        if (isCoHostRole()) {
          syncNowPlayingPanel();
        } else {
          syncHostNowPlayingPanel();
        }
      }
    }
  }

  if (normalizedMode === TRACK_TITLE_MODE_ATTRIBUTES) {
    loadTrackAttributes(file, basePath).catch(() => {});
  }

  if (announce) {
    const label = trackFileDisplayName(file);
    setStatus(
      normalizedMode === TRACK_TITLE_MODE_ATTRIBUTES
        ? `Режим названия "${label}": атрибуты.`
        : `Режим названия "${label}": имя файла.`,
    );
  }

  return changed;
}

export async function toggleTrackTitleModeForTrack(file, basePath = '/audio') {
  const currentMode = getTrackTitleModeForTrack(file, basePath);
  const nextMode = currentMode === TRACK_TITLE_MODE_ATTRIBUTES ? TRACK_TITLE_MODE_FILE : TRACK_TITLE_MODE_ATTRIBUTES;
  const changed = setTrackTitleModeForTrack(file, basePath, nextMode, { persist: true, announce: false });
  if (!changed) return;

  try {
    await _deps.pushSharedLayout({ renderOnApply: false });
    const label = trackFileDisplayName(file);
    setStatus(
      nextMode === TRACK_TITLE_MODE_ATTRIBUTES
        ? `Режим названия "${label}": атрибуты.`
        : `Режим названия "${label}": имя файла.`,
    );
  } catch (err) {
    console.error(err);
    setTrackTitleModeForTrack(file, basePath, currentMode, { persist: true, announce: false });
    setStatus('Не удалось синхронизировать режим названия трека.');
  }
}

export function trackDisplayName(file, basePath = '/audio') {
  return getTrackDisplayNameForMode(file, basePath, { triggerLoad: true });
}

export function stripExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return filename;
  return filename.slice(0, lastDot);
}

export function renderEmpty() {
  if (_deps.zonesContainer) {
    _deps.zonesContainer.innerHTML =
      '<div class="empty-state">В папке /audio не найдено аудиофайлов (mp3, wav, ogg, m4a, flac).</div>';
  }
}

export function resolveTrackUiContext(playbackContext = null) {
  const playlistIndex =
    playbackContext && Number.isInteger(playbackContext.playlistIndex) && playbackContext.playlistIndex >= 0
      ? playbackContext.playlistIndex
      : null;
  const playlistPosition =
    playbackContext && Number.isInteger(playbackContext.playlistPosition) && playbackContext.playlistPosition >= 0
      ? playbackContext.playlistPosition
      : null;
  const playlistId =
    playbackContext && typeof playbackContext.playlistId === 'string' && playbackContext.playlistId.trim()
      ? playbackContext.playlistId.trim()
      : null;
  const trackId =
    playbackContext && typeof playbackContext.trackId === 'string' && playbackContext.trackId.trim()
      ? playbackContext.trackId.trim()
      : null;

  return { playlistIndex, playlistPosition, playlistId, trackId };
}

export function cardMatchesTrackContext(card, playbackContext = null) {
  if (!card || !card.dataset) return false;
  const { playlistIndex, playlistPosition, playlistId, trackId } = resolveTrackUiContext(playbackContext);
  if (playlistId && trackId) {
    return card.dataset.playlistId === playlistId && card.dataset.trackId === trackId;
  }
  if (playlistIndex === null || playlistPosition === null) return false;

  const cardPlaylistIndex = Number.parseInt(card.dataset.playlistIndex || '', 10);
  const cardPlaylistPosition = Number.parseInt(card.dataset.playlistPosition || '', 10);
  return cardPlaylistIndex === playlistIndex && cardPlaylistPosition === playlistPosition;
}

export function getTrackCardByContext(fileKey, playbackContext = null) {
  const cards = state.cardsByFile.get(fileKey);
  if (!cards || !cards.size) return null;

  for (const card of cards) {
    if (cardMatchesTrackContext(card, playbackContext)) {
      return card;
    }
  }

  return getFirstFromSet(cards);
}

export function normalizeTrackRelocationHighlightContext(trackContext) {
  if (!trackContext || typeof trackContext !== 'object') return null;
  const file = typeof trackContext.file === 'string' ? trackContext.file.trim() : '';
  const playlistIndex = _deps.normalizePlaylistTrackIndex(trackContext.playlistIndex);
  const playlistPosition = _deps.normalizePlaylistTrackIndex(trackContext.playlistPosition);
  if (!file || playlistIndex === null || playlistPosition === null) return null;

  const fileKey = trackKey(file, '/audio');
  return {
    key: `${fileKey}|${playlistIndex}|${playlistPosition}`,
    fileKey,
    playbackContext: {
      playlistIndex,
      playlistPosition,
    },
  };
}

export function createTrackRelocationUndoSnapshot({
  layoutState = state.layout,
  namesState = state.playlistNames,
  metaState = state.playlistMeta,
  autoplayState = state.playlistAutoplay,
  dspState = state.playlistDsp,
  dapState = state.dapConfig,
} = {}) {
  return {
    layout: cloneLayoutState(layoutState),
    playlistNames: Array.isArray(namesState) ? namesState.slice() : [],
    playlistMeta: clonePlaylistMetaState(Array.isArray(metaState) ? metaState : []),
    playlistAutoplay: Array.isArray(autoplayState) ? autoplayState.slice() : [],
    playlistDsp: Array.isArray(dspState) ? dspState.slice() : [],
    dapConfig: dapState && typeof dapState === 'object' ? { ...dapState } : { ...DEFAULT_DAP_CONFIG },
  };
}

export function clearTrackRelocationHighlightTimer() {
  if (state.trackRelocationHighlightTimer === null) return;
  clearTimeout(state.trackRelocationHighlightTimer);
  state.trackRelocationHighlightTimer = null;
}

export function scheduleTrackRelocationHighlightTimer() {
  clearTrackRelocationHighlightTimer();
  if (!state.trackRelocationHighlights.size) return;

  const now = Date.now();
  let nextExpiresAt = Number.POSITIVE_INFINITY;
  for (const entry of state.trackRelocationHighlights.values()) {
    if (Number.isFinite(entry.expiresAt) && entry.expiresAt < nextExpiresAt) {
      nextExpiresAt = entry.expiresAt;
    }
  }

  if (!Number.isFinite(nextExpiresAt)) return;

  const delay = Math.max(0, nextExpiresAt - now) + 20;
  state.trackRelocationHighlightTimer = setTimeout(() => {
    state.trackRelocationHighlightTimer = null;
    syncTrackRelocationHighlights();
    scheduleTrackRelocationHighlightTimer();
  }, delay);
}

export function applyTrackRelocationUndoSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;

  applyLegacyLayoutProjection({
    layout: cloneLayoutState(snapshot.layout),
    playlistNames: snapshot.playlistNames,
    playlistMeta: snapshot.playlistMeta,
    playlistAutoplay: snapshot.playlistAutoplay,
    playlistDsp: snapshot.playlistDsp,
    dapConfig: snapshot.dapConfig,
  });
}

export function renderTrackRelocationUndoButton(card, action) {
  if (!(card instanceof HTMLElement) || !action) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'track-relocation-undo';
  button.textContent = action.restoring ? 'Отмена...' : 'Отменить действие';
  button.disabled = Boolean(action.restoring);
  button.title = 'Отменить последнее перемещение/копирование';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    undoTrackRelocationAction(action.id).catch((err) => {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось отменить действие.');
    });
  });
  card.classList.add('has-relocation-undo');
  const nameEl = card.querySelector('.track-name');
  if (nameEl && nameEl.parentElement === card) {
    card.insertBefore(button, nameEl);
  } else {
    card.appendChild(button);
  }
}

export function syncTrackRelocationHighlights() {
  const now = Date.now();
  for (const [key, entry] of state.trackRelocationHighlights.entries()) {
    if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
      if (entry && typeof entry.undoId === 'string' && entry.undoId) {
        state.trackRelocationUndoActions.delete(entry.undoId);
      }
      state.trackRelocationHighlights.delete(key);
    }
  }

  const activeUndoIds = new Set();
  for (const entry of state.trackRelocationHighlights.values()) {
    if (entry && typeof entry.undoId === 'string' && entry.undoId) {
      activeUndoIds.add(entry.undoId);
    }
  }
  for (const actionId of state.trackRelocationUndoActions.keys()) {
    if (!activeUndoIds.has(actionId)) {
      state.trackRelocationUndoActions.delete(actionId);
    }
  }

  document.querySelectorAll('.track-relocation-undo').forEach((button) => {
    button.remove();
  });

  document.querySelectorAll('.track-card.has-relocation-undo').forEach((card) => {
    card.classList.remove('has-relocation-undo');
  });

  document.querySelectorAll('.track-card.is-relocated').forEach((card) => {
    card.classList.remove('is-relocated');
  });

  if (!state.trackRelocationHighlights.size) {
    clearTrackRelocationHighlightTimer();
    return;
  }

  for (const entry of state.trackRelocationHighlights.values()) {
    const card = getTrackCardByContext(entry.fileKey, entry.playbackContext);
    if (card) {
      card.classList.add('is-relocated');
      if (typeof entry.undoId === 'string' && entry.undoId) {
        const action = state.trackRelocationUndoActions.get(entry.undoId);
        if (action) {
          renderTrackRelocationUndoButton(card, action);
        }
      }
    }
  }
}

export function scheduleTrackRelocationHighlight(trackContext, durationMs = TRACK_RELOCATE_HIGHLIGHT_MS, { undoId = null } = {}) {
  const normalized = normalizeTrackRelocationHighlightContext(trackContext);
  if (!normalized) return;

  const duration = Number.isFinite(durationMs) ? Math.max(120, durationMs) : TRACK_RELOCATE_HIGHLIGHT_MS;
  state.trackRelocationHighlights.set(normalized.key, {
    ...normalized,
    expiresAt: Date.now() + duration,
    undoId: typeof undoId === 'string' && undoId ? undoId : null,
  });
  syncTrackRelocationHighlights();
  scheduleTrackRelocationHighlightTimer();
}

export function clearTrackRelocationHighlight(trackContext) {
  const normalized = normalizeTrackRelocationHighlightContext(trackContext);
  if (!normalized) return;

  const removed = state.trackRelocationHighlights.get(normalized.key);
  if (state.trackRelocationHighlights.delete(normalized.key)) {
    if (removed && typeof removed.undoId === 'string' && removed.undoId) {
      state.trackRelocationUndoActions.delete(removed.undoId);
    }
    syncTrackRelocationHighlights();
    scheduleTrackRelocationHighlightTimer();
  }
}

export function clearTrackRelocationUndoAction(actionId, { clearHighlights = true } = {}) {
  if (typeof actionId !== 'string' || !actionId) return;
  state.trackRelocationUndoActions.delete(actionId);
  if (!clearHighlights) return;

  let changed = false;
  for (const [key, entry] of state.trackRelocationHighlights.entries()) {
    if (entry && entry.undoId === actionId) {
      state.trackRelocationHighlights.delete(key);
      changed = true;
    }
  }

  if (changed) {
    syncTrackRelocationHighlights();
    scheduleTrackRelocationHighlightTimer();
  }
}

export function registerTrackRelocationUndoAction(trackContext, undoSnapshot, durationMs = TRACK_RELOCATE_HIGHLIGHT_MS) {
  const normalized = normalizeTrackRelocationHighlightContext(trackContext);
  if (!normalized || !undoSnapshot || typeof undoSnapshot !== 'object') return null;

  const normalizedUndoSnapshot = createTrackRelocationUndoSnapshot({
    layoutState: undoSnapshot.layout,
    namesState: undoSnapshot.playlistNames,
    metaState: undoSnapshot.playlistMeta,
    autoplayState: undoSnapshot.playlistAutoplay,
    dspState: undoSnapshot.playlistDsp,
    dapState: undoSnapshot.dapConfig,
  });

  const duration = Number.isFinite(durationMs) ? Math.max(120, durationMs) : TRACK_RELOCATE_HIGHLIGHT_MS;
  const id = `relocate:${Date.now().toString(36)}:${(state.trackRelocationUndoSeq += 1)}`;
  state.trackRelocationUndoActions.set(id, {
    id,
    expiresAt: Date.now() + duration,
    restoring: false,
    trackContext: {
      file: trackContext.file,
      playlistIndex: normalized.playbackContext.playlistIndex,
      playlistPosition: normalized.playbackContext.playlistPosition,
    },
    snapshot: normalizedUndoSnapshot,
  });
  scheduleTrackRelocationHighlight(trackContext, duration, { undoId: id });
  return id;
}

export async function undoTrackRelocationAction(actionId) {
  if (typeof actionId !== 'string' || !actionId) return false;
  const action = state.trackRelocationUndoActions.get(actionId);
  if (!action) return false;
  if (action.restoring) return false;
  if (!action.snapshot) {
    clearTrackRelocationUndoAction(actionId);
    return false;
  }

  action.restoring = true;
  syncTrackRelocationHighlights();

  const rollbackSnapshot = createTrackRelocationUndoSnapshot({
    layoutState: state.layout,
    namesState: state.playlistNames,
    metaState: state.playlistMeta,
    autoplayState: state.playlistAutoplay,
    dspState: state.playlistDsp,
    dapState: state.dapConfig,
  });

  applyTrackRelocationUndoSnapshot(action.snapshot);
  renderZones();

  try {
    await _deps.pushSharedLayout();
    clearTrackRelocationUndoAction(actionId);
    setStatus('Действие отменено и синхронизировано.');
    return true;
  } catch (err) {
    console.error(err);
    applyTrackRelocationUndoSnapshot(rollbackSnapshot);
    action.restoring = false;
    if (!state.trackRelocationUndoActions.has(actionId)) {
      state.trackRelocationUndoActions.set(actionId, action);
    }
    renderZones();
    setStatus('Не удалось отменить действие.');
    return false;
  }
}

export function getTrackButtonByContext(fileKey, playbackContext = null) {
  const buttons = state.buttonsByFile.get(fileKey);
  if (!buttons || !buttons.size) return null;

  for (const button of buttons) {
    const card = button.closest('.track-card');
    if (cardMatchesTrackContext(card, playbackContext)) {
      return button;
    }
  }

  return getFirstFromSet(buttons);
}

export function isTrackCardContextActive(card, trackFile, playbackContext) {
  if (!card || !trackFile || !playbackContext) return false;
  if (!cardMatchesTrackContext(card, playbackContext)) return false;
  return card.dataset.file === trackFile;
}

export function isTrackCardDragBlocked(card) {
  if (!(card instanceof HTMLElement)) return false;

  if (
    card.classList.contains('is-playing') ||
    card.classList.contains('is-paused') ||
    card.classList.contains('is-host-playing') ||
    card.classList.contains('is-host-paused') ||
    card.classList.contains('is-dsp-transition-source') ||
    card.classList.contains('is-dsp-transition-target')
  ) {
    return true;
  }

  const cardFile = typeof card.dataset.file === 'string' ? card.dataset.file : '';
  if (!cardFile) return false;

  if (state.currentTrack && typeof state.currentTrack.file === 'string') {
    if (isTrackCardContextActive(card, state.currentTrack.file, state.currentTrack)) {
      return true;
    }
  }

  if (state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string' && state.hostPlaybackState.trackFile.trim()) {
    const hostContext = _deps.normalizeTrackPlaybackContext(state.hostPlaybackState);
    if (isTrackCardContextActive(card, state.hostPlaybackState.trackFile, hostContext)) {
      return true;
    }
  }

  return false;
}

export function applyPlayButtonState(button, isPauseState, { pauseLocked = false } = {}) {
  if (!button) return;
  button.dataset.state = isPauseState ? 'pause' : 'play';
  button.title = isPauseState ? 'Пауза' : 'Воспроизвести';
  button.setAttribute('aria-label', isPauseState ? 'Пауза' : 'Воспроизвести');
  button.classList.toggle('is-pause-locked', Boolean(isPauseState && pauseLocked));
}

export function setButtonPlaying(fileKey, isPlaying, playbackContext = null) {
  const buttons = state.buttonsByFile.get(fileKey);
  const cards = state.cardsByFile.get(fileKey);

  if (buttons) {
    for (const button of buttons) {
      applyPlayButtonState(button, false, { pauseLocked: false });
    }

    if (isPlaying) {
      const targetButton = getTrackButtonByContext(fileKey, playbackContext);
      const isPauseLocked =
        isDapNoSilenceActive() &&
        isDapTrackContext(playbackContext, state.dapConfig);
      applyPlayButtonState(targetButton, true, { pauseLocked: isPauseLocked });
    }
  }

  if (cards) {
    for (const card of cards) {
      card.classList.remove('is-playing');
    }

    if (isPlaying) {
      const targetCard = getTrackCardByContext(fileKey, playbackContext);
      if (targetCard) {
        targetCard.classList.add('is-playing');
        targetCard.classList.remove('is-paused');
      }
    }
  }

  syncPlaylistHeaderActiveState();
}

export function setTrackPaused(fileKey, isPaused, playbackContext = null) {
  const cards = state.cardsByFile.get(fileKey);
  if (!cards) return;

  for (const card of cards) {
    card.classList.remove('is-paused');
  }

  if (!isPaused) return;
  const targetCard = getTrackCardByContext(fileKey, playbackContext);
  if (!targetCard) return;

  targetCard.classList.add('is-paused');
  targetCard.classList.remove('is-playing');
}

export function setTrackPausedByContext(fileKey, isPaused, playbackContext = null) {
  const targetCard = getTrackCardByContext(fileKey, playbackContext);
  if (!targetCard) return;

  if (isPaused) {
    targetCard.classList.add('is-paused');
    targetCard.classList.remove('is-playing');
    return;
  }

  targetCard.classList.remove('is-paused');
}

export function normalizeAudioStartOffsetSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(0, numeric);
}

export async function seekAudioToOffset(audio, offsetSeconds) {
  if (!audio) return;
  const normalizedOffset = normalizeAudioStartOffsetSeconds(offsetSeconds);
  if (normalizedOffset === null) return;

  const applySeek = () => {
    const duration = getDuration(audio);
    let targetTime = normalizedOffset;
    if (duration && duration > 0) {
      targetTime = Math.min(normalizedOffset, Math.max(0, duration - 0.02));
    }
    if (!Number.isFinite(targetTime) || targetTime <= 0) return;
    try {
      audio.currentTime = targetTime;
    } catch (err) {
      // ignore seek failures for unsupported formats/devices
    }
  };

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    applySeek();
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('error', onDone);
      resolve();
    };
    const onMeta = () => finish();
    const onDone = () => finish();
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('error', onDone);
    setTimeout(finish, 700);
  });

  applySeek();
}

export function getDuration(audio) {
  const d = audio ? audio.duration : NaN;
  return Number.isFinite(d) && d > 0 ? d : null;
}

export function trackLiveAudioInstance(audio) {
  if (!(audio instanceof HTMLAudioElement)) return audio;
  state.liveAudioInstances.add(audio);
  const cleanup = () => {
    state.liveAudioInstances.delete(audio);
  };
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  return audio;
}

export function stopUnexpectedLiveAudios(allowedAudios = []) {
  const allowed = new Set(allowedAudios.filter((audio) => audio instanceof HTMLAudioElement));

  for (const audio of Array.from(state.liveAudioInstances)) {
    if (!(audio instanceof HTMLAudioElement)) {
      state.liveAudioInstances.delete(audio);
      continue;
    }
    if (allowed.has(audio)) continue;

    try {
      audio.pause();
    } catch (err) {
      // ignore pause failures while cleaning stale playback nodes
    }
    try {
      audio.currentTime = 0;
    } catch (err) {
      // ignore seek failures for detached/finished nodes
    }
    state.liveAudioInstances.delete(audio);
  }
}

export function updateProgress(fileKey, currentTime, duration) {
  if (!state.currentTrack || state.currentTrack.key !== fileKey) return;

  const safeTime = Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
  const isDapTrackOnHostMain = isHostRole() && isDapTrackContext(state.currentTrack, state.dapConfig);
  if (isDapTrackOnHostMain) {
    _deps.setNowPlayingProgress(0);
    _deps.setNowPlayingTime(null);
  } else {
    const percent = duration ? Math.min(100, (safeTime / duration) * 100) : 0;
    _deps.setNowPlayingProgress(percent);
    const remaining = duration ? Math.max(0, duration - safeTime) : _deps.getCurrentTrackRemainingSeconds();
    _deps.setNowPlayingTime(remaining, { useCeil: true });
  }
  syncDapNowPlayingPanel();
  _deps.refreshTrackDurationLabels(fileKey);
}

export function resetProgress(fileKey) {
  if (state.currentTrack && fileKey && state.currentTrack.key !== fileKey) return;
  _deps.setNowPlayingProgress(0);
}

export function bindProgress(audio, fileKey) {
  const syncDuration = () => {
    const duration = getDuration(audio);
    if (!duration) return;
    _deps.cacheTrackDuration(fileKey, duration);
  };
  const update = () => updateProgress(fileKey, audio.currentTime, getDuration(audio));
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('loadedmetadata', () => {
    syncDuration();
    update();
  });
  audio.addEventListener('seeking', update);
  audio.addEventListener('seeked', update);
  audio.addEventListener('durationchange', () => {
    syncDuration();
    update();
  });
}

export function stopProgressLoop() {
  if (state.progressRaf !== null) {
    cancelAnimationFrame(state.progressRaf);
    state.progressRaf = null;
  }
  state.progressAudio = null;
  syncNowPlayingPanel();
}

export function startProgressLoop(audio, fileKey) {
  stopProgressLoop();
  if (!audio) return;
  state.progressAudio = audio;
  syncNowPlayingPanel();
  const minFrameIntervalMs = _deps.getProgressUiFrameIntervalMs();
  let lastRenderTimestamp = 0;
  updateProgress(fileKey, state.progressAudio.currentTime, getDuration(state.progressAudio));

  const tick = (timestamp) => {
    if (!state.progressAudio || state.progressAudio.paused) return;
    const nowTimestamp = Number.isFinite(timestamp) ? timestamp : performance.now();
    if (
      minFrameIntervalMs > 0 &&
      lastRenderTimestamp > 0 &&
      nowTimestamp - lastRenderTimestamp < minFrameIntervalMs
    ) {
      state.progressRaf = requestAnimationFrame(tick);
      return;
    }
    lastRenderTimestamp = nowTimestamp;
    updateProgress(fileKey, state.progressAudio.currentTime, getDuration(state.progressAudio));
    state.progressRaf = requestAnimationFrame(tick);
  };
  state.progressRaf = requestAnimationFrame(tick);
}

export function buildTrackCard(
  file,
  basePath = '/audio',
  {
    draggable = true,
    orderNumber = null,
    playlistIndex = null,
    playlistPosition = null,
    playlistId = null,
    trackId = null,
    canDelete = false,
  } = {},
) {
  const key = trackKey(file, basePath);
  const card = document.createElement('div');
  card.className = 'track-card';
  card.draggable = draggable;
  card.dataset.file = file;
  card.dataset.basePath = basePath;
  if (Number.isInteger(playlistIndex) && playlistIndex >= 0) {
    card.dataset.playlistIndex = String(playlistIndex);
  }
  if (Number.isInteger(playlistPosition) && playlistPosition >= 0) {
    card.dataset.playlistPosition = String(playlistPosition);
  }
  if (typeof playlistId === 'string' && playlistId.trim()) {
    card.dataset.playlistId = playlistId.trim();
  }
  if (typeof trackId === 'string' && trackId.trim()) {
    card.dataset.trackId = trackId.trim();
  }
  card.dataset.canDelete = canDelete ? '1' : '0';
  if (!canDelete) {
    card.classList.add('is-locked');
  }
  addToMultiMap(state.cardsByFile, key, card);

  const order = document.createElement('span');
  order.className = 'track-order';
  order.textContent = Number.isInteger(orderNumber) && orderNumber > 0 ? String(orderNumber) : '•';
  order.setAttribute('role', 'button');
  order.tabIndex = 0;
  order.title = 'Переключить режим отображения названия трека';
  order.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  order.addEventListener('dragstart', (event) => {
    event.preventDefault();
  });
  order.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleTrackTitleModeForTrack(file, basePath);
  });
  order.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    toggleTrackTitleModeForTrack(file, basePath);
  });

  const name = document.createElement('p');
  name.className = 'track-name';
  name.dataset.file = file;
  name.dataset.basePath = basePath;
  name.textContent = trackDisplayName(file, basePath);
  addToMultiMap(state.trackNameLabelsByFile, key, name);

  const durationLabel = document.createElement('span');
  durationLabel.className = 'track-duration';
  durationLabel.textContent = _deps.getTrackDurationTextByKey(key, { playlistIndex, playlistPosition });
  addToMultiMap(state.durationLabelsByFile, key, durationLabel);

  const playButton = document.createElement('button');
  playButton.className = 'play';
  playButton.dataset.state = 'play';
  playButton.title = 'Воспроизвести';
  playButton.setAttribute('aria-label', 'Воспроизвести');
  playButton.addEventListener('click', async () => {
    if (typeof _deps.requestTrackPlaybackForCurrentRole !== 'function') return;
    try {
      await _deps.requestTrackPlaybackForCurrentRole(file, basePath, {
        playlistId,
        trackId,
        playlistIndex,
        playlistPosition,
      });
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось выполнить playback-команду.');
    }
  });
  addToMultiMap(state.buttonsByFile, key, playButton);

  card.append(order, name, durationLabel, playButton);
  if (draggable) {
    _deps.attachDragHandlers(card);
  }
  return card;
}

export function getTrackButton(file, playlistIndex = null, playlistPosition = null, basePath = '/audio') {
  const key = trackKey(file, basePath);
  const candidates = state.buttonsByFile.get(key);
  if (!candidates || !candidates.size) return null;

  if (Number.isInteger(playlistIndex) && playlistIndex >= 0 && Number.isInteger(playlistPosition) && playlistPosition >= 0) {
    for (const button of candidates) {
      const card = button.closest('.track-card');
      if (!card) continue;
      const cardPlaylistIndex = Number.parseInt(card.dataset.playlistIndex || '', 10);
      const cardPlaylistPosition = Number.parseInt(card.dataset.playlistPosition || '', 10);
      if (cardPlaylistIndex === playlistIndex && cardPlaylistPosition === playlistPosition) {
        return button;
      }
    }
  }

  return getFirstFromSet(candidates);
}

export function resolveSequentialNextTrack(track, { requireAutoplay = false } = {}) {
  if (!track || typeof track.file !== 'string') return null;

  const preferredPlaylistIndex = Number.isInteger(track.playlistIndex) ? track.playlistIndex : -1;
  if (preferredPlaylistIndex < 0 || preferredPlaylistIndex >= state.layout.length) return null;

  if (requireAutoplay && !state.playlistAutoplay[preferredPlaylistIndex]) return null;
  const playlist = Array.isArray(state.layout[preferredPlaylistIndex]) ? state.layout[preferredPlaylistIndex] : [];
  if (!playlist.length) return null;

  let currentIndex = Number.isInteger(track.playlistPosition) ? track.playlistPosition : -1;
  if (currentIndex < 0 || currentIndex >= playlist.length || playlist[currentIndex] !== track.file) {
    currentIndex = playlist.indexOf(track.file);
  }

  if (currentIndex < 0) return null;
  const nextIndex = currentIndex + 1;
  if (nextIndex >= playlist.length) return null;

  const nextFile = playlist[nextIndex];
  if (typeof nextFile !== 'string' || !nextFile) return null;
  const playlistEntry = Array.isArray(state.playlists) ? state.playlists[preferredPlaylistIndex] : null;
  const trackEntry =
    playlistEntry &&
    Array.isArray(playlistEntry.tracks) &&
    nextIndex >= 0 &&
    nextIndex < playlistEntry.tracks.length
      ? playlistEntry.tracks[nextIndex]
      : null;

  return {
    file: nextFile,
    basePath: '/audio',
    playlistId: typeof playlistEntry?.id === 'string' ? playlistEntry.id : null,
    trackId: typeof trackEntry?.id === 'string' ? trackEntry.id : null,
    playlistIndex: preferredPlaylistIndex,
    playlistPosition: nextIndex,
  };
}

export function resolveAutoplayNextTrack(finishedTrack, { consumeScheduledSwitch = false } = {}) {
  const scheduledSwitch = state.playNextScheduledSwitch && typeof state.playNextScheduledSwitch === 'object'
    ? state.playNextScheduledSwitch
    : null;
  if (scheduledSwitch) {
    const toPlaylistIndex = _deps.normalizePlaylistTrackIndex(scheduledSwitch.toPlaylistIndex);
    const afterPlaylistIndex = _deps.normalizePlaylistTrackIndex(scheduledSwitch.afterPlaylistIndex);
    const afterPlaylistPosition = _deps.normalizePlaylistTrackIndex(scheduledSwitch.afterPlaylistPosition);
    const afterTrackFile = typeof scheduledSwitch.afterTrackFile === 'string' ? scheduledSwitch.afterTrackFile.trim() : '';
    const finishedPlaylistIndex = _deps.normalizePlaylistTrackIndex(finishedTrack ? finishedTrack.playlistIndex : null);
    const finishedPlaylistPosition = _deps.normalizePlaylistTrackIndex(finishedTrack ? finishedTrack.playlistPosition : null);
    const finishedTrackFile =
      finishedTrack && typeof finishedTrack.file === 'string' ? finishedTrack.file.trim() : '';

    const isAnchorMatch =
      toPlaylistIndex !== null &&
      afterPlaylistIndex !== null &&
      afterPlaylistPosition !== null &&
      finishedPlaylistIndex === afterPlaylistIndex &&
      finishedPlaylistPosition === afterPlaylistPosition &&
      Boolean(finishedTrackFile) &&
      finishedTrackFile === afterTrackFile;

    if (isAnchorMatch) {
      const targetPlaylist = Array.isArray(state.layout[toPlaylistIndex]) ? state.layout[toPlaylistIndex] : [];
      const nextFile = targetPlaylist[0];
      if (typeof nextFile === 'string' && nextFile.trim()) {
        const playlistEntry = Array.isArray(state.playlists) ? state.playlists[toPlaylistIndex] : null;
        const firstTrack =
          playlistEntry && Array.isArray(playlistEntry.tracks) && playlistEntry.tracks[0]
            ? playlistEntry.tracks[0]
            : null;
        if (consumeScheduledSwitch) {
          state.playNextScheduledSwitch = null;
        }
        return {
          file: nextFile,
          basePath: '/audio',
          playlistId: typeof playlistEntry?.id === 'string' ? playlistEntry.id : null,
          trackId: typeof firstTrack?.id === 'string' ? firstTrack.id : null,
          playlistIndex: toPlaylistIndex,
          playlistPosition: 0,
        };
      }
      state.playNextScheduledSwitch = null;
    } else {
      const isStillValidTarget =
        toPlaylistIndex !== null &&
        toPlaylistIndex >= 0 &&
        toPlaylistIndex < state.layout.length &&
        Array.isArray(state.layout[toPlaylistIndex]) &&
        state.layout[toPlaylistIndex].length > 0;
      const isStillValidAnchor =
        afterPlaylistIndex !== null &&
        afterPlaylistPosition !== null &&
        afterPlaylistIndex >= 0 &&
        afterPlaylistIndex < state.layout.length &&
        Array.isArray(state.layout[afterPlaylistIndex]) &&
        afterPlaylistPosition >= 0 &&
        afterPlaylistPosition < state.layout[afterPlaylistIndex].length;
      if (!isStillValidTarget || !isStillValidAnchor) {
        state.playNextScheduledSwitch = null;
      }
    }
  }

  const directNext = resolveSequentialNextTrack(finishedTrack, { requireAutoplay: true });
  if (directNext) return directNext;

  const dapPlaylistIndex = getDapPlaylistIndex(state.dapConfig);
  if (dapPlaylistIndex === null) return null;
  if (dapPlaylistIndex < 0 || dapPlaylistIndex >= state.layout.length) return null;

  const finishedPlaylistIndex = _deps.normalizePlaylistTrackIndex(finishedTrack ? finishedTrack.playlistIndex : null);
  if (finishedPlaylistIndex !== dapPlaylistIndex) return null;

  const dapPlaylist = Array.isArray(state.layout[dapPlaylistIndex]) ? state.layout[dapPlaylistIndex] : [];
  if (!dapPlaylist.length) return null;

  if (finishedTrack && typeof finishedTrack.file === 'string') {
    let currentIndex = Number.isInteger(finishedTrack.playlistPosition) ? finishedTrack.playlistPosition : -1;
    if (currentIndex < 0 || currentIndex >= dapPlaylist.length || dapPlaylist[currentIndex] !== finishedTrack.file) {
      currentIndex = dapPlaylist.indexOf(finishedTrack.file);
    }
    if (currentIndex >= 0) {
      const wrappedNextIndex = (currentIndex + 1) % dapPlaylist.length;
      const wrappedNextFile = dapPlaylist[wrappedNextIndex];
      if (typeof wrappedNextFile === 'string' && wrappedNextFile) {
        const playlistEntry = Array.isArray(state.playlists) ? state.playlists[dapPlaylistIndex] : null;
        const trackEntry =
          playlistEntry &&
          Array.isArray(playlistEntry.tracks) &&
          wrappedNextIndex >= 0 &&
          wrappedNextIndex < playlistEntry.tracks.length
            ? playlistEntry.tracks[wrappedNextIndex]
            : null;
        return {
          file: wrappedNextFile,
          basePath: '/audio',
          playlistId: typeof playlistEntry?.id === 'string' ? playlistEntry.id : null,
          trackId: typeof trackEntry?.id === 'string' ? trackEntry.id : null,
          playlistIndex: dapPlaylistIndex,
          playlistPosition: wrappedNextIndex,
        };
      }
    }
  }

  const firstDapFile = dapPlaylist[0];
  if (typeof firstDapFile !== 'string' || !firstDapFile) return null;
  const firstDapPlaylistEntry = Array.isArray(state.playlists) ? state.playlists[dapPlaylistIndex] : null;
  const firstDapTrackEntry =
    firstDapPlaylistEntry && Array.isArray(firstDapPlaylistEntry.tracks) && firstDapPlaylistEntry.tracks[0]
      ? firstDapPlaylistEntry.tracks[0]
      : null;
  return {
    file: firstDapFile,
    basePath: '/audio',
    playlistId: typeof firstDapPlaylistEntry?.id === 'string' ? firstDapPlaylistEntry.id : null,
    trackId: typeof firstDapTrackEntry?.id === 'string' ? firstDapTrackEntry.id : null,
    playlistIndex: dapPlaylistIndex,
    playlistPosition: 0,
  };
}
