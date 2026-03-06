import { state, CLIENT_ID_STORAGE_KEY } from './modules/state.js';
import { closeLayoutStream } from './modules/sse.js';
import { setRoleDeps } from './modules/roles.js';
import { applyRuntimeConfigFromSources,
  fetchRuntimeConfig, setConfigDeps
} from './modules/config.js';
import { setAudioDeps, getEffectiveLiveVolume, seekCurrentPlaybackToSeconds } from './modules/audio.js';
import { setStatusDeps,
  setStatus, hideCollapsedPlaylistsOverlay, removeCollapsedPlaylistsHint
} from './modules/ui/status.js';
import { setSettingsDeps, initSettings, initSidebarToggle } from './modules/ui/settings.js';
import { setAuthDeps,
  ensureAuthorizedUser, stopServer, initServerControls
} from './modules/ui/auth.js';
import { setDspDeps,
  updateDspSetupUi, refreshDspStatus, initDspSetupPanel
} from './modules/ui/dsp.js';
import { setUpdaterDeps,
  updatePrereleaseSettingUi, loadVersion, initUpdater
} from './modules/ui/updater.js';
import { setNowPlayingDeps,
  syncHostNowPlayingPanel, syncNowPlayingPanel, updateLiveSeekUi, stopHostProgressLoop,
  stopCoHostProgressLoop, cleanupNowPlayingSeekInteraction, initNowPlayingControls
} from './modules/ui/nowplaying.js';
import { setDapDeps,
  updateDapSettingsUi, isDapEnabled, isDapTrackContext, startDapNoSilenceGuard,
  stopDapNoSilenceGuard, initDapSettingsControls
} from './modules/ui/dap.js';
import { setVolumeDeps,
  rebuildVolumePresetButtons, updateVolumePresetsUi, initVolumePresetControls
} from './modules/ui/volume.js';
import { setDndDeps,
  applyDragModeBadge, applyDragPreview, attachDragHandlers, buildTrackOccurrenceMap, clearDesktopDragGhost,
  clearDragModeBadge, clearDragPreviewCard, handleDragDeleteFromContext, handleDragQueueNextFromContext,
  handleDrop, handleGlobalDragOver, hideTrashDropzone, isDesktopDragHoldReadyForPointer,
  isPointOverQueueNextDropzone, isPointOverTrashDropzone, resolveEffectiveDragMode,
  setDropEffectFromEvent, showTrashDropzone, syncQueueNextDropzoneVisibility
} from './modules/dnd.js';
import { setTouchDeps,
  cleanupTouchCopyDrag, cleanupZonesPanInteraction, cleanupZonesTouchPanInteraction,
  clearPlaylistCollapseHold, clearPlaylistReorderHold, clearTouchCopyHold, getCollapsedPlaylistIndicesInRenderOrder,
  initTouchFullscreenToggle, initZonesPanControls, isLikelyTouchNativeDragEvent, isPlaylistCollapsedForLocalView,
  isTouchPlaylistCollapseEnabled, isTouchPointerEvent, onZonesFreeAreaTapCancel, pruneCollapsedPlaylistIndices,
  restoreCollapsedPlaylistForLocalView, startPlaylistCollapseHold, startPlaylistReorderHold, startTouchCopyHold,
  stopZonesPanMomentum, stopZonesWheelSmoothScroll, toggleTouchFullscreenMode, updateTouchFullscreenToggleState
} from './modules/touch.js';
import { setDspLiveDeps,
  clearLiveDspContinuationWarmups, resolveReadyDspSliceWindowSeconds, triggerLiveDspTransitionForTrack, tryAutoplayNextTrack
} from './modules/dsp-live.js';
import { setPlaybackSyncDeps,
  buildDapPlaybackSnapshotForSync, buildHostTrackHighlightDescriptor, buildLiveDspNextTrackDescriptor,
  cacheTrackDuration, clearDspTransitionTrackHighlight, clearHostTrackHighlight, clearLiveDspNextTrackHighlight,
  clearQueuedCoHostSeekCommands, connectLayoutStream, getCurrentTrackDurationSeconds,
  getCurrentTrackRemainingSeconds, getDapPlaybackElapsedSeconds, getDefaultHostPlaybackState,
  getDspTransitionDurationSeconds, getHostPlaybackDurationSeconds, getHostPlaybackElapsedSeconds,
  getKnownDurationSeconds, getPlaylistDurationText, getProgressUiFrameIntervalMs, getVisibleDapInterruptedPlaybackDisplayState,
  initializeLayoutState, initializePlaybackState, isDspTransitionPlaybackActive, isTrackPlaybackContextEqual,
  keepKnownDurationsForFiles, normalizePlaylistTrackIndex, normalizeTrackPlaybackContext, preloadTrackDurations,
  pushSharedLayout, queueCoHostSeekCurrentPlayback, reconcileDapInterruptedSnapshotWithLayout,
  reconcileTrackContextWithLayout, refreshTrackDurationLabels, requestCoHostPlayTrack,
  requestHostLiveSeekSync, requestHostPlaybackSync,
  requestHostPlayTrack, requestHostSeekCurrentPlayback, requestHostSetLiveVolume, requestTrackPlaybackForCurrentRole, resetLiveDspNextTrackPreview,
  resetTrackReferences, sanitizeIncomingDapPlaybackState, seekDspTransitionPlaybackByRatio, setDapNowPlayingProgress,
  setDapNowPlayingReelActive, setDapNowPlayingTime, setDspTransitionReelReverse, setHostNowPlayingProgress,
  setHostNowPlayingReelActive, setHostNowPlayingTime, setNowPlayingProgress, setNowPlayingReelActive, setNowPlayingTime,
  stopAndClearLocalPlayback, stopDspTransitionPlayback, toggleNowPlayingPlayback, requestPlayNextOnHost,
  getTrackDurationTextByKey
} from './modules/playback-sync.js';
import { setPlaylistsDeps,
  armDapNoSilenceByPlaylistIndex, bindProgress, buildPlaylistRenderOrder, captureDapInterruptedPlaybackSnapshot,
  clearDapInterruptedPlaybackSnapshot, clearTrackRelocationHighlight, clearTrackRelocationUndoAction,
  cloneLayoutState, clonePlaylistMetaState, copyTextToClipboard, createTrackRelocationUndoSnapshot, dapConfigEqual,
  defaultPlaylistMeta, disarmDapNoSilence, ensureDapNoSilencePlayback, ensureFolderPlaylistsCoverage, ensurePlaylists,
  getDapPlaylistIndex, getDuration, getPlaylistDisplayLabel, getTrackButton, getTrackCardByContext, initPlaylistControls,
  isDapNoSilenceActive, isDapPauseLocked, isDapPlaylistIndex, isFolderPlaylistIndex, isServerLayoutEmpty,
  isTrackCardDragBlocked, layoutsEqual, loadTrackTitleModesByTrackSetting, normalizeAudioStartOffsetSeconds,
  normalizeDapConfig, normalizeDapVolumePercent, normalizeLayoutForFiles, normalizePlaylistAutoplayWithDap,
  normalizePlaylistDspFlags, normalizePlaylistMeta, normalizePlaylistNames, normalizeTrackTitleModesByTrackForFiles,
  playlistAutoplayEqual, playlistDspEqual, playlistMetaEqual, playlistNamesEqual,
  registerTrackRelocationUndoAction, renderZones, requestTracksReload, resetProgress, resolveAutoplayNextTrack,
  resolveDapInterruptedPlaybackTrack, sanitizePlaylistName, saveTrackTitleModesByTrackSetting, seekAudioToOffset,
  serializeTrackTitleModesByTrack, setButtonPlaying, setTrackPaused, setTrackPausedByContext, startAudioCatalogAutoRefresh,
  startProgressLoop, stopAudioCatalogAutoRefresh, stopProgressLoop, stopUnexpectedLiveAudios, syncDapConfig,
  syncDapInterruptedTrackState, syncPlaylistHeaderActiveState, trackDisplayName, trackLiveAudioInstance,
  trackTitleModesByTrackEqual, updateProgress
} from './modules/playlists.js';
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

function waitMs(ms) {
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

async function bootstrap() {
  state.hostPlaybackSyncReady = false;
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
  state.hostPlaybackSyncReady = true;
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
  normalizePlaylistTrackIndex, normalizeTrackPlaybackContext, getTrackCardByContext,
  trackDisplayName,
  getHostPlaybackElapsedSeconds, getDapPlaybackElapsedSeconds,
  getCurrentTrackRemainingSeconds, getCurrentTrackDurationSeconds,
  getHostPlaybackDurationSeconds, getDspTransitionDurationSeconds,
  refreshTrackDurationLabels,
  buildDapPlaybackSnapshotForSync, sanitizeIncomingDapPlaybackState,
  isDapTrackContext, isDapPauseLocked, isDspTransitionPlaybackActive,
  updateVolumePresetsUi,
  requestHostPlaybackSync, requestHostLiveSeekSync, requestHostSeekCurrentPlayback,
  queueCoHostSeekCurrentPlayback, clearQueuedCoHostSeekCommands,
  seekDspTransitionPlaybackByRatio, seekCurrentPlaybackToSeconds, updateProgress,
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
  requestHostSetLiveVolume,
  requestHostPlaybackSync,
  saveSetting, loadBooleanSetting,
});

// ── New module cross-dependency wiring ──────────────────────────────
setDndDeps({
  cleanupZonesPanInteraction,
  clearTrackRelocationHighlight,
  clearTrackRelocationUndoAction,
  cloneLayoutState,
  clonePlaylistMetaState,
  createTrackRelocationUndoSnapshot,
  ensurePlaylists,
  isFolderPlaylistIndex,
  isLikelyTouchNativeDragEvent,
  isTouchPointerEvent,
  isTrackCardDragBlocked,
  normalizeDapConfig,
  normalizePlaylistAutoplayWithDap,
  normalizePlaylistDspFlags,
  normalizePlaylistMeta,
  normalizePlaylistNames,
  normalizePlaylistTrackIndex,
  normalizeTrackPlaybackContext,
  pushSharedLayout,
  requestPlayNextOnHost,
  registerTrackRelocationUndoAction,
  renderZones,
  startTouchCopyHold,
  zonesContainer,
  stopZonesPanMomentum,
});

setTouchDeps({
  applyDragModeBadge,
  applyDragPreview,
  buildPlaylistRenderOrder,
  clearDesktopDragGhost,
  clearDragModeBadge,
  clearDragPreviewCard,
  cloneLayoutState,
  clonePlaylistMetaState,
  ensurePlaylists,
  getDapPlaylistIndex,
  handleDragDeleteFromContext,
  handleDragQueueNextFromContext,
  handleDrop,
  hideTrashDropzone,
  isDesktopDragHoldReadyForPointer,
  isFolderPlaylistIndex,
  isPointOverQueueNextDropzone,
  isPointOverTrashDropzone,
  isTrackCardDragBlocked,
  normalizeDapConfig,
  normalizePlaylistAutoplayWithDap,
  normalizePlaylistDspFlags,
  normalizePlaylistMeta,
  normalizePlaylistNames,
  normalizePlaylistTrackIndex,
  pushSharedLayout,
  reconcileDapInterruptedSnapshotWithLayout,
  reconcileTrackContextWithLayout,
  renderZones,
  requestHostPlaybackSync,
  resolveEffectiveDragMode,
  sanitizePlaylistName,
  showTrashDropzone,
  syncQueueNextDropzoneVisibility,
  touchFullscreenToggleBtn,
  zonesContainer,
});

setDspLiveDeps({
  buildLiveDspNextTrackDescriptor,
  getDuration,
  getKnownDurationSeconds,
  getTrackButton,
  isDspTransitionPlaybackActive,
  normalizePlaylistTrackIndex,
  requestHostPlayTrack,
  requestHostPlaybackSync,
  resolveAutoplayNextTrack,
  seekAudioToOffset,
  setButtonPlaying,
  setTrackPaused,
  startProgressLoop,
  stopDspTransitionPlayback,
  stopProgressLoop,
  stopUnexpectedLiveAudios,
  trackLiveAudioInstance,
});

setPlaybackSyncDeps({
  clientId,
  cleanupTouchCopyDrag,
  clearDapInterruptedPlaybackSnapshot,
  clearDesktopDragGhost,
  clearDragModeBadge,
  clearDragPreviewCard,
  clearLiveDspContinuationWarmups,
  clearPlaylistReorderHold,
  clearTouchCopyHold,
  dapConfigEqual,
  defaultPlaylistMeta,
  disarmDapNoSilence,
  ensureDapNoSilencePlayback,
  ensureFolderPlaylistsCoverage,
  ensurePlaylists,
  getDapPlaylistIndex,
  getDuration,
  getTrackButton,
  hideTrashDropzone,
  isServerLayoutEmpty,
  layoutsEqual,
  normalizeDapConfig,
  normalizeLayoutForFiles,
  normalizePlaylistAutoplayWithDap,
  normalizePlaylistDspFlags,
  normalizePlaylistMeta,
  normalizePlaylistNames,
  normalizeTrackTitleModesByTrackForFiles,
  playlistAutoplayEqual,
  playlistDspEqual,
  playlistMetaEqual,
  playlistNamesEqual,
  nowPlayingControlBtn,
  nowPlayingProgressEl,
  nowPlayingReelEl,
  nowPlayingTimeEl,
  hostNowPlayingControlEl,
  hostNowPlayingProgressEl,
  hostNowPlayingReelEl,
  hostNowPlayingTimeEl,
  dapNowPlayingControlEl,
  dapNowPlayingProgressEl,
  dapNowPlayingReelEl,
  dapNowPlayingTimeEl,
  renderZones,
  resetProgress,
  resolveDapInterruptedPlaybackTrack,
  saveTrackTitleModesByTrackSetting,
  serializeTrackTitleModesByTrack,
  setButtonPlaying,
  setTrackPaused,
  startProgressLoop,
  stopProgressLoop,
  stopUnexpectedLiveAudios,
  syncDapInterruptedTrackState,
  syncPlaylistHeaderActiveState,
  trackTitleModesByTrackEqual,
  updateProgress,
});

setPlaylistsDeps({
  addPlaylistBtn,
  applyDragPreview,
  attachDragHandlers,
  buildDapPlaybackSnapshotForSync,
  buildTrackOccurrenceMap,
  cacheTrackDuration,
  connectLayoutStream,
  getCurrentTrackRemainingSeconds,
  getDefaultHostPlaybackState,
  getPlaylistDurationText,
  getProgressUiFrameIntervalMs,
  getTrackDurationTextByKey,
  getVisibleDapInterruptedPlaybackDisplayState,
  handleDrop,
  initializeLayoutState,
  initializePlaybackState,
  isDspTransitionPlaybackActive,
  isPlaylistCollapsedForLocalView,
  isTouchPlaylistCollapseEnabled,
  isTrackPlaybackContextEqual,
  keepKnownDurationsForFiles,
  normalizePlaylistTrackIndex,
  normalizeTrackPlaybackContext,
  preloadTrackDurations,
  pruneCollapsedPlaylistIndices,
  pushSharedLayout,
  refreshPlaylistsBtn,
  reconcileDapInterruptedSnapshotWithLayout,
  reconcileTrackContextWithLayout,
  refreshTrackDurationLabels,
  requestTrackPlaybackForCurrentRole,
  requestHostPlayTrack,
  requestHostPlaybackSync,
  resetTrackReferences,
  sanitizeIncomingDapPlaybackState,
  setDropEffectFromEvent,
  setNowPlayingProgress,
  setNowPlayingTime,
  saveSetting,
  startPlaylistCollapseHold,
  startPlaylistReorderHold,
  stopAndClearLocalPlayback,
  loadSetting,
  resetPlaylistsBtn,
  zonesContainer,
});

setConfigDeps({ normalizeDapVolumePercent, isDapEnabled, isDapTrackContext, rebuildVolumePresetButtons });
setRoleDeps({ isDapEnabled });

bootstrap();
