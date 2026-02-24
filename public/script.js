const zonesContainer = document.getElementById('zones');
const statusEl = document.getElementById('status');
const addPlaylistBtn = document.getElementById('addPlaylist');
const overlayTimeInput = document.getElementById('overlayTime');
const overlayCurveSelect = document.getElementById('overlayCurve');
const stopFadeInput = document.getElementById('stopFadeTime');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
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
const hostNowPlayingTitleEl = document.getElementById('hostNowPlayingTitle');
const hostNowPlayingControlLabelEl = document.getElementById('hostNowPlayingControlLabel');
const hostNowPlayingProgressEl = document.getElementById('hostNowPlayingProgress');
const hostNowPlayingTimeEl = document.getElementById('hostNowPlayingTime');

const SETTINGS_KEYS = {
  overlayTime: 'player:overlayTime',
  overlayCurve: 'player:overlayCurve',
  stopFade: 'player:stopFade',
  sidebarOpen: 'player:sidebarOpen',
  allowPrerelease: 'player:allowPrerelease',
};
const LAYOUT_STORAGE_KEY = 'player:playlists';
const LEGACY_LAYOUT_KEY = 'player:zones';
const CLIENT_ID_STORAGE_KEY = 'djtron:clientId';
const LAYOUT_STREAM_RETRY_MS = 1500;
const PLAYLIST_NAME_MAX_LENGTH = 80;
const HOST_PLAYBACK_SYNC_INTERVAL_MS = 900;
const HOST_PROGRESS_REFRESH_INTERVAL_MS = 250;
const TOUCH_COPY_HOLD_MS = 360;
const TOUCH_DRAG_START_MOVE_PX = 12;
const TOUCH_DRAG_COMMIT_PX = 6;
const TOUCH_NATIVE_DRAG_BLOCK_WINDOW_MS = 900;

let currentAudio = null;
let currentTrack = null; // { file, basePath, key }
let fadeCancel = { cancelled: false };
let buttonsByFile = new Map();
let cardsByFile = new Map();
let durationLabelsByFile = new Map();
let knownTrackDurations = new Map();
let durationLoadPromises = new Map();
let activeDurationTrackKey = null;
let progressRaf = null;
let progressAudio = null;
let draggingCard = null;
let dragDropHandled = false;
let dragContext = null;
let layout = [[]]; // array of playlists -> array of filenames
let playlistNames = ['Плей-лист 1'];
let playlistAutoplay = [false];
let availableFiles = [];
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
let hostProgressTimer = null;
let hostHighlightedDescriptor = '';
let touchHoldTimer = null;
let touchHoldPointerId = null;
let touchHoldStartX = 0;
let touchHoldStartY = 0;
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
const HOST_SERVER_HINT = 'Если нужно завершить работу, нажмите кнопку ниже. Сервер остановится и страница перестанет отвечать.';
const SLAVE_SERVER_HINT = 'Этот клиент работает в режиме slave. Останавливать сервер может только хост (live).';
const NOW_PLAYING_IDLE_TITLE = 'Ничего не играет';
const HOST_NOW_PLAYING_IDLE_TITLE = 'Хост: ничего не играет';
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

function isCopyDragModifier(event) {
  return Boolean(event && (event.ctrlKey || event.metaKey));
}

function setDropEffectFromEvent(event) {
  if (!event || !event.dataTransfer) return;
  event.dataTransfer.dropEffect = isCopyDragModifier(event) ? 'copy' : 'move';
}

function normalizeDragMode(mode) {
  if (mode === 'copy' || mode === 'cancel') return mode;
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

function isActiveCopyDrag(event) {
  if (touchCopyDragActive) {
    return touchDragMode === 'copy';
  }
  return isCopyDragModifier(event);
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

function handleGlobalDragOver(event) {
  if (!draggingCard || !event.dataTransfer) return;
  updateDesktopDragGhostPosition(event.clientX, event.clientY);
  const target = event.target instanceof Element ? event.target : null;
  if (target && zonesContainer.contains(target)) {
    applyDragModeBadge(isActiveCopyDrag(event) ? 'copy' : 'move');
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
  touchHoldCard = null;
  removeTouchHoldListeners();
}

function onTouchHoldPointerMove(event) {
  if (touchHoldPointerId === null || event.pointerId !== touchHoldPointerId) return;
  const deltaX = event.clientX - touchHoldStartX;
  const deltaY = event.clientY - touchHoldStartY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance > TOUCH_DRAG_START_MOVE_PX) {
    const heldCard = touchHoldCard;
    const pointerId = touchHoldPointerId;
    clearTouchCopyHold();
    if (!heldCard || pointerId === null) return;
    startTouchCopyDrag(heldCard, pointerId, event.clientX, event.clientY, {
      mode: 'move',
      moved: true,
    });
    updateTouchCopyDragPreview(event.clientX, event.clientY);
  }
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

  const zone = getZoneFromPoint(clientX, clientY);
  if (!zone) {
    applyDragModeBadge('cancel');
    if (touchCopyDragGhost) {
      touchCopyDragGhost.classList.add('is-cancel');
    }
    return;
  }

  applyDragModeBadge(touchDragMode === 'copy' ? 'copy' : 'move');
  if (touchCopyDragGhost) {
    touchCopyDragGhost.classList.remove('is-cancel');
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

  const sourceZone = card.closest('.zone');
  const sourceZoneIndex = sourceZone ? Number.parseInt(sourceZone.dataset.zoneIndex || '', 10) : -1;
  const sourceBody = card.parentElement;
  const sourceIndex = sourceBody ? Array.from(sourceBody.querySelectorAll('.track-card')).indexOf(card) : -1;

  dragContext = {
    file: card.dataset.file || '',
    sourceZoneIndex: Number.isInteger(sourceZoneIndex) ? sourceZoneIndex : -1,
    sourceIndex,
    snapshotLayout: cloneLayoutState(layout),
  };

  draggingCard = card;
  dragDropHandled = false;
  touchCopyDragActive = true;
  touchCopyDragPointerId = pointerId;
  touchCopyDragStartX = clientX;
  touchCopyDragStartY = clientY;
  touchCopyDragMoved = Boolean(moved);
  touchDragMode = mode === 'copy' ? 'copy' : 'move';
  card.classList.add('dragging');

  const ghost = card.cloneNode(true);
  ghost.classList.add('touch-drag-ghost');
  ghost.classList.add(touchDragMode === 'copy' ? 'is-copy' : 'is-move');
  ghost.classList.remove('dragging');
  touchCopyDragGhost = ghost;
  document.body.appendChild(ghost);
  updateTouchCopyGhostPosition(clientX, clientY);
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
  if (typeof card.setPointerCapture === 'function') {
    try {
      card.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors when pointer cannot be captured
    }
  }
  touchHoldPointerId = event.pointerId;
  touchHoldStartX = event.clientX;
  touchHoldStartY = event.clientY;
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

function trackDisplayName(file) {
  return stripExtension(file);
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
  if (stopServerBtn) {
    stopServerBtn.hidden = !isHost;
    stopServerBtn.disabled = !isHost;
  }

  if (serverActionsHintEl) {
    serverActionsHintEl.textContent = isHost ? HOST_SERVER_HINT : SLAVE_SERVER_HINT;
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
  nowPlayingProgressEl.style.width = `${safePercent}%`;
}

function setNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!nowPlayingTimeEl) return;
  nowPlayingTimeEl.textContent = formatDuration(seconds, { useCeil });
}

function setHostNowPlayingProgress(percent) {
  if (!hostNowPlayingProgressEl) return;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  hostNowPlayingProgressEl.style.width = `${safePercent}%`;
}

function setHostNowPlayingTime(seconds, { useCeil = true } = {}) {
  if (!hostNowPlayingTimeEl) return;
  hostNowPlayingTimeEl.textContent = formatDuration(seconds, { useCeil });
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
  if (hostProgressTimer === null) return;
  clearInterval(hostProgressTimer);
  hostProgressTimer = null;
}

function startHostProgressLoop() {
  if (hostProgressTimer !== null) return;
  hostProgressTimer = setInterval(() => {
    syncHostNowPlayingPanel();
  }, HOST_PROGRESS_REFRESH_INTERVAL_MS);
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
    syncHostTrackHighlight();
    return;
  }

  if (!hostPlaybackState || !hostPlaybackState.trackFile) {
    hostNowPlayingTitleEl.textContent = HOST_NOW_PLAYING_IDLE_TITLE;
    hostNowPlayingControlLabelEl.textContent = '▶';
    setHostNowPlayingProgress(0);
    setHostNowPlayingTime(null);
    stopHostProgressLoop();
    syncHostTrackHighlight();
    return;
  }

  hostNowPlayingTitleEl.textContent = `Хост: ${trackDisplayName(hostPlaybackState.trackFile)}`;
  hostNowPlayingControlLabelEl.textContent = hostPlaybackState.paused ? '▶' : '❚❚';

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
    nowPlayingTitleEl.textContent = NOW_PLAYING_IDLE_TITLE;
    nowPlayingControlLabelEl.textContent = '▶';
    nowPlayingControlBtn.disabled = true;
    setNowPlayingProgress(0);
    setNowPlayingTime(null);
    requestHostPlaybackSync(false);
    return;
  }

  nowPlayingTitleEl.textContent = trackDisplayName(currentTrack.file);
  nowPlayingControlBtn.disabled = false;
  nowPlayingControlLabelEl.textContent = currentAudio.paused ? '▶' : '❚❚';
  setNowPlayingTime(getCurrentTrackRemainingSeconds(), { useCeil: true });
  refreshTrackDurationLabels(currentTrack.key);
  requestHostPlaybackSync(false);
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
  { draggable = true, orderNumber = null, playlistIndex = null, playlistPosition = null } = {},
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
  addToMultiMap(cardsByFile, key, card);

  const order = document.createElement('span');
  order.className = 'track-order';
  order.textContent = Number.isInteger(orderNumber) && orderNumber > 0 ? String(orderNumber) : '•';

  const name = document.createElement('p');
  name.className = 'track-name';
  name.textContent = trackDisplayName(file);

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
    if (target && target.closest('button, input, textarea, select, a')) return;

    event.preventDefault();
    startTouchCopyHold(card, event);
  });

  card.addEventListener('dragstart', (e) => {
    if (isLikelyTouchNativeDragEvent(e)) {
      e.preventDefault();
      return;
    }

    const sourceZone = card.closest('.zone');
    const sourceZoneIndex = sourceZone ? Number.parseInt(sourceZone.dataset.zoneIndex || '', 10) : -1;
    const sourceBody = card.parentElement;
    const sourceIndex = sourceBody ? Array.from(sourceBody.querySelectorAll('.track-card')).indexOf(card) : -1;

    dragContext = {
      file: card.dataset.file || '',
      sourceZoneIndex: Number.isInteger(sourceZoneIndex) ? sourceZoneIndex : -1,
      sourceIndex,
      snapshotLayout: cloneLayoutState(layout),
    };

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', card.dataset.file);
    setDropEffectFromEvent(e);
    createDesktopDragGhost(card, e.clientX, e.clientY);
    e.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);
    applyDragModeBadge(isCopyDragModifier(e) ? 'copy' : 'move');
    card.classList.add('dragging');
    draggingCard = card;
    dragDropHandled = false;
  });

  card.addEventListener('dragend', () => {
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
  setDropEffectFromEvent(event);
  updateDesktopDragGhostPosition(event.clientX, event.clientY);
  applyDragModeBadge(isActiveCopyDrag(event) ? 'copy' : 'move');

  if (isActiveCopyDrag(event)) {
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
  const present = new Set();

  const filtered = normalized.map((playlist) => {
    const clean = [];
    playlist.forEach((file) => {
      if (typeof file !== 'string') return;
      if (!allowedFiles.has(file)) return;
      clean.push(file);
      present.add(file);
    });
    return clean;
  });

  const missing = Array.isArray(files) ? files.filter((file) => !present.has(file)) : [];
  if (missing.length) {
    filtered[0] = filtered[0].concat(missing);
  }

  return ensurePlaylists(filtered);
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
  playlistAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, layout.length);
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
  hostHighlightedDescriptor = '';
}

function applyIncomingLayoutState(nextLayout, nextPlaylistNames, nextPlaylistAutoplay, version = null, render = true) {
  const normalizedLayout = normalizeLayoutForFiles(nextLayout, availableFiles);
  const normalizedNames = normalizePlaylistNames(nextPlaylistNames, normalizedLayout.length);
  const normalizedAutoplay = normalizePlaylistAutoplayFlags(nextPlaylistAutoplay, normalizedLayout.length);
  const changed =
    !layoutsEqual(layout, normalizedLayout) ||
    !playlistNamesEqual(playlistNames, normalizedNames, normalizedLayout.length) ||
    !playlistAutoplayEqual(playlistAutoplay, normalizedAutoplay, normalizedLayout.length);

  layout = normalizedLayout;
  playlistNames = normalizedNames;
  playlistAutoplay = normalizedAutoplay;

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
    playlistAutoplay: Array.isArray(data.playlistAutoplay) ? data.playlistAutoplay : [],
    version: Number.isFinite(Number(data.version)) ? Number(data.version) : 0,
  };
}

async function pushSharedLayout({ renderOnApply = true } = {}) {
  const response = await fetch('/api/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ layout, playlistNames, playlistAutoplay, clientId, version: layoutVersion }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось синхронизировать плей-листы');
  }

  applyIncomingLayoutState(data.layout, data.playlistNames, data.playlistAutoplay, data.version, renderOnApply);
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
    applyIncomingLayoutState(payload.layout, payload.playlistNames, payload.playlistAutoplay, payload.version, true);
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
  const incomingAutoplay = normalizePlaylistAutoplayFlags(serverState.playlistAutoplay, incomingLayout.length);

  let nextLayout = normalizeLayoutForFiles(incomingLayout, availableFiles);
  let nextNames = normalizePlaylistNames(incomingNames, nextLayout.length);
  let nextAutoplay = normalizePlaylistAutoplayFlags(incomingAutoplay, nextLayout.length);
  let shouldPush =
    !layoutsEqual(incomingLayout, nextLayout) ||
    !playlistNamesEqual(incomingNames, nextNames, nextLayout.length) ||
    !playlistAutoplayEqual(incomingAutoplay, nextAutoplay, nextLayout.length);

  if (currentRole === 'host' && isServerLayoutEmpty(incomingLayout)) {
    const legacyLayout = readLegacyLocalLayout(availableFiles);
    if (legacyLayout && !layoutsEqual(legacyLayout, nextLayout)) {
      nextLayout = legacyLayout;
      nextNames = normalizePlaylistNames(nextNames, nextLayout.length);
      nextAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, nextLayout.length);
      shouldPush = true;
    }
  }

  layout = nextLayout;
  playlistNames = nextNames;
  playlistAutoplay = nextAutoplay;
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

  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= normalizedLayout.length) {
    return { canDelete: false, reason: 'Плей-лист не найден.' };
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
  const previousAutoplay = playlistAutoplay.slice();

  const nextLayout = previousLayout.map((playlist) => playlist.slice());
  nextLayout.splice(playlistIndex, 1);

  const nextNames = previousNames.slice();
  nextNames.splice(playlistIndex, 1);
  const nextAutoplay = previousAutoplay.slice();
  nextAutoplay.splice(playlistIndex, 1);

  layout = ensurePlaylists(nextLayout);
  playlistNames = normalizePlaylistNames(nextNames, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(nextAutoplay, layout.length);
  renderZones();

  try {
    await pushSharedLayout();
    setStatus(`Плей-лист "${safeTitle}" удален.`);
  } catch (err) {
    console.error(err);
    layout = previousLayout;
    playlistNames = previousNames;
    playlistAutoplay = previousAutoplay;
    renderZones();
    setStatus(err && err.message ? err.message : 'Не удалось синхронизировать удаление плей-листа.');
  }
}

function renderZones() {
  zonesContainer.innerHTML = '';
  resetTrackReferences();
  layout = ensurePlaylists(layout);
  playlistAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, layout.length);

  layout.forEach((playlistFiles, playlistIndex) => {
    const zone = document.createElement('div');
    zone.className = 'zone';
    zone.dataset.zoneIndex = playlistIndex.toString();

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      setDropEffectFromEvent(e);
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => handleDrop(e, playlistIndex));

    const header = document.createElement('div');
    header.className = 'playlist-header';
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
    header.append(titleInput, headerMeta);

    const body = document.createElement('div');
    body.className = 'zone-body';

    playlistFiles.forEach((file, rowIndex) => {
      body.appendChild(
        buildTrackCard(file, '/audio', {
          draggable: true,
          orderNumber: rowIndex + 1,
          playlistIndex,
          playlistPosition: rowIndex,
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
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }
  if (!Number.isInteger(targetZoneIndex) || targetZoneIndex < 0) {
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }

  const targetZone = event.currentTarget;
  if (!targetZone) {
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }
  targetZone.classList.remove('drag-over');
  dragDropHandled = true;

  const previousLayout = cloneLayoutState(layout);
  const isCopyDrop = isActiveCopyDrag(event);

  let nextLayout;
  if (isCopyDrop) {
    if (!dragContext.file) {
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }
    nextLayout = cloneLayoutState(dragContext.snapshotLayout);
    if (!Array.isArray(nextLayout[targetZoneIndex])) {
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

  clearDragModeBadge();
  clearDragPreviewCard();
  layout = ensurePlaylists(nextLayout);
  playlistNames = normalizePlaylistNames(playlistNames, layout.length);
  playlistAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, layout.length);
  renderZones();
  try {
    await pushSharedLayout();
    setStatus(isCopyDrop ? 'Трек продублирован и синхронизирован.' : 'Плей-листы обновлены и синхронизированы.');
  } catch (err) {
    console.error(err);
    layout = previousLayout;
    playlistNames = normalizePlaylistNames(playlistNames, layout.length);
    playlistAutoplay = normalizePlaylistAutoplayFlags(playlistAutoplay, layout.length);
    renderZones();
    setStatus(isCopyDrop ? 'Не удалось синхронизировать копирование трека.' : 'Не удалось синхронизировать плей-листы.');
  }
}

async function fetchFileList(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Не удалось получить список файлов');
    const data = await res.json();
    return { files: Array.isArray(data.files) ? data.files : [], ok: true };
  } catch (err) {
    console.error(err);
    return { files: [], ok: false };
  }
}

async function loadTracks() {
  clearLayoutStreamConnection();
  const audioResult = await fetchFileList('/api/audio');
  resetTrackReferences();

  if (!audioResult.ok) {
    renderEmpty();
    syncCurrentTrackState();
    setStatus('Ошибка загрузки списка файлов. Проверьте сервер.');
    return;
  }

  availableFiles = audioResult.files;
  keepKnownDurationsForFiles(availableFiles);
  preloadTrackDurations(availableFiles);

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
    layout = normalizeLayoutForFiles([availableFiles.slice()], availableFiles);
    playlistNames = normalizePlaylistNames([], layout.length);
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
  setStatus(`Найдено файлов: ${availableFiles.length}`);
  connectLayoutStream();
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
  if (!addPlaylistBtn) return;
  addPlaylistBtn.addEventListener('click', addPlaylist);
}

function initNowPlayingControls() {
  if (!nowPlayingControlBtn) return;
  nowPlayingControlBtn.addEventListener('click', toggleNowPlayingPlayback);
  syncNowPlayingPanel();
  syncHostNowPlayingPanel();
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
  initNowPlayingControls();
  initUpdater();
  window.addEventListener('beforeunload', () => {
    clearLayoutStreamConnection();
    stopHostProgressLoop();
    clearTouchCopyHold();
    if (touchCopyDragActive) {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
  });
  loadTracks();
  loadVersion();
  document.addEventListener('dragover', handleGlobalDragOver);
}

bootstrap();
