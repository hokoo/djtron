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

let currentAudio = null;
let currentTrack = null; // { file, basePath, key }
let fadeCancel = { cancelled: false };
let buttonsByFile = new Map();
let cardsByFile = new Map();
let progressByFile = new Map();
let progressRaf = null;
let progressAudio = null;
let draggingCard = null;
let dragDropHandled = false;
let layout = [[]]; // array of playlists -> array of filenames
let playlistNames = ['Плей-лист 1'];
let availableFiles = [];
let shutdownCountdownTimer = null;
let currentUser = null;
let currentRole = null;
let layoutVersion = 0;
let layoutStream = null;
let layoutStreamReconnectTimer = null;
const HOST_SERVER_HINT = 'Если нужно завершить работу, нажмите кнопку ниже. Сервер остановится и страница перестанет отвечать.';
const SLAVE_SERVER_HINT = 'Этот клиент работает в режиме slave. Останавливать сервер может только хост (live).';
const HOTKEY_ROWS = [
  ['1', '2', '3', '4', '5'],
  ['Q', 'W', 'E', 'R', 'T'],
  ['A', 'S', 'D', 'F', 'G'],
  ['Z', 'X', 'C', 'V', 'B'],
];
const HOTKEY_CODES = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
];
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

function trackDisplayName(file, hotkeyLabel) {
  const name = stripExtension(file);
  return hotkeyLabel ? `${hotkeyLabel}: ${name}` : name;
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

function volumeKey(key) {
  return `player:volume:${key}`;
}

function loadVolume(file, basePath = '/audio') {
  const key = trackKey(file, basePath);
  const saved = localStorage.getItem(volumeKey(key));
  let parsed = saved !== null ? parseFloat(saved) : NaN;

  if (Number.isNaN(parsed) && basePath === '/audio') {
    const legacy = localStorage.getItem(`player:volume:${file}`);
    parsed = legacy !== null ? parseFloat(legacy) : NaN;
  }

  if (Number.isNaN(parsed)) return 1;
  return clampVolume(parsed);
}

function saveVolume(file, value, basePath = '/audio') {
  const key = trackKey(file, basePath);
  localStorage.setItem(volumeKey(key), clampVolume(value).toString());
}

function renderEmpty() {
  zonesContainer.innerHTML = '<div class="empty-state">В папке /audio не найдено аудиофайлов (mp3, wav, ogg, m4a, flac).</div>';
}

function setButtonPlaying(fileKey, isPlaying) {
  const btn = buttonsByFile.get(fileKey);
  const card = cardsByFile.get(fileKey);
  const progress = progressByFile.get(fileKey);
  if (btn) {
    btn.textContent = isPlaying ? '■' : '▶';
    btn.title = isPlaying ? 'Остановить' : 'Воспроизвести';
  }
  if (card) {
    card.classList.toggle('is-playing', isPlaying);
  }
  if (progress) {
    const { container, bar } = progress;
    container.classList.toggle('visible', isPlaying);
    if (!isPlaying && bar) {
      bar.style.width = '0%';
    }
  }
}

// Only trust the real duration reported by the browser.
function getDuration(audio) {
  const d = audio ? audio.duration : NaN;
  return Number.isFinite(d) && d > 0 ? d : null;
}

function updateProgress(fileKey, currentTime, duration) {
  const entry = progressByFile.get(fileKey);
  if (!entry) return;
  const { bar } = entry;

  if (!duration) {
    bar.style.width = '0%';
    return;
  }

  const safeTime = Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
  const percent = Math.min(100, (safeTime / duration) * 100);
  bar.style.width = `${percent}%`;
}

function resetProgress(fileKey) {
  const entry = progressByFile.get(fileKey);
  if (!entry) return;
  entry.bar.style.width = '0%';
}

function bindProgress(audio, fileKey) {
  const update = () => updateProgress(fileKey, audio.currentTime, getDuration(audio));
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('loadedmetadata', update);
  audio.addEventListener('seeking', update);
  audio.addEventListener('seeked', update);
  audio.addEventListener('durationchange', update);
}

function stopProgressLoop() {
  if (progressRaf !== null) {
    cancelAnimationFrame(progressRaf);
    progressRaf = null;
  }
  progressAudio = null;
}

function startProgressLoop(audio, fileKey) {
  stopProgressLoop();
  if (!audio) return;
  progressAudio = audio;

  const tick = () => {
    if (!progressAudio || progressAudio.paused) return;
    updateProgress(fileKey, progressAudio.currentTime, getDuration(progressAudio));
    progressRaf = requestAnimationFrame(tick);
  };

  tick();
}

function buildTrackCard(file, basePath = '/audio', { draggable = true, hotkeyLabel = null } = {}) {
  const key = trackKey(file, basePath);
  const card = document.createElement('div');
  card.className = 'track-card';
  card.draggable = draggable;
  card.dataset.file = file;
  card.dataset.basePath = basePath;
  cardsByFile.set(key, card);

  const info = document.createElement('div');
  const name = document.createElement('p');
  name.className = 'track-name';
  name.textContent = trackDisplayName(file, hotkeyLabel);
  info.appendChild(name);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const playButton = document.createElement('button');
  playButton.className = 'play';
  playButton.textContent = '▶';
  playButton.title = 'Воспроизвести';
  playButton.addEventListener('click', () => handlePlay(file, playButton, basePath));
  buttonsByFile.set(key, playButton);

  const progress = document.createElement('div');
  progress.className = 'play-progress';
  const progressBar = document.createElement('div');
  progressBar.className = 'play-progress__bar';
  progress.append(progressBar);
  progressByFile.set(key, { container: progress, bar: progressBar });

  const playBlock = document.createElement('div');
  playBlock.className = 'play-block';
  playBlock.append(playButton, progress);

  const volumeWrap = document.createElement('label');
  volumeWrap.className = 'volume';
  const volumeRange = document.createElement('input');
  volumeRange.type = 'range';
  volumeRange.min = '0';
  volumeRange.max = '1';
  volumeRange.step = '0.01';
  volumeRange.value = loadVolume(file, basePath).toString();

  const enableDrag = () => {
    card.draggable = true;
  };
  const disableDrag = () => {
    card.draggable = false;
  };

  ['pointerdown', 'mousedown', 'touchstart'].forEach((event) => {
    volumeRange.addEventListener(event, disableDrag);
  });
  ['pointerup', 'mouseup', 'touchend', 'touchcancel', 'pointerleave'].forEach((event) => {
    volumeRange.addEventListener(event, enableDrag);
  });

  volumeRange.addEventListener('input', () => {
    const numeric = clampVolume(parseFloat(volumeRange.value));
    volumeRange.value = numeric.toString();
    saveVolume(file, numeric, basePath);
    if (currentTrack && currentTrack.key === key && currentAudio) {
      currentAudio.volume = numeric;
    }
  });

  volumeWrap.append(volumeRange);
  controls.append(playBlock, volumeWrap);
  card.append(info, controls);
  if (draggable) {
    attachDragHandlers(card);
  }
  return card;
}

function attachDragHandlers(card) {
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.file);
    card.classList.add('dragging');
    draggingCard = card;
    dragDropHandled = false;
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    if (!dragDropHandled) {
      renderZones();
    }
    draggingCard = null;
    dragDropHandled = false;
    document.querySelectorAll('.zone.drag-over').forEach((zone) => zone.classList.remove('drag-over'));
  });
}

function getDragInsertBefore(container, event) {
  const draggableCards = Array.from(container.querySelectorAll('.track-card:not(.dragging)'));
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
  const beforeElement = getDragInsertBefore(zoneBody, event);
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

function normalizeLayoutForFiles(rawLayout, files) {
  const normalized = ensurePlaylists(rawLayout);
  const allowedFiles = new Set(Array.isArray(files) ? files : []);
  const seen = new Set();

  const filtered = normalized.map((playlist) => {
    const clean = [];
    playlist.forEach((file) => {
      if (typeof file !== 'string') return;
      if (!allowedFiles.has(file)) return;
      if (seen.has(file)) return;
      seen.add(file);
      clean.push(file);
    });
    return clean;
  });

  const missing = Array.isArray(files) ? files.filter((file) => !seen.has(file)) : [];
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
}

function resetTrackReferences() {
  buttonsByFile = new Map();
  cardsByFile = new Map();
  progressByFile = new Map();
}

function applyIncomingLayoutState(nextLayout, nextPlaylistNames, version = null, render = true) {
  const normalizedLayout = normalizeLayoutForFiles(nextLayout, availableFiles);
  const normalizedNames = normalizePlaylistNames(nextPlaylistNames, normalizedLayout.length);
  const changed =
    !layoutsEqual(layout, normalizedLayout) || !playlistNamesEqual(playlistNames, normalizedNames, normalizedLayout.length);

  layout = normalizedLayout;
  playlistNames = normalizedNames;

  const numericVersion = Number(version);
  if (Number.isFinite(numericVersion)) {
    layoutVersion = numericVersion;
  }

  if (changed && render) {
    renderZones();
  }

  return changed;
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
    version: Number.isFinite(Number(data.version)) ? Number(data.version) : 0,
  };
}

async function pushSharedLayout({ renderOnApply = true } = {}) {
  const response = await fetch('/api/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ layout, playlistNames, clientId, version: layoutVersion }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось синхронизировать плей-листы');
  }

  applyIncomingLayoutState(data.layout, data.playlistNames, data.version, renderOnApply);
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
    applyIncomingLayoutState(payload.layout, payload.playlistNames, payload.version, true);
  });

  stream.onerror = () => {
    if (layoutStream !== stream) return;
    stream.close();
    layoutStream = null;
    scheduleLayoutStreamReconnect();
  };
}

async function initializeLayoutState() {
  const serverState = await fetchSharedLayoutState();
  const incomingLayout = ensurePlaylists(serverState.layout);
  const incomingNames = normalizePlaylistNames(serverState.playlistNames, incomingLayout.length);

  let nextLayout = normalizeLayoutForFiles(incomingLayout, availableFiles);
  let nextNames = normalizePlaylistNames(incomingNames, nextLayout.length);
  let shouldPush =
    !layoutsEqual(incomingLayout, nextLayout) || !playlistNamesEqual(incomingNames, nextNames, nextLayout.length);

  if (currentRole === 'host' && isServerLayoutEmpty(incomingLayout)) {
    const legacyLayout = readLegacyLocalLayout(availableFiles);
    if (legacyLayout && !layoutsEqual(legacyLayout, nextLayout)) {
      nextLayout = legacyLayout;
      nextNames = normalizePlaylistNames(nextNames, nextLayout.length);
      shouldPush = true;
    }
  }

  layout = nextLayout;
  playlistNames = nextNames;
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

function renderZones() {
  zonesContainer.innerHTML = '';
  layout = ensurePlaylists(layout);

  layout.forEach((playlistFiles, playlistIndex) => {
    const zone = document.createElement('div');
    zone.className = 'zone';
    zone.dataset.zoneIndex = playlistIndex.toString();

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
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
    header.append(titleInput, count);

    const body = document.createElement('div');
    body.className = 'zone-body';

    playlistFiles.forEach((file, rowIndex) => {
      const hotkeyLabel = HOTKEY_ROWS[rowIndex]?.[playlistIndex] ?? null;
      body.appendChild(buildTrackCard(file, '/audio', { draggable: true, hotkeyLabel }));
    });

    body.addEventListener('dragover', (e) => applyDragPreview(body, e));

    zone.append(header, body);
    zonesContainer.appendChild(zone);
  });
}

function syncCurrentTrackState() {
  if (!currentTrack) return;
  setButtonPlaying(currentTrack.key, !!(currentAudio && !currentAudio.paused));
}

async function handleDrop(event, targetZoneIndex) {
  event.preventDefault();
  const file = event.dataTransfer.getData('text/plain');
  const sourceZoneIndex = findZoneIndex(file);
  if (sourceZoneIndex === -1 || file === '') return;

  const targetZone = event.currentTarget;
  targetZone.classList.remove('drag-over');
  dragDropHandled = true;

  syncLayoutFromDom();
  renderZones();
  try {
    await pushSharedLayout();
    setStatus('Плей-листы обновлены и синхронизированы.');
  } catch (err) {
    console.error(err);
    setStatus('Не удалось синхронизировать плей-листы.');
  }
}

function findZoneIndex(file) {
  return layout.findIndex((zone) => zone.includes(file));
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
    setStatus('Не удалось загрузить состояние плей-листов, используется локальная раскладка.');
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
      setButtonPlaying(track.key, false);
      stopProgressLoop();
      if (currentTrack && currentTrack.key === track.key) {
        currentAudio = null;
        currentTrack = null;
      }
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
        setButtonPlaying(track.key, false);
        stopProgressLoop();
        if (currentTrack && currentTrack.key === track.key) {
          currentAudio = null;
          currentTrack = null;
        }
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
    if (currentTrack && currentTrack.key === key) {
      setStatus(`Воспроизведение завершено: ${file}`);
      currentAudio = null;
      currentTrack = null;
    }
    setButtonPlaying(key, false);
    stopProgressLoop();
    resetProgress(key);
  });

  audio.addEventListener('error', () => {
    setStatus(`Ошибка воспроизведения: ${file}`);
    setButtonPlaying(key, false);
    stopProgressLoop();
    resetProgress(key);
    if (currentTrack && currentTrack.key === key) {
      currentAudio = null;
      currentTrack = null;
    }
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
        if (oldTrack) setButtonPlaying(oldTrack.key, false);
      }
      currentAudio = newAudio;
      currentTrack = newTrack;
      setButtonPlaying(newTrack.key, true);
      startProgressLoop(newAudio, newTrack.key);
      setStatus(`Играет: ${newTrack.file}`);
    }
  }

  requestAnimationFrame(step);
}

async function handlePlay(file, button, basePath = '/audio') {
  const overlaySeconds = Math.max(0, parseFloat(overlayTimeInput.value) || 0);
  const curve = overlayCurveSelect.value;
  const stopFadeSeconds = Math.max(0, parseFloat(stopFadeInput.value) || 0);
  const targetVolume = clampVolume(loadVolume(file, basePath));
  const track = { file, basePath, key: trackKey(file, basePath) };

  button.disabled = true;

  if (currentTrack && currentTrack.key === track.key && currentAudio && !currentAudio.paused) {
    await fadeOutAndStop(currentAudio, stopFadeSeconds, curve, track);
    setStatus(`Остановлено: ${file}`);
    button.disabled = false;
    return;
  }

  const audio = createAudio(track);
  audio.dataset.filename = file;
  audio.volume = overlaySeconds > 0 && currentAudio && !currentAudio.paused ? 0 : targetVolume;

  try {
    await audio.play();

    if (currentAudio && !currentAudio.paused && overlaySeconds > 0) {
      const oldTrack = currentTrack;
      setButtonPlaying(track.key, true);
      startProgressLoop(audio, track.key);
      applyOverlay(currentAudio, audio, targetVolume, overlaySeconds, curve, track, oldTrack);
    } else {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        if (currentTrack) setButtonPlaying(currentTrack.key, false);
      }
      resetFadeState();
      audio.volume = targetVolume;
      currentAudio = audio;
      currentTrack = track;
      setButtonPlaying(track.key, true);
      startProgressLoop(audio, track.key);
      setStatus(`Играет: ${file}`);
    }
  } catch (err) {
    console.error(err);
    setStatus('Не удалось начать воспроизведение.');
    setButtonPlaying(track.key, false);
    stopProgressLoop();
    resetProgress(track.key);
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

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function handleHotkey(event) {
  if (event.repeat) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isEditableTarget(event.target)) return;

  const { code } = event;
  if (code === 'Space') {
    if (currentAudio && currentTrack) {
      event.preventDefault();
      const stopFadeSeconds = Math.max(0, parseFloat(stopFadeInput.value) || 0);
      const curve = overlayCurveSelect.value;
      fadeOutAndStop(currentAudio, stopFadeSeconds, curve, currentTrack).then(() => {
        setStatus(`Остановлено: ${currentTrack ? currentTrack.file : ''}`.trim());
      });
    }
    return;
  }
  const rowIndex = HOTKEY_CODES.findIndex((row) => row.includes(code));
  if (rowIndex === -1) return;

  const playlistIndex = HOTKEY_CODES[rowIndex].indexOf(code);
  const playlistFiles = layout[playlistIndex];
  if (!playlistFiles || playlistFiles.length <= rowIndex) return;
  const file = playlistFiles[rowIndex];
  if (!file) return;

  const fileKey = trackKey(file, '/audio');
  const button = buttonsByFile.get(fileKey);
  if (!button) return;
  event.preventDefault();
  handlePlay(file, button, '/audio');
}

async function bootstrap() {
  const authorized = await ensureAuthorizedUser();
  if (!authorized) return;

  initSettings();
  initSidebarToggle();
  initServerControls();
  initPlaylistControls();
  initUpdater();
  window.addEventListener('beforeunload', clearLayoutStreamConnection);
  loadTracks();
  loadVersion();
  document.addEventListener('keydown', handleHotkey);
}

bootstrap();
