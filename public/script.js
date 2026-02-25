const zonesContainer = document.getElementById('zones');
const statusEl = document.getElementById('status');
const addPlaylistBtn = document.getElementById('addPlaylist');
const refreshPlaylistsBtn = document.getElementById('refreshPlaylists');
const touchFullscreenToggleBtn = document.getElementById('touchFullscreenToggle');
const overlayTimeInput = document.getElementById('overlayTime');
const overlayCurveSelect = document.getElementById('overlayCurve');
const stopFadeInput = document.getElementById('stopFadeTime');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const serverPanelEl = document.getElementById('serverPanel');
const stopServerBtn = document.getElementById('stopServer');
const serverActionsHintEl = document.querySelector('.server-actions__hint');
const appVersionEl = document.getElementById('appVersion');
const updateInfoEl = document.getElementById('updateInfo');
const updateMessageEl = document.getElementById('updateMessage');
const updateButton = document.getElementById('updateButton');
const updateStatusEl = document.getElementById('updateStatus');
const releaseLinkEl = document.getElementById('releaseLink');
const allowPrereleaseInput = document.getElementById('allowPrerelease');
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
  sidebarOpen: 'player:sidebarOpen',
  allowPrerelease: 'player:allowPrerelease',
  trackTitleModesByTrack: 'player:trackTitleModesByTrack',
};
const LAYOUT_STORAGE_KEY = 'player:playlists';
const LEGACY_LAYOUT_KEY = 'player:zones';
const CLIENT_ID_STORAGE_KEY = 'djtron:clientId';
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
let layoutVersion = 0;
let layoutStream = null;
let layoutStreamReconnectTimer = null;
let hostPlaybackState = getDefaultHostPlaybackState();
let hostPlaybackSyncInFlight = false;
let hostPlaybackSyncQueued = false;
let hostPlaybackSyncQueuedForce = false;
let lastHostPlaybackSyncAt = 0;
let hostProgressRaf = null;
let hostHighlightedDescriptor = '';
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

function clampVolume(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
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
      if (currentRole === 'slave' && hostPlaybackState && hostPlaybackState.trackFile) {
        const hostTrackKey = trackKey(hostPlaybackState.trackFile, '/audio');
        if (hostTrackKey === key) {
          syncHostNowPlayingPanel();
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
    if (currentRole === 'slave' && hostPlaybackState && hostPlaybackState.trackFile) {
      const hostTrackKey = trackKey(hostPlaybackState.trackFile, '/audio');
      if (hostTrackKey === fileKey) {
        syncHostNowPlayingPanel();
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
  if (info && info.role === 'host') return 'host';
  if (info && info.role === 'slave') return 'slave';
  if (info && info.isServer) return 'host';
  return 'slave';
}

function applyRoleUi(role) {
  const resolvedRole = role === 'host' ? 'host' : 'slave';
  currentRole = resolvedRole;
  document.body.dataset.role = resolvedRole;

  const isHost = resolvedRole === 'host';
  if (serverPanelEl) {
    serverPanelEl.hidden = !isHost;
  }

  if (stopServerBtn) {
    stopServerBtn.hidden = !isHost;
    stopServerBtn.disabled = !isHost;
  }

  if (serverActionsHintEl) {
    serverActionsHintEl.textContent = HOST_SERVER_HINT;
  }

  if (isHost) {
    stopHostProgressLoop();
    requestHostPlaybackSync(true);
  } else {
    syncHostNowPlayingPanel();
  }
}

function updateCurrentUser(info) {
  const username = info && typeof info.username === 'string' ? info.username : null;
  currentUser = username;
  applyRoleUi(normalizeRole(info));
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

function buildHostTrackHighlightDescriptor() {
  if (currentRole !== 'slave') return 'none';
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

  if (currentRole !== 'slave') {
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

function syncNowPlayingPanel() {
  if (!nowPlayingTitleEl || !nowPlayingControlBtn || !nowPlayingControlLabelEl) return;

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

function canSeekNowPlaying() {
  if (currentRole !== 'slave') return false;
  if (!currentTrack || !currentAudio) return false;
  const duration = getCurrentTrackDurationSeconds();
  return Boolean(Number.isFinite(duration) && duration > 0);
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

function applyNowPlayingSeekFromClientX(clientX) {
  if (!canSeekNowPlaying() || !currentTrack || !currentAudio) return false;
  const ratio = resolveNowPlayingSeekRatioFromClientX(clientX);
  if (ratio === null) return false;

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
  applyNowPlayingSeekFromClientX(event.clientX);
}

function onNowPlayingSeekPointerUp(event) {
  if (!nowPlayingSeekActive || event.pointerId !== nowPlayingSeekPointerId) return;

  if (nowPlayingSeekMoved) {
    event.preventDefault();
    applyNowPlayingSeekFromClientX(event.clientX);
    nowPlayingSeekSuppressClickUntil = Date.now() + NOW_PLAYING_SEEK_CLICK_SUPPRESS_MS;
  } else if (
    event.pointerType === 'touch' &&
    !isNowPlayingToggleZone(event.clientX, event.clientY) &&
    applyNowPlayingSeekFromClientX(event.clientX)
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
  if (!currentTrack || !currentAudio) return;

  try {
    if (currentAudio.paused) {
      setTrackPaused(currentTrack.key, false, currentTrack);
      await currentAudio.play();
      setButtonPlaying(currentTrack.key, true, currentTrack);
      startProgressLoop(currentAudio, currentTrack.key);
      setStatus(`Играет: ${currentTrack.file}`);
    } else {
      currentAudio.pause();
      stopProgressLoop();
      setButtonPlaying(currentTrack.key, false, currentTrack);
      setTrackPaused(currentTrack.key, true, currentTrack);
      setStatus(`Пауза: ${currentTrack.file}`);
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
    card.classList.contains('is-host-paused')
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

  layout = ensurePlaylists(snapshotLayout);
  playlistNames = normalizePlaylistNames(snapshotNames, layout.length);
  playlistMeta = normalizePlaylistMeta(snapshotMeta, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(snapshotAutoplay, layout.length);
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

function resolveAutoplayNextTrack(finishedTrack) {
  if (!finishedTrack || typeof finishedTrack.file !== 'string') return null;

  const preferredPlaylistIndex = Number.isInteger(finishedTrack.playlistIndex) ? finishedTrack.playlistIndex : -1;
  if (preferredPlaylistIndex < 0 || preferredPlaylistIndex >= layout.length) return null;

  if (!playlistAutoplay[preferredPlaylistIndex]) return null;
  const playlist = Array.isArray(layout[preferredPlaylistIndex]) ? layout[preferredPlaylistIndex] : [];
  if (!playlist.length) return null;

  let currentIndex = Number.isInteger(finishedTrack.playlistPosition) ? finishedTrack.playlistPosition : -1;
  if (currentIndex < 0 || currentIndex >= playlist.length || playlist[currentIndex] !== finishedTrack.file) {
    currentIndex = playlist.indexOf(finishedTrack.file);
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

async function tryAutoplayNextTrack(finishedTrack) {
  if (currentRole !== 'host') return false;

  const nextTrack = resolveAutoplayNextTrack(finishedTrack);
  if (!nextTrack) return false;

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
  nextTrackTitleModesByTrack = null,
  version = null,
  render = true,
) {
  const normalizedLayout = normalizeLayoutForFiles(nextLayout, availableFiles);
  const normalizedNames = normalizePlaylistNames(nextPlaylistNames, normalizedLayout.length);
  const normalizedMeta = normalizePlaylistMeta(nextPlaylistMeta, normalizedLayout.length);
  const normalizedAutoplay = normalizePlaylistAutoplayFlags(nextPlaylistAutoplay, normalizedLayout.length);
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
    !trackTitleModesByTrackEqual(trackTitleModesByTrack, normalizedTrackTitleModes);

  layout = withFolderCoverage.layout;
  playlistNames = withFolderCoverage.playlistNames;
  playlistMeta = withFolderCoverage.playlistMeta;
  playlistAutoplay = normalizePlaylistAutoplayFlags(normalizedAutoplay, layout.length);
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

  if (sync || changed) {
    syncHostNowPlayingPanel();
  }

  return changed;
}

function buildLocalPlaybackSnapshot() {
  if (!currentTrack || !currentAudio) {
    return {
      trackFile: null,
      paused: false,
      currentTime: 0,
      duration: null,
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

function requestHostPlaybackSync(force = false) {
  if (currentRole !== 'host') return;

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

  const response = await fetch('/api/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      layout: payloadState.layout,
      playlistNames: payloadState.playlistNames,
      playlistMeta: payloadState.playlistMeta,
      playlistAutoplay: payloadAutoplay,
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
  const incomingTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(serverState.trackTitleModesByTrack, availableFiles, '/audio');

  let nextLayout = normalizeLayoutForFiles(incomingLayout, availableFiles);
  let nextNames = normalizePlaylistNames(incomingNames, nextLayout.length);
  let nextMeta = normalizePlaylistMeta(incomingMeta, nextLayout.length);
  let nextAutoplay = normalizePlaylistAutoplayFlags(incomingAutoplay, nextLayout.length);
  let nextTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(incomingTrackTitleModes, availableFiles, '/audio');
  let shouldPush =
    !layoutsEqual(incomingLayout, nextLayout) ||
    !playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !playlistMetaEqual(incomingMeta, nextMeta, nextLayout.length) ||
    !playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length) ||
    !trackTitleModesByTrackEqual(incomingTrackTitleModes, nextTrackTitleModes);

  if (currentRole === 'host' && isServerLayoutEmpty(incomingLayout)) {
    const legacyLayout = readLegacyLocalLayout(availableFiles);
    if (legacyLayout && !layoutsEqual(legacyLayout, nextLayout)) {
      nextLayout = legacyLayout;
      nextNames = normalizePlaylistNames(nextNames, nextLayout.length);
      nextMeta = normalizePlaylistMeta(nextMeta, nextLayout.length);
      nextAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, nextLayout.length);
      shouldPush = true;
    }
  }

  const withFolderCoverage = ensureFolderPlaylistsCoverage(nextLayout, nextNames, nextMeta);
  nextLayout = withFolderCoverage.layout;
  nextNames = withFolderCoverage.playlistNames;
  nextMeta = withFolderCoverage.playlistMeta;
  nextAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, nextLayout.length);
  nextTrackTitleModes = normalizeTrackTitleModesByTrackForFiles(nextTrackTitleModes, availableFiles, '/audio');

  shouldPush =
    shouldPush ||
    !layoutsEqual(incomingLayout, nextLayout) ||
    !playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !playlistMetaEqual(incomingMeta, nextMeta, nextLayout.length) ||
    !playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length) ||
    !trackTitleModesByTrackEqual(incomingTrackTitleModes, nextTrackTitleModes);

  layout = nextLayout;
  playlistNames = nextNames;
  playlistMeta = nextMeta;
  playlistAutoplay = nextAutoplay;
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
  if (currentRole !== 'host') {
    setStatus('Автовоспроизведение может менять только хост.');
    return;
  }

  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= layout.length) return;

  const previousAutoplay = playlistAutoplay.slice();
  const nextAutoplay = playlistAutoplay.slice();
  nextAutoplay[playlistIndex] = !nextAutoplay[playlistIndex];
  const normalizedAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, layout.length);

  if (playlistAutoplayEqual(playlistAutoplay, normalizedAutoplay, layout.length)) return;

  playlistAutoplay = normalizedAutoplay;
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
    renderZones();
    setStatus('Не удалось синхронизировать автопроигрывание плей-листа.');
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
  const hostPlaybackIndex =
    hostPlaybackState && typeof hostPlaybackState.trackFile === 'string' && hostPlaybackState.trackFile.trim()
      ? normalizePlaylistTrackIndex(hostPlaybackState.playlistIndex)
      : null;

  if (hostPlaybackIndex !== null) {
    return hostPlaybackIndex;
  }

  if (currentRole === 'host' && currentTrack && typeof currentTrack.file === 'string' && currentTrack.file.trim()) {
    return normalizePlaylistTrackIndex(currentTrack.playlistIndex);
  }

  return null;
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

  const nextLayout = previousLayout.map((playlist) => playlist.slice());
  nextLayout.splice(playlistIndex, 1);

  const nextNames = previousNames.slice();
  nextNames.splice(playlistIndex, 1);
  const nextMeta = previousMeta.slice();
  nextMeta.splice(playlistIndex, 1);
  const nextAutoplay = previousAutoplay.slice();
  nextAutoplay.splice(playlistIndex, 1);

  layout = ensurePlaylists(nextLayout);
  playlistNames = normalizePlaylistNames(nextNames, layout.length);
  playlistMeta = normalizePlaylistMeta(nextMeta, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, layout.length);
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
    const canManageAutoplay = currentRole === 'host';
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

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'playlist-delete-btn';
    deleteButton.textContent = 'Удалить';
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

    headerMeta.append(autoplayButton, count, deleteButton);
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

  syncCurrentTrackState();
}

function syncCurrentTrackState() {
  if (currentTrack) {
    const isPlaying = Boolean(currentAudio && !currentAudio.paused);
    setButtonPlaying(currentTrack.key, isPlaying, currentTrack);
    setTrackPaused(currentTrack.key, !isPlaying && Boolean(currentAudio), currentTrack);
  }
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
    setStatus('Не удалось загрузить состояние плей-листов, используется локальная раскладка.');
  }

  try {
    await initializePlaybackState();
  } catch (err) {
    console.error(err);
    hostPlaybackState = getDefaultHostPlaybackState();
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

function createAudio(track) {
  const { file, basePath, key } = track;
  const encoded = encodeURIComponent(file);
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const audio = new Audio(`${normalizedBase}/${encoded}`);
  audio.preload = 'metadata';
  audio.load();

  audio.addEventListener('ended', () => {
    const wasCurrentTrack = Boolean(currentTrack && currentTrack.key === key);

    if (wasCurrentTrack) {
      currentAudio = null;
      currentTrack = null;
    }
    setButtonPlaying(key, false, track);
    setTrackPaused(key, false, track);
    stopProgressLoop();
    resetProgress(key);
    syncNowPlayingPanel();
    requestHostPlaybackSync(true);

    if (!wasCurrentTrack) return;

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
  const overlaySeconds = Math.max(0, parseFloat(overlayTimeInput.value) || 0);
  const curve = overlayCurveSelect.value;
  const targetVolume = 1;
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

  if (currentTrack && currentTrack.key === track.key && currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    stopProgressLoop();
    setButtonPlaying(track.key, false, track);
    setTrackPaused(track.key, true, track);
    setStatus(`Пауза: ${file}`);
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
    await audio.play();

    if (currentAudio && !currentAudio.paused && overlaySeconds > 0) {
      const oldTrack = currentTrack;
      setButtonPlaying(track.key, true, track);
      setTrackPaused(track.key, false, track);
      startProgressLoop(audio, track.key);
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

async function stopServer() {
  if (!stopServerBtn) return;
  if (currentRole !== 'host') {
    setStatus('Остановку сервера может выполнить только хост (live).');
    return;
  }

  stopServerBtn.disabled = true;
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
    stopServerBtn.disabled = false;
  }
}

function initServerControls() {
  if (!stopServerBtn) return;
  stopServerBtn.addEventListener('click', stopServer);
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

function initNowPlayingControls() {
  if (!nowPlayingControlBtn) return;
  nowPlayingControlBtn.addEventListener('pointerdown', onNowPlayingControlPointerDown);
  nowPlayingControlBtn.addEventListener('click', onNowPlayingControlClick);
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
      saveSetting(SETTINGS_KEYS.allowPrerelease, allowPrereleaseInput.checked ? 'true' : 'false');
      checkForUpdates();
    });
  }

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
      if (stopServerBtn) {
        stopServerBtn.click();
      } else {
        stopServer();
      }
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

  const allowPrerelease = allowPrereleaseInput ? allowPrereleaseInput.checked : false;

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

  const allowPrerelease = allowPrereleaseInput ? allowPrereleaseInput.checked : false;

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
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  const authorized = await ensureAuthorizedUser();
  if (!authorized) return;

  initSettings();
  initSidebarToggle();
  initServerControls();
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
