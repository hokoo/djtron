const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { version: appVersion } = require('./package.json');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || line.startsWith('#')) return;

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) return;

      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();

      if (key && process.env[key] === undefined) {
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    });
}

loadEnvFile();

const PORT = process.env.PORT || 3000;
const AUDIO_DIR = path.join(__dirname, 'audio');
const PUBLIC_DIR = path.join(__dirname, 'public');
const USERS_DIR = path.join(__dirname, 'users');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
const REPO_OWNER = 'hokoo';
const REPO_NAME = 'djtron';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const ONE_HOUR_MS = 60 * 60 * 1000;
const githubToken = process.env.GITHUB_TOKEN || null;
const UPDATE_CACHE_WINDOW_MS = githubToken ? 0 : ONE_HOUR_MS;
const UPDATE_STATE_PATH = path.join(__dirname, 'update-state.json');
const LAYOUT_STATE_PATH = path.join(__dirname, 'layout-state.json');
const SESSIONS_STATE_PATH = path.join(__dirname, 'sessions-state.json');

const execFileAsync = promisify(execFile);
const pipelineAsync = promisify(pipeline);

const AUDIO_DIR_RESOLVED = path.resolve(AUDIO_DIR);
const PUBLIC_DIR_RESOLVED = path.resolve(PUBLIC_DIR);
const USERS_DIR_RESOLVED = path.resolve(USERS_DIR);
const SESSION_COOKIE_NAME = 'chkg_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const AUTH_BODY_LIMIT_BYTES = 8 * 1024;
const LAYOUT_BODY_LIMIT_BYTES = 512 * 1024;
const PLAYBACK_BODY_LIMIT_BYTES = 32 * 1024;
const AUDIO_TAG_SCAN_BYTES = 256 * 1024;
const PLAYLIST_NAME_MAX_LENGTH = 80;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

let shuttingDown = false;
let updateInProgress = false;
const authSessions = new Map();
const audioAttributesCache = new Map();
const layoutSubscribers = new Set();
const githubCache = {
  latestRelease: { etag: null, data: null },
  releasesList: { etag: null, data: null },
};
function getDefaultUpdateState() {
  return {
    stable: { lastChecked: 0, result: null },
    prerelease: { lastChecked: 0, result: null },
  };
}

function sanitizeCachedResult(result) {
  if (!result || typeof result !== 'object') return null;

  const clean = {
    latestVersion: typeof result.latestVersion === 'string' ? result.latestVersion : null,
    tarballUrl: typeof result.tarballUrl === 'string' ? result.tarballUrl : null,
    htmlUrl: typeof result.htmlUrl === 'string' ? result.htmlUrl : null,
    isPrerelease: Boolean(result.isPrerelease),
    releaseName: typeof result.releaseName === 'string' ? result.releaseName : null,
  };

  if (!clean.latestVersion && !clean.tarballUrl && !clean.htmlUrl && !clean.releaseName) {
    return null;
  }

  return clean;
}

function loadPersistedUpdateState() {
  try {
    if (!fs.existsSync(UPDATE_STATE_PATH)) {
      return getDefaultUpdateState();
    }

    const raw = fs.readFileSync(UPDATE_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    const state = getDefaultUpdateState();

    ['stable', 'prerelease'].forEach((key) => {
      if (!parsed[key] || typeof parsed[key] !== 'object') return;

      const lastChecked = Number(parsed[key].lastChecked);
      if (Number.isFinite(lastChecked) && lastChecked > 0) {
        state[key].lastChecked = lastChecked;
      }

      const cachedResult = sanitizeCachedResult(parsed[key].result);
      if (cachedResult) {
        state[key].result = cachedResult;
      }
    });

    return state;
  } catch (err) {
    console.error('Failed to load update state cache', err);
    return getDefaultUpdateState();
  }
}

function persistUpdateState(state) {
  try {
    fs.writeFileSync(UPDATE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist update state cache', err);
  }
}

const persistedUpdateState = loadPersistedUpdateState();
const updateCheckCache = {
  stable: { lastChecked: persistedUpdateState.stable.lastChecked, result: persistedUpdateState.stable.result },
  prerelease: { lastChecked: persistedUpdateState.prerelease.lastChecked, result: persistedUpdateState.prerelease.result },
};

function getDefaultLayoutState() {
  return {
    version: 0,
    updatedAt: 0,
    layout: [[]],
    playlistNames: ['Плей-лист 1'],
    playlistMeta: [{ type: 'manual' }],
    playlistAutoplay: [false],
  };
}

function getDefaultPlaybackState() {
  return {
    trackFile: null,
    paused: false,
    currentTime: 0,
    duration: null,
    playlistIndex: null,
    playlistPosition: null,
    updatedAt: 0,
  };
}

function defaultPlaylistName(index) {
  return `Плей-лист ${index + 1}`;
}

function sanitizePlaylistName(value, index) {
  if (typeof value !== 'string') {
    return defaultPlaylistName(index);
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return defaultPlaylistName(index);
  }

  return normalized.slice(0, PLAYLIST_NAME_MAX_LENGTH);
}

function sanitizeLayout(layout) {
  if (!Array.isArray(layout)) return null;

  const normalized = [];

  layout.forEach((playlist) => {
    if (!Array.isArray(playlist)) return;

    const clean = [];
    playlist.forEach((value) => {
      if (typeof value !== 'string') return;
      const file = value.trim();
      if (!file) return;
      clean.push(file);
    });

    normalized.push(clean);
  });

  if (!normalized.length) {
    normalized.push([]);
  }

  return normalized;
}

function normalizePlaylistNames(playlistNames, layoutLength) {
  const result = [];

  for (let index = 0; index < layoutLength; index += 1) {
    const rawName = Array.isArray(playlistNames) ? playlistNames[index] : null;
    result.push(sanitizePlaylistName(rawName, index));
  }

  return result;
}

function normalizePlaylistAutoplayFlags(playlistAutoplay, layoutLength) {
  const result = [];

  for (let index = 0; index < layoutLength; index += 1) {
    const rawValue = Array.isArray(playlistAutoplay) ? playlistAutoplay[index] : false;
    result.push(Boolean(rawValue));
  }

  return result;
}

function sanitizeFolderKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (!normalized) return null;
  return normalized.slice(0, 512);
}

function sanitizeFolderOriginalName(value, fallback) {
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
    return { type: 'manual' };
  }

  if (value.type !== 'folder') {
    return { type: 'manual' };
  }

  const folderKey = sanitizeFolderKey(value.folderKey);
  if (!folderKey) {
    return { type: 'manual' };
  }

  const fallbackName = path.basename(folderKey) || folderKey;
  return {
    type: 'folder',
    folderKey,
    folderOriginalName: sanitizeFolderOriginalName(value.folderOriginalName, fallbackName),
  };
}

function normalizePlaylistMeta(playlistMeta, layoutLength) {
  const result = [];

  for (let index = 0; index < layoutLength; index += 1) {
    const rawValue = Array.isArray(playlistMeta) ? playlistMeta[index] : null;
    result.push(sanitizePlaylistMetaEntry(rawValue));
  }

  return result;
}

function normalizePlaylistTrackIndex(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function sanitizePlaybackState(rawPlayback) {
  const trackFile = typeof rawPlayback.trackFile === 'string' ? rawPlayback.trackFile.trim() : '';
  if (!trackFile) {
    return {
      ...getDefaultPlaybackState(),
      updatedAt: Date.now(),
    };
  }

  const rawCurrentTime = Number(rawPlayback.currentTime);
  let currentTime = Number.isFinite(rawCurrentTime) && rawCurrentTime >= 0 ? rawCurrentTime : 0;

  const rawDuration = Number(rawPlayback.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  if (duration !== null && currentTime > duration) {
    currentTime = duration;
  }

  return {
    trackFile,
    paused: Boolean(rawPlayback.paused),
    currentTime,
    duration,
    playlistIndex: normalizePlaylistTrackIndex(rawPlayback.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(rawPlayback.playlistPosition),
    updatedAt: Date.now(),
  };
}

function hasLivePlaybackTrack(state) {
  return Boolean(state && typeof state.trackFile === 'string' && state.trackFile.trim());
}

function isDeletingLivePlaybackPlaylist(nextLayout) {
  if (!hasLivePlaybackTrack(sharedPlaybackState)) return false;

  const livePlaylistIndex = normalizePlaylistTrackIndex(sharedPlaybackState.playlistIndex);
  if (livePlaylistIndex === null) return false;

  if (!Array.isArray(sharedLayoutState.layout[livePlaylistIndex])) return false;
  return !Array.isArray(nextLayout[livePlaylistIndex]);
}

function loadPersistedLayoutState() {
  try {
    if (!fs.existsSync(LAYOUT_STATE_PATH)) {
      return getDefaultLayoutState();
    }

    const raw = fs.readFileSync(LAYOUT_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const sanitizedLayout = sanitizeLayout(parsed.layout);
    if (!sanitizedLayout) {
      return getDefaultLayoutState();
    }
    const sanitizedNames = normalizePlaylistNames(parsed.playlistNames, sanitizedLayout.length);
    const sanitizedMeta = normalizePlaylistMeta(parsed.playlistMeta, sanitizedLayout.length);
    const sanitizedAutoplay = normalizePlaylistAutoplayFlags(parsed.playlistAutoplay, sanitizedLayout.length);

    const version = Number(parsed.version);
    const updatedAt = Number(parsed.updatedAt);

    return {
      version: Number.isFinite(version) && version >= 0 ? version : 0,
      updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
      layout: sanitizedLayout,
      playlistNames: sanitizedNames,
      playlistMeta: sanitizedMeta,
      playlistAutoplay: sanitizedAutoplay,
    };
  } catch (err) {
    console.error('Failed to load layout state cache', err);
    return getDefaultLayoutState();
  }
}

function persistLayoutState(state) {
  try {
    fs.writeFileSync(LAYOUT_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist layout state cache', err);
  }
}

function sanitizeClientId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, 128);
}

function serializePlaybackState(state) {
  return JSON.stringify({
    trackFile: typeof state.trackFile === 'string' ? state.trackFile : null,
    paused: Boolean(state.paused),
    currentTime: Number.isFinite(state.currentTime) && state.currentTime >= 0 ? state.currentTime : 0,
    duration: Number.isFinite(state.duration) && state.duration > 0 ? state.duration : null,
    playlistIndex: normalizePlaylistTrackIndex(state.playlistIndex),
    playlistPosition: normalizePlaylistTrackIndex(state.playlistPosition),
  });
}

function buildLayoutPayload(sourceClientId = null) {
  return {
    layout: sharedLayoutState.layout,
    playlistNames: sharedLayoutState.playlistNames,
    playlistMeta: sharedLayoutState.playlistMeta,
    playlistAutoplay: sharedLayoutState.playlistAutoplay,
    version: sharedLayoutState.version,
    updatedAt: sharedLayoutState.updatedAt,
    sourceClientId,
  };
}

function buildPlaybackPayload(sourceClientId = null) {
  return {
    trackFile: sharedPlaybackState.trackFile,
    paused: sharedPlaybackState.paused,
    currentTime: sharedPlaybackState.currentTime,
    duration: sharedPlaybackState.duration,
    playlistIndex: sharedPlaybackState.playlistIndex,
    playlistPosition: sharedPlaybackState.playlistPosition,
    updatedAt: sharedPlaybackState.updatedAt,
    sourceClientId,
  };
}

function sendSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastLayoutUpdate(sourceClientId = null) {
  const payload = buildLayoutPayload(sourceClientId);

  for (const res of layoutSubscribers) {
    try {
      sendSseEvent(res, 'layout', payload);
    } catch (err) {
      layoutSubscribers.delete(res);
    }
  }
}

function broadcastPlaybackUpdate(sourceClientId = null) {
  const payload = buildPlaybackPayload(sourceClientId);

  for (const res of layoutSubscribers) {
    try {
      sendSseEvent(res, 'playback', payload);
    } catch (err) {
      layoutSubscribers.delete(res);
    }
  }
}

function keepLayoutStreamAlive() {
  for (const res of layoutSubscribers) {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      layoutSubscribers.delete(res);
    }
  }
}

let sharedLayoutState = loadPersistedLayoutState();
let sharedPlaybackState = getDefaultPlaybackState();
setInterval(keepLayoutStreamAlive, 25 * 1000).unref();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAudioFile(filenameOrPath) {
  return AUDIO_EXTENSIONS.has(path.extname(filenameOrPath).toLowerCase());
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
  };
  return map[ext] || 'application/octet-stream';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function isInside(baseResolved, targetResolved) {
  const rel = path.relative(baseResolved, targetResolved);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function normalizeIpAddress(ip) {
  if (typeof ip !== 'string') return '';
  let normalized = ip.trim().toLowerCase();
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) {
    normalized = normalized.slice(0, zoneIndex);
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }
  return normalized;
}

function buildLocalAddressSet() {
  const set = new Set(['127.0.0.1', '::1']);
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach((entries) => {
    if (!Array.isArray(entries)) return;
    entries.forEach((entry) => {
      if (!entry || typeof entry.address !== 'string') return;
      set.add(normalizeIpAddress(entry.address));
    });
  });

  return set;
}

const LOCAL_ADDRESSES = buildLocalAddressSet();

function isServerRequest(req) {
  const remoteAddress = normalizeIpAddress(req.socket && req.socket.remoteAddress);
  return remoteAddress !== '' && LOCAL_ADDRESSES.has(remoteAddress);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};

  return header.split(';').reduce((acc, chunk) => {
    const [rawName, ...rawValueParts] = chunk.split('=');
    const name = rawName ? rawName.trim() : '';
    if (!name) return acc;

    const value = rawValueParts.join('=').trim();
    try {
      acc[name] = decodeURIComponent(value);
    } catch (err) {
      acc[name] = value;
    }
    return acc;
  }, {});
}

function safeCompareStrings(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeSessionRecord(token, rawSession, now) {
  if (!SESSION_TOKEN_PATTERN.test(token)) return null;
  if (!rawSession || typeof rawSession !== 'object') return null;

  const username = typeof rawSession.username === 'string' ? rawSession.username : '';
  const expiresAt = Number(rawSession.expiresAt);

  if (!USERNAME_PATTERN.test(username)) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  return { username, expiresAt };
}

function persistSessions() {
  try {
    const now = Date.now();
    const serialized = {};

    for (const [token, rawSession] of authSessions.entries()) {
      const session = sanitizeSessionRecord(token, rawSession, now);
      if (!session) {
        authSessions.delete(token);
        continue;
      }

      serialized[token] = session;
    }

    fs.writeFileSync(SESSIONS_STATE_PATH, JSON.stringify(serialized, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist auth sessions cache', err);
  }
}

function loadPersistedSessions() {
  try {
    if (!fs.existsSync(SESSIONS_STATE_PATH)) return;

    const raw = fs.readFileSync(SESSIONS_STATE_PATH, 'utf8');
    if (!raw.trim()) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid auth sessions cache format');
    }

    const now = Date.now();
    let hasInvalidEntries = false;

    for (const [token, rawSession] of Object.entries(parsed)) {
      const session = sanitizeSessionRecord(token, rawSession, now);
      if (!session) {
        hasInvalidEntries = true;
        continue;
      }

      authSessions.set(token, session);
    }

    if (hasInvalidEntries) {
      persistSessions();
    }
  } catch (err) {
    console.error('Failed to load auth sessions cache', err);
  }
}

function createSession(username) {
  const token = createSessionToken();
  authSessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  persistSessions();
  return token;
}

function getSessionByToken(token) {
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    persistSessions();
    return null;
  }
  return session;
}

function destroySession(token) {
  if (!token) return;
  if (authSessions.delete(token)) {
    persistSessions();
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  let changed = false;

  for (const [token, session] of authSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      authSessions.delete(token);
      changed = true;
    }
  }

  if (changed) {
    persistSessions();
  }
}

loadPersistedSessions();
setInterval(cleanupExpiredSessions, 5 * 60 * 1000).unref();

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function extractPasswordFromFile(content) {
  if (typeof content !== 'string') return null;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return null;
}

async function getUserPassword(username) {
  const candidates = [`${username}.txt`, username];

  for (const fileName of candidates) {
    const fullPath = path.resolve(USERS_DIR_RESOLVED, fileName);
    if (!isInside(USERS_DIR_RESOLVED, fullPath)) continue;

    try {
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) continue;
      const raw = await fs.promises.readFile(fullPath, 'utf8');
      return extractPasswordFromFile(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Failed to read user file', fullPath, err);
      }
    }
  }

  return null;
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim();
  if (!USERNAME_PATTERN.test(username)) return null;
  return username;
}

function readJsonBody(req, limitBytes = AUTH_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;

    req.on('data', (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > limitBytes) {
        done = true;
        req.resume();
        reject(new Error('BODY_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (done) return;
      done = true;
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (err) {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function getAuthState(req) {
  if (isServerRequest(req)) {
    return {
      authenticated: true,
      isServer: true,
      role: 'host',
      username: 'server',
    };
  }

  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  const session = getSessionByToken(token);

  if (!session) {
    return {
      authenticated: false,
      isServer: false,
      role: null,
      username: null,
      token: null,
    };
  }

  return {
    authenticated: true,
    isServer: false,
    role: 'slave',
    username: session.username,
    token,
  };
}

function requireAuthorizedRequest(req, res, responseKind = 'json') {
  const auth = getAuthState(req);
  if (auth.authenticated) return auth;

  if (responseKind === 'text') {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Unauthorized');
    return null;
  }

  sendJson(res, 401, { error: 'Требуется авторизация' });
  return null;
}

function normalizeVersion(version) {
  if (typeof version !== 'string') return null;
  return version.replace(/^v/i, '').trim();
}

function parseBooleanParam(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function compareVersions(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);

  if (!left || !right) return 0;

  const leftParts = left.split('.').map((p) => parseInt(p, 10) || 0);
  const rightParts = right.split('.').map((p) => parseInt(p, 10) || 0);
  const maxLen = Math.max(leftParts.length, rightParts.length);

  for (let i = 0; i < maxLen; i += 1) {
    const l = leftParts[i] || 0;
    const r = rightParts[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  return 0;
}

function computeRateLimitDelay(headers, fallbackMs) {
  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const retrySeconds = parseFloat(retryAfter);
    if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
      return retrySeconds * 1000;
    }
  }

  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];

  if (remaining === '0' && reset) {
    const resetMs = parseInt(reset, 10) * 1000 - Date.now();
    if (Number.isFinite(resetMs) && resetMs > 0) {
      return resetMs;
    }
  }

  return fallbackMs;
}

async function fetchGithubJsonWithETag(url, cacheEntry, attempt = 1, backoffMs = 1000) {
  const headers = { 'User-Agent': 'djtron-updater', Accept: 'application/vnd.github+json' };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }
  if (cacheEntry && cacheEntry.etag) {
    headers['If-None-Match'] = cacheEntry.etag;
  }

  const performRequest = () =>
    new Promise((resolve, reject) => {
      const request = https.get(url, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchGithubJsonWithETag(res.headers.location, cacheEntry, attempt, backoffMs).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode === 304) {
          res.resume();
          if (cacheEntry && cacheEntry.data) {
            resolve({ data: cacheEntry.data, etag: cacheEntry.etag, fromCache: true });
          } else {
            reject(new Error('Получен 304 без сохраненных данных'));
          }
          return;
        }

        if (res.statusCode === 403 || res.statusCode === 429) {
          const waitMs = computeRateLimitDelay(res.headers, backoffMs);
          res.resume();
          if (attempt < 3) {
            delay(waitMs)
              .then(() => fetchGithubJsonWithETag(url, cacheEntry, attempt + 1, Math.min(backoffMs * 2, 16000)))
              .then(resolve)
              .catch(reject);
            return;
          }
          reject(new Error('Превышены лимиты GitHub API, попробуйте позже'));
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API responded with status ${res.statusCode}`));
          res.resume();
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve({ data: parsed, etag: res.headers.etag || null, fromCache: false });
          } catch (err) {
            reject(err);
          }
        });
      });

      request.on('error', reject);
    });

  return performRequest();
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);

    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        https.get(res.headers.location, { headers: { 'User-Agent': 'djtron-updater' } }, handleResponse).on(
          'error',
          reject
        );
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with status ${res.statusCode}`));
        res.resume();
        return;
      }

      pipelineAsync(res, file)
        .then(resolve)
        .catch((err) => {
          fs.unlink(destination, () => reject(err));
        });
    };

    https
      .get(url, { headers: { 'User-Agent': 'djtron-updater' } }, handleResponse)
      .on('error', (err) => {
        fs.unlink(destination, () => reject(err));
      });
  });
}

function parseReleaseVersion(release) {
  if (!release) return null;
  const candidates = [release.tag_name, release.name];

  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const match = /v(\d+(?:\.\d+)*)/i.exec(value);
    if (match) return match[1];
  }

  return null;
}

async function fetchLatestRelease() {
  const result = await fetchGithubJsonWithETag(`${GITHUB_API_URL}/releases/latest`, githubCache.latestRelease);
  githubCache.latestRelease.etag = result.etag || githubCache.latestRelease.etag;
  githubCache.latestRelease.data = result.data || githubCache.latestRelease.data;
  return githubCache.latestRelease.data;
}

async function fetchLatestPrerelease() {
  const result = await fetchGithubJsonWithETag(`${GITHUB_API_URL}/releases?per_page=20`, githubCache.releasesList);
  githubCache.releasesList.etag = result.etag || githubCache.releasesList.etag;
  githubCache.releasesList.data = result.data || githubCache.releasesList.data;

  const releases = result.data;
  if (!Array.isArray(releases)) return null;

  return releases.find((rel) => rel && !rel.draft && rel.prerelease) || null;
}

async function getLatestReleaseInfo(currentVersion, allowPrerelease = false) {
  const cacheKey = allowPrerelease ? 'prerelease' : 'stable';
  const cacheEntry = updateCheckCache[cacheKey];
  const now = Date.now();

  if (cacheEntry.result && UPDATE_CACHE_WINDOW_MS > 0 && now - cacheEntry.lastChecked < UPDATE_CACHE_WINDOW_MS) {
    return cacheEntry.result;
  }

  const release = await fetchLatestRelease();
  const releaseVersion = parseReleaseVersion(release);

  let latest = {
    latestVersion: releaseVersion,
    tarballUrl: release && release.tarball_url,
    htmlUrl: release && release.html_url,
    isPrerelease: false,
    releaseName: release && release.name,
  };

  if (allowPrerelease) {
    const prerelease = await fetchLatestPrerelease();
    const prereleaseVersion = parseReleaseVersion(prerelease);

    if (prerelease && prereleaseVersion && compareVersions(prereleaseVersion, currentVersion) > 0) {
      latest = {
        latestVersion: prereleaseVersion,
        tarballUrl: prerelease && prerelease.tarball_url,
        htmlUrl: prerelease && prerelease.html_url,
        isPrerelease: true,
        releaseName: prerelease && prerelease.name,
      };
    }
  }

  cacheEntry.lastChecked = now;
  cacheEntry.result = latest;
  persistUpdateState(updateCheckCache);

  return latest;
}

async function extractTarball(archivePath, targetDir) {
  await execFileAsync('tar', ['-xzf', archivePath, '-C', targetDir]);
}

async function findExtractedRoot(tempDir) {
  const entries = await fs.promises.readdir(tempDir, { withFileTypes: true });
  const folder = entries.find((entry) => entry.isDirectory());
  if (!folder) {
    throw new Error('Не удалось найти содержимое распакованного архива');
  }
  return path.join(tempDir, folder.name);
}

async function copyReleaseContents(sourceDir, targetDir) {
  await fs.promises.cp(sourceDir, targetDir, { recursive: true, force: true });
}

function safeResolve(baseDirResolved, requestPath) {
  // requestPath must be without leading slashes
  const resolved = path.resolve(baseDirResolved, requestPath);
  return isInside(baseDirResolved, resolved) ? resolved : null;
}

function serveFile(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stat.size,
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveAudioWithRange(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const total = stat.size;
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;

    // No Range: serve the entire file.
    if (!range) {
      const headers = {
        'Content-Type': contentType,
        'Content-Length': total,
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
      }

      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Range: bytes=start-end
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }

    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }

    end = Math.min(end, total - 1);

    const chunkSize = end - start + 1;

    const headers = {
      'Content-Type': contentType,
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${start}-${end}/${total}`,
    };

    if (req.method === 'HEAD') {
      res.writeHead(206, headers);
      res.end();
      return;
    }

    res.writeHead(206, headers);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  });
}

function normalizeAudioRelativePath(relativePath) {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function stripFileExtension(fileName) {
  if (typeof fileName !== 'string') return '';
  const extension = path.extname(fileName);
  if (!extension) return fileName;
  return fileName.slice(0, -extension.length);
}

function sanitizeAudioAttributeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function decodeUtf16Be(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return '';
  const evenLength = buffer.length - (buffer.length % 2);
  if (evenLength <= 0) return '';

  const swapped = Buffer.allocUnsafe(evenLength);
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = buffer[index + 1];
    swapped[index + 1] = buffer[index];
  }
  return swapped.toString('utf16le');
}

function decodeId3TextFrame(frameData) {
  if (!Buffer.isBuffer(frameData) || frameData.length <= 1) return '';

  const encoding = frameData[0];
  const payload = frameData.subarray(1);
  let decoded = '';

  switch (encoding) {
    case 0:
      decoded = payload.toString('latin1');
      break;
    case 1:
      if (payload.length >= 2 && payload[0] === 0xfe && payload[1] === 0xff) {
        decoded = decodeUtf16Be(payload.subarray(2));
      } else if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe) {
        decoded = payload.subarray(2).toString('utf16le');
      } else {
        decoded = payload.toString('utf16le');
      }
      break;
    case 2:
      decoded = decodeUtf16Be(payload);
      break;
    case 3:
      decoded = payload.toString('utf8');
      break;
    default:
      decoded = payload.toString('utf8');
      break;
  }

  const firstToken = decoded
    .split(/\u0000+/)
    .map((part) => sanitizeAudioAttributeText(part))
    .find(Boolean);
  return firstToken || sanitizeAudioAttributeText(decoded);
}

function readSynchsafeInt(buffer, offset) {
  if (!Buffer.isBuffer(buffer) || offset < 0 || offset + 4 > buffer.length) return 0;
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

function parseId3v2Attributes(buffer) {
  const empty = { title: '', artist: '' };
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return empty;
  if (buffer.toString('latin1', 0, 3) !== 'ID3') return empty;

  const versionMajor = buffer[3];
  const flags = buffer[5];
  const hasFooter = (flags & 0x10) === 0x10;
  const declaredTagSize = readSynchsafeInt(buffer, 6);
  const maxTagSize = buffer.length - 10;
  const tagBodySize = Math.max(0, Math.min(declaredTagSize, maxTagSize));
  const totalTagBytes = 10 + tagBodySize + (hasFooter ? 10 : 0);
  const maxOffset = Math.min(totalTagBytes, buffer.length);

  let cursor = 10;
  let title = '';
  let artist = '';

  while (cursor + 10 <= maxOffset) {
    if (
      buffer[cursor] === 0 &&
      buffer[cursor + 1] === 0 &&
      buffer[cursor + 2] === 0 &&
      buffer[cursor + 3] === 0
    ) {
      break;
    }

    const frameId = buffer.toString('latin1', cursor, cursor + 4);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) {
      break;
    }

    const frameSize = versionMajor === 4 ? readSynchsafeInt(buffer, cursor + 4) : buffer.readUInt32BE(cursor + 4);
    if (!Number.isFinite(frameSize) || frameSize <= 0) {
      cursor += 10;
      continue;
    }

    const frameStart = cursor + 10;
    const frameEnd = frameStart + frameSize;
    if (frameEnd > maxOffset || frameStart >= frameEnd) {
      break;
    }

    const frameData = buffer.subarray(frameStart, frameEnd);
    if (frameId === 'TIT2' && !title) {
      title = decodeId3TextFrame(frameData);
    } else if (frameId === 'TPE1' && !artist) {
      artist = decodeId3TextFrame(frameData);
    }

    if (title && artist) {
      break;
    }

    cursor = frameEnd;
  }

  return {
    title: sanitizeAudioAttributeText(title),
    artist: sanitizeAudioAttributeText(artist),
  };
}

function parseId3v1Attributes(buffer) {
  const empty = { title: '', artist: '' };
  if (!Buffer.isBuffer(buffer) || buffer.length < 128) return empty;
  if (buffer.toString('latin1', 0, 3) !== 'TAG') return empty;

  return {
    title: sanitizeAudioAttributeText(buffer.toString('latin1', 3, 33)),
    artist: sanitizeAudioAttributeText(buffer.toString('latin1', 33, 63)),
  };
}

async function readFileSlice(filePath, start, length) {
  const safeLength = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  if (safeLength <= 0) return Buffer.alloc(0);

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(safeLength);
    const safeStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
    const { bytesRead } = await handle.read(buffer, 0, safeLength, safeStart);
    return bytesRead === safeLength ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function extractAudioAttributes(filePath, stat) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.mp3') {
    return { title: '', artist: '' };
  }

  const size = Number.isFinite(stat && stat.size) ? Math.max(0, stat.size) : 0;
  let result = { title: '', artist: '' };

  if (size > 0) {
    const headLength = Math.min(size, AUDIO_TAG_SCAN_BYTES);
    const head = await readFileSlice(filePath, 0, headLength);
    result = parseId3v2Attributes(head);
  }

  if ((!result.title || !result.artist) && size >= 128) {
    const tail = await readFileSlice(filePath, size - 128, 128);
    const id3v1 = parseId3v1Attributes(tail);
    if (!result.title && id3v1.title) {
      result.title = id3v1.title;
    }
    if (!result.artist && id3v1.artist) {
      result.artist = id3v1.artist;
    }
  }

  return {
    title: sanitizeAudioAttributeText(result.title),
    artist: sanitizeAudioAttributeText(result.artist),
  };
}

function buildAudioAttributeDisplayName(attributes, fallbackName) {
  const title = sanitizeAudioAttributeText(attributes && attributes.title);
  const artist = sanitizeAudioAttributeText(attributes && attributes.artist);
  if (title && artist) return `${artist} - ${title}`;
  return title || artist || fallbackName;
}

async function getAudioAttributesCached(relativeFile, absoluteFile, stat) {
  const normalizedRelative = normalizeAudioRelativePath(relativeFile || '');
  if (!normalizedRelative) {
    return { title: '', artist: '' };
  }

  const fileStat = stat || (await fs.promises.stat(absoluteFile));
  const cached = audioAttributesCache.get(normalizedRelative);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.attributes;
  }

  const attributes = await extractAudioAttributes(absoluteFile, fileStat);
  audioAttributesCache.set(normalizedRelative, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    attributes,
  });

  return attributes;
}

async function collectAudioCatalog() {
  const files = [];
  const folders = [];

  const walk = async (absoluteDir, relativeDir = '') => {
    let entries;
    try {
      entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    const sortedEntries = entries.slice().sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    const folderFiles = [];
    const childFolders = [];

    for (const entry of sortedEntries) {
      if (entry.name.startsWith('.')) continue;

      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const normalizedChildRelative = normalizeAudioRelativePath(childRelative);

      if (entry.isDirectory()) {
        childFolders.push({ absolute: path.join(absoluteDir, entry.name), relative: normalizedChildRelative });
        continue;
      }

      if (!entry.isFile() || !isAudioFile(entry.name)) continue;
      files.push(normalizedChildRelative);
      if (relativeDir) {
        folderFiles.push(normalizedChildRelative);
      }
    }

    if (relativeDir && folderFiles.length) {
      const normalizedKey = normalizeAudioRelativePath(relativeDir);
      const folderName = path.basename(normalizedKey) || normalizedKey;
      folders.push({
        key: normalizedKey,
        name: folderName,
        files: folderFiles,
      });
    }

    for (const childFolder of childFolders) {
      await walk(childFolder.absolute, childFolder.relative);
    }
  };

  await walk(AUDIO_DIR_RESOLVED, '');

  return {
    files,
    folders: folders.sort((left, right) => left.key.localeCompare(right.key, 'ru')),
  };
}

async function handleApiAudio(req, res) {
  try {
    const catalog = await collectAudioCatalog();
    sendJson(res, 200, catalog);
  } catch (err) {
    console.error('Failed to read audio directory', err);
    sendJson(res, 500, { error: 'Failed to read audio directory' });
  }
}

async function handleApiAudioAttributes(req, res, requestUrl) {
  const rawFile = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get('file') : null;
  if (typeof rawFile !== 'string') {
    sendJson(res, 400, { error: 'Нужен параметр file' });
    return;
  }

  const normalizedFile = normalizeAudioRelativePath(rawFile.trim());
  if (!normalizedFile) {
    sendJson(res, 400, { error: 'Неверное имя файла' });
    return;
  }

  const absoluteFilePath = safeResolve(AUDIO_DIR_RESOLVED, normalizedFile);
  if (!absoluteFilePath) {
    sendJson(res, 400, { error: 'Неверный путь к файлу' });
    return;
  }

  if (!isAudioFile(absoluteFilePath)) {
    sendJson(res, 400, { error: 'Неверный тип файла' });
    return;
  }

  let fileStat;
  try {
    fileStat = await fs.promises.stat(absoluteFilePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      sendJson(res, 404, { error: 'Файл не найден' });
      return;
    }
    console.error('Failed to read file stats', err);
    sendJson(res, 500, { error: 'Не удалось прочитать файл' });
    return;
  }

  if (!fileStat.isFile()) {
    sendJson(res, 404, { error: 'Файл не найден' });
    return;
  }

  try {
    const attributes = await getAudioAttributesCached(normalizedFile, absoluteFilePath, fileStat);
    const fallbackName = stripFileExtension(path.basename(normalizedFile));
    const displayName = buildAudioAttributeDisplayName(attributes, fallbackName);

    sendJson(res, 200, {
      file: normalizedFile,
      title: attributes.title || null,
      artist: attributes.artist || null,
      displayName,
    });
  } catch (err) {
    console.error('Failed to extract audio attributes', err);
    sendJson(res, 500, { error: 'Не удалось прочитать атрибуты трека' });
  }
}

function handleApiVersion(req, res) {
  sendJson(res, 200, { version: appVersion });
}

function handleApiLayoutGet(req, res) {
  sendJson(res, 200, buildLayoutPayload(null));
}

function handleApiPlaybackGet(req, res) {
  sendJson(res, 200, buildPlaybackPayload(null));
}

async function handleApiLayoutUpdate(req, res) {
  const auth = getAuthState(req);
  let body;
  try {
    body = await readJsonBody(req, LAYOUT_BODY_LIMIT_BYTES);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const nextLayout = sanitizeLayout(body.layout);
  if (!nextLayout) {
    sendJson(res, 400, { error: 'Неверный формат плей-листов' });
    return;
  }

  if (isDeletingLivePlaybackPlaylist(nextLayout)) {
    sendJson(res, 409, { error: 'Нельзя удалить плей-лист, который сейчас играет на лайве.' });
    return;
  }

  const nextPlaylistNames = normalizePlaylistNames(body.playlistNames, nextLayout.length);
  const nextPlaylistMeta = normalizePlaylistMeta(
    Array.isArray(body.playlistMeta) ? body.playlistMeta : sharedLayoutState.playlistMeta,
    nextLayout.length,
  );
  const nextPlaylistAutoplay = auth.isServer
    ? normalizePlaylistAutoplayFlags(body.playlistAutoplay, nextLayout.length)
    : normalizePlaylistAutoplayFlags(sharedLayoutState.playlistAutoplay, nextLayout.length);

  const sourceClientId = sanitizeClientId(body.clientId);
  const hasChanged =
    JSON.stringify(nextLayout) !== JSON.stringify(sharedLayoutState.layout) ||
    JSON.stringify(nextPlaylistNames) !== JSON.stringify(sharedLayoutState.playlistNames) ||
    JSON.stringify(nextPlaylistMeta) !== JSON.stringify(sharedLayoutState.playlistMeta) ||
    JSON.stringify(nextPlaylistAutoplay) !== JSON.stringify(sharedLayoutState.playlistAutoplay);

  if (hasChanged) {
    sharedLayoutState = {
      layout: nextLayout,
      playlistNames: nextPlaylistNames,
      playlistMeta: nextPlaylistMeta,
      playlistAutoplay: nextPlaylistAutoplay,
      version: sharedLayoutState.version + 1,
      updatedAt: Date.now(),
    };
    persistLayoutState(sharedLayoutState);
    broadcastLayoutUpdate(sourceClientId);
  }

  sendJson(res, 200, buildLayoutPayload(sourceClientId));
}

async function handleApiPlaybackUpdate(req, res) {
  const auth = getAuthState(req);
  if (!auth.isServer) {
    sendJson(res, 403, { error: 'Только хост может обновлять состояние воспроизведения' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, PLAYBACK_BODY_LIMIT_BYTES);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const nextState = sanitizePlaybackState(body);
  const sourceClientId = sanitizeClientId(body.clientId);
  const hasChanged = serializePlaybackState(nextState) !== serializePlaybackState(sharedPlaybackState);

  if (hasChanged) {
    sharedPlaybackState = nextState;
    broadcastPlaybackUpdate(sourceClientId);
  }

  sendJson(res, 200, buildPlaybackPayload(sourceClientId));
}

function handleApiLayoutStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  layoutSubscribers.add(res);
  sendSseEvent(res, 'layout', buildLayoutPayload(null));
  sendSseEvent(res, 'playback', buildPlaybackPayload(null));

  req.on('close', () => {
    layoutSubscribers.delete(res);
  });
}

function handleAuthSession(req, res) {
  const auth = getAuthState(req);
  sendJson(res, 200, {
    authenticated: auth.authenticated,
    isServer: auth.isServer,
    role: auth.role,
    username: auth.username,
  });
}

async function handleAuthLogin(req, res) {
  if (isServerRequest(req)) {
    sendJson(res, 200, { authenticated: true, isServer: true, role: 'host', username: 'server' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err.message === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'Слишком большой запрос' });
      return;
    }

    if (err.message === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'Неверный формат JSON' });
      return;
    }

    sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
    return;
  }

  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || password.length === 0) {
    sendJson(res, 400, { error: 'Укажите логин и пароль' });
    return;
  }

  try {
    const expectedPassword = await getUserPassword(username);
    const isValid = expectedPassword !== null && safeCompareStrings(expectedPassword, password);

    if (!isValid) {
      sendJson(res, 401, { error: 'Неверный логин или пароль' });
      return;
    }

    const token = createSession(username);
    setSessionCookie(res, token);
    sendJson(res, 200, { authenticated: true, isServer: false, role: 'slave', username });
  } catch (err) {
    console.error('Auth login failed', err);
    sendJson(res, 500, { error: 'Ошибка авторизации' });
  }
}

function handleAuthLogout(req, res) {
  const cookies = parseCookies(req);
  destroySession(cookies[SESSION_COOKIE_NAME]);
  clearSessionCookie(res);
  sendJson(res, 200, { authenticated: false });
}

async function handleUpdateCheck(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const allowPrerelease = parseBooleanParam(url, 'allowPrerelease');
    const { latestVersion, htmlUrl, isPrerelease, releaseName } = await getLatestReleaseInfo(appVersion, allowPrerelease);
    const comparableLatest = latestVersion || null;
    const hasUpdate = comparableLatest ? compareVersions(comparableLatest, appVersion) > 0 : false;

    sendJson(res, 200, {
      currentVersion: appVersion,
      latestVersion: comparableLatest,
      hasUpdate,
      releaseUrl: htmlUrl || null,
      isPrerelease: Boolean(isPrerelease),
      releaseName: releaseName || null,
    });
  } catch (err) {
    console.error('Update check failed', err);
    sendJson(res, 500, { error: 'Не удалось проверить наличие обновлений', details: err.message });
  }
}

async function handleUpdateApply(req, res) {
  if (updateInProgress) {
    sendJson(res, 409, { message: 'Обновление уже выполняется' });
    return;
  }

  updateInProgress = true;

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const allowPrerelease = parseBooleanParam(url, 'allowPrerelease');
    const { latestVersion, tarballUrl } = await getLatestReleaseInfo(appVersion, allowPrerelease);
    const comparableLatest = latestVersion || null;
    const hasUpdate = comparableLatest ? compareVersions(comparableLatest, appVersion) > 0 : false;

    if (!hasUpdate) {
      sendJson(res, 200, { message: 'Установлена последняя версия приложения' });
      return;
    }

    if (!tarballUrl) {
      throw new Error('Не удалось найти архив релиза для загрузки');
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'djtron-update-'));
    const archivePath = path.join(tempDir, 'release.tar.gz');

    await downloadFile(tarballUrl, archivePath);
    await extractTarball(archivePath, tempDir);
    const extractedRoot = await findExtractedRoot(tempDir);
    await copyReleaseContents(extractedRoot, __dirname);

    sendJson(res, 200, { message: 'Обновление установлено. Приложение будет закрыто.' });
  } catch (err) {
    console.error('Update apply failed', err);
    sendJson(res, 500, { error: 'Не удалось выполнить обновление', details: err.message });
  } finally {
    updateInProgress = false;
  }
}

function handleShutdown(req, res) {
  if (shuttingDown) {
    sendJson(res, 409, { message: 'Server is already stopping' });
    return;
  }

  shuttingDown = true;
  sendJson(res, 200, { message: 'Server is stopping' });
  console.log('Shutdown requested. Stopping server...');

  const exit = () => process.exit(0);
  server.close(exit);
  setTimeout(exit, 1000).unref();
}

function handleAudioFile(req, res, pathname, baseResolved, basePrefix) {
  const prefix = basePrefix.endsWith('/') ? basePrefix : `${basePrefix}/`;
  const requested = pathname.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '').replace(/^\/+/, '');
  const filePath = safeResolve(baseResolved, requested);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!isAudioFile(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  serveAudioWithRange(req, res, filePath, getContentType(filePath));
}

function handlePublic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = safeResolve(PUBLIC_DIR_RESOLVED, requested);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveFile(req, res, filePath, getContentType(filePath));
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  let requestUrl = null;

  try {
    requestUrl = new URL(req.url, `http://${req.headers.host}`);
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (pathname === '/api/auth/session') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthSession(req, res);
    return;
  }

  if (pathname === '/api/auth/login') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthLogin(req, res);
    return;
  }

  if (pathname === '/api/auth/logout') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAuthLogout(req, res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    const auth = requireAuthorizedRequest(req, res, 'json');
    if (!auth) return;
  }

  if (pathname.startsWith('/audio/')) {
    const auth = requireAuthorizedRequest(req, res, 'text');
    if (!auth) return;
  }

  if (pathname === '/api/layout/stream') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiLayoutStream(req, res);
    return;
  }

  if (pathname === '/api/layout') {
    if (req.method === 'GET') {
      handleApiLayoutGet(req, res);
      return;
    }

    if (req.method === 'POST') {
      handleApiLayoutUpdate(req, res);
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/api/playback') {
    if (req.method === 'GET') {
      handleApiPlaybackGet(req, res);
      return;
    }

    if (req.method === 'POST') {
      handleApiPlaybackUpdate(req, res);
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/api/shutdown') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    const auth = getAuthState(req);
    if (!auth.isServer) {
      sendJson(res, 403, { error: 'Только хост может останавливать сервер' });
      return;
    }

    handleShutdown(req, res);
    return;
  }

  if (pathname === '/api/audio') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiAudio(req, res);
    return;
  }

  if (pathname === '/api/audio/attributes') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiAudioAttributes(req, res, requestUrl);
    return;
  }

  if (pathname === '/api/version') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleApiVersion(req, res);
    return;
  }

  if (pathname === '/api/update/check') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleUpdateCheck(req, res);
    return;
  }

  if (pathname === '/api/update/apply') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleUpdateApply(req, res);
    return;
  }

  if (pathname.startsWith('/audio/')) {
    // Allow GET and HEAD for proper metadata fetching.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleAudioFile(req, res, pathname, AUDIO_DIR_RESOLVED, '/audio/');
    return;
  }

  // Public files: allow GET and HEAD.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  handlePublic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
