// public/modules/state.js — shared mutable state and immutable constants

export const SETTINGS_KEYS = {
  overlayTime: 'player:overlayTime',
  overlayCurve: 'player:overlayCurve',
  stopFade: 'player:stopFade',
  overlayEnabled: 'player:overlayEnabled',
  stopFadeEnabled: 'player:stopFadeEnabled',
  sidebarOpen: 'player:sidebarOpen',
  allowPrerelease: 'player:allowPrerelease',
  showVolumePresets: 'player:showVolumePresets',
  liveSeekEnabled: 'player:liveSeekEnabled',
  trackTitleModesByTrack: 'player:trackTitleModesByTrack',
};
export const LAYOUT_STORAGE_KEY = 'player:playlists';
export const CLIENT_ID_STORAGE_KEY = 'djtron:clientId';
export const RUNTIME_LOCAL_OVERRIDE_KEYS = {
  allowContextMenu: ['djtron:config:allowContextMenu', 'djtron:allowContextMenu'],
  volumePresets: ['djtron:config:volumePresets', 'djtron:volumePresets'],
};
export const RUNTIME_OVERRIDE_SCOPE_NONE = 'none';
export const RUNTIME_OVERRIDE_SCOPE_CLIENT = 'client';
export const RUNTIME_OVERRIDE_SCOPE_HOST = 'host';
export const DEFAULT_RUNTIME_CONFIG_SCHEMA = Object.freeze({
  port: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
  allowContextMenu: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_CLIENT }),
  volumePresets: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_HOST }),
  dspEntryCompensationMs: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
  dspExitCompensationMs: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
});
export const LAYOUT_STREAM_RETRY_MS = 1500;
export const PLAYLIST_NAME_MAX_LENGTH = 80;
export const HOST_PLAYBACK_SYNC_INTERVAL_MS = 900;
export const AUDIO_CATALOG_POLL_INTERVAL_MS = 4000;
export const DAP_NO_SILENCE_GUARD_INTERVAL_MS = 320;
export const QUEUE_NEXT_CHAIN_WINDOW_MS = 10000;
export const TRACK_RELOCATE_HIGHLIGHT_MS = 3000;
export const TOUCH_COPY_HOLD_MS = 360;
export const PLAYLIST_COLLAPSE_HOLD_MS = 480;
export const PLAYLIST_COLLAPSE_POINTER_MOVE_TOLERANCE_PX = 24;
export const PLAYLIST_REORDER_HOLD_MS = 420;
export const PLAYLIST_REORDER_POINTER_MOVE_TOLERANCE_PX = 20;
export const TOUCH_DRAG_ACTIVATION_DELAY_MS = 220;
export const TOUCH_DRAG_START_MOVE_PX = 12;
export const TOUCH_DRAG_COMMIT_PX = 6;
export const TOUCH_NATIVE_DRAG_BLOCK_WINDOW_MS = 900;
export const DESKTOP_TRACK_DRAG_HOLD_MS = 400;
export const DESKTOP_TRACK_DRAG_CANCEL_MOVE_PX = 8;
export const TOUCH_DRAG_EDGE_SCROLL_THRESHOLD_PX = 54;
export const TOUCH_DRAG_EDGE_SCROLL_MIN_SPEED_PX_PER_FRAME = 0.8;
export const TOUCH_DRAG_EDGE_SCROLL_MAX_SPEED_PX_PER_FRAME = 7;
export const COLLAPSED_PLAYLIST_TAP_MAX_DURATION_MS = 260;
export const COLLAPSED_PLAYLIST_TAP_MOVE_TOLERANCE_PX = 16;
export const COLLAPSED_PLAYLIST_TRIPLE_TAP_WINDOW_MS = 520;
export const COLLAPSED_PLAYLIST_TRIPLE_TAP_DISTANCE_PX = 44;
export const COLLAPSED_PLAYLIST_HINT_DURATION_MS = 1400;
export const NOW_PLAYING_SEEK_DRAG_THRESHOLD_PX = 6;
export const NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS = 320;
export const NOW_PLAYING_TOGGLE_ZONE_HALF_WIDTH_PX = 32;
export const NOW_PLAYING_REEL_BASE_SPIN_SECONDS = 1.8;
export const NOW_PLAYING_REEL_FAST_SPIN_SECONDS = 0.24;
export const NOW_PLAYING_REEL_MAX_SCRUB_SPEED_PX_PER_SEC = 1600;
export const COHOST_SEEK_COMMAND_INTERVAL_MS = 40;
export const HOST_LIVE_SEEK_SYNC_INTERVAL_MS = 40;
export const ZONES_PAN_DRAG_THRESHOLD_PX = 4;
export const ZONES_PAN_TOUCH_GAIN = 2.4;
export const ZONES_TWO_FINGER_PAN_TOUCH_GAIN = 2.0;
export const ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS = 0.16;
export const ZONES_PAN_TOUCH_MOMENTUM_STOP_SPEED_PX_PER_MS = 0.02;
export const ZONES_PAN_TOUCH_MOMENTUM_DECAY_PER_FRAME = 0.92;
export const ZONES_WHEEL_SMOOTH_EASE = 0.24;
export const ZONES_WHEEL_SMOOTH_MIN_DELTA_PX = 0.45;
export const PLAYLIST_VIRTUALIZATION_MIN_ITEMS = 120;
export const PLAYLIST_VIRTUALIZATION_ROW_HEIGHT_PX = 45;
export const PLAYLIST_VIRTUALIZATION_OVERSCAN_ROWS = 8;
export const PLAYLIST_VIRTUALIZATION_FALLBACK_VIEWPORT_PX = 420;
export const MOBILE_PROGRESS_UI_MAX_FPS = 30;
export const MOBILE_PROGRESS_UI_MIN_INTERVAL_MS = Math.round(1000 / MOBILE_PROGRESS_UI_MAX_FPS);
export const TRACK_TITLE_MODE_FILE = 'file';
export const TRACK_TITLE_MODE_ATTRIBUTES = 'attributes';
export const PLAYLIST_TYPE_MANUAL = 'manual';
export const PLAYLIST_TYPE_FOLDER = 'folder';
export const ROLE_HOST = 'host';
export const ROLE_SLAVE = 'slave';
export const ROLE_COHOST = 'co-host';
export const DAP_DEFAULT_VOLUME_PERCENT = 5;
export const DAP_MIN_VOLUME_PERCENT = 0;
export const DAP_MAX_VOLUME_PERCENT = 100;
export const DEFAULT_DAP_CONFIG = Object.freeze({
  enabled: false,
  playlistIndex: null,
  playlistId: null,
  volumePercent: DAP_DEFAULT_VOLUME_PERCENT,
});
export const PLAYBACK_COMMAND_PLAY_TRACK = 'play-track';
export const PLAYBACK_COMMAND_TOGGLE_CURRENT = 'toggle-current';
export const PLAYBACK_COMMAND_SET_VOLUME = 'set-volume';
export const PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE = 'set-volume-presets-visible';
export const PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED = 'set-live-seek-enabled';
export const PLAYBACK_COMMAND_SEEK_CURRENT = 'seek-current';
export const DEFAULT_LIVE_VOLUME_PRESET_VALUES = Object.freeze([0.1, 0.3, 0.5]);
export const DEFAULT_DSP_WINGET_COMMAND = 'winget install "FFmpeg (Essentials Build)"';
export const LIVE_DSP_POLL_INTERVAL_MS = 1100;
export const LIVE_DSP_POLL_TIMEOUT_MS = 2 * 60 * 1000;
export const LIVE_DSP_RENDER_SOURCE = 'live-play-start';
export const LIVE_DSP_HANDOFF_LEAD_SECONDS = 0.055;
export const DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS = 22;
export const DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS = 19;
export const LIVE_DSP_WARMUP_TIMEOUT_MS = 12 * 1000;
export const LIVE_DSP_WARMUP_MAX_TRACKED = 64;
export const LIVE_DSP_CONTINUATION_WARMUP_MAX_TRACKED = 24;
export const DEFAULT_LIVE_VOLUME = 1;
export const AUTOPLAY_OVERLAY_TRIGGER_EPSILON_SECONDS = 0.04;
export const AUTOPLAY_OVERLAY_STATE_IDLE = 'idle';
export const AUTOPLAY_OVERLAY_STATE_PENDING = 'pending';
export const AUTOPLAY_OVERLAY_STATE_STARTED = 'started';
export const AUTOPLAY_OVERLAY_STATE_FAILED = 'failed';
export const HOST_SERVER_HINT = 'Если нужно завершить работу, нажмите кнопку ниже. Сервер остановится и страница перестанет отвечать.';
export const NOW_PLAYING_IDLE_TITLE = 'Ничего не играет';
export const HOST_NOW_PLAYING_IDLE_TITLE = 'Live: ничего не играет';
export const DAP_NOW_PLAYING_IDLE_TITLE = 'DAP: ничего не играет';

export const state = {
  zonesWheelTargets: new Map(),
  collapsedPlaylistIndices: new Set(),
  volumePresetButtonsSignature: '',
  LIVE_VOLUME_PRESET_VALUES: DEFAULT_LIVE_VOLUME_PRESET_VALUES.slice(),
  liveDspEntryCompensationSeconds: DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS / 1000,
  liveDspExitCompensationSeconds: DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS / 1000,
  currentAudio: null,
  currentTrack: null, // { file, basePath, key }
  fadeCancel: { cancelled: false },
  buttonsByFile: new Map(),
  cardsByFile: new Map(),
  durationLabelsByFile: new Map(),
  playlistDurationLabelsByIndex: new Map(),
  trackNameLabelsByFile: new Map(),
  knownTrackDurations: new Map(),
  durationLoadPromises: new Map(),
  trackAttributesByFile: new Map(),
  trackAttributeLoadPromisesByFile: new Map(),
  trackTitleModesByTrack: new Map(),
  activeDurationTrackKey: null,
  progressRaf: null,
  progressAudio: null,
  liveAudioInstances: new Set(),
  draggingCard: null,
  dragDropHandled: false,
  dragContext: null,
  layout: [[]], // array of playlists -> array of filenames
  playlistNames: ['Плей-лист 1'],
  playlistMeta: [{ type: PLAYLIST_TYPE_MANUAL }],
  playlistAutoplay: [false],
  playlistDsp: [false],
  playlists: [
    {
      id: 'p-0',
      name: 'Плей-лист 1',
      type: PLAYLIST_TYPE_MANUAL,
      tracks: [],
      settings: {
        autoPlayEnabled: false,
        dspEnabled: false,
      },
      uiState: null,
    },
  ],
  dapConfig: { ...DEFAULT_DAP_CONFIG },
  availableFiles: [],
  availableFolders: [],
  audioCatalogSignature: '',
  audioCatalogPollTimer: null,
  audioCatalogPollInFlight: false,
  tracksReloadInFlight: false,
  tracksReloadQueued: false,
  tracksReloadQueuedReason: 'auto',
  dapNoSilenceGuardTimer: null,
  dapAutoStartInFlight: false,
  autoplayStartInFlight: false,
  overlayHandoffInFlight: false,
  dapNoSilenceArmedPlaylistIndex: null,
  dapInterruptedPlaybackSnapshot: null,
  syncedDapInterruptedUiState: null,
  shutdownCountdownTimer: null,
  currentUser: null,
  currentRole: null,
  showVolumePresetsEnabled: false,
  liveSeekEnabled: false,
  livePlaybackVolume: DEFAULT_LIVE_VOLUME,
  layoutVersion: 0,
  layoutStream: null,
  layoutStreamReconnectTimer: null,
  hostPlaybackState: {
    trackFile: null,
    paused: false,
    currentTime: 0,
    duration: null,
    volume: DEFAULT_LIVE_VOLUME,
    showVolumePresets: false,
    allowLiveSeek: false,
    dapPlayback: {
      trackFile: null,
      paused: false,
      currentTime: 0,
      duration: null,
      playlistId: null,
      playlistIndex: null,
      playlistPosition: null,
      interrupted: false,
      updatedAt: 0,
    },
    playlistId: null,
    playlistIndex: null,
    playlistPosition: null,
    updatedAt: 0,
    sourceClientId: null,
  },
  hostPlaybackSyncInFlight: false,
  hostPlaybackSyncQueued: false,
  hostPlaybackSyncQueuedForce: false,
  lastHostPlaybackSyncAt: 0,
  lastHostLiveSeekSyncAt: 0,
  hostProgressRaf: null,
  cohostProgressRaf: null,
  hostHighlightedDescriptor: '',
  authUsersState: [],
  cohostRoleUpdatesInFlight: new Set(),
  cohostDisconnectUpdatesInFlight: new Set(),
  authRecoveryInProgress: false,
  runtimeAllowContextMenu: false,
  contextMenuGuardAttached: false,
  runtimeServerConfig: {
  port: null,
  allowContextMenu: false,
  volumePresets: DEFAULT_LIVE_VOLUME_PRESET_VALUES.slice(),
  dspEntryCompensationMs: DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS,
  dspExitCompensationMs: DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS,
  schema: {
    port: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
    allowContextMenu: { localOverride: RUNTIME_OVERRIDE_SCOPE_CLIENT },
    volumePresets: { localOverride: RUNTIME_OVERRIDE_SCOPE_HOST },
    dspEntryCompensationMs: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
    dspExitCompensationMs: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
  },
},
  dspStatusState: {
  enabled: null,
  ffmpegAvailable: null,
  ffmpegError: null,
  wingetCommand: DEFAULT_DSP_WINGET_COMMAND,
  checkedAt: 0,
},
  dspStatusRequestInFlight: false,
  liveDspRenderToken: 0,
  liveDspNextReadyDescriptor: '',
  liveDspNextReadySliceSeconds: null,
  dspTransitionPlayback: null,
  dspTransitionWarmupPromises: new Map(),
  liveDspContinuationWarmupPromises: new Map(),
  touchHoldTimer: null,
  touchHoldPointerId: null,
  touchHoldStartX: 0,
  touchHoldStartY: 0,
  touchHoldStartedAt: 0,
  touchHoldCard: null,
  desktopDragHoldTimer: null,
  desktopDragHoldPointerId: null,
  desktopDragHoldStartedAt: 0,
  desktopDragHoldStartX: 0,
  desktopDragHoldStartY: 0,
  desktopDragHoldCard: null,
  desktopDragHoldReady: false,
  touchCopyDragActive: false,
  touchCopyDragPointerId: null,
  touchCopyDragGhost: null,
  touchCopyDragStartX: 0,
  touchCopyDragStartY: 0,
  touchCopyDragMoved: false,
  touchCopyDragLastClientX: 0,
  touchCopyDragLastClientY: 0,
  touchCopyDragEdgeScrollRaf: null,
  touchCopyDragEdgeScrollVelocity: 0,
  touchDragMode: null,
  playlistCollapseHoldTimer: null,
  playlistCollapseHoldPointerId: null,
  playlistCollapseHoldStartX: 0,
  playlistCollapseHoldStartY: 0,
  playlistCollapseHoldPlaylistIndex: null,
  playlistCollapseHoldTarget: null,
  playlistCollapseHoldZone: null,
  playlistCollapseHoldTriggered: false,
  playlistReorderHoldTimer: null,
  playlistReorderHoldPointerId: null,
  playlistReorderHoldStartX: 0,
  playlistReorderHoldStartY: 0,
  playlistReorderHoldPlaylistIndex: null,
  playlistReorderHoldTarget: null,
  playlistReorderHoldSourceZone: null,
  playlistReorderHoldTargetZone: null,
  playlistReorderHoldTargetPlaylistIndex: null,
  playlistReorderHoldInitialVisibleOrder: null,
  playlistReorderHoldCandidateOrder: null,
  playlistReorderHoldCandidateCenters: null,
  playlistReorderHoldCurrentSlot: null,
  playlistReorderHoldPreviewSignature: '',
  playlistReorderHoldTriggered: false,
  lastTouchPointerDownAt: 0,
  dragPreviewCard: null,
  desktopDragGhost: null,
  desktopDragGhostOffsetX: 16,
  desktopDragGhostOffsetY: 16,
  emptyDragImage: null,
  trashDropzoneEl: null,
  queueNextDropzoneEl: null,
  queueNextChainAnchor: null,
  queueNextChainExpiresAt: 0,
  queueNextCountdownTimer: null,
  trackRelocationHighlights: new Map(),
  trackRelocationHighlightTimer: null,
  trackRelocationUndoActions: new Map(),
  trackRelocationUndoSeq: 0,
  nowPlayingSeekActive: false,
  nowPlayingSeekMoved: false,
  nowPlayingSeekPointerId: null,
  nowPlayingSeekStartX: 0,
  nowPlayingSeekSuppressClickUntil: 0,
  nowPlayingSeekLastX: 0,
  nowPlayingSeekLastAt: 0,
  nowPlayingSeekSmoothedSpeed: 0,
  cohostSeekCommandTimer: null,
  cohostSeekCommandInFlight: false,
  cohostSeekPendingRatio: null,
  cohostSeekPendingFinalize: false,
  cohostSeekLastSentAt: 0,
  zonesPanActive: false,
  zonesPanMoved: false,
  zonesPanPointerId: null,
  zonesPanStartX: 0,
  zonesPanStartY: 0,
  zonesPanStartScrollLeft: 0,
  zonesPanPreferHorizontal: false,
  zonesPanPointerType: '',
  zonesPanMoveGain: 1,
  zonesPanLastX: 0,
  zonesPanLastAt: 0,
  zonesPanVelocityX: 0,
  zonesPanMomentumRaf: null,
  zonesTouchPanActive: false,
  zonesTouchPanMoved: false,
  zonesTouchPanStartMidX: 0,
  zonesTouchPanStartMidY: 0,
  zonesTouchPanStartScrollLeft: 0,
  zonesTouchPanLastMidX: 0,
  zonesTouchPanLastAt: 0,
  zonesTouchPanVelocityX: 0,
  zonesFreeAreaTapCandidate: null,
  zonesFreeAreaTapCount: 0,
  zonesFreeAreaLastTapAt: 0,
  zonesFreeAreaLastTapX: 0,
  zonesFreeAreaLastTapY: 0,
  zonesWheelSmoothRaf: null,
  zoneBodiesCache: [],
  collapsedPlaylistsOverlayEl: null,
  collapsedPlaylistsHintTimer: null,
  collapsedPlaylistsHintEl: null,
  collapsedPlaylistLayoutLength: null,
};

function legacyToPlaylists(stateSnapshot) {
  if (!stateSnapshot) return [];
  if (Array.isArray(stateSnapshot.playlists)) return stateSnapshot.playlists;

  const layout = Array.isArray(stateSnapshot.layout) ? stateSnapshot.layout : [];
  const names = Array.isArray(stateSnapshot.playlistNames) ? stateSnapshot.playlistNames : [];
  const meta = Array.isArray(stateSnapshot.playlistMeta) ? stateSnapshot.playlistMeta : [];
  const autoplay = Array.isArray(stateSnapshot.playlistAutoplay) ? stateSnapshot.playlistAutoplay : [];
  const dsp = Array.isArray(stateSnapshot.playlistDsp) ? stateSnapshot.playlistDsp : [];

  return layout.map((trackPaths, index) => {
    const playlistId = `p-${index}`;
    const tracks = (trackPaths || []).map((filePath, trackIdx) => ({
      id: `t-${index}-${trackIdx}`,
      src: `/audio/${filePath}`,
      meta: {
        originalPath: filePath,
        titleMode: stateSnapshot.trackTitleModesByTrack
          ? stateSnapshot.trackTitleModesByTrack[filePath]
          : undefined,
      },
    }));

    const metaEntry = meta[index] || {};
    return {
      id: playlistId,
      name: names[index] || `Playlist ${index + 1}`,
      type: metaEntry.type || 'manual',
      tracks,
      settings: {
        autoPlayEnabled: Boolean(autoplay[index]),
        dspEnabled: Boolean(dsp[index]),
      },
      uiState: null,
    };
  });
}

function legacyDapToM2A(dapConfig) {
  if (!dapConfig) return { enabled: false, playlistId: null, volumePercent: DAP_DEFAULT_VOLUME_PERCENT };
  const explicitPlaylistId =
    typeof dapConfig.playlistId === 'string' && dapConfig.playlistId.trim()
      ? dapConfig.playlistId.trim()
      : null;
  return {
    enabled: Boolean(dapConfig.enabled),
    playlistId: explicitPlaylistId || (typeof dapConfig.playlistIndex === 'number' ? `p-${dapConfig.playlistIndex}` : null),
    volumePercent: dapConfig.volumePercent || DAP_DEFAULT_VOLUME_PERCENT,
  };
}

function serializeTrackTitleModesByTrackValue(value) {
  if (value instanceof Map) {
    const result = {};
    for (const [key, mode] of value.entries()) {
      if (typeof key !== 'string' || !key) continue;
      if (mode !== TRACK_TITLE_MODE_ATTRIBUTES) continue;
      result[key] = mode;
    }
    return result;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}

export function syncPlaylistsFromLegacyState() {
  const previousPlaylists = Array.isArray(state.playlists) ? state.playlists : [];
  const generatedPlaylists = legacyToPlaylists({
    layout: Array.isArray(state.layout) ? state.layout : [[]],
    playlistNames: Array.isArray(state.playlistNames) ? state.playlistNames : [],
    playlistMeta: Array.isArray(state.playlistMeta) ? state.playlistMeta : [],
    playlistAutoplay: Array.isArray(state.playlistAutoplay) ? state.playlistAutoplay : [],
    playlistDsp: Array.isArray(state.playlistDsp) ? state.playlistDsp : [],
    trackTitleModesByTrack: serializeTrackTitleModesByTrackValue(state.trackTitleModesByTrack),
  });
  const playlists = Array.isArray(generatedPlaylists) && generatedPlaylists.length
    ? generatedPlaylists.map((playlist, playlistIndex) => {
        const previousPlaylist = previousPlaylists[playlistIndex];
        const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
        const previousTracks = previousPlaylist && Array.isArray(previousPlaylist.tracks) ? previousPlaylist.tracks : [];
        return {
          ...playlist,
          id: previousPlaylist && typeof previousPlaylist.id === 'string' && previousPlaylist.id
            ? previousPlaylist.id
            : playlist.id,
          tracks: tracks.map((track, trackIndex) => {
            const previousTrack = previousTracks[trackIndex];
            return {
              ...track,
              id: previousTrack && typeof previousTrack.id === 'string' && previousTrack.id
                ? previousTrack.id
                : track.id,
            };
          }),
        };
      })
    : [];

  state.playlists = playlists;

  const normalizedDap = legacyDapToM2A(state.dapConfig);
  let playlistId = normalizedDap.playlistId;
  const playlistIndex = Number.isInteger(state.dapConfig && state.dapConfig.playlistIndex)
    ? state.dapConfig.playlistIndex
    : null;
  if (playlistIndex !== null && playlists[playlistIndex]) {
    playlistId = playlists[playlistIndex].id;
  } else if (playlistId && !playlists.some((playlist) => playlist && playlist.id === playlistId)) {
    playlistId = null;
  }
  state.dapConfig = {
    ...(state.dapConfig || {}),
    playlistId,
  };

  return state.playlists;
}

syncPlaylistsFromLegacyState();
