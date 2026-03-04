import { state, SETTINGS_KEYS, LAYOUT_STORAGE_KEY, LEGACY_LAYOUT_KEY, CLIENT_ID_STORAGE_KEY,
  RUNTIME_LOCAL_OVERRIDE_KEYS, RUNTIME_OVERRIDE_SCOPE_NONE, RUNTIME_OVERRIDE_SCOPE_CLIENT,
  RUNTIME_OVERRIDE_SCOPE_HOST, DEFAULT_RUNTIME_CONFIG_SCHEMA, LAYOUT_STREAM_RETRY_MS,
  PLAYLIST_NAME_MAX_LENGTH, HOST_PLAYBACK_SYNC_INTERVAL_MS, AUDIO_CATALOG_POLL_INTERVAL_MS,
  DAP_NO_SILENCE_GUARD_INTERVAL_MS, QUEUE_NEXT_CHAIN_WINDOW_MS, TRACK_RELOCATE_HIGHLIGHT_MS,
  TOUCH_COPY_HOLD_MS, PLAYLIST_COLLAPSE_HOLD_MS, PLAYLIST_COLLAPSE_POINTER_MOVE_TOLERANCE_PX,
  PLAYLIST_REORDER_HOLD_MS, PLAYLIST_REORDER_POINTER_MOVE_TOLERANCE_PX,
  TOUCH_DRAG_ACTIVATION_DELAY_MS, TOUCH_DRAG_START_MOVE_PX, TOUCH_DRAG_COMMIT_PX,
  TOUCH_NATIVE_DRAG_BLOCK_WINDOW_MS, DESKTOP_TRACK_DRAG_HOLD_MS, DESKTOP_TRACK_DRAG_CANCEL_MOVE_PX,
  TOUCH_DRAG_EDGE_SCROLL_THRESHOLD_PX, TOUCH_DRAG_EDGE_SCROLL_MIN_SPEED_PX_PER_FRAME,
  TOUCH_DRAG_EDGE_SCROLL_MAX_SPEED_PX_PER_FRAME, COLLAPSED_PLAYLIST_TAP_MAX_DURATION_MS,
  COLLAPSED_PLAYLIST_TAP_MOVE_TOLERANCE_PX, COLLAPSED_PLAYLIST_TRIPLE_TAP_WINDOW_MS,
  COLLAPSED_PLAYLIST_TRIPLE_TAP_DISTANCE_PX, COLLAPSED_PLAYLIST_HINT_DURATION_MS,
  NOW_PLAYING_SEEK_DRAG_THRESHOLD_PX, NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS,
  NOW_PLAYING_TOGGLE_ZONE_HALF_WIDTH_PX, NOW_PLAYING_REEL_BASE_SPIN_SECONDS,
  NOW_PLAYING_REEL_FAST_SPIN_SECONDS, NOW_PLAYING_REEL_MAX_SCRUB_SPEED_PX_PER_SEC,
  COHOST_SEEK_COMMAND_INTERVAL_MS, HOST_LIVE_SEEK_SYNC_INTERVAL_MS,
  ZONES_PAN_DRAG_THRESHOLD_PX, ZONES_PAN_TOUCH_GAIN, ZONES_TWO_FINGER_PAN_TOUCH_GAIN,
  ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS, ZONES_PAN_TOUCH_MOMENTUM_STOP_SPEED_PX_PER_MS,
  ZONES_PAN_TOUCH_MOMENTUM_DECAY_PER_FRAME, ZONES_WHEEL_SMOOTH_EASE, ZONES_WHEEL_SMOOTH_MIN_DELTA_PX,
  PLAYLIST_VIRTUALIZATION_MIN_ITEMS, PLAYLIST_VIRTUALIZATION_ROW_HEIGHT_PX,
  PLAYLIST_VIRTUALIZATION_OVERSCAN_ROWS, PLAYLIST_VIRTUALIZATION_FALLBACK_VIEWPORT_PX,
  MOBILE_PROGRESS_UI_MAX_FPS, MOBILE_PROGRESS_UI_MIN_INTERVAL_MS,
  TRACK_TITLE_MODE_FILE, TRACK_TITLE_MODE_ATTRIBUTES,
  PLAYLIST_TYPE_MANUAL, PLAYLIST_TYPE_FOLDER, ROLE_HOST, ROLE_SLAVE, ROLE_COHOST,
  DAP_DEFAULT_VOLUME_PERCENT, DAP_MIN_VOLUME_PERCENT, DAP_MAX_VOLUME_PERCENT, DEFAULT_DAP_CONFIG,
  PLAYBACK_COMMAND_PLAY_TRACK, PLAYBACK_COMMAND_TOGGLE_CURRENT, PLAYBACK_COMMAND_SET_VOLUME,
  PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE, PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED,
  PLAYBACK_COMMAND_SEEK_CURRENT, DEFAULT_LIVE_VOLUME_PRESET_VALUES, DEFAULT_DSP_WINGET_COMMAND,
  LIVE_DSP_POLL_INTERVAL_MS, LIVE_DSP_POLL_TIMEOUT_MS, LIVE_DSP_RENDER_SOURCE,
  LIVE_DSP_HANDOFF_LEAD_SECONDS, DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS,
  DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS, LIVE_DSP_WARMUP_TIMEOUT_MS, LIVE_DSP_WARMUP_MAX_TRACKED,
  LIVE_DSP_CONTINUATION_WARMUP_MAX_TRACKED, DEFAULT_LIVE_VOLUME,
  AUTOPLAY_OVERLAY_TRIGGER_EPSILON_SECONDS, AUTOPLAY_OVERLAY_STATE_IDLE,
  AUTOPLAY_OVERLAY_STATE_PENDING, AUTOPLAY_OVERLAY_STATE_STARTED, AUTOPLAY_OVERLAY_STATE_FAILED,
  HOST_SERVER_HINT, NOW_PLAYING_IDLE_TITLE, HOST_NOW_PLAYING_IDLE_TITLE,
  DAP_NOW_PLAYING_IDLE_TITLE } from './modules/state.js';
import * as api from './modules/api.js';
import { createLayoutStream, closeLayoutStream, scheduleReconnect } from './modules/sse.js';
import { isHostRole, isSlaveRole, isCoHostRole, isRemoteLiveMirrorRole,
  updateDapNowPlayingVisibility, setRoleDeps } from './modules/roles.js';
import { parseBooleanConfigValue, normalizeVolumePresetValues, parseVolumePresetsConfigValue,
  parsePortCandidate, parseDspCompensationMsConfigValue, getDefaultRuntimeConfigSchema,
  sanitizeRuntimeOverrideScope, sanitizeRuntimeConfigSchema, sanitizeRuntimeConfigPayload,
  getRuntimeLocalOverrideScope, canUseRuntimeLocalOverride, readRuntimeLocalOverrides,
  readStoredValueByKeys, setContextMenuBlocked, preventContextMenu,
  applyRuntimeClientConfig, applyRuntimeConfigFromSources, fetchRuntimeConfig,
  clampVolume, normalizeLiveVolumePreset, isVolumePresetMatch, getActiveVolumePresetValue,
  getDapVolumePresetValue, isDapVolumePresetPlaybackActive, formatVolumePresetLabel,
  hasActiveStandardVolumePreset, canDisableVolumePresetsSetting,
  normalizePlaybackSeekRatio, setConfigDeps } from './modules/config.js';
import { trackKey, getOrCreateSet, addToMultiMap, getFirstFromSet } from './modules/utils.js';
import { setAudioDeps, isOverlayEnabled, isStopFadeEnabled, getOverlaySeconds, getStopFadeSeconds,
  getTransitionCurve, applyLiveVolumeToCurrentAudio, setLivePlaybackVolume,
  getEffectiveLiveVolume, getEffectiveLiveVolumeForTrack,
  resetFadeState, fadeOutAndStop, fadeOutAndPause, pauseCurrentPlayback,
  shouldTriggerAutoplayOverlayTransition, maybeTriggerAutoplayOverlayTransition,
  createAudio, applyOverlay, handlePlay } from './modules/audio.js';
import { setStatusDeps, setStatus, announcePlaybackAction, showCollapsedPlaylistsHint,
  hideCollapsedPlaylistsOverlay, showCollapsedPlaylistsOverlay,
  removeCollapsedPlaylistsHint } from './modules/ui/status.js';
import { setSettingsDeps, updateTransitionSettingsUi, initSettings,
  setSidebarOpen, initSidebarToggle } from './modules/ui/settings.js';
import { setAuthDeps, setAuthOverlayVisible, setAuthError, fetchSessionInfo, login,
  normalizeRole, applyRoleUi, updateCurrentUser, ensureAuthorizedUser,
  recoverFromRemoteSessionTermination, normalizeAuthUsersPayload, applyIncomingAuthUsers,
  renderCohostUsers, fetchAuthUsersForHost, updateCoHostRole, disconnectClientSessions,
  stopServer, logoutClient, initServerControls } from './modules/ui/auth.js';
import { setDspDeps, setDspSetupStatus, updateDspSetupUi, parseDspStatusPayload,
  refreshDspStatus, initDspSetupPanel, syncLiveDspNextTrackHighlight,
  syncDspTransitionTrackHighlight } from './modules/ui/dsp.js';
import { setUpdaterDeps, updatePrereleaseSettingUi, showUpdateBlock, resetUpdateUi,
  setUpdateMessage, setUpdateStatus, startShutdownCountdown, checkForUpdates,
  applyUpdate, loadVersion, initUpdater } from './modules/ui/updater.js';
import { setNowPlayingDeps, syncHostNowPlayingPanel, syncDapNowPlayingPanel,
  syncNowPlayingPanelForCoHost, syncNowPlayingPanel, syncHostTrackHighlight,
  updateLiveSeekUi, startHostProgressLoop, stopHostProgressLoop,
  startCoHostProgressLoop, stopCoHostProgressLoop, cleanupNowPlayingSeekInteraction,
  setLiveSeekEnabled, initLiveSeekControls, initNowPlayingControls } from './modules/ui/nowplaying.js';
import { setDapDeps, updateDapSettingsUi, isDapEnabled, isDapTrackContext,
  startDapNoSilenceGuard, stopDapNoSilenceGuard,
  initDapSettingsControls } from './modules/ui/dap.js';
import { setVolumeDeps, rebuildVolumePresetButtons, updateVolumePresetsUi,
  onVolumePresetButtonClick, setShowVolumePresetsEnabled,
  initVolumePresetControls } from './modules/ui/volume.js';
const zonesContainer = document.getElementById('zones');
const statusEl = document.getElementById('status');
const addPlaylistBtn = document.getElementById('addPlaylist');
const refreshPlaylistsBtn = document.getElementById('refreshPlaylists');
const resetPlaylistsBtn = document.getElementById('resetPlaylists');
const touchFullscreenToggleBtn = document.getElementById('touchFullscreenToggle');
const overlayTimeInput = document.getElementById('overlayTime');
const overlayCurveSelect = document.getElementById('overlayCurve');
const stopFadeInput = document.getElementById('stopFadeTime');
const overlayEnabledToggle = document.getElementById('overlayEnabled');
const stopFadeEnabledToggle = document.getElementById('stopFadeEnabled');
const showVolumePresetsToggle = document.getElementById('showVolumePresets');
const showVolumePresetsToggleRow = showVolumePresetsToggle
  ? showVolumePresetsToggle.closest('.settings-toggle-row')
  : null;
const liveSeekEnabledToggle = document.getElementById('liveSeekEnabled');
const liveSeekToggleRow = liveSeekEnabledToggle ? liveSeekEnabledToggle.closest('.settings-toggle-row') : null;
const dapSettingsPanelEl = document.getElementById('dapSettingsPanel');
const dapEnabledToggle = document.getElementById('dapEnabled');
const dapPlaylistSelect = document.getElementById('dapPlaylistSelect');
const dapVolumePercentInput = document.getElementById('dapVolumePercent');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const serverPanelEl = document.getElementById('serverPanel');
const clientSessionPanelEl = document.getElementById('clientSessionPanel');
const cohostPanelEl = document.getElementById('cohostPanel');
const cohostUsersEl = document.getElementById('cohostUsers');
const stopServerBtn = document.getElementById('stopServer');
const clientLogoutBtn = document.getElementById('clientLogout');
const serverActionsHintEl = document.querySelector('.server-actions__hint');
const appVersionEl = document.getElementById('appVersion');
const updateInfoEl = document.getElementById('updateInfo');
const updateMessageEl = document.getElementById('updateMessage');
const updateButton = document.getElementById('updateButton');
const updateStatusEl = document.getElementById('updateStatus');
const allowPrereleaseInput = document.getElementById('allowPrerelease');
const allowPrereleaseRow = allowPrereleaseInput ? allowPrereleaseInput.closest('.update-settings') : null;
const dspSetupPanelEl = document.getElementById('dspSetupPanel');
const dspInstallCommandEl = document.getElementById('dspInstallCommand');
const dspCopyInstallCommandBtn = document.getElementById('dspCopyInstallCommand');
const dspCheckInstallBtn = document.getElementById('dspCheckInstall');
const dspSetupStatusEl = document.getElementById('dspSetupStatus');
const authOverlay = document.getElementById('authOverlay');
const authForm = document.getElementById('authForm');
const authUsernameInput = document.getElementById('authUsername');
const authPasswordInput = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authError = document.getElementById('authError');
const nowPlayingTitleEl = document.getElementById('nowPlayingTitle');
const nowPlayingControlBtn = document.getElementById('nowPlayingControl');
const nowPlayingControlLabelEl = document.getElementById('nowPlayingControlLabel');
const nowPlayingProgressEl = document.getElementById('nowPlayingProgress');
const nowPlayingTimeEl = document.getElementById('nowPlayingTime');
const nowPlayingReelEl = document.getElementById('nowPlayingReel');
const nowPlayingGridEl = document.querySelector('.now-playing-grid');
const localVolumePresetsEl = document.getElementById('localVolumePresets');
let localVolumePresetButtons = localVolumePresetsEl
  ? Array.from(localVolumePresetsEl.querySelectorAll('.volume-presets__button'))
  : [];
const hostNowPlayingTitleEl = document.getElementById('hostNowPlayingTitle');
const hostNowPlayingControlEl = document.getElementById('hostNowPlayingControl');
const hostNowPlayingControlLabelEl = document.getElementById('hostNowPlayingControlLabel');
const hostNowPlayingProgressEl = document.getElementById('hostNowPlayingProgress');
const hostNowPlayingTimeEl = document.getElementById('hostNowPlayingTime');
const hostNowPlayingReelEl = document.getElementById('hostNowPlayingReel');
const dapNowPlayingEl = document.getElementById('dapNowPlaying');
const dapNowPlayingTitleEl = document.getElementById('dapNowPlayingTitle');
const dapNowPlayingControlEl = document.getElementById('dapNowPlayingControl');
const dapNowPlayingControlLabelEl = document.getElementById('dapNowPlayingControlLabel');
const dapNowPlayingProgressEl = document.getElementById('dapNowPlayingProgress');
const dapNowPlayingTimeEl = document.getElementById('dapNowPlayingTime');
const dapNowPlayingReelEl = document.getElementById('dapNowPlayingReel');


const clientId = getClientId();

) {
  let normalized = Boolean(enabled);
  if (!normalized && !canDisableVolumePresetsSetting()) {
    normalized = true;
  }
  const changed = normalized !== state.showVolumePresetsEnabled;
  state.showVolumePresetsEnabled = normalized;

  if (showVolumePresetsToggle) {
    showVolumePresetsToggle.checked = normalized;
  }

  if (persist) {
    saveSetting(SETTINGS_KEYS.showVolumePresets, normalized ? 'true' : 'false');
  }

  updateVolumePresetsUi();

  if (sync && changed && isHostRole()) {
    requestHostPlaybackSync(true);
  }

  if (announce) {
    setStatus(normalized ? 'Пресеты громкости включены.' : 'Пресеты громкости выключены.');
  }

  return changed;
}

function getPlaylistDisplayLabel(playlistIndex) {
  const safeIndex = Number.isInteger(playlistIndex) && playlistIndex >= 0 ? playlistIndex : 0;
  return sanitizePlaylistName(state.playlistNames[safeIndex], safeIndex);
}

async function copyTextToClipboard(text) {
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

) {
  const normalized = Boolean(enabled);
  const changed = normalized !== state.liveSeekEnabled;
  state.liveSeekEnabled = normalized;

  if (!normalized && state.nowPlayingSeekActive) {
    cleanupNowPlayingSeekInteraction();
  }

  if (!normalized) {
    clearQueuedCoHostSeekCommands();
  }

  if (persist) {
    saveSetting(SETTINGS_KEYS.liveSeekEnabled, normalized ? 'true' : 'false');
  }

  updateLiveSeekUi();

  if (sync && changed && isHostRole()) {
    requestHostPlaybackSync(true);
  }

  if (announce) {
    setStatus(normalized ? 'Live seek включен.' : 'Live seek выключен.');
  }

  return changed;
}

function cloneLayoutState(layoutState) {
  return ensurePlaylists(layoutState).map((playlist) => playlist.slice());
}

function clonePlaylistMetaState(metaState, lengthHint = null) {
  const expectedLength =
    Number.isInteger(lengthHint) && lengthHint >= 0
      ? lengthHint
      : Array.isArray(metaState)
        ? metaState.length
        : ensurePlaylists(state.layout).length;
  return normalizePlaylistMeta(metaState, expectedLength).map((meta) => ({ ...meta }));
}

function defaultPlaylistMeta() {
  return { type: PLAYLIST_TYPE_MANUAL };
}

function sanitizeFolderKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (!normalized) return null;
  return normalized;
}

function sanitizeFolderOriginalName(value, fallback = '') {
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

function normalizePlaylistMeta(meta, expectedLength) {
  const result = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const rawValue = Array.isArray(meta) ? meta[index] : null;
    result.push(sanitizePlaylistMetaEntry(rawValue));
  }

  return result;
}

function serializePlaylistMeta(meta, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizePlaylistMeta(meta, expectedLength));
}

function playlistMetaEqual(left, right, expectedLength) {
  return serializePlaylistMeta(left, expectedLength) === serializePlaylistMeta(right, expectedLength);
}

function getPlaylistMetaEntry(playlistIndex) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return defaultPlaylistMeta();
  const normalized = normalizePlaylistMeta(state.playlistMeta, ensurePlaylists(state.layout).length);
  return normalized[playlistIndex] || defaultPlaylistMeta();
}

function isFolderPlaylistIndex(playlistIndex) {
  return getPlaylistMetaEntry(playlistIndex).type === PLAYLIST_TYPE_FOLDER;
}

function normalizeAudioFolderTemplates(rawFolders, files) {
  const allowedFiles = new Set(Array.isArray(files) ? files : []);
  const result = [];

  if (!Array.isArray(rawFolders)) return result;

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
    result.push({ key: folderKey, name: folderName || folderNameFallback, files: folderFiles });
  });

  result.sort((left, right) => left.key.localeCompare(right.key, 'ru'));
  return result;
}

function getManualPlaylistIndex(metaState, layoutState) {
  const normalizedLayout = ensurePlaylists(layoutState);
  const normalizedMeta = normalizePlaylistMeta(metaState, normalizedLayout.length);
  const existingIndex = normalizedMeta.findIndex((meta) => meta.type !== PLAYLIST_TYPE_FOLDER);
  if (existingIndex >= 0) return existingIndex;
  return -1;
}

function buildFileOccurrenceMap(layoutState) {
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

function ensureFolderPlaylistsCoverage(layoutState, namesState, metaState) {
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

function isCopyDragModifier(event) {
  return Boolean(event && (event.ctrlKey || event.metaKey));
}

function getZoneIndexFromElement(element) {
  if (!(element instanceof Element)) return null;
  const zone = element.closest('.zone');
  if (!zone) return null;
  const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
  if (!Number.isInteger(zoneIndex) || zoneIndex < 0) return null;
  return zoneIndex;
}

function capturePlaylistBodyScrollTops(playlistIndices = []) {
  const captured = new Map();
  if (!zonesContainer) return captured;

  const uniqueIndices = new Set();
  playlistIndices.forEach((playlistIndex) => {
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return;
    uniqueIndices.add(playlistIndex);
  });

  uniqueIndices.forEach((playlistIndex) => {
    const body = zonesContainer.querySelector(`.zone[data-zone-index="${playlistIndex}"] .zone-body`);
    if (!(body instanceof HTMLElement)) return;
    captured.set(playlistIndex, body.scrollTop);
  });

  return captured;
}

function restorePlaylistBodyScrollTops(scrollTopsByPlaylist) {
  if (!zonesContainer) return;
  if (!(scrollTopsByPlaylist instanceof Map) || !scrollTopsByPlaylist.size) return;

  scrollTopsByPlaylist.forEach((scrollTop, playlistIndex) => {
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return;
    if (!Number.isFinite(scrollTop)) return;
    const body = zonesContainer.querySelector(`.zone[data-zone-index="${playlistIndex}"] .zone-body`);
    if (!(body instanceof HTMLElement)) return;
    body.scrollTop = scrollTop;
  });
}

function resolveRequestedCopyMode(event) {
  if (state.touchCopyDragActive) {
    return state.touchDragMode === 'copy';
  }
  return isCopyDragModifier(event);
}

function resolveEffectiveDragMode(event, targetZoneIndex = null) {
  const requestedCopy = resolveRequestedCopyMode(event);
  if (!state.touchCopyDragActive) {
    return requestedCopy ? 'copy' : 'move';
  }

  if (!state.dragContext || state.dragContext.sourcePlaylistType !== PLAYLIST_TYPE_FOLDER) {
    return requestedCopy ? 'copy' : 'move';
  }

  const sourceZoneIndex = Number.isInteger(state.dragContext.sourceZoneIndex) ? state.dragContext.sourceZoneIndex : -1;
  const hasTargetZone = Number.isInteger(targetZoneIndex) && targetZoneIndex >= 0;
  const isSameZone = hasTargetZone && sourceZoneIndex >= 0 && sourceZoneIndex === targetZoneIndex;

  if (isSameZone) {
    return requestedCopy ? 'copy' : 'move';
  }

  return 'copy';
}

function setDropEffectFromEvent(event, targetZoneIndex = null) {
  if (!event || !event.dataTransfer) return;
  const mode = resolveEffectiveDragMode(event, targetZoneIndex);
  event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
}

function normalizeDragMode(mode) {
  if (mode === 'copy' || mode === 'cancel' || mode === 'delete' || mode === 'next') return mode;
  return 'move';
}

function applyDragModeBadgeToElement(element, mode) {
  if (!(element instanceof HTMLElement)) return;
  const normalizedMode = normalizeDragMode(mode);
  element.dataset.dragMode = normalizedMode;
  element.classList.add('has-drag-mode');
}

function clearDragModeBadgeFromElement(element) {
  if (!(element instanceof HTMLElement)) return;
  element.classList.remove('has-drag-mode');
  delete element.dataset.dragMode;
}

function applyDragModeBadge(mode) {
  const normalizedMode = normalizeDragMode(mode);
  applyDragModeBadgeToElement(state.draggingCard, normalizedMode);
  applyDragModeBadgeToElement(state.dragPreviewCard, normalizedMode);
  applyDragModeBadgeToElement(state.desktopDragGhost, normalizedMode);
}

function clearDragModeBadge() {
  clearDragModeBadgeFromElement(state.draggingCard);
  clearDragModeBadgeFromElement(state.dragPreviewCard);
  clearDragModeBadgeFromElement(state.desktopDragGhost);
}

function isActiveCopyDrag(event, targetZoneIndex = null) {
  return resolveEffectiveDragMode(event, targetZoneIndex) === 'copy';
}

function clearDragPreviewCard() {
  if (!state.dragPreviewCard) return;
  state.dragPreviewCard.remove();
  state.dragPreviewCard = null;
}

function ensureDragPreviewCard() {
  if (state.dragPreviewCard) return state.dragPreviewCard;
  if (!state.draggingCard) return null;

  const preview = state.draggingCard.cloneNode(true);
  preview.classList.add('drag-copy-preview');
  preview.classList.remove('dragging');
  preview.removeAttribute('draggable');
  const playButton = preview.querySelector('button.play');
  if (playButton) playButton.disabled = true;
  state.dragPreviewCard = preview;
  if (state.draggingCard.classList.contains('has-drag-mode')) {
    applyDragModeBadgeToElement(state.dragPreviewCard, state.draggingCard.dataset.dragMode || 'move');
  }
  return state.dragPreviewCard;
}

function getEmptyDragImage() {
  if (state.emptyDragImage) return state.emptyDragImage;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  state.emptyDragImage = canvas;
  return state.emptyDragImage;
}

function clearDesktopDragGhost() {
  if (!state.desktopDragGhost) return;
  state.desktopDragGhost.remove();
  state.desktopDragGhost = null;
}

function updateDesktopDragGhostPosition(clientX, clientY) {
  if (!state.desktopDragGhost) return;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  state.desktopDragGhost.style.transform = `translate(${clientX - state.desktopDragGhostOffsetX}px, ${clientY - state.desktopDragGhostOffsetY}px)`;
}

function createDesktopDragGhost(card, clientX, clientY) {
  clearDesktopDragGhost();
  if (!card || !card.isConnected) return;

  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('desktop-drag-ghost');
  ghost.classList.remove('dragging');
  ghost.removeAttribute('draggable');

  const playButton = ghost.querySelector('button.play');
  if (playButton) playButton.disabled = true;

  ghost.style.width = `${rect.width}px`;
  state.desktopDragGhost = ghost;
  document.body.appendChild(ghost);

  if (state.draggingCard && state.draggingCard.classList.contains('has-drag-mode')) {
    applyDragModeBadgeToElement(state.desktopDragGhost, state.draggingCard.dataset.dragMode || 'move');
  }

  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    state.desktopDragGhostOffsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    state.desktopDragGhostOffsetY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    updateDesktopDragGhostPosition(clientX, clientY);
  } else {
    state.desktopDragGhostOffsetX = rect.width / 2;
    state.desktopDragGhostOffsetY = rect.height / 2;
  }
}

function ensureTrashDropzone() {
  if (state.trashDropzoneEl) return state.trashDropzoneEl;

  const trash = document.createElement('div');
  trash.className = 'drag-trash';
  trash.setAttribute('aria-label', 'Удалить трек');
  trash.innerHTML = '<span class="drag-trash__icon">🗑</span><span class="drag-trash__label">Удалить</span>';
  document.body.appendChild(trash);

  trash.addEventListener('dragover', (event) => {
    if (!state.draggingCard || !state.dragContext) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    trash.classList.add('is-active');
    applyDragModeBadge('delete');
    updateDesktopDragGhostPosition(event.clientX, event.clientY);
  });

  trash.addEventListener('dragleave', () => {
    trash.classList.remove('is-active');
  });

  trash.addEventListener('drop', (event) => {
    if (!state.draggingCard || !state.dragContext) return;
    event.preventDefault();
    event.stopPropagation();
    trash.classList.remove('is-active');
    handleDragDeleteFromContext().catch((err) => {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось удалить трек.');
    });
  });

  state.trashDropzoneEl = trash;
  return state.trashDropzoneEl;
}

function showTrashDropzone() {
  const trash = ensureTrashDropzone();
  trash.classList.add('is-visible');
  syncQueueNextDropzoneVisibility();
}

function hideTrashDropzone() {
  if (state.trashDropzoneEl) {
    state.trashDropzoneEl.classList.remove('is-visible', 'is-active');
  }
  stopQueueNextDropzoneCountdownLoop();
  if (state.queueNextDropzoneEl) {
    state.queueNextDropzoneEl.classList.remove('is-visible', 'is-active', 'has-timer');
    const timerEl = state.queueNextDropzoneEl.querySelector('.drag-next__timer');
    if (timerEl instanceof HTMLElement) {
      timerEl.textContent = '';
    }
  }
}

function isTrashDropzoneTarget(target) {
  if (!state.trashDropzoneEl || !(target instanceof Element)) return false;
  return state.trashDropzoneEl.contains(target);
}

function isPointOverTrashDropzone(clientX, clientY) {
  if (!state.trashDropzoneEl || !state.trashDropzoneEl.classList.contains('is-visible')) return false;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const rect = state.trashDropzoneEl.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function resolveQueueNextPlaybackAnchor() {
  const localTrackFile = state.currentTrack && typeof state.currentTrack.file === 'string' ? state.currentTrack.file.trim() : '';
  if (localTrackFile && state.currentAudio && !state.currentAudio.paused) {
    return {
      file: localTrackFile,
      playlistIndex: normalizePlaylistTrackIndex(state.currentTrack.playlistIndex),
      playlistPosition: normalizePlaylistTrackIndex(state.currentTrack.playlistPosition),
    };
  }

  if (!isRemoteLiveMirrorRole()) return null;
  const hostTrackFile = state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string'
    ? state.hostPlaybackState.trackFile.trim()
    : '';
  if (!hostTrackFile || state.hostPlaybackState.paused) return null;

  return {
    file: hostTrackFile,
    playlistIndex: normalizePlaylistTrackIndex(state.hostPlaybackState.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(state.hostPlaybackState.playlistPosition),
  };
}

function clearQueueNextChainAnchor() {
  state.queueNextChainAnchor = null;
  state.queueNextChainExpiresAt = 0;
}

function getQueueNextChainRemainingMs() {
  if (!state.queueNextChainAnchor || !Number.isFinite(state.queueNextChainExpiresAt) || state.queueNextChainExpiresAt <= 0) {
    return 0;
  }

  const remainingMs = state.queueNextChainExpiresAt - Date.now();
  if (remainingMs > 0) {
    return remainingMs;
  }

  clearQueueNextChainAnchor();
  return 0;
}

function setQueueNextChainAnchor(trackContext) {
  if (!trackContext || typeof trackContext.file !== 'string' || !trackContext.file.trim()) {
    clearQueueNextChainAnchor();
    return;
  }

  state.queueNextChainAnchor = {
    file: trackContext.file.trim(),
    playlistIndex: normalizePlaylistTrackIndex(trackContext.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(trackContext.playlistPosition),
  };
  state.queueNextChainExpiresAt = Date.now() + QUEUE_NEXT_CHAIN_WINDOW_MS;
}

function resolveQueueNextInsertTargetFromAnchor(anchor, layoutState = state.layout) {
  if (!anchor || typeof anchor.file !== 'string' || !anchor.file.trim()) return null;

  const normalizedLayout = ensurePlaylists(layoutState);
  const resolution = resolveTrackIndexByContext(normalizedLayout, {
    sourceZoneIndex: normalizePlaylistTrackIndex(anchor.playlistIndex),
    sourceIndex: normalizePlaylistTrackIndex(anchor.playlistPosition),
    file: anchor.file.trim(),
  });
  if (resolution.playlistIndex < 0 || resolution.trackIndex < 0) return null;

  const playlist = Array.isArray(normalizedLayout[resolution.playlistIndex])
    ? normalizedLayout[resolution.playlistIndex]
    : [];
  const insertIndex = Math.max(0, Math.min(resolution.trackIndex + 1, playlist.length));
  return {
    playlistIndex: resolution.playlistIndex,
    insertIndex,
  };
}

function resolveQueueNextChainInsertTarget(layoutState = state.layout) {
  if (!state.queueNextChainAnchor || !Number.isFinite(state.queueNextChainExpiresAt) || state.queueNextChainExpiresAt <= 0) {
    return null;
  }
  if (Date.now() > state.queueNextChainExpiresAt) {
    clearQueueNextChainAnchor();
    return null;
  }

  const target = resolveQueueNextInsertTargetFromAnchor(state.queueNextChainAnchor, layoutState);
  if (!target) {
    clearQueueNextChainAnchor();
    return null;
  }

  state.queueNextChainAnchor.playlistIndex = target.playlistIndex;
  state.queueNextChainAnchor.playlistPosition = Math.max(0, target.insertIndex - 1);
  return target;
}

function resolveQueueNextInsertTarget(layoutState = state.layout) {
  const playbackAnchor = resolveQueueNextPlaybackAnchor();
  if (!playbackAnchor || !playbackAnchor.file) {
    clearQueueNextChainAnchor();
    return null;
  }

  const chainedTarget = resolveQueueNextChainInsertTarget(layoutState);
  if (chainedTarget) return chainedTarget;
  return resolveQueueNextInsertTargetFromAnchor(playbackAnchor, layoutState);
}

function ensureQueueNextDropzone() {
  if (state.queueNextDropzoneEl) return state.queueNextDropzoneEl;

  const dropzone = document.createElement('div');
  dropzone.className = 'drag-next';
  dropzone.setAttribute('aria-label', 'Поставить следующим');
  dropzone.innerHTML =
    '<span class="drag-next__icon">↪</span><span class="drag-next__label">воспроизвести следующим</span><span class="drag-next__timer"></span>';
  document.body.appendChild(dropzone);

  dropzone.addEventListener('dragover', (event) => {
    if (!state.draggingCard || !state.dragContext) return;
    const queueTarget = resolveQueueNextInsertTarget(state.layout);
    if (!queueTarget) return;
    event.preventDefault();
    const mode = resolveEffectiveDragMode(event, queueTarget.playlistIndex);
    event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
    dropzone.classList.add('is-active');
    applyDragModeBadge('next');
    updateDesktopDragGhostPosition(event.clientX, event.clientY);
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('is-active');
  });

  dropzone.addEventListener('drop', (event) => {
    if (!state.draggingCard || !state.dragContext) return;
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove('is-active');
    handleDragQueueNextFromContext(event).catch((err) => {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось поставить трек следующим.');
    });
  });

  state.queueNextDropzoneEl = dropzone;
  return state.queueNextDropzoneEl;
}

function updateQueueNextDropzoneCountdownUi() {
  if (!state.queueNextDropzoneEl) return;
  const labelEl = state.queueNextDropzoneEl.querySelector('.drag-next__label');
  const timerEl = state.queueNextDropzoneEl.querySelector('.drag-next__timer');
  if (!(timerEl instanceof HTMLElement)) return;

  const remainingMs = getQueueNextChainRemainingMs();
  if (remainingMs <= 0) {
    state.queueNextDropzoneEl.classList.remove('has-timer');
    timerEl.textContent = '';
    if (labelEl instanceof HTMLElement) {
      labelEl.textContent = 'воспроизвести следующим';
    }
    return;
  }

  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  state.queueNextDropzoneEl.classList.add('has-timer');
  if (labelEl instanceof HTMLElement) {
    labelEl.textContent = 'Добавить в стек';
  }
  timerEl.textContent = `${remainingSeconds}s`;
}

function stopQueueNextDropzoneCountdownLoop() {
  if (state.queueNextCountdownTimer === null) return;
  clearInterval(state.queueNextCountdownTimer);
  state.queueNextCountdownTimer = null;
}

function startQueueNextDropzoneCountdownLoop() {
  if (state.queueNextCountdownTimer !== null) return;
  updateQueueNextDropzoneCountdownUi();
  state.queueNextCountdownTimer = setInterval(() => {
    if (!state.queueNextDropzoneEl || !state.queueNextDropzoneEl.classList.contains('is-visible')) {
      stopQueueNextDropzoneCountdownLoop();
      return;
    }
    updateQueueNextDropzoneCountdownUi();
  }, 200);
}

function syncQueueNextDropzoneVisibility() {
  const dragActive = Boolean(state.draggingCard && state.dragContext);
  if (!dragActive && !state.queueNextDropzoneEl) return;
  const dropzone = ensureQueueNextDropzone();
  const shouldShow = dragActive && Boolean(resolveQueueNextInsertTarget(state.layout));
  if (shouldShow) {
    dropzone.classList.add('is-visible');
    updateQueueNextDropzoneCountdownUi();
    if (dropzone.classList.contains('has-timer')) {
      startQueueNextDropzoneCountdownLoop();
    } else {
      stopQueueNextDropzoneCountdownLoop();
    }
    return;
  }
  stopQueueNextDropzoneCountdownLoop();
  dropzone.classList.remove('is-visible', 'is-active', 'has-timer');
  const timerEl = dropzone.querySelector('.drag-next__timer');
  if (timerEl instanceof HTMLElement) {
    timerEl.textContent = '';
  }
}

function isQueueNextDropzoneTarget(target) {
  if (!state.queueNextDropzoneEl || !(target instanceof Element)) return false;
  return state.queueNextDropzoneEl.contains(target);
}

function isPointOverQueueNextDropzone(clientX, clientY) {
  if (!state.queueNextDropzoneEl || !state.queueNextDropzoneEl.classList.contains('is-visible')) return false;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const rect = state.queueNextDropzoneEl.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function handleGlobalDragOver(event) {
  if (!state.draggingCard || !event.dataTransfer) return;
  updateDesktopDragGhostPosition(event.clientX, event.clientY);
  const target = event.target instanceof Element ? event.target : null;
  if (isQueueNextDropzoneTarget(target)) {
    const queueTarget = resolveQueueNextInsertTarget(state.layout);
    if (queueTarget) {
      const mode = resolveEffectiveDragMode(event, queueTarget.playlistIndex);
      applyDragModeBadge('next');
      event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
      return;
    }
  }
  if (isTrashDropzoneTarget(target)) {
    applyDragModeBadge('delete');
    event.dataTransfer.dropEffect = 'move';
    return;
  }
  if (target && zonesContainer.contains(target)) {
    const targetZoneIndex = getZoneIndexFromElement(target);
    const mode = resolveEffectiveDragMode(event, targetZoneIndex);
    applyDragModeBadge(mode);
    event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
    return;
  }
  applyDragModeBadge('cancel');
  event.dataTransfer.dropEffect = 'none';
}

function isTouchPointerEvent(event) {
  if (!event) return false;
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function isLikelyTouchNativeDragEvent(event) {
  if (!event) return false;
  if (event.sourceCapabilities && event.sourceCapabilities.firesTouchEvents) {
    return true;
  }
  return Date.now() - state.lastTouchPointerDownAt < TOUCH_NATIVE_DRAG_BLOCK_WINDOW_MS;
}

function removeDesktopDragHoldListeners() {
  window.removeEventListener('pointermove', onDesktopDragHoldPointerMove, true);
  window.removeEventListener('pointerup', onDesktopDragHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onDesktopDragHoldPointerEnd, true);
}

function clearDesktopDragHold() {
  if (state.desktopDragHoldTimer !== null) {
    clearTimeout(state.desktopDragHoldTimer);
    state.desktopDragHoldTimer = null;
  }
  state.desktopDragHoldPointerId = null;
  state.desktopDragHoldStartedAt = 0;
  state.desktopDragHoldStartX = 0;
  state.desktopDragHoldStartY = 0;
  state.desktopDragHoldCard = null;
  state.desktopDragHoldReady = false;
  removeDesktopDragHoldListeners();
}

function onDesktopDragHoldPointerMove(event) {
  if (state.desktopDragHoldPointerId === null || event.pointerId !== state.desktopDragHoldPointerId) return;
  if (state.desktopDragHoldReady) return;

  const deltaX = event.clientX - state.desktopDragHoldStartX;
  const deltaY = event.clientY - state.desktopDragHoldStartY;
  if (Math.hypot(deltaX, deltaY) <= DESKTOP_TRACK_DRAG_CANCEL_MOVE_PX) return;

  clearDesktopDragHold();
}

function onDesktopDragHoldPointerEnd(event) {
  if (state.desktopDragHoldPointerId === null || event.pointerId !== state.desktopDragHoldPointerId) return;
  clearDesktopDragHold();
}

function startDesktopDragHold(card, event) {
  if (!card || !event) return;
  clearDesktopDragHold();

  state.desktopDragHoldPointerId = Number.isInteger(event.pointerId) ? event.pointerId : null;
  state.desktopDragHoldStartedAt = Date.now();
  state.desktopDragHoldStartX = event.clientX;
  state.desktopDragHoldStartY = event.clientY;
  state.desktopDragHoldCard = card;
  state.desktopDragHoldReady = false;

  if (state.desktopDragHoldPointerId !== null) {
    window.addEventListener('pointermove', onDesktopDragHoldPointerMove, true);
    window.addEventListener('pointerup', onDesktopDragHoldPointerEnd, true);
    window.addEventListener('pointercancel', onDesktopDragHoldPointerEnd, true);
  }

  state.desktopDragHoldTimer = setTimeout(() => {
    state.desktopDragHoldTimer = null;
    if (!state.desktopDragHoldCard || !state.desktopDragHoldCard.isConnected) {
      clearDesktopDragHold();
      return;
    }
    state.desktopDragHoldReady = true;
  }, DESKTOP_TRACK_DRAG_HOLD_MS);
}

function isDesktopDragHoldReadyForPointer(pointerId) {
  return (
    state.desktopDragHoldReady &&
    state.desktopDragHoldPointerId !== null &&
    pointerId === state.desktopDragHoldPointerId &&
    !!state.desktopDragHoldCard
  );
}

function isDesktopDragHoldReadyForCard(card) {
  if (!card || state.desktopDragHoldCard !== card) return false;
  if (state.desktopDragHoldReady) return true;
  if (!state.desktopDragHoldStartedAt) return false;
  return Date.now() - state.desktopDragHoldStartedAt >= DESKTOP_TRACK_DRAG_HOLD_MS;
}

function removeTouchHoldListeners() {
  window.removeEventListener('pointermove', onTouchHoldPointerMove, true);
  window.removeEventListener('pointerup', onTouchHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onTouchHoldPointerEnd, true);
}

function clearTouchCopyHold() {
  const holdCard = state.touchHoldCard;
  if (holdCard) {
    holdCard.classList.remove('touch-hold-copy');
  }
  if (holdCard && state.touchHoldPointerId !== null && typeof holdCard.releasePointerCapture === 'function') {
    try {
      if (holdCard.hasPointerCapture && holdCard.hasPointerCapture(state.touchHoldPointerId)) {
        holdCard.releasePointerCapture(state.touchHoldPointerId);
      }
    } catch (err) {
      // ignore pointer capture release errors from browsers that do not fully support it
    }
  }

  if (state.touchHoldTimer !== null) {
    clearTimeout(state.touchHoldTimer);
    state.touchHoldTimer = null;
  }
  state.touchHoldPointerId = null;
  state.touchHoldStartedAt = 0;
  state.touchHoldCard = null;
  removeTouchHoldListeners();
}

function onTouchHoldPointerMove(event) {
  if (state.touchHoldPointerId === null || event.pointerId !== state.touchHoldPointerId) return;
  const deltaX = event.clientX - state.touchHoldStartX;
  const deltaY = event.clientY - state.touchHoldStartY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= TOUCH_DRAG_START_MOVE_PX) return;

  const elapsed = Date.now() - state.touchHoldStartedAt;
  if (elapsed < TOUCH_DRAG_ACTIVATION_DELAY_MS) {
    // Treat early movement as a regular scroll gesture, not as drag.
    clearTouchCopyHold();
    return;
  }

  const heldCard = state.touchHoldCard;
  const pointerId = state.touchHoldPointerId;
  clearTouchCopyHold();
  if (!heldCard || pointerId === null) return;
  event.preventDefault();
  startTouchCopyDrag(heldCard, pointerId, event.clientX, event.clientY, {
    mode: 'move',
    moved: true,
  });
  updateTouchCopyDragPreview(event.clientX, event.clientY);
}

function onTouchHoldPointerEnd(event) {
  if (state.touchHoldPointerId === null || event.pointerId !== state.touchHoldPointerId) return;
  clearTouchCopyHold();
}

function updateTouchCopyGhostPosition(clientX, clientY) {
  if (!state.touchCopyDragGhost) return;
  const offsetX = 16;
  const offsetY = 16;
  state.touchCopyDragGhost.style.transform = `translate(${clientX + offsetX}px, ${clientY + offsetY}px)`;
}

function stopTouchCopyDragEdgeAutoScroll() {
  if (state.touchCopyDragEdgeScrollRaf !== null) {
    cancelAnimationFrame(state.touchCopyDragEdgeScrollRaf);
    state.touchCopyDragEdgeScrollRaf = null;
  }
  state.touchCopyDragEdgeScrollVelocity = 0;
}

function resolveTouchCopyDragEdgeScrollVelocity(clientX) {
  if (!Number.isFinite(clientX)) return 0;
  const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
  if (viewportWidth <= 0) return 0;
  const threshold = Math.max(0, Math.min(TOUCH_DRAG_EDGE_SCROLL_THRESHOLD_PX, viewportWidth / 2));
  if (threshold <= 0) return 0;

  let direction = 0;
  let edgeRatio = 0;
  if (clientX <= threshold) {
    direction = -1;
    edgeRatio = (threshold - clientX) / threshold;
  } else if (clientX >= viewportWidth - threshold) {
    direction = 1;
    edgeRatio = (clientX - (viewportWidth - threshold)) / threshold;
  } else {
    return 0;
  }

  const clampedRatio = Math.max(0, Math.min(1, edgeRatio));
  const speed =
    TOUCH_DRAG_EDGE_SCROLL_MIN_SPEED_PX_PER_FRAME +
    (TOUCH_DRAG_EDGE_SCROLL_MAX_SPEED_PX_PER_FRAME - TOUCH_DRAG_EDGE_SCROLL_MIN_SPEED_PX_PER_FRAME) *
      clampedRatio;
  return direction * speed;
}

function runTouchCopyDragEdgeAutoScrollStep() {
  state.touchCopyDragEdgeScrollRaf = null;
  if (!state.touchCopyDragActive || !zonesContainer) return;
  if (Math.abs(state.touchCopyDragEdgeScrollVelocity) < 0.01) return;

  const maxScrollLeft = Math.max(0, zonesContainer.scrollWidth - zonesContainer.clientWidth);
  if (maxScrollLeft <= 0) {
    state.touchCopyDragEdgeScrollVelocity = 0;
    return;
  }

  const previousScrollLeft = zonesContainer.scrollLeft;
  const nextScrollLeft = Math.max(
    0,
    Math.min(maxScrollLeft, previousScrollLeft + state.touchCopyDragEdgeScrollVelocity),
  );
  zonesContainer.scrollLeft = nextScrollLeft;

  if (Number.isFinite(state.touchCopyDragLastClientX) && Number.isFinite(state.touchCopyDragLastClientY)) {
    updateTouchCopyDragPreview(state.touchCopyDragLastClientX, state.touchCopyDragLastClientY);
  }

  if (Math.abs(nextScrollLeft - previousScrollLeft) < 0.01) {
    state.touchCopyDragEdgeScrollVelocity = 0;
    return;
  }

  state.touchCopyDragEdgeScrollRaf = requestAnimationFrame(runTouchCopyDragEdgeAutoScrollStep);
}

function updateTouchCopyDragEdgeAutoScroll(clientX, clientY) {
  state.touchCopyDragLastClientX = clientX;
  state.touchCopyDragLastClientY = clientY;
  const velocity = resolveTouchCopyDragEdgeScrollVelocity(clientX);
  if (Math.abs(velocity) < 0.01) {
    stopTouchCopyDragEdgeAutoScroll();
    return;
  }

  state.touchCopyDragEdgeScrollVelocity = velocity;
  if (state.touchCopyDragEdgeScrollRaf === null) {
    state.touchCopyDragEdgeScrollRaf = requestAnimationFrame(runTouchCopyDragEdgeAutoScrollStep);
  }
}

function removeTouchCopyDragListeners() {
  window.removeEventListener('pointermove', onTouchCopyDragPointerMove, true);
  window.removeEventListener('pointerup', onTouchCopyDragPointerUp, true);
  window.removeEventListener('pointercancel', onTouchCopyDragPointerCancel, true);
}

function clearZoneDragOverState() {
  document.querySelectorAll('.zone.drag-over').forEach((zone) => zone.classList.remove('drag-over'));
}

function cleanupTouchCopyDrag({ restoreLayout = false } = {}) {
  stopTouchCopyDragEdgeAutoScroll();
  if (state.touchCopyDragGhost) {
    state.touchCopyDragGhost.remove();
    state.touchCopyDragGhost = null;
  }
  hideTrashDropzone();
  clearDesktopDragGhost();
  clearDragModeBadge();
  clearDragPreviewCard();

  removeTouchCopyDragListeners();
  clearZoneDragOverState();

  if (state.draggingCard) {
    state.draggingCard.classList.remove('dragging');
  }

  const shouldRestoreLayout = restoreLayout && !state.dragDropHandled;

  state.draggingCard = null;
  state.dragContext = null;
  state.dragDropHandled = false;
  state.touchCopyDragActive = false;
  state.touchCopyDragPointerId = null;
  state.touchCopyDragMoved = false;
  state.touchCopyDragLastClientX = 0;
  state.touchCopyDragLastClientY = 0;
  state.touchDragMode = null;

  if (shouldRestoreLayout) {
    renderZones();
  }
}

function getZoneFromPoint(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof Element)) return null;
  const zoneBody = target.closest('.zone-body');
  if (zoneBody) {
    return zoneBody.closest('.zone');
  }
  return target.closest('.zone');
}

function updateTouchCopyDragPreview(clientX, clientY) {
  updateTouchCopyGhostPosition(clientX, clientY);
  clearZoneDragOverState();
  syncQueueNextDropzoneVisibility();

  if (isPointOverQueueNextDropzone(clientX, clientY)) {
    if (state.queueNextDropzoneEl) {
      state.queueNextDropzoneEl.classList.add('is-active');
    }
    if (state.trashDropzoneEl) {
      state.trashDropzoneEl.classList.remove('is-active');
    }
    applyDragModeBadge('next');
    if (state.touchCopyDragGhost) {
      state.touchCopyDragGhost.classList.remove('is-copy', 'is-move', 'is-cancel', 'is-delete');
      state.touchCopyDragGhost.classList.add('is-next');
    }
    return;
  }

  if (state.queueNextDropzoneEl) {
    state.queueNextDropzoneEl.classList.remove('is-active');
  }

  if (isPointOverTrashDropzone(clientX, clientY)) {
    if (state.trashDropzoneEl) {
      state.trashDropzoneEl.classList.add('is-active');
    }
    applyDragModeBadge('delete');
    if (state.touchCopyDragGhost) {
      state.touchCopyDragGhost.classList.remove('is-copy', 'is-move', 'is-cancel', 'is-next');
      state.touchCopyDragGhost.classList.add('is-delete');
    }
    return;
  }

  if (state.trashDropzoneEl) {
    state.trashDropzoneEl.classList.remove('is-active');
  }

  const zone = getZoneFromPoint(clientX, clientY);
  if (!zone) {
    applyDragModeBadge('cancel');
    if (state.touchCopyDragGhost) {
      state.touchCopyDragGhost.classList.remove('is-copy', 'is-move', 'is-delete', 'is-next');
      state.touchCopyDragGhost.classList.add('is-cancel');
    }
    return;
  }

  const targetZoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
  const dropMode = resolveEffectiveDragMode(null, Number.isInteger(targetZoneIndex) ? targetZoneIndex : null);
  applyDragModeBadge(dropMode);
  if (state.touchCopyDragGhost) {
    state.touchCopyDragGhost.classList.remove('is-delete', 'is-cancel', 'is-copy', 'is-move', 'is-next');
    state.touchCopyDragGhost.classList.add(dropMode === 'copy' ? 'is-copy' : 'is-move');
  }

  zone.classList.add('drag-over');
  const zoneBody = zone.querySelector('.zone-body');
  if (!zoneBody) return;

  applyDragPreview(zoneBody, {
    clientY,
    preventDefault() {},
    dataTransfer: null,
  });
}

async function finishTouchCopyDrag(clientX, clientY) {
  if (!state.touchCopyDragActive) return;
  const dropMode = state.touchDragMode === 'copy' ? 'copy' : 'move';

  if (!state.touchCopyDragMoved) {
    cleanupTouchCopyDrag({ restoreLayout: true });
    setStatus(dropMode === 'copy' ? 'Копирование отменено.' : 'Перемещение отменено.');
    return;
  }

  if (isPointOverTrashDropzone(clientX, clientY)) {
    try {
      await handleDragDeleteFromContext();
    } finally {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
    return;
  }

  if (isPointOverQueueNextDropzone(clientX, clientY)) {
    try {
      await handleDragQueueNextFromContext();
    } finally {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
    return;
  }

  const zone = getZoneFromPoint(clientX, clientY);
  const targetZoneIndex = zone ? Number.parseInt(zone.dataset.zoneIndex || '', 10) : NaN;

  if (Number.isInteger(targetZoneIndex) && targetZoneIndex >= 0 && zone) {
    const fakeDropEvent = {
      preventDefault() {},
      currentTarget: zone,
      ctrlKey: dropMode === 'copy',
      metaKey: false,
      dataTransfer: null,
    };

    try {
      await handleDrop(fakeDropEvent, targetZoneIndex);
    } finally {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
    return;
  }

  cleanupTouchCopyDrag({ restoreLayout: true });
  setStatus(dropMode === 'copy' ? 'Копирование отменено.' : 'Перемещение отменено.');
}

function onTouchCopyDragPointerMove(event) {
  if (!state.touchCopyDragActive || event.pointerId !== state.touchCopyDragPointerId) return;
  event.preventDefault();
  const deltaX = event.clientX - state.touchCopyDragStartX;
  const deltaY = event.clientY - state.touchCopyDragStartY;
  if (!state.touchCopyDragMoved && Math.hypot(deltaX, deltaY) > TOUCH_DRAG_COMMIT_PX) {
    state.touchCopyDragMoved = true;
  }
  updateTouchCopyDragPreview(event.clientX, event.clientY);
  updateTouchCopyDragEdgeAutoScroll(event.clientX, event.clientY);
}

function onTouchCopyDragPointerUp(event) {
  if (!state.touchCopyDragActive || event.pointerId !== state.touchCopyDragPointerId) return;
  event.preventDefault();
  finishTouchCopyDrag(event.clientX, event.clientY).catch((err) => {
    console.error(err);
    const dropMode = state.touchDragMode === 'copy' ? 'copy' : 'move';
    cleanupTouchCopyDrag({ restoreLayout: true });
    setStatus(
      dropMode === 'copy'
        ? 'Не удалось завершить копирование на тач-устройстве.'
        : 'Не удалось завершить перемещение на тач-устройстве.',
    );
  });
}

function onTouchCopyDragPointerCancel(event) {
  if (!state.touchCopyDragActive || event.pointerId !== state.touchCopyDragPointerId) return;
  const dropMode = state.touchDragMode === 'copy' ? 'copy' : 'move';
  cleanupTouchCopyDrag({ restoreLayout: true });
  setStatus(dropMode === 'copy' ? 'Копирование отменено.' : 'Перемещение отменено.');
}

function startTouchCopyDrag(card, pointerId, clientX, clientY, { mode = 'copy', moved = false } = {}) {
  if (!card || !card.isConnected) return;
  if (isTrackCardDragBlocked(card)) {
    setStatus('Активный трек нельзя перемещать или копировать.');
    return;
  }

  const sourceZone = card.closest('.zone');
  const sourceZoneIndex = sourceZone ? Number.parseInt(sourceZone.dataset.zoneIndex || '', 10) : -1;
  const sourceBody = card.parentElement;
  const sourceIndexFromDataset = Number.parseInt(card.dataset.playlistPosition || '', 10);
  const sourceIndex = Number.isInteger(sourceIndexFromDataset)
    ? sourceIndexFromDataset
    : sourceBody
      ? Array.from(sourceBody.querySelectorAll('.track-card')).indexOf(card)
      : -1;
  const sourcePlaylistType = isFolderPlaylistIndex(sourceZoneIndex) ? PLAYLIST_TYPE_FOLDER : PLAYLIST_TYPE_MANUAL;
  const resolvedMode = mode === 'copy' ? 'copy' : 'move';

  state.dragContext = {
    file: card.dataset.file || '',
    sourceZoneIndex: Number.isInteger(sourceZoneIndex) ? sourceZoneIndex : -1,
    sourceIndex,
    sourcePlaylistType,
    snapshotLayout: cloneLayoutState(state.layout),
  };

  state.draggingCard = card;
  state.dragDropHandled = false;
  state.touchCopyDragActive = true;
  state.touchCopyDragPointerId = pointerId;
  state.touchCopyDragStartX = clientX;
  state.touchCopyDragStartY = clientY;
  state.touchCopyDragMoved = Boolean(moved);
  state.touchCopyDragLastClientX = clientX;
  state.touchCopyDragLastClientY = clientY;
  state.touchDragMode = resolvedMode;
  card.classList.add('dragging');

  const ghost = card.cloneNode(true);
  ghost.classList.add('touch-drag-ghost');
  ghost.classList.add(state.touchDragMode === 'copy' ? 'is-copy' : 'is-move');
  ghost.classList.remove('dragging');
  state.touchCopyDragGhost = ghost;
  document.body.appendChild(ghost);
  updateTouchCopyGhostPosition(clientX, clientY);
  showTrashDropzone();
  applyDragModeBadge(state.touchDragMode);
  updateTouchCopyDragEdgeAutoScroll(clientX, clientY);

  window.addEventListener('pointermove', onTouchCopyDragPointerMove, true);
  window.addEventListener('pointerup', onTouchCopyDragPointerUp, true);
  window.addEventListener('pointercancel', onTouchCopyDragPointerCancel, true);
  setStatus(
    state.touchDragMode === 'copy'
      ? 'Режим копирования: перетащите трек в нужный плей-лист.'
      : 'Режим перемещения: перетащите трек в нужный плей-лист.',
  );
}

function startTouchCopyHold(card, event) {
  if (state.touchCopyDragActive) return;

  state.lastTouchPointerDownAt = Date.now();
  clearTouchCopyHold();
  state.touchHoldPointerId = event.pointerId;
  state.touchHoldStartX = event.clientX;
  state.touchHoldStartY = event.clientY;
  state.touchHoldStartedAt = Date.now();
  state.touchHoldCard = card;
  card.classList.add('touch-hold-copy');

  window.addEventListener('pointermove', onTouchHoldPointerMove, true);
  window.addEventListener('pointerup', onTouchHoldPointerEnd, true);
  window.addEventListener('pointercancel', onTouchHoldPointerEnd, true);

  state.touchHoldTimer = setTimeout(() => {
    const heldCard = state.touchHoldCard;
    const pointerId = state.touchHoldPointerId;
    const startX = state.touchHoldStartX;
    const startY = state.touchHoldStartY;

    clearTouchCopyHold();

    if (!heldCard || pointerId === null) return;
    startTouchCopyDrag(heldCard, pointerId, startX, startY, { mode: 'copy' });
  }, TOUCH_COPY_HOLD_MS);
}

function removePlaylistCollapseHoldListeners() {
  window.removeEventListener('pointermove', onPlaylistCollapseHoldPointerMove, true);
  window.removeEventListener('pointerup', onPlaylistCollapseHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onPlaylistCollapseHoldPointerCancel, true);
}

function clearPlaylistCollapsePendingVisual() {
  if (!state.playlistCollapseHoldZone) return;
  state.playlistCollapseHoldZone.classList.remove('zone--collapse-pending');
  state.playlistCollapseHoldZone = null;
}

function clearPlaylistCollapseHold({ resetTriggered = true } = {}) {
  if (state.playlistCollapseHoldTimer !== null) {
    clearTimeout(state.playlistCollapseHoldTimer);
    state.playlistCollapseHoldTimer = null;
  }

  if (
    state.playlistCollapseHoldTarget &&
    state.playlistCollapseHoldPointerId !== null &&
    typeof state.playlistCollapseHoldTarget.releasePointerCapture === 'function'
  ) {
    try {
      if (
        state.playlistCollapseHoldTarget.hasPointerCapture &&
        state.playlistCollapseHoldTarget.hasPointerCapture(state.playlistCollapseHoldPointerId)
      ) {
        state.playlistCollapseHoldTarget.releasePointerCapture(state.playlistCollapseHoldPointerId);
      }
    } catch (err) {
      // ignore pointer capture release errors
    }
  }

  clearPlaylistCollapsePendingVisual();
  removePlaylistCollapseHoldListeners();
  state.playlistCollapseHoldPointerId = null;
  state.playlistCollapseHoldStartX = 0;
  state.playlistCollapseHoldStartY = 0;
  state.playlistCollapseHoldPlaylistIndex = null;
  state.playlistCollapseHoldTarget = null;
  state.playlistCollapseHoldZone = null;
  if (resetTriggered) {
    state.playlistCollapseHoldTriggered = false;
  }
}

function onPlaylistCollapseHoldPointerMove(event) {
  if (state.playlistCollapseHoldPointerId === null || event.pointerId !== state.playlistCollapseHoldPointerId) return;
  if (state.playlistCollapseHoldTriggered) {
    event.preventDefault();
    return;
  }

  const deltaX = event.clientX - state.playlistCollapseHoldStartX;
  const deltaY = event.clientY - state.playlistCollapseHoldStartY;
  if (Math.hypot(deltaX, deltaY) <= PLAYLIST_COLLAPSE_POINTER_MOVE_TOLERANCE_PX) return;
  clearPlaylistCollapseHold();
}

function onPlaylistCollapseHoldPointerEnd(event) {
  if (state.playlistCollapseHoldPointerId === null || event.pointerId !== state.playlistCollapseHoldPointerId) return;
  const shouldCollapse = state.playlistCollapseHoldTriggered;
  const collapsePlaylistIndex = state.playlistCollapseHoldPlaylistIndex;
  clearPlaylistCollapseHold();
  if (!shouldCollapse) return;
  event.preventDefault();
  event.stopPropagation();
  collapsePlaylistForLocalView(collapsePlaylistIndex);
}

function onPlaylistCollapseHoldPointerCancel(event) {
  if (state.playlistCollapseHoldPointerId === null || event.pointerId !== state.playlistCollapseHoldPointerId) return;
  const shouldCollapse = state.playlistCollapseHoldTriggered;
  const collapsePlaylistIndex = state.playlistCollapseHoldPlaylistIndex;
  clearPlaylistCollapseHold();
  if (!shouldCollapse) return;
  collapsePlaylistForLocalView(collapsePlaylistIndex);
}

function startPlaylistCollapseHold(event, playlistIndex) {
  if (isHostRole()) return;
  if (!isTouchPlaylistCollapseEnabled()) return;
  const pointerType = typeof event.pointerType === 'string' ? event.pointerType : '';
  if (pointerType && pointerType !== 'touch' && pointerType !== 'pen') return;
  if (state.touchCopyDragActive || state.draggingCard) return;
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return;

  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  clearPlaylistCollapseHold();
  state.playlistCollapseHoldPointerId = event.pointerId;
  state.playlistCollapseHoldStartX = event.clientX;
  state.playlistCollapseHoldStartY = event.clientY;
  state.playlistCollapseHoldPlaylistIndex = playlistIndex;
  state.playlistCollapseHoldTarget = target;
  state.playlistCollapseHoldZone = target ? target.closest('.zone') : null;
  state.playlistCollapseHoldTriggered = false;

  if (target && typeof target.setPointerCapture === 'function') {
    try {
      target.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors
    }
  }

  window.addEventListener('pointermove', onPlaylistCollapseHoldPointerMove, true);
  window.addEventListener('pointerup', onPlaylistCollapseHoldPointerEnd, true);
  window.addEventListener('pointercancel', onPlaylistCollapseHoldPointerCancel, true);

  state.playlistCollapseHoldTimer = setTimeout(() => {
    state.playlistCollapseHoldTimer = null;
    const targetPlaylistIndex = state.playlistCollapseHoldPlaylistIndex;
    if (
      !Number.isInteger(targetPlaylistIndex) ||
      targetPlaylistIndex < 0 ||
      targetPlaylistIndex >= state.layout.length ||
      state.collapsedPlaylistIndices.has(targetPlaylistIndex)
    ) {
      clearPlaylistCollapseHold();
      return;
    }

    state.playlistCollapseHoldTriggered = true;
    if (state.playlistCollapseHoldZone && state.playlistCollapseHoldZone.isConnected) {
      state.playlistCollapseHoldZone.classList.add('zone--collapse-pending');
    }
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
      focused.blur();
    }
  }, PLAYLIST_COLLAPSE_HOLD_MS);
}

function moveArrayItem(items, fromIndex, toIndex) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return list;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return list;
  if (fromIndex === toIndex) return list;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list;
}

function remapPlaylistIndexAfterMove(index, fromIndex, toIndex) {
  if (!Number.isInteger(index) || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return index;
  if (fromIndex === toIndex) return index;
  if (index === fromIndex) return toIndex;
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
    return index - 1;
  }
  if (fromIndex > toIndex && index >= toIndex && index < fromIndex) {
    return index + 1;
  }
  return index;
}

function remapCollapsedPlaylistIndicesAfterMove(fromIndex, toIndex, expectedLength = state.layout.length) {
  if (!state.collapsedPlaylistIndices.size) return;
  const length = Number.isInteger(expectedLength) && expectedLength >= 0 ? expectedLength : 0;
  const remapped = new Set();
  for (const playlistIndex of state.collapsedPlaylistIndices) {
    const normalizedIndex = normalizePlaylistTrackIndex(playlistIndex);
    if (normalizedIndex === null || normalizedIndex < 0 || normalizedIndex >= length) continue;
    const nextIndex = remapPlaylistIndexAfterMove(normalizedIndex, fromIndex, toIndex);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= length) continue;
    remapped.add(nextIndex);
  }
  state.collapsedPlaylistIndices.clear();
  remapped.forEach((playlistIndex) => state.collapsedPlaylistIndices.add(playlistIndex));
}

async function reorderPlaylistsByHeaderDrag(sourcePlaylistIndex, targetPlaylistIndex) {
  if (!isHostRole()) {
    setStatus('Порядок плей-листов может менять только хост.');
    return;
  }

  state.layout = ensurePlaylists(state.layout);
  const sourceIndex = normalizePlaylistTrackIndex(sourcePlaylistIndex);
  const normalizedTargetIndex =
    targetPlaylistIndex === null || targetPlaylistIndex === undefined
      ? null
      : normalizePlaylistTrackIndex(targetPlaylistIndex);
  if (sourceIndex === null) return;
  if (sourceIndex < 0 || sourceIndex >= state.layout.length) return;
  if (normalizedTargetIndex !== null && (normalizedTargetIndex < 0 || normalizedTargetIndex >= state.layout.length)) return;

  const destinationIndex =
    normalizedTargetIndex === null
      ? state.layout.length - 1
      : sourceIndex < normalizedTargetIndex
        ? normalizedTargetIndex - 1
        : normalizedTargetIndex;
  if (!Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= state.layout.length) return;
  if (sourceIndex === destinationIndex) return;

  const previousLayout = cloneLayoutState(state.layout);
  const previousNames = state.playlistNames.slice();
  const previousMeta = clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...dapConfig };
  const previousCollapsedIndices = new Set(state.collapsedPlaylistIndices);
  const previousCurrentTrackWasDap = isDapTrackContext(state.currentTrack, previousDap);
  const previousCurrentTrackContext =
    state.currentTrack && typeof state.currentTrack === 'object'
      ? {
          playlistIndex: state.currentTrack.playlistIndex,
          playlistPosition: state.currentTrack.playlistPosition,
        }
      : null;
  const previousDapInterruptedSnapshot = state.dapInterruptedPlaybackSnapshot
    ? { ...dapInterruptedPlaybackSnapshot }
    : null;

  const nextLayout = moveArrayItem(previousLayout, sourceIndex, destinationIndex);
  const nextNames = moveArrayItem(previousNames, sourceIndex, destinationIndex);
  const nextMeta = moveArrayItem(previousMeta, sourceIndex, destinationIndex);
  const nextAutoplay = moveArrayItem(previousAutoplay, sourceIndex, destinationIndex);
  const nextDsp = moveArrayItem(previousDsp, sourceIndex, destinationIndex);

  const previousDapIndex = normalizePlaylistTrackIndex(previousDap.playlistIndex);
  const nextDapRaw = {
    ...previousDap,
    playlistIndex:
      previousDapIndex === null ? null : remapPlaylistIndexAfterMove(previousDapIndex, sourceIndex, destinationIndex),
  };

  state.layout = ensurePlaylists(nextLayout);
  state.playlistNames = normalizePlaylistNames(nextNames, state.layout.length);
  state.playlistMeta = normalizePlaylistMeta(nextMeta, state.layout.length);
  state.dapConfig = normalizeDapConfig(nextDapRaw, state.layout.length, nextDapRaw);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(nextAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(nextDsp, state.playlistAutoplay, state.layout.length);
  remapCollapsedPlaylistIndicesAfterMove(sourceIndex, destinationIndex, state.layout.length);

  const preferredCurrentTrackPlaylistIndex = previousCurrentTrackWasDap ? getDapPlaylistIndex(state.dapConfig) : null;
  const currentTrackContextChanged = reconcileTrackContextWithLayout(state.currentTrack, {
    preferredPlaylistIndex: preferredCurrentTrackPlaylistIndex,
  });
  const dapSnapshotContextChanged = reconcileDapInterruptedSnapshotWithLayout();
  if ((currentTrackContextChanged || dapSnapshotContextChanged) && state.currentAudio) {
    applyLiveVolumeToCurrentAudio();
  }

  updateDapSettingsUi(state.currentRole);
  renderZones();
  if (currentTrackContextChanged && isHostRole()) {
    requestHostPlaybackSync(true);
  }

  try {
    await pushSharedLayout();
    const movedTitle = sanitizePlaylistName(state.playlistNames[destinationIndex], destinationIndex);
    setStatus(`Плей-лист "${movedTitle}" перемещен и синхронизирован.`);
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = previousNames;
    state.playlistMeta = previousMeta;
    state.dapConfig = normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    state.collapsedPlaylistIndices.clear();
    previousCollapsedIndices.forEach((playlistIndex) => state.collapsedPlaylistIndices.add(playlistIndex));
    if (state.currentTrack && previousCurrentTrackContext) {
      state.currentTrack.playlistIndex = previousCurrentTrackContext.playlistIndex;
      state.currentTrack.playlistPosition = previousCurrentTrackContext.playlistPosition;
    }
    state.dapInterruptedPlaybackSnapshot = previousDapInterruptedSnapshot ? { ...previousDapInterruptedSnapshot } : null;
    const rollbackPreferredIndex = previousCurrentTrackWasDap ? getDapPlaylistIndex(state.dapConfig) : null;
    const rollbackTrackContextChanged = reconcileTrackContextWithLayout(state.currentTrack, {
      preferredPlaylistIndex: rollbackPreferredIndex,
    });
    const rollbackSnapshotContextChanged = reconcileDapInterruptedSnapshotWithLayout();
    if ((rollbackTrackContextChanged || rollbackSnapshotContextChanged) && state.currentAudio) {
      applyLiveVolumeToCurrentAudio();
    }
    updateDapSettingsUi(state.currentRole);
    renderZones();
    setStatus(err && err.message ? err.message : 'Не удалось синхронизировать порядок плей-листов.');
  }
}

function removePlaylistReorderHoldListeners() {
  window.removeEventListener('pointermove', onPlaylistReorderHoldPointerMove, true);
  window.removeEventListener('pointerup', onPlaylistReorderHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onPlaylistReorderHoldPointerCancel, true);
}

function clearPlaylistReorderTargetVisual() {
  if (!state.playlistReorderHoldTargetZone) return;
  state.playlistReorderHoldTargetZone.classList.remove('zone--playlist-reorder-target');
  state.playlistReorderHoldTargetZone = null;
}

function getPlaylistReorderVisibleOrderFromDom() {
  if (!zonesContainer) return [];
  return Array.from(zonesContainer.querySelectorAll('.zone'))
    .map((zone) => Number.parseInt(zone.dataset.zoneIndex || '', 10))
    .filter((playlistIndex) => Number.isInteger(playlistIndex) && playlistIndex >= 0);
}

function getPlaylistReorderPointerContentX(clientX) {
  if (!zonesContainer) return null;
  const rect = zonesContainer.getBoundingClientRect();
  return clientX - rect.left + zonesContainer.scrollLeft;
}

function resolvePlaylistReorderSlotFromPointer(clientX) {
  const centers = Array.isArray(state.playlistReorderHoldCandidateCenters) ? playlistReorderHoldCandidateCenters : [];
  if (!centers.length) return 0;
  const pointerContentX = getPlaylistReorderPointerContentX(clientX);
  if (!Number.isFinite(pointerContentX)) {
    return Number.isInteger(state.playlistReorderHoldCurrentSlot) ? playlistReorderHoldCurrentSlot : 0;
  }

  let slot = 0;
  while (slot < centers.length && pointerContentX > centers[slot]) {
    slot += 1;
  }
  return slot;
}

function getPlaylistReorderTargetPlaylistBySlot(slotIndex) {
  const candidateOrder = Array.isArray(state.playlistReorderHoldCandidateOrder) ? playlistReorderHoldCandidateOrder : [];
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= candidateOrder.length) return null;
  return candidateOrder[slotIndex];
}

function applyPlaylistReorderPreviewOrder(slotIndex = state.playlistReorderHoldCurrentSlot) {
  if (!zonesContainer) return;
  const sourcePlaylistIndex = normalizePlaylistTrackIndex(state.playlistReorderHoldPlaylistIndex);
  if (sourcePlaylistIndex === null) return;

  const initialOrder = Array.isArray(state.playlistReorderHoldInitialVisibleOrder)
    ? playlistReorderHoldInitialVisibleOrder
    : [];
  if (!initialOrder.length || !initialOrder.includes(sourcePlaylistIndex)) return;

  const orderWithoutSource = initialOrder.filter((playlistIndex) => playlistIndex !== sourcePlaylistIndex);
  const normalizedSlot = Number.isInteger(slotIndex)
    ? Math.max(0, Math.min(slotIndex, orderWithoutSource.length))
    : 0;
  const nextOrder = orderWithoutSource.slice();
  nextOrder.splice(normalizedSlot, 0, sourcePlaylistIndex);
  const nextSignature = nextOrder.join('|');
  if (nextSignature === state.playlistReorderHoldPreviewSignature) return;
  state.playlistReorderHoldPreviewSignature = nextSignature;

  const zones = Array.from(zonesContainer.querySelectorAll('.zone'));
  const zoneByIndex = new Map();
  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (!Number.isInteger(zoneIndex) || zoneIndex < 0) return;
    zoneByIndex.set(zoneIndex, zone);
  });

  const appended = new Set();
  const fragment = document.createDocumentFragment();
  nextOrder.forEach((playlistIndex) => {
    const zone = zoneByIndex.get(playlistIndex);
    if (!zone) return;
    fragment.appendChild(zone);
    appended.add(playlistIndex);
  });

  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (Number.isInteger(zoneIndex) && appended.has(zoneIndex)) return;
    fragment.appendChild(zone);
  });

  zonesContainer.appendChild(fragment);
}

function restorePlaylistReorderPreviewOrder() {
  if (!zonesContainer) return;
  const initialOrder = Array.isArray(state.playlistReorderHoldInitialVisibleOrder)
    ? playlistReorderHoldInitialVisibleOrder
    : [];
  if (!initialOrder.length) return;
  const initialSignature = initialOrder.join('|');
  if (initialSignature === state.playlistReorderHoldPreviewSignature) return;

  const zones = Array.from(zonesContainer.querySelectorAll('.zone'));
  const zoneByIndex = new Map();
  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (!Number.isInteger(zoneIndex) || zoneIndex < 0) return;
    zoneByIndex.set(zoneIndex, zone);
  });

  const appended = new Set();
  const fragment = document.createDocumentFragment();
  initialOrder.forEach((playlistIndex) => {
    const zone = zoneByIndex.get(playlistIndex);
    if (!zone) return;
    fragment.appendChild(zone);
    appended.add(playlistIndex);
  });

  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (Number.isInteger(zoneIndex) && appended.has(zoneIndex)) return;
    fragment.appendChild(zone);
  });

  zonesContainer.appendChild(fragment);
  state.playlistReorderHoldPreviewSignature = initialSignature;
}

function clearPlaylistReorderHold({ resetTriggered = true, preservePreview = false } = {}) {
  if (state.playlistReorderHoldTimer !== null) {
    clearTimeout(state.playlistReorderHoldTimer);
    state.playlistReorderHoldTimer = null;
  }

  if (
    state.playlistReorderHoldTarget &&
    state.playlistReorderHoldPointerId !== null &&
    typeof state.playlistReorderHoldTarget.releasePointerCapture === 'function'
  ) {
    try {
      if (
        state.playlistReorderHoldTarget.hasPointerCapture &&
        state.playlistReorderHoldTarget.hasPointerCapture(state.playlistReorderHoldPointerId)
      ) {
        state.playlistReorderHoldTarget.releasePointerCapture(state.playlistReorderHoldPointerId);
      }
    } catch (err) {
      // ignore pointer capture release errors
    }
  }

  if (zonesContainer) {
    zonesContainer.classList.remove('is-playlist-reordering');
  }
  if (!preservePreview) {
    restorePlaylistReorderPreviewOrder();
  }
  if (state.playlistReorderHoldSourceZone) {
    state.playlistReorderHoldSourceZone.classList.remove('zone--playlist-reorder-source');
  }
  clearPlaylistReorderTargetVisual();
  removePlaylistReorderHoldListeners();
  state.playlistReorderHoldPointerId = null;
  state.playlistReorderHoldStartX = 0;
  state.playlistReorderHoldStartY = 0;
  state.playlistReorderHoldPlaylistIndex = null;
  state.playlistReorderHoldTarget = null;
  state.playlistReorderHoldSourceZone = null;
  state.playlistReorderHoldTargetPlaylistIndex = null;
  state.playlistReorderHoldInitialVisibleOrder = null;
  state.playlistReorderHoldCandidateOrder = null;
  state.playlistReorderHoldCandidateCenters = null;
  state.playlistReorderHoldCurrentSlot = null;
  state.playlistReorderHoldPreviewSignature = '';
  if (resetTriggered) {
    state.playlistReorderHoldTriggered = false;
  }
}

function updatePlaylistReorderHoldTarget(clientX) {
  const nextSlot = resolvePlaylistReorderSlotFromPointer(clientX);
  const nextTargetPlaylistIndex = getPlaylistReorderTargetPlaylistBySlot(nextSlot);
  const nextTargetZone =
    zonesContainer && nextTargetPlaylistIndex !== null
      ? zonesContainer.querySelector(`.zone[data-zone-index="${nextTargetPlaylistIndex}"]`)
      : null;
  if (state.playlistReorderHoldTargetZone && state.playlistReorderHoldTargetZone !== nextTargetZone) {
    state.playlistReorderHoldTargetZone.classList.remove('zone--playlist-reorder-target');
  }

  state.playlistReorderHoldCurrentSlot = nextSlot;
  state.playlistReorderHoldTargetZone = nextTargetZone;
  state.playlistReorderHoldTargetPlaylistIndex = nextTargetPlaylistIndex;
  if (nextTargetZone) {
    nextTargetZone.classList.add('zone--playlist-reorder-target');
  }
  applyPlaylistReorderPreviewOrder(nextSlot);
}

function onPlaylistReorderHoldPointerMove(event) {
  if (state.playlistReorderHoldPointerId === null || event.pointerId !== state.playlistReorderHoldPointerId) return;
  if (!state.playlistReorderHoldTriggered) {
    const deltaX = event.clientX - state.playlistReorderHoldStartX;
    const deltaY = event.clientY - state.playlistReorderHoldStartY;
    if (Math.hypot(deltaX, deltaY) <= PLAYLIST_REORDER_POINTER_MOVE_TOLERANCE_PX) return;
    clearPlaylistReorderHold();
    return;
  }

  event.preventDefault();
  if (state.zonesPanActive) {
    cleanupZonesPanInteraction();
  }
  if (zonesContainer) {
    const rect = zonesContainer.getBoundingClientRect();
    const edgeThreshold = 52;
    if (event.clientX <= rect.left + edgeThreshold) {
      zonesContainer.scrollLeft -= 8;
    } else if (event.clientX >= rect.right - edgeThreshold) {
      zonesContainer.scrollLeft += 8;
    }
  }
  updatePlaylistReorderHoldTarget(event.clientX);
}

function onPlaylistReorderHoldPointerEnd(event) {
  if (state.playlistReorderHoldPointerId === null || event.pointerId !== state.playlistReorderHoldPointerId) return;
  const shouldReorder = state.playlistReorderHoldTriggered;
  const sourcePlaylistIndex = state.playlistReorderHoldPlaylistIndex;
  const targetPlaylistIndex = state.playlistReorderHoldTargetPlaylistIndex;
  clearPlaylistReorderHold({ preservePreview: true });
  if (!shouldReorder) return;
  event.preventDefault();
  event.stopPropagation();
  if (!Number.isInteger(sourcePlaylistIndex)) return;
  if (targetPlaylistIndex !== null && !Number.isInteger(targetPlaylistIndex)) return;
  reorderPlaylistsByHeaderDrag(sourcePlaylistIndex, targetPlaylistIndex).catch((err) => {
    console.error(err);
    setStatus('Не удалось изменить порядок плей-листов.');
  });
}

function onPlaylistReorderHoldPointerCancel(event) {
  if (state.playlistReorderHoldPointerId === null || event.pointerId !== state.playlistReorderHoldPointerId) return;
  clearPlaylistReorderHold();
}

function startPlaylistReorderHold(event, playlistIndex) {
  if (!isHostRole()) return;
  if (event.isPrimary === false) return;
  if (event.button !== undefined && event.button !== 0) return;
  if (state.touchCopyDragActive || state.draggingCard) return;
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return;

  const targetElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!targetElement) return;

  const eventTarget = event.target instanceof Element ? event.target : null;
  if (eventTarget && eventTarget.closest('.playlist-header-control, .playlist-delete-btn')) return;

  clearPlaylistReorderHold();
  state.playlistReorderHoldPointerId = event.pointerId;
  state.playlistReorderHoldStartX = event.clientX;
  state.playlistReorderHoldStartY = event.clientY;
  state.playlistReorderHoldPlaylistIndex = playlistIndex;
  state.playlistReorderHoldTarget = targetElement;
  state.playlistReorderHoldSourceZone = targetElement.closest('.zone');
  state.playlistReorderHoldTargetPlaylistIndex = null;
  state.playlistReorderHoldInitialVisibleOrder = null;
  state.playlistReorderHoldCandidateOrder = null;
  state.playlistReorderHoldCandidateCenters = null;
  state.playlistReorderHoldCurrentSlot = null;
  state.playlistReorderHoldPreviewSignature = '';
  state.playlistReorderHoldTriggered = false;

  if (typeof targetElement.setPointerCapture === 'function') {
    try {
      targetElement.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors
    }
  }

  window.addEventListener('pointermove', onPlaylistReorderHoldPointerMove, true);
  window.addEventListener('pointerup', onPlaylistReorderHoldPointerEnd, true);
  window.addEventListener('pointercancel', onPlaylistReorderHoldPointerCancel, true);

  state.playlistReorderHoldTimer = setTimeout(() => {
    state.playlistReorderHoldTimer = null;
    const sourceIndex = state.playlistReorderHoldPlaylistIndex;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= state.layout.length) {
      clearPlaylistReorderHold();
      return;
    }
    const initialOrder = getPlaylistReorderVisibleOrderFromDom();
    if (!initialOrder.includes(sourceIndex)) {
      clearPlaylistReorderHold();
      return;
    }
    state.playlistReorderHoldInitialVisibleOrder = initialOrder;
    const candidateOrder = initialOrder.filter((playlistIdx) => playlistIdx !== sourceIndex);
    const pointerContentX = getPlaylistReorderPointerContentX(state.playlistReorderHoldStartX);
    if (!Number.isFinite(pointerContentX) && !candidateOrder.length) {
      clearPlaylistReorderHold();
      return;
    }
    const candidateCenters = candidateOrder.map((playlistIdx) => {
      if (!zonesContainer) return null;
      const zone = zonesContainer.querySelector(`.zone[data-zone-index="${playlistIdx}"]`);
      if (!(zone instanceof HTMLElement)) return null;
      const rect = zone.getBoundingClientRect();
      const containerRect = zonesContainer.getBoundingClientRect();
      return rect.left - containerRect.left + zonesContainer.scrollLeft + rect.width / 2;
    });
    if (candidateCenters.some((centerX) => !Number.isFinite(centerX))) {
      clearPlaylistReorderHold();
      return;
    }
    state.playlistReorderHoldCandidateOrder = candidateOrder;
    state.playlistReorderHoldCandidateCenters = candidateCenters;
    const sourceSlot = initialOrder.indexOf(sourceIndex);
    state.playlistReorderHoldCurrentSlot = sourceSlot >= 0 ? Math.min(sourceSlot, candidateOrder.length) : 0;
    state.playlistReorderHoldTargetPlaylistIndex = getPlaylistReorderTargetPlaylistBySlot(state.playlistReorderHoldCurrentSlot);

    state.playlistReorderHoldTriggered = true;
    if (state.zonesPanActive) {
      cleanupZonesPanInteraction();
    }
    stopZonesPanMomentum();
    if (zonesContainer) {
      zonesContainer.classList.add('is-playlist-reordering');
    }
    if (state.playlistReorderHoldSourceZone && state.playlistReorderHoldSourceZone.isConnected) {
      state.playlistReorderHoldSourceZone.classList.add('zone--playlist-reorder-source');
    }
    updatePlaylistReorderHoldTarget(state.playlistReorderHoldStartX);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
      focused.blur();
    }
    setStatus('Режим переноса: перетащите плей-лист влево или вправо.');
  }, PLAYLIST_REORDER_HOLD_MS);
}

function normalizeTrackTitleMode(value) {
  return value === TRACK_TITLE_MODE_ATTRIBUTES ? TRACK_TITLE_MODE_ATTRIBUTES : TRACK_TITLE_MODE_FILE;
}

function normalizeTrackTitleModesByTrackPayload(rawValue) {
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

function parseTrackTitleModesByTrack(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return new Map();

  try {
    return normalizeTrackTitleModesByTrackPayload(JSON.parse(rawValue));
  } catch (err) {
    return new Map();
  }
}

function serializeTrackTitleModesByTrack(trackModesState = state.trackTitleModesByTrack) {
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

function saveTrackTitleModesByTrackSetting() {
  const serialized = serializeTrackTitleModesByTrack();
  saveSetting(SETTINGS_KEYS.trackTitleModesByTrack, JSON.stringify(serialized));
}

function loadTrackTitleModesByTrackSetting() {
  state.trackTitleModesByTrack = parseTrackTitleModesByTrack(loadSetting(SETTINGS_KEYS.trackTitleModesByTrack, '{}'));
}

function trackTitleModesByTrackEqual(leftState, rightState) {
  const leftSerialized = serializeTrackTitleModesByTrack(leftState);
  const rightSerialized = serializeTrackTitleModesByTrack(rightState);
  return JSON.stringify(leftSerialized) === JSON.stringify(rightSerialized);
}

function normalizeTrackTitleModesByTrackForFiles(trackModesState, files, basePath = '/audio') {
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

function getTrackTitleModeByKey(fileKey) {
  if (typeof fileKey !== 'string' || !fileKey) return TRACK_TITLE_MODE_FILE;
  return normalizeTrackTitleMode(state.trackTitleModesByTrack.get(fileKey));
}

function getTrackTitleModeForTrack(file, basePath = '/audio') {
  return getTrackTitleModeByKey(trackKey(file, basePath));
}

function keepTrackTitleModesForFiles(files, basePath = '/audio') {
  const normalized = normalizeTrackTitleModesByTrackForFiles(state.trackTitleModesByTrack, files, basePath);
  if (!trackTitleModesByTrackEqual(state.trackTitleModesByTrack, normalized)) {
    state.trackTitleModesByTrack = normalized;
    saveTrackTitleModesByTrackSetting();
  }
}

function sanitizeTrackAttributeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function trackFileDisplayName(file) {
  const normalized = typeof file === 'string' ? file.replace(/\\/g, '/') : '';
  const basename = normalized.split('/').filter(Boolean).pop() || normalized;
  return stripExtension(basename);
}

function buildTrackAttributesDisplayName(attributes, file) {
  const safeTitle = sanitizeTrackAttributeText(attributes && attributes.title);
  const safeArtist = sanitizeTrackAttributeText(attributes && attributes.artist);
  const fallback = trackFileDisplayName(file);
  if (safeTitle && safeArtist) {
    return `${safeArtist} - ${safeTitle}`;
  }
  return safeTitle || safeArtist || fallback;
}

function normalizeTrackAttributesPayload(payload, file) {
  const title = sanitizeTrackAttributeText(payload && payload.title);
  const artist = sanitizeTrackAttributeText(payload && payload.artist);
  const displayName = sanitizeTrackAttributeText(payload && payload.displayName) || buildTrackAttributesDisplayName({ title, artist }, file);
  return { title, artist, displayName };
}

function refreshTrackNameLabelsByKey(fileKey) {
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

function preloadTrackAttributesForConfiguredTracks(files, basePath = '/audio') {
  if (!Array.isArray(files) || !files.length) return;

  files.forEach((file) => {
    if (typeof file !== 'string' || !file.trim()) return;
    if (getTrackTitleModeForTrack(file, basePath) !== TRACK_TITLE_MODE_ATTRIBUTES) return;
    loadTrackAttributes(file, basePath).catch(() => {});
  });
}

function keepKnownTrackAttributesForFiles(files, basePath = '/audio') {
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

async function loadTrackAttributes(file, basePath = '/audio') {
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

function getTrackDisplayNameForMode(file, basePath = '/audio', { triggerLoad = true } = {}) {
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

function setTrackTitleModeForTrack(file, basePath = '/audio', mode, { persist = true, announce = false } = {}) {
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

async function toggleTrackTitleModeForTrack(file, basePath = '/audio') {
  const currentMode = getTrackTitleModeForTrack(file, basePath);
  const nextMode = currentMode === TRACK_TITLE_MODE_ATTRIBUTES ? TRACK_TITLE_MODE_FILE : TRACK_TITLE_MODE_ATTRIBUTES;
  const changed = setTrackTitleModeForTrack(file, basePath, nextMode, { persist: true, announce: false });
  if (!changed) return;

  try {
    await pushSharedLayout({ renderOnApply: false });
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

function trackDisplayName(file, basePath = '/audio') {
  return getTrackDisplayNameForMode(file, basePath, { triggerLoad: true });
}

function stripExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return filename;
  return filename.slice(0, lastDot);
}

function getClientId() {
  const randomId = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  try {
    const existing = sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;

    const created = randomId();
    sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch (err) {
    return randomId();
  }
}

function getDefaultHostPlaybackState() {
  return {
    trackFile: null,
    paused: false,
    currentTime: 0,
    duration: null,
    volume: DEFAULT_LIVE_VOLUME,
    showVolumePresets: false,
    allowLiveSeek: false,
    dapPlayback: getDefaultDapPlaybackState(),
    playlistIndex: null,
    playlistPosition: null,
    updatedAt: 0,
    sourceClientId: null,
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

const easing = (t, type) => {
  switch (type) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return t * (2 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default:
      return t;
  }
};

function waitMs(ms) {
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function isTouchPlaylistCollapseEnabled() {
  return isTouchFullscreenPreferredDevice();
}

function pruneCollapsedPlaylistIndices(expectedLength = state.layout.length) {
  const length = Number.isInteger(expectedLength) && expectedLength >= 0 ? expectedLength : 0;
  for (const playlistIndex of Array.from(state.collapsedPlaylistIndices)) {
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= length) {
      state.collapsedPlaylistIndices.delete(playlistIndex);
    }
  }
}

function getCollapsedPlaylistIndicesInRenderOrder() {
  pruneCollapsedPlaylistIndices(state.layout.length);
  if (!state.collapsedPlaylistIndices.size) return [];
  const renderOrder = buildPlaylistRenderOrder(state.layout.length, state.dapConfig);
  const indices = renderOrder.filter((playlistIndex) => state.collapsedPlaylistIndices.has(playlistIndex));
  if (indices.length === state.collapsedPlaylistIndices.size) return indices;

  const unknown = Array.from(state.collapsedPlaylistIndices).filter((playlistIndex) => !indices.includes(playlistIndex));
  unknown.sort((left, right) => left - right);
  return indices.concat(unknown);
}

function isPlaylistCollapsedForLocalView(playlistIndex) {
  if (!isTouchPlaylistCollapseEnabled()) return false;
  return state.collapsedPlaylistIndices.has(playlistIndex);
}

function restoreCollapsedPlaylistForLocalView(playlistIndex) {
  if (!state.collapsedPlaylistIndices.has(playlistIndex)) return false;
  state.collapsedPlaylistIndices.delete(playlistIndex);
  hideCollapsedPlaylistsOverlay();
  renderZones();
  return true;
}

function collapsePlaylistForLocalView(playlistIndex) {
  if (!isTouchPlaylistCollapseEnabled()) return false;
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return false;
  if (state.collapsedPlaylistIndices.has(playlistIndex)) return false;
  state.collapsedPlaylistIndices.add(playlistIndex);
  hideCollapsedPlaylistsOverlay();
  renderZones();
  const title = sanitizePlaylistName(state.playlistNames[playlistIndex], playlistIndex);
  showCollapsedPlaylistsHint(`Свернут: ${title}`);
  return true;
}

function isTouchFullscreenPreferredDevice() {
  const hasTouchPoints = (() => {
    if (typeof navigator !== 'object' || !navigator) return false;
    const maxTouchPoints = Number.isFinite(navigator.maxTouchPoints) ? navigator.maxTouchPoints : 0;
    const legacyTouchPoints = Number.isFinite(navigator.msMaxTouchPoints) ? navigator.msMaxTouchPoints : 0;
    return maxTouchPoints > 0 || legacyTouchPoints > 0;
  })();
  if (!hasTouchPoints) return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

function hasFullscreenSupport() {
  const root = document.documentElement;
  return Boolean(root && (root.requestFullscreen || root.webkitRequestFullscreen));
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function isFullscreenActive() {
  return Boolean(getFullscreenElement());
}

function updateTouchFullscreenToggleState() {
  if (!touchFullscreenToggleBtn) return;
  const isActive = isFullscreenActive();
  touchFullscreenToggleBtn.textContent = isActive ? '⤡' : '⛶';
  touchFullscreenToggleBtn.title = isActive ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим';
  touchFullscreenToggleBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
}

async function enterFullscreenMode() {
  const root = document.documentElement;
  if (!root) return;
  if (root.requestFullscreen) {
    await root.requestFullscreen();
    return;
  }
  if (root.webkitRequestFullscreen) {
    await root.webkitRequestFullscreen();
    return;
  }
  throw new Error('Fullscreen API не поддерживается');
}

async function exitFullscreenMode() {
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  if (document.webkitExitFullscreen) {
    await document.webkitExitFullscreen();
  }
}

async function toggleTouchFullscreenMode() {
  try {
    if (isFullscreenActive()) {
      await exitFullscreenMode();
    } else {
      await enterFullscreenMode();
    }
  } catch (err) {
    console.error('Не удалось переключить полноэкранный режим', err);
    setStatus('Не удалось включить полноэкранный режим.');
  } finally {
    updateTouchFullscreenToggleState();
  }
}

function initTouchFullscreenToggle() {
  if (!touchFullscreenToggleBtn) return;

  const shouldShow = hasFullscreenSupport() && isTouchFullscreenPreferredDevice();
  touchFullscreenToggleBtn.hidden = !shouldShow;
  if (!shouldShow) return;

  touchFullscreenToggleBtn.addEventListener('click', toggleTouchFullscreenMode);
  document.addEventListener('fullscreenchange', updateTouchFullscreenToggleState);
  document.addEventListener('webkitfullscreenchange', updateTouchFullscreenToggleState);
  updateTouchFullscreenToggleState();
}

function loadSetting(key, fallback) {
  const value = localStorage.getItem(key);
  return value !== null ? value : fallback;
}

function saveSetting(key, value) {
  localStorage.setItem(key, value);
}

function loadBooleanSetting(key, fallback = false) {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === 'true';
}

function setNowPlayingProgress(percent) {
  if (!nowPlayingProgressEl) return;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  nowPlayingProgressEl.style.setProperty('--progress-ratio', String(safePercent / 100));
}

function setNowPlayingReelActive(active, paused = false) {
  const isActive = Boolean(active);
  const isPaused = Boolean(paused);
  if (nowPlayingControlBtn) {
    nowPlayingControlBtn.classList.toggle('has-active-track', isActive);
    nowPlayingControlBtn.classList.toggle('is-paused', isActive && isPaused);
  }
  if (nowPlayingReelEl) {
    nowPlayingReelEl.hidden = !isActive;
  }
}

function formatNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  return formatDuration(seconds, { useCeil });
}

function setNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!nowPlayingTimeEl) return;
  nowPlayingTimeEl.textContent = formatNowPlayingTime(seconds, { useCeil });
}

function setHostNowPlayingProgress(percent) {
  if (!hostNowPlayingProgressEl) return;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  hostNowPlayingProgressEl.style.setProperty('--progress-ratio', String(safePercent / 100));
}

function setHostNowPlayingReelActive(active, paused = false) {
  const isActive = Boolean(active);
  const isPaused = Boolean(paused);
  if (hostNowPlayingControlEl) {
    hostNowPlayingControlEl.classList.toggle('has-active-track', isActive);
    hostNowPlayingControlEl.classList.toggle('is-paused', isActive && isPaused);
  }
  if (hostNowPlayingReelEl) {
    hostNowPlayingReelEl.hidden = !isActive;
  }
}

function setHostNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!hostNowPlayingTimeEl) return;
  hostNowPlayingTimeEl.textContent = formatNowPlayingTime(seconds, { useCeil });
}

function setDapNowPlayingProgress(percent) {
  if (!dapNowPlayingProgressEl) return;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  dapNowPlayingProgressEl.style.setProperty('--progress-ratio', String(safePercent / 100));
}

function setDapNowPlayingReelActive(active, paused = false) {
  const isActive = Boolean(active);
  const isPaused = Boolean(paused);
  if (dapNowPlayingControlEl) {
    dapNowPlayingControlEl.classList.toggle('has-active-track', isActive);
    dapNowPlayingControlEl.classList.toggle('is-paused', isActive && isPaused);
  }
  if (dapNowPlayingReelEl) {
    dapNowPlayingReelEl.hidden = !isActive;
  }
}

function setDapNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!dapNowPlayingTimeEl) return;
  dapNowPlayingTimeEl.textContent = formatNowPlayingTime(seconds, { useCeil });
}

function formatDuration(seconds, { useCeil = false } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const rounded = useCeil ? Math.ceil(seconds) : Math.floor(seconds);
  const totalSeconds = Math.max(0, rounded);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
}

function formatPlaylistDuration(seconds) {
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

function normalizePlaylistTrackIndex(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function sanitizeIncomingDapPlaybackState(rawState) {
  const base = getDefaultDapPlaybackState();
  if (!rawState || typeof rawState !== 'object') {
    return base;
  }

  const rawTrackFile = typeof rawState.trackFile === 'string' ? rawState.trackFile.trim() : '';
  if (!rawTrackFile) {
    const updatedAt = Number(rawState.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0) {
      base.updatedAt = updatedAt;
    }
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
  return {
    trackFile: rawTrackFile,
    paused: Boolean(rawState.paused),
    currentTime,
    duration,
    playlistIndex: normalizePlaylistTrackIndex(rawState.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(rawState.playlistPosition),
    interrupted: Boolean(rawState.interrupted),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
  };
}

function sanitizeIncomingHostPlaybackState(rawState) {
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
  if (!rawTrackFile) {
    base.dapPlayback = sanitizeIncomingDapPlaybackState(rawState.dapPlayback);
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

  return {
    trackFile: rawTrackFile,
    paused: Boolean(rawState.paused),
    currentTime,
    duration,
    volume: base.volume,
    showVolumePresets: base.showVolumePresets,
    allowLiveSeek: base.allowLiveSeek,
    dapPlayback: sanitizeIncomingDapPlaybackState(rawState.dapPlayback),
    playlistIndex: normalizePlaylistTrackIndex(rawState.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(rawState.playlistPosition),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    sourceClientId,
  };
}

function serializeHostPlaybackState(state) {
  const normalized = sanitizeIncomingHostPlaybackState(state);
  return JSON.stringify({
    trackFile: normalized.trackFile,
    paused: normalized.paused,
    currentTime: normalized.currentTime,
    duration: normalized.duration,
    volume: normalized.volume,
    showVolumePresets: normalized.showVolumePresets,
    allowLiveSeek: normalized.allowLiveSeek,
    dapPlayback: {
      trackFile: normalized.dapPlayback.trackFile,
      paused: normalized.dapPlayback.paused,
      currentTime: normalized.dapPlayback.currentTime,
      duration: normalized.dapPlayback.duration,
      playlistIndex: normalized.dapPlayback.playlistIndex,
      playlistPosition: normalized.dapPlayback.playlistPosition,
      interrupted: normalized.dapPlayback.interrupted,
    },
    playlistIndex: normalized.playlistIndex,
    playlistPosition: normalized.playlistPosition,
    updatedAt: normalized.updatedAt,
  });
}

function getKnownDurationSeconds(fileKey) {
  const value = state.knownTrackDurations.get(fileKey);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function getCurrentTrackRemainingSeconds() {
  if (!state.currentTrack || !state.currentAudio) return null;
  const duration = getDuration(state.currentAudio);
  if (!duration) {
    return getKnownDurationSeconds(state.currentTrack.key);
  }

  const currentTime = Number.isFinite(state.currentAudio.currentTime) ? state.currentAudio.currentTime : 0;
  return Math.max(0, duration - Math.max(0, currentTime));
}

function isTrackPlaybackContextEqual(leftContext = null, rightContext = null) {
  const left = normalizeTrackPlaybackContext(leftContext);
  const right = normalizeTrackPlaybackContext(rightContext);
  if (left.playlistIndex === null || left.playlistPosition === null) return false;
  if (right.playlistIndex === null || right.playlistPosition === null) return false;
  return left.playlistIndex === right.playlistIndex && left.playlistPosition === right.playlistPosition;
}

function resolveDurationLabelPlaybackContext(label) {
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

function getDapInterruptedPlaybackDisplayState(config = state.dapConfig) {
  const interruptedTrack = resolveDapInterruptedPlaybackTrack(config);
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

function getHostDapInterruptedPlaybackDisplayState() {
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

function getVisibleDapInterruptedPlaybackDisplayState(config = state.dapConfig) {
  if (isHostRole()) {
    return getDapInterruptedPlaybackDisplayState(config);
  }
  return getHostDapInterruptedPlaybackDisplayState();
}

function buildDapPlaybackSnapshotForSync(config = state.dapConfig) {
  const snapshot = getDefaultDapPlaybackState();

  if (state.currentTrack && state.currentAudio && isDapTrackContext(state.currentTrack, config) && typeof state.currentTrack.file === 'string') {
    const trackFile = state.currentTrack.file.trim();
    if (trackFile) {
      const rawCurrentTime = Number(state.currentAudio.currentTime);
      let currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;
      const resolvedDuration = getDuration(state.currentAudio) || getKnownDurationSeconds(state.currentTrack.key);
      const duration = Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : null;
      if (duration !== null && currentTime > duration) {
        currentTime = duration;
      }
      return {
        trackFile,
        paused: Boolean(state.currentAudio.paused),
        currentTime,
        duration,
        playlistIndex: normalizePlaylistTrackIndex(state.currentTrack.playlistIndex),
        playlistPosition: normalizePlaylistTrackIndex(state.currentTrack.playlistPosition),
        interrupted: false,
        updatedAt: Date.now(),
      };
    }
  }

  const interruptedTrack = resolveDapInterruptedPlaybackTrack(config);
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
    paused: true,
    currentTime,
    duration,
    playlistIndex: normalizePlaylistTrackIndex(interruptedTrack.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(interruptedTrack.playlistPosition),
    interrupted: true,
    updatedAt: Date.now(),
  };
}

function getDapPlaybackElapsedSeconds(playbackState) {
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

function getHostPlaybackElapsedSeconds() {
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

function getProgressUiFrameIntervalMs() {
  if (typeof window !== 'object' || typeof window.matchMedia !== 'function') return 0;
  return window.matchMedia('(pointer: coarse)').matches ? MOBILE_PROGRESS_UI_MIN_INTERVAL_MS : 0;
}

function clearHostTrackHighlight() {
  for (const cards of state.cardsByFile.values()) {
    if (!cards || !cards.size) continue;
    for (const card of cards) {
      card.classList.remove('is-host-playing', 'is-host-paused');
    }
  }
}

function clearLiveDspNextTrackHighlight() {
  for (const cards of state.cardsByFile.values()) {
    if (!cards || !cards.size) continue;
    for (const card of cards) {
      card.classList.remove('is-dsp-next-ready');
    }
  }
}

function normalizeTrackPlaybackContext(playbackContext = null) {
  return {
    playlistIndex: normalizePlaylistTrackIndex(playbackContext ? playbackContext.playlistIndex : null),
    playlistPosition: normalizePlaylistTrackIndex(playbackContext ? playbackContext.playlistPosition : null),
  };
}

function resolveTrackContextInLayoutByFile(
  file,
  { preferredPlaylistIndex = null, preferredPlaylistPosition = null } = {},
) {
  const normalizedFile = typeof file === 'string' ? file.trim() : '';
  if (!normalizedFile) return null;

  const normalizedLayout = ensurePlaylists(state.layout);
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

function reconcileTrackContextWithLayout(track, { preferredPlaylistIndex = null } = {}) {
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

function reconcileDapInterruptedSnapshotWithLayout() {
  if (!state.dapInterruptedPlaybackSnapshot || typeof state.dapInterruptedPlaybackSnapshot !== 'object') return false;

  const dapPlaylistIndex = getDapPlaylistIndex(state.dapConfig);
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

function buildPlaylistSelectionIdentity(layoutState, metaState, playlistIndex) {
  const normalizedLayout = ensurePlaylists(layoutState);
  const normalizedIndex = normalizePlaylistTrackIndex(playlistIndex);
  if (normalizedIndex === null || normalizedIndex < 0 || normalizedIndex >= normalizedLayout.length) return '';

  const normalizedMeta = normalizePlaylistMeta(metaState, normalizedLayout.length);
  const metaEntry = normalizedMeta[normalizedIndex] || defaultPlaylistMeta();
  const playlist = Array.isArray(normalizedLayout[normalizedIndex]) ? normalizedLayout[normalizedIndex] : [];
  return JSON.stringify({
    type: metaEntry.type,
    folderKey: metaEntry.type === PLAYLIST_TYPE_FOLDER ? metaEntry.folderKey || '' : '',
    files: playlist,
  });
}

function buildLiveDspNextTrackDescriptor(trackFile, playbackContext = null, basePath = '/audio') {
  const { playlistIndex, playlistPosition } = normalizeTrackPlaybackContext(playbackContext);
  if (typeof trackFile !== 'string' || !trackFile.trim()) return '';
  if (playlistIndex === null || playlistPosition === null) return '';
  const fileKey = trackKey(trackFile, basePath);
  return [fileKey, String(playlistIndex), String(playlistPosition)].join('|');
}

function parseLiveDspNextTrackDescriptor(descriptor) {
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

function resetLiveDspNextTrackPreview() {
  state.liveDspRenderToken += 1;
  state.liveDspNextReadyDescriptor = '';
  state.liveDspNextReadySliceSeconds = null;
  clearLiveDspContinuationWarmups();
  syncLiveDspNextTrackHighlight();
}

function isDspTransitionPlaybackActive() {
  return Boolean(state.dspTransitionPlayback && state.dspTransitionPlayback.audio);
}

function clearDspTransitionTrackHighlight() {
  for (const cards of state.cardsByFile.values()) {
    if (!cards || !cards.size) continue;
    for (const card of cards) {
      card.classList.remove('is-dsp-transition-source', 'is-dsp-transition-target');
    }
  }
}

function setDspTransitionReelReverse(active) {
  const enabled = Boolean(active);
  if (nowPlayingControlBtn) {
    nowPlayingControlBtn.classList.toggle('is-dsp-transition-reverse', enabled);
  }
  if (hostNowPlayingControlEl) {
    hostNowPlayingControlEl.classList.toggle('is-dsp-transition-reverse', enabled);
  }
}

function stopDspTransitionPlayback({ stopAudio = true, clearTrackState = true } = {}) {
  if (!state.dspTransitionPlayback) return;

  const activePlayback = state.dspTransitionPlayback;
  state.dspTransitionPlayback = null;
  setDspTransitionReelReverse(false);
  clearDspTransitionTrackHighlight();

  if (clearTrackState) {
    const sourceTrack = activePlayback.fromTrack || null;
    const targetTrack = activePlayback.toTrack || null;
    if (sourceTrack && sourceTrack.key) {
      setButtonPlaying(sourceTrack.key, false, sourceTrack);
      setTrackPaused(sourceTrack.key, false, sourceTrack);
    }
    if (targetTrack && targetTrack.key) {
      setButtonPlaying(targetTrack.key, false, targetTrack);
      setTrackPaused(targetTrack.key, false, targetTrack);
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

function buildHostTrackHighlightDescriptor() {
  if (!isRemoteLiveMirrorRole()) return 'none';
  if (!state.hostPlaybackState || !state.hostPlaybackState.trackFile) return 'none';

  const playlistIndex = normalizePlaylistTrackIndex(state.hostPlaybackState.playlistIndex);
  const playlistPosition = normalizePlaylistTrackIndex(state.hostPlaybackState.playlistPosition);
  return [
    trackKey(state.hostPlaybackState.trackFile, '/audio'),
    playlistIndex === null ? '' : String(playlistIndex),
    playlistPosition === null ? '' : String(playlistPosition),
    state.hostPlaybackState.paused ? 'paused' : 'playing',
  ].join('|');
}

function getTrackDurationTextByKey(fileKey, playbackContext = null) {
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

function refreshTrackDurationLabels(fileKey) {
  if (!fileKey) return;
  const labels = state.durationLabelsByFile.get(fileKey);
  if (!labels || !labels.size) return;

  for (const label of labels) {
    const context = resolveDurationLabelPlaybackContext(label);
    label.textContent = getTrackDurationTextByKey(fileKey, context);
  }
}

function getPlaylistTotalDurationSeconds(playlistIndex) {
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

function getPlaylistDurationText(playlistIndex) {
  return formatPlaylistDuration(getPlaylistTotalDurationSeconds(playlistIndex));
}

function refreshPlaylistDurationLabel(playlistIndex) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return;
  const label = state.playlistDurationLabelsByIndex.get(playlistIndex);
  if (!label) return;
  label.textContent = getPlaylistDurationText(playlistIndex);
}

function refreshAllPlaylistDurationLabels() {
  for (const playlistIndex of state.playlistDurationLabelsByIndex.keys()) {
    refreshPlaylistDurationLabel(playlistIndex);
  }
}

function cacheTrackDuration(fileKey, durationSeconds) {
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

function loadTrackDurationMetadata(file, basePath = '/audio') {
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
      const durationValue = getDuration(probe);
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

function preloadTrackDurations(files, basePath = '/audio') {
  if (!Array.isArray(files) || files.length === 0) return;
  files.forEach((file) => {
    if (typeof file !== 'string' || !file.trim()) return;
    loadTrackDurationMetadata(file, basePath).catch(() => {});
  });
}

function keepKnownDurationsForFiles(files, basePath = '/audio') {
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

function stopAndClearLocalPlayback() {
  if (isDspTransitionPlaybackActive()) {
    stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
  }

  if (state.currentAudio) {
    try {
      state.currentAudio.pause();
    } catch (err) {
      // ignore audio pause errors during role switch
    }
  }

  if (state.currentTrack) {
    setButtonPlaying(state.currentTrack.key, false, state.currentTrack);
    setTrackPaused(state.currentTrack.key, false, state.currentTrack);
    resetProgress(state.currentTrack.key);
  }

  resetFadeState();
  stopProgressLoop();
  state.currentAudio = null;
  state.currentTrack = null;
  stopUnexpectedLiveAudios([]);
  resetLiveDspNextTrackPreview();
  clearDapInterruptedPlaybackSnapshot();
  syncNowPlayingPanel();
}

function getCurrentTrackDurationSeconds() {
  if (!state.currentTrack || !state.currentAudio) return null;
  return getDuration(state.currentAudio) || getKnownDurationSeconds(state.currentTrack.key);
}

function getHostPlaybackDurationSeconds() {
  const duration = Number(state.hostPlaybackState && state.hostPlaybackState.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return duration;
}

function getDspTransitionDurationSeconds() {
  if (!isDspTransitionPlaybackActive()) return null;
  const playback = state.dspTransitionPlayback;
  const transitionAudio = playback && playback.audio ? playback.audio : null;
  if (!transitionAudio) return null;

  const resolvedDuration =
    getDuration(transitionAudio) ||
    (Number.isFinite(playback.duration) && playback.duration > 0 ? playback.duration : null);
  if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) return null;

  playback.duration = resolvedDuration;
  return resolvedDuration;
}

function seekDspTransitionPlaybackByRatio(positionRatio) {
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

function canPanZonesContainer() {
  if (!zonesContainer) return false;
  return zonesContainer.scrollWidth - zonesContainer.clientWidth > 1;
}

function stopZonesPanMomentum() {
  if (state.zonesPanMomentumRaf === null) return;
  cancelAnimationFrame(state.zonesPanMomentumRaf);
  state.zonesPanMomentumRaf = null;
}

function stopZonesWheelSmoothScroll() {
  if (state.zonesWheelSmoothRaf !== null) {
    cancelAnimationFrame(state.zonesWheelSmoothRaf);
    state.zonesWheelSmoothRaf = null;
  }
  state.zonesWheelTargets.clear();
}

function runZonesWheelSmoothStep() {
  state.zonesWheelSmoothRaf = null;
  if (!zonesContainer || !state.zonesWheelTargets.size) {
    state.zonesWheelTargets.clear();
    return;
  }

  let hasPending = false;
  const activeBodies = new Set(getZoneBodies());

  for (const [body, targetValue] of state.zonesWheelTargets.entries()) {
    if (!(body instanceof HTMLElement) || !activeBodies.has(body)) {
      state.zonesWheelTargets.delete(body);
      continue;
    }

    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const target = Math.max(0, Math.min(maxScrollTop, Number.isFinite(targetValue) ? targetValue : body.scrollTop));
    const current = body.scrollTop;
    const delta = target - current;

    if (Math.abs(delta) <= ZONES_WHEEL_SMOOTH_MIN_DELTA_PX) {
      body.scrollTop = target;
      state.zonesWheelTargets.delete(body);
      continue;
    }

    body.scrollTop = current + delta * ZONES_WHEEL_SMOOTH_EASE;
    state.zonesWheelTargets.set(body, target);
    hasPending = true;
  }

  if (hasPending && state.zonesWheelTargets.size) {
    state.zonesWheelSmoothRaf = requestAnimationFrame(runZonesWheelSmoothStep);
  }
}

function scheduleZonesWheelSmoothScroll() {
  if (state.zonesWheelSmoothRaf !== null) return;
  state.zonesWheelSmoothRaf = requestAnimationFrame(runZonesWheelSmoothStep);
}

function startZonesPanMomentum(initialVelocityPxPerMs) {
  if (!zonesContainer) return;
  stopZonesPanMomentum();

  let velocity = Number.isFinite(initialVelocityPxPerMs) ? initialVelocityPxPerMs : 0;
  if (Math.abs(velocity) < ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) return;

  let previousTimestamp = performance.now();

  const step = (timestamp) => {
    if (!zonesContainer) {
      state.zonesPanMomentumRaf = null;
      return;
    }

    const deltaMs = Math.max(1, timestamp - previousTimestamp);
    previousTimestamp = timestamp;

    const maxScrollLeft = Math.max(0, zonesContainer.scrollWidth - zonesContainer.clientWidth);
    if (maxScrollLeft <= 0) {
      state.zonesPanMomentumRaf = null;
      return;
    }

    const previousScrollLeft = zonesContainer.scrollLeft;
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, previousScrollLeft + velocity * deltaMs));
    zonesContainer.scrollLeft = nextScrollLeft;

    const hitBoundary = Math.abs(nextScrollLeft - previousScrollLeft) < 0.01;
    if (hitBoundary) {
      state.zonesPanMomentumRaf = null;
      return;
    }

    const decay = Math.pow(ZONES_PAN_TOUCH_MOMENTUM_DECAY_PER_FRAME, deltaMs / 16);
    velocity *= decay;

    if (Math.abs(velocity) < ZONES_PAN_TOUCH_MOMENTUM_STOP_SPEED_PX_PER_MS) {
      state.zonesPanMomentumRaf = null;
      return;
    }

    state.zonesPanMomentumRaf = requestAnimationFrame(step);
  };

  state.zonesPanMomentumRaf = requestAnimationFrame(step);
}

function getZoneBodies() {
  if (!zonesContainer) return [];
  return state.zoneBodiesCache;
}

function normalizeWheelDeltaPixels(event) {
  if (!event) return { deltaX: 0, deltaY: 0 };
  let factor = 1;
  if (event.deltaMode === 1) {
    factor = 16;
  } else if (event.deltaMode === 2) {
    factor = window.innerHeight || 800;
  }
  return {
    deltaX: Number.isFinite(event.deltaX) ? event.deltaX * factor : 0,
    deltaY: Number.isFinite(event.deltaY) ? event.deltaY * factor : 0,
  };
}

function applySharedZonesVerticalScroll(deltaY, { smooth = false } = {}) {
  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.01) return false;

  let changed = false;
  const bodies = getZoneBodies();
  for (const body of bodies) {
    if (!(body instanceof HTMLElement)) continue;

    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    if (maxScrollTop <= 0) continue;

    if (smooth) {
      const previousTarget = state.zonesWheelTargets.has(body) ? state.zonesWheelTargets.get(body) : body.scrollTop;
      const nextTarget = Math.max(0, Math.min(maxScrollTop, previousTarget + deltaY));
      if (Math.abs(nextTarget - previousTarget) < 0.01 && Math.abs(nextTarget - body.scrollTop) < 0.01) continue;
      state.zonesWheelTargets.set(body, nextTarget);
      changed = true;
      continue;
    }

    const previousScrollTop = body.scrollTop;
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, previousScrollTop + deltaY));
    if (Math.abs(nextScrollTop - previousScrollTop) < 0.01) continue;
    body.scrollTop = nextScrollTop;
    changed = true;
  }

  if (smooth && changed) {
    scheduleZonesWheelSmoothScroll();
  }

  return changed;
}

function onZonesWheel(event) {
  if (!zonesContainer) return;
  if (!event) return;
  if (event.ctrlKey) return;
  if (state.draggingCard || state.touchCopyDragActive) return;

  const target = event.target instanceof Element ? event.target : null;
  if (!target || !zonesContainer.contains(target)) return;

  const { deltaX, deltaY } = normalizeWheelDeltaPixels(event);
  if (Math.abs(deltaY) < Math.abs(deltaX)) {
    return;
  }

  if (applySharedZonesVerticalScroll(deltaY, { smooth: true })) {
    event.preventDefault();
  }
}

function getTouchMidpoint(touches) {
  if (!touches || touches.length < 2) return null;
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return null;
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function getTouchByIdentifier(touches, identifier) {
  if (!touches || !Number.isFinite(identifier)) return null;
  for (let index = 0; index < touches.length; index += 1) {
    const touch = typeof touches.item === 'function' ? touches.item(index) : touches[index];
    if (touch && touch.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

function resetZonesFreeAreaTapTracking({ resetTapCount = false } = {}) {
  state.zonesFreeAreaTapCandidate = null;
  if (!resetTapCount) return;
  state.zonesFreeAreaTapCount = 0;
  state.zonesFreeAreaLastTapAt = 0;
  state.zonesFreeAreaLastTapX = 0;
  state.zonesFreeAreaLastTapY = 0;
}

function onZonesFreeAreaTapStart(event) {
  if (!isTouchPlaylistCollapseEnabled()) return;
  if (!event || !event.touches) return;
  if (event.touches.length !== 1) {
    resetZonesFreeAreaTapTracking({ resetTapCount: event.touches.length > 1 });
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (!isZonesPanFreeAreaTarget(target)) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  const touch = event.touches[0];
  if (!touch) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  state.zonesFreeAreaTapCandidate = {
    identifier: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    startedAt: Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(),
  };
}

function onZonesFreeAreaTapMove(event) {
  if (!state.zonesFreeAreaTapCandidate || !event || !event.touches) return;
  if (event.touches.length !== 1) {
    resetZonesFreeAreaTapTracking({ resetTapCount: event.touches.length > 1 });
    return;
  }

  const candidateTouch = getTouchByIdentifier(event.touches, state.zonesFreeAreaTapCandidate.identifier);
  if (!candidateTouch) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  const deltaX = candidateTouch.clientX - state.zonesFreeAreaTapCandidate.startX;
  const deltaY = candidateTouch.clientY - state.zonesFreeAreaTapCandidate.startY;
  if (Math.hypot(deltaX, deltaY) > COLLAPSED_PLAYLIST_TAP_MOVE_TOLERANCE_PX) {
    resetZonesFreeAreaTapTracking();
  }
}

function registerZonesFreeAreaTap(clientX, clientY, eventTime, event) {
  const timestamp = Number.isFinite(eventTime) ? eventTime : performance.now();
  const withinWindow = timestamp - state.zonesFreeAreaLastTapAt <= COLLAPSED_PLAYLIST_TRIPLE_TAP_WINDOW_MS;
  const nearPreviousTap =
    Math.hypot(clientX - state.zonesFreeAreaLastTapX, clientY - state.zonesFreeAreaLastTapY) <=
    COLLAPSED_PLAYLIST_TRIPLE_TAP_DISTANCE_PX;
  state.zonesFreeAreaTapCount = withinWindow && nearPreviousTap ? state.zonesFreeAreaTapCount + 1 : 1;
  state.zonesFreeAreaLastTapAt = timestamp;
  state.zonesFreeAreaLastTapX = clientX;
  state.zonesFreeAreaLastTapY = clientY;

  if (state.zonesFreeAreaTapCount < 3) return;

  resetZonesFreeAreaTapTracking({ resetTapCount: true });
  if (state.collapsedPlaylistsOverlayEl) {
    hideCollapsedPlaylistsOverlay();
  } else {
    showCollapsedPlaylistsOverlay();
  }
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
}

function onZonesFreeAreaTapEnd(event) {
  if (!isTouchPlaylistCollapseEnabled()) return;
  if (!state.zonesFreeAreaTapCandidate || !event || !event.changedTouches) return;
  if (state.zonesTouchPanActive || state.zonesPanActive || state.draggingCard || state.touchCopyDragActive) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  const completedTouch = getTouchByIdentifier(event.changedTouches, state.zonesFreeAreaTapCandidate.identifier);
  const candidate = state.zonesFreeAreaTapCandidate;
  state.zonesFreeAreaTapCandidate = null;
  if (!completedTouch) return;

  const finishedAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  if (finishedAt - candidate.startedAt > COLLAPSED_PLAYLIST_TAP_MAX_DURATION_MS) return;
  const deltaX = completedTouch.clientX - candidate.startX;
  const deltaY = completedTouch.clientY - candidate.startY;
  if (Math.hypot(deltaX, deltaY) > COLLAPSED_PLAYLIST_TAP_MOVE_TOLERANCE_PX) return;

  registerZonesFreeAreaTap(completedTouch.clientX, completedTouch.clientY, finishedAt, event);
}

function onZonesFreeAreaTapCancel() {
  resetZonesFreeAreaTapTracking();
}

function cleanupZonesTouchPanInteraction() {
  if (zonesContainer) {
    zonesContainer.classList.remove('is-pan-scrolling');
  }

  state.zonesTouchPanActive = false;
  state.zonesTouchPanMoved = false;
  state.zonesTouchPanStartMidX = 0;
  state.zonesTouchPanStartMidY = 0;
  state.zonesTouchPanStartScrollLeft = 0;
  state.zonesTouchPanLastMidX = 0;
  state.zonesTouchPanLastAt = 0;
  state.zonesTouchPanVelocityX = 0;
}

function onZonesTouchStart(event) {
  if (!zonesContainer) return;
  if (!event || !event.touches) return;
  if (state.draggingCard || state.touchCopyDragActive) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  onZonesFreeAreaTapStart(event);

  if (!canPanZonesContainer()) return;
  if (event.touches.length !== 2) return;

  if (!areZonesTouchPanTouchesEligible(event.touches)) return;

  const midpoint = getTouchMidpoint(event.touches);
  if (!midpoint) return;

  stopZonesPanMomentum();
  stopZonesWheelSmoothScroll();
  cleanupZonesTouchPanInteraction();

  state.zonesTouchPanActive = true;
  state.zonesTouchPanMoved = false;
  state.zonesTouchPanStartMidX = midpoint.x;
  state.zonesTouchPanStartMidY = midpoint.y;
  state.zonesTouchPanStartScrollLeft = zonesContainer.scrollLeft;
  state.zonesTouchPanLastMidX = midpoint.x;
  state.zonesTouchPanLastAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  state.zonesTouchPanVelocityX = 0;
  event.preventDefault();
}

function areZonesTouchPanTouchesEligible(touches) {
  if (!zonesContainer || !touches || touches.length < 2) return false;
  for (let index = 0; index < touches.length; index += 1) {
    const touch = typeof touches.item === 'function' ? touches.item(index) : touches[index];
    if (!touch || !(touch.target instanceof Element)) return false;
    if (!zonesContainer.contains(touch.target)) return false;
  }
  return true;
}

function onZonesTouchMove(event) {
  if (!event || !event.touches) return;
  onZonesFreeAreaTapMove(event);
  if (!state.zonesTouchPanActive) return;
  if (!zonesContainer) return;

  if (event.touches.length < 2) {
    const momentumVelocity = state.zonesTouchPanMoved ? -state.zonesTouchPanVelocityX * ZONES_TWO_FINGER_PAN_TOUCH_GAIN : 0;
    cleanupZonesTouchPanInteraction();
    if (Math.abs(momentumVelocity) >= ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) {
      startZonesPanMomentum(momentumVelocity);
    }
    return;
  }

  const midpoint = getTouchMidpoint(event.touches);
  if (!midpoint) return;

  const nowTimestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const sampleDeltaMs = nowTimestamp - state.zonesTouchPanLastAt;
  if (Number.isFinite(sampleDeltaMs) && sampleDeltaMs > 0) {
    const sampleVelocityX = (midpoint.x - state.zonesTouchPanLastMidX) / sampleDeltaMs;
    state.zonesTouchPanVelocityX = state.zonesTouchPanVelocityX * 0.7 + sampleVelocityX * 0.3;
  }
  state.zonesTouchPanLastMidX = midpoint.x;
  state.zonesTouchPanLastAt = nowTimestamp;

  const deltaX = midpoint.x - state.zonesTouchPanStartMidX;
  const deltaY = midpoint.y - state.zonesTouchPanStartMidY;

  if (!state.zonesTouchPanMoved) {
    const dragThreshold = 2;
    if (Math.abs(deltaX) < dragThreshold && Math.abs(deltaY) < dragThreshold) return;
    const verticalDominanceRatio = 2.6;
    if (Math.abs(deltaY) > Math.abs(deltaX) * verticalDominanceRatio) {
      cleanupZonesTouchPanInteraction();
      return;
    }
  }

  state.zonesTouchPanMoved = true;
  zonesContainer.classList.add('is-pan-scrolling');
  event.preventDefault();
  zonesContainer.scrollLeft = state.zonesTouchPanStartScrollLeft - deltaX * ZONES_TWO_FINGER_PAN_TOUCH_GAIN;
}

function onZonesTouchEnd(event) {
  onZonesFreeAreaTapEnd(event);
  if (!state.zonesTouchPanActive) return;
  const hasEnoughTouches = Boolean(event && event.touches && event.touches.length >= 2);
  if (hasEnoughTouches) return;

  const momentumVelocity = state.zonesTouchPanMoved ? -state.zonesTouchPanVelocityX * ZONES_TWO_FINGER_PAN_TOUCH_GAIN : 0;
  cleanupZonesTouchPanInteraction();
  if (Math.abs(momentumVelocity) >= ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) {
    startZonesPanMomentum(momentumVelocity);
  }
}

function onZonesTouchCancel() {
  onZonesFreeAreaTapCancel();
  if (!state.zonesTouchPanActive) return;
  cleanupZonesTouchPanInteraction();
}

function isZonesPanFreeAreaTarget(target) {
  if (!(target instanceof Element)) return false;
  if (!zonesContainer || !zonesContainer.contains(target)) return false;
  if (target.closest('.track-card')) return false;
  if (target.closest('button, input, textarea, select, a, label')) return false;
  return true;
}

function cleanupZonesPanInteraction() {
  if (zonesContainer) {
    zonesContainer.classList.remove('is-pan-scrolling');
    if (state.zonesPanPointerId !== null && typeof zonesContainer.releasePointerCapture === 'function') {
      try {
        if (zonesContainer.hasPointerCapture && zonesContainer.hasPointerCapture(state.zonesPanPointerId)) {
          zonesContainer.releasePointerCapture(state.zonesPanPointerId);
        }
      } catch (err) {
        // ignore pointer capture release errors
      }
    }
  }

  state.zonesPanActive = false;
  state.zonesPanMoved = false;
  state.zonesPanPointerId = null;
  state.zonesPanStartX = 0;
  state.zonesPanStartY = 0;
  state.zonesPanStartScrollLeft = 0;
  state.zonesPanPreferHorizontal = false;
  state.zonesPanPointerType = '';
  state.zonesPanMoveGain = 1;
  state.zonesPanLastX = 0;
  state.zonesPanLastAt = 0;
  state.zonesPanVelocityX = 0;
  window.removeEventListener('pointermove', onZonesPanPointerMove, true);
  window.removeEventListener('pointerup', onZonesPanPointerUp, true);
  window.removeEventListener('pointercancel', onZonesPanPointerCancel, true);
}

function onZonesPanPointerMove(event) {
  if (!state.zonesPanActive || event.pointerId !== state.zonesPanPointerId) return;
  if (!zonesContainer) return;
  if (isDesktopDragHoldReadyForPointer(event.pointerId)) return;

  const deltaX = event.clientX - state.zonesPanStartX;
  const deltaY = event.clientY - state.zonesPanStartY;
  const nowTimestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const sampleDeltaMs = nowTimestamp - state.zonesPanLastAt;
  if (Number.isFinite(sampleDeltaMs) && sampleDeltaMs > 0) {
    const sampleVelocityX = (event.clientX - state.zonesPanLastX) / sampleDeltaMs;
    state.zonesPanVelocityX = state.zonesPanVelocityX * 0.7 + sampleVelocityX * 0.3;
  }
  state.zonesPanLastX = event.clientX;
  state.zonesPanLastAt = nowTimestamp;

  if (!state.zonesPanMoved) {
    const dragThreshold = state.zonesPanPreferHorizontal ? Math.max(2, Math.floor(ZONES_PAN_DRAG_THRESHOLD_PX / 2)) : ZONES_PAN_DRAG_THRESHOLD_PX;
    if (Math.abs(deltaX) < dragThreshold && Math.abs(deltaY) < dragThreshold) {
      return;
    }
    const verticalDominanceRatio = state.zonesPanPreferHorizontal ? 2.6 : 1;
    if (Math.abs(deltaY) > Math.abs(deltaX) * verticalDominanceRatio) {
      // Vertical gesture: keep native vertical scroll behavior.
      cleanupZonesPanInteraction();
      return;
    }
  }

  state.zonesPanMoved = true;
  zonesContainer.classList.add('is-pan-scrolling');
  event.preventDefault();
  zonesContainer.scrollLeft = state.zonesPanStartScrollLeft - deltaX * state.zonesPanMoveGain;
}

function onZonesPanPointerUp(event) {
  if (!state.zonesPanActive || event.pointerId !== state.zonesPanPointerId) return;
  const shouldUseMomentum = state.zonesPanMoved && state.zonesPanPointerType === 'touch';
  const momentumVelocity = shouldUseMomentum ? -state.zonesPanVelocityX * zonesPanMoveGain : 0;
  cleanupZonesPanInteraction();
  if (shouldUseMomentum) {
    startZonesPanMomentum(momentumVelocity);
  }
}

function onZonesPanPointerCancel(event) {
  if (!state.zonesPanActive || event.pointerId !== state.zonesPanPointerId) return;
  cleanupZonesPanInteraction();
}

function onZonesPanPointerDown(event) {
  if (!zonesContainer) return;
  if (!event.isPrimary) return;
  if (event.pointerType === 'touch') return;
  if (event.button !== undefined && event.button !== 0) return;
  if (!canPanZonesContainer()) return;
  if (state.draggingCard || state.touchCopyDragActive) return;
  if (!isZonesPointerPanTarget(event.target instanceof Element ? event.target : null)) return;

  stopZonesPanMomentum();
  stopZonesWheelSmoothScroll();

  if (state.zonesPanActive) {
    cleanupZonesPanInteraction();
  }

  state.zonesPanActive = true;
  state.zonesPanMoved = false;
  state.zonesPanPointerId = event.pointerId;
  state.zonesPanStartX = event.clientX;
  state.zonesPanStartY = event.clientY;
  state.zonesPanStartScrollLeft = zonesContainer.scrollLeft;
  const targetElement = event.target instanceof Element ? event.target : null;
  state.zonesPanPreferHorizontal = Boolean(
    targetElement &&
      targetElement.closest('.zone-body') &&
      !targetElement.closest('.playlist-header, button, input, textarea, select, a, label'),
  );
  state.zonesPanPointerType = typeof event.pointerType === 'string' ? event.pointerType : '';
  state.zonesPanMoveGain =
    state.zonesPanPointerType === 'touch' && state.zonesPanPreferHorizontal
      ? ZONES_PAN_TOUCH_GAIN
      : 1;
  state.zonesPanLastX = event.clientX;
  state.zonesPanLastAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  state.zonesPanVelocityX = 0;

  const shouldCapturePointer =
    !(targetElement && targetElement.closest('.track-card')) && typeof zonesContainer.setPointerCapture === 'function';
  if (shouldCapturePointer) {
    try {
      zonesContainer.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors
    }
  }

  window.addEventListener('pointermove', onZonesPanPointerMove, true);
  window.addEventListener('pointerup', onZonesPanPointerUp, true);
  window.addEventListener('pointercancel', onZonesPanPointerCancel, true);
}

function isZonesPointerPanTarget(target) {
  if (!(target instanceof Element)) return false;
  if (!zonesContainer || !zonesContainer.contains(target)) return false;
  if (target.closest('button, input, textarea, select, a, label, .track-order')) return false;
  return true;
}

async function toggleNowPlayingPlayback() {
  if (isDspTransitionPlaybackActive()) return;

  if (isCoHostRole()) {
    try {
      await requestCoHostToggleCurrentPlayback();
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось отправить live-команду.');
    }
    return;
  }

  if (!state.currentTrack || !state.currentAudio) return;

  try {
    if (state.currentAudio.paused) {
      setTrackPaused(state.currentTrack.key, false, state.currentTrack);
      await state.currentAudio.play();
      setButtonPlaying(state.currentTrack.key, true, state.currentTrack);
      startProgressLoop(state.currentAudio, state.currentTrack.key);
      setStatus(`Играет: ${state.currentTrack.file}`);
    } else {
      const paused = await pauseCurrentPlayback(state.currentTrack, state.currentAudio);
      if (paused) {
        await ensureDapNoSilencePlayback({ reason: 'toggle-current-pause' });
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

function renderEmpty() {
  zonesContainer.innerHTML = '<div class="empty-state">В папке /audio не найдено аудиофайлов (mp3, wav, ogg, m4a, flac).</div>';
}

function resolveTrackUiContext(playbackContext = null) {
  const playlistIndex =
    playbackContext && Number.isInteger(playbackContext.playlistIndex) && playbackContext.playlistIndex >= 0
      ? playbackContext.playlistIndex
      : null;
  const playlistPosition =
    playbackContext && Number.isInteger(playbackContext.playlistPosition) && playbackContext.playlistPosition >= 0
      ? playbackContext.playlistPosition
      : null;

  return { playlistIndex, playlistPosition };
}

function cardMatchesTrackContext(card, playbackContext = null) {
  if (!card || !card.dataset) return false;
  const { playlistIndex, playlistPosition } = resolveTrackUiContext(playbackContext);
  if (playlistIndex === null || playlistPosition === null) return false;

  const cardPlaylistIndex = Number.parseInt(card.dataset.playlistIndex || '', 10);
  const cardPlaylistPosition = Number.parseInt(card.dataset.playlistPosition || '', 10);
  return cardPlaylistIndex === playlistIndex && cardPlaylistPosition === playlistPosition;
}

function getTrackCardByContext(fileKey, playbackContext = null) {
  const cards = state.cardsByFile.get(fileKey);
  if (!cards || !cards.size) return null;

  for (const card of cards) {
    if (cardMatchesTrackContext(card, playbackContext)) {
      return card;
    }
  }

  return getFirstFromSet(cards);
}

function normalizeTrackRelocationHighlightContext(trackContext) {
  if (!trackContext || typeof trackContext !== 'object') return null;
  const file = typeof trackContext.file === 'string' ? trackContext.file.trim() : '';
  const playlistIndex = normalizePlaylistTrackIndex(trackContext.playlistIndex);
  const playlistPosition = normalizePlaylistTrackIndex(trackContext.playlistPosition);
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

function createTrackRelocationUndoSnapshot({
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

function clearTrackRelocationHighlightTimer() {
  if (state.trackRelocationHighlightTimer === null) return;
  clearTimeout(state.trackRelocationHighlightTimer);
  state.trackRelocationHighlightTimer = null;
}

function scheduleTrackRelocationHighlightTimer() {
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

function applyTrackRelocationUndoSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;

  state.layout = ensurePlaylists(cloneLayoutState(snapshot.layout));
  state.playlistNames = normalizePlaylistNames(snapshot.playlistNames, state.layout.length);
  state.playlistMeta = normalizePlaylistMeta(snapshot.playlistMeta, state.layout.length);
  state.dapConfig = normalizeDapConfig(snapshot.dapConfig, state.layout.length, snapshot.dapConfig);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(snapshot.playlistAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(snapshot.playlistDsp, state.playlistAutoplay, state.layout.length);
}

function renderTrackRelocationUndoButton(card, action) {
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

function syncTrackRelocationHighlights() {
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

function scheduleTrackRelocationHighlight(trackContext, durationMs = TRACK_RELOCATE_HIGHLIGHT_MS, { undoId = null } = {}) {
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

function clearTrackRelocationHighlight(trackContext) {
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

function clearTrackRelocationUndoAction(actionId, { clearHighlights = true } = {}) {
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

function registerTrackRelocationUndoAction(trackContext, undoSnapshot, durationMs = TRACK_RELOCATE_HIGHLIGHT_MS) {
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

async function undoTrackRelocationAction(actionId) {
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
    await pushSharedLayout();
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

function getTrackButtonByContext(fileKey, playbackContext = null) {
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

function isTrackCardContextActive(card, trackFile, playbackContext) {
  if (!card || !trackFile || !playbackContext) return false;
  if (!cardMatchesTrackContext(card, playbackContext)) return false;
  return card.dataset.file === trackFile;
}

function isTrackCardDragBlocked(card) {
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
    const hostContext = {
      playlistIndex: normalizePlaylistTrackIndex(state.hostPlaybackState.playlistIndex),
      playlistPosition: normalizePlaylistTrackIndex(state.hostPlaybackState.playlistPosition),
    };
    if (isTrackCardContextActive(card, state.hostPlaybackState.trackFile, hostContext)) {
      return true;
    }
  }

  return false;
}

function applyPlayButtonState(button, isPauseState, { pauseLocked = false } = {}) {
  if (!button) return;
  button.dataset.state = isPauseState ? 'pause' : 'play';
  button.title = isPauseState ? 'Пауза' : 'Воспроизвести';
  button.setAttribute('aria-label', isPauseState ? 'Пауза' : 'Воспроизвести');
  button.classList.toggle('is-pause-locked', Boolean(isPauseState && pauseLocked));
}

function setButtonPlaying(fileKey, isPlaying, playbackContext = null) {
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

function setTrackPaused(fileKey, isPaused, playbackContext = null) {
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

function setTrackPausedByContext(fileKey, isPaused, playbackContext = null) {
  const targetCard = getTrackCardByContext(fileKey, playbackContext);
  if (!targetCard) return;

  if (isPaused) {
    targetCard.classList.add('is-paused');
    targetCard.classList.remove('is-playing');
    return;
  }

  targetCard.classList.remove('is-paused');
}

function normalizeAudioStartOffsetSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(0, numeric);
}

async function seekAudioToOffset(audio, offsetSeconds) {
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

// Only trust the real duration reported by the browser.
function getDuration(audio) {
  const d = audio ? audio.duration : NaN;
  return Number.isFinite(d) && d > 0 ? d : null;
}

function trackLiveAudioInstance(audio) {
  if (!(audio instanceof HTMLAudioElement)) return audio;
  state.liveAudioInstances.add(audio);
  const cleanup = () => {
    state.liveAudioInstances.delete(audio);
  };
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  return audio;
}

function stopUnexpectedLiveAudios(allowedAudios = []) {
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

function updateProgress(fileKey, currentTime, duration) {
  if (!state.currentTrack || state.currentTrack.key !== fileKey) return;

  const safeTime = Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
  const isDapTrackOnHostMain = isHostRole() && isDapTrackContext(state.currentTrack, state.dapConfig);
  if (isDapTrackOnHostMain) {
    setNowPlayingProgress(0);
    setNowPlayingTime(null);
  } else {
    const percent = duration ? Math.min(100, (safeTime / duration) * 100) : 0;
    setNowPlayingProgress(percent);
    const remaining = duration ? Math.max(0, duration - safeTime) : getCurrentTrackRemainingSeconds();
    setNowPlayingTime(remaining, { useCeil: true });
  }
  syncDapNowPlayingPanel();
  refreshTrackDurationLabels(fileKey);
}

function resetProgress(fileKey) {
  if (state.currentTrack && fileKey && state.currentTrack.key !== fileKey) return;
  setNowPlayingProgress(0);
}

function bindProgress(audio, fileKey) {
  const syncDuration = () => {
    const duration = getDuration(audio);
    if (!duration) return;
    cacheTrackDuration(fileKey, duration);
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

function stopProgressLoop() {
  if (state.progressRaf !== null) {
    cancelAnimationFrame(state.progressRaf);
    state.progressRaf = null;
  }
  state.progressAudio = null;
  syncNowPlayingPanel();
}

function startProgressLoop(audio, fileKey) {
  stopProgressLoop();
  if (!audio) return;
  state.progressAudio = audio;
  syncNowPlayingPanel();
  const minFrameIntervalMs = getProgressUiFrameIntervalMs();
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

function buildTrackCard(
  file,
  basePath = '/audio',
  { draggable = true, orderNumber = null, playlistIndex = null, playlistPosition = null, canDelete = false } = {},
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
  durationLabel.textContent = getTrackDurationTextByKey(key, { playlistIndex, playlistPosition });
  addToMultiMap(state.durationLabelsByFile, key, durationLabel);

  const playButton = document.createElement('button');
  playButton.className = 'play';
  playButton.dataset.state = 'play';
  playButton.title = 'Воспроизвести';
  playButton.setAttribute('aria-label', 'Воспроизвести');
  playButton.addEventListener('click', () =>
    handlePlay(file, playButton, basePath, {
      playlistIndex,
      playlistPosition,
    }),
  );
  addToMultiMap(state.buttonsByFile, key, playButton);

  card.append(order, name, durationLabel, playButton);
  if (draggable) {
    attachDragHandlers(card);
  }
  return card;
}

function attachDragHandlers(card) {
  card.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('button, input, textarea, select, a, .track-order')) return;

    if (!isTouchPointerEvent(event)) {
      if (event.button !== undefined && event.button !== 0) return;
      startDesktopDragHold(card, event);
      return;
    }

    if (isTrackCardDragBlocked(card)) {
      setStatus('Активный трек нельзя перемещать или копировать.');
      return;
    }

    startTouchCopyHold(card, event);
  });

  card.addEventListener('dragstart', (e) => {
    if (isLikelyTouchNativeDragEvent(e)) {
      e.preventDefault();
      return;
    }

    if (!isDesktopDragHoldReadyForCard(card)) {
      e.preventDefault();
      return;
    }
    clearDesktopDragHold();
    if (state.zonesPanActive) {
      cleanupZonesPanInteraction();
    }
    stopZonesPanMomentum();

    if (isTrackCardDragBlocked(card)) {
      e.preventDefault();
      setStatus('Активный трек нельзя перемещать или копировать.');
      return;
    }

    const sourceZone = card.closest('.zone');
    const sourceZoneIndex = sourceZone ? Number.parseInt(sourceZone.dataset.zoneIndex || '', 10) : -1;
    const sourceBody = card.parentElement;
    const sourceIndexFromDataset = Number.parseInt(card.dataset.playlistPosition || '', 10);
    const sourceIndex = Number.isInteger(sourceIndexFromDataset)
      ? sourceIndexFromDataset
      : sourceBody
        ? Array.from(sourceBody.querySelectorAll('.track-card')).indexOf(card)
        : -1;
    const sourcePlaylistType = isFolderPlaylistIndex(sourceZoneIndex) ? PLAYLIST_TYPE_FOLDER : PLAYLIST_TYPE_MANUAL;

    state.dragContext = {
      file: card.dataset.file || '',
      sourceZoneIndex: Number.isInteger(sourceZoneIndex) ? sourceZoneIndex : -1,
      sourceIndex,
      sourcePlaylistType,
      snapshotLayout: cloneLayoutState(state.layout),
    };

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', card.dataset.file);
    setDropEffectFromEvent(e);
    createDesktopDragGhost(card, e.clientX, e.clientY);
    e.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);
    showTrashDropzone();
    applyDragModeBadge(isActiveCopyDrag(e) ? 'copy' : 'move');
    card.classList.add('dragging');
    state.draggingCard = card;
    state.dragDropHandled = false;
  });

  card.addEventListener('dragend', () => {
    clearDesktopDragHold();
    hideTrashDropzone();
    clearDesktopDragGhost();
    clearDragModeBadge();
    clearDragPreviewCard();
    card.classList.remove('dragging');
    if (!state.dragDropHandled) {
      renderZones();
    }
    state.draggingCard = null;
    state.dragContext = null;
    state.dragDropHandled = false;
    document.querySelectorAll('.zone.drag-over').forEach((zone) => zone.classList.remove('drag-over'));
  });
}

function getDragInsertBefore(container, event, { includeDraggingCard = false } = {}) {
  const selector = includeDraggingCard
    ? '.track-card:not(.drag-copy-preview)'
    : '.track-card:not(.dragging):not(.drag-copy-preview)';
  const draggableCards = Array.from(container.querySelectorAll(selector));
  const cursorY = event.clientY;
  return draggableCards.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = cursorY - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null },
  ).element;
}

function applyDragPreview(zoneBody, event) {
  if (!state.draggingCard || !zoneBody) return;
  event.preventDefault();
  const zone = zoneBody.closest('.zone');
  const targetZoneIndex = zone ? Number.parseInt(zone.dataset.zoneIndex || '', 10) : NaN;
  const normalizedTargetZoneIndex = Number.isInteger(targetZoneIndex) && targetZoneIndex >= 0 ? targetZoneIndex : null;
  const mode = resolveEffectiveDragMode(event, normalizedTargetZoneIndex);

  setDropEffectFromEvent(event, normalizedTargetZoneIndex);
  updateDesktopDragGhostPosition(event.clientX, event.clientY);
  applyDragModeBadge(mode);

  if (mode === 'copy') {
    const previewCard = ensureDragPreviewCard();
    if (!previewCard) return;
    const beforeElement = getDragInsertBefore(zoneBody, event, { includeDraggingCard: true });
    if (beforeElement) {
      zoneBody.insertBefore(previewCard, beforeElement);
    } else {
      zoneBody.appendChild(previewCard);
    }
    return;
  }

  clearDragPreviewCard();
  const beforeElement = getDragInsertBefore(zoneBody, event, { includeDraggingCard: false });
  if (beforeElement) {
    zoneBody.insertBefore(state.draggingCard, beforeElement);
  } else {
    zoneBody.appendChild(state.draggingCard);
  }
}

function ensurePlaylists(playlists) {
  return Array.isArray(playlists) ? playlists.map((playlist) => (Array.isArray(playlist) ? playlist : [])) : [];
}

function defaultPlaylistName(index) {
  return `Плей-лист ${index + 1}`;
}

function sanitizePlaylistName(value, index) {
  if (typeof value !== 'string') return defaultPlaylistName(index);

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return defaultPlaylistName(index);
  return normalized.slice(0, PLAYLIST_NAME_MAX_LENGTH);
}

function normalizePlaylistNames(names, expectedLength) {
  const result = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const rawName = Array.isArray(names) ? names[index] : null;
    result.push(sanitizePlaylistName(rawName, index));
  }

  return result;
}

function normalizePlaylistAutoplayFlags(flags, expectedLength) {
  const result = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const rawValue = Array.isArray(flags) ? flags[index] : false;
    result.push(Boolean(rawValue));
  }

  return result;
}

function normalizePlaylistDspFlags(flags, autoplayFlags, expectedLength) {
  const normalizedAutoplay = normalizePlaylistAutoplayFlags(autoplayFlags, expectedLength);
  const result = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const rawValue = Array.isArray(flags) ? flags[index] : false;
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

function normalizeDapConfig(config, layoutLength, fallback = DEFAULT_DAP_CONFIG) {
  const expectedLength = Number.isInteger(layoutLength) && layoutLength >= 0 ? layoutLength : 0;
  const safeFallback =
    fallback && typeof fallback === 'object'
      ? {
          enabled: Boolean(fallback.enabled),
          playlistIndex: normalizePlaylistTrackIndex(fallback.playlistIndex),
          volumePercent: normalizeDapVolumePercent(fallback.volumePercent, DAP_DEFAULT_VOLUME_PERCENT),
        }
      : { ...DEFAULT_DAP_CONFIG };
  const raw = config && typeof config === 'object' ? config : null;

  const requestedEnabled =
    raw && Object.prototype.hasOwnProperty.call(raw, 'enabled') ? Boolean(raw.enabled) : safeFallback.enabled;
  const requestedPlaylistIndex =
    raw && Object.prototype.hasOwnProperty.call(raw, 'playlistIndex')
      ? normalizePlaylistTrackIndex(raw.playlistIndex)
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

function normalizePlaylistAutoplayWithDap(flags, dapState, expectedLength) {
  const normalized = normalizePlaylistAutoplayFlags(flags, expectedLength);
  const normalizedDap = normalizeDapConfig(dapState, expectedLength, DEFAULT_DAP_CONFIG);
  if (normalizedDap.enabled && normalizedDap.playlistIndex !== null) {
    normalized[normalizedDap.playlistIndex] = true;
  }
  return normalized;
}

function getDapPlaylistIndex(config = state.dapConfig) {
  if (!isDapEnabled(config)) return null;
  return normalizePlaylistTrackIndex(config.playlistIndex);
}

function isDapPlaylistIndex(playlistIndex, config = state.dapConfig) {
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  return dapPlaylistIndex !== null && dapPlaylistIndex === normalizePlaylistTrackIndex(playlistIndex);
}

function buildPlaylistRenderOrder(length, config = state.dapConfig) {
  const expectedLength = Number.isInteger(length) && length > 0 ? length : 0;
  const order = Array.from({ length: expectedLength }, (_, index) => index);
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null) return order;
  if (dapPlaylistIndex < 0 || dapPlaylistIndex >= expectedLength) return order;
  return [dapPlaylistIndex, ...order.filter((index) => index !== dapPlaylistIndex)];
}

setConfigDeps({ normalizeDapVolumePercent, isDapEnabled, isDapTrackContext, rebuildVolumePresetButtons });
setRoleDeps({ isDapEnabled });

function getDapPlaylistFiles(config = state.dapConfig) {
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null) return [];
  if (dapPlaylistIndex < 0 || dapPlaylistIndex >= state.layout.length) return [];
  const playlist = Array.isArray(state.layout[dapPlaylistIndex]) ? state.layout[dapPlaylistIndex] : [];
  return playlist.filter((file) => typeof file === 'string' && file.trim());
}

function disarmDapNoSilence() {
  state.dapNoSilenceArmedPlaylistIndex = null;
}

function clearDapInterruptedPlaybackSnapshot() {
  const previousSnapshot =
    state.dapInterruptedPlaybackSnapshot && typeof state.dapInterruptedPlaybackSnapshot === 'object'
      ? { ...dapInterruptedPlaybackSnapshot }
      : null;
  state.dapInterruptedPlaybackSnapshot = null;

  if (!previousSnapshot) return;
  const previousFile = typeof previousSnapshot.file === 'string' ? previousSnapshot.file.trim() : '';
  if (!previousFile) return;

  const previousContext = normalizeTrackPlaybackContext(previousSnapshot);
  if (previousContext.playlistIndex !== null && previousContext.playlistPosition !== null) {
    setTrackPausedByContext(trackKey(previousFile, '/audio'), false, previousContext);
  }
  refreshTrackDurationLabels(trackKey(previousFile, '/audio'));
}

function captureDapInterruptedPlaybackSnapshot(track = state.currentTrack, audio = state.currentAudio, config = state.dapConfig) {
  if (!track || !audio) return false;
  if (!isDapTrackContext(track, config)) return false;

  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null || dapPlaylistIndex < 0 || dapPlaylistIndex >= state.layout.length) return false;

  const dapPlaylist = Array.isArray(state.layout[dapPlaylistIndex]) ? state.layout[dapPlaylistIndex] : [];
  if (!dapPlaylist.length) return false;

  const trackFile = typeof track.file === 'string' ? track.file.trim() : '';
  if (!trackFile) return false;

  let trackPosition = normalizePlaylistTrackIndex(track.playlistPosition);
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

function resolveDapInterruptedPlaybackTrack(config = state.dapConfig) {
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
  let resolvedPosition = normalizePlaylistTrackIndex(state.dapInterruptedPlaybackSnapshot.playlistPosition);
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

function armDapNoSilenceByPlaylistIndex(playlistIndex, config = state.dapConfig) {
  if (!isDapEnabled(config)) return false;
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  const normalizedPlaylistIndex = normalizePlaylistTrackIndex(playlistIndex);
  if (dapPlaylistIndex === null || normalizedPlaylistIndex === null) return false;
  if (dapPlaylistIndex !== normalizedPlaylistIndex) return false;
  state.dapNoSilenceArmedPlaylistIndex = dapPlaylistIndex;
  return true;
}

function isDapNoSilenceArmed(config = state.dapConfig) {
  if (!isDapEnabled(config)) return false;
  const dapPlaylistIndex = getDapPlaylistIndex(config);
  if (dapPlaylistIndex === null) return false;
  return state.dapNoSilenceArmedPlaylistIndex === dapPlaylistIndex;
}

function isDapNoSilenceActive(config = state.dapConfig) {
  if (!isHostRole()) return false;
  if (!isDapEnabled(config)) return false;
  if (!isDapNoSilenceArmed(config)) return false;
  return getDapPlaylistFiles(config).length > 0;
}

function isDapPauseLocked(track = state.currentTrack, audio = state.currentAudio, config = state.dapConfig) {
  if (!isDapNoSilenceActive(config)) return false;
  if (!track || !audio) return false;
  if (audio.paused) return false;
  return isDapTrackContext(track, config);
}

function resolveDapNoSilenceTrack(config = state.dapConfig) {
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
    let pausedPosition = normalizePlaylistTrackIndex(state.currentTrack.playlistPosition);
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

async function ensureDapNoSilencePlayback({ reason = 'guard' } = {}) {
  if (!isDapNoSilenceActive()) return false;
  if (state.dapAutoStartInFlight) return false;
  if (state.autoplayStartInFlight) return false;
  if (state.overlayHandoffInFlight) return false;
  if (isDspTransitionPlaybackActive()) return false;
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
    await handlePlay(targetTrack.file, targetButton, targetTrack.basePath || '/audio', {
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

function serializeLayout(playlists) {
  return JSON.stringify(ensurePlaylists(playlists));
}

function layoutsEqual(left, right) {
  return serializeLayout(left) === serializeLayout(right);
}

function serializePlaylistNames(names, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizePlaylistNames(names, expectedLength));
}

function playlistNamesEqual(left, right, expectedLength) {
  return serializePlaylistNames(left, expectedLength) === serializePlaylistNames(right, expectedLength);
}

function serializePlaylistAutoplay(flags, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizePlaylistAutoplayFlags(flags, expectedLength));
}

function playlistAutoplayEqual(left, right, expectedLength) {
  return serializePlaylistAutoplay(left, expectedLength) === serializePlaylistAutoplay(right, expectedLength);
}

function serializePlaylistDsp(flags, autoplayFlags, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizePlaylistDspFlags(flags, autoplayFlags, expectedLength));
}

function playlistDspEqual(left, right, autoplayFlags, expectedLength) {
  return serializePlaylistDsp(left, autoplayFlags, expectedLength) === serializePlaylistDsp(right, autoplayFlags, expectedLength);
}

function serializeDapConfig(config, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(state.layout).length;
  return JSON.stringify(normalizeDapConfig(config, expectedLength, DEFAULT_DAP_CONFIG));
}

function dapConfigEqual(left, right, expectedLength) {
  return serializeDapConfig(left, expectedLength) === serializeDapConfig(right, expectedLength);
}

function applyDapConstraintsForCurrentLayout() {
  state.layout = ensurePlaylists(state.layout);
  state.dapConfig = normalizeDapConfig(state.dapConfig, state.layout.length, state.dapConfig);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(state.playlistAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(state.playlistDsp, state.playlistAutoplay, state.layout.length);
}

function normalizeLayoutForFiles(rawLayout, files) {
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

function isServerLayoutEmpty(playlists) {
  const normalized = ensurePlaylists(playlists);
  if (normalized.length === 0) return true;
  return normalized.length === 1 && normalized[0].length === 0;
}

function readLegacyLocalLayout(files) {
  const raw = localStorage.getItem(LAYOUT_STORAGE_KEY) || localStorage.getItem(LEGACY_LAYOUT_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return normalizeLayoutForFiles(parsed, files);
  } catch (err) {
    return null;
  }
}

function syncLayoutFromDom() {
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

  state.layout = ensurePlaylists(nextLayout);
  state.playlistNames = normalizePlaylistNames(state.playlistNames, state.layout.length);
  state.playlistMeta = normalizePlaylistMeta(state.playlistMeta, state.layout.length);
  applyDapConstraintsForCurrentLayout();
}

function parsePlaylistPositionFromCard(card) {
  if (!(card instanceof HTMLElement)) return null;
  const playlistPosition = Number.parseInt(card.dataset.playlistPosition || '', 10);
  if (!Number.isInteger(playlistPosition) || playlistPosition < 0) return null;
  return playlistPosition;
}

function getAdjacentTrackCardForDrop(referenceCard, direction) {
  if (!(referenceCard instanceof HTMLElement)) return null;
  const searchDirection = direction === 'previous' ? 'previousElementSibling' : 'nextElementSibling';
  let cursor = referenceCard;

  while (cursor) {
    cursor = cursor[searchDirection];
    if (!(cursor instanceof HTMLElement)) return null;
    if (!cursor.classList.contains('track-card')) continue;
    if (cursor === state.draggingCard || cursor === state.dragPreviewCard) continue;
    return cursor;
  }

  return null;
}

function resolveDropInsertIndex(targetBody, targetZoneIndex, layoutState) {
  const normalizedLayout = ensurePlaylists(layoutState);
  const targetPlaylist =
    Number.isInteger(targetZoneIndex) && targetZoneIndex >= 0 && targetZoneIndex < normalizedLayout.length
      ? normalizedLayout[targetZoneIndex]
      : [];
  const fallbackIndex = Array.isArray(targetPlaylist) ? targetPlaylist.length : 0;

  if (!(targetBody instanceof HTMLElement)) return fallbackIndex;

  const marker =
    state.dragPreviewCard && state.dragPreviewCard.parentElement === targetBody
      ? dragPreviewCard
      : state.draggingCard && state.draggingCard.parentElement === targetBody
        ? draggingCard
        : null;

  if (!marker) {
    return fallbackIndex;
  }

  const previousCard = getAdjacentTrackCardForDrop(marker, 'previous');
  const nextCard = getAdjacentTrackCardForDrop(marker, 'next');
  const previousPosition = parsePlaylistPositionFromCard(previousCard);
  const nextPosition = parsePlaylistPositionFromCard(nextCard);

  if (Number.isInteger(nextPosition)) {
    return Math.max(0, Math.min(nextPosition, fallbackIndex));
  }

  if (Number.isInteger(previousPosition)) {
    return Math.max(0, Math.min(previousPosition + 1, fallbackIndex));
  }

  return fallbackIndex;
}

function buildTrackOccurrenceMap(layoutState) {
  const occurrence = new Map();
  ensurePlaylists(layoutState).forEach((playlist) => {
    playlist.forEach((file) => {
      if (typeof file !== 'string' || !file) return;
      occurrence.set(file, (occurrence.get(file) || 0) + 1);
    });
  });
  return occurrence;
}

function getTrackDeleteEligibility(layoutState, playlistIndex, trackIndex) {
  const normalizedLayout = ensurePlaylists(layoutState);
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= normalizedLayout.length) {
    return { canDelete: false, reason: 'Трек не найден.' };
  }

  const playlist = normalizedLayout[playlistIndex];
  if (!Array.isArray(playlist) || !Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= playlist.length) {
    return { canDelete: false, reason: 'Трек не найден.' };
  }

  const file = playlist[trackIndex];
  if (typeof file !== 'string' || !file) {
    return { canDelete: false, reason: 'Трек не найден.' };
  }

  const occurrence = buildTrackOccurrenceMap(normalizedLayout);
  if ((occurrence.get(file) || 0) > 1) {
    return { canDelete: true, reason: '', file };
  }

  return {
    canDelete: false,
    reason: 'Нельзя удалить единственный экземпляр трека. Сначала создайте его копию.',
    file,
  };
}

function resolveTrackIndexByContext(layoutState, context) {
  if (!context || typeof context !== 'object') return { playlistIndex: -1, trackIndex: -1, file: '' };

  const normalizedLayout = ensurePlaylists(layoutState);
  const playlistIndex = Number.isInteger(context.sourceZoneIndex) ? context.sourceZoneIndex : -1;
  if (playlistIndex < 0 || playlistIndex >= normalizedLayout.length) {
    return { playlistIndex: -1, trackIndex: -1, file: context.file || '' };
  }

  const playlist = normalizedLayout[playlistIndex];
  const expectedFile = typeof context.file === 'string' ? context.file : '';
  let trackIndex = Number.isInteger(context.sourceIndex) ? context.sourceIndex : -1;

  if (trackIndex < 0 || trackIndex >= playlist.length || playlist[trackIndex] !== expectedFile) {
    trackIndex = expectedFile ? playlist.indexOf(expectedFile) : -1;
  }

  return {
    playlistIndex,
    trackIndex,
    file: expectedFile,
  };
}

async function handleDragDeleteFromContext() {
  if (!state.dragContext) return false;

  const snapshotLayout = cloneLayoutState(state.dragContext.snapshotLayout);
  const snapshotNames = normalizePlaylistNames(state.playlistNames, snapshotLayout.length);
  const snapshotMeta = normalizePlaylistMeta(state.playlistMeta, snapshotLayout.length);
  const snapshotDap = normalizeDapConfig(state.dapConfig, snapshotLayout.length, state.dapConfig);
  const snapshotAutoplay = normalizePlaylistAutoplayWithDap(state.playlistAutoplay, snapshotDap, snapshotLayout.length);
  const snapshotDsp = normalizePlaylistDspFlags(state.playlistDsp, snapshotAutoplay, snapshotLayout.length);

  const resolution = resolveTrackIndexByContext(snapshotLayout, state.dragContext);
  const eligibility = getTrackDeleteEligibility(snapshotLayout, resolution.playlistIndex, resolution.trackIndex);
  if (!eligibility.canDelete) {
    setStatus(`Удаление недоступно: ${eligibility.reason}`);
    return false;
  }

  snapshotLayout[resolution.playlistIndex].splice(resolution.trackIndex, 1);

  const previousLayout = cloneLayoutState(state.layout);
  const previousNames = state.playlistNames.slice();
  const previousMeta = clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...dapConfig };

  state.layout = ensurePlaylists(snapshotLayout);
  state.playlistNames = normalizePlaylistNames(snapshotNames, state.layout.length);
  state.playlistMeta = normalizePlaylistMeta(snapshotMeta, state.layout.length);
  state.dapConfig = normalizeDapConfig(snapshotDap, state.layout.length, snapshotDap);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(snapshotAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(snapshotDsp, state.playlistAutoplay, state.layout.length);
  state.dragDropHandled = true;
  clearDragModeBadge();
  clearDragPreviewCard();
  hideTrashDropzone();
  renderZones();

  try {
    await pushSharedLayout();
    setStatus('Трек удален через корзину и синхронизирован.');
    return true;
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = previousNames;
    state.playlistMeta = previousMeta;
    state.dapConfig = normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    renderZones();
    setStatus('Не удалось синхронизировать удаление трека.');
    return false;
  }
}

async function handleDragQueueNextFromContext(event = null) {
  if (!state.dragContext) return false;

  const snapshotLayout = cloneLayoutState(state.dragContext.snapshotLayout);
  const snapshotNames = normalizePlaylistNames(state.playlistNames, snapshotLayout.length);
  const snapshotMeta = normalizePlaylistMeta(state.playlistMeta, snapshotLayout.length);
  const snapshotDap = normalizeDapConfig(state.dapConfig, snapshotLayout.length, state.dapConfig);
  const snapshotAutoplay = normalizePlaylistAutoplayWithDap(state.playlistAutoplay, snapshotDap, snapshotLayout.length);
  const snapshotDsp = normalizePlaylistDspFlags(state.playlistDsp, snapshotAutoplay, snapshotLayout.length);

  const queueTarget = resolveQueueNextInsertTarget(snapshotLayout);
  if (!queueTarget) {
    setStatus('Нет активного воспроизведения. Режим "Следующий" недоступен.');
    return false;
  }

  const targetZoneIndex = queueTarget.playlistIndex;
  if (!Number.isInteger(targetZoneIndex) || targetZoneIndex < 0 || !Array.isArray(snapshotLayout[targetZoneIndex])) {
    setStatus('Не удалось определить целевой плей-лист для режима "Следующий".');
    return false;
  }

  const isCopyDrop = isActiveCopyDrag(event, targetZoneIndex);
  let insertIndex = queueTarget.insertIndex;
  let queuedTrackAnchor = null;

  if (isCopyDrop) {
    if (!state.dragContext.file) {
      setStatus('Не удалось определить трек для копирования.');
      return false;
    }
    insertIndex = Math.max(0, Math.min(insertIndex, snapshotLayout[targetZoneIndex].length));
    snapshotLayout[targetZoneIndex].splice(insertIndex, 0, state.dragContext.file);
    queuedTrackAnchor = {
      file: state.dragContext.file,
      playlistIndex: targetZoneIndex,
      playlistPosition: insertIndex,
    };
  } else {
    const resolution = resolveTrackIndexByContext(snapshotLayout, state.dragContext);
    if (resolution.playlistIndex < 0 || resolution.trackIndex < 0) {
      setStatus('Не удалось определить исходную позицию трека.');
      return false;
    }

    const sourcePlaylist = snapshotLayout[resolution.playlistIndex];
    if (!Array.isArray(sourcePlaylist)) {
      setStatus('Не удалось прочитать исходный плей-лист.');
      return false;
    }

    const [removedFile] = sourcePlaylist.splice(resolution.trackIndex, 1);
    const movedFile = typeof removedFile === 'string' && removedFile ? removedFile : resolution.file;
    if (typeof movedFile !== 'string' || !movedFile) {
      setStatus('Не удалось подготовить трек для переноса.');
      return false;
    }

    if (resolution.playlistIndex === targetZoneIndex && resolution.trackIndex < insertIndex) {
      insertIndex -= 1;
    }

    insertIndex = Math.max(0, Math.min(insertIndex, snapshotLayout[targetZoneIndex].length));
    snapshotLayout[targetZoneIndex].splice(insertIndex, 0, movedFile);
    queuedTrackAnchor = {
      file: movedFile,
      playlistIndex: targetZoneIndex,
      playlistPosition: insertIndex,
    };
  }

  const previousLayout = cloneLayoutState(state.layout);
  const previousNames = state.playlistNames.slice();
  const previousMeta = clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...dapConfig };
  const undoSnapshot = createTrackRelocationUndoSnapshot({
    layoutState: previousLayout,
    namesState: previousNames,
    metaState: previousMeta,
    autoplayState: previousAutoplay,
    dspState: previousDsp,
    dapState: previousDap,
  });

  state.layout = ensurePlaylists(snapshotLayout);
  state.playlistNames = normalizePlaylistNames(snapshotNames, state.layout.length);
  state.playlistMeta = normalizePlaylistMeta(snapshotMeta, state.layout.length);
  state.dapConfig = normalizeDapConfig(snapshotDap, state.layout.length, snapshotDap);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(snapshotAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(snapshotDsp, state.playlistAutoplay, state.layout.length);
  state.dragDropHandled = true;
  hideTrashDropzone();
  clearDragModeBadge();
  clearDragPreviewCard();
  renderZones();
  const undoActionId = queuedTrackAnchor ? registerTrackRelocationUndoAction(queuedTrackAnchor, undoSnapshot) : null;

  try {
    await pushSharedLayout();
    setQueueNextChainAnchor(queuedTrackAnchor);
    setStatus(isCopyDrop ? 'Копия трека поставлена следующей и синхронизирована.' : 'Трек поставлен следующим и синхронизирован.');
    return true;
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = previousNames;
    state.playlistMeta = previousMeta;
    state.dapConfig = normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    renderZones();
    if (undoActionId) {
      clearTrackRelocationUndoAction(undoActionId);
    } else if (queuedTrackAnchor) {
      clearTrackRelocationHighlight(queuedTrackAnchor);
    }
    setStatus(isCopyDrop ? 'Не удалось синхронизировать "следующую" копию трека.' : 'Не удалось синхронизировать трек как следующий.');
    return false;
  }
}

function getTrackButton(file, playlistIndex = null, playlistPosition = null, basePath = '/audio') {
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

function resolveSequentialNextTrack(track, { requireAutoplay = false } = {}) {
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

  return {
    file: nextFile,
    basePath: '/audio',
    playlistIndex: preferredPlaylistIndex,
    playlistPosition: nextIndex,
  };
}

function resolveAutoplayNextTrack(finishedTrack) {
  const directNext = resolveSequentialNextTrack(finishedTrack, { requireAutoplay: true });
  if (directNext) return directNext;

  const dapPlaylistIndex = getDapPlaylistIndex(state.dapConfig);
  if (dapPlaylistIndex === null) return null;
  if (dapPlaylistIndex < 0 || dapPlaylistIndex >= state.layout.length) return null;

  const finishedPlaylistIndex = normalizePlaylistTrackIndex(finishedTrack ? finishedTrack.playlistIndex : null);
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
        return {
          file: wrappedNextFile,
          basePath: '/audio',
          playlistIndex: dapPlaylistIndex,
          playlistPosition: wrappedNextIndex,
        };
      }
    }
  }

  const firstDapFile = dapPlaylist[0];
  if (typeof firstDapFile !== 'string' || !firstDapFile) return null;
  return {
    file: firstDapFile,
    basePath: '/audio',
    playlistIndex: dapPlaylistIndex,
    playlistPosition: 0,
  };
}

function isPlaylistDspEnabled(playlistIndex) {
  const normalizedIndex = normalizePlaylistTrackIndex(playlistIndex);
  if (normalizedIndex === null) return false;
  if (normalizedIndex < 0 || normalizedIndex >= state.playlistDsp.length) return false;
  return Boolean(state.playlistDsp[normalizedIndex]);
}

function setLiveDspNextTrackReady(nextTrack, details = null) {
  if (!nextTrack || typeof nextTrack.file !== 'string') {
    state.liveDspNextReadyDescriptor = '';
    state.liveDspNextReadySliceSeconds = null;
    syncLiveDspNextTrackHighlight();
    return;
  }

  state.liveDspNextReadyDescriptor = buildLiveDspNextTrackDescriptor(
    nextTrack.file,
    {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
    },
    nextTrack.basePath || '/audio',
  );
  const normalizedSliceSeconds = normalizeDspTransitionSliceSeconds(details && details.sliceSeconds);
  state.liveDspNextReadySliceSeconds = normalizedSliceSeconds > 0 ? normalizedSliceSeconds : null;
  syncLiveDspNextTrackHighlight();
}

function resolveReadyDspSliceWindowSeconds(nextTrack) {
  if (!nextTrack || typeof nextTrack.file !== 'string') return null;
  if (nextTrack.basePath && nextTrack.basePath !== '/audio') return null;
  if (!state.liveDspNextReadyDescriptor) return null;

  const expectedDescriptor = buildLiveDspNextTrackDescriptor(
    nextTrack.file,
    {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
    },
    nextTrack.basePath || '/audio',
  );
  if (!expectedDescriptor || expectedDescriptor !== state.liveDspNextReadyDescriptor) return null;

  const sliceSeconds = normalizeDspTransitionSliceSeconds(state.liveDspNextReadySliceSeconds);
  if (sliceSeconds <= 0) return null;
  return sliceSeconds;
}

function normalizeDspTransitionSliceSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, numeric);
}

async function warmupDspTransitionOutput(outputUrl, { urgent = false } = {}) {
  const normalizedUrl = typeof outputUrl === 'string' ? outputUrl.trim() : '';
  if (!normalizedUrl) return false;

  const existingPromise = state.dspTransitionWarmupPromises.get(normalizedUrl);
  if (existingPromise) {
    return existingPromise;
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = urgent ? Math.max(3000, LIVE_DSP_WARMUP_TIMEOUT_MS) : LIVE_DSP_WARMUP_TIMEOUT_MS;
  const timeoutId = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (err) {
          // ignore abort failures
        }
      }, timeoutMs)
    : null;

  const warmupPromise = fetch(normalizedUrl, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'force-cache',
    signal: controller ? controller.signal : undefined,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    });

  state.dspTransitionWarmupPromises.set(normalizedUrl, warmupPromise);
  if (state.dspTransitionWarmupPromises.size > LIVE_DSP_WARMUP_MAX_TRACKED) {
    const firstKey = state.dspTransitionWarmupPromises.keys().next().value;
    if (firstKey && firstKey !== normalizedUrl) {
      state.dspTransitionWarmupPromises.delete(firstKey);
    }
  }

  return warmupPromise;
}

function disposePreparedContinuationAudio(audio) {
  if (!audio) return;
  try {
    audio.pause();
  } catch (err) {
    // ignore pause failures for detached audio elements
  }
  try {
    audio.currentTime = 0;
  } catch (err) {
    // ignore seek failures for detached audio elements
  }
}

function buildLiveDspContinuationWarmupKey(track, sliceSeconds = 0) {
  if (!track || typeof track.file !== 'string' || !track.file.trim()) return '';
  const descriptor = buildLiveDspNextTrackDescriptor(
    track.file,
    {
      playlistIndex: normalizePlaylistTrackIndex(track.playlistIndex),
      playlistPosition: normalizePlaylistTrackIndex(track.playlistPosition),
    },
    track.basePath || '/audio',
  );
  if (!descriptor) return '';
  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  return `${descriptor}|slice=${normalizedSlice.toFixed(3)}`;
}

function clearLiveDspContinuationWarmups() {
  const pendingPromises = Array.from(state.liveDspContinuationWarmupPromises.values());
  state.liveDspContinuationWarmupPromises.clear();
  pendingPromises.forEach((promise) => {
    Promise.resolve(promise)
      .then((audio) => {
        if (audio) disposePreparedContinuationAudio(audio);
      })
      .catch(() => {});
  });
}

function primeLiveDspContinuationWarmup(nextTrack, sliceSeconds = 0) {
  const targetTrack = toPlaybackTrackDescriptor(nextTrack, '/audio');
  const key = buildLiveDspContinuationWarmupKey(targetTrack, sliceSeconds);
  if (!key) return null;

  const existing = state.liveDspContinuationWarmupPromises.get(key);
  if (existing) return existing;

  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  const basePromise = (async () => {
    const preparedAudio = createAudio(targetTrack);
    preparedAudio.preload = 'auto';
    preparedAudio.volume = getEffectiveLiveVolume(targetTrack);
    if (normalizedSlice > 0) {
      await seekAudioToOffset(preparedAudio, normalizedSlice);
    }
    return preparedAudio;
  })();

  let trackedPromise = null;
  trackedPromise = basePromise
    .then((audio) => {
      const stillTracked = state.liveDspContinuationWarmupPromises.get(key) === trackedPromise;
      if (!stillTracked) {
        if (audio) disposePreparedContinuationAudio(audio);
        return null;
      }
      if (!audio) {
        state.liveDspContinuationWarmupPromises.delete(key);
        return null;
      }
      return audio;
    })
    .catch(() => {
      if (state.liveDspContinuationWarmupPromises.get(key) === trackedPromise) {
        state.liveDspContinuationWarmupPromises.delete(key);
      }
      return null;
    });

  state.liveDspContinuationWarmupPromises.set(key, trackedPromise);
  while (state.liveDspContinuationWarmupPromises.size > LIVE_DSP_CONTINUATION_WARMUP_MAX_TRACKED) {
    const oldestKey = state.liveDspContinuationWarmupPromises.keys().next().value;
    if (!oldestKey || oldestKey === key) break;
    state.liveDspContinuationWarmupPromises.delete(oldestKey);
  }

  return trackedPromise;
}

function consumeLiveDspContinuationWarmup(nextTrack, sliceSeconds = 0) {
  const targetTrack = toPlaybackTrackDescriptor(nextTrack, '/audio');
  const key = buildLiveDspContinuationWarmupKey(targetTrack, sliceSeconds);
  if (!key) return null;

  const warmupPromise = state.liveDspContinuationWarmupPromises.get(key);
  if (!warmupPromise) return null;
  state.liveDspContinuationWarmupPromises.delete(key);
  return warmupPromise;
}

function toPlaybackTrackDescriptor(track, fallbackBasePath = '/audio') {
  const file = track && typeof track.file === 'string' ? track.file : '';
  const basePath = track && typeof track.basePath === 'string' && track.basePath ? track.basePath : fallbackBasePath;
  return {
    file,
    basePath,
    key: trackKey(file, basePath),
    playlistIndex: normalizePlaylistTrackIndex(track ? track.playlistIndex : null),
    playlistPosition: normalizePlaylistTrackIndex(track ? track.playlistPosition : null),
  };
}

async function fetchDspTransitionPairDetails(fromFile, toFile) {
  const { ok, data } = await api.fetchDspTransitionPair(fromFile, toFile);
  if (!ok) {
    const message = data && typeof data.error === 'string' ? data.error : 'Не удалось получить статус DSP transition.';
    throw new Error(message);
  }

  const transition = data && data.transition && typeof data.transition === 'object' ? data.transition : null;
  const status = transition && typeof transition.status === 'string' ? transition.status.trim().toLowerCase() : 'missing';
  const outputUrl = transition && typeof transition.outputUrl === 'string' ? transition.outputUrl : null;
  const sliceSeconds = normalizeDspTransitionSliceSeconds(transition && transition.sliceSeconds);

  return {
    status: status || 'missing',
    outputUrl,
    sliceSeconds,
    transition,
  };
}

async function pollLiveDspTransitionUntilReady(fromTrack, nextTrack, tokenAtStart) {
  const startedAt = Date.now();

  while (state.liveDspRenderToken === tokenAtStart && Date.now() - startedAt <= LIVE_DSP_POLL_TIMEOUT_MS) {
    let details = null;
    let status = 'missing';
    try {
      details = await fetchDspTransitionPairDetails(fromTrack.file, nextTrack.file);
      status = details.status;
    } catch (err) {
      // keep waiting during transient API errors
    }

    if (state.liveDspRenderToken !== tokenAtStart) return;
    if (status === 'ready') {
      if (details && details.outputUrl) {
        warmupDspTransitionOutput(details.outputUrl).catch(() => {});
      }
      if (details) {
        primeLiveDspContinuationWarmup(nextTrack, details.sliceSeconds);
      }
      setLiveDspNextTrackReady(nextTrack, details);
      return;
    }
    if (status === 'failed') {
      setLiveDspNextTrackReady(null);
      return;
    }

    await waitMs(LIVE_DSP_POLL_INTERVAL_MS);
  }
}

async function queueLiveDspTransitionForTrack(fromTrack, nextTrack, tokenAtStart) {
  try {
    const { ok } = await api.postDspTransitions({
      from: fromTrack.file,
      to: nextTrack.file,
      force: true,
      source: LIVE_DSP_RENDER_SOURCE,
      priority: 'high',
    });

    if (!ok) {
      return;
    }
  } catch (err) {
    return;
  }

  await pollLiveDspTransitionUntilReady(fromTrack, nextTrack, tokenAtStart);
}

function triggerLiveDspTransitionForTrack(track) {
  if (!isHostRole()) return;
  if (!track || typeof track.file !== 'string') return;
  if ((track.basePath || '/audio') !== '/audio') return;

  const token = state.liveDspRenderToken + 1;
  state.liveDspRenderToken = token;
  setLiveDspNextTrackReady(null);

  const nextTrack = resolveAutoplayNextTrack(track);
  if (!nextTrack) return;
  if (!isPlaylistDspEnabled(nextTrack.playlistIndex)) return;

  queueLiveDspTransitionForTrack(track, nextTrack, token).catch((err) => {
    console.error('Не удалось подготовить DSP transition на старте трека', err);
  });
}

function resolveDspSourceSegmentSeconds(sliceSeconds, transitionDetails = null) {
  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  if (normalizedSlice <= 0) return 0;

  const aggressiveJoin =
    transitionDetails && typeof transitionDetails === 'object' && transitionDetails.aggressiveJoin
      ? transitionDetails.aggressiveJoin
      : null;
  const rawTailTrim = aggressiveJoin ? Number(aggressiveJoin.sourceTailTrimSeconds) : NaN;
  if (!Number.isFinite(rawTailTrim) || rawTailTrim <= 0) {
    return normalizedSlice;
  }

  const maxTrim = Math.max(0, normalizedSlice - 0.05);
  const safeTailTrim = Math.max(0, Math.min(maxTrim, rawTailTrim));
  return Math.max(0.05, normalizedSlice - safeTailTrim);
}

function resolveDspTransitionStartOffsetSeconds(sourceTrack, sliceSeconds, transitionDetails = null) {
  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  if (normalizedSlice <= 0) return 0;
  const sourceSegmentSeconds = resolveDspSourceSegmentSeconds(normalizedSlice, transitionDetails);

  const hasCurrentSourceTrack =
    sourceTrack &&
    sourceTrack.key &&
    state.currentTrack &&
    state.currentTrack.key === sourceTrack.key &&
    state.currentAudio &&
    !state.currentAudio.paused;

  if (!hasCurrentSourceTrack) {
    // Source track already ended: skip source segment and continue from target side of transition.
    return sourceSegmentSeconds;
  }

  const sourceDuration = getDuration(state.currentAudio) || getKnownDurationSeconds(sourceTrack.key);
  const sourceCurrentTime = Number.isFinite(state.currentAudio.currentTime) ? Math.max(0, state.currentAudio.currentTime) : null;
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || sourceCurrentTime === null) {
    return 0;
  }

  const remainingSeconds = Math.max(0, sourceDuration - sourceCurrentTime);
  const offsetSeconds = normalizedSlice - remainingSeconds;
  if (!Number.isFinite(offsetSeconds) || offsetSeconds <= 0) return 0;
  return Math.max(0, Math.min(offsetSeconds, sourceSegmentSeconds));
}

async function tryStartAutoplayWithDspTransition(finishedTrack, nextTrack) {
  if (!isHostRole()) return false;
  if (!finishedTrack || !nextTrack) return false;
  if ((finishedTrack.basePath || '/audio') !== '/audio') return false;
  if ((nextTrack.basePath || '/audio') !== '/audio') return false;
  if (!isPlaylistDspEnabled(nextTrack.playlistIndex)) return false;

  let details;
  try {
    details = await fetchDspTransitionPairDetails(finishedTrack.file, nextTrack.file);
  } catch (err) {
    return false;
  }

  if (details.status !== 'ready' || !details.outputUrl) {
    return false;
  }
  warmupDspTransitionOutput(details.outputUrl, { urgent: true }).catch(() => {});

  const sourceTrack = toPlaybackTrackDescriptor(finishedTrack, '/audio');
  const targetTrack = toPlaybackTrackDescriptor(nextTrack, '/audio');
  const targetButton = getTrackButton(
    nextTrack.file,
    nextTrack.playlistIndex,
    nextTrack.playlistPosition,
    nextTrack.basePath || '/audio',
  );
  if (!targetButton) return false;
  const sliceSeconds = normalizeDspTransitionSliceSeconds(details.sliceSeconds);
  let cachedContinuationWarmup = consumeLiveDspContinuationWarmup(nextTrack, sliceSeconds);
  if (!cachedContinuationWarmup) {
    cachedContinuationWarmup = primeLiveDspContinuationWarmup(nextTrack, sliceSeconds);
  }
  const transitionStartOffsetSeconds = resolveDspTransitionStartOffsetSeconds(
    sourceTrack,
    sliceSeconds,
    details.transition,
  );
  const transitionOffsetPlannedAt = performance.now();

  if (isDspTransitionPlaybackActive()) {
    stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
  }

  const previousAudio = state.currentAudio;
  resetFadeState();
  stopProgressLoop();
  state.currentAudio = null;
  state.currentTrack = null;

  setButtonPlaying(sourceTrack.key, true, sourceTrack);
  setTrackPaused(sourceTrack.key, false, sourceTrack);
  setButtonPlaying(targetTrack.key, true, targetTrack);
  setTrackPaused(targetTrack.key, false, targetTrack);

  const transitionAudio = trackLiveAudioInstance(new Audio(details.outputUrl));
  transitionAudio.preload = 'auto';
  transitionAudio.volume = getEffectiveLiveVolume(targetTrack);
  state.dspTransitionPlayback = {
    audio: transitionAudio,
    fromTrack: sourceTrack,
    toTrack: targetTrack,
    duration: null,
    sliceSeconds,
    startOffsetSeconds: transitionStartOffsetSeconds,
    outputUrl: details.outputUrl,
  };
  syncDspTransitionTrackHighlight();
  syncNowPlayingPanel();

  const resolveAdjustedTransitionStartOffsetSeconds = () => {
    const startupDelaySeconds = Math.max(0, (performance.now() - transitionOffsetPlannedAt) / 1000);
    const rawOffset = Math.max(
      0,
      transitionStartOffsetSeconds + startupDelaySeconds + state.liveDspEntryCompensationSeconds,
    );
    const knownDuration =
      getDuration(transitionAudio) ||
      (state.dspTransitionPlayback && Number.isFinite(state.dspTransitionPlayback.duration) && state.dspTransitionPlayback.duration > 0
        ? state.dspTransitionPlayback.duration
        : null);
    if (!knownDuration) return rawOffset;
    return Math.max(0, Math.min(rawOffset, Math.max(0, knownDuration - 0.02)));
  };

  let handoffStarted = false;
  let continuationAudio = null;
  let continuationPreparePromise = null;
  let cachedContinuationResolved = false;

  const prepareContinuationAudio = async () => {
    if (continuationAudio) return continuationAudio;
    if (continuationPreparePromise) return continuationPreparePromise;

    continuationPreparePromise = (async () => {
      if (!cachedContinuationResolved && cachedContinuationWarmup) {
        cachedContinuationResolved = true;
        try {
          const cachedAudio = await cachedContinuationWarmup;
          if (cachedAudio) {
            cachedAudio.volume = getEffectiveLiveVolume(targetTrack);
            continuationAudio = cachedAudio;
            return cachedAudio;
          }
        } catch (err) {
          // ignore cache warmup errors and fallback to direct prepare
        }
      }

      const preparedAudio = createAudio(targetTrack);
      preparedAudio.preload = 'auto';
      preparedAudio.volume = getEffectiveLiveVolume(targetTrack);
      if (sliceSeconds > 0) {
        await seekAudioToOffset(preparedAudio, sliceSeconds);
      }
      continuationAudio = preparedAudio;
      return preparedAudio;
    })().finally(() => {
      continuationPreparePromise = null;
    });

    return continuationPreparePromise;
  };

  const fallbackToRegularNextTrackStart = async () => {
    stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
    const refreshedButton = getTrackButton(
      nextTrack.file,
      nextTrack.playlistIndex,
      nextTrack.playlistPosition,
      nextTrack.basePath || '/audio',
    );
    if (!refreshedButton) {
      setStatus('Не удалось продолжить после перехода: следующий трек не найден.');
      syncNowPlayingPanel();
      return;
    }

    await handlePlay(nextTrack.file, refreshedButton, nextTrack.basePath || '/audio', {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
      fromAutoplay: true,
      fromDspTransition: true,
      startAtSeconds: sliceSeconds,
    });
  };

  const startNextTrackFromTransition = async ({ reason = 'ended' } = {}) => {
    if (handoffStarted) return;
    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) {
      return;
    }
    handoffStarted = true;

    let preparedAudio = continuationAudio;
    if (!preparedAudio) {
      try {
        preparedAudio = await prepareContinuationAudio();
      } catch (err) {
        preparedAudio = null;
      }
    }

    if (!preparedAudio) {
      await fallbackToRegularNextTrackStart();
      return;
    }

    try {
      preparedAudio.volume = getEffectiveLiveVolume(targetTrack);
      try {
        transitionAudio.pause();
      } catch (err) {
        // ignore pause errors while switching from DSP transition
      }
      await preparedAudio.play();
    } catch (err) {
      await fallbackToRegularNextTrackStart();
      return;
    }

    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) {
      return;
    }

    stopDspTransitionPlayback({ stopAudio: true, clearTrackState: false });
    state.currentAudio = preparedAudio;
    state.currentTrack = targetTrack;
    setButtonPlaying(sourceTrack.key, false, sourceTrack);
    setTrackPaused(sourceTrack.key, false, sourceTrack);
    setButtonPlaying(targetTrack.key, true, targetTrack);
    setTrackPaused(targetTrack.key, false, targetTrack);
    startProgressLoop(preparedAudio, targetTrack.key);
    stopUnexpectedLiveAudios([preparedAudio]);
    setStatus(`Играет: ${nextTrack.file}`);
    triggerLiveDspTransitionForTrack(targetTrack);
    syncNowPlayingPanel();
    requestHostPlaybackSync(true);
  };

  transitionAudio.addEventListener('loadedmetadata', () => {
    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) return;
    const duration = getDuration(transitionAudio);
    if (duration) {
      state.dspTransitionPlayback.duration = duration;
    }
    syncNowPlayingPanel();
  });

  transitionAudio.addEventListener('timeupdate', () => {
    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) return;
    if (!handoffStarted) {
      const activeDuration = getDuration(transitionAudio) || state.dspTransitionPlayback.duration;
      const currentTime =
        Number.isFinite(transitionAudio.currentTime) && transitionAudio.currentTime >= 0
          ? transitionAudio.currentTime
          : 0;
      if (Number.isFinite(activeDuration) && activeDuration > 0) {
        const remaining = Math.max(0, activeDuration - currentTime);
        const handoffLeadSeconds = Math.max(0, LIVE_DSP_HANDOFF_LEAD_SECONDS + state.liveDspExitCompensationSeconds);
        if (remaining <= handoffLeadSeconds) {
          startNextTrackFromTransition({ reason: 'near-end' }).catch((err) => {
            console.error('Не удалось переключиться с DSP transition (near-end)', err);
          });
        }
      }
    }
    syncNowPlayingPanel();
  });

  transitionAudio.addEventListener('ended', () => {
    startNextTrackFromTransition({ reason: 'ended' }).catch((err) => {
      console.error('Не удалось завершить DSP transition', err);
      stopDspTransitionPlayback({ stopAudio: false, clearTrackState: true });
      syncNowPlayingPanel();
    });
  });

  transitionAudio.addEventListener('error', () => {
    if (!state.dspTransitionPlayback || state.dspTransitionPlayback.audio !== transitionAudio) return;
    stopDspTransitionPlayback({ stopAudio: false, clearTrackState: true });
    setStatus('Ошибка воспроизведения DSP перехода. Переходим к следующему треку.');
    handlePlay(nextTrack.file, targetButton, nextTrack.basePath || '/audio', {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
      fromAutoplay: true,
    }).catch((err) => {
      console.error('Не удалось запустить следующий трек после ошибки DSP transition', err);
    });
  });

  prepareContinuationAudio().catch(() => {});

  try {
    const adjustedTransitionStartOffsetSeconds = resolveAdjustedTransitionStartOffsetSeconds();
    if (adjustedTransitionStartOffsetSeconds > 0) {
      await seekAudioToOffset(transitionAudio, adjustedTransitionStartOffsetSeconds);
    }
    if (state.dspTransitionPlayback && state.dspTransitionPlayback.audio === transitionAudio) {
      state.dspTransitionPlayback.startOffsetSeconds = adjustedTransitionStartOffsetSeconds;
    }
    if (previousAudio) {
      try {
        previousAudio.pause();
      } catch (err) {
        // ignore pause errors while switching to DSP transition
      }
    }
    await transitionAudio.play();
    setStatus(`Переход: ${finishedTrack.file} -> ${nextTrack.file}`);
    return true;
  } catch (err) {
    stopDspTransitionPlayback({ stopAudio: false, clearTrackState: true });
    return false;
  }
}

async function tryAutoplayNextTrack(finishedTrack) {
  if (!isHostRole()) return false;
  if (state.autoplayStartInFlight) return false;

  state.autoplayStartInFlight = true;
  try {
    const nextTrack = resolveAutoplayNextTrack(finishedTrack);
    if (!nextTrack) return false;

    const transitionStarted = await tryStartAutoplayWithDspTransition(finishedTrack, nextTrack);
    if (transitionStarted) return true;

    const button = getTrackButton(nextTrack.file, nextTrack.playlistIndex, nextTrack.playlistPosition, nextTrack.basePath);
    if (!button) return false;

    await handlePlay(nextTrack.file, button, nextTrack.basePath, {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
      fromAutoplay: true,
    });
    const expectedKey = trackKey(nextTrack.file, nextTrack.basePath || '/audio');
    return Boolean(state.currentTrack && state.currentAudio && !state.currentAudio.paused && state.currentTrack.key === expectedKey);
  } finally {
    state.autoplayStartInFlight = false;
  }
}

function resetTrackReferences() {
  hideTrashDropzone();
  clearDesktopDragGhost();
  clearDragModeBadge();
  clearDragPreviewCard();
  clearTouchCopyHold();
  clearPlaylistReorderHold();
  if (state.touchCopyDragActive) {
    cleanupTouchCopyDrag({ restoreLayout: false });
  }
  state.buttonsByFile = new Map();
  state.cardsByFile = new Map();
  state.durationLabelsByFile = new Map();
  state.playlistDurationLabelsByIndex = new Map();
  state.trackNameLabelsByFile = new Map();
  state.hostHighlightedDescriptor = '';
}

function applyIncomingLayoutState(
  nextLayout,
  nextPlaylistNames,
  nextPlaylistMeta,
  nextPlaylistAutoplay,
  nextPlaylistDsp,
  nextDapConfig,
  nextTrackTitleModesByTrack = null,
  version = null,
  render = true,
) {
  const previousDap = { ...dapConfig };
  const previousLayout = ensurePlaylists(state.layout);
  const previousMeta = normalizePlaylistMeta(state.playlistMeta, previousLayout.length);
  const previousCurrentTrackWasDap = isDapTrackContext(state.currentTrack, previousDap);
  const normalizedLayout = normalizeLayoutForFiles(nextLayout, state.availableFiles);
  const normalizedNames = normalizePlaylistNames(nextPlaylistNames, normalizedLayout.length);
  const normalizedMeta = normalizePlaylistMeta(nextPlaylistMeta, normalizedLayout.length);
  const normalizedDap = normalizeDapConfig(nextDapConfig, normalizedLayout.length, state.dapConfig);
  const normalizedAutoplay = normalizePlaylistAutoplayWithDap(nextPlaylistAutoplay, normalizedDap, normalizedLayout.length);
  const normalizedDsp = normalizePlaylistDspFlags(nextPlaylistDsp, normalizedAutoplay, normalizedLayout.length);
  const normalizedTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(
    nextTrackTitleModesByTrack !== null && nextTrackTitleModesByTrack !== undefined
      ? nextTrackTitleModesByTrack
      : state.trackTitleModesByTrack,
    state.availableFiles,
    '/audio',
  );
  const withFolderCoverage = ensureFolderPlaylistsCoverage(normalizedLayout, normalizedNames, normalizedMeta);
  const changed =
    !layoutsEqual(state.layout, withFolderCoverage.layout) ||
    !playlistNamesEqual(state.playlistNames, withFolderCoverage.playlistNames, withFolderCoverage.layout.length) ||
    !playlistMetaEqual(state.playlistMeta, withFolderCoverage.playlistMeta, withFolderCoverage.layout.length) ||
    !playlistAutoplayEqual(state.playlistAutoplay, normalizedAutoplay, withFolderCoverage.layout.length) ||
    !playlistDspEqual(state.playlistDsp, normalizedDsp, normalizedAutoplay, withFolderCoverage.layout.length) ||
    !dapConfigEqual(state.dapConfig, normalizedDap, withFolderCoverage.layout.length) ||
    !trackTitleModesByTrackEqual(state.trackTitleModesByTrack, normalizedTrackTitleModes);

  state.layout = withFolderCoverage.layout;
  state.playlistNames = withFolderCoverage.playlistNames;
  state.playlistMeta = withFolderCoverage.playlistMeta;
  state.dapConfig = normalizeDapConfig(normalizedDap, state.layout.length, normalizedDap);
  if (!isDapEnabled(state.dapConfig)) {
    disarmDapNoSilence();
    clearDapInterruptedPlaybackSnapshot();
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
      disarmDapNoSilence();
      clearDapInterruptedPlaybackSnapshot();
    }
  }
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(normalizedAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(normalizedDsp, state.playlistAutoplay, state.layout.length);
  state.trackTitleModesByTrack = normalizedTrackTitleModes;
  const preferredCurrentTrackPlaylistIndex = previousCurrentTrackWasDap ? getDapPlaylistIndex(state.dapConfig) : null;
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
  saveTrackTitleModesByTrackSetting();

  const numericVersion = Number(version);
  if (Number.isFinite(numericVersion)) {
    state.layoutVersion = numericVersion;
  }

  if (changed && render) {
    renderZones();
  }

  if (!render) {
    updateDapSettingsUi(state.currentRole);
  }

  if (currentTrackContextChanged && isHostRole()) {
    requestHostPlaybackSync(true);
  }

  if (changed && isHostRole()) {
    ensureDapNoSilencePlayback({ reason: 'layout-sync' }).catch(() => {});
  }

  return changed || currentTrackContextChanged || dapSnapshotContextChanged;
}

function applyIncomingHostPlaybackState(nextState, sync = true) {
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
  syncDapInterruptedTrackState();
  syncPlaylistHeaderActiveState();

  return changed;
}

function buildLocalPlaybackSnapshot() {
  const dapPlayback = buildDapPlaybackSnapshotForSync(state.dapConfig);

  if (!state.currentTrack || !state.currentAudio) {
    return {
      trackFile: null,
      paused: false,
      currentTime: 0,
      duration: null,
      volume: getEffectiveLiveVolume(),
      showVolumePresets: state.showVolumePresetsEnabled,
      allowLiveSeek: state.liveSeekEnabled,
      dapPlayback,
      playlistIndex: null,
      playlistPosition: null,
    };
  }

  const rawCurrentTime = Number(state.currentAudio.currentTime);
  const currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;
  const resolvedDuration = getDuration(state.currentAudio) || getKnownDurationSeconds(state.currentTrack.key);

  return {
    trackFile: state.currentTrack.file,
    paused: Boolean(state.currentAudio.paused),
    currentTime,
    duration: Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : null,
    volume: getEffectiveLiveVolume(),
    showVolumePresets: state.showVolumePresetsEnabled,
    allowLiveSeek: state.liveSeekEnabled,
    dapPlayback,
    playlistIndex: normalizePlaylistTrackIndex(state.currentTrack.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(state.currentTrack.playlistPosition),
  };
}

async function fetchSharedPlaybackState() {
  const { ok, data } = await api.fetchPlayback();

  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось получить состояние воспроизведения хоста');
  }

  return sanitizeIncomingHostPlaybackState(data);
}

async function pushSharedPlaybackState(snapshot) {
  const { ok, data } = await api.postPlayback({ ...snapshot, clientId });

  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось синхронизировать состояние воспроизведения');
  }

  applyIncomingHostPlaybackState(data, true);
}

function normalizeIncomingPlaybackCommand(rawCommand) {
  if (!rawCommand || typeof rawCommand !== 'object') return null;

  const type = typeof rawCommand.type === 'string' ? rawCommand.type.trim() : '';
  if (type === PLAYBACK_COMMAND_TOGGLE_CURRENT) {
    return {
      type: PLAYBACK_COMMAND_TOGGLE_CURRENT,
      sourceClientId: typeof rawCommand.sourceClientId === 'string' ? rawCommand.sourceClientId : null,
      sourceUsername: typeof rawCommand.sourceUsername === 'string' ? rawCommand.sourceUsername : null,
    };
  }

  if (type === PLAYBACK_COMMAND_SET_VOLUME) {
    const volume = normalizeLiveVolumePreset(rawCommand.volume, null);
    if (volume === null) return null;

    return {
      type: PLAYBACK_COMMAND_SET_VOLUME,
      volume,
      sourceClientId: typeof rawCommand.sourceClientId === 'string' ? rawCommand.sourceClientId : null,
      sourceUsername: typeof rawCommand.sourceUsername === 'string' ? rawCommand.sourceUsername : null,
    };
  }

  if (type === PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE) {
    return {
      type: PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE,
      showVolumePresets: Boolean(rawCommand.showVolumePresets),
      sourceClientId: typeof rawCommand.sourceClientId === 'string' ? rawCommand.sourceClientId : null,
      sourceUsername: typeof rawCommand.sourceUsername === 'string' ? rawCommand.sourceUsername : null,
    };
  }

  if (type === PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED) {
    return {
      type: PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED,
      allowLiveSeek: Boolean(rawCommand.allowLiveSeek),
      sourceClientId: typeof rawCommand.sourceClientId === 'string' ? rawCommand.sourceClientId : null,
      sourceUsername: typeof rawCommand.sourceUsername === 'string' ? rawCommand.sourceUsername : null,
    };
  }

  if (type === PLAYBACK_COMMAND_SEEK_CURRENT) {
    const positionRatio = normalizePlaybackSeekRatio(rawCommand.positionRatio);
    if (positionRatio === null) return null;

    return {
      type: PLAYBACK_COMMAND_SEEK_CURRENT,
      positionRatio,
      finalize: Boolean(rawCommand.finalize),
      sourceClientId: typeof rawCommand.sourceClientId === 'string' ? rawCommand.sourceClientId : null,
      sourceUsername: typeof rawCommand.sourceUsername === 'string' ? rawCommand.sourceUsername : null,
    };
  }

  if (type !== PLAYBACK_COMMAND_PLAY_TRACK) {
    return null;
  }

  const file = typeof rawCommand.file === 'string' ? rawCommand.file.trim() : '';
  if (!file) return null;

  return {
    type: PLAYBACK_COMMAND_PLAY_TRACK,
    file,
    basePath: '/audio',
    playlistIndex: normalizePlaylistTrackIndex(rawCommand.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(rawCommand.playlistPosition),
    sourceClientId: typeof rawCommand.sourceClientId === 'string' ? rawCommand.sourceClientId : null,
    sourceUsername: typeof rawCommand.sourceUsername === 'string' ? rawCommand.sourceUsername : null,
  };
}

async function sendLivePlaybackCommand(command) {
  const { ok, data } = await api.postPlaybackCommand({
    ...command,
    clientId,
  });
  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось отправить live-команду');
  }
  return normalizeIncomingPlaybackCommand(data && data.command ? data.command : command);
}

async function executeIncomingPlaybackCommand(commandPayload) {
  if (!isHostRole()) return;

  const command = normalizeIncomingPlaybackCommand(commandPayload);
  if (!command) return;
  if (command.sourceClientId && command.sourceClientId === clientId) return;

  const sourceTag = command.sourceUsername ? ` (co-host: ${command.sourceUsername})` : '';
  try {
    if (command.type === PLAYBACK_COMMAND_TOGGLE_CURRENT) {
      await toggleNowPlayingPlayback();
      if (sourceTag) {
        setStatus(`Live управление${sourceTag}.`);
      }
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
      setLivePlaybackVolume(command.volume, { sync: true, announce: false });
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

      try {
        if (typeof state.currentAudio.fastSeek === 'function') {
          state.currentAudio.fastSeek(nextTime);
        } else {
          state.currentAudio.currentTime = nextTime;
        }
      } catch (err) {
        try {
          state.currentAudio.currentTime = nextTime;
        } catch (fallbackErr) {
          return;
        }
      }

      updateProgress(state.currentTrack.key, nextTime, duration);
      syncNowPlayingPanel();
      requestHostLiveSeekSync({ finalize: Boolean(command.finalize) });
      return;
    }

    const button = getTrackButton(command.file, command.playlistIndex, command.playlistPosition, command.basePath);
    if (!button) {
      setStatus(`Не удалось выполнить live-команду: трек ${command.file} не найден.`);
      return;
    }

    await handlePlay(command.file, button, command.basePath, {
      playlistIndex: command.playlistIndex,
      playlistPosition: command.playlistPosition,
    });

    if (sourceTag) {
      setStatus(`Live управление${sourceTag}.`);
    }
  } catch (err) {
    console.error('Не удалось выполнить live-команду', err);
    setStatus('Не удалось выполнить live-команду co-host.');
  }
}

async function requestCoHostPlayTrack(file, basePath = '/audio', playbackContext = {}) {
  if (!isCoHostRole()) return false;

  const command = {
    type: PLAYBACK_COMMAND_PLAY_TRACK,
    file,
    basePath,
    playlistIndex:
      Number.isInteger(playbackContext.playlistIndex) && playbackContext.playlistIndex >= 0
        ? playbackContext.playlistIndex
        : null,
    playlistPosition:
      Number.isInteger(playbackContext.playlistPosition) && playbackContext.playlistPosition >= 0
        ? playbackContext.playlistPosition
        : null,
  };
  await sendLivePlaybackCommand(command);
  return true;
}

async function requestCoHostToggleCurrentPlayback() {
  if (!isCoHostRole()) return false;
  await sendLivePlaybackCommand({ type: PLAYBACK_COMMAND_TOGGLE_CURRENT });
  return true;
}

async function requestCoHostSetLiveVolume(volume) {
  if (!isCoHostRole()) return false;
  const normalized = normalizeLiveVolumePreset(volume, null);
  if (normalized === null) return false;
  await sendLivePlaybackCommand({ type: PLAYBACK_COMMAND_SET_VOLUME, volume: normalized });
  return true;
}

async function requestCoHostSetVolumePresetsVisibility(showVolumePresets) {
  if (!isCoHostRole()) return false;
  await sendLivePlaybackCommand({
    type: PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE,
    showVolumePresets: Boolean(showVolumePresets),
  });
  return true;
}

async function requestCoHostSetLiveSeekEnabled(allowLiveSeek) {
  if (!isCoHostRole()) return false;
  await sendLivePlaybackCommand({
    type: PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED,
    allowLiveSeek: Boolean(allowLiveSeek),
  });
  return true;
}

async function requestCoHostSeekCurrentPlayback(positionRatio, { finalize = false } = {}) {
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

function scheduleCoHostSeekFlush(delayMs = 0) {
  if (state.cohostSeekCommandTimer !== null) return;
  state.cohostSeekCommandTimer = setTimeout(() => {
    state.cohostSeekCommandTimer = null;
    flushQueuedCoHostSeekCommands().catch(() => {});
  }, Math.max(0, delayMs));
}

function clearQueuedCoHostSeekCommands() {
  if (state.cohostSeekCommandTimer !== null) {
    clearTimeout(state.cohostSeekCommandTimer);
    state.cohostSeekCommandTimer = null;
  }
  state.cohostSeekPendingRatio = null;
  state.cohostSeekPendingFinalize = false;
  state.cohostSeekCommandInFlight = false;
  state.cohostSeekLastSentAt = 0;
}

async function flushQueuedCoHostSeekCommands() {
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

function queueCoHostSeekCurrentPlayback(positionRatio, { immediate = false, finalize = false } = {}) {
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

function requestHostLiveSeekSync({ finalize = false } = {}) {
  if (!isHostRole()) return;

  const now = Date.now();
  if (!finalize && now - state.lastHostLiveSeekSyncAt < HOST_LIVE_SEEK_SYNC_INTERVAL_MS) {
    return;
  }
  state.lastHostLiveSeekSyncAt = now;
  requestHostPlaybackSync(true);
}

function requestHostPlaybackSync(force = false) {
  if (!isHostRole()) return;

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

async function fetchSharedLayoutState() {
  const { ok, data } = await api.fetchLayout();

  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось получить конфигурацию плей-листов');
  }

  return {
    layout: Array.isArray(data.layout) ? data.layout : [[]],
    playlistNames: Array.isArray(data.playlistNames) ? data.playlistNames : [],
    playlistMeta: Array.isArray(data.playlistMeta) ? data.playlistMeta : [],
    playlistAutoplay: Array.isArray(data.playlistAutoplay) ? data.playlistAutoplay : [],
    playlistDsp: Array.isArray(data.playlistDsp) ? data.playlistDsp : [],
    dapConfig: data && data.dapConfig && typeof data.dapConfig === 'object' ? data.dapConfig : { ...DEFAULT_DAP_CONFIG },
    trackTitleModesByTrack:
      data && data.trackTitleModesByTrack && typeof data.trackTitleModesByTrack === 'object'
        ? data.trackTitleModesByTrack
        : serializeTrackTitleModesByTrack(),
    version: Number.isFinite(Number(data.version)) ? Number(data.version) : 0,
  };
}

async function pushSharedLayout({ renderOnApply = true } = {}) {
  const payloadState = ensureFolderPlaylistsCoverage(state.layout, state.playlistNames, state.playlistMeta);
  const payloadDapConfig = normalizeDapConfig(state.dapConfig, payloadState.layout.length, state.dapConfig);
  const payloadAutoplay = normalizePlaylistAutoplayWithDap(state.playlistAutoplay, payloadDapConfig, payloadState.layout.length);
  const payloadDsp = normalizePlaylistDspFlags(state.playlistDsp, payloadAutoplay, payloadState.layout.length);

  const { ok, data } = await api.postLayout({
    layout: payloadState.layout,
    playlistNames: payloadState.playlistNames,
    playlistMeta: payloadState.playlistMeta,
    playlistAutoplay: payloadAutoplay,
    playlistDsp: payloadDsp,
    dapConfig: payloadDapConfig,
    trackTitleModesByTrack: serializeTrackTitleModesByTrack(),
    clientId,
    version: state.layoutVersion,
  });

  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось синхронизировать плей-листы');
  }

  applyIncomingLayoutState(
    data.layout,
    data.playlistNames,
    data.playlistMeta,
    data.playlistAutoplay,
    data.playlistDsp,
    data.dapConfig,
    data.trackTitleModesByTrack,
    data.version,
    renderOnApply,
  );
}




function connectLayoutStream() {
  createLayoutStream({
    onLayout(payload) {
      if (!payload || !Array.isArray(payload.layout)) return;
      applyIncomingLayoutState(
        payload.layout,
        payload.playlistNames,
        payload.playlistMeta,
        payload.playlistAutoplay,
        payload.playlistDsp,
        payload.dapConfig,
        payload.trackTitleModesByTrack,
        payload.version,
        true,
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

async function initializePlaybackState() {
  const serverPlayback = await fetchSharedPlaybackState();
  applyIncomingHostPlaybackState(serverPlayback, true);
}

async function initializeLayoutState() {
  const serverState = await fetchSharedLayoutState();
  const incomingLayout = ensurePlaylists(serverState.layout);
  const incomingNames = normalizePlaylistNames(serverState.playlistNames, incomingLayout.length);
  const incomingMeta = normalizePlaylistMeta(serverState.playlistMeta, incomingLayout.length);
  const incomingDap = normalizeDapConfig(serverState.dapConfig, incomingLayout.length, DEFAULT_DAP_CONFIG);
  const incomingAutoplay = normalizePlaylistAutoplayWithDap(serverState.playlistAutoplay, incomingDap, incomingLayout.length);
  const incomingDsp = normalizePlaylistDspFlags(serverState.playlistDsp, incomingAutoplay, incomingLayout.length);
  const incomingTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(serverState.trackTitleModesByTrack, state.availableFiles, '/audio');

  let nextLayout = normalizeLayoutForFiles(incomingLayout, state.availableFiles);
  let nextNames = normalizePlaylistNames(incomingNames, nextLayout.length);
  let nextMeta = normalizePlaylistMeta(incomingMeta, nextLayout.length);
  let nextDap = normalizeDapConfig(incomingDap, nextLayout.length, incomingDap);
  let nextAutoplay = normalizePlaylistAutoplayWithDap(incomingAutoplay, nextDap, nextLayout.length);
  let nextDsp = normalizePlaylistDspFlags(incomingDsp, nextAutoplay, nextLayout.length);
  let nextTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(incomingTrackTitleModes, state.availableFiles, '/audio');
  let shouldPush =
    !layoutsEqual(incomingLayout, nextLayout) ||
    !playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !playlistMetaEqual(incomingMeta, nextMeta, nextLayout.length) ||
    !playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length) ||
    !playlistDspEqual(incomingDsp, nextDsp, nextAutoplay, nextLayout.length) ||
    !dapConfigEqual(incomingDap, nextDap, nextLayout.length) ||
    !trackTitleModesByTrackEqual(incomingTrackTitleModes, nextTrackTitleModes);

  if (isHostRole() && isServerLayoutEmpty(incomingLayout)) {
    const legacyLayout = readLegacyLocalLayout(state.availableFiles);
    if (legacyLayout && !layoutsEqual(legacyLayout, nextLayout)) {
      nextLayout = legacyLayout;
      nextNames = normalizePlaylistNames(nextNames, nextLayout.length);
      nextMeta = normalizePlaylistMeta(nextMeta, nextLayout.length);
      nextDap = normalizeDapConfig(nextDap, nextLayout.length, nextDap);
      nextAutoplay = normalizePlaylistAutoplayWithDap(nextAutoplay, nextDap, nextLayout.length);
      nextDsp = normalizePlaylistDspFlags(nextDsp, nextAutoplay, nextLayout.length);
      shouldPush = true;
    }
  }

  const withFolderCoverage = ensureFolderPlaylistsCoverage(nextLayout, nextNames, nextMeta);
  nextLayout = withFolderCoverage.layout;
  nextNames = withFolderCoverage.playlistNames;
  nextMeta = withFolderCoverage.playlistMeta;
  nextDap = normalizeDapConfig(nextDap, nextLayout.length, nextDap);
  nextAutoplay = normalizePlaylistAutoplayWithDap(nextAutoplay, nextDap, nextLayout.length);
  nextDsp = normalizePlaylistDspFlags(nextDsp, nextAutoplay, nextLayout.length);
  nextTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(nextTrackTitleModes, state.availableFiles, '/audio');

  shouldPush =
    shouldPush ||
    !layoutsEqual(incomingLayout, nextLayout) ||
    !playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !playlistMetaEqual(incomingMeta, nextMeta, nextLayout.length) ||
    !playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length) ||
    !playlistDspEqual(incomingDsp, nextDsp, nextAutoplay, nextLayout.length) ||
    !dapConfigEqual(incomingDap, nextDap, nextLayout.length) ||
    !trackTitleModesByTrackEqual(incomingTrackTitleModes, nextTrackTitleModes);

  state.layout = nextLayout;
  state.playlistNames = nextNames;
  state.playlistMeta = nextMeta;
  state.dapConfig = normalizeDapConfig(nextDap, state.layout.length, nextDap);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(nextAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(nextDsp, state.playlistAutoplay, state.layout.length);
  state.trackTitleModesByTrack = nextTrackTitleModes;
  saveTrackTitleModesByTrackSetting();
  state.layoutVersion = serverState.version;

  if (shouldPush) {
    await pushSharedLayout({ renderOnApply: false });
  }

  try {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_LAYOUT_KEY);
  } catch (err) {
    // Ignore storage cleanup errors.
  }
}

async function resetPlaylists() {
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

async function addPlaylist() {
  state.layout = ensurePlaylists(state.layout);
  state.layout.push([]);
  state.playlistNames = normalizePlaylistNames([...playlistNames, defaultPlaylistName(state.layout.length - 1)], state.layout.length);
  state.playlistMeta = normalizePlaylistMeta([...playlistMeta, defaultPlaylistMeta()], state.layout.length);
  state.dapConfig = normalizeDapConfig(state.dapConfig, state.layout.length, state.dapConfig);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap([...playlistAutoplay, false], state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags([...playlistDsp, false], state.playlistAutoplay, state.layout.length);
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(`Добавлен плей-лист ${state.layout.length}.`);
  } catch (err) {
    console.error(err);
    setStatus('Не удалось синхронизировать новый плей-лист.');
  }
}

async function renamePlaylist(playlistIndex, rawName) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return;

  const nextNames = state.playlistNames.slice();
  nextNames[playlistIndex] = rawName;
  const normalizedNames = normalizePlaylistNames(nextNames, state.layout.length);

  if (playlistNamesEqual(state.playlistNames, normalizedNames, state.layout.length)) {
    renderZones();
    return;
  }

  const previousNames = state.playlistNames.slice();
  state.playlistNames = normalizedNames;
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(`Переименован плей-лист ${playlistIndex + 1}.`);
  } catch (err) {
    console.error(err);
    state.playlistNames = previousNames;
    renderZones();
    setStatus('Не удалось синхронизировать название плей-листа.');
  }
}

async function togglePlaylistAutoplay(playlistIndex) {
  if (!isHostRole()) {
    setStatus('Автовоспроизведение может менять только хост.');
    return;
  }

  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return;
  if (isDapPlaylistIndex(playlistIndex)) {
    setStatus('Для DAP-плей-листа автовоспроизведение всегда включено.');
    return;
  }

  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const nextAutoplay = state.playlistAutoplay.slice();
  nextAutoplay[playlistIndex] = !nextAutoplay[playlistIndex];
  const normalizedAutoplay = normalizePlaylistAutoplayWithDap(nextAutoplay, state.dapConfig, state.layout.length);
  const normalizedDsp = normalizePlaylistDspFlags(state.playlistDsp, normalizedAutoplay, state.layout.length);

  if (
    playlistAutoplayEqual(state.playlistAutoplay, normalizedAutoplay, state.layout.length) &&
    playlistDspEqual(state.playlistDsp, normalizedDsp, normalizedAutoplay, state.layout.length)
  ) {
    return;
  }

  state.playlistAutoplay = normalizedAutoplay;
  state.playlistDsp = normalizedDsp;
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(
      `Автовоспроизведение для плей-листа ${playlistIndex + 1}: ${
        state.playlistAutoplay[playlistIndex] ? 'включено' : 'выключено'
      }.`,
    );
  } catch (err) {
    console.error(err);
    state.playlistAutoplay = normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    renderZones();
    setStatus('Не удалось синхронизировать автопроигрывание плей-листа.');
  }
}

async function togglePlaylistDsp(playlistIndex) {
  if (!isHostRole()) {
    setStatus('DSP для плей-листа может менять только хост.');
    return;
  }

  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return;
  if (!state.playlistAutoplay[playlistIndex]) {
    setStatus('DSP можно включить только при активном автопроигрывании.');
    return;
  }

  const previousDsp = state.playlistDsp.slice();
  const nextDsp = state.playlistDsp.slice();
  nextDsp[playlistIndex] = !nextDsp[playlistIndex];
  const normalizedDsp = normalizePlaylistDspFlags(nextDsp, state.playlistAutoplay, state.layout.length);

  if (playlistDspEqual(state.playlistDsp, normalizedDsp, state.playlistAutoplay, state.layout.length)) return;

  state.playlistDsp = normalizedDsp;
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(`DSP для плей-листа ${playlistIndex + 1}: ${state.playlistDsp[playlistIndex] ? 'включен' : 'выключен'}.`);
  } catch (err) {
    console.error(err);
    state.playlistDsp = previousDsp;
    renderZones();
    setStatus('Не удалось синхронизировать DSP плей-листа.');
  }
}

async function syncDapConfig(nextDapConfig, { successMessage = 'DAP обновлен.' } = {}) {
  if (!isHostRole()) {
    setStatus('DAP может менять только хост.');
    return false;
  }

  const normalizedNextDap = normalizeDapConfig(nextDapConfig, state.layout.length, state.dapConfig);
  const nextAutoplay = normalizePlaylistAutoplayWithDap(state.playlistAutoplay, normalizedNextDap, state.layout.length);
  const nextDsp = normalizePlaylistDspFlags(state.playlistDsp, nextAutoplay, state.layout.length);

  if (
    dapConfigEqual(state.dapConfig, normalizedNextDap, state.layout.length) &&
    playlistAutoplayEqual(state.playlistAutoplay, nextAutoplay, state.layout.length) &&
    playlistDspEqual(state.playlistDsp, nextDsp, nextAutoplay, state.layout.length)
  ) {
    updateDapSettingsUi(state.currentRole);
    return false;
  }

  const previousDap = { ...dapConfig };
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDapInterruptedPlaybackSnapshot = state.dapInterruptedPlaybackSnapshot
    ? { ...dapInterruptedPlaybackSnapshot }
    : null;
  const previousDapEnabled = Boolean(previousDap.enabled);
  const previousDapIndex = normalizePlaylistTrackIndex(previousDap.playlistIndex);
  const nextDapEnabled = Boolean(normalizedNextDap.enabled);
  const nextDapIndex = normalizePlaylistTrackIndex(normalizedNextDap.playlistIndex);
  const shouldResetNoSilenceArm =
    !nextDapEnabled || !previousDapEnabled || previousDapIndex !== nextDapIndex;
  const shouldStopDapPlaybackOnDisable =
    isDapEnabled(previousDap) &&
    !normalizedNextDap.enabled &&
    ((state.currentTrack && state.currentAudio && !state.currentAudio.paused && isDapTrackContext(state.currentTrack, previousDap)) ||
      (isDspTransitionPlaybackActive() &&
        state.dspTransitionPlayback &&
        (isDapTrackContext(state.dspTransitionPlayback.fromTrack, previousDap) ||
          isDapTrackContext(state.dspTransitionPlayback.toTrack, previousDap))));

  state.dapConfig = normalizedNextDap;
  state.playlistAutoplay = nextAutoplay;
  state.playlistDsp = nextDsp;
  if (shouldResetNoSilenceArm) {
    disarmDapNoSilence();
    clearDapInterruptedPlaybackSnapshot();
  }
  if (shouldStopDapPlaybackOnDisable) {
    stopAndClearLocalPlayback();
    requestHostPlaybackSync(true);
  }
  applyLiveVolumeToCurrentAudio();
  if (state.dspTransitionPlayback && state.dspTransitionPlayback.audio) {
    state.dspTransitionPlayback.audio.volume = getEffectiveLiveVolume(state.dspTransitionPlayback.toTrack || null);
  }
  updateDapSettingsUi(state.currentRole);
  renderZones();
  updateVolumePresetsUi();

  try {
    await pushSharedLayout();
    if (successMessage) {
      setStatus(successMessage);
    }
    if (normalizedNextDap.enabled) {
      ensureDapNoSilencePlayback({ reason: 'dap-config-updated' }).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error(err);
    state.dapConfig = normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    state.dapInterruptedPlaybackSnapshot = previousDapInterruptedPlaybackSnapshot;
    updateDapSettingsUi(state.currentRole);
    renderZones();
    updateVolumePresetsUi();
    setStatus('Не удалось синхронизировать DAP.');
    return false;
  }
}

async function togglePlaylistDap(playlistIndex) {
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

function buildPlaylistCoverage(layoutState) {
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

function getLiveLockedPlaylistIndex() {
  if (state.currentTrack && typeof state.currentTrack.file === 'string' && state.currentTrack.file.trim()) {
    const currentPlaylistIndex = normalizePlaylistTrackIndex(state.currentTrack.playlistIndex);
    if (currentPlaylistIndex !== null) {
      return currentPlaylistIndex;
    }
  }

  const hostPlaybackIndex =
    state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string' && state.hostPlaybackState.trackFile.trim()
      ? normalizePlaylistTrackIndex(state.hostPlaybackState.playlistIndex)
      : null;

  if (hostPlaybackIndex !== null) {
    return hostPlaybackIndex;
  }

  return null;
}

function syncPlaylistHeaderActiveState() {
  if (!zonesContainer) return;

  const dapPlaylistIndex = getDapPlaylistIndex(state.dapConfig);
  const localPlaybackIndex =
    state.currentTrack && typeof state.currentTrack.file === 'string' && state.currentTrack.file.trim()
      ? normalizePlaylistTrackIndex(state.currentTrack.playlistIndex)
      : null;
  const isLocalPlaybackPaused = Boolean(state.currentTrack && state.currentAudio && state.currentAudio.paused);
  const hostPlaybackIndex =
    state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string' && state.hostPlaybackState.trackFile.trim()
      ? normalizePlaylistTrackIndex(state.hostPlaybackState.playlistIndex)
      : null;
  const livePlaybackIndex = isHostRole() ? localPlaybackIndex : hostPlaybackIndex;
  const isLivePlaybackPaused = isHostRole() ? isLocalPlaybackPaused : Boolean(state.hostPlaybackState.paused);
  const dapPlaybackState = sanitizeIncomingDapPlaybackState(
    isHostRole()
      ? buildDapPlaybackSnapshotForSync(state.dapConfig)
      : state.hostPlaybackState && typeof state.hostPlaybackState === 'object'
        ? state.hostPlaybackState.dapPlayback
        : null,
  );
  const dapPlaybackIndex = dapPlaybackState.trackFile
    ? normalizePlaylistTrackIndex(dapPlaybackState.playlistIndex)
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

function getPlaylistDeleteEligibility(playlistIndex) {
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

async function deletePlaylist(playlistIndex) {
  const eligibility = getPlaylistDeleteEligibility(playlistIndex);
  if (!eligibility.canDelete) {
    setStatus(`Удаление запрещено: ${eligibility.reason}`);
    return;
  }

  const safeTitle = sanitizePlaylistName(state.playlistNames[playlistIndex], playlistIndex);
  const confirmed = window.confirm(`Удалить плей-лист "${safeTitle}"?`);
  if (!confirmed) {
    return;
  }

  const previousLayout = ensurePlaylists(state.layout).map((playlist) => playlist.slice());
  const previousNames = state.playlistNames.slice();
  const previousMeta = clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...dapConfig };
  const previousCurrentTrackWasDap = isDapTrackContext(state.currentTrack, previousDap);
  const previousCurrentTrackContext =
    state.currentTrack && typeof state.currentTrack === 'object'
      ? {
          playlistIndex: state.currentTrack.playlistIndex,
          playlistPosition: state.currentTrack.playlistPosition,
        }
      : null;
  const previousDapInterruptedSnapshot = state.dapInterruptedPlaybackSnapshot
    ? { ...dapInterruptedPlaybackSnapshot }
    : null;

  const nextLayout = previousLayout.map((playlist) => playlist.slice());
  nextLayout.splice(playlistIndex, 1);

  const nextNames = previousNames.slice();
  nextNames.splice(playlistIndex, 1);
  const nextMeta = previousMeta.slice();
  nextMeta.splice(playlistIndex, 1);
  const nextAutoplay = previousAutoplay.slice();
  nextAutoplay.splice(playlistIndex, 1);
  const nextDsp = previousDsp.slice();
  nextDsp.splice(playlistIndex, 1);
  const nextDapRaw = { ...previousDap };
  if (isDapPlaylistIndex(playlistIndex, previousDap)) {
    nextDapRaw.enabled = false;
    nextDapRaw.playlistIndex = null;
  } else {
    const previousDapIndex = normalizePlaylistTrackIndex(previousDap.playlistIndex);
    if (previousDapIndex !== null && previousDapIndex > playlistIndex) {
      nextDapRaw.playlistIndex = previousDapIndex - 1;
    }
  }

  state.layout = ensurePlaylists(nextLayout);
  state.playlistNames = normalizePlaylistNames(nextNames, state.layout.length);
  state.playlistMeta = normalizePlaylistMeta(nextMeta, state.layout.length);
  state.dapConfig = normalizeDapConfig(nextDapRaw, state.layout.length, nextDapRaw);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(nextAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(nextDsp, state.playlistAutoplay, state.layout.length);
  const preferredCurrentTrackPlaylistIndex = previousCurrentTrackWasDap ? getDapPlaylistIndex(state.dapConfig) : null;
  const currentTrackContextChanged = reconcileTrackContextWithLayout(state.currentTrack, {
    preferredPlaylistIndex: preferredCurrentTrackPlaylistIndex,
  });
  reconcileDapInterruptedSnapshotWithLayout();
  if (currentTrackContextChanged && state.currentAudio) {
    applyLiveVolumeToCurrentAudio();
  }
  updateDapSettingsUi(state.currentRole);
  renderZones();
  if (currentTrackContextChanged && isHostRole()) {
    requestHostPlaybackSync(true);
  }

  try {
    await pushSharedLayout();
    setStatus(`Плей-лист "${safeTitle}" удален.`);
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = previousNames;
    state.playlistMeta = previousMeta;
    state.dapConfig = normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    if (state.currentTrack && previousCurrentTrackContext) {
      state.currentTrack.playlistIndex = previousCurrentTrackContext.playlistIndex;
      state.currentTrack.playlistPosition = previousCurrentTrackContext.playlistPosition;
    }
    state.dapInterruptedPlaybackSnapshot = previousDapInterruptedSnapshot ? { ...previousDapInterruptedSnapshot } : null;
    const rollbackPreferredIndex = previousCurrentTrackWasDap ? getDapPlaylistIndex(state.dapConfig) : null;
    const rollbackTrackContextChanged = reconcileTrackContextWithLayout(state.currentTrack, {
      preferredPlaylistIndex: rollbackPreferredIndex,
    });
    const rollbackSnapshotContextChanged = reconcileDapInterruptedSnapshotWithLayout();
    if ((rollbackTrackContextChanged || rollbackSnapshotContextChanged) && state.currentAudio) {
      applyLiveVolumeToCurrentAudio();
    }
    updateDapSettingsUi(state.currentRole);
    renderZones();
    setStatus(err && err.message ? err.message : 'Не удалось синхронизировать удаление плей-листа.');
  }
}

function shouldVirtualizePlaylist(playlistFiles) {
  if (!Array.isArray(playlistFiles) || playlistFiles.length < PLAYLIST_VIRTUALIZATION_MIN_ITEMS) {
    return false;
  }
  if (typeof window !== 'object' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(pointer: coarse)').matches;
}

function syncVirtualizedRenderedTrackState() {
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

function mountVirtualizedPlaylistCards(zoneBody, playlistCards) {
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

function renderZones() {
  if (!zonesContainer) return;
  state.zoneBodiesCache = [];
  hideCollapsedPlaylistsOverlay();
  zonesContainer.innerHTML = '';
  resetTrackReferences();
  state.layout = ensurePlaylists(state.layout);
  state.playlistMeta = normalizePlaylistMeta(state.playlistMeta, state.layout.length);
  if (isTouchPlaylistCollapseEnabled()) {
    if (state.collapsedPlaylistLayoutLength !== null && state.collapsedPlaylistLayoutLength !== state.layout.length) {
      state.collapsedPlaylistIndices.clear();
      hideCollapsedPlaylistsOverlay();
    }
    state.collapsedPlaylistLayoutLength = state.layout.length;
    pruneCollapsedPlaylistIndices(state.layout.length);
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
  const trackOccurrence = buildTrackOccurrenceMap(state.layout);
  const renderOrder = buildPlaylistRenderOrder(state.layout.length, state.dapConfig);
  const visibleRenderOrder = renderOrder.filter((playlistIndex) => !isPlaylistCollapsedForLocalView(playlistIndex));

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
      setDropEffectFromEvent(e, playlistIndex);
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => handleDrop(e, playlistIndex));

    const header = document.createElement('div');
    header.className = 'playlist-header';
    if (isHostRole()) {
      header.classList.add('playlist-header--reorder-enabled');
      header.addEventListener('pointerdown', (event) => {
        startPlaylistReorderHold(event, playlistIndex);
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
        startPlaylistCollapseHold(event, playlistIndex);
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
    count.textContent = getPlaylistDurationText(playlistIndex);
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
    autoplayButton.hidden = isDapPlaylist || (hideInactiveIndicatorsOnSlave && !isAutoplayEnabled);
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
    dspButton.hidden = hideInactiveIndicatorsOnSlave && !isDspEnabled;
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

    const playlistCards = playlistFiles.map((file, rowIndex) => {
      const canDeleteTrack = (trackOccurrence.get(file) || 0) > 1;
      return buildTrackCard(file, '/audio', {
        draggable: true,
        orderNumber: rowIndex + 1,
        playlistIndex,
        playlistPosition: rowIndex,
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

    body.addEventListener('dragover', (e) => applyDragPreview(body, e));

    zone.append(header, body);
    zonesContainer.appendChild(zone);
  });
  state.zoneBodiesCache = Array.from(zonesContainer.querySelectorAll('.zone-body'));

  syncPlaylistHeaderActiveState();
  syncCurrentTrackState();
  syncTrackRelocationHighlights();
}

function syncCurrentTrackState() {
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

function syncDapInterruptedTrackState() {
  const interruptedState = getVisibleDapInterruptedPlaybackDisplayState(state.dapConfig);
  const previousState = state.syncedDapInterruptedUiState;

  if (
    previousState &&
    (!interruptedState ||
      interruptedState.fileKey !== previousState.fileKey ||
      !isTrackPlaybackContextEqual(interruptedState.playbackContext, previousState.playbackContext))
  ) {
    setTrackPausedByContext(previousState.fileKey, false, previousState.playbackContext);
    refreshTrackDurationLabels(previousState.fileKey);
    state.syncedDapInterruptedUiState = null;
  }

  if (!interruptedState) return;

  setTrackPausedByContext(interruptedState.fileKey, true, interruptedState.playbackContext);
  refreshTrackDurationLabels(interruptedState.fileKey);
  state.syncedDapInterruptedUiState = {
    fileKey: interruptedState.fileKey,
    playbackContext: normalizeTrackPlaybackContext(interruptedState.playbackContext),
  };
}

async function handleDrop(event, targetZoneIndex) {
  event.preventDefault();
  if (!state.draggingCard || !state.dragContext) {
    hideTrashDropzone();
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }
  if (!Number.isInteger(targetZoneIndex) || targetZoneIndex < 0) {
    hideTrashDropzone();
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }

  const targetZone = event.currentTarget;
  if (!targetZone) {
    hideTrashDropzone();
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }
  targetZone.classList.remove('drag-over');
  state.dragDropHandled = true;

  const previousLayout = cloneLayoutState(state.layout);
  const previousNames = state.playlistNames.slice();
  const previousMeta = clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...dapConfig };
  const undoSnapshot = createTrackRelocationUndoSnapshot({
    layoutState: previousLayout,
    namesState: previousNames,
    metaState: previousMeta,
    autoplayState: previousAutoplay,
    dspState: previousDsp,
    dapState: previousDap,
  });
  const sourceZoneIndex = Number.isInteger(state.dragContext.sourceZoneIndex) ? state.dragContext.sourceZoneIndex : null;
  const preservedScrollTops = capturePlaylistBodyScrollTops([sourceZoneIndex, targetZoneIndex]);
  const isCopyDrop = isActiveCopyDrag(event, targetZoneIndex);
  const targetBody = targetZone.querySelector('.zone-body');
  let relocatedTrackContext = null;

  let nextLayout = cloneLayoutState(state.dragContext.snapshotLayout);
  if (!Array.isArray(nextLayout[targetZoneIndex])) {
    hideTrashDropzone();
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }

  if (isCopyDrop) {
    if (!state.dragContext.file) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }
    let insertIndex = resolveDropInsertIndex(targetBody, targetZoneIndex, nextLayout);
    insertIndex = Math.max(0, Math.min(insertIndex, nextLayout[targetZoneIndex].length));
    nextLayout[targetZoneIndex].splice(insertIndex, 0, state.dragContext.file);
    relocatedTrackContext = {
      file: state.dragContext.file,
      playlistIndex: targetZoneIndex,
      playlistPosition: insertIndex,
    };
  } else {
    clearDragPreviewCard();
    const resolution = resolveTrackIndexByContext(nextLayout, state.dragContext);
    if (resolution.playlistIndex < 0 || resolution.trackIndex < 0) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }

    const sourcePlaylist = nextLayout[resolution.playlistIndex];
    if (!Array.isArray(sourcePlaylist)) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }

    let insertIndex = resolveDropInsertIndex(targetBody, targetZoneIndex, nextLayout);
    const [removedFile] = sourcePlaylist.splice(resolution.trackIndex, 1);
    const movedFile = typeof removedFile === 'string' && removedFile ? removedFile : resolution.file;
    if (typeof movedFile !== 'string' || !movedFile) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }

    if (resolution.playlistIndex === targetZoneIndex && resolution.trackIndex < insertIndex) {
      insertIndex -= 1;
    }

    insertIndex = Math.max(0, Math.min(insertIndex, nextLayout[targetZoneIndex].length));
    nextLayout[targetZoneIndex].splice(insertIndex, 0, movedFile);
    relocatedTrackContext = {
      file: movedFile,
      playlistIndex: targetZoneIndex,
      playlistPosition: insertIndex,
    };
  }

  hideTrashDropzone();
  clearDragModeBadge();
  clearDragPreviewCard();
  state.layout = ensurePlaylists(nextLayout);
  state.playlistNames = normalizePlaylistNames(previousNames, state.layout.length);
  state.playlistMeta = normalizePlaylistMeta(previousMeta, state.layout.length);
  state.dapConfig = normalizeDapConfig(previousDap, state.layout.length, previousDap);
  state.playlistAutoplay = normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
  renderZones();
  restorePlaylistBodyScrollTops(preservedScrollTops);
  const undoActionId = relocatedTrackContext
    ? registerTrackRelocationUndoAction(relocatedTrackContext, undoSnapshot)
    : null;
  try {
    await pushSharedLayout();
    setStatus(isCopyDrop ? 'Трек продублирован и синхронизирован.' : 'Плей-листы обновлены и синхронизированы.');
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = normalizePlaylistNames(previousNames, state.layout.length);
    state.playlistMeta = normalizePlaylistMeta(previousMeta, state.layout.length);
    state.dapConfig = normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    renderZones();
    restorePlaylistBodyScrollTops(preservedScrollTops);
    if (undoActionId) {
      clearTrackRelocationUndoAction(undoActionId);
    } else if (relocatedTrackContext) {
      clearTrackRelocationHighlight(relocatedTrackContext);
    }
    setStatus(isCopyDrop ? 'Не удалось синхронизировать копирование трека.' : 'Не удалось синхронизировать плей-листы.');
  }
}

async function fetchFileList(url, { logErrors = true } = {}) {
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

function buildAudioCatalogSignature(files, folders) {
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

function setPlaylistControlsLoading(isLoading) {
  if (refreshPlaylistsBtn) {
    refreshPlaylistsBtn.disabled = isLoading;
    refreshPlaylistsBtn.dataset.loading = isLoading ? 'true' : 'false';
    refreshPlaylistsBtn.textContent = isLoading ? 'Обновление...' : 'Обновить';
  }
  if (addPlaylistBtn) {
    addPlaylistBtn.disabled = isLoading;
  }
  if (resetPlaylistsBtn) {
    resetPlaylistsBtn.disabled = isLoading;
  }
}

function getTrackReloadStatusMessage(reason, fileCount) {
  if (reason === 'manual') {
    return `Список обновлен: ${fileCount} треков.`;
  }
  if (reason === 'auto') {
    return `Обнаружены изменения в /audio. Треков: ${fileCount}.`;
  }
  return `Найдено файлов: ${fileCount}`;
}

async function loadTracks({ reason = 'manual', audioResult = null } = {}) {
  closeLayoutStream();
  const catalogResult = audioResult || (await fetchFileList('/api/audio'));
  resetTrackReferences();

  if (!catalogResult.ok) {
    renderEmpty();
    syncCurrentTrackState();
    setStatus('Ошибка загрузки списка файлов. Проверьте сервер.');
    return;
  }

  state.audioCatalogSignature = buildAudioCatalogSignature(catalogResult.files, catalogResult.folders);
  state.availableFiles = catalogResult.files;
  state.availableFolders = normalizeAudioFolderTemplates(catalogResult.folders, state.availableFiles);
  keepKnownDurationsForFiles(state.availableFiles);
  keepKnownTrackAttributesForFiles(state.availableFiles, '/audio');
  keepTrackTitleModesForFiles(state.availableFiles, '/audio');
  preloadTrackDurations(state.availableFiles);
  preloadTrackAttributesForConfiguredTracks(state.availableFiles, '/audio');

  if (!state.availableFiles.length) {
    renderEmpty();
    syncCurrentTrackState();
    setStatus('Файлы не найдены. Добавьте аудио в папку /audio и обновите страницу.');
    return;
  }

  try {
    await initializeLayoutState();
  } catch (err) {
    console.error(err);
    const fallback = ensureFolderPlaylistsCoverage([state.availableFiles.filter((file) => !file.includes('/'))], [], []);
    state.layout = normalizeLayoutForFiles(fallback.layout, state.availableFiles);
    state.playlistNames = normalizePlaylistNames(fallback.playlistNames, state.layout.length);
    state.playlistMeta = normalizePlaylistMeta(fallback.playlistMeta, state.layout.length);
    state.dapConfig = normalizeDapConfig(DEFAULT_DAP_CONFIG, state.layout.length, DEFAULT_DAP_CONFIG);
    state.playlistAutoplay = normalizePlaylistAutoplayWithDap([], state.dapConfig, state.layout.length);
    state.playlistDsp = normalizePlaylistDspFlags([], state.playlistAutoplay, state.layout.length);
    setStatus('Не удалось загрузить состояние плей-листов, используется локальная раскладка.');
  }

  try {
    await initializePlaybackState();
  } catch (err) {
    console.error(err);
    state.hostPlaybackState = getDefaultHostPlaybackState();
    setLivePlaybackVolume(state.hostPlaybackState.volume, { sync: false, announce: false });
  }

  renderZones();
  syncCurrentTrackState();
  setStatus(getTrackReloadStatusMessage(reason, state.availableFiles.length));
  ensureDapNoSilencePlayback({ reason: 'tracks-loaded' }).catch(() => {});
  connectLayoutStream();
}

function requestTracksReload({ reason = 'manual', audioResult = null } = {}) {
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

async function pollAudioCatalogChanges() {
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

function startAudioCatalogAutoRefresh() {
  stopAudioCatalogAutoRefresh();
  state.audioCatalogPollTimer = setInterval(() => {
    pollAudioCatalogChanges();
  }, AUDIO_CATALOG_POLL_INTERVAL_MS);
}

function stopAudioCatalogAutoRefresh() {
  if (state.audioCatalogPollTimer !== null) {
    clearInterval(state.audioCatalogPollTimer);
    state.audioCatalogPollTimer = null;
  }
}

function initPlaylistControls() {
  if (addPlaylistBtn) {
    addPlaylistBtn.addEventListener('click', addPlaylist);
  }

  if (refreshPlaylistsBtn) {
    refreshPlaylistsBtn.addEventListener('click', () => {
      setStatus('Обновляем список файлов и плей-листов...');
      requestTracksReload({ reason: 'manual' });
    });
  }

  if (resetPlaylistsBtn) {
    resetPlaylistsBtn.addEventListener('click', resetPlaylists);
  }

  setPlaylistControlsLoading(false);
}

function initZonesPanControls() {
  if (!zonesContainer) return;
  zonesContainer.addEventListener('pointerdown', onZonesPanPointerDown);
  zonesContainer.addEventListener('wheel', onZonesWheel, { passive: false });
  zonesContainer.addEventListener('touchstart', onZonesTouchStart, { passive: false });
  zonesContainer.addEventListener('touchmove', onZonesTouchMove, { passive: false });
  zonesContainer.addEventListener('touchend', onZonesTouchEnd, { passive: false });
  zonesContainer.addEventListener('touchcancel', onZonesTouchCancel, { passive: false });
}

async function bootstrap() {
  applyRuntimeConfigFromSources(null);

  const authorized = await ensureAuthorizedUser();
  if (!authorized) return;

  try {
    const serverRuntimeConfig = await fetchRuntimeConfig();
    applyRuntimeConfigFromSources(serverRuntimeConfig);
  } catch (err) {
    console.error('Не удалось загрузить runtime-конфиг, используем локальные значения.', err);
    applyRuntimeConfigFromSources(null);
  }

  initSettings();
  initSidebarToggle();
  initServerControls();
  initDapSettingsControls();
  initDspSetupPanel();
  initPlaylistControls();
  initTouchFullscreenToggle();
  initNowPlayingControls();
  initZonesPanControls();
  startDapNoSilenceGuard();
  initUpdater();
  startAudioCatalogAutoRefresh();
  window.addEventListener('beforeunload', () => {
    if (touchFullscreenToggleBtn) {
      touchFullscreenToggleBtn.removeEventListener('click', toggleTouchFullscreenMode);
    }
    document.removeEventListener('fullscreenchange', updateTouchFullscreenToggleState);
    document.removeEventListener('webkitfullscreenchange', updateTouchFullscreenToggleState);
    stopAudioCatalogAutoRefresh();
    closeLayoutStream();
    stopHostProgressLoop();
    stopCoHostProgressLoop();
    clearQueuedCoHostSeekCommands();
    stopDapNoSilenceGuard();
    cleanupNowPlayingSeekInteraction();
    stopZonesPanMomentum();
    stopZonesWheelSmoothScroll();
    cleanupZonesPanInteraction();
    cleanupZonesTouchPanInteraction();
    onZonesFreeAreaTapCancel();
    clearPlaylistCollapseHold();
    hideCollapsedPlaylistsOverlay();
    removeCollapsedPlaylistsHint();
    clearTouchCopyHold();
    if (state.touchCopyDragActive) {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
  });
  requestTracksReload({ reason: 'initial' });
  loadVersion();
  document.addEventListener('dragover', handleGlobalDragOver);
}

setAudioDeps({
  overlayEnabledToggle,
  stopFadeEnabledToggle,
  overlayTimeInput,
  stopFadeInput,
  overlayCurveSelect,
  easing,
  setStatus,
  setButtonPlaying,
  setTrackPaused,
  setTrackPausedByContext,
  stopProgressLoop,
  startProgressLoop,
  resetProgress,
  bindProgress,
  syncNowPlayingPanel,
  requestHostPlaybackSync,
  updateVolumePresetsUi,
  trackLiveAudioInstance,
  stopUnexpectedLiveAudios,
  resolveAutoplayNextTrack,
  resolveReadyDspSliceWindowSeconds,
  tryAutoplayNextTrack,
  resetLiveDspNextTrackPreview,
  ensureDapNoSilencePlayback,
  isDapPauseLocked,
  normalizeAudioStartOffsetSeconds,
  seekAudioToOffset,
  isDspTransitionPlaybackActive,
  stopDspTransitionPlayback,
  requestCoHostPlayTrack,
  captureDapInterruptedPlaybackSnapshot,
  clearDapInterruptedPlaybackSnapshot,
  armDapNoSilenceByPlaylistIndex,
  isDapNoSilenceActive,
  isDapTrackContext,
  isDapEnabled,
  normalizeDapVolumePercent,
  triggerLiveDspTransitionForTrack,
});

setStatusDeps({
  statusEl,
  isTouchPlaylistCollapseEnabled,
  getCollapsedPlaylistIndicesInRenderOrder,
  sanitizePlaylistName,
  restoreCollapsedPlaylistForLocalView,
});

setSettingsDeps({
  overlayTimeInput, overlayCurveSelect, stopFadeInput,
  overlayEnabledToggle, stopFadeEnabledToggle,
  sidebar, sidebarToggle,
  loadSetting, saveSetting, loadBooleanSetting,
  loadTrackTitleModesByTrackSetting,
});

setAuthDeps({
  authOverlay, authError, authForm, authUsernameInput, authPasswordInput, authSubmit,
  cohostUsersEl,
  serverPanelEl, clientSessionPanelEl, cohostPanelEl,
  stopServerBtn, clientLogoutBtn, serverActionsHintEl,
  setStatus,
  applyRuntimeConfigFromSources,
  stopCoHostProgressLoop, clearQueuedCoHostSeekCommands,
  stopAndClearLocalPlayback,
  isDspTransitionPlaybackActive, stopDspTransitionPlayback,
  resetLiveDspNextTrackPreview,
  stopHostProgressLoop, requestHostPlaybackSync,
  syncNowPlayingPanel, syncHostNowPlayingPanel,
  updateVolumePresetsUi, updateLiveSeekUi, updateDapSettingsUi,
  updatePrereleaseSettingUi, updateDspSetupUi, refreshDspStatus,
  renderZones,
  closeLayoutStream, connectLayoutStream,
  stopServer,
});

setDspDeps({
  dspSetupPanelEl, dspInstallCommandEl, dspCopyInstallCommandBtn,
  dspCheckInstallBtn, dspSetupStatusEl,
  setStatus,
  copyTextToClipboard,
  clearLiveDspNextTrackHighlight, clearDspTransitionTrackHighlight,
  isDspTransitionPlaybackActive, getTrackCardByContext,
});

setUpdaterDeps({
  appVersionEl, updateInfoEl, updateMessageEl, updateButton, updateStatusEl,
  allowPrereleaseInput, allowPrereleaseRow,
  loadBooleanSetting, saveSetting,
  stopServer,
});

setNowPlayingDeps({
  nowPlayingTitleEl, nowPlayingControlBtn, nowPlayingControlLabelEl,
  nowPlayingProgressEl, nowPlayingTimeEl, nowPlayingReelEl,
  hostNowPlayingTitleEl, hostNowPlayingControlLabelEl,
  hostNowPlayingProgressEl, hostNowPlayingTimeEl, hostNowPlayingReelEl,
  dapNowPlayingTitleEl, dapNowPlayingControlLabelEl,
  dapNowPlayingProgressEl, dapNowPlayingTimeEl, dapNowPlayingReelEl,
  liveSeekToggleRow, liveSeekEnabledToggle,
  setNowPlayingProgress, setNowPlayingReelActive, setNowPlayingTime,
  setHostNowPlayingProgress, setHostNowPlayingReelActive, setHostNowPlayingTime,
  setDapNowPlayingProgress, setDapNowPlayingReelActive, setDapNowPlayingTime,
  setDspTransitionReelReverse,
  getProgressUiFrameIntervalMs,
  buildHostTrackHighlightDescriptor, clearHostTrackHighlight,
  normalizePlaylistTrackIndex, getTrackCardByContext,
  trackDisplayName,
  getHostPlaybackElapsedSeconds, getDapPlaybackElapsedSeconds,
  getCurrentTrackRemainingSeconds, getCurrentTrackDurationSeconds,
  getHostPlaybackDurationSeconds, getDspTransitionDurationSeconds,
  refreshTrackDurationLabels,
  buildDapPlaybackSnapshotForSync, sanitizeIncomingDapPlaybackState,
  isDapTrackContext, isDapPauseLocked, isDspTransitionPlaybackActive,
  updateVolumePresetsUi,
  requestHostPlaybackSync, requestHostLiveSeekSync,
  queueCoHostSeekCurrentPlayback, clearQueuedCoHostSeekCommands,
  seekDspTransitionPlaybackByRatio, updateProgress,
  toggleNowPlayingPlayback,
  initVolumePresetControls,
  setStatus,
  saveSetting, loadBooleanSetting,
});

setDapDeps({
  dapSettingsPanelEl, dapEnabledToggle, dapPlaylistSelect, dapVolumePercentInput,
  ensurePlaylists, normalizeDapConfig, normalizePlaylistTrackIndex,
  isDapPlaylistIndex, getPlaylistDisplayLabel,
  normalizeDapVolumePercent, syncDapConfig,
  ensureDapNoSilencePlayback,
  setStatus,
});

setVolumeDeps({
  localVolumePresetsEl,
  showVolumePresetsToggle, showVolumePresetsToggleRow,
  setStatus,
  getLocalVolumePresetButtons: () => localVolumePresetButtons,
  setLocalVolumePresetButtons: (v) => { localVolumePresetButtons = v; },
  getEffectiveLiveVolume,
  requestCoHostSetLiveVolume, requestCoHostSetVolumePresetsVisibility,
  requestHostPlaybackSync,
  saveSetting, loadBooleanSetting,
});

bootstrap();
