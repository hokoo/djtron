const zonesContainer = document.getElementById('zones');
const statusEl = document.getElementById('status');
const addPlaylistBtn = document.getElementById('addPlaylist');
const refreshPlaylistsBtn = document.getElementById('refreshPlaylists');
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
const releaseLinkEl = document.getElementById('releaseLink');
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

const SETTINGS_KEYS = {
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
const LAYOUT_STORAGE_KEY = 'player:playlists';
const LEGACY_LAYOUT_KEY = 'player:zones';
const CLIENT_ID_STORAGE_KEY = 'djtron:clientId';
const RUNTIME_LOCAL_OVERRIDE_KEYS = {
  allowContextMenu: ['djtron:config:allowContextMenu', 'djtron:allowContextMenu'],
  volumePresets: ['djtron:config:volumePresets', 'djtron:volumePresets'],
};
const RUNTIME_OVERRIDE_SCOPE_NONE = 'none';
const RUNTIME_OVERRIDE_SCOPE_CLIENT = 'client';
const RUNTIME_OVERRIDE_SCOPE_HOST = 'host';
const DEFAULT_RUNTIME_CONFIG_SCHEMA = Object.freeze({
  port: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
  allowContextMenu: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_CLIENT }),
  volumePresets: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_HOST }),
  dspEntryCompensationMs: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
  dspExitCompensationMs: Object.freeze({ localOverride: RUNTIME_OVERRIDE_SCOPE_NONE }),
});
const LAYOUT_STREAM_RETRY_MS = 1500;
const PLAYLIST_NAME_MAX_LENGTH = 80;
const HOST_PLAYBACK_SYNC_INTERVAL_MS = 900;
const AUDIO_CATALOG_POLL_INTERVAL_MS = 4000;
const TOUCH_COPY_HOLD_MS = 360;
const TOUCH_DRAG_ACTIVATION_DELAY_MS = 220;
const TOUCH_DRAG_START_MOVE_PX = 12;
const TOUCH_DRAG_COMMIT_PX = 6;
const TOUCH_NATIVE_DRAG_BLOCK_WINDOW_MS = 900;
const NOW_PLAYING_SEEK_DRAG_THRESHOLD_PX = 6;
const NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS = 320;
const NOW_PLAYING_TOGGLE_ZONE_HALF_WIDTH_PX = 32;
const NOW_PLAYING_REEL_BASE_SPIN_SECONDS = 1.8;
const NOW_PLAYING_REEL_FAST_SPIN_SECONDS = 0.24;
const NOW_PLAYING_REEL_MAX_SCRUB_SPEED_PX_PER_SEC = 1600;
const COHOST_SEEK_COMMAND_INTERVAL_MS = 40;
const HOST_LIVE_SEEK_SYNC_INTERVAL_MS = 40;
const ZONES_PAN_DRAG_THRESHOLD_PX = 4;
const ZONES_PAN_TOUCH_GAIN = 2.4;
const ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS = 0.16;
const ZONES_PAN_TOUCH_MOMENTUM_STOP_SPEED_PX_PER_MS = 0.02;
const ZONES_PAN_TOUCH_MOMENTUM_DECAY_PER_FRAME = 0.92;
const ZONES_WHEEL_SMOOTH_EASE = 0.24;
const ZONES_WHEEL_SMOOTH_MIN_DELTA_PX = 0.45;
const TRACK_TITLE_MODE_FILE = 'file';
const TRACK_TITLE_MODE_ATTRIBUTES = 'attributes';
const PLAYLIST_TYPE_MANUAL = 'manual';
const PLAYLIST_TYPE_FOLDER = 'folder';
const ROLE_HOST = 'host';
const ROLE_SLAVE = 'slave';
const ROLE_COHOST = 'co-host';
const PLAYBACK_COMMAND_PLAY_TRACK = 'play-track';
const PLAYBACK_COMMAND_TOGGLE_CURRENT = 'toggle-current';
const PLAYBACK_COMMAND_SET_VOLUME = 'set-volume';
const PLAYBACK_COMMAND_SET_VOLUME_PRESETS_VISIBLE = 'set-volume-presets-visible';
const PLAYBACK_COMMAND_SET_LIVE_SEEK_ENABLED = 'set-live-seek-enabled';
const PLAYBACK_COMMAND_SEEK_CURRENT = 'seek-current';
const DEFAULT_LIVE_VOLUME_PRESET_VALUES = Object.freeze([0.1, 0.3, 0.5]);
const DEFAULT_DSP_WINGET_COMMAND = 'winget install "FFmpeg (Essentials Build)"';
const LIVE_DSP_POLL_INTERVAL_MS = 1100;
const LIVE_DSP_POLL_TIMEOUT_MS = 2 * 60 * 1000;
const LIVE_DSP_RENDER_SOURCE = 'live-play-start';
const LIVE_DSP_HANDOFF_LEAD_SECONDS = 0.055;
const DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS = 22;
const DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS = 19;
const LIVE_DSP_WARMUP_TIMEOUT_MS = 12 * 1000;
const LIVE_DSP_WARMUP_MAX_TRACKED = 64;
const LIVE_DSP_CONTINUATION_WARMUP_MAX_TRACKED = 24;
let LIVE_VOLUME_PRESET_VALUES = DEFAULT_LIVE_VOLUME_PRESET_VALUES.slice();
let liveDspEntryCompensationSeconds = DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS / 1000;
let liveDspExitCompensationSeconds = DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS / 1000;
const DEFAULT_LIVE_VOLUME = 1;
const AUTOPLAY_OVERLAY_TRIGGER_EPSILON_SECONDS = 0.04;
const AUTOPLAY_OVERLAY_STATE_IDLE = 'idle';
const AUTOPLAY_OVERLAY_STATE_PENDING = 'pending';
const AUTOPLAY_OVERLAY_STATE_STARTED = 'started';
const AUTOPLAY_OVERLAY_STATE_FAILED = 'failed';

let currentAudio = null;
let currentTrack = null; // { file, basePath, key }
let fadeCancel = { cancelled: false };
let buttonsByFile = new Map();
let cardsByFile = new Map();
let durationLabelsByFile = new Map();
let trackNameLabelsByFile = new Map();
let knownTrackDurations = new Map();
let durationLoadPromises = new Map();
let trackAttributesByFile = new Map();
let trackAttributeLoadPromisesByFile = new Map();
let trackTitleModesByTrack = new Map();
let activeDurationTrackKey = null;
let progressRaf = null;
let progressAudio = null;
let draggingCard = null;
let dragDropHandled = false;
let dragContext = null;
let layout = [[]]; // array of playlists -> array of filenames
let playlistNames = ['Плей-лист 1'];
let playlistMeta = [{ type: PLAYLIST_TYPE_MANUAL }];
let playlistAutoplay = [false];
let playlistDsp = [false];
let availableFiles = [];
let availableFolders = [];
let audioCatalogSignature = '';
let audioCatalogPollTimer = null;
let audioCatalogPollInFlight = false;
let tracksReloadInFlight = false;
let tracksReloadQueued = false;
let tracksReloadQueuedReason = 'auto';
let shutdownCountdownTimer = null;
let currentUser = null;
let currentRole = null;
let showVolumePresetsEnabled = false;
let liveSeekEnabled = false;
let livePlaybackVolume = DEFAULT_LIVE_VOLUME;
let layoutVersion = 0;
let layoutStream = null;
let layoutStreamReconnectTimer = null;
let hostPlaybackState = getDefaultHostPlaybackState();
let hostPlaybackSyncInFlight = false;
let hostPlaybackSyncQueued = false;
let hostPlaybackSyncQueuedForce = false;
let lastHostPlaybackSyncAt = 0;
let lastHostLiveSeekSyncAt = 0;
let hostProgressRaf = null;
let cohostProgressRaf = null;
let hostHighlightedDescriptor = '';
let authUsersState = [];
let cohostRoleUpdatesInFlight = new Set();
let cohostDisconnectUpdatesInFlight = new Set();
let authRecoveryInProgress = false;
let runtimeAllowContextMenu = false;
let contextMenuGuardAttached = false;
let runtimeServerConfig = {
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
};
let dspStatusState = {
  enabled: null,
  ffmpegAvailable: null,
  ffmpegError: null,
  wingetCommand: DEFAULT_DSP_WINGET_COMMAND,
  checkedAt: 0,
};
let dspStatusRequestInFlight = false;
let liveDspRenderToken = 0;
let liveDspNextReadyDescriptor = '';
let liveDspNextReadySliceSeconds = null;
let dspTransitionPlayback = null;
let dspTransitionWarmupPromises = new Map();
let liveDspContinuationWarmupPromises = new Map();
let touchHoldTimer = null;
let touchHoldPointerId = null;
let touchHoldStartX = 0;
let touchHoldStartY = 0;
let touchHoldStartedAt = 0;
let touchHoldCard = null;
let touchCopyDragActive = false;
let touchCopyDragPointerId = null;
let touchCopyDragGhost = null;
let touchCopyDragStartX = 0;
let touchCopyDragStartY = 0;
let touchCopyDragMoved = false;
let touchDragMode = null;
let lastTouchPointerDownAt = 0;
let dragPreviewCard = null;
let desktopDragGhost = null;
let desktopDragGhostOffsetX = 16;
let desktopDragGhostOffsetY = 16;
let emptyDragImage = null;
let trashDropzoneEl = null;
let nowPlayingSeekActive = false;
let nowPlayingSeekMoved = false;
let nowPlayingSeekPointerId = null;
let nowPlayingSeekStartX = 0;
let nowPlayingSeekSuppressClickUntil = 0;
let nowPlayingSeekLastX = 0;
let nowPlayingSeekLastAt = 0;
let nowPlayingSeekSmoothedSpeed = 0;
let cohostSeekCommandTimer = null;
let cohostSeekCommandInFlight = false;
let cohostSeekPendingRatio = null;
let cohostSeekPendingFinalize = false;
let cohostSeekLastSentAt = 0;
let zonesPanActive = false;
let zonesPanMoved = false;
let zonesPanPointerId = null;
let zonesPanStartX = 0;
let zonesPanStartY = 0;
let zonesPanStartScrollLeft = 0;
let zonesPanPreferHorizontal = false;
let zonesPanPointerType = '';
let zonesPanMoveGain = 1;
let zonesPanLastX = 0;
let zonesPanLastAt = 0;
let zonesPanVelocityX = 0;
let zonesPanMomentumRaf = null;
let zonesTouchPanActive = false;
let zonesTouchPanMoved = false;
let zonesTouchPanStartMidX = 0;
let zonesTouchPanStartMidY = 0;
let zonesTouchPanStartScrollLeft = 0;
let zonesTouchPanLastMidX = 0;
let zonesTouchPanLastAt = 0;
let zonesTouchPanVelocityX = 0;
const zonesWheelTargets = new Map();
let zonesWheelSmoothRaf = null;
const HOST_SERVER_HINT = 'Если нужно завершить работу, нажмите кнопку ниже. Сервер остановится и страница перестанет отвечать.';
const NOW_PLAYING_IDLE_TITLE = 'Ничего не играет';
const HOST_NOW_PLAYING_IDLE_TITLE = 'Live: ничего не играет';
const clientId = getClientId();

function isHostRole(role = currentRole) {
  return role === ROLE_HOST;
}

function isSlaveRole(role = currentRole) {
  return role === ROLE_SLAVE;
}

function isCoHostRole(role = currentRole) {
  return role === ROLE_COHOST;
}

function isRemoteLiveMirrorRole(role = currentRole) {
  return role === ROLE_SLAVE || role === ROLE_COHOST;
}

function clampVolume(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeLiveVolumePreset(value, fallback = DEFAULT_LIVE_VOLUME) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = clampVolume(numeric);
  if (Math.abs(normalized - 1) < 0.0001) {
    return 1;
  }
  return normalized;
}

function getActiveVolumePresetValue(volume = livePlaybackVolume) {
  const normalized = normalizeLiveVolumePreset(volume, DEFAULT_LIVE_VOLUME);
  for (const preset of LIVE_VOLUME_PRESET_VALUES) {
    if (Math.abs(normalized - preset) < 0.0001) {
      return preset;
    }
  }
  return null;
}

function formatVolumePresetLabel(volume) {
  return `${Math.round(clampVolume(volume) * 100)}%`;
}

function canDisableVolumePresetsSetting(volume = livePlaybackVolume) {
  return getActiveVolumePresetValue(volume) === null;
}

function normalizePlaybackSeekRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return 0;
  if (numeric >= 1) return 1;
  return numeric;
}

function readStoredValueByKeys(keys) {
  if (!Array.isArray(keys)) return null;
  for (const key of keys) {
    if (typeof key !== 'string' || !key) continue;
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  }
  return null;
}

function parseBooleanConfigValue(value, fallback = null) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function normalizeVolumePresetValues(values, fallback = DEFAULT_LIVE_VOLUME_PRESET_VALUES) {
  const source = Array.isArray(values) ? values : [];
  const normalized = [];
  const seen = new Set();

  for (const rawValue of source) {
    const percentValue = Number(rawValue);
    if (!Number.isFinite(percentValue)) continue;
    if (percentValue < 1 || percentValue >= 100) continue;

    const rounded = Math.round((percentValue / 100) * 1000) / 1000;
    const dedupeKey = rounded.toFixed(3);
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    normalized.push(rounded);
    if (normalized.length >= 8) break;
  }

  if (normalized.length) return normalized;
  if (Array.isArray(fallback)) return fallback.slice();
  return DEFAULT_LIVE_VOLUME_PRESET_VALUES.slice();
}

function parseVolumePresetsConfigValue(value, fallback = null) {
  const fallbackArray = Array.isArray(fallback) ? fallback : null;

  if (Array.isArray(value)) {
    const normalized = normalizeVolumePresetValues(value, []);
    if (normalized.length) return normalized;
    return fallbackArray ? fallbackArray.slice() : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = normalizeVolumePresetValues([value], []);
    if (normalized.length) return normalized;
    return fallbackArray ? fallbackArray.slice() : null;
  }

  if (typeof value !== 'string') return fallbackArray ? fallbackArray.slice() : null;
  const trimmed = value.trim();
  if (!trimmed) return fallbackArray ? fallbackArray.slice() : null;

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const normalized = normalizeVolumePresetValues(parsed, []);
        if (normalized.length) return normalized;
        return fallbackArray ? fallbackArray.slice() : null;
      }
    } catch (err) {
      // fallback to token parsing
    }
  }

  const tokens = trimmed.split(/[,\s;|]+/).filter(Boolean);
  if (!tokens.length) return fallbackArray ? fallbackArray.slice() : null;
  const normalized = normalizeVolumePresetValues(tokens, []);
  if (normalized.length) return normalized;
  return fallbackArray ? fallbackArray.slice() : null;
}

function parsePortCandidate(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const numeric = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return fallback;
  return numeric;
}

function parseDspCompensationMsConfigValue(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.trunc(numeric);
  if (normalized < 0 || normalized > 250) return fallback;
  return normalized;
}

function getDefaultRuntimeConfigSchema() {
  return {
    port: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
    allowContextMenu: { localOverride: RUNTIME_OVERRIDE_SCOPE_CLIENT },
    volumePresets: { localOverride: RUNTIME_OVERRIDE_SCOPE_HOST },
    dspEntryCompensationMs: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
    dspExitCompensationMs: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
  };
}

function sanitizeRuntimeOverrideScope(value, fallback = RUNTIME_OVERRIDE_SCOPE_NONE) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    normalized === RUNTIME_OVERRIDE_SCOPE_NONE ||
    normalized === RUNTIME_OVERRIDE_SCOPE_CLIENT ||
    normalized === RUNTIME_OVERRIDE_SCOPE_HOST
  ) {
    return normalized;
  }
  return fallback;
}

function sanitizeRuntimeConfigSchema(rawSchema) {
  const schema = getDefaultRuntimeConfigSchema();
  if (!rawSchema || typeof rawSchema !== 'object') return schema;

  for (const key of Object.keys(schema)) {
    const rawEntry = rawSchema[key];
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    schema[key].localOverride = sanitizeRuntimeOverrideScope(rawEntry.localOverride, schema[key].localOverride);
  }

  return schema;
}

function sanitizeRuntimeConfigPayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const payloadValues = payload.values && typeof payload.values === 'object' ? payload.values : payload;
  const schema = sanitizeRuntimeConfigSchema(payload.schema);

  return {
    port: parsePortCandidate(payloadValues.port, null),
    allowContextMenu: parseBooleanConfigValue(payloadValues.allowContextMenu, false),
    volumePresets: parseVolumePresetsConfigValue(payloadValues.volumePresets, DEFAULT_LIVE_VOLUME_PRESET_VALUES),
    dspEntryCompensationMs: parseDspCompensationMsConfigValue(
      payloadValues.dspEntryCompensationMs,
      DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS,
    ),
    dspExitCompensationMs: parseDspCompensationMsConfigValue(
      payloadValues.dspExitCompensationMs,
      DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS,
    ),
    schema,
  };
}

function getRuntimeLocalOverrideScope(configKey, schema = runtimeServerConfig.schema) {
  const fallbackScope = DEFAULT_RUNTIME_CONFIG_SCHEMA[configKey]
    ? DEFAULT_RUNTIME_CONFIG_SCHEMA[configKey].localOverride
    : RUNTIME_OVERRIDE_SCOPE_NONE;
  if (!schema || typeof schema !== 'object') return fallbackScope;
  const schemaEntry = schema[configKey];
  if (!schemaEntry || typeof schemaEntry !== 'object') return fallbackScope;
  return sanitizeRuntimeOverrideScope(schemaEntry.localOverride, fallbackScope);
}

function canUseRuntimeLocalOverride(configKey, role = currentRole, schema = runtimeServerConfig.schema) {
  const scope = getRuntimeLocalOverrideScope(configKey, schema);
  if (scope === RUNTIME_OVERRIDE_SCOPE_CLIENT) return true;
  if (scope === RUNTIME_OVERRIDE_SCOPE_HOST) return isHostRole(role);
  return false;
}

function readRuntimeLocalOverrides(schema = runtimeServerConfig.schema, role = currentRole) {
  const overrides = {
    allowContextMenu: null,
    volumePresets: null,
  };

  if (canUseRuntimeLocalOverride('allowContextMenu', role, schema)) {
    const allowContextMenuRaw = readStoredValueByKeys(RUNTIME_LOCAL_OVERRIDE_KEYS.allowContextMenu);
    overrides.allowContextMenu = parseBooleanConfigValue(allowContextMenuRaw, null);
  }

  if (canUseRuntimeLocalOverride('volumePresets', role, schema)) {
    const volumePresetsRaw = readStoredValueByKeys(RUNTIME_LOCAL_OVERRIDE_KEYS.volumePresets);
    overrides.volumePresets = parseVolumePresetsConfigValue(volumePresetsRaw, null);
  }

  return overrides;
}

function setContextMenuBlocked(blocked) {
  const shouldBlock = Boolean(blocked);
  if (shouldBlock === contextMenuGuardAttached) return;

  if (shouldBlock) {
    document.addEventListener('contextmenu', preventContextMenu);
  } else {
    document.removeEventListener('contextmenu', preventContextMenu);
  }
  contextMenuGuardAttached = shouldBlock;
}

function preventContextMenu(event) {
  event.preventDefault();
}

function rebuildVolumePresetButtons() {
  if (!localVolumePresetsEl) {
    localVolumePresetButtons = [];
    return;
  }

  localVolumePresetsEl.textContent = '';
  localVolumePresetButtons = LIVE_VOLUME_PRESET_VALUES.map((presetValue) => {
    const button = document.createElement('button');
    button.className = 'volume-presets__button';
    button.type = 'button';
    button.dataset.volume = String(presetValue);
    button.textContent = formatVolumePresetLabel(presetValue);
    button.addEventListener('click', onVolumePresetButtonClick);
    localVolumePresetsEl.append(button);
    return button;
  });
}

function applyRuntimeClientConfig() {
  setContextMenuBlocked(!runtimeAllowContextMenu);
  LIVE_VOLUME_PRESET_VALUES = normalizeVolumePresetValues(LIVE_VOLUME_PRESET_VALUES);
  rebuildVolumePresetButtons();
  updateVolumePresetsUi();
}

function applyRuntimeConfigFromSources(serverConfig = null) {
  if (serverConfig && typeof serverConfig === 'object') {
    runtimeServerConfig = sanitizeRuntimeConfigPayload(serverConfig);
  }

  const schema = runtimeServerConfig.schema || getDefaultRuntimeConfigSchema();
  const localOverrides = readRuntimeLocalOverrides(schema, currentRole);

  runtimeAllowContextMenu =
    localOverrides.allowContextMenu !== null ? localOverrides.allowContextMenu : runtimeServerConfig.allowContextMenu;
  LIVE_VOLUME_PRESET_VALUES =
    localOverrides.volumePresets && localOverrides.volumePresets.length
      ? localOverrides.volumePresets.slice()
      : runtimeServerConfig.volumePresets.slice();
  liveDspEntryCompensationSeconds = runtimeServerConfig.dspEntryCompensationMs / 1000;
  liveDspExitCompensationSeconds = runtimeServerConfig.dspExitCompensationMs / 1000;

  applyRuntimeClientConfig();
}

async function fetchRuntimeConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error('Не удалось загрузить runtime-конфиг');
  }
  const data = await response.json().catch(() => ({}));
  return data && typeof data === 'object' ? data : {};
}

function isOverlayEnabled() {
  return overlayEnabledToggle ? overlayEnabledToggle.checked : true;
}

function isStopFadeEnabled() {
  return stopFadeEnabledToggle ? stopFadeEnabledToggle.checked : true;
}

function getOverlaySeconds() {
  if (!isOverlayEnabled()) return 0;
  return Math.max(0, parseFloat(overlayTimeInput ? overlayTimeInput.value : '0') || 0);
}

function getStopFadeSeconds() {
  if (!isStopFadeEnabled()) return 0;
  return Math.max(0, parseFloat(stopFadeInput ? stopFadeInput.value : '0') || 0);
}

function getTransitionCurve() {
  const curve = overlayCurveSelect && typeof overlayCurveSelect.value === 'string' ? overlayCurveSelect.value : '';
  return curve || 'linear';
}

function updateTransitionSettingsUi() {
  if (overlayTimeInput) {
    overlayTimeInput.disabled = !isOverlayEnabled();
  }
  if (stopFadeInput) {
    stopFadeInput.disabled = !isStopFadeEnabled();
  }
}

function applyLiveVolumeToCurrentAudio() {
  if (!currentAudio) return;
  currentAudio.volume = clampVolume(livePlaybackVolume);
}

function setLivePlaybackVolume(volume, { sync = false, announce = false } = {}) {
  const normalized = normalizeLiveVolumePreset(volume, livePlaybackVolume);
  const changed = Math.abs(normalized - livePlaybackVolume) >= 0.0001;
  livePlaybackVolume = normalized;

  if (isHostRole()) {
    applyLiveVolumeToCurrentAudio();
    if (sync && changed) {
      requestHostPlaybackSync(true);
    }
  }

  updateVolumePresetsUi();
  if (announce) {
    setStatus(`Громкость: ${formatVolumePresetLabel(livePlaybackVolume)}.`);
  }
  return changed;
}

function getEffectiveLiveVolume() {
  return normalizeLiveVolumePreset(livePlaybackVolume, DEFAULT_LIVE_VOLUME);
}

function setShowVolumePresetsEnabled(
  enabled,
  { persist = false, sync = false, announce = false } = {},
) {
  let normalized = Boolean(enabled);
  if (!normalized && !canDisableVolumePresetsSetting()) {
    normalized = true;
  }

  const changed = normalized !== showVolumePresetsEnabled;
  showVolumePresetsEnabled = normalized;

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

function updateLiveSeekUi() {
  const isHost = isHostRole();
  if (liveSeekToggleRow) {
    liveSeekToggleRow.style.display = isHost ? 'flex' : 'none';
  }

  if (liveSeekEnabledToggle) {
    liveSeekEnabledToggle.checked = liveSeekEnabled;
    liveSeekEnabledToggle.disabled = !isHost;
  }

  if (nowPlayingControlBtn) {
    const canTouchSeek =
      isSlaveRole() ||
      ((isHostRole() || isCoHostRole()) && liveSeekEnabled);
    nowPlayingControlBtn.dataset.liveSeekEnabled = canTouchSeek ? 'true' : 'false';
  }
}

function updatePrereleaseSettingUi(role = currentRole) {
  const isHost = isHostRole(role);
  if (allowPrereleaseRow) {
    allowPrereleaseRow.style.display = isHost ? 'flex' : 'none';
  }
  if (allowPrereleaseInput) {
    allowPrereleaseInput.disabled = !isHost;
  }
}

function setDspSetupStatus(message) {
  if (!dspSetupStatusEl) return;
  dspSetupStatusEl.textContent = message || '';
}

function updateDspSetupUi(role = currentRole) {
  if (!dspSetupPanelEl) return;

  const isHost = isHostRole(role);
  if (!isHost) {
    dspSetupPanelEl.hidden = true;
    return;
  }

  const enabled = dspStatusState.enabled;
  const available = dspStatusState.ffmpegAvailable;
  const installCommand =
    typeof dspStatusState.wingetCommand === 'string' && dspStatusState.wingetCommand.trim()
      ? dspStatusState.wingetCommand.trim()
      : DEFAULT_DSP_WINGET_COMMAND;

  if (dspInstallCommandEl) {
    dspInstallCommandEl.textContent = installCommand;
  }

  const shouldShowPanel = enabled !== false && available !== true;
  dspSetupPanelEl.hidden = !shouldShowPanel;
  if (!shouldShowPanel) return;

  if (available === false) {
    const details = dspStatusState.ffmpegError ? ` (${dspStatusState.ffmpegError})` : '';
    setDspSetupStatus(`ffmpeg не найден${details}`);
    return;
  }

  if (dspStatusState.ffmpegError) {
    setDspSetupStatus(`Не удалось проверить ffmpeg: ${dspStatusState.ffmpegError}`);
    return;
  }

  setDspSetupStatus('Проверяем доступность ffmpeg...');
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

function parseDspStatusPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const queue = payload.queue && typeof payload.queue === 'object' ? payload.queue : null;
  if (!queue) {
    throw new Error('Некорректный ответ DSP API');
  }

  dspStatusState.enabled = Boolean(queue.enabled);
  dspStatusState.ffmpegAvailable = typeof queue.ffmpegAvailable === 'boolean' ? queue.ffmpegAvailable : null;
  dspStatusState.ffmpegError =
    typeof queue.ffmpegError === 'string' && queue.ffmpegError.trim() ? queue.ffmpegError.trim() : null;
  dspStatusState.wingetCommand =
    typeof queue.wingetCommand === 'string' && queue.wingetCommand.trim()
      ? queue.wingetCommand.trim()
      : DEFAULT_DSP_WINGET_COMMAND;
  dspStatusState.checkedAt = Date.now();
}

async function refreshDspStatus({ announceError = false, userInitiated = false } = {}) {
  if (!isHostRole()) return;
  if (dspStatusRequestInFlight) return;

  dspStatusRequestInFlight = true;
  if (dspCheckInstallBtn) {
    dspCheckInstallBtn.disabled = true;
  }

  if (userInitiated) {
    setDspSetupStatus('Проверяем наличие ffmpeg...');
  }

  try {
    const response = await fetch('/api/dsp/transitions?limit=1');
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data && typeof data.error === 'string' && data.error ? data.error : 'Не удалось проверить DSP';
      throw new Error(message);
    }

    parseDspStatusPayload(data);
    updateDspSetupUi(currentRole);

    if (userInitiated && dspStatusState.ffmpegAvailable === true) {
      setStatus('ffmpeg найден. DSP готов.');
    }
  } catch (err) {
    console.error('Не удалось проверить ffmpeg', err);
    dspStatusState.enabled = true;
    dspStatusState.ffmpegAvailable = null;
    dspStatusState.ffmpegError = err && err.message ? err.message : 'Ошибка запроса';
    dspStatusState.checkedAt = Date.now();
    updateDspSetupUi(currentRole);

    if (announceError || userInitiated) {
      setStatus(dspStatusState.ffmpegError || 'Не удалось проверить ffmpeg.');
    }
  } finally {
    dspStatusRequestInFlight = false;
    if (dspCheckInstallBtn) {
      dspCheckInstallBtn.disabled = !isHostRole();
    }
  }
}

function initDspSetupPanel() {
  updateDspSetupUi(currentRole);

  if (dspCopyInstallCommandBtn) {
    dspCopyInstallCommandBtn.addEventListener('click', async () => {
      const command =
        typeof dspStatusState.wingetCommand === 'string' && dspStatusState.wingetCommand.trim()
          ? dspStatusState.wingetCommand.trim()
          : DEFAULT_DSP_WINGET_COMMAND;
      try {
        await copyTextToClipboard(command);
        setDspSetupStatus('Команда скопирована. Вставьте ее в PowerShell или cmd.');
        setStatus('Команда установки ffmpeg скопирована.');
      } catch (err) {
        console.error('Не удалось скопировать команду установки ffmpeg', err);
        setDspSetupStatus('Не удалось скопировать автоматически. Скопируйте строку вручную.');
      }
    });
  }

  if (dspCheckInstallBtn) {
    dspCheckInstallBtn.addEventListener('click', () => {
      refreshDspStatus({ announceError: true, userInitiated: true });
    });
  }

  if (isHostRole()) {
    refreshDspStatus({ announceError: false, userInitiated: false });
  }
}

function setLiveSeekEnabled(
  enabled,
  { persist = false, sync = false, announce = false } = {},
) {
  const normalized = Boolean(enabled);
  const changed = normalized !== liveSeekEnabled;
  liveSeekEnabled = normalized;

  if (!normalized && nowPlayingSeekActive) {
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

function updateVolumePresetsUi() {
  if (!localVolumePresetsEl) return;

  const canManagePresets = isHostRole() || isCoHostRole();
  if (showVolumePresetsToggleRow) {
    showVolumePresetsToggleRow.style.display = canManagePresets ? 'flex' : 'none';
  }

  const shouldShow = showVolumePresetsEnabled && canManagePresets;
  localVolumePresetsEl.hidden = !shouldShow;
  if (showVolumePresetsToggle) {
    showVolumePresetsToggle.checked = showVolumePresetsEnabled;
    const hasActivePreset = !canDisableVolumePresetsSetting();
    showVolumePresetsToggle.disabled = !canManagePresets || Boolean(showVolumePresetsEnabled && hasActivePreset);
  }
  if (!localVolumePresetButtons.length) return;

  const activePreset = getActiveVolumePresetValue();
  for (const button of localVolumePresetButtons) {
    const buttonVolume = normalizeLiveVolumePreset(button.dataset.volume, null);
    const isActive = buttonVolume !== null && activePreset !== null && Math.abs(buttonVolume - activePreset) < 0.0001;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    button.title = `Громкость ${formatVolumePresetLabel(buttonVolume !== null ? buttonVolume : DEFAULT_LIVE_VOLUME)}`;
  }
}

function trackKey(file, basePath = '/audio') {
  return `${basePath}|${file}`;
}

function getOrCreateSet(map, key) {
  const existing = map.get(key);
  if (existing) return existing;
  const created = new Set();
  map.set(key, created);
  return created;
}

function addToMultiMap(map, key, value) {
  getOrCreateSet(map, key).add(value);
}

function getFirstFromSet(values) {
  if (!values || !values.size) return null;
  return values.values().next().value || null;
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
        : ensurePlaylists(layout).length;
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
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(layout).length;
  return JSON.stringify(normalizePlaylistMeta(meta, expectedLength));
}

function playlistMetaEqual(left, right, expectedLength) {
  return serializePlaylistMeta(left, expectedLength) === serializePlaylistMeta(right, expectedLength);
}

function getPlaylistMetaEntry(playlistIndex) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return defaultPlaylistMeta();
  const normalized = normalizePlaylistMeta(playlistMeta, ensurePlaylists(layout).length);
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

  availableFolders.forEach((folder) => {
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

  let manualIndex = getManualPlaylistIndex(nextMeta, nextLayout);
  if (manualIndex < 0) {
    nextLayout.push([]);
    nextNames.push(defaultPlaylistName(nextLayout.length - 1));
    nextMeta.push(defaultPlaylistMeta());
    manualIndex = nextLayout.length - 1;
  }

  const occurrence = buildFileOccurrenceMap(nextLayout);
  const rootFiles = availableFiles.filter((file) => typeof file === 'string' && file && !file.includes('/'));
  rootFiles.forEach((file) => {
    if ((occurrence.get(file) || 0) > 0) return;
    nextLayout[manualIndex].push(file);
    occurrence.set(file, (occurrence.get(file) || 0) + 1);
  });

  availableFolders.forEach((folder) => {
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

function resolveRequestedCopyMode(event) {
  if (touchCopyDragActive) {
    return touchDragMode === 'copy';
  }
  return isCopyDragModifier(event);
}

function resolveEffectiveDragMode(event, targetZoneIndex = null) {
  const requestedCopy = resolveRequestedCopyMode(event);
  if (!dragContext || dragContext.sourcePlaylistType !== PLAYLIST_TYPE_FOLDER) {
    return requestedCopy ? 'copy' : 'move';
  }

  const sourceZoneIndex = Number.isInteger(dragContext.sourceZoneIndex) ? dragContext.sourceZoneIndex : -1;
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
  if (mode === 'copy' || mode === 'cancel' || mode === 'delete') return mode;
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
  applyDragModeBadgeToElement(draggingCard, normalizedMode);
  applyDragModeBadgeToElement(dragPreviewCard, normalizedMode);
  applyDragModeBadgeToElement(desktopDragGhost, normalizedMode);
}

function clearDragModeBadge() {
  clearDragModeBadgeFromElement(draggingCard);
  clearDragModeBadgeFromElement(dragPreviewCard);
  clearDragModeBadgeFromElement(desktopDragGhost);
}

function isActiveCopyDrag(event, targetZoneIndex = null) {
  return resolveEffectiveDragMode(event, targetZoneIndex) === 'copy';
}

function clearDragPreviewCard() {
  if (!dragPreviewCard) return;
  dragPreviewCard.remove();
  dragPreviewCard = null;
}

function ensureDragPreviewCard() {
  if (dragPreviewCard) return dragPreviewCard;
  if (!draggingCard) return null;

  const preview = draggingCard.cloneNode(true);
  preview.classList.add('drag-copy-preview');
  preview.classList.remove('dragging');
  preview.removeAttribute('draggable');
  const playButton = preview.querySelector('button.play');
  if (playButton) playButton.disabled = true;
  dragPreviewCard = preview;
  if (draggingCard.classList.contains('has-drag-mode')) {
    applyDragModeBadgeToElement(dragPreviewCard, draggingCard.dataset.dragMode || 'move');
  }
  return dragPreviewCard;
}

function getEmptyDragImage() {
  if (emptyDragImage) return emptyDragImage;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  emptyDragImage = canvas;
  return emptyDragImage;
}

function clearDesktopDragGhost() {
  if (!desktopDragGhost) return;
  desktopDragGhost.remove();
  desktopDragGhost = null;
}

function updateDesktopDragGhostPosition(clientX, clientY) {
  if (!desktopDragGhost) return;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  desktopDragGhost.style.transform = `translate(${clientX - desktopDragGhostOffsetX}px, ${clientY - desktopDragGhostOffsetY}px)`;
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
  desktopDragGhost = ghost;
  document.body.appendChild(ghost);

  if (draggingCard && draggingCard.classList.contains('has-drag-mode')) {
    applyDragModeBadgeToElement(desktopDragGhost, draggingCard.dataset.dragMode || 'move');
  }

  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    desktopDragGhostOffsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    desktopDragGhostOffsetY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    updateDesktopDragGhostPosition(clientX, clientY);
  } else {
    desktopDragGhostOffsetX = rect.width / 2;
    desktopDragGhostOffsetY = rect.height / 2;
  }
}

function ensureTrashDropzone() {
  if (trashDropzoneEl) return trashDropzoneEl;

  const trash = document.createElement('div');
  trash.className = 'drag-trash';
  trash.setAttribute('aria-label', 'Удалить трек');
  trash.innerHTML = '<span class="drag-trash__icon">🗑</span><span class="drag-trash__label">Удалить</span>';
  document.body.appendChild(trash);

  trash.addEventListener('dragover', (event) => {
    if (!draggingCard || !dragContext) return;
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
    if (!draggingCard || !dragContext) return;
    event.preventDefault();
    event.stopPropagation();
    trash.classList.remove('is-active');
    handleDragDeleteFromContext().catch((err) => {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось удалить трек.');
    });
  });

  trashDropzoneEl = trash;
  return trashDropzoneEl;
}

function showTrashDropzone() {
  const trash = ensureTrashDropzone();
  trash.classList.add('is-visible');
}

function hideTrashDropzone() {
  if (!trashDropzoneEl) return;
  trashDropzoneEl.classList.remove('is-visible', 'is-active');
}

function isTrashDropzoneTarget(target) {
  if (!trashDropzoneEl || !(target instanceof Element)) return false;
  return trashDropzoneEl.contains(target);
}

function isPointOverTrashDropzone(clientX, clientY) {
  if (!trashDropzoneEl || !trashDropzoneEl.classList.contains('is-visible')) return false;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const rect = trashDropzoneEl.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function handleGlobalDragOver(event) {
  if (!draggingCard || !event.dataTransfer) return;
  updateDesktopDragGhostPosition(event.clientX, event.clientY);
  const target = event.target instanceof Element ? event.target : null;
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
  return Date.now() - lastTouchPointerDownAt < TOUCH_NATIVE_DRAG_BLOCK_WINDOW_MS;
}

function removeTouchHoldListeners() {
  window.removeEventListener('pointermove', onTouchHoldPointerMove, true);
  window.removeEventListener('pointerup', onTouchHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onTouchHoldPointerEnd, true);
}

function clearTouchCopyHold() {
  const holdCard = touchHoldCard;
  if (holdCard) {
    holdCard.classList.remove('touch-hold-copy');
  }
  if (holdCard && touchHoldPointerId !== null && typeof holdCard.releasePointerCapture === 'function') {
    try {
      if (holdCard.hasPointerCapture && holdCard.hasPointerCapture(touchHoldPointerId)) {
        holdCard.releasePointerCapture(touchHoldPointerId);
      }
    } catch (err) {
      // ignore pointer capture release errors from browsers that do not fully support it
    }
  }

  if (touchHoldTimer !== null) {
    clearTimeout(touchHoldTimer);
    touchHoldTimer = null;
  }
  touchHoldPointerId = null;
  touchHoldStartedAt = 0;
  touchHoldCard = null;
  removeTouchHoldListeners();
}

function onTouchHoldPointerMove(event) {
  if (touchHoldPointerId === null || event.pointerId !== touchHoldPointerId) return;
  const deltaX = event.clientX - touchHoldStartX;
  const deltaY = event.clientY - touchHoldStartY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= TOUCH_DRAG_START_MOVE_PX) return;

  const elapsed = Date.now() - touchHoldStartedAt;
  if (elapsed < TOUCH_DRAG_ACTIVATION_DELAY_MS) {
    // Treat early movement as a regular scroll gesture, not as drag.
    clearTouchCopyHold();
    return;
  }

  const heldCard = touchHoldCard;
  const pointerId = touchHoldPointerId;
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
  if (touchHoldPointerId === null || event.pointerId !== touchHoldPointerId) return;
  clearTouchCopyHold();
}

function updateTouchCopyGhostPosition(clientX, clientY) {
  if (!touchCopyDragGhost) return;
  const offsetX = 16;
  const offsetY = 16;
  touchCopyDragGhost.style.transform = `translate(${clientX + offsetX}px, ${clientY + offsetY}px)`;
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
  if (touchCopyDragGhost) {
    touchCopyDragGhost.remove();
    touchCopyDragGhost = null;
  }
  hideTrashDropzone();
  clearDesktopDragGhost();
  clearDragModeBadge();
  clearDragPreviewCard();

  removeTouchCopyDragListeners();
  clearZoneDragOverState();

  if (draggingCard) {
    draggingCard.classList.remove('dragging');
  }

  const shouldRestoreLayout = restoreLayout && !dragDropHandled;

  draggingCard = null;
  dragContext = null;
  dragDropHandled = false;
  touchCopyDragActive = false;
  touchCopyDragPointerId = null;
  touchCopyDragMoved = false;
  touchDragMode = null;

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

  if (isPointOverTrashDropzone(clientX, clientY)) {
    if (trashDropzoneEl) {
      trashDropzoneEl.classList.add('is-active');
    }
    applyDragModeBadge('delete');
    if (touchCopyDragGhost) {
      touchCopyDragGhost.classList.remove('is-copy', 'is-move', 'is-cancel');
      touchCopyDragGhost.classList.add('is-delete');
    }
    return;
  }

  if (trashDropzoneEl) {
    trashDropzoneEl.classList.remove('is-active');
  }

  const zone = getZoneFromPoint(clientX, clientY);
  if (!zone) {
    applyDragModeBadge('cancel');
    if (touchCopyDragGhost) {
      touchCopyDragGhost.classList.remove('is-copy', 'is-move', 'is-delete');
      touchCopyDragGhost.classList.add('is-cancel');
    }
    return;
  }

  const targetZoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
  const dropMode = resolveEffectiveDragMode(null, Number.isInteger(targetZoneIndex) ? targetZoneIndex : null);
  applyDragModeBadge(dropMode);
  if (touchCopyDragGhost) {
    touchCopyDragGhost.classList.remove('is-delete', 'is-cancel', 'is-copy', 'is-move');
    touchCopyDragGhost.classList.add(dropMode === 'copy' ? 'is-copy' : 'is-move');
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
  if (!touchCopyDragActive) return;
  const dropMode = touchDragMode === 'copy' ? 'copy' : 'move';

  if (!touchCopyDragMoved) {
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
  if (!touchCopyDragActive || event.pointerId !== touchCopyDragPointerId) return;
  event.preventDefault();
  const deltaX = event.clientX - touchCopyDragStartX;
  const deltaY = event.clientY - touchCopyDragStartY;
  if (!touchCopyDragMoved && Math.hypot(deltaX, deltaY) > TOUCH_DRAG_COMMIT_PX) {
    touchCopyDragMoved = true;
  }
  updateTouchCopyDragPreview(event.clientX, event.clientY);
}

function onTouchCopyDragPointerUp(event) {
  if (!touchCopyDragActive || event.pointerId !== touchCopyDragPointerId) return;
  event.preventDefault();
  finishTouchCopyDrag(event.clientX, event.clientY).catch((err) => {
    console.error(err);
    const dropMode = touchDragMode === 'copy' ? 'copy' : 'move';
    cleanupTouchCopyDrag({ restoreLayout: true });
    setStatus(
      dropMode === 'copy'
        ? 'Не удалось завершить копирование на тач-устройстве.'
        : 'Не удалось завершить перемещение на тач-устройстве.',
    );
  });
}

function onTouchCopyDragPointerCancel(event) {
  if (!touchCopyDragActive || event.pointerId !== touchCopyDragPointerId) return;
  const dropMode = touchDragMode === 'copy' ? 'copy' : 'move';
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
  const sourceIndex = sourceBody ? Array.from(sourceBody.querySelectorAll('.track-card')).indexOf(card) : -1;
  const sourcePlaylistType = isFolderPlaylistIndex(sourceZoneIndex) ? PLAYLIST_TYPE_FOLDER : PLAYLIST_TYPE_MANUAL;
  const resolvedMode = mode === 'copy' ? 'copy' : 'move';

  dragContext = {
    file: card.dataset.file || '',
    sourceZoneIndex: Number.isInteger(sourceZoneIndex) ? sourceZoneIndex : -1,
    sourceIndex,
    sourcePlaylistType,
    snapshotLayout: cloneLayoutState(layout),
  };

  draggingCard = card;
  dragDropHandled = false;
  touchCopyDragActive = true;
  touchCopyDragPointerId = pointerId;
  touchCopyDragStartX = clientX;
  touchCopyDragStartY = clientY;
  touchCopyDragMoved = Boolean(moved);
  touchDragMode = resolvedMode;
  card.classList.add('dragging');

  const ghost = card.cloneNode(true);
  ghost.classList.add('touch-drag-ghost');
  ghost.classList.add(touchDragMode === 'copy' ? 'is-copy' : 'is-move');
  ghost.classList.remove('dragging');
  touchCopyDragGhost = ghost;
  document.body.appendChild(ghost);
  updateTouchCopyGhostPosition(clientX, clientY);
  showTrashDropzone();
  applyDragModeBadge(touchDragMode);

  window.addEventListener('pointermove', onTouchCopyDragPointerMove, true);
  window.addEventListener('pointerup', onTouchCopyDragPointerUp, true);
  window.addEventListener('pointercancel', onTouchCopyDragPointerCancel, true);
  setStatus(
    touchDragMode === 'copy'
      ? 'Режим копирования: перетащите трек в нужный плей-лист.'
      : 'Режим перемещения: перетащите трек в нужный плей-лист.',
  );
}

function startTouchCopyHold(card, event) {
  if (touchCopyDragActive) return;

  lastTouchPointerDownAt = Date.now();
  clearTouchCopyHold();
  touchHoldPointerId = event.pointerId;
  touchHoldStartX = event.clientX;
  touchHoldStartY = event.clientY;
  touchHoldStartedAt = Date.now();
  touchHoldCard = card;
  card.classList.add('touch-hold-copy');

  window.addEventListener('pointermove', onTouchHoldPointerMove, true);
  window.addEventListener('pointerup', onTouchHoldPointerEnd, true);
  window.addEventListener('pointercancel', onTouchHoldPointerEnd, true);

  touchHoldTimer = setTimeout(() => {
    const heldCard = touchHoldCard;
    const pointerId = touchHoldPointerId;
    const startX = touchHoldStartX;
    const startY = touchHoldStartY;

    clearTouchCopyHold();

    if (!heldCard || pointerId === null) return;
    startTouchCopyDrag(heldCard, pointerId, startX, startY, { mode: 'copy' });
  }, TOUCH_COPY_HOLD_MS);
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

function serializeTrackTitleModesByTrack(trackModesState = trackTitleModesByTrack) {
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
  trackTitleModesByTrack = parseTrackTitleModesByTrack(loadSetting(SETTINGS_KEYS.trackTitleModesByTrack, '{}'));
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
  return normalizeTrackTitleMode(trackTitleModesByTrack.get(fileKey));
}

function getTrackTitleModeForTrack(file, basePath = '/audio') {
  return getTrackTitleModeByKey(trackKey(file, basePath));
}

function keepTrackTitleModesForFiles(files, basePath = '/audio') {
  const normalized = normalizeTrackTitleModesByTrackForFiles(trackTitleModesByTrack, files, basePath);
  if (!trackTitleModesByTrackEqual(trackTitleModesByTrack, normalized)) {
    trackTitleModesByTrack = normalized;
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
  const labels = trackNameLabelsByFile.get(fileKey);
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

  for (const key of trackAttributesByFile.keys()) {
    if (!allowedKeys.has(key)) {
      trackAttributesByFile.delete(key);
    }
  }

  for (const key of trackAttributeLoadPromisesByFile.keys()) {
    if (!allowedKeys.has(key)) {
      trackAttributeLoadPromisesByFile.delete(key);
    }
  }
}

async function loadTrackAttributes(file, basePath = '/audio') {
  const key = trackKey(file, basePath);
  const cached = trackAttributesByFile.get(key);
  if (cached) return cached;

  const pending = trackAttributeLoadPromisesByFile.get(key);
  if (pending) return pending;

  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const fallback = normalizeTrackAttributesPayload(null, file);

  const request = (async () => {
    if (normalizedBase !== '/audio') {
      trackAttributesByFile.set(key, fallback);
      return fallback;
    }

    try {
      const response = await fetch(`/api/audio/attributes?file=${encodeURIComponent(file)}`);
      if (!response.ok) {
        trackAttributesByFile.set(key, fallback);
        return fallback;
      }
      const payload = await response.json().catch(() => null);
      const normalizedAttributes = normalizeTrackAttributesPayload(payload, file);
      trackAttributesByFile.set(key, normalizedAttributes);
      return normalizedAttributes;
    } catch (err) {
      console.error('Не удалось загрузить атрибуты трека', err);
      trackAttributesByFile.set(key, fallback);
      return fallback;
    }
  })();

  trackAttributeLoadPromisesByFile.set(key, request);

  try {
    const attributes = await request;
    if (getTrackTitleModeByKey(key) === TRACK_TITLE_MODE_ATTRIBUTES) {
      refreshTrackNameLabelsByKey(key);
      if (currentTrack && currentTrack.key === key) {
        syncNowPlayingPanel();
      }
      if (isRemoteLiveMirrorRole() && hostPlaybackState && hostPlaybackState.trackFile) {
        const hostTrackKey = trackKey(hostPlaybackState.trackFile, '/audio');
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
    trackAttributeLoadPromisesByFile.delete(key);
  }
}

function getTrackDisplayNameForMode(file, basePath = '/audio', { triggerLoad = true } = {}) {
  const fallback = trackFileDisplayName(file);
  const key = trackKey(file, basePath);
  if (getTrackTitleModeByKey(key) !== TRACK_TITLE_MODE_ATTRIBUTES) {
    return fallback;
  }

  const attributes = trackAttributesByFile.get(key);
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
    trackTitleModesByTrack.set(fileKey, TRACK_TITLE_MODE_ATTRIBUTES);
  } else {
    trackTitleModesByTrack.delete(fileKey);
  }

  if (persist) {
    saveTrackTitleModesByTrackSetting();
  }

  if (changed) {
    refreshTrackNameLabelsByKey(fileKey);
    if (currentTrack && currentTrack.key === fileKey) {
      syncNowPlayingPanel();
    }
    if (isRemoteLiveMirrorRole() && hostPlaybackState && hostPlaybackState.trackFile) {
      const hostTrackKey = trackKey(hostPlaybackState.trackFile, '/audio');
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
    playlistIndex: null,
    playlistPosition: null,
    updatedAt: 0,
    sourceClientId: null,
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

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function waitMs(ms) {
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
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

function setAuthOverlayVisible(visible) {
  if (!authOverlay) return;
  authOverlay.hidden = !visible;
}

function setAuthError(message) {
  if (!authError) return;
  authError.textContent = message || '';
}

async function fetchSessionInfo() {
  const response = await fetch('/api/auth/session');
  if (!response.ok) {
    throw new Error('Не удалось проверить сессию');
  }
  const data = await response.json();
  return {
    authenticated: Boolean(data && data.authenticated),
    isServer: Boolean(data && data.isServer),
    role: data && typeof data.role === 'string' ? data.role : null,
    username: data && typeof data.username === 'string' ? data.username : null,
  };
}

async function login(username, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ username, password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data.error === 'string' ? data.error : 'Ошибка авторизации';
    throw new Error(error);
  }

  return {
    authenticated: Boolean(data && data.authenticated),
    isServer: Boolean(data && data.isServer),
    role: data && typeof data.role === 'string' ? data.role : null,
    username: data && typeof data.username === 'string' ? data.username : null,
  };
}

function normalizeRole(info) {
  if (info && info.role === ROLE_HOST) return ROLE_HOST;
  if (info && info.role === ROLE_COHOST) return ROLE_COHOST;
  if (info && info.role === ROLE_SLAVE) return ROLE_SLAVE;
  if (info && info.isServer) return ROLE_HOST;
  return ROLE_SLAVE;
}

function applyRoleUi(role) {
  const resolvedRole = normalizeRole({ role });
  const previousRole = currentRole;
  currentRole = resolvedRole;
  document.body.dataset.role = resolvedRole;
  applyRuntimeConfigFromSources();

  const isHost = isHostRole(resolvedRole);
  const isCoHost = isCoHostRole(resolvedRole);

  if (!isCoHost) {
    stopCoHostProgressLoop();
    clearQueuedCoHostSeekCommands();
  }

  if (serverPanelEl) {
    serverPanelEl.hidden = !isHost;
  }
  if (clientSessionPanelEl) {
    clientSessionPanelEl.hidden = isHost;
  }
  if (cohostPanelEl) {
    cohostPanelEl.hidden = !isHost;
  }

  if (stopServerBtn) {
    stopServerBtn.hidden = !isHost;
    stopServerBtn.disabled = !isHost;
  }
  if (clientLogoutBtn) {
    clientLogoutBtn.hidden = isHost;
    clientLogoutBtn.disabled = isHost;
  }

  if (serverActionsHintEl) {
    serverActionsHintEl.textContent = HOST_SERVER_HINT;
  }

  if (isCoHost && !isCoHostRole(previousRole)) {
    stopAndClearLocalPlayback();
  }

  if (!isHost) {
    if (isDspTransitionPlaybackActive()) {
      stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
    }
    resetLiveDspNextTrackPreview();
  }

  if (isHost) {
    stopHostProgressLoop();
    requestHostPlaybackSync(true);
  } else {
    stopHostProgressLoop();
    syncNowPlayingPanel();
    syncHostNowPlayingPanel();
  }

  renderCohostUsers();
  updateVolumePresetsUi();
  updateLiveSeekUi();
  updatePrereleaseSettingUi(resolvedRole);
  updateDspSetupUi(resolvedRole);

  if (isHost && (!isHostRole(previousRole) || dspStatusState.checkedAt <= 0)) {
    refreshDspStatus({ announceError: false, userInitiated: false });
  }
}

function updateCurrentUser(info) {
  const username = info && typeof info.username === 'string' ? info.username : null;
  currentUser = username;
  applyRoleUi(normalizeRole(info));

  if (isHostRole()) {
    fetchAuthUsersForHost().catch((err) => {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось загрузить список активных пользователей.');
    });
  }
}

async function ensureAuthorizedUser() {
  let session;
  try {
    session = await fetchSessionInfo();
  } catch (err) {
    console.error(err);
    setStatus('Не удалось проверить авторизацию.');
    return false;
  }

  applyRoleUi(normalizeRole(session));

  if (session.authenticated) {
    updateCurrentUser(session);
    setAuthOverlayVisible(false);
    return true;
  }

  if (!authForm || !authUsernameInput || !authPasswordInput || !authSubmit) {
    setStatus('Не удалось инициализировать форму входа.');
    return false;
  }

  setAuthError('');
  authPasswordInput.value = '';
  setAuthOverlayVisible(true);
  authUsernameInput.focus();

  return new Promise((resolve) => {
    const onSubmit = async (event) => {
      event.preventDefault();
      setAuthError('');
      authSubmit.disabled = true;

      const username = authUsernameInput.value.trim();
      const password = authPasswordInput.value;

      try {
        const loginResult = await login(username, password);
        if (!loginResult.authenticated) {
          throw new Error('Не удалось создать сессию');
        }

        updateCurrentUser(loginResult);
        setAuthOverlayVisible(false);
        authForm.removeEventListener('submit', onSubmit);
        resolve(true);
      } catch (err) {
        console.error(err);
        setAuthError(err.message || 'Ошибка авторизации');
        authSubmit.disabled = false;
      } finally {
        authPasswordInput.value = '';
      }
    };

    authForm.addEventListener('submit', onSubmit);
  });
}

function recoverFromRemoteSessionTermination(message = 'Сессия завершена. Войдите снова.') {
  if (authRecoveryInProgress) return;
  authRecoveryInProgress = true;

  clearLayoutStreamConnection();
  stopHostProgressLoop();
  stopCoHostProgressLoop();
  stopAndClearLocalPlayback();
  currentUser = null;
  authUsersState = [];
  applyRoleUi(ROLE_SLAVE);
  setStatus(message);

  ensureAuthorizedUser()
    .then((authorized) => {
      if (!authorized) return;
      connectLayoutStream();
    })
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      authRecoveryInProgress = false;
    });
}

function normalizeAuthUsersPayload(payload) {
  const users = Array.isArray(payload && payload.users) ? payload.users : [];
  return users
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const username = typeof entry.username === 'string' ? entry.username.trim() : '';
      if (!username) return null;
      const role = entry.role === ROLE_COHOST ? ROLE_COHOST : ROLE_SLAVE;
      const sessionCount = Number.isInteger(entry.sessionCount) && entry.sessionCount > 0 ? entry.sessionCount : 1;
      return { username, role, sessionCount };
    })
    .filter(Boolean)
    .sort((left, right) => left.username.localeCompare(right.username, 'ru'));
}

function applyIncomingAuthUsers(payload, { syncOwnRole = true } = {}) {
  authUsersState = normalizeAuthUsersPayload(payload);
  renderCohostUsers();

  if (!syncOwnRole || !currentUser || isHostRole()) return;

  const selfEntry = authUsersState.find((entry) => entry.username === currentUser);
  if (!selfEntry) {
    recoverFromRemoteSessionTermination('Хост завершил вашу сессию. Войдите снова.');
    return;
  }

  const nextRole = selfEntry && selfEntry.role === ROLE_COHOST ? ROLE_COHOST : ROLE_SLAVE;
  if (nextRole === currentRole) return;

  applyRoleUi(nextRole);
  setStatus(nextRole === ROLE_COHOST ? 'Вам назначена роль co-host.' : 'Роль co-host снята. Вы снова slave.');
}

function renderCohostUsers() {
  if (!cohostUsersEl) return;

  if (!isHostRole()) {
    cohostUsersEl.innerHTML = '';
    return;
  }

  cohostUsersEl.innerHTML = '';
  if (!authUsersState.length) {
    const empty = document.createElement('p');
    empty.className = 'cohost-users__empty';
    empty.textContent = 'Нет активных пользователей.';
    cohostUsersEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  authUsersState.forEach((entry) => {
    const isRoleUpdatePending = cohostRoleUpdatesInFlight.has(entry.username);
    const isDisconnectPending = cohostDisconnectUpdatesInFlight.has(entry.username);

    const row = document.createElement('div');
    row.className = 'cohost-user';
    if (isDisconnectPending) {
      row.classList.add('is-disconnect-pending');
    }

    const identity = document.createElement('div');
    identity.className = 'cohost-user__identity';

    const name = document.createElement('span');
    name.className = 'cohost-user__name';
    name.textContent = entry.username;

    const meta = document.createElement('span');
    meta.className = 'cohost-user__meta';
    meta.textContent = entry.sessionCount > 1 ? `Сессий: ${entry.sessionCount}` : '1 сессия';
    identity.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'cohost-user__actions';

    const disconnectBtn = document.createElement('button');
    disconnectBtn.type = 'button';
    disconnectBtn.className = 'cohost-disconnect-btn';
    disconnectBtn.textContent = '⨯';
    disconnectBtn.title = 'Отключить все сессии пользователя';
    disconnectBtn.setAttribute('aria-label', `Отключить пользователя ${entry.username}`);
    disconnectBtn.disabled = isRoleUpdatePending || isDisconnectPending;
    disconnectBtn.addEventListener('click', () => {
      disconnectClientSessions(entry.username);
    });

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'cohost-role-switch';
    toggle.checked = entry.role === ROLE_COHOST;
    toggle.disabled = isRoleUpdatePending || isDisconnectPending;
    toggle.title = toggle.checked ? 'Снять роль co-host' : 'Назначить роль co-host';
    toggle.setAttribute('aria-label', `Роль co-host для ${entry.username}`);
    toggle.addEventListener('change', () => {
      const nextRole = toggle.checked ? ROLE_COHOST : ROLE_SLAVE;
      updateCoHostRole(entry.username, nextRole, toggle);
    });

    actions.append(disconnectBtn, toggle);
    row.append(identity, actions);
    fragment.appendChild(row);
  });

  cohostUsersEl.appendChild(fragment);
}

async function fetchAuthUsersForHost() {
  if (!isHostRole()) return;

  const response = await fetch('/api/auth/clients');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось загрузить список активных пользователей');
  }

  applyIncomingAuthUsers(data, { syncOwnRole: false });
}

async function updateCoHostRole(username, role, toggleInput = null) {
  if (!isHostRole()) return;
  const normalizedRole = role === ROLE_COHOST ? ROLE_COHOST : ROLE_SLAVE;
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!normalizedUsername) return;

  cohostRoleUpdatesInFlight.add(normalizedUsername);
  renderCohostUsers();

  try {
    const response = await fetch('/api/auth/clients/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        username: normalizedUsername,
        role: normalizedRole,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && (data.error || data.message);
      throw new Error(message || 'Не удалось изменить роль пользователя');
    }

    applyIncomingAuthUsers(data, { syncOwnRole: false });
    setStatus(
      normalizedRole === ROLE_COHOST
        ? `Пользователь ${normalizedUsername} назначен co-host.`
        : `Роль co-host у ${normalizedUsername} снята.`,
    );
  } catch (err) {
    if (toggleInput) {
      toggleInput.checked = normalizedRole !== ROLE_COHOST;
    }
    setStatus(err && err.message ? err.message : 'Не удалось обновить роль co-host.');
  } finally {
    cohostRoleUpdatesInFlight.delete(normalizedUsername);
    renderCohostUsers();
  }
}

async function disconnectClientSessions(username) {
  if (!isHostRole()) return;

  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!normalizedUsername) return;

  const confirmed = window.confirm(`Отключить ${normalizedUsername}? Будут завершены все его сессии.`);
  if (!confirmed) {
    setStatus('Отключение клиента отменено.');
    return;
  }

  cohostDisconnectUpdatesInFlight.add(normalizedUsername);
  renderCohostUsers();

  try {
    const response = await fetch('/api/auth/clients/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        username: normalizedUsername,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && (data.error || data.message);
      throw new Error(message || 'Не удалось отключить пользователя');
    }

    applyIncomingAuthUsers(data, { syncOwnRole: false });
    const removedSessions =
      data &&
      data.disconnected &&
      Number.isInteger(data.disconnected.removedSessions) &&
      data.disconnected.removedSessions > 0
        ? data.disconnected.removedSessions
        : null;
    setStatus(
      removedSessions
        ? `Пользователь ${normalizedUsername} отключен (${removedSessions} сесс.).`
        : `Пользователь ${normalizedUsername} отключен.`,
    );
  } catch (err) {
    setStatus(err && err.message ? err.message : 'Не удалось отключить пользователя.');
  } finally {
    cohostDisconnectUpdatesInFlight.delete(normalizedUsername);
    renderCohostUsers();
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

function formatDuration(seconds, { useCeil = false } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const rounded = useCeil ? Math.ceil(seconds) : Math.floor(seconds);
  const totalSeconds = Math.max(0, rounded);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
}

function normalizePlaylistTrackIndex(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
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
    playlistIndex: normalized.playlistIndex,
    playlistPosition: normalized.playlistPosition,
    updatedAt: normalized.updatedAt,
  });
}

function getKnownDurationSeconds(fileKey) {
  const value = knownTrackDurations.get(fileKey);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function getCurrentTrackRemainingSeconds() {
  if (!currentTrack || !currentAudio) return null;
  const duration = getDuration(currentAudio);
  if (!duration) {
    return getKnownDurationSeconds(currentTrack.key);
  }

  const currentTime = Number.isFinite(currentAudio.currentTime) ? currentAudio.currentTime : 0;
  return Math.max(0, duration - Math.max(0, currentTime));
}

function getHostPlaybackElapsedSeconds() {
  if (!hostPlaybackState || !hostPlaybackState.trackFile) return 0;

  const baseElapsed =
    Number.isFinite(hostPlaybackState.currentTime) && hostPlaybackState.currentTime >= 0 ? hostPlaybackState.currentTime : 0;

  if (hostPlaybackState.paused) {
    return baseElapsed;
  }

  const deltaSeconds = Math.max(0, Date.now() - hostPlaybackState.updatedAt) / 1000;
  const elapsed = baseElapsed + deltaSeconds;

  if (Number.isFinite(hostPlaybackState.duration) && hostPlaybackState.duration > 0) {
    return Math.min(elapsed, hostPlaybackState.duration);
  }

  return elapsed;
}

function stopHostProgressLoop() {
  if (hostProgressRaf === null) return;
  cancelAnimationFrame(hostProgressRaf);
  hostProgressRaf = null;
}

function startHostProgressLoop() {
  if (hostProgressRaf !== null) return;
  const tick = () => {
    if (hostProgressRaf === null) return;
    syncHostNowPlayingPanel();
    if (hostProgressRaf === null) return;
    hostProgressRaf = requestAnimationFrame(tick);
  };
  hostProgressRaf = requestAnimationFrame(tick);
}

function clearHostTrackHighlight() {
  for (const cards of cardsByFile.values()) {
    if (!cards || !cards.size) continue;
    for (const card of cards) {
      card.classList.remove('is-host-playing', 'is-host-paused');
    }
  }
}

function clearLiveDspNextTrackHighlight() {
  for (const cards of cardsByFile.values()) {
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

function syncLiveDspNextTrackHighlight() {
  clearLiveDspNextTrackHighlight();
}

function resetLiveDspNextTrackPreview() {
  liveDspRenderToken += 1;
  liveDspNextReadyDescriptor = '';
  liveDspNextReadySliceSeconds = null;
  clearLiveDspContinuationWarmups();
  syncLiveDspNextTrackHighlight();
}

function isDspTransitionPlaybackActive() {
  return Boolean(dspTransitionPlayback && dspTransitionPlayback.audio);
}

function clearDspTransitionTrackHighlight() {
  for (const cards of cardsByFile.values()) {
    if (!cards || !cards.size) continue;
    for (const card of cards) {
      card.classList.remove('is-dsp-transition-source', 'is-dsp-transition-target');
    }
  }
}

function syncDspTransitionTrackHighlight() {
  clearDspTransitionTrackHighlight();
  if (!isDspTransitionPlaybackActive()) return;

  const sourceTrack = dspTransitionPlayback.fromTrack || null;
  const targetTrack = dspTransitionPlayback.toTrack || null;

  if (sourceTrack && sourceTrack.key) {
    const sourceCard = getTrackCardByContext(sourceTrack.key, sourceTrack);
    if (sourceCard) {
      sourceCard.classList.add('is-dsp-transition-source');
    }
  }

  if (targetTrack && targetTrack.key) {
    const targetCard = getTrackCardByContext(targetTrack.key, targetTrack);
    if (targetCard) {
      targetCard.classList.add('is-dsp-transition-target');
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
  if (!dspTransitionPlayback) return;

  const activePlayback = dspTransitionPlayback;
  dspTransitionPlayback = null;
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
  if (!hostPlaybackState || !hostPlaybackState.trackFile) return 'none';

  const playlistIndex = normalizePlaylistTrackIndex(hostPlaybackState.playlistIndex);
  const playlistPosition = normalizePlaylistTrackIndex(hostPlaybackState.playlistPosition);
  return [
    trackKey(hostPlaybackState.trackFile, '/audio'),
    playlistIndex === null ? '' : String(playlistIndex),
    playlistPosition === null ? '' : String(playlistPosition),
    hostPlaybackState.paused ? 'paused' : 'playing',
  ].join('|');
}

function syncHostTrackHighlight(force = false) {
  const descriptor = buildHostTrackHighlightDescriptor();
  if (!force && descriptor === hostHighlightedDescriptor) return;
  hostHighlightedDescriptor = descriptor;

  clearHostTrackHighlight();
  if (descriptor === 'none') return;

  const playbackContext = {
    playlistIndex: normalizePlaylistTrackIndex(hostPlaybackState.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(hostPlaybackState.playlistPosition),
  };
  const hostTrackKey = trackKey(hostPlaybackState.trackFile, '/audio');
  const targetCard = getTrackCardByContext(hostTrackKey, playbackContext);
  if (!targetCard) return;

  if (hostPlaybackState.paused) {
    targetCard.classList.add('is-host-paused');
    targetCard.classList.remove('is-host-playing');
    return;
  }

  targetCard.classList.add('is-host-playing');
  targetCard.classList.remove('is-host-paused');
}

function syncHostNowPlayingPanel() {
  if (!hostNowPlayingTitleEl || !hostNowPlayingControlLabelEl) return;

  if (!isSlaveRole()) {
    stopHostProgressLoop();
    setHostNowPlayingReelActive(false);
    syncHostTrackHighlight();
    return;
  }

  if (!hostPlaybackState || !hostPlaybackState.trackFile) {
    hostNowPlayingTitleEl.textContent = HOST_NOW_PLAYING_IDLE_TITLE;
    hostNowPlayingControlLabelEl.textContent = '▶';
    setHostNowPlayingReelActive(false);
    setHostNowPlayingProgress(0);
    setHostNowPlayingTime(null);
    stopHostProgressLoop();
    syncHostTrackHighlight();
    return;
  }

  hostNowPlayingTitleEl.textContent = `Live: ${trackDisplayName(hostPlaybackState.trackFile)}`;
  hostNowPlayingControlLabelEl.textContent = hostPlaybackState.paused ? '▶' : '❚❚';
  setHostNowPlayingReelActive(true, hostPlaybackState.paused);

  const elapsed = getHostPlaybackElapsedSeconds();
  const duration = Number.isFinite(hostPlaybackState.duration) && hostPlaybackState.duration > 0 ? hostPlaybackState.duration : null;
  const progressPercent = duration ? Math.min(100, (elapsed / duration) * 100) : 0;
  const remaining = duration ? Math.max(0, duration - elapsed) : null;

  setHostNowPlayingProgress(progressPercent);
  setHostNowPlayingTime(remaining, { useCeil: true });
  syncHostTrackHighlight();

  if (!hostPlaybackState.paused && duration && remaining > 0) {
    startHostProgressLoop();
  } else {
    stopHostProgressLoop();
  }
}

function getTrackDurationTextByKey(fileKey) {
  const isCurrent = Boolean(currentTrack && currentAudio && currentTrack.key === fileKey);

  if (isCurrent) {
    const remaining = getCurrentTrackRemainingSeconds();
    return formatDuration(remaining, { useCeil: true });
  }

  const isCoHostCurrent =
    isCoHostRole() && hostPlaybackState && typeof hostPlaybackState.trackFile === 'string' && hostPlaybackState.trackFile.trim()
      ? trackKey(hostPlaybackState.trackFile, '/audio') === fileKey
      : false;
  if (isCoHostCurrent) {
    const knownDuration = getKnownDurationSeconds(fileKey);
    const duration =
      Number.isFinite(hostPlaybackState.duration) && hostPlaybackState.duration > 0 ? hostPlaybackState.duration : knownDuration;
    if (Number.isFinite(duration) && duration > 0) {
      const remaining = Math.max(0, duration - getHostPlaybackElapsedSeconds());
      return formatDuration(remaining, { useCeil: true });
    }
  }

  return formatDuration(getKnownDurationSeconds(fileKey), { useCeil: false });
}

function refreshTrackDurationLabels(fileKey) {
  if (!fileKey) return;
  const labels = durationLabelsByFile.get(fileKey);
  if (!labels || !labels.size) return;

  const text = getTrackDurationTextByKey(fileKey);
  for (const label of labels) {
    label.textContent = text;
  }
}

function cacheTrackDuration(fileKey, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

  const previous = knownTrackDurations.get(fileKey);
  if (Number.isFinite(previous) && Math.abs(previous - durationSeconds) < 0.05) return;

  knownTrackDurations.set(fileKey, durationSeconds);
  refreshTrackDurationLabels(fileKey);

  if (currentTrack && currentTrack.key === fileKey) {
    syncNowPlayingPanel();
  }
}

function loadTrackDurationMetadata(file, basePath = '/audio') {
  const key = trackKey(file, basePath);
  const cached = getKnownDurationSeconds(key);
  if (cached !== null) return Promise.resolve(cached);

  const pending = durationLoadPromises.get(key);
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
      durationLoadPromises.delete(key);
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

  durationLoadPromises.set(key, request);
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

  for (const key of knownTrackDurations.keys()) {
    if (!allowedKeys.has(key)) {
      knownTrackDurations.delete(key);
    }
  }
}

function stopAndClearLocalPlayback() {
  if (isDspTransitionPlaybackActive()) {
    stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
  }

  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch (err) {
      // ignore audio pause errors during role switch
    }
  }

  if (currentTrack) {
    setButtonPlaying(currentTrack.key, false, currentTrack);
    setTrackPaused(currentTrack.key, false, currentTrack);
    resetProgress(currentTrack.key);
  }

  resetFadeState();
  stopProgressLoop();
  currentAudio = null;
  currentTrack = null;
  resetLiveDspNextTrackPreview();
  syncNowPlayingPanel();
}

function stopCoHostProgressLoop() {
  if (cohostProgressRaf === null) return;
  cancelAnimationFrame(cohostProgressRaf);
  cohostProgressRaf = null;
}

function startCoHostProgressLoop() {
  if (cohostProgressRaf !== null) return;
  const tick = () => {
    if (cohostProgressRaf === null) return;
    syncNowPlayingPanel();
    if (cohostProgressRaf === null) return;
    cohostProgressRaf = requestAnimationFrame(tick);
  };
  cohostProgressRaf = requestAnimationFrame(tick);
}

function syncNowPlayingPanelForCoHost() {
  if (!nowPlayingTitleEl || !nowPlayingControlBtn || !nowPlayingControlLabelEl) return;

  const hostTrackFile =
    hostPlaybackState && typeof hostPlaybackState.trackFile === 'string' ? hostPlaybackState.trackFile.trim() : '';
  if (!hostTrackFile) {
    if (nowPlayingSeekActive) {
      cleanupNowPlayingSeekInteraction();
    }
    nowPlayingTitleEl.textContent = HOST_NOW_PLAYING_IDLE_TITLE;
    nowPlayingControlLabelEl.textContent = '▶';
    nowPlayingControlBtn.disabled = true;
    setNowPlayingReelActive(false);
    setNowPlayingProgress(0);
    setNowPlayingTime(null);
    stopCoHostProgressLoop();
    return;
  }

  nowPlayingTitleEl.textContent = `Live: ${trackDisplayName(hostTrackFile)}`;
  nowPlayingControlBtn.disabled = false;
  nowPlayingControlLabelEl.textContent = hostPlaybackState.paused ? '▶' : '❚❚';
  setNowPlayingReelActive(true, hostPlaybackState.paused);

  const elapsed = getHostPlaybackElapsedSeconds();
  const duration = Number.isFinite(hostPlaybackState.duration) && hostPlaybackState.duration > 0 ? hostPlaybackState.duration : null;
  const progressPercent = duration ? Math.min(100, (elapsed / duration) * 100) : 0;
  const remaining = duration ? Math.max(0, duration - elapsed) : null;

  setNowPlayingProgress(progressPercent);
  setNowPlayingTime(remaining, { useCeil: true });

  if (!hostPlaybackState.paused && duration && remaining > 0) {
    startCoHostProgressLoop();
  } else {
    stopCoHostProgressLoop();
  }
}

function syncNowPlayingPanel() {
  if (!nowPlayingTitleEl || !nowPlayingControlBtn || !nowPlayingControlLabelEl) return;

  if (isCoHostRole()) {
    setDspTransitionReelReverse(false);
    const hostTrackKey =
      hostPlaybackState && typeof hostPlaybackState.trackFile === 'string' && hostPlaybackState.trackFile.trim()
        ? trackKey(hostPlaybackState.trackFile, '/audio')
        : null;
    if (activeDurationTrackKey && activeDurationTrackKey !== hostTrackKey) {
      refreshTrackDurationLabels(activeDurationTrackKey);
    }
    activeDurationTrackKey = hostTrackKey;
    syncNowPlayingPanelForCoHost();
    if (hostTrackKey) {
      refreshTrackDurationLabels(hostTrackKey);
    }
    return;
  }

  if (isDspTransitionPlaybackActive()) {
    const playback = dspTransitionPlayback;
    const transitionAudio = playback && playback.audio ? playback.audio : null;
    const sourceTrack = playback && playback.fromTrack ? playback.fromTrack : null;
    const targetTrack = playback && playback.toTrack ? playback.toTrack : null;

    nowPlayingTitleEl.textContent =
      sourceTrack && targetTrack
        ? `Переход: ${trackDisplayName(sourceTrack.file)} -> ${trackDisplayName(targetTrack.file)}`
        : 'Переход...';
    nowPlayingControlLabelEl.textContent = '❚❚';
    setNowPlayingReelActive(true, false);
    setDspTransitionReelReverse(true);

    const activeDuration = getDspTransitionDurationSeconds();
    const currentTime =
      transitionAudio && Number.isFinite(transitionAudio.currentTime) && transitionAudio.currentTime >= 0
        ? transitionAudio.currentTime
        : 0;
    const progressPercent = activeDuration ? Math.min(100, (currentTime / activeDuration) * 100) : 0;
    const remaining = activeDuration ? Math.max(0, activeDuration - currentTime) : null;

    nowPlayingControlBtn.disabled = !canSeekNowPlaying();
    setNowPlayingProgress(progressPercent);
    setNowPlayingTime(remaining, { useCeil: true });
    return;
  }

  setDspTransitionReelReverse(false);

  const nextActiveKey = currentTrack && currentAudio ? currentTrack.key : null;
  if (activeDurationTrackKey && activeDurationTrackKey !== nextActiveKey) {
    refreshTrackDurationLabels(activeDurationTrackKey);
  }
  activeDurationTrackKey = nextActiveKey;

  if (!currentTrack || !currentAudio) {
    if (nowPlayingSeekActive) {
      cleanupNowPlayingSeekInteraction();
    }
    nowPlayingTitleEl.textContent = NOW_PLAYING_IDLE_TITLE;
    nowPlayingControlLabelEl.textContent = '▶';
    nowPlayingControlBtn.disabled = true;
    setNowPlayingReelActive(false);
    setNowPlayingProgress(0);
    setNowPlayingTime(null);
    requestHostPlaybackSync(false);
    return;
  }

  nowPlayingTitleEl.textContent = trackDisplayName(currentTrack.file);
  nowPlayingControlBtn.disabled = false;
  nowPlayingControlLabelEl.textContent = currentAudio.paused ? '▶' : '❚❚';
  setNowPlayingReelActive(true, currentAudio.paused);
  setNowPlayingTime(getCurrentTrackRemainingSeconds(), { useCeil: true });
  refreshTrackDurationLabels(currentTrack.key);
  requestHostPlaybackSync(false);
}

function getCurrentTrackDurationSeconds() {
  if (!currentTrack || !currentAudio) return null;
  return getDuration(currentAudio) || getKnownDurationSeconds(currentTrack.key);
}

function getHostPlaybackDurationSeconds() {
  const duration = Number(hostPlaybackState && hostPlaybackState.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return duration;
}

function getDspTransitionDurationSeconds() {
  if (!isDspTransitionPlaybackActive()) return null;
  const playback = dspTransitionPlayback;
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

  const playback = dspTransitionPlayback;
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

function canSeekNowPlaying() {
  if (isSlaveRole()) {
    if (!currentTrack || !currentAudio) return false;
    const duration = getCurrentTrackDurationSeconds();
    return Boolean(Number.isFinite(duration) && duration > 0);
  }

  if (isHostRole()) {
    if (!liveSeekEnabled) return false;
    if (isDspTransitionPlaybackActive()) {
      const transitionDuration = getDspTransitionDurationSeconds();
      return Boolean(Number.isFinite(transitionDuration) && transitionDuration > 0);
    }
    if (!currentTrack || !currentAudio) return false;
    const duration = getCurrentTrackDurationSeconds();
    return Boolean(Number.isFinite(duration) && duration > 0);
  }

  if (isCoHostRole()) {
    if (!liveSeekEnabled) return false;
    const hasHostTrack = Boolean(
      hostPlaybackState &&
        typeof hostPlaybackState.trackFile === 'string' &&
        hostPlaybackState.trackFile.trim(),
    );
    if (!hasHostTrack) return false;
    const duration = getHostPlaybackDurationSeconds();
    return Boolean(Number.isFinite(duration) && duration > 0);
  }

  return false;
}

function resolveNowPlayingSeekRatioFromClientX(clientX) {
  if (!nowPlayingControlBtn || !Number.isFinite(clientX)) return null;
  const rect = nowPlayingControlBtn.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width <= 0) return null;
  const ratio = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(1, ratio));
}

function isNowPlayingToggleZone(clientX, clientY) {
  if (!nowPlayingControlBtn || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const rect = nowPlayingControlBtn.getBoundingClientRect();
  if (clientY < rect.top || clientY > rect.bottom) return false;
  const centerX = rect.left + rect.width / 2;
  return Math.abs(clientX - centerX) <= NOW_PLAYING_TOGGLE_ZONE_HALF_WIDTH_PX;
}

function setNowPlayingReelScrubSpeed(speedPxPerSecond) {
  if (!nowPlayingControlBtn) return;
  const safeSpeed = Number.isFinite(speedPxPerSecond) ? Math.max(0, speedPxPerSecond) : 0;
  const ratio = Math.min(1, safeSpeed / NOW_PLAYING_REEL_MAX_SCRUB_SPEED_PX_PER_SEC);
  const durationSeconds =
    NOW_PLAYING_REEL_BASE_SPIN_SECONDS -
    ratio * (NOW_PLAYING_REEL_BASE_SPIN_SECONDS - NOW_PLAYING_REEL_FAST_SPIN_SECONDS);
  nowPlayingControlBtn.style.setProperty('--reel-spin-inline-duration', `${durationSeconds.toFixed(3)}s`);
}

function resetNowPlayingReelScrubSpeed() {
  if (!nowPlayingControlBtn) return;
  nowPlayingControlBtn.style.removeProperty('--reel-spin-inline-duration');
}

function updateNowPlayingReelScrubSpeed(clientX, timestampMs) {
  if (!Number.isFinite(clientX) || !Number.isFinite(timestampMs)) return;
  if (!Number.isFinite(nowPlayingSeekLastAt) || nowPlayingSeekLastAt <= 0) {
    nowPlayingSeekLastX = clientX;
    nowPlayingSeekLastAt = timestampMs;
    return;
  }

  const deltaMs = timestampMs - nowPlayingSeekLastAt;
  const deltaPx = Math.abs(clientX - nowPlayingSeekLastX);
  nowPlayingSeekLastX = clientX;
  nowPlayingSeekLastAt = timestampMs;

  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  const instantSpeed = (deltaPx * 1000) / deltaMs;
  nowPlayingSeekSmoothedSpeed =
    nowPlayingSeekSmoothedSpeed > 0 ? nowPlayingSeekSmoothedSpeed * 0.65 + instantSpeed * 0.35 : instantSpeed;
  setNowPlayingReelScrubSpeed(nowPlayingSeekSmoothedSpeed);
}

function applyNowPlayingSeekFromClientX(clientX, { finalize = false } = {}) {
  if (!canSeekNowPlaying()) return false;
  const ratio = resolveNowPlayingSeekRatioFromClientX(clientX);
  if (ratio === null) return false;

  if (isCoHostRole()) {
    const duration = getHostPlaybackDurationSeconds();
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const nextTime = Math.max(0, Math.min(duration, ratio * duration));

    hostPlaybackState = {
      ...hostPlaybackState,
      currentTime: nextTime,
      updatedAt: Date.now(),
    };
    syncNowPlayingPanel();
    queueCoHostSeekCurrentPlayback(ratio, { immediate: Boolean(finalize), finalize: Boolean(finalize) });
    return true;
  }

  if (isHostRole() && isDspTransitionPlaybackActive()) {
    return seekDspTransitionPlaybackByRatio(ratio);
  }

  if (!currentTrack || !currentAudio) return false;

  const duration = getCurrentTrackDurationSeconds();
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const nextTime = Math.max(0, Math.min(duration, ratio * duration));

  try {
    if (typeof currentAudio.fastSeek === 'function') {
      currentAudio.fastSeek(nextTime);
    } else {
      currentAudio.currentTime = nextTime;
    }
  } catch (err) {
    try {
      currentAudio.currentTime = nextTime;
    } catch (fallbackErr) {
      return false;
    }
  }

  updateProgress(currentTrack.key, nextTime, duration);
  syncNowPlayingPanel();
  if (isHostRole()) {
    requestHostLiveSeekSync({ finalize: Boolean(finalize) });
  }
  return true;
}

function cleanupNowPlayingSeekInteraction() {
  if (nowPlayingControlBtn) {
    nowPlayingControlBtn.classList.remove('is-seeking');
    if (nowPlayingSeekPointerId !== null && typeof nowPlayingControlBtn.releasePointerCapture === 'function') {
      try {
        if (nowPlayingControlBtn.hasPointerCapture && nowPlayingControlBtn.hasPointerCapture(nowPlayingSeekPointerId)) {
          nowPlayingControlBtn.releasePointerCapture(nowPlayingSeekPointerId);
        }
      } catch (err) {
        // ignore pointer capture release errors
      }
    }
  }
  resetNowPlayingReelScrubSpeed();

  nowPlayingSeekActive = false;
  nowPlayingSeekMoved = false;
  nowPlayingSeekPointerId = null;
  nowPlayingSeekStartX = 0;
  nowPlayingSeekLastX = 0;
  nowPlayingSeekLastAt = 0;
  nowPlayingSeekSmoothedSpeed = 0;
  window.removeEventListener('pointermove', onNowPlayingSeekPointerMove, true);
  window.removeEventListener('pointerup', onNowPlayingSeekPointerUp, true);
  window.removeEventListener('pointercancel', onNowPlayingSeekPointerCancel, true);
}

function onNowPlayingSeekPointerMove(event) {
  if (!nowPlayingSeekActive || event.pointerId !== nowPlayingSeekPointerId) return;
  const threshold = event.pointerType === 'touch' ? 2 : NOW_PLAYING_SEEK_DRAG_THRESHOLD_PX;
  const distance = Math.abs(event.clientX - nowPlayingSeekStartX);
  if (!nowPlayingSeekMoved && distance < threshold) return;
  nowPlayingSeekMoved = true;
  if (nowPlayingControlBtn) {
    nowPlayingControlBtn.classList.add('is-seeking');
  }
  event.preventDefault();
  updateNowPlayingReelScrubSpeed(
    event.clientX,
    Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(),
  );
  applyNowPlayingSeekFromClientX(event.clientX, { finalize: false });
}

function onNowPlayingSeekPointerUp(event) {
  if (!nowPlayingSeekActive || event.pointerId !== nowPlayingSeekPointerId) return;

  if (nowPlayingSeekMoved) {
    event.preventDefault();
    applyNowPlayingSeekFromClientX(event.clientX, { finalize: true });
    nowPlayingSeekSuppressClickUntil = Date.now() + NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS;
  } else if (
    event.pointerType === 'touch' &&
    !isNowPlayingToggleZone(event.clientX, event.clientY) &&
    applyNowPlayingSeekFromClientX(event.clientX, { finalize: true })
  ) {
    // Touch tap outside the center toggle zone seeks immediately.
    nowPlayingSeekSuppressClickUntil = Date.now() + NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS;
  }

  cleanupNowPlayingSeekInteraction();
}

function onNowPlayingSeekPointerCancel(event) {
  if (!nowPlayingSeekActive || event.pointerId !== nowPlayingSeekPointerId) return;
  cleanupNowPlayingSeekInteraction();
}

function onNowPlayingControlPointerDown(event) {
  if (!nowPlayingControlBtn) return;
  if (!canSeekNowPlaying()) return;
  if (!event.isPrimary) return;
  if (event.button !== undefined && event.button !== 0) return;
  if (nowPlayingSeekActive) {
    cleanupNowPlayingSeekInteraction();
  }

  nowPlayingSeekActive = true;
  nowPlayingSeekMoved = false;
  nowPlayingSeekPointerId = event.pointerId;
  nowPlayingSeekStartX = event.clientX;
  nowPlayingSeekLastX = event.clientX;
  nowPlayingSeekLastAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  nowPlayingSeekSmoothedSpeed = 0;
  setNowPlayingReelScrubSpeed(0);

  if (typeof nowPlayingControlBtn.setPointerCapture === 'function') {
    try {
      nowPlayingControlBtn.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors
    }
  }

  window.addEventListener('pointermove', onNowPlayingSeekPointerMove, true);
  window.addEventListener('pointerup', onNowPlayingSeekPointerUp, true);
  window.addEventListener('pointercancel', onNowPlayingSeekPointerCancel, true);
}

function onNowPlayingControlClick(event) {
  if (Date.now() < nowPlayingSeekSuppressClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  toggleNowPlayingPlayback();
}

function canPanZonesContainer() {
  if (!zonesContainer) return false;
  return zonesContainer.scrollWidth - zonesContainer.clientWidth > 1;
}

function stopZonesPanMomentum() {
  if (zonesPanMomentumRaf === null) return;
  cancelAnimationFrame(zonesPanMomentumRaf);
  zonesPanMomentumRaf = null;
}

function stopZonesWheelSmoothScroll() {
  if (zonesWheelSmoothRaf !== null) {
    cancelAnimationFrame(zonesWheelSmoothRaf);
    zonesWheelSmoothRaf = null;
  }
  zonesWheelTargets.clear();
}

function runZonesWheelSmoothStep() {
  zonesWheelSmoothRaf = null;
  if (!zonesContainer || !zonesWheelTargets.size) {
    zonesWheelTargets.clear();
    return;
  }

  let hasPending = false;
  const activeBodies = new Set(getZoneBodies());

  for (const [body, targetValue] of zonesWheelTargets.entries()) {
    if (!(body instanceof HTMLElement) || !activeBodies.has(body)) {
      zonesWheelTargets.delete(body);
      continue;
    }

    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const target = Math.max(0, Math.min(maxScrollTop, Number.isFinite(targetValue) ? targetValue : body.scrollTop));
    const current = body.scrollTop;
    const delta = target - current;

    if (Math.abs(delta) <= ZONES_WHEEL_SMOOTH_MIN_DELTA_PX) {
      body.scrollTop = target;
      zonesWheelTargets.delete(body);
      continue;
    }

    body.scrollTop = current + delta * ZONES_WHEEL_SMOOTH_EASE;
    zonesWheelTargets.set(body, target);
    hasPending = true;
  }

  if (hasPending && zonesWheelTargets.size) {
    zonesWheelSmoothRaf = requestAnimationFrame(runZonesWheelSmoothStep);
  }
}

function scheduleZonesWheelSmoothScroll() {
  if (zonesWheelSmoothRaf !== null) return;
  zonesWheelSmoothRaf = requestAnimationFrame(runZonesWheelSmoothStep);
}

function startZonesPanMomentum(initialVelocityPxPerMs) {
  if (!zonesContainer) return;
  stopZonesPanMomentum();

  let velocity = Number.isFinite(initialVelocityPxPerMs) ? initialVelocityPxPerMs : 0;
  if (Math.abs(velocity) < ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) return;

  let previousTimestamp = performance.now();

  const step = (timestamp) => {
    if (!zonesContainer) {
      zonesPanMomentumRaf = null;
      return;
    }

    const deltaMs = Math.max(1, timestamp - previousTimestamp);
    previousTimestamp = timestamp;

    const maxScrollLeft = Math.max(0, zonesContainer.scrollWidth - zonesContainer.clientWidth);
    if (maxScrollLeft <= 0) {
      zonesPanMomentumRaf = null;
      return;
    }

    const previousScrollLeft = zonesContainer.scrollLeft;
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, previousScrollLeft + velocity * deltaMs));
    zonesContainer.scrollLeft = nextScrollLeft;

    const hitBoundary = Math.abs(nextScrollLeft - previousScrollLeft) < 0.01;
    if (hitBoundary) {
      zonesPanMomentumRaf = null;
      return;
    }

    const decay = Math.pow(ZONES_PAN_TOUCH_MOMENTUM_DECAY_PER_FRAME, deltaMs / 16);
    velocity *= decay;

    if (Math.abs(velocity) < ZONES_PAN_TOUCH_MOMENTUM_STOP_SPEED_PX_PER_MS) {
      zonesPanMomentumRaf = null;
      return;
    }

    zonesPanMomentumRaf = requestAnimationFrame(step);
  };

  zonesPanMomentumRaf = requestAnimationFrame(step);
}

function getZoneBodies() {
  if (!zonesContainer) return [];
  return Array.from(zonesContainer.querySelectorAll('.zone-body'));
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
      const previousTarget = zonesWheelTargets.has(body) ? zonesWheelTargets.get(body) : body.scrollTop;
      const nextTarget = Math.max(0, Math.min(maxScrollTop, previousTarget + deltaY));
      if (Math.abs(nextTarget - previousTarget) < 0.01 && Math.abs(nextTarget - body.scrollTop) < 0.01) continue;
      zonesWheelTargets.set(body, nextTarget);
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
  if (draggingCard || touchCopyDragActive) return;

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

function cleanupZonesTouchPanInteraction() {
  if (zonesContainer) {
    zonesContainer.classList.remove('is-pan-scrolling');
  }

  zonesTouchPanActive = false;
  zonesTouchPanMoved = false;
  zonesTouchPanStartMidX = 0;
  zonesTouchPanStartMidY = 0;
  zonesTouchPanStartScrollLeft = 0;
  zonesTouchPanLastMidX = 0;
  zonesTouchPanLastAt = 0;
  zonesTouchPanVelocityX = 0;
}

function onZonesTouchStart(event) {
  if (!zonesContainer) return;
  if (!event || !event.touches) return;
  if (!canPanZonesContainer()) return;
  if (draggingCard || touchCopyDragActive) return;
  if (event.touches.length !== 2) return;

  const target = event.target instanceof Element ? event.target : null;
  if (!isZonesPanFreeAreaTarget(target)) return;

  const midpoint = getTouchMidpoint(event.touches);
  if (!midpoint) return;

  stopZonesPanMomentum();
  stopZonesWheelSmoothScroll();
  cleanupZonesTouchPanInteraction();

  zonesTouchPanActive = true;
  zonesTouchPanMoved = false;
  zonesTouchPanStartMidX = midpoint.x;
  zonesTouchPanStartMidY = midpoint.y;
  zonesTouchPanStartScrollLeft = zonesContainer.scrollLeft;
  zonesTouchPanLastMidX = midpoint.x;
  zonesTouchPanLastAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  zonesTouchPanVelocityX = 0;
  event.preventDefault();
}

function onZonesTouchMove(event) {
  if (!zonesTouchPanActive || !event || !event.touches) return;
  if (!zonesContainer) return;

  if (event.touches.length < 2) {
    const momentumVelocity = zonesTouchPanMoved ? -zonesTouchPanVelocityX * ZONES_PAN_TOUCH_GAIN : 0;
    cleanupZonesTouchPanInteraction();
    if (Math.abs(momentumVelocity) >= ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) {
      startZonesPanMomentum(momentumVelocity);
    }
    return;
  }

  const midpoint = getTouchMidpoint(event.touches);
  if (!midpoint) return;

  const nowTimestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const sampleDeltaMs = nowTimestamp - zonesTouchPanLastAt;
  if (Number.isFinite(sampleDeltaMs) && sampleDeltaMs > 0) {
    const sampleVelocityX = (midpoint.x - zonesTouchPanLastMidX) / sampleDeltaMs;
    zonesTouchPanVelocityX = zonesTouchPanVelocityX * 0.7 + sampleVelocityX * 0.3;
  }
  zonesTouchPanLastMidX = midpoint.x;
  zonesTouchPanLastAt = nowTimestamp;

  const deltaX = midpoint.x - zonesTouchPanStartMidX;
  const deltaY = midpoint.y - zonesTouchPanStartMidY;

  if (!zonesTouchPanMoved) {
    const dragThreshold = 2;
    if (Math.abs(deltaX) < dragThreshold && Math.abs(deltaY) < dragThreshold) return;
    const verticalDominanceRatio = 2.6;
    if (Math.abs(deltaY) > Math.abs(deltaX) * verticalDominanceRatio) {
      cleanupZonesTouchPanInteraction();
      return;
    }
  }

  zonesTouchPanMoved = true;
  zonesContainer.classList.add('is-pan-scrolling');
  event.preventDefault();
  zonesContainer.scrollLeft = zonesTouchPanStartScrollLeft - deltaX * ZONES_PAN_TOUCH_GAIN;
}

function onZonesTouchEnd(event) {
  if (!zonesTouchPanActive) return;
  const hasEnoughTouches = Boolean(event && event.touches && event.touches.length >= 2);
  if (hasEnoughTouches) return;

  const momentumVelocity = zonesTouchPanMoved ? -zonesTouchPanVelocityX * ZONES_PAN_TOUCH_GAIN : 0;
  cleanupZonesTouchPanInteraction();
  if (Math.abs(momentumVelocity) >= ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) {
    startZonesPanMomentum(momentumVelocity);
  }
}

function onZonesTouchCancel() {
  if (!zonesTouchPanActive) return;
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
    if (zonesPanPointerId !== null && typeof zonesContainer.releasePointerCapture === 'function') {
      try {
        if (zonesContainer.hasPointerCapture && zonesContainer.hasPointerCapture(zonesPanPointerId)) {
          zonesContainer.releasePointerCapture(zonesPanPointerId);
        }
      } catch (err) {
        // ignore pointer capture release errors
      }
    }
  }

  zonesPanActive = false;
  zonesPanMoved = false;
  zonesPanPointerId = null;
  zonesPanStartX = 0;
  zonesPanStartY = 0;
  zonesPanStartScrollLeft = 0;
  zonesPanPreferHorizontal = false;
  zonesPanPointerType = '';
  zonesPanMoveGain = 1;
  zonesPanLastX = 0;
  zonesPanLastAt = 0;
  zonesPanVelocityX = 0;
  window.removeEventListener('pointermove', onZonesPanPointerMove, true);
  window.removeEventListener('pointerup', onZonesPanPointerUp, true);
  window.removeEventListener('pointercancel', onZonesPanPointerCancel, true);
}

function onZonesPanPointerMove(event) {
  if (!zonesPanActive || event.pointerId !== zonesPanPointerId) return;
  if (!zonesContainer) return;

  const deltaX = event.clientX - zonesPanStartX;
  const deltaY = event.clientY - zonesPanStartY;
  const nowTimestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const sampleDeltaMs = nowTimestamp - zonesPanLastAt;
  if (Number.isFinite(sampleDeltaMs) && sampleDeltaMs > 0) {
    const sampleVelocityX = (event.clientX - zonesPanLastX) / sampleDeltaMs;
    zonesPanVelocityX = zonesPanVelocityX * 0.7 + sampleVelocityX * 0.3;
  }
  zonesPanLastX = event.clientX;
  zonesPanLastAt = nowTimestamp;

  if (!zonesPanMoved) {
    const dragThreshold = zonesPanPreferHorizontal ? Math.max(2, Math.floor(ZONES_PAN_DRAG_THRESHOLD_PX / 2)) : ZONES_PAN_DRAG_THRESHOLD_PX;
    if (Math.abs(deltaX) < dragThreshold && Math.abs(deltaY) < dragThreshold) {
      return;
    }
    const verticalDominanceRatio = zonesPanPreferHorizontal ? 2.6 : 1;
    if (Math.abs(deltaY) > Math.abs(deltaX) * verticalDominanceRatio) {
      // Vertical gesture: keep native vertical scroll behavior.
      cleanupZonesPanInteraction();
      return;
    }
  }

  zonesPanMoved = true;
  zonesContainer.classList.add('is-pan-scrolling');
  event.preventDefault();
  zonesContainer.scrollLeft = zonesPanStartScrollLeft - deltaX * zonesPanMoveGain;
}

function onZonesPanPointerUp(event) {
  if (!zonesPanActive || event.pointerId !== zonesPanPointerId) return;
  const shouldUseMomentum = zonesPanMoved && zonesPanPointerType === 'touch';
  const momentumVelocity = shouldUseMomentum ? -zonesPanVelocityX * zonesPanMoveGain : 0;
  cleanupZonesPanInteraction();
  if (shouldUseMomentum) {
    startZonesPanMomentum(momentumVelocity);
  }
}

function onZonesPanPointerCancel(event) {
  if (!zonesPanActive || event.pointerId !== zonesPanPointerId) return;
  cleanupZonesPanInteraction();
}

function onZonesPanPointerDown(event) {
  if (!zonesContainer) return;
  if (!event.isPrimary) return;
  if (event.pointerType === 'touch') return;
  if (event.button !== undefined && event.button !== 0) return;
  if (!canPanZonesContainer()) return;
  if (draggingCard || touchCopyDragActive) return;
  if (!isZonesPanFreeAreaTarget(event.target instanceof Element ? event.target : null)) return;

  stopZonesPanMomentum();
  stopZonesWheelSmoothScroll();

  if (zonesPanActive) {
    cleanupZonesPanInteraction();
  }

  zonesPanActive = true;
  zonesPanMoved = false;
  zonesPanPointerId = event.pointerId;
  zonesPanStartX = event.clientX;
  zonesPanStartY = event.clientY;
  zonesPanStartScrollLeft = zonesContainer.scrollLeft;
  const targetElement = event.target instanceof Element ? event.target : null;
  zonesPanPreferHorizontal = Boolean(
    targetElement &&
      targetElement.closest('.zone-body') &&
      !targetElement.closest('.track-card, .playlist-header, button, input, textarea, select, a, label'),
  );
  zonesPanPointerType = typeof event.pointerType === 'string' ? event.pointerType : '';
  zonesPanMoveGain =
    zonesPanPointerType === 'touch' && zonesPanPreferHorizontal
      ? ZONES_PAN_TOUCH_GAIN
      : 1;
  zonesPanLastX = event.clientX;
  zonesPanLastAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  zonesPanVelocityX = 0;

  if (typeof zonesContainer.setPointerCapture === 'function') {
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

  if (!currentTrack || !currentAudio) return;

  try {
    if (currentAudio.paused) {
      setTrackPaused(currentTrack.key, false, currentTrack);
      await currentAudio.play();
      setButtonPlaying(currentTrack.key, true, currentTrack);
      startProgressLoop(currentAudio, currentTrack.key);
      setStatus(`Играет: ${currentTrack.file}`);
    } else {
      await pauseCurrentPlayback(currentTrack, currentAudio);
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
  const cards = cardsByFile.get(fileKey);
  if (!cards || !cards.size) return null;

  for (const card of cards) {
    if (cardMatchesTrackContext(card, playbackContext)) {
      return card;
    }
  }

  return getFirstFromSet(cards);
}

function getTrackButtonByContext(fileKey, playbackContext = null) {
  const buttons = buttonsByFile.get(fileKey);
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

  if (currentTrack && typeof currentTrack.file === 'string') {
    if (isTrackCardContextActive(card, currentTrack.file, currentTrack)) {
      return true;
    }
  }

  if (hostPlaybackState && typeof hostPlaybackState.trackFile === 'string' && hostPlaybackState.trackFile.trim()) {
    const hostContext = {
      playlistIndex: normalizePlaylistTrackIndex(hostPlaybackState.playlistIndex),
      playlistPosition: normalizePlaylistTrackIndex(hostPlaybackState.playlistPosition),
    };
    if (isTrackCardContextActive(card, hostPlaybackState.trackFile, hostContext)) {
      return true;
    }
  }

  return false;
}

function applyPlayButtonState(button, isPauseState) {
  if (!button) return;
  button.dataset.state = isPauseState ? 'pause' : 'play';
  button.title = isPauseState ? 'Пауза' : 'Воспроизвести';
  button.setAttribute('aria-label', isPauseState ? 'Пауза' : 'Воспроизвести');
}

function setButtonPlaying(fileKey, isPlaying, playbackContext = null) {
  const buttons = buttonsByFile.get(fileKey);
  const cards = cardsByFile.get(fileKey);

  if (buttons) {
    for (const button of buttons) {
      applyPlayButtonState(button, false);
    }

    if (isPlaying) {
      const targetButton = getTrackButtonByContext(fileKey, playbackContext);
      applyPlayButtonState(targetButton, true);
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
}

function setTrackPaused(fileKey, isPaused, playbackContext = null) {
  const cards = cardsByFile.get(fileKey);
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

function updateProgress(fileKey, currentTime, duration) {
  if (!currentTrack || currentTrack.key !== fileKey) return;

  const safeTime = Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
  const percent = duration ? Math.min(100, (safeTime / duration) * 100) : 0;
  setNowPlayingProgress(percent);
  const remaining = duration ? Math.max(0, duration - safeTime) : getCurrentTrackRemainingSeconds();
  setNowPlayingTime(remaining, { useCeil: true });
  refreshTrackDurationLabels(fileKey);
}

function resetProgress(fileKey) {
  if (currentTrack && fileKey && currentTrack.key !== fileKey) return;
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
  if (progressRaf !== null) {
    cancelAnimationFrame(progressRaf);
    progressRaf = null;
  }
  progressAudio = null;
  syncNowPlayingPanel();
}

function startProgressLoop(audio, fileKey) {
  stopProgressLoop();
  if (!audio) return;
  progressAudio = audio;
  syncNowPlayingPanel();

  const tick = () => {
    if (!progressAudio || progressAudio.paused) return;
    updateProgress(fileKey, progressAudio.currentTime, getDuration(progressAudio));
    progressRaf = requestAnimationFrame(tick);
  };

  tick();
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
  addToMultiMap(cardsByFile, key, card);

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
  addToMultiMap(trackNameLabelsByFile, key, name);

  const durationLabel = document.createElement('span');
  durationLabel.className = 'track-duration';
  durationLabel.textContent = getTrackDurationTextByKey(key);
  addToMultiMap(durationLabelsByFile, key, durationLabel);

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
  addToMultiMap(buttonsByFile, key, playButton);

  card.append(order, name, durationLabel, playButton);
  if (draggable) {
    attachDragHandlers(card);
  }
  return card;
}

function attachDragHandlers(card) {
  card.addEventListener('pointerdown', (event) => {
    if (!isTouchPointerEvent(event)) return;
    if (event.isPrimary === false) return;

    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('button, input, textarea, select, a, .track-order')) return;

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

    if (isTrackCardDragBlocked(card)) {
      e.preventDefault();
      setStatus('Активный трек нельзя перемещать или копировать.');
      return;
    }

    const sourceZone = card.closest('.zone');
    const sourceZoneIndex = sourceZone ? Number.parseInt(sourceZone.dataset.zoneIndex || '', 10) : -1;
    const sourceBody = card.parentElement;
    const sourceIndex = sourceBody ? Array.from(sourceBody.querySelectorAll('.track-card')).indexOf(card) : -1;
    const sourcePlaylistType = isFolderPlaylistIndex(sourceZoneIndex) ? PLAYLIST_TYPE_FOLDER : PLAYLIST_TYPE_MANUAL;

    dragContext = {
      file: card.dataset.file || '',
      sourceZoneIndex: Number.isInteger(sourceZoneIndex) ? sourceZoneIndex : -1,
      sourceIndex,
      sourcePlaylistType,
      snapshotLayout: cloneLayoutState(layout),
    };

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', card.dataset.file);
    setDropEffectFromEvent(e);
    createDesktopDragGhost(card, e.clientX, e.clientY);
    e.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);
    showTrashDropzone();
    applyDragModeBadge(isActiveCopyDrag(e) ? 'copy' : 'move');
    card.classList.add('dragging');
    draggingCard = card;
    dragDropHandled = false;
  });

  card.addEventListener('dragend', () => {
    hideTrashDropzone();
    clearDesktopDragGhost();
    clearDragModeBadge();
    clearDragPreviewCard();
    card.classList.remove('dragging');
    if (!dragDropHandled) {
      renderZones();
    }
    draggingCard = null;
    dragContext = null;
    dragDropHandled = false;
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
  if (!draggingCard || !zoneBody) return;
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
    zoneBody.insertBefore(draggingCard, beforeElement);
  } else {
    zoneBody.appendChild(draggingCard);
  }
}

function ensurePlaylists(playlists) {
  const normalized = Array.isArray(playlists) ? playlists.map((playlist) => (Array.isArray(playlist) ? playlist : [])) : [];
  if (!normalized.length) normalized.push([]);
  return normalized;
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

function serializeLayout(playlists) {
  return JSON.stringify(ensurePlaylists(playlists));
}

function layoutsEqual(left, right) {
  return serializeLayout(left) === serializeLayout(right);
}

function serializePlaylistNames(names, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(layout).length;
  return JSON.stringify(normalizePlaylistNames(names, expectedLength));
}

function playlistNamesEqual(left, right, expectedLength) {
  return serializePlaylistNames(left, expectedLength) === serializePlaylistNames(right, expectedLength);
}

function serializePlaylistAutoplay(flags, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(layout).length;
  return JSON.stringify(normalizePlaylistAutoplayFlags(flags, expectedLength));
}

function playlistAutoplayEqual(left, right, expectedLength) {
  return serializePlaylistAutoplay(left, expectedLength) === serializePlaylistAutoplay(right, expectedLength);
}

function serializePlaylistDsp(flags, autoplayFlags, lengthHint = null) {
  const expectedLength = Number.isInteger(lengthHint) && lengthHint >= 0 ? lengthHint : ensurePlaylists(layout).length;
  return JSON.stringify(normalizePlaylistDspFlags(flags, autoplayFlags, expectedLength));
}

function playlistDspEqual(left, right, autoplayFlags, expectedLength) {
  return serializePlaylistDsp(left, autoplayFlags, expectedLength) === serializePlaylistDsp(right, autoplayFlags, expectedLength);
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
  const nextLayout = zones.map((zone) => {
    const body = zone.querySelector('.zone-body');
    if (!body) return [];
    return Array.from(body.querySelectorAll('.track-card'))
      .map((card) => card.dataset.file)
      .filter(Boolean);
  });
  layout = ensurePlaylists(nextLayout);
  playlistNames = normalizePlaylistNames(playlistNames, layout.length);
  playlistMeta = normalizePlaylistMeta(playlistMeta, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, layout.length);
  playlistDsp = normalizePlaylistDspFlags(playlistDsp, playlistAutoplay, layout.length);
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
  if (!dragContext) return false;

  const snapshotLayout = cloneLayoutState(dragContext.snapshotLayout);
  const snapshotNames = normalizePlaylistNames(playlistNames, snapshotLayout.length);
  const snapshotMeta = normalizePlaylistMeta(playlistMeta, snapshotLayout.length);
  const snapshotAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, snapshotLayout.length);
  const snapshotDsp = normalizePlaylistDspFlags(playlistDsp, snapshotAutoplay, snapshotLayout.length);

  const resolution = resolveTrackIndexByContext(snapshotLayout, dragContext);
  const eligibility = getTrackDeleteEligibility(snapshotLayout, resolution.playlistIndex, resolution.trackIndex);
  if (!eligibility.canDelete) {
    setStatus(`Удаление недоступно: ${eligibility.reason}`);
    return false;
  }

  snapshotLayout[resolution.playlistIndex].splice(resolution.trackIndex, 1);

  const previousLayout = cloneLayoutState(layout);
  const previousNames = playlistNames.slice();
  const previousMeta = clonePlaylistMetaState(playlistMeta);
  const previousAutoplay = playlistAutoplay.slice();
  const previousDsp = playlistDsp.slice();

  layout = ensurePlaylists(snapshotLayout);
  playlistNames = normalizePlaylistNames(snapshotNames, layout.length);
  playlistMeta = normalizePlaylistMeta(snapshotMeta, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(snapshotAutoplay, layout.length);
  playlistDsp = normalizePlaylistDspFlags(snapshotDsp, playlistAutoplay, layout.length);
  dragDropHandled = true;
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
    layout = previousLayout;
    playlistNames = previousNames;
    playlistMeta = previousMeta;
    playlistAutoplay = previousAutoplay;
    playlistDsp = previousDsp;
    renderZones();
    setStatus('Не удалось синхронизировать удаление трека.');
    return false;
  }
}

function getTrackButton(file, playlistIndex = null, playlistPosition = null, basePath = '/audio') {
  const key = trackKey(file, basePath);
  const candidates = buttonsByFile.get(key);
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
  if (preferredPlaylistIndex < 0 || preferredPlaylistIndex >= layout.length) return null;

  if (requireAutoplay && !playlistAutoplay[preferredPlaylistIndex]) return null;
  const playlist = Array.isArray(layout[preferredPlaylistIndex]) ? layout[preferredPlaylistIndex] : [];
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
  return resolveSequentialNextTrack(finishedTrack, { requireAutoplay: true });
}

function isPlaylistDspEnabled(playlistIndex) {
  const normalizedIndex = normalizePlaylistTrackIndex(playlistIndex);
  if (normalizedIndex === null) return false;
  if (normalizedIndex < 0 || normalizedIndex >= playlistDsp.length) return false;
  return Boolean(playlistDsp[normalizedIndex]);
}

function setLiveDspNextTrackReady(nextTrack, details = null) {
  if (!nextTrack || typeof nextTrack.file !== 'string') {
    liveDspNextReadyDescriptor = '';
    liveDspNextReadySliceSeconds = null;
    syncLiveDspNextTrackHighlight();
    return;
  }

  liveDspNextReadyDescriptor = buildLiveDspNextTrackDescriptor(
    nextTrack.file,
    {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
    },
    nextTrack.basePath || '/audio',
  );
  const normalizedSliceSeconds = normalizeDspTransitionSliceSeconds(details && details.sliceSeconds);
  liveDspNextReadySliceSeconds = normalizedSliceSeconds > 0 ? normalizedSliceSeconds : null;
  syncLiveDspNextTrackHighlight();
}

function resolveReadyDspSliceWindowSeconds(nextTrack) {
  if (!nextTrack || typeof nextTrack.file !== 'string') return null;
  if (nextTrack.basePath && nextTrack.basePath !== '/audio') return null;
  if (!liveDspNextReadyDescriptor) return null;

  const expectedDescriptor = buildLiveDspNextTrackDescriptor(
    nextTrack.file,
    {
      playlistIndex: nextTrack.playlistIndex,
      playlistPosition: nextTrack.playlistPosition,
    },
    nextTrack.basePath || '/audio',
  );
  if (!expectedDescriptor || expectedDescriptor !== liveDspNextReadyDescriptor) return null;

  const sliceSeconds = normalizeDspTransitionSliceSeconds(liveDspNextReadySliceSeconds);
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

  const existingPromise = dspTransitionWarmupPromises.get(normalizedUrl);
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

  dspTransitionWarmupPromises.set(normalizedUrl, warmupPromise);
  if (dspTransitionWarmupPromises.size > LIVE_DSP_WARMUP_MAX_TRACKED) {
    const firstKey = dspTransitionWarmupPromises.keys().next().value;
    if (firstKey && firstKey !== normalizedUrl) {
      dspTransitionWarmupPromises.delete(firstKey);
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
  const pendingPromises = Array.from(liveDspContinuationWarmupPromises.values());
  liveDspContinuationWarmupPromises.clear();
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

  const existing = liveDspContinuationWarmupPromises.get(key);
  if (existing) return existing;

  const normalizedSlice = normalizeDspTransitionSliceSeconds(sliceSeconds);
  const basePromise = (async () => {
    const preparedAudio = createAudio(targetTrack);
    preparedAudio.preload = 'auto';
    preparedAudio.volume = getEffectiveLiveVolume();
    if (normalizedSlice > 0) {
      await seekAudioToOffset(preparedAudio, normalizedSlice);
    }
    return preparedAudio;
  })();

  let trackedPromise = null;
  trackedPromise = basePromise
    .then((audio) => {
      const stillTracked = liveDspContinuationWarmupPromises.get(key) === trackedPromise;
      if (!stillTracked) {
        if (audio) disposePreparedContinuationAudio(audio);
        return null;
      }
      if (!audio) {
        liveDspContinuationWarmupPromises.delete(key);
        return null;
      }
      return audio;
    })
    .catch(() => {
      if (liveDspContinuationWarmupPromises.get(key) === trackedPromise) {
        liveDspContinuationWarmupPromises.delete(key);
      }
      return null;
    });

  liveDspContinuationWarmupPromises.set(key, trackedPromise);
  while (liveDspContinuationWarmupPromises.size > LIVE_DSP_CONTINUATION_WARMUP_MAX_TRACKED) {
    const oldestKey = liveDspContinuationWarmupPromises.keys().next().value;
    if (!oldestKey || oldestKey === key) break;
    liveDspContinuationWarmupPromises.delete(oldestKey);
  }

  return trackedPromise;
}

function consumeLiveDspContinuationWarmup(nextTrack, sliceSeconds = 0) {
  const targetTrack = toPlaybackTrackDescriptor(nextTrack, '/audio');
  const key = buildLiveDspContinuationWarmupKey(targetTrack, sliceSeconds);
  if (!key) return null;

  const warmupPromise = liveDspContinuationWarmupPromises.get(key);
  if (!warmupPromise) return null;
  liveDspContinuationWarmupPromises.delete(key);
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
  const response = await fetch(`/api/dsp/transitions?from=${encodeURIComponent(fromFile)}&to=${encodeURIComponent(toFile)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
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

  while (liveDspRenderToken === tokenAtStart && Date.now() - startedAt <= LIVE_DSP_POLL_TIMEOUT_MS) {
    let details = null;
    let status = 'missing';
    try {
      details = await fetchDspTransitionPairDetails(fromTrack.file, nextTrack.file);
      status = details.status;
    } catch (err) {
      // keep waiting during transient API errors
    }

    if (liveDspRenderToken !== tokenAtStart) return;
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
    const response = await fetch('/api/dsp/transitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        from: fromTrack.file,
        to: nextTrack.file,
        force: true,
        source: LIVE_DSP_RENDER_SOURCE,
        priority: 'high',
      }),
    });

    if (!response.ok) {
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

  const token = liveDspRenderToken + 1;
  liveDspRenderToken = token;
  setLiveDspNextTrackReady(null);

  const nextTrack = resolveSequentialNextTrack(track, { requireAutoplay: false });
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
    currentTrack &&
    currentTrack.key === sourceTrack.key &&
    currentAudio &&
    !currentAudio.paused;

  if (!hasCurrentSourceTrack) {
    // Source track already ended: skip source segment and continue from target side of transition.
    return sourceSegmentSeconds;
  }

  const sourceDuration = getDuration(currentAudio) || getKnownDurationSeconds(sourceTrack.key);
  const sourceCurrentTime = Number.isFinite(currentAudio.currentTime) ? Math.max(0, currentAudio.currentTime) : null;
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

  resetFadeState();
  stopProgressLoop();
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch (err) {
      // ignore pause errors while switching to DSP transition
    }
  }
  currentAudio = null;
  currentTrack = null;

  setButtonPlaying(sourceTrack.key, true, sourceTrack);
  setTrackPaused(sourceTrack.key, false, sourceTrack);
  setButtonPlaying(targetTrack.key, true, targetTrack);
  setTrackPaused(targetTrack.key, false, targetTrack);

  const transitionAudio = new Audio(details.outputUrl);
  transitionAudio.preload = 'auto';
  transitionAudio.volume = getEffectiveLiveVolume();
  dspTransitionPlayback = {
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
      transitionStartOffsetSeconds + startupDelaySeconds + liveDspEntryCompensationSeconds,
    );
    const knownDuration =
      getDuration(transitionAudio) ||
      (dspTransitionPlayback && Number.isFinite(dspTransitionPlayback.duration) && dspTransitionPlayback.duration > 0
        ? dspTransitionPlayback.duration
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
            cachedAudio.volume = getEffectiveLiveVolume();
            continuationAudio = cachedAudio;
            return cachedAudio;
          }
        } catch (err) {
          // ignore cache warmup errors and fallback to direct prepare
        }
      }

      const preparedAudio = createAudio(targetTrack);
      preparedAudio.preload = 'auto';
      preparedAudio.volume = getEffectiveLiveVolume();
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
    if (!dspTransitionPlayback || dspTransitionPlayback.audio !== transitionAudio) {
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
      preparedAudio.volume = getEffectiveLiveVolume();
      await preparedAudio.play();
    } catch (err) {
      await fallbackToRegularNextTrackStart();
      return;
    }

    if (!dspTransitionPlayback || dspTransitionPlayback.audio !== transitionAudio) {
      return;
    }

    stopDspTransitionPlayback({ stopAudio: true, clearTrackState: false });
    currentAudio = preparedAudio;
    currentTrack = targetTrack;
    setButtonPlaying(sourceTrack.key, false, sourceTrack);
    setTrackPaused(sourceTrack.key, false, sourceTrack);
    setButtonPlaying(targetTrack.key, true, targetTrack);
    setTrackPaused(targetTrack.key, false, targetTrack);
    startProgressLoop(preparedAudio, targetTrack.key);
    setStatus(`Играет: ${nextTrack.file}`);
    triggerLiveDspTransitionForTrack(targetTrack);
    syncNowPlayingPanel();
    requestHostPlaybackSync(true);
  };

  transitionAudio.addEventListener('loadedmetadata', () => {
    if (!dspTransitionPlayback || dspTransitionPlayback.audio !== transitionAudio) return;
    const duration = getDuration(transitionAudio);
    if (duration) {
      dspTransitionPlayback.duration = duration;
    }
    syncNowPlayingPanel();
  });

  transitionAudio.addEventListener('timeupdate', () => {
    if (!dspTransitionPlayback || dspTransitionPlayback.audio !== transitionAudio) return;
    if (!handoffStarted) {
      const activeDuration = getDuration(transitionAudio) || dspTransitionPlayback.duration;
      const currentTime =
        Number.isFinite(transitionAudio.currentTime) && transitionAudio.currentTime >= 0
          ? transitionAudio.currentTime
          : 0;
      if (Number.isFinite(activeDuration) && activeDuration > 0) {
        const remaining = Math.max(0, activeDuration - currentTime);
        const handoffLeadSeconds = Math.max(0, LIVE_DSP_HANDOFF_LEAD_SECONDS + liveDspExitCompensationSeconds);
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
    if (!dspTransitionPlayback || dspTransitionPlayback.audio !== transitionAudio) return;
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
    if (dspTransitionPlayback && dspTransitionPlayback.audio === transitionAudio) {
      dspTransitionPlayback.startOffsetSeconds = adjustedTransitionStartOffsetSeconds;
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
  return true;
}

function resetTrackReferences() {
  hideTrashDropzone();
  clearDesktopDragGhost();
  clearDragModeBadge();
  clearDragPreviewCard();
  clearTouchCopyHold();
  if (touchCopyDragActive) {
    cleanupTouchCopyDrag({ restoreLayout: false });
  }
  buttonsByFile = new Map();
  cardsByFile = new Map();
  durationLabelsByFile = new Map();
  trackNameLabelsByFile = new Map();
  hostHighlightedDescriptor = '';
}

function applyIncomingLayoutState(
  nextLayout,
  nextPlaylistNames,
  nextPlaylistMeta,
  nextPlaylistAutoplay,
  nextPlaylistDsp,
  nextTrackTitleModesByTrack = null,
  version = null,
  render = true,
) {
  const normalizedLayout = normalizeLayoutForFiles(nextLayout, availableFiles);
  const normalizedNames = normalizePlaylistNames(nextPlaylistNames, normalizedLayout.length);
  const normalizedMeta = normalizePlaylistMeta(nextPlaylistMeta, normalizedLayout.length);
  const normalizedAutoplay = normalizePlaylistAutoplayFlags(nextPlaylistAutoplay, normalizedLayout.length);
  const normalizedDsp = normalizePlaylistDspFlags(nextPlaylistDsp, normalizedAutoplay, normalizedLayout.length);
  const normalizedTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(
    nextTrackTitleModesByTrack !== null && nextTrackTitleModesByTrack !== undefined
      ? nextTrackTitleModesByTrack
      : trackTitleModesByTrack,
    availableFiles,
    '/audio',
  );
  const withFolderCoverage = ensureFolderPlaylistsCoverage(normalizedLayout, normalizedNames, normalizedMeta);
  const changed =
    !layoutsEqual(layout, withFolderCoverage.layout) ||
    !playlistNamesEqual(playlistNames, withFolderCoverage.playlistNames, withFolderCoverage.layout.length) ||
    !playlistMetaEqual(playlistMeta, withFolderCoverage.playlistMeta, withFolderCoverage.layout.length) ||
    !playlistAutoplayEqual(playlistAutoplay, normalizedAutoplay, withFolderCoverage.layout.length) ||
    !playlistDspEqual(playlistDsp, normalizedDsp, normalizedAutoplay, withFolderCoverage.layout.length) ||
    !trackTitleModesByTrackEqual(trackTitleModesByTrack, normalizedTrackTitleModes);

  layout = withFolderCoverage.layout;
  playlistNames = withFolderCoverage.playlistNames;
  playlistMeta = withFolderCoverage.playlistMeta;
  playlistAutoplay = normalizePlaylistAutoplayFlags(normalizedAutoplay, layout.length);
  playlistDsp = normalizePlaylistDspFlags(normalizedDsp, playlistAutoplay, layout.length);
  trackTitleModesByTrack = normalizedTrackTitleModes;
  saveTrackTitleModesByTrackSetting();

  const numericVersion = Number(version);
  if (Number.isFinite(numericVersion)) {
    layoutVersion = numericVersion;
  }

  if (changed && render) {
    renderZones();
  }

  return changed;
}

function applyIncomingHostPlaybackState(nextState, sync = true) {
  const normalizedState = sanitizeIncomingHostPlaybackState(nextState);
  const changed = serializeHostPlaybackState(hostPlaybackState) !== serializeHostPlaybackState(normalizedState);
  hostPlaybackState = normalizedState;
  setLivePlaybackVolume(normalizedState.volume, { sync: false, announce: false });
  setShowVolumePresetsEnabled(normalizedState.showVolumePresets, { persist: isHostRole(), sync: false });
  setLiveSeekEnabled(normalizedState.allowLiveSeek, { persist: isHostRole(), sync: false });

  if (sync || changed) {
    if (isCoHostRole()) {
      syncNowPlayingPanel();
    }
    syncHostNowPlayingPanel();
  }
  syncPlaylistHeaderActiveState();

  return changed;
}

function buildLocalPlaybackSnapshot() {
  if (!currentTrack || !currentAudio) {
    return {
      trackFile: null,
      paused: false,
      currentTime: 0,
      duration: null,
      volume: getEffectiveLiveVolume(),
      showVolumePresets: showVolumePresetsEnabled,
      allowLiveSeek: liveSeekEnabled,
      playlistIndex: null,
      playlistPosition: null,
    };
  }

  const rawCurrentTime = Number(currentAudio.currentTime);
  const currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;
  const resolvedDuration = getDuration(currentAudio) || getKnownDurationSeconds(currentTrack.key);

  return {
    trackFile: currentTrack.file,
    paused: Boolean(currentAudio.paused),
    currentTime,
    duration: Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : null,
    volume: getEffectiveLiveVolume(),
    showVolumePresets: showVolumePresetsEnabled,
    allowLiveSeek: liveSeekEnabled,
    playlistIndex: normalizePlaylistTrackIndex(currentTrack.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(currentTrack.playlistPosition),
  };
}

async function fetchSharedPlaybackState() {
  const response = await fetch('/api/playback');
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось получить состояние воспроизведения хоста');
  }

  return sanitizeIncomingHostPlaybackState(data);
}

async function pushSharedPlaybackState(snapshot) {
  const response = await fetch('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ...snapshot, clientId }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
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
  const response = await fetch('/api/playback/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      ...command,
      clientId,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
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
      if (!liveSeekEnabled) {
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
      if (!currentTrack || !currentAudio) {
        return;
      }
      const duration = getCurrentTrackDurationSeconds();
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }
      const nextTime = Math.max(0, Math.min(duration, ratio * duration));

      try {
        if (typeof currentAudio.fastSeek === 'function') {
          currentAudio.fastSeek(nextTime);
        } else {
          currentAudio.currentTime = nextTime;
        }
      } catch (err) {
        try {
          currentAudio.currentTime = nextTime;
        } catch (fallbackErr) {
          return;
        }
      }

      updateProgress(currentTrack.key, nextTime, duration);
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
  if (cohostSeekCommandTimer !== null) return;
  cohostSeekCommandTimer = setTimeout(() => {
    cohostSeekCommandTimer = null;
    flushQueuedCoHostSeekCommands().catch(() => {});
  }, Math.max(0, delayMs));
}

function clearQueuedCoHostSeekCommands() {
  if (cohostSeekCommandTimer !== null) {
    clearTimeout(cohostSeekCommandTimer);
    cohostSeekCommandTimer = null;
  }
  cohostSeekPendingRatio = null;
  cohostSeekPendingFinalize = false;
  cohostSeekCommandInFlight = false;
  cohostSeekLastSentAt = 0;
}

async function flushQueuedCoHostSeekCommands() {
  if (!isCoHostRole()) {
    clearQueuedCoHostSeekCommands();
    return;
  }
  if (cohostSeekCommandInFlight) return;
  if (cohostSeekPendingRatio === null) return;

  const ratioToSend = cohostSeekPendingRatio;
  const shouldFinalize = cohostSeekPendingFinalize;
  cohostSeekPendingRatio = null;
  cohostSeekPendingFinalize = false;
  cohostSeekCommandInFlight = true;

  try {
    await requestCoHostSeekCurrentPlayback(ratioToSend, { finalize: shouldFinalize });
    cohostSeekLastSentAt = Date.now();
  } catch (err) {
    console.error(err);
  } finally {
    cohostSeekCommandInFlight = false;

    if (cohostSeekPendingRatio !== null && isCoHostRole()) {
      const elapsed = Date.now() - cohostSeekLastSentAt;
      const delay = cohostSeekPendingFinalize ? 0 : Math.max(0, COHOST_SEEK_COMMAND_INTERVAL_MS - elapsed);
      scheduleCoHostSeekFlush(delay);
    }
  }
}

function queueCoHostSeekCurrentPlayback(positionRatio, { immediate = false, finalize = false } = {}) {
  if (!isCoHostRole()) return false;
  const normalizedRatio = normalizePlaybackSeekRatio(positionRatio);
  if (normalizedRatio === null) return false;

  cohostSeekPendingRatio = normalizedRatio;
  cohostSeekPendingFinalize = cohostSeekPendingFinalize || Boolean(finalize);

  if (immediate) {
    if (cohostSeekCommandTimer !== null) {
      clearTimeout(cohostSeekCommandTimer);
      cohostSeekCommandTimer = null;
    }
    flushQueuedCoHostSeekCommands().catch(() => {});
    return true;
  }

  if (cohostSeekCommandInFlight) return true;

  const elapsed = Date.now() - cohostSeekLastSentAt;
  const delay = Math.max(0, COHOST_SEEK_COMMAND_INTERVAL_MS - elapsed);
  scheduleCoHostSeekFlush(delay);
  return true;
}

function requestHostLiveSeekSync({ finalize = false } = {}) {
  if (!isHostRole()) return;

  const now = Date.now();
  if (!finalize && now - lastHostLiveSeekSyncAt < HOST_LIVE_SEEK_SYNC_INTERVAL_MS) {
    return;
  }
  lastHostLiveSeekSyncAt = now;
  requestHostPlaybackSync(true);
}

function requestHostPlaybackSync(force = false) {
  if (!isHostRole()) return;

  const now = Date.now();
  if (!force && now - lastHostPlaybackSyncAt < HOST_PLAYBACK_SYNC_INTERVAL_MS) {
    return;
  }

  if (hostPlaybackSyncInFlight) {
    hostPlaybackSyncQueued = true;
    hostPlaybackSyncQueuedForce = hostPlaybackSyncQueuedForce || force;
    return;
  }

  hostPlaybackSyncInFlight = true;
  lastHostPlaybackSyncAt = now;
  const snapshot = buildLocalPlaybackSnapshot();

  pushSharedPlaybackState(snapshot)
    .catch((err) => {
      console.error('Не удалось синхронизировать playback хоста', err);
    })
    .finally(() => {
      hostPlaybackSyncInFlight = false;

      if (!hostPlaybackSyncQueued) return;
      const queuedForce = hostPlaybackSyncQueuedForce;
      hostPlaybackSyncQueued = false;
      hostPlaybackSyncQueuedForce = false;
      requestHostPlaybackSync(queuedForce);
    });
}

async function fetchSharedLayoutState() {
  const response = await fetch('/api/layout');
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось получить конфигурацию плей-листов');
  }

  return {
    layout: Array.isArray(data.layout) ? data.layout : [[]],
    playlistNames: Array.isArray(data.playlistNames) ? data.playlistNames : [],
    playlistMeta: Array.isArray(data.playlistMeta) ? data.playlistMeta : [],
    playlistAutoplay: Array.isArray(data.playlistAutoplay) ? data.playlistAutoplay : [],
    playlistDsp: Array.isArray(data.playlistDsp) ? data.playlistDsp : [],
    trackTitleModesByTrack:
      data && data.trackTitleModesByTrack && typeof data.trackTitleModesByTrack === 'object'
        ? data.trackTitleModesByTrack
        : serializeTrackTitleModesByTrack(),
    version: Number.isFinite(Number(data.version)) ? Number(data.version) : 0,
  };
}

async function pushSharedLayout({ renderOnApply = true } = {}) {
  const payloadState = ensureFolderPlaylistsCoverage(layout, playlistNames, playlistMeta);
  const payloadAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, payloadState.layout.length);
  const payloadDsp = normalizePlaylistDspFlags(playlistDsp, payloadAutoplay, payloadState.layout.length);

  const response = await fetch('/api/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      layout: payloadState.layout,
      playlistNames: payloadState.playlistNames,
      playlistMeta: payloadState.playlistMeta,
      playlistAutoplay: payloadAutoplay,
      playlistDsp: payloadDsp,
      trackTitleModesByTrack: serializeTrackTitleModesByTrack(),
      clientId,
      version: layoutVersion,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось синхронизировать плей-листы');
  }

  applyIncomingLayoutState(
    data.layout,
    data.playlistNames,
    data.playlistMeta,
    data.playlistAutoplay,
    data.playlistDsp,
    data.trackTitleModesByTrack,
    data.version,
    renderOnApply,
  );
}

function clearLayoutStreamConnection() {
  if (layoutStream) {
    layoutStream.close();
    layoutStream = null;
  }
  if (layoutStreamReconnectTimer !== null) {
    clearTimeout(layoutStreamReconnectTimer);
    layoutStreamReconnectTimer = null;
  }
}

function scheduleLayoutStreamReconnect() {
  if (layoutStreamReconnectTimer !== null) return;
  layoutStreamReconnectTimer = setTimeout(() => {
    layoutStreamReconnectTimer = null;
    connectLayoutStream();
  }, LAYOUT_STREAM_RETRY_MS);
}

function connectLayoutStream() {
  if (typeof EventSource === 'undefined') return;
  if (layoutStream) return;

  const stream = new EventSource('/api/layout/stream');
  layoutStream = stream;

  stream.addEventListener('layout', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    if (!payload || !Array.isArray(payload.layout)) return;
    applyIncomingLayoutState(
      payload.layout,
      payload.playlistNames,
      payload.playlistMeta,
      payload.playlistAutoplay,
      payload.playlistDsp,
      payload.trackTitleModesByTrack,
      payload.version,
      true,
    );
  });

  stream.addEventListener('playback', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    applyIncomingHostPlaybackState(payload, true);
  });

  stream.addEventListener('auth-users', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    applyIncomingAuthUsers(payload, { syncOwnRole: true });
  });

  stream.addEventListener('playback-command', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    executeIncomingPlaybackCommand(payload).catch(() => {});
  });

  stream.onerror = () => {
    if (layoutStream !== stream) return;
    stream.close();
    layoutStream = null;
    scheduleLayoutStreamReconnect();
  };
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
  const incomingAutoplay = normalizePlaylistAutoplayFlags(serverState.playlistAutoplay, incomingLayout.length);
  const incomingDsp = normalizePlaylistDspFlags(serverState.playlistDsp, incomingAutoplay, incomingLayout.length);
  const incomingTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(serverState.trackTitleModesByTrack, availableFiles, '/audio');

  let nextLayout = normalizeLayoutForFiles(incomingLayout, availableFiles);
  let nextNames = normalizePlaylistNames(incomingNames, nextLayout.length);
  let nextMeta = normalizePlaylistMeta(incomingMeta, nextLayout.length);
  let nextAutoplay = normalizePlaylistAutoplayFlags(incomingAutoplay, nextLayout.length);
  let nextDsp = normalizePlaylistDspFlags(incomingDsp, nextAutoplay, nextLayout.length);
  let nextTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(incomingTrackTitleModes, availableFiles, '/audio');
  let shouldPush =
    !layoutsEqual(incomingLayout, nextLayout) ||
    !playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !playlistMetaEqual(incomingMeta, nextMeta, nextLayout.length) ||
    !playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length) ||
    !playlistDspEqual(incomingDsp, nextDsp, nextAutoplay, nextLayout.length) ||
    !trackTitleModesByTrackEqual(incomingTrackTitleModes, nextTrackTitleModes);

  if (isHostRole() && isServerLayoutEmpty(incomingLayout)) {
    const legacyLayout = readLegacyLocalLayout(availableFiles);
    if (legacyLayout && !layoutsEqual(legacyLayout, nextLayout)) {
      nextLayout = legacyLayout;
      nextNames = normalizePlaylistNames(nextNames, nextLayout.length);
      nextMeta = normalizePlaylistMeta(nextMeta, nextLayout.length);
      nextAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, nextLayout.length);
      nextDsp = normalizePlaylistDspFlags(nextDsp, nextAutoplay, nextLayout.length);
      shouldPush = true;
    }
  }

  const withFolderCoverage = ensureFolderPlaylistsCoverage(nextLayout, nextNames, nextMeta);
  nextLayout = withFolderCoverage.layout;
  nextNames = withFolderCoverage.playlistNames;
  nextMeta = withFolderCoverage.playlistMeta;
  nextAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, nextLayout.length);
  nextDsp = normalizePlaylistDspFlags(nextDsp, nextAutoplay, nextLayout.length);
  nextTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(nextTrackTitleModes, availableFiles, '/audio');

  shouldPush =
    shouldPush ||
    !layoutsEqual(incomingLayout, nextLayout) ||
    !playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !playlistMetaEqual(incomingMeta, nextMeta, nextLayout.length) ||
    !playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length) ||
    !playlistDspEqual(incomingDsp, nextDsp, nextAutoplay, nextLayout.length) ||
    !trackTitleModesByTrackEqual(incomingTrackTitleModes, nextTrackTitleModes);

  layout = nextLayout;
  playlistNames = nextNames;
  playlistMeta = nextMeta;
  playlistAutoplay = nextAutoplay;
  playlistDsp = nextDsp;
  trackTitleModesByTrack = nextTrackTitleModes;
  saveTrackTitleModesByTrackSetting();
  layoutVersion = serverState.version;

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

async function addPlaylist() {
  layout = ensurePlaylists(layout);
  layout.push([]);
  playlistNames = normalizePlaylistNames([...playlistNames, defaultPlaylistName(layout.length - 1)], layout.length);
  playlistMeta = normalizePlaylistMeta([...playlistMeta, defaultPlaylistMeta()], layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags([...playlistAutoplay, false], layout.length);
  playlistDsp = normalizePlaylistDspFlags([...playlistDsp, false], playlistAutoplay, layout.length);
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(`Добавлен плей-лист ${layout.length}.`);
  } catch (err) {
    console.error(err);
    setStatus('Не удалось синхронизировать новый плей-лист.');
  }
}

async function renamePlaylist(playlistIndex, rawName) {
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= layout.length) return;

  const nextNames = playlistNames.slice();
  nextNames[playlistIndex] = rawName;
  const normalizedNames = normalizePlaylistNames(nextNames, layout.length);

  if (playlistNamesEqual(playlistNames, normalizedNames, layout.length)) {
    renderZones();
    return;
  }

  const previousNames = playlistNames.slice();
  playlistNames = normalizedNames;
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(`Переименован плей-лист ${playlistIndex + 1}.`);
  } catch (err) {
    console.error(err);
    playlistNames = previousNames;
    renderZones();
    setStatus('Не удалось синхронизировать название плей-листа.');
  }
}

async function togglePlaylistAutoplay(playlistIndex) {
  if (!isHostRole()) {
    setStatus('Автовоспроизведение может менять только хост.');
    return;
  }

  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= layout.length) return;

  const previousAutoplay = playlistAutoplay.slice();
  const previousDsp = playlistDsp.slice();
  const nextAutoplay = playlistAutoplay.slice();
  nextAutoplay[playlistIndex] = !nextAutoplay[playlistIndex];
  const normalizedAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, layout.length);
  const normalizedDsp = normalizePlaylistDspFlags(playlistDsp, normalizedAutoplay, layout.length);

  if (
    playlistAutoplayEqual(playlistAutoplay, normalizedAutoplay, layout.length) &&
    playlistDspEqual(playlistDsp, normalizedDsp, normalizedAutoplay, layout.length)
  ) {
    return;
  }

  playlistAutoplay = normalizedAutoplay;
  playlistDsp = normalizedDsp;
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(
      `Автовоспроизведение для плей-листа ${playlistIndex + 1}: ${
        playlistAutoplay[playlistIndex] ? 'включено' : 'выключено'
      }.`,
    );
  } catch (err) {
    console.error(err);
    playlistAutoplay = previousAutoplay;
    playlistDsp = previousDsp;
    renderZones();
    setStatus('Не удалось синхронизировать автопроигрывание плей-листа.');
  }
}

async function togglePlaylistDsp(playlistIndex) {
  if (!isHostRole()) {
    setStatus('DSP для плей-листа может менять только хост.');
    return;
  }

  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= layout.length) return;
  if (!playlistAutoplay[playlistIndex]) {
    setStatus('DSP можно включить только при активном автопроигрывании.');
    return;
  }

  const previousDsp = playlistDsp.slice();
  const nextDsp = playlistDsp.slice();
  nextDsp[playlistIndex] = !nextDsp[playlistIndex];
  const normalizedDsp = normalizePlaylistDspFlags(nextDsp, playlistAutoplay, layout.length);

  if (playlistDspEqual(playlistDsp, normalizedDsp, playlistAutoplay, layout.length)) return;

  playlistDsp = normalizedDsp;
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(`DSP для плей-листа ${playlistIndex + 1}: ${playlistDsp[playlistIndex] ? 'включен' : 'выключен'}.`);
  } catch (err) {
    console.error(err);
    playlistDsp = previousDsp;
    renderZones();
    setStatus('Не удалось синхронизировать DSP плей-листа.');
  }
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
  if (isHostRole() && currentTrack && typeof currentTrack.file === 'string' && currentTrack.file.trim()) {
    const currentPlaylistIndex = normalizePlaylistTrackIndex(currentTrack.playlistIndex);
    if (currentPlaylistIndex !== null) {
      return currentPlaylistIndex;
    }
  }

  const hostPlaybackIndex =
    hostPlaybackState && typeof hostPlaybackState.trackFile === 'string' && hostPlaybackState.trackFile.trim()
      ? normalizePlaylistTrackIndex(hostPlaybackState.playlistIndex)
      : null;

  if (hostPlaybackIndex !== null) {
    return hostPlaybackIndex;
  }

  return null;
}

function syncPlaylistHeaderActiveState() {
  if (!zonesContainer) return;

  const activePlaylistIndex = getLiveLockedPlaylistIndex();
  const zones = zonesContainer.querySelectorAll('.zone');
  zones.forEach((zone) => {
    if (!(zone instanceof HTMLElement)) return;
    const playlistIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return;

    const deleteButton = zone.querySelector('.playlist-delete-btn');
    const activeReel = zone.querySelector('.playlist-active-reel');
    if (!(deleteButton instanceof HTMLElement) || !(activeReel instanceof HTMLElement)) return;

    const isActive = activePlaylistIndex !== null && activePlaylistIndex === playlistIndex;
    deleteButton.style.display = isActive ? 'none' : 'inline-flex';
    activeReel.style.display = isActive ? 'inline-flex' : 'none';
  });
}

function getPlaylistDeleteEligibility(playlistIndex) {
  const normalizedLayout = ensurePlaylists(layout);
  const normalizedMeta = normalizePlaylistMeta(playlistMeta, normalizedLayout.length);

  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= normalizedLayout.length) {
    return { canDelete: false, reason: 'Плей-лист не найден.' };
  }

  const metaEntry = normalizedMeta[playlistIndex];
  const isLinkedFolderPlaylist =
    metaEntry &&
    metaEntry.type === PLAYLIST_TYPE_FOLDER &&
    availableFolders.some((folder) => folder.key === metaEntry.folderKey);
  if (isLinkedFolderPlaylist) {
    return { canDelete: false, reason: 'Нельзя удалить авто-плей-лист папки, пока папка есть в /audio.' };
  }

  if (normalizedLayout.length <= 1) {
    return { canDelete: false, reason: 'Нельзя удалить последний плей-лист.' };
  }

  const liveLockedPlaylistIndex = getLiveLockedPlaylistIndex();
  if (liveLockedPlaylistIndex !== null && liveLockedPlaylistIndex === playlistIndex) {
    return { canDelete: false, reason: 'Нельзя удалить плей-лист, который сейчас играет на лайве.' };
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

  const safeTitle = sanitizePlaylistName(playlistNames[playlistIndex], playlistIndex);
  const confirmed = window.confirm(`Удалить плей-лист "${safeTitle}"?`);
  if (!confirmed) {
    return;
  }

  const previousLayout = ensurePlaylists(layout).map((playlist) => playlist.slice());
  const previousNames = playlistNames.slice();
  const previousMeta = clonePlaylistMetaState(playlistMeta);
  const previousAutoplay = playlistAutoplay.slice();
  const previousDsp = playlistDsp.slice();

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

  layout = ensurePlaylists(nextLayout);
  playlistNames = normalizePlaylistNames(nextNames, layout.length);
  playlistMeta = normalizePlaylistMeta(nextMeta, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, layout.length);
  playlistDsp = normalizePlaylistDspFlags(nextDsp, playlistAutoplay, layout.length);
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(`Плей-лист "${safeTitle}" удален.`);
  } catch (err) {
    console.error(err);
    layout = previousLayout;
    playlistNames = previousNames;
    playlistMeta = previousMeta;
    playlistAutoplay = previousAutoplay;
    playlistDsp = previousDsp;
    renderZones();
    setStatus(err && err.message ? err.message : 'Не удалось синхронизировать удаление плей-листа.');
  }
}

function renderZones() {
  zonesContainer.innerHTML = '';
  resetTrackReferences();
  layout = ensurePlaylists(layout);
  playlistMeta = normalizePlaylistMeta(playlistMeta, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, layout.length);
  playlistDsp = normalizePlaylistDspFlags(playlistDsp, playlistAutoplay, layout.length);
  const trackOccurrence = buildTrackOccurrenceMap(layout);

  layout.forEach((playlistFiles, playlistIndex) => {
    const metaEntry = playlistMeta[playlistIndex] || defaultPlaylistMeta();
    const zone = document.createElement('div');
    zone.className = 'zone';
    zone.dataset.zoneIndex = playlistIndex.toString();
    zone.dataset.playlistType = metaEntry.type;
    if (metaEntry.type === PLAYLIST_TYPE_FOLDER) {
      zone.classList.add('zone--folder');
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
    const titleWrap = document.createElement('div');
    titleWrap.className = 'playlist-title-wrap';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'playlist-title-input';
    titleInput.value = sanitizePlaylistName(playlistNames[playlistIndex], playlistIndex);
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

    if (metaEntry.type === PLAYLIST_TYPE_FOLDER) {
      const folderIcon = document.createElement('span');
      folderIcon.className = 'playlist-folder-icon';
      folderIcon.innerHTML =
        '<svg viewBox="0 0 24 18" aria-hidden="true" focusable="false"><path d="M1.5 16.5V3.5h7l2 2h12v11z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M1.5 5.5h21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      const originalFolderName = sanitizeFolderOriginalName(metaEntry.folderOriginalName, metaEntry.folderKey);
      folderIcon.title = originalFolderName || metaEntry.folderKey || 'Папка';
      folderIcon.setAttribute('aria-label', 'Плей-лист папки');
      titleWrap.appendChild(folderIcon);
    }

    titleWrap.appendChild(titleInput);

    const count = document.createElement('span');
    count.className = 'playlist-count';
    count.textContent = `${playlistFiles.length}`;

    const headerMeta = document.createElement('div');
    headerMeta.className = 'playlist-header-meta';

    const autoplayButton = document.createElement('button');
    autoplayButton.type = 'button';
    autoplayButton.className = 'playlist-autoplay-toggle';
    autoplayButton.textContent = 'A';
    autoplayButton.setAttribute('aria-label', 'Автовоспроизведение плей-листа');
    const isAutoplayEnabled = Boolean(playlistAutoplay[playlistIndex]);
    const isDspEnabled = Boolean(playlistDsp[playlistIndex]);
    const canManageAutoplay = isHostRole();
    const canManageDsp = canManageAutoplay && isAutoplayEnabled;
    autoplayButton.dataset.state = isAutoplayEnabled ? 'on' : 'off';
    autoplayButton.setAttribute('aria-pressed', isAutoplayEnabled ? 'true' : 'false');
    autoplayButton.title = canManageAutoplay
      ? `Автовоспроизведение: ${isAutoplayEnabled ? 'вкл' : 'выкл'}`
      : `Автовоспроизведение: ${isAutoplayEnabled ? 'вкл' : 'выкл'} (только хост)`;
    autoplayButton.classList.toggle('is-on', isAutoplayEnabled);
    autoplayButton.disabled = !canManageAutoplay;
    autoplayButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canManageAutoplay) return;
      togglePlaylistAutoplay(playlistIndex);
    });

    const dspButton = document.createElement('button');
    dspButton.type = 'button';
    dspButton.className = 'playlist-dsp-toggle';
    dspButton.textContent = 'DSP';
    dspButton.setAttribute('aria-label', 'DSP переходы для плей-листа');
    dspButton.dataset.state = isDspEnabled ? 'on' : 'off';
    dspButton.setAttribute('aria-pressed', isDspEnabled ? 'true' : 'false');
    dspButton.classList.toggle('is-on', isDspEnabled);
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
    activeReel.title = 'Активный плей-лист';
    activeReel.setAttribute('aria-hidden', 'true');
    activeReel.style.display = 'none';

    headerMeta.append(autoplayButton, dspButton, count, deleteButton, activeReel);
    header.append(titleWrap, headerMeta);

    const body = document.createElement('div');
    body.className = 'zone-body';

    playlistFiles.forEach((file, rowIndex) => {
      const canDeleteTrack = (trackOccurrence.get(file) || 0) > 1;
      body.appendChild(
        buildTrackCard(file, '/audio', {
          draggable: true,
          orderNumber: rowIndex + 1,
          playlistIndex,
          playlistPosition: rowIndex,
          canDelete: canDeleteTrack,
        }),
      );
    });

    body.addEventListener('dragover', (e) => applyDragPreview(body, e));

    zone.append(header, body);
    zonesContainer.appendChild(zone);
  });

  syncPlaylistHeaderActiveState();
  syncCurrentTrackState();
}

function syncCurrentTrackState() {
  if (currentTrack) {
    const isPlaying = Boolean(currentAudio && !currentAudio.paused);
    setButtonPlaying(currentTrack.key, isPlaying, currentTrack);
    setTrackPaused(currentTrack.key, !isPlaying && Boolean(currentAudio), currentTrack);
  }
  syncDspTransitionTrackHighlight();
  syncLiveDspNextTrackHighlight();
  syncPlaylistHeaderActiveState();
  syncNowPlayingPanel();
  syncHostNowPlayingPanel();
}

async function handleDrop(event, targetZoneIndex) {
  event.preventDefault();
  if (!draggingCard || !dragContext) {
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
  dragDropHandled = true;

  const previousLayout = cloneLayoutState(layout);
  const previousNames = playlistNames.slice();
  const previousMeta = clonePlaylistMetaState(playlistMeta);
  const previousAutoplay = playlistAutoplay.slice();
  const previousDsp = playlistDsp.slice();
  const isCopyDrop = isActiveCopyDrag(event, targetZoneIndex);

  let nextLayout;
  if (isCopyDrop) {
    if (!dragContext.file) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }
    nextLayout = cloneLayoutState(dragContext.snapshotLayout);
    if (!Array.isArray(nextLayout[targetZoneIndex])) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }

    const targetBody = targetZone.querySelector('.zone-body');
    const cards = targetBody ? Array.from(targetBody.querySelectorAll('.track-card')) : [];
    const dropReferenceCard = dragPreviewCard || draggingCard;
    const droppedIndexWithoutSource = cards.indexOf(dropReferenceCard);
    const fallbackIndex = nextLayout[targetZoneIndex].length;
    let insertIndex = droppedIndexWithoutSource === -1 ? fallbackIndex : droppedIndexWithoutSource;
    const sourceCardPresentInTarget = cards.includes(draggingCard);

    if (
      dragContext.sourceZoneIndex === targetZoneIndex &&
      Number.isInteger(dragContext.sourceIndex) &&
      dragContext.sourceIndex >= 0 &&
      !sourceCardPresentInTarget &&
      insertIndex >= dragContext.sourceIndex
    ) {
      insertIndex += 1;
    }

    insertIndex = Math.max(0, Math.min(insertIndex, nextLayout[targetZoneIndex].length));
    nextLayout[targetZoneIndex].splice(insertIndex, 0, dragContext.file);
  } else {
    clearDragPreviewCard();
    syncLayoutFromDom();
    nextLayout = cloneLayoutState(layout);
  }

  hideTrashDropzone();
  clearDragModeBadge();
  clearDragPreviewCard();
  layout = ensurePlaylists(nextLayout);
  playlistNames = normalizePlaylistNames(previousNames, layout.length);
  playlistMeta = normalizePlaylistMeta(previousMeta, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(previousAutoplay, layout.length);
  playlistDsp = normalizePlaylistDspFlags(previousDsp, playlistAutoplay, layout.length);
  renderZones();
  try {
    await pushSharedLayout();
    setStatus(isCopyDrop ? 'Трек продублирован и синхронизирован.' : 'Плей-листы обновлены и синхронизированы.');
  } catch (err) {
    console.error(err);
    layout = previousLayout;
    playlistNames = normalizePlaylistNames(previousNames, layout.length);
    playlistMeta = normalizePlaylistMeta(previousMeta, layout.length);
    playlistAutoplay = normalizePlaylistAutoplayFlags(previousAutoplay, layout.length);
    playlistDsp = normalizePlaylistDspFlags(previousDsp, playlistAutoplay, layout.length);
    renderZones();
    setStatus(isCopyDrop ? 'Не удалось синхронизировать копирование трека.' : 'Не удалось синхронизировать плей-листы.');
  }
}

async function fetchFileList(url, { logErrors = true } = {}) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Не удалось получить список файлов');
    const data = await res.json();
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
  clearLayoutStreamConnection();
  const catalogResult = audioResult || (await fetchFileList('/api/audio'));
  resetTrackReferences();

  if (!catalogResult.ok) {
    renderEmpty();
    syncCurrentTrackState();
    setStatus('Ошибка загрузки списка файлов. Проверьте сервер.');
    return;
  }

  audioCatalogSignature = buildAudioCatalogSignature(catalogResult.files, catalogResult.folders);
  availableFiles = catalogResult.files;
  availableFolders = normalizeAudioFolderTemplates(catalogResult.folders, availableFiles);
  keepKnownDurationsForFiles(availableFiles);
  keepKnownTrackAttributesForFiles(availableFiles, '/audio');
  keepTrackTitleModesForFiles(availableFiles, '/audio');
  preloadTrackDurations(availableFiles);
  preloadTrackAttributesForConfiguredTracks(availableFiles, '/audio');

  if (!availableFiles.length) {
    renderEmpty();
    syncCurrentTrackState();
    setStatus('Файлы не найдены. Добавьте аудио в папку /audio и обновите страницу.');
    return;
  }

  try {
    await initializeLayoutState();
  } catch (err) {
    console.error(err);
    const fallback = ensureFolderPlaylistsCoverage([availableFiles.filter((file) => !file.includes('/'))], [], []);
    layout = normalizeLayoutForFiles(fallback.layout, availableFiles);
    playlistNames = normalizePlaylistNames(fallback.playlistNames, layout.length);
    playlistMeta = normalizePlaylistMeta(fallback.playlistMeta, layout.length);
    playlistAutoplay = normalizePlaylistAutoplayFlags([], layout.length);
    playlistDsp = normalizePlaylistDspFlags([], playlistAutoplay, layout.length);
    setStatus('Не удалось загрузить состояние плей-листов, используется локальная раскладка.');
  }

  try {
    await initializePlaybackState();
  } catch (err) {
    console.error(err);
    hostPlaybackState = getDefaultHostPlaybackState();
    setLivePlaybackVolume(hostPlaybackState.volume, { sync: false, announce: false });
  }

  renderZones();
  syncCurrentTrackState();
  setStatus(getTrackReloadStatusMessage(reason, availableFiles.length));
  connectLayoutStream();
}

function requestTracksReload({ reason = 'manual', audioResult = null } = {}) {
  if (tracksReloadInFlight) {
    tracksReloadQueued = true;
    if (reason === 'manual') {
      tracksReloadQueuedReason = 'manual';
    }
    return;
  }

  tracksReloadInFlight = true;
  setPlaylistControlsLoading(true);

  loadTracks({ reason, audioResult })
    .catch((err) => {
      console.error('Не удалось обновить список треков', err);
      setStatus('Не удалось обновить список треков.');
    })
    .finally(() => {
      tracksReloadInFlight = false;
      setPlaylistControlsLoading(false);

      if (!tracksReloadQueued) return;
      const queuedReason = tracksReloadQueuedReason === 'manual' ? 'manual' : 'auto';
      tracksReloadQueued = false;
      tracksReloadQueuedReason = 'auto';
      requestTracksReload({ reason: queuedReason });
    });
}

async function pollAudioCatalogChanges() {
  if (audioCatalogPollInFlight || tracksReloadInFlight) return;
  if (!audioCatalogSignature) return;

  audioCatalogPollInFlight = true;
  try {
    const catalogResult = await fetchFileList('/api/audio', { logErrors: false });
    if (!catalogResult.ok) return;

    const nextSignature = buildAudioCatalogSignature(catalogResult.files, catalogResult.folders);
    if (nextSignature === audioCatalogSignature) return;

    requestTracksReload({ reason: 'auto', audioResult: catalogResult });
  } finally {
    audioCatalogPollInFlight = false;
  }
}

function startAudioCatalogAutoRefresh() {
  stopAudioCatalogAutoRefresh();
  audioCatalogPollTimer = setInterval(() => {
    pollAudioCatalogChanges();
  }, AUDIO_CATALOG_POLL_INTERVAL_MS);
}

function stopAudioCatalogAutoRefresh() {
  if (audioCatalogPollTimer !== null) {
    clearInterval(audioCatalogPollTimer);
    audioCatalogPollTimer = null;
  }
}

function resetFadeState() {
  fadeCancel.cancelled = true;
  fadeCancel = { cancelled: false };
}

function fadeOutAndStop(audio, durationSeconds, curve, track) {
  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    if (!audio) return resolve();
    const duration = Math.max(0, durationSeconds || 0) * 1000;
    if (duration === 0) {
      audio.pause();
      audio.currentTime = 0;
      setButtonPlaying(track.key, false, track);
      setTrackPaused(track.key, false, track);
      stopProgressLoop();
      resetProgress(track.key);
      if (currentTrack && currentTrack.key === track.key) {
        currentAudio = null;
        currentTrack = null;
      }
      syncNowPlayingPanel();
      requestHostPlaybackSync(true);
      return safeResolve();
    }
    resetFadeState();
    const token = fadeCancel;
    const start = performance.now();
    const startVolume = clampVolume(audio.volume);

    function step(now) {
      if (token.cancelled) return safeResolve();
      const progress = Math.min((now - start) / duration, 1);
      const eased = easing(progress, curve);
      audio.volume = clampVolume(startVolume * (1 - eased));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        audio.pause();
        audio.currentTime = 0;
        setButtonPlaying(track.key, false, track);
        setTrackPaused(track.key, false, track);
        stopProgressLoop();
        resetProgress(track.key);
        if (currentTrack && currentTrack.key === track.key) {
          currentAudio = null;
          currentTrack = null;
        }
        syncNowPlayingPanel();
        requestHostPlaybackSync(true);
        safeResolve();
      }
    }

    requestAnimationFrame(step);
  });
}

function fadeOutAndPause(audio, durationSeconds, curve) {
  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (pausedWithFade) => {
      if (settled) return;
      settled = true;
      resolve(pausedWithFade);
    };

    if (!audio) return safeResolve(false);
    const duration = Math.max(0, durationSeconds || 0) * 1000;
    if (duration === 0) {
      audio.pause();
      return safeResolve(true);
    }

    resetFadeState();
    const token = fadeCancel;
    const start = performance.now();
    const startVolume = clampVolume(audio.volume);

    function step(now) {
      if (token.cancelled) return safeResolve(false);
      const progress = Math.min((now - start) / duration, 1);
      const eased = easing(progress, curve);
      audio.volume = clampVolume(startVolume * (1 - eased));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        audio.pause();
        audio.volume = startVolume;
        safeResolve(true);
      }
    }

    requestAnimationFrame(step);
  });
}

async function pauseCurrentPlayback(track, audio) {
  if (!track || !audio) return false;

  const stopFadeSeconds = getStopFadeSeconds();
  const curve = getTransitionCurve();

  if (!audio.paused && stopFadeSeconds > 0) {
    const pausedWithFade = await fadeOutAndPause(audio, stopFadeSeconds, curve);
    if (!pausedWithFade) return false;
  } else if (!audio.paused) {
    audio.pause();
  }

  stopProgressLoop();
  setButtonPlaying(track.key, false, track);
  setTrackPaused(track.key, true, track);
  setStatus(`Пауза: ${track.file}`);
  return true;
}

function shouldTriggerAutoplayOverlayTransition(audio, track) {
  if (!audio || !track) return false;
  if (!isHostRole()) return false;
  if (audio.paused) return false;
  if (currentAudio !== audio) return false;
  if (!currentTrack || currentTrack.key !== track.key) return false;
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return false;
  if (!Number.isFinite(audio.currentTime) || audio.currentTime < 0) return false;

  const nextTrack = resolveAutoplayNextTrack(track);
  if (!nextTrack) return false;

  const overlaySeconds = Math.max(0, getOverlaySeconds());
  const readyDspSliceWindowSeconds = resolveReadyDspSliceWindowSeconds(nextTrack);
  const triggerWindowSeconds = Number.isFinite(readyDspSliceWindowSeconds)
    ? Math.max(overlaySeconds, readyDspSliceWindowSeconds)
    : overlaySeconds;
  if (triggerWindowSeconds <= 0) return false;

  const remainingSeconds = audio.duration - audio.currentTime;
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return false;

  return remainingSeconds <= triggerWindowSeconds + AUTOPLAY_OVERLAY_TRIGGER_EPSILON_SECONDS;
}

function maybeTriggerAutoplayOverlayTransition(audio, track) {
  if (!shouldTriggerAutoplayOverlayTransition(audio, track)) return;
  if (audio.dataset.autoplayOverlayState !== AUTOPLAY_OVERLAY_STATE_IDLE) return;

  audio.dataset.autoplayOverlayState = AUTOPLAY_OVERLAY_STATE_PENDING;
  tryAutoplayNextTrack(track)
    .then((started) => {
      audio.dataset.autoplayOverlayState = started
        ? AUTOPLAY_OVERLAY_STATE_STARTED
        : AUTOPLAY_OVERLAY_STATE_FAILED;
    })
    .catch((err) => {
      audio.dataset.autoplayOverlayState = AUTOPLAY_OVERLAY_STATE_FAILED;
      console.error('Autoplay overlay transition failed', err);
    });
}

function createAudio(track) {
  const { file, basePath, key } = track;
  const encoded = encodeURIComponent(file);
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const audio = new Audio(`${normalizedBase}/${encoded}`);
  audio.preload = 'metadata';
  audio.load();
  audio.dataset.autoplayOverlayState = AUTOPLAY_OVERLAY_STATE_IDLE;

  audio.addEventListener('timeupdate', () => {
    maybeTriggerAutoplayOverlayTransition(audio, track);
  });

  audio.addEventListener('ended', () => {
    const wasCurrentTrack = Boolean(currentTrack && currentTrack.key === key);

    if (wasCurrentTrack) {
      currentAudio = null;
      currentTrack = null;
      resetLiveDspNextTrackPreview();
    }
    setButtonPlaying(key, false, track);
    setTrackPaused(key, false, track);
    stopProgressLoop();
    resetProgress(key);
    syncNowPlayingPanel();
    requestHostPlaybackSync(true);

    if (!wasCurrentTrack) return;
    if (
      audio.dataset.autoplayOverlayState === AUTOPLAY_OVERLAY_STATE_PENDING ||
      audio.dataset.autoplayOverlayState === AUTOPLAY_OVERLAY_STATE_STARTED
    ) {
      return;
    }

    tryAutoplayNextTrack(track)
      .then((started) => {
        if (!started) {
          setStatus(`Воспроизведение завершено: ${file}`);
        }
      })
      .catch((err) => {
        console.error('Autoplay failed', err);
        setStatus(`Воспроизведение завершено: ${file}`);
      });
  });

  audio.addEventListener('error', () => {
    setStatus(`Ошибка воспроизведения: ${file}`);
    setButtonPlaying(key, false, track);
    setTrackPaused(key, false, track);
    stopProgressLoop();
    resetProgress(key);
    if (currentTrack && currentTrack.key === key) {
      currentAudio = null;
      currentTrack = null;
      resetLiveDspNextTrackPreview();
    }
    syncNowPlayingPanel();
    requestHostPlaybackSync(true);
  });

  bindProgress(audio, key);
  return audio;
}

function applyOverlay(oldAudio, newAudio, targetVolume, overlaySeconds, curve, newTrack, oldTrack) {
  const safeTargetVolume = clampVolume(targetVolume);
  const start = performance.now();
  const duration = overlaySeconds * 1000;
  const initialOldVolume = clampVolume(oldAudio ? oldAudio.volume : 1);
  resetFadeState();
  const token = fadeCancel;

  function step(now) {
    if (token.cancelled) return;
    const progress = Math.min((now - start) / duration, 1);
    const eased = easing(progress, curve);
    newAudio.volume = clampVolume(safeTargetVolume * eased);
    if (oldAudio) {
      oldAudio.volume = clampVolume(initialOldVolume * (1 - eased));
    }
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      if (oldAudio) {
        oldAudio.pause();
        oldAudio.currentTime = 0;
        oldAudio.volume = initialOldVolume;
        if (oldTrack) {
          setButtonPlaying(oldTrack.key, false, oldTrack);
          setTrackPaused(oldTrack.key, false, oldTrack);
        }
      }
      currentAudio = newAudio;
      currentTrack = newTrack;
      setButtonPlaying(newTrack.key, true, newTrack);
      setTrackPaused(newTrack.key, false, newTrack);
      startProgressLoop(newAudio, newTrack.key);
      setStatus(`Играет: ${newTrack.file}`);
      syncNowPlayingPanel();
      requestHostPlaybackSync(true);
    }
  }

  requestAnimationFrame(step);
}

async function handlePlay(file, button, basePath = '/audio', playbackContext = {}) {
  const overlaySeconds = getOverlaySeconds();
  const curve = getTransitionCurve();
  const targetVolume = getEffectiveLiveVolume();
  const startAtSeconds = normalizeAudioStartOffsetSeconds(playbackContext.startAtSeconds);
  const resolvedPlaylistIndex =
    Number.isInteger(playbackContext.playlistIndex) && playbackContext.playlistIndex >= 0
      ? playbackContext.playlistIndex
      : null;
  const resolvedPlaylistPosition =
    Number.isInteger(playbackContext.playlistPosition) && playbackContext.playlistPosition >= 0
      ? playbackContext.playlistPosition
      : null;
  const track = {
    file,
    basePath,
    key: trackKey(file, basePath),
    playlistIndex: resolvedPlaylistIndex,
    playlistPosition: resolvedPlaylistPosition,
  };

  button.disabled = true;

  if (isDspTransitionPlaybackActive()) {
    stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
    resetLiveDspNextTrackPreview();
  }

  if (isCoHostRole()) {
    try {
      await requestCoHostPlayTrack(file, basePath, {
        playlistIndex: resolvedPlaylistIndex,
        playlistPosition: resolvedPlaylistPosition,
      });
      setStatus(`Live-команда отправлена: ${file}`);
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось отправить live-команду.');
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (currentTrack && currentTrack.key === track.key && currentAudio && !currentAudio.paused) {
    await pauseCurrentPlayback(track, currentAudio);
    syncNowPlayingPanel();
    requestHostPlaybackSync(true);
    button.disabled = false;
    return;
  }

  if (currentTrack && currentTrack.key === track.key && currentAudio && currentAudio.paused) {
    try {
      setTrackPaused(track.key, false, track);
      await currentAudio.play();
      setButtonPlaying(track.key, true, track);
      startProgressLoop(currentAudio, track.key);
      setStatus(`Играет: ${file}`);
      triggerLiveDspTransitionForTrack(track);
    } catch (err) {
      console.error(err);
      setStatus('Не удалось продолжить воспроизведение.');
      setButtonPlaying(track.key, false, track);
      setTrackPaused(track.key, true, track);
    } finally {
      syncNowPlayingPanel();
      requestHostPlaybackSync(true);
      button.disabled = false;
    }
    return;
  }

  const audio = createAudio(track);
  audio.dataset.filename = file;
  audio.volume = overlaySeconds > 0 && currentAudio && !currentAudio.paused ? 0 : targetVolume;

  try {
    if (startAtSeconds !== null) {
      await seekAudioToOffset(audio, startAtSeconds);
    }
    await audio.play();

    if (currentAudio && !currentAudio.paused && overlaySeconds > 0) {
      const oldTrack = currentTrack;
      setButtonPlaying(track.key, true, track);
      setTrackPaused(track.key, false, track);
      startProgressLoop(audio, track.key);
      triggerLiveDspTransitionForTrack(track);
      applyOverlay(currentAudio, audio, targetVolume, overlaySeconds, curve, track, oldTrack);
    } else {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        if (currentTrack) {
          setButtonPlaying(currentTrack.key, false, currentTrack);
          setTrackPaused(currentTrack.key, false, currentTrack);
        }
      }
      resetFadeState();
      audio.volume = targetVolume;
      currentAudio = audio;
      currentTrack = track;
      setButtonPlaying(track.key, true, track);
      setTrackPaused(track.key, false, track);
      startProgressLoop(audio, track.key);
      setStatus(`Играет: ${file}`);
      triggerLiveDspTransitionForTrack(track);
      syncNowPlayingPanel();
      requestHostPlaybackSync(true);
    }
  } catch (err) {
    console.error(err);
    setStatus('Не удалось начать воспроизведение.');
    setButtonPlaying(track.key, false, track);
    setTrackPaused(track.key, false, track);
    stopProgressLoop();
    resetProgress(track.key);
    syncNowPlayingPanel();
    requestHostPlaybackSync(true);
  } finally {
    button.disabled = false;
  }
}

function initSettings() {
  loadTrackTitleModesByTrackSetting();

  overlayTimeInput.value = loadSetting(SETTINGS_KEYS.overlayTime, '0.3');
  overlayCurveSelect.value = loadSetting(SETTINGS_KEYS.overlayCurve, 'linear');
  stopFadeInput.value = loadSetting(SETTINGS_KEYS.stopFade, '0.4');
  if (overlayEnabledToggle) {
    overlayEnabledToggle.checked = loadBooleanSetting(SETTINGS_KEYS.overlayEnabled, true);
  }
  if (stopFadeEnabledToggle) {
    stopFadeEnabledToggle.checked = loadBooleanSetting(SETTINGS_KEYS.stopFadeEnabled, true);
  }
  updateTransitionSettingsUi();

  overlayTimeInput.addEventListener('change', () => {
    const sanitized = Math.max(0, parseFloat(overlayTimeInput.value) || 0).toString();
    overlayTimeInput.value = sanitized;
    saveSetting(SETTINGS_KEYS.overlayTime, sanitized);
  });

  stopFadeInput.addEventListener('change', () => {
    const sanitized = Math.max(0, parseFloat(stopFadeInput.value) || 0).toString();
    stopFadeInput.value = sanitized;
    saveSetting(SETTINGS_KEYS.stopFade, sanitized);
  });

  overlayCurveSelect.addEventListener('change', () => {
    saveSetting(SETTINGS_KEYS.overlayCurve, overlayCurveSelect.value);
  });

  if (overlayEnabledToggle) {
    overlayEnabledToggle.addEventListener('change', () => {
      saveSetting(SETTINGS_KEYS.overlayEnabled, overlayEnabledToggle.checked ? 'true' : 'false');
      updateTransitionSettingsUi();
    });
  }

  if (stopFadeEnabledToggle) {
    stopFadeEnabledToggle.addEventListener('change', () => {
      saveSetting(SETTINGS_KEYS.stopFadeEnabled, stopFadeEnabledToggle.checked ? 'true' : 'false');
      updateTransitionSettingsUi();
    });
  }
}

function setSidebarOpen(isOpen) {
  if (!sidebar || !sidebarToggle) return;
  sidebar.classList.toggle('collapsed', !isOpen);
  sidebarToggle.textContent = isOpen ? '⟨' : '☰';
  saveSetting(SETTINGS_KEYS.sidebarOpen, isOpen ? '1' : '0');
}

function initSidebarToggle() {
  const saved = loadSetting(SETTINGS_KEYS.sidebarOpen, '1');
  setSidebarOpen(saved !== '0');
  sidebarToggle.addEventListener('click', () => {
    const openNow = !sidebar.classList.contains('collapsed');
    setSidebarOpen(!openNow);
  });
}

async function stopServer({ requireConfirmation = true } = {}) {
  if (!isHostRole()) {
    setStatus('Остановку сервера может выполнить только хост (live).');
    return;
  }

  if (requireConfirmation) {
    const confirmed = window.confirm('Остановить сервер? Все подключенные клиенты будут отключены.');
    if (!confirmed) {
      setStatus('Остановка сервера отменена.');
      return;
    }
  }

  if (stopServerBtn) {
    stopServerBtn.disabled = true;
  }
  setStatus('Останавливаем сервер...');

  try {
    const res = await fetch('/api/shutdown', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message = data && (data.error || data.message);
      throw new Error(message || 'Request failed');
    }
    setStatus('Сервер останавливается. Окно будет закрыто.');
    setTimeout(() => {
      try {
        window.open('', '_self');
        window.close();
      } catch (err) {
        console.error('Не удалось закрыть окно', err);
      }
    }, 300);
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Не удалось остановить сервер. Попробуйте ещё раз.');
    if (stopServerBtn) {
      stopServerBtn.disabled = false;
    }
  }
}

async function logoutClient({ requireConfirmation = true } = {}) {
  if (isHostRole()) return;
  if (!clientLogoutBtn) return;

  if (requireConfirmation) {
    const confirmed = window.confirm('Отключиться от сервера? Понадобится повторный вход.');
    if (!confirmed) {
      setStatus('Отключение отменено.');
      return;
    }
  }

  clientLogoutBtn.disabled = true;
  setStatus('Отключаемся...');

  try {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data && (data.error || data.message);
      throw new Error(message || 'Не удалось отключиться');
    }

    clearLayoutStreamConnection();
    stopHostProgressLoop();
    stopCoHostProgressLoop();
    stopAndClearLocalPlayback();

    currentUser = null;
    authUsersState = [];
    applyRoleUi(ROLE_SLAVE);
    setStatus('Вы отключены. Войдите снова.');

    ensureAuthorizedUser()
      .then((authorized) => {
        if (!authorized) return;
        connectLayoutStream();
      })
      .catch((err) => {
        console.error(err);
      });
  } catch (err) {
    console.error(err);
    setStatus(err && err.message ? err.message : 'Не удалось отключиться.');
    clientLogoutBtn.disabled = false;
  }
}

function initServerControls() {
  if (stopServerBtn) {
    stopServerBtn.addEventListener('click', () => {
      stopServer({ requireConfirmation: true });
    });
  }

  if (clientLogoutBtn) {
    clientLogoutBtn.addEventListener('click', () => {
      logoutClient({ requireConfirmation: true });
    });
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

  setPlaylistControlsLoading(false);
}

async function onVolumePresetButtonClick(event) {
  const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const presetVolume = normalizeLiveVolumePreset(button ? button.dataset.volume : null, null);
  if (presetVolume === null) return;

  const activePreset = getActiveVolumePresetValue();
  const shouldTurnOffPreset = activePreset !== null && Math.abs(activePreset - presetVolume) < 0.0001;
  const targetVolume = shouldTurnOffPreset ? DEFAULT_LIVE_VOLUME : presetVolume;

  if (isHostRole()) {
    setLivePlaybackVolume(targetVolume, { sync: true, announce: true });
    return;
  }

  if (!isCoHostRole()) return;

  const previousVolume = getEffectiveLiveVolume();
  setLivePlaybackVolume(targetVolume, { sync: false, announce: false });
  try {
    await requestCoHostSetLiveVolume(targetVolume);
    setStatus(`Live громкость: ${formatVolumePresetLabel(targetVolume)}.`);
  } catch (err) {
    console.error(err);
    const fallbackVolume = normalizeLiveVolumePreset(hostPlaybackState.volume, previousVolume);
    setLivePlaybackVolume(fallbackVolume, { sync: false, announce: false });
    setStatus(err && err.message ? err.message : 'Не удалось изменить live-громкость.');
  }
}

function initVolumePresetControls() {
  if (isHostRole()) {
    setShowVolumePresetsEnabled(loadBooleanSetting(SETTINGS_KEYS.showVolumePresets, false), {
      persist: false,
      sync: false,
    });
  } else {
    setShowVolumePresetsEnabled(false, { persist: false, sync: false });
  }

  if (showVolumePresetsToggle) {
    showVolumePresetsToggle.checked = showVolumePresetsEnabled;
    showVolumePresetsToggle.addEventListener('change', async () => {
      const nextEnabled = Boolean(showVolumePresetsToggle.checked);
      if (!nextEnabled && !canDisableVolumePresetsSetting()) {
        showVolumePresetsToggle.checked = true;
        setStatus('Сначала выключите активный пресет громкости.');
        updateVolumePresetsUi();
        return;
      }

      if (isHostRole()) {
        setShowVolumePresetsEnabled(nextEnabled, { persist: true, sync: true });
        return;
      }

      if (!isCoHostRole()) {
        setShowVolumePresetsEnabled(nextEnabled, { persist: false, sync: false });
        return;
      }

      const previousEnabled = showVolumePresetsEnabled;
      setShowVolumePresetsEnabled(nextEnabled, { persist: false, sync: false });
      try {
        await requestCoHostSetVolumePresetsVisibility(nextEnabled);
        setStatus(`Пресеты громкости ${nextEnabled ? 'включены' : 'выключены'} на live.`);
      } catch (err) {
        console.error(err);
        setShowVolumePresetsEnabled(previousEnabled, { persist: false, sync: false });
        setStatus(err && err.message ? err.message : 'Не удалось изменить режим пресетов громкости.');
      }
    });
  }

  if (isHostRole()) {
    requestHostPlaybackSync(true);
  }

  updateVolumePresetsUi();
}

function initLiveSeekControls() {
  if (isHostRole()) {
    setLiveSeekEnabled(loadBooleanSetting(SETTINGS_KEYS.liveSeekEnabled, false), {
      persist: false,
      sync: false,
    });
  } else {
    setLiveSeekEnabled(false, { persist: false, sync: false });
  }

  if (liveSeekEnabledToggle) {
    liveSeekEnabledToggle.checked = liveSeekEnabled;
    liveSeekEnabledToggle.addEventListener('change', async () => {
      const nextEnabled = Boolean(liveSeekEnabledToggle.checked);

      if (!isHostRole()) {
        setLiveSeekEnabled(hostPlaybackState.allowLiveSeek, { persist: false, sync: false });
        setStatus('Только хост может менять настройку live seek.');
        return;
      }

      setLiveSeekEnabled(nextEnabled, { persist: true, sync: true, announce: true });
    });
  }

  updateLiveSeekUi();
}

function initNowPlayingControls() {
  if (!nowPlayingControlBtn) return;
  nowPlayingControlBtn.addEventListener('pointerdown', onNowPlayingControlPointerDown);
  nowPlayingControlBtn.addEventListener('click', onNowPlayingControlClick);
  initLiveSeekControls();
  initVolumePresetControls();
  syncNowPlayingPanel();
  syncHostNowPlayingPanel();
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

function initUpdater() {
  if (allowPrereleaseInput) {
    allowPrereleaseInput.checked = loadBooleanSetting(SETTINGS_KEYS.allowPrerelease, false);
    allowPrereleaseInput.addEventListener('change', () => {
      if (!isHostRole()) {
        allowPrereleaseInput.checked = false;
        return;
      }
      saveSetting(SETTINGS_KEYS.allowPrerelease, allowPrereleaseInput.checked ? 'true' : 'false');
      checkForUpdates();
    });
  }

  updatePrereleaseSettingUi();

  if (updateButton) {
    updateButton.addEventListener('click', applyUpdate);
  }
  checkForUpdates();
}

async function loadVersion() {
  if (!appVersionEl) return;

  try {
    const res = await fetch('/api/version');
    if (!res.ok) {
      throw new Error('Request failed');
    }
    const data = await res.json();
    if (data && data.version) {
      appVersionEl.textContent = `Версия: ${data.version}`;
    } else {
      appVersionEl.textContent = 'Версия: неизвестна';
    }
  } catch (err) {
    console.error('Не удалось загрузить версию приложения', err);
    appVersionEl.textContent = 'Версия: неизвестна';
  }
}

function showUpdateBlock(isVisible) {
  if (!updateInfoEl) return;
  updateInfoEl.hidden = !isVisible;
}

function resetUpdateUi() {
  setUpdateMessage('');
  setUpdateStatus('');
  setReleaseLink(null);
  if (updateButton) {
    updateButton.disabled = true;
  }
  showUpdateBlock(false);
}

function setReleaseLink(url, label = 'Релиз') {
  if (!releaseLinkEl) return;
  if (url) {
    releaseLinkEl.href = url;
    releaseLinkEl.textContent = label;
    releaseLinkEl.style.display = 'inline';
  } else {
    releaseLinkEl.style.display = 'none';
  }
}

function setUpdateMessage(text) {
  if (!updateMessageEl) return;
  updateMessageEl.textContent = text;
}

function setUpdateStatus(text) {
  if (!updateStatusEl) return;
  updateStatusEl.textContent = text;
}

function startShutdownCountdown(seconds = 20) {
  let remaining = Math.max(0, Math.floor(seconds));

  if (shutdownCountdownTimer) {
    clearTimeout(shutdownCountdownTimer);
    shutdownCountdownTimer = null;
  }

  const tick = () => {
    if (remaining <= 0) {
      shutdownCountdownTimer = null;
      stopServer({ requireConfirmation: false });
      return;
    }

    setUpdateMessage(`Приложение будет закрыто через ${remaining} с.`);
    remaining -= 1;
    shutdownCountdownTimer = setTimeout(tick, 1000);
  };

  tick();
}

async function checkForUpdates() {
  if (!updateInfoEl || !updateMessageEl || !updateButton) return;

  resetUpdateUi();

  const allowPrerelease = Boolean(isHostRole() && allowPrereleaseInput && allowPrereleaseInput.checked);

  try {
    const res = await fetch(`/api/update/check?allowPrerelease=${allowPrerelease ? 'true' : 'false'}`);
    if (!res.ok) {
      throw new Error('Request failed');
    }
    const data = await res.json();

    if (data && data.currentVersion && appVersionEl) {
      appVersionEl.textContent = `Версия: ${data.currentVersion}`;
    }

    if (data && data.hasUpdate && data.latestVersion) {
      const releaseLabel = data.releaseName || `v${data.latestVersion}`;
      setUpdateMessage(`Доступен релиз: ${releaseLabel}`);
      setReleaseLink(data.releaseUrl || null, releaseLabel);
      updateButton.disabled = false;
      showUpdateBlock(true);
    }
  } catch (err) {
    console.error('Не удалось проверить обновления', err);
    resetUpdateUi();
  }
}

async function applyUpdate() {
  if (!updateButton) return;

  updateButton.disabled = true;
  setUpdateStatus('Скачиваем и устанавливаем обновление...');

  const allowPrerelease = Boolean(isHostRole() && allowPrereleaseInput && allowPrereleaseInput.checked);

  try {
    const res = await fetch(`/api/update/apply?allowPrerelease=${allowPrerelease ? 'true' : 'false'}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = data && (data.error || data.message);
      throw new Error(message || 'Не удалось выполнить запрос');
    }

    const message = (data && (data.message || data.error)) || 'Обновление выполнено';
    const installed = res.ok && typeof message === 'string' && message.toLowerCase().includes('обновление установлено');

    if (installed) {
      setUpdateStatus('Обновление установлено.');
      startShutdownCountdown(20);
      return;
    }

    setUpdateStatus(message);
  } catch (err) {
    console.error('Ошибка при обновлении', err);
    setUpdateStatus(err.message);
    updateButton.disabled = false;
  }
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
  initDspSetupPanel();
  initPlaylistControls();
  initTouchFullscreenToggle();
  initNowPlayingControls();
  initZonesPanControls();
  initUpdater();
  startAudioCatalogAutoRefresh();
  window.addEventListener('beforeunload', () => {
    if (touchFullscreenToggleBtn) {
      touchFullscreenToggleBtn.removeEventListener('click', toggleTouchFullscreenMode);
    }
    document.removeEventListener('fullscreenchange', updateTouchFullscreenToggleState);
    document.removeEventListener('webkitfullscreenchange', updateTouchFullscreenToggleState);
    stopAudioCatalogAutoRefresh();
    clearLayoutStreamConnection();
    stopHostProgressLoop();
    stopCoHostProgressLoop();
    clearQueuedCoHostSeekCommands();
    cleanupNowPlayingSeekInteraction();
    stopZonesPanMomentum();
    stopZonesWheelSmoothScroll();
    cleanupZonesPanInteraction();
    cleanupZonesTouchPanInteraction();
    clearTouchCopyHold();
    if (touchCopyDragActive) {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
  });
  requestTracksReload({ reason: 'initial' });
  loadVersion();
  document.addEventListener('dragover', handleGlobalDragOver);
}

bootstrap();
