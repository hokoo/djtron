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
const { PlaybackCommandBus } = require('./lib/playback/commandBus');
const { canDispatchLivePlaybackCommand } = require('./lib/playback/rolePolicy');
const { HttpRouter } = require('./src/http/HttpRouter');
const { AuthSessionManager } = require('./src/auth/AuthSessionManager');
const { createAuthGuard } = require('./src/http/middlewares/auth');
const { ConfigManager } = require('./src/config/ConfigManager');
const { PlaybackGateway } = require('./src/playback/PlaybackGateway');
const { DspJobManager } = require('./src/dsp/DspJobManager');
const { AudioCatalogService } = require('./src/catalog/AudioCatalogService');
const { UpdateService } = require('./src/update/UpdateService');
const { LayoutStateService } = require('./src/layout/LayoutStateService');

const configManager = new ConfigManager({ appDir: __dirname });
configManager.materialize();
const cfg = configManager.getAll();

const {
  PORT, AUDIO_DIR, PUBLIC_DIR, USERS_DIR,
  AUDIO_DIR_RESOLVED, PUBLIC_DIR_RESOLVED, USERS_DIR_RESOLVED,
  AUDIO_EXTENSIONS, REPO_OWNER, REPO_NAME, GITHUB_API_URL,
  githubToken, UPDATE_CACHE_WINDOW_MS,
  UPDATE_STATE_PATH, LAYOUT_STATE_PATH, SESSIONS_STATE_PATH,
  DSP_CACHE_DIR, DSP_TRANSITIONS_DIR, DSP_LOG_PATH, DSP_TEMPO_CACHE_PATH,
  DSP_STATUS_QUEUED, DSP_STATUS_PROCESSING, DSP_STATUS_READY, DSP_STATUS_FAILED,
  SESSION_COOKIE_NAME, SESSION_TTL_MS,
  AUTH_BODY_LIMIT_BYTES, LAYOUT_BODY_LIMIT_BYTES, PLAYBACK_BODY_LIMIT_BYTES,
  PLAYBACK_COMMAND_BODY_LIMIT_BYTES, DSP_BODY_LIMIT_BYTES, AUDIO_TAG_SCAN_BYTES,
  PLAYLIST_NAME_MAX_LENGTH, TRACK_TITLE_MODE_ATTRIBUTES, TRACK_TITLE_KEY_MAX_LENGTH,
  USERNAME_PATTERN, SESSION_TOKEN_PATTERN,
  ROLE_HOST, ROLE_SLAVE, ROLE_COHOST,
  DAP_DEFAULT_VOLUME_PERCENT, DAP_MIN_VOLUME_PERCENT, DAP_MAX_VOLUME_PERCENT,
  DEFAULT_DAP_CONFIG, DEFAULT_LIVE_VOLUME,
  RUNTIME_OVERRIDE_SCOPE_NONE, RUNTIME_OVERRIDE_SCOPE_CLIENT, RUNTIME_OVERRIDE_SCOPE_HOST,
  LIVE_VOLUME_PRESET_VALUES, ALLOW_CONTEXT_MENU, RUNTIME_CONFIG_SCHEMA,
  DSP_ENABLED, DSP_FFMPEG_BINARY, DSP_FFPROBE_BINARY,
  DSP_TRANSITION_OUTPUT_FORMAT, DSP_TRANSITION_OUTPUT_CODEC,
  DSP_DEFAULT_TRANSITION_SECONDS, DSP_DEFAULT_SLICE_SECONDS,
  DSP_JOB_TIMEOUT_MS, DSP_MAX_QUEUE_LENGTH, DSP_HISTORY_LIMIT,
  DSP_PROBE_CACHE_MS, DSP_LOG_MAX_BYTES,
  DSP_TEMPO_ALIGN_ENABLED, DSP_TEMPO_ANALYSIS_SECONDS, DSP_TEMPO_SAMPLE_RATE,
  DSP_TEMPO_MIN_BPM, DSP_TEMPO_MAX_BPM, DSP_TEMPO_MAX_ADJUST_PERCENT,
  DSP_TEMPO_MIN_RATIO, DSP_TEMPO_MAX_RATIO, DSP_TEMPO_MIN_DELTA_RATIO,
  DSP_TEMPO_GLIDE_ENABLED, DSP_TEMPO_GLIDE_SEGMENTS, DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
  DSP_AGGRESSIVE_JOIN_ENABLED, DSP_JOIN_INTENSITY, DSP_JOIN_MIN_TRANSITION_SECONDS,
  DSP_TRIM_SILENCE_ENABLED, DSP_TRIM_SILENCE_THRESHOLD_DB, DSP_TRIM_MIN_SILENCE_SECONDS,
  DSP_TRIM_MAX_SECONDS, DSP_NO_GAP_GUARD_ENABLED, DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
  DSP_NO_GAP_ENERGY_TRIM_ENABLED, DSP_NO_GAP_ENERGY_SAMPLE_RATE,
  DSP_NO_GAP_ENERGY_FRAME_MS, DSP_NO_GAP_ENERGY_FLOOR_RATIO, DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
  LIVE_DSP_ENTRY_COMPENSATION_MS, LIVE_DSP_EXIT_COMPENSATION_MS,
  DSP_TEMPO_FRAME_SAMPLES, DSP_TEMPO_HOP_SAMPLES,
} = cfg;

function parseBoundedNumberConfigValue(value, fallback, bounds = {}) {
  return ConfigManager.parseBoundedNumberConfigValue(value, fallback, bounds);
}

function serializeVolumePresetPercentValues(values) {
  return ConfigManager.serializeVolumePresetPercentValues(values);
}

let shuttingDown = false;
let updateInProgress = false;
// authSessions managed by AuthSessionManager (instantiated after helper functions are defined)
const audioAttributesCache = new Map();
// layoutSubscribers moved into LayoutStateService
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

// Layout state management is handled by LayoutStateService (see src/layout/LayoutStateService.js)

const layoutService = new LayoutStateService({
  config: {
    LAYOUT_STATE_PATH,
    DEFAULT_DAP_CONFIG,
    DAP_DEFAULT_VOLUME_PERCENT,
    DAP_MIN_VOLUME_PERCENT,
    DAP_MAX_VOLUME_PERCENT,
    DEFAULT_LIVE_VOLUME,
    LIVE_VOLUME_PRESET_VALUES,
    PLAYLIST_NAME_MAX_LENGTH,
    TRACK_TITLE_MODE_ATTRIBUTES,
    TRACK_TITLE_KEY_MAX_LENGTH,
  },
  deps: { fs, path, buildAuthUsersPayload },
});

const livePlaybackCommandBus = new PlaybackCommandBus({
  authorize: ({ sourceRole, commandType, isServer }) =>
    canDispatchLivePlaybackCommand({
      sourceRole,
      commandType,
      isServer,
    }),
  execute: (payload) => {
    layoutService.broadcastPlaybackCommand(payload);
  },
});

layoutService.layoutState = layoutService.loadPersistedLayoutState();
layoutService.playbackState = layoutService.getDefaultPlaybackState();
setInterval(() => layoutService.keepLayoutStreamAlive(), 25 * 1000).unref();

const playbackGateway = new PlaybackGateway({
  getState: () => layoutService.playbackState,
  setState: (next) => { layoutService.playbackState = next; },
  sanitizeState: (s) => layoutService.sanitizePlaybackState(s),
  serializeState: (s) => layoutService.serializePlaybackState(s),
  buildPayload: (cid) => layoutService.buildPlaybackPayload(cid),
  broadcastUpdate: (cid) => layoutService.broadcastPlaybackUpdate(cid),
  sanitizeCommand: sanitizePlaybackCommand,
  sanitizeClientId: LayoutStateService.sanitizeClientId,
  sanitizeSessionRole,
  commandBus: livePlaybackCommandBus,
  ROLE_HOST,
});

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

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);

function isLoopbackAddress(ip) {
  return ip !== '' && LOOPBACK_ADDRESSES.has(ip);
}

function collectForwardedAddresses(req) {
  const result = [];

  const pushHeaderValues = (headerValue) => {
    if (typeof headerValue === 'string') {
      headerValue
        .split(',')
        .map((item) => normalizeIpAddress(item))
        .filter(Boolean)
        .forEach((item) => result.push(item));
      return;
    }

    if (Array.isArray(headerValue)) {
      headerValue.forEach((entry) => pushHeaderValues(entry));
    }
  };

  pushHeaderValues(req.headers['x-forwarded-for']);
  pushHeaderValues(req.headers['x-real-ip']);
  return result;
}

function isServerRequest(req) {
  const remoteAddress = normalizeIpAddress(req.socket && req.socket.remoteAddress);
  if (!isLoopbackAddress(remoteAddress)) return false;

  const forwardedAddresses = collectForwardedAddresses(req);
  if (forwardedAddresses.some((address) => !isLoopbackAddress(address))) {
    return false;
  }

  return true;
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

// --- Auth Session Manager ---
const authSessionManager = new AuthSessionManager({
  config: {
    SESSION_TOKEN_PATTERN,
    USERNAME_PATTERN,
    SESSION_TTL_MS,
    ROLE_HOST,
    ROLE_COHOST,
    ROLE_SLAVE,
    SESSIONS_STATE_PATH,
    SESSION_COOKIE_NAME,
  },
  deps: {
    crypto,
    fs,
    isServerRequest,
    parseCookies,
    onSessionsChanged: () => broadcastAuthUsersUpdate(),
  },
});

function sanitizeSessionRole(value) {
  return AuthSessionManager.sanitizeSessionRole(value, ROLE_COHOST, ROLE_SLAVE);
}

function collectActiveAuthUsers() {
  return authSessionManager.collectActiveAuthUsers();
}

function buildAuthUsersPayload(sourceClientId = null) {
  return authSessionManager.buildAuthUsersPayload(sourceClientId);
}

function createSession(username) {
  return authSessionManager.createSession(username);
}

function destroySession(token) {
  return authSessionManager.destroySession(token);
}


function setSessionCookie(res, token) {
  return authSessionManager.setSessionCookie(res, token);
}

function clearSessionCookie(res) {
  return authSessionManager.clearSessionCookie(res);
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
  return authSessionManager.getAuthState(req);
}

function sanitizeManagedUserRole(value) {
  return AuthSessionManager.sanitizeManagedUserRole(value, ROLE_COHOST, ROLE_SLAVE);
}

function setRoleForActiveUserSessions(username, role) {
  return authSessionManager.setRoleForActiveUserSessions(username, role);
}

function disconnectActiveUserSessions(username) {
  return authSessionManager.disconnectActiveUserSessions(username);
}
}

function sanitizePlaybackCommand(rawCommand) {
  if (!rawCommand || typeof rawCommand !== 'object') return null;

  const commandType = typeof rawCommand.type === 'string' ? rawCommand.type.trim() : '';
  if (commandType === 'toggle-current') {
    return { type: 'toggle-current' };
  }

  if (commandType === 'set-volume') {
    const volume = layoutService.normalizeLiveVolumePreset(rawCommand.volume, null);
    if (volume === null) return null;
    return { type: 'set-volume', volume };
  }

  if (commandType === 'set-volume-presets-visible') {
    return {
      type: 'set-volume-presets-visible',
      showVolumePresets: Boolean(rawCommand.showVolumePresets),
    };
  }

  if (commandType === 'set-live-seek-enabled') {
    return {
      type: 'set-live-seek-enabled',
      allowLiveSeek: Boolean(rawCommand.allowLiveSeek),
    };
  }

  if (commandType === 'seek-current') {
    const positionRatio = LayoutStateService.normalizePlaybackSeekRatio(rawCommand.positionRatio);
    if (positionRatio === null) return null;
    return {
      type: 'seek-current',
      positionRatio,
      finalize: Boolean(rawCommand.finalize),
    };
  }

  if (commandType !== 'play-track') {
    return null;
  }

  const file = typeof rawCommand.file === 'string' ? rawCommand.file.trim() : '';
  if (!file) return null;

  return {
    type: 'play-track',
    file,
    basePath: '/audio',
    playlistIndex: LayoutStateService.normalizePlaylistTrackIndex(rawCommand.playlistIndex),
    playlistPosition: LayoutStateService.normalizePlaylistTrackIndex(rawCommand.playlistPosition),
  };
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

const updateService = new UpdateService({
  currentVersion: appVersion,
  getLatestReleaseInfo,
  compareVersions,
  downloadFile,
  extractTarball,
  findExtractedRoot,
  copyReleaseContents,
  appDir: __dirname,
  parseBooleanParam,
});

function safeResolve(baseDirResolved, requestPath) {
  // requestPath must be without leading slashes
  const resolved = path.resolve(baseDirResolved, requestPath);
  return isInside(baseDirResolved, resolved) ? resolved : null;
}

const dspJobManager = new DspJobManager({
  config: {
    DSP_ENABLED,
    DSP_FFMPEG_BINARY,
    DSP_FFPROBE_BINARY,
    DSP_TRANSITION_OUTPUT_FORMAT,
    DSP_TRANSITION_OUTPUT_CODEC,
    DSP_DEFAULT_TRANSITION_SECONDS,
    DSP_DEFAULT_SLICE_SECONDS,
    DSP_JOB_TIMEOUT_MS,
    DSP_MAX_QUEUE_LENGTH,
    DSP_HISTORY_LIMIT,
    DSP_PROBE_CACHE_MS,
    DSP_LOG_PATH,
    DSP_LOG_MAX_BYTES,
    DSP_CACHE_DIR,
    DSP_TRANSITIONS_DIR,
    DSP_TEMPO_CACHE_PATH,
    DSP_TEMPO_ALIGN_ENABLED,
    DSP_TEMPO_ANALYSIS_SECONDS,
    DSP_TEMPO_SAMPLE_RATE,
    DSP_TEMPO_MIN_BPM,
    DSP_TEMPO_MAX_BPM,
    DSP_TEMPO_MAX_ADJUST_PERCENT,
    DSP_TEMPO_MIN_RATIO,
    DSP_TEMPO_MAX_RATIO,
    DSP_TEMPO_MIN_DELTA_RATIO,
    DSP_TEMPO_GLIDE_ENABLED,
    DSP_TEMPO_GLIDE_SEGMENTS,
    DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
    DSP_AGGRESSIVE_JOIN_ENABLED,
    DSP_JOIN_INTENSITY,
    DSP_JOIN_MIN_TRANSITION_SECONDS,
    DSP_TRIM_SILENCE_ENABLED,
    DSP_TRIM_SILENCE_THRESHOLD_DB,
    DSP_TRIM_MIN_SILENCE_SECONDS,
    DSP_TRIM_MAX_SECONDS,
    DSP_NO_GAP_GUARD_ENABLED,
    DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
    DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    DSP_NO_GAP_ENERGY_SAMPLE_RATE,
    DSP_NO_GAP_ENERGY_FRAME_MS,
    DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
  },
  deps: {
    fs,
    path,
    crypto,
    execFileAsync,
    normalizeAudioRelativePath,
    safeResolve,
    isAudioFile,
    AUDIO_DIR_RESOLVED,
  },
});

async function handleApiDspTransitionsGet(req, res, requestUrl) {
  await dspJobManager.ensureReady();

  const fromFile = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get('from') : null;
  const toFile = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get('to') : null;
  const limitRaw = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get('limit') : null;
  const limitParsed = Number.parseInt(limitRaw, 10);
  const limit = Number.isInteger(limitParsed) ? Math.max(1, Math.min(limitParsed, 500)) : 100;

  if ((fromFile && !toFile) || (!fromFile && toFile)) {
    sendJson(res, 400, { error: 'Параметры from и to нужно передавать вместе.' });
    return;
  }

  if (fromFile && toFile) {
    const lookup = dspJobManager.getTransitionByPair(fromFile, toFile, {});
    if (!lookup.ok) {
      sendJson(res, 400, { error: lookup.error || 'Некорректный запрос transition.' });
      return;
    }

    let inferredReadyTransition = null;
    if (!lookup.item && lookup.descriptor && fs.existsSync(lookup.descriptor.outputPath)) {
      inferredReadyTransition = dspJobManager.buildInferredReadyStub(lookup.descriptor);
    }

    const transition =
      lookup.item ||
      inferredReadyTransition ||
      (lookup.descriptor ? dspJobManager.buildMissingTransitionStub(lookup.descriptor) : null);

    sendJson(res, 200, {
      transition: lookup.item ? dspJobManager.serializeTransition(lookup.item) : transition,
      queue: dspJobManager.getQueueSummary(),
    });
    return;
  }

  const transitions = dspJobManager.listTransitions(limit);
  sendJson(res, 200, {
    transitions,
    queue: dspJobManager.getQueueSummary(),
  });
}

async function handleApiDspTransitionsPost(req, res) {
  if (!dspJobManager.enabled) {
    sendJson(res, 503, { error: 'DSP отключен в extra.conf (dsp_enabled=false).' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, DSP_BODY_LIMIT_BYTES);
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

  const result = dspJobManager.enqueueBatch(body, {
    layout: layoutService.layoutState.layout,
    playlistDsp: layoutService.layoutState.playlistDsp,
  });

  if (result.error) {
    sendJson(res, 400, { error: result.error });
    return;
  }

  sendJson(res, 200, result);
  dspJobManager.appendLog('transition.request', {
    source: result.request.source,
    force: result.request.force,
    priority: result.request.priority,
    fromLayout: result.request.fromLayout,
    totalPairs: result.request.totalPairs,
    uniquePairs: result.request.uniquePairs,
    created: result.summary.created,
    enqueued: result.summary.enqueued,
    failed: result.summary.failed,
  });
}

function handleApiDspTransitionFile(req, res, pathname) {
  const id = req.params && req.params.id ? req.params.id.trim() : '';
  if (!/^[a-f0-9]{40}$/.test(id)) {
    sendJson(res, 400, { error: 'Некорректный transition id' });
    return;
  }

  const filePath = dspJobManager.resolveOutputPath(id);
  if (!filePath) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  serveAudioWithRange(req, res, filePath, getContentType(filePath));
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

const audioCatalog = new AudioCatalogService({
  collectCatalog: collectAudioCatalog,
  getAttributesCached: getAudioAttributesCached,
  buildDisplayName: buildAudioAttributeDisplayName,
  normalizePath: normalizeAudioRelativePath,
  safeResolve: safeResolve,
  isAudioFile: isAudioFile,
  stripExtension: stripFileExtension,
  audioDir: AUDIO_DIR_RESOLVED,
});

async function handleApiAudio(req, res) {
  try {
    const catalog = await audioCatalog.getCatalog();
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

  const normalizedFile = audioCatalog.normalizePath(rawFile.trim());
  if (!normalizedFile) {
    sendJson(res, 400, { error: 'Неверное имя файла' });
    return;
  }

  const absoluteFilePath = audioCatalog.resolveAudioPath(normalizedFile);
  if (!absoluteFilePath) {
    sendJson(res, 400, { error: 'Неверный путь к файлу' });
    return;
  }

  if (!audioCatalog.isAudioFile(absoluteFilePath)) {
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
    const attributes = await audioCatalog.getAttributes(normalizedFile, absoluteFilePath, fileStat);
    const fallbackName = audioCatalog.stripExtension(path.basename(normalizedFile));
    const displayName = audioCatalog.buildDisplayName(attributes, fallbackName);

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

function handleApiConfig(req, res) {
  const values = {
    port: PORT,
    allowContextMenu: ALLOW_CONTEXT_MENU,
    volumePresets: serializeVolumePresetPercentValues(LIVE_VOLUME_PRESET_VALUES),
    dspEntryCompensationMs: LIVE_DSP_ENTRY_COMPENSATION_MS,
    dspExitCompensationMs: LIVE_DSP_EXIT_COMPENSATION_MS,
  };

  sendJson(res, 200, {
    ...values,
    values,
    schema: RUNTIME_CONFIG_SCHEMA,
  });
}

function handleApiLayoutGet(req, res) {
  sendJson(res, 200, layoutService.buildLayoutPayload(null));
}

function handleApiLayoutReset(req, res) {
  layoutService.layoutState = {
    ...layoutService.getDefaultLayoutState(),
    version: layoutService.layoutState.version + 1,
    updatedAt: Date.now(),
  };

  layoutService.persistLayoutState(layoutService.layoutState);
  layoutService.broadcastLayoutUpdate(null);
  dspJobManager.scheduleFromLayout(layoutService.layoutState.layout, {
    source: 'layout-update',
    priority: 'normal',
    force: false,
    playlistDspFlags: layoutService.layoutState.playlistDsp,
  });

  sendJson(res, 200, layoutService.buildLayoutPayload(null));
}

function handleApiPlaybackGet(req, res) {
  sendJson(res, 200, playbackGateway.getSnapshot(null));
}

async function handleApiLayoutUpdate(req, res) {
  const auth = req.auth;
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

  const nextLayout = LayoutStateService.sanitizeLayout(body.layout);
  if (!nextLayout) {
    sendJson(res, 400, { error: 'Неверный формат плей-листов' });
    return;
  }

  if (layoutService.isDeletingLivePlaybackPlaylist(nextLayout)) {
    sendJson(res, 409, { error: 'Нельзя удалить плей-лист, который сейчас играет на лайве.' });
    return;
  }

  const nextPlaylistNames = layoutService.normalizePlaylistNames(body.playlistNames, nextLayout.length);
  const nextPlaylistMeta = layoutService.normalizePlaylistMeta(
    Array.isArray(body.playlistMeta) ? body.playlistMeta : layoutService.layoutState.playlistMeta,
    nextLayout.length,
  );
  let nextDapConfig = auth.isServer
    ? layoutService.sanitizeDapConfig(
        body && Object.prototype.hasOwnProperty.call(body, 'dapConfig') ? body.dapConfig : layoutService.layoutState.dapConfig,
        nextLayout.length,
        layoutService.layoutState.dapConfig,
      )
    : layoutService.sanitizeDapConfig(layoutService.layoutState.dapConfig, nextLayout.length, layoutService.layoutState.dapConfig);
  if (!auth.isServer) {
    const currentDapIndex = LayoutStateService.normalizePlaylistTrackIndex(layoutService.layoutState.dapConfig && layoutService.layoutState.dapConfig.playlistIndex);
    const isCurrentDapEnabled = Boolean(layoutService.layoutState.dapConfig && layoutService.layoutState.dapConfig.enabled);
    const removedPlaylistIndex = LayoutStateService.detectRemovedPlaylistIndex(layoutService.layoutState.layout, nextLayout);
    if (currentDapIndex !== null && removedPlaylistIndex !== null) {
      if (isCurrentDapEnabled && removedPlaylistIndex === currentDapIndex) {
        sendJson(res, 409, { error: 'Нельзя удалить плей-лист, выбранный для DAP.' });
        return;
      }

      if (removedPlaylistIndex < currentDapIndex) {
        nextDapConfig = layoutService.sanitizeDapConfig(
          {
            ...layoutService.layoutState.dapConfig,
            enabled: isCurrentDapEnabled,
            playlistIndex: currentDapIndex - 1,
          },
          nextLayout.length,
          layoutService.layoutState.dapConfig,
        );
      }
    }
  }
  const nextPlaylistAutoplay = auth.isServer
    ? layoutService.normalizePlaylistAutoplayWithDap(body.playlistAutoplay, nextDapConfig, nextLayout.length)
    : layoutService.normalizePlaylistAutoplayWithDap(layoutService.layoutState.playlistAutoplay, nextDapConfig, nextLayout.length);
  const nextPlaylistDsp = auth.isServer
    ? LayoutStateService.normalizePlaylistDspFlags(
        body && Object.prototype.hasOwnProperty.call(body, 'playlistDsp')
          ? body.playlistDsp
          : layoutService.layoutState.playlistDsp,
        nextPlaylistAutoplay,
        nextLayout.length,
      )
    : LayoutStateService.normalizePlaylistDspFlags(layoutService.layoutState.playlistDsp, nextPlaylistAutoplay, nextLayout.length);
  const nextTrackTitleModesByTrack = layoutService.sanitizeTrackTitleModesByTrack(
    body && Object.prototype.hasOwnProperty.call(body, 'trackTitleModesByTrack')
      ? body.trackTitleModesByTrack
      : layoutService.layoutState.trackTitleModesByTrack,
  );

  const sourceClientId = LayoutStateService.sanitizeClientId(body.clientId);
  const hasChanged =
    JSON.stringify(nextLayout) !== JSON.stringify(layoutService.layoutState.layout) ||
    JSON.stringify(nextPlaylistNames) !== JSON.stringify(layoutService.layoutState.playlistNames) ||
    JSON.stringify(nextPlaylistMeta) !== JSON.stringify(layoutService.layoutState.playlistMeta) ||
    JSON.stringify(nextPlaylistAutoplay) !== JSON.stringify(layoutService.layoutState.playlistAutoplay) ||
    JSON.stringify(nextPlaylistDsp) !== JSON.stringify(layoutService.layoutState.playlistDsp) ||
    JSON.stringify(nextDapConfig) !== JSON.stringify(layoutService.layoutState.dapConfig) ||
    JSON.stringify(nextTrackTitleModesByTrack) !== JSON.stringify(layoutService.layoutState.trackTitleModesByTrack);

  if (hasChanged) {
    layoutService.layoutState = {
      layout: nextLayout,
      playlistNames: nextPlaylistNames,
      playlistMeta: nextPlaylistMeta,
      playlistAutoplay: nextPlaylistAutoplay,
      playlistDsp: nextPlaylistDsp,
      dapConfig: nextDapConfig,
      trackTitleModesByTrack: nextTrackTitleModesByTrack,
      version: layoutService.layoutState.version + 1,
      updatedAt: Date.now(),
    };
    layoutService.persistLayoutState(layoutService.layoutState);
    layoutService.broadcastLayoutUpdate(sourceClientId);
    dspJobManager.scheduleFromLayout(layoutService.layoutState.layout, {
      source: 'layout-update',
      priority: 'normal',
      force: false,
      playlistDspFlags: layoutService.layoutState.playlistDsp,
    });
  }

  sendJson(res, 200, layoutService.buildLayoutPayload(sourceClientId));
}

async function handleApiPlaybackUpdate(req, res) {
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

  const result = playbackGateway.updateState(body);
  sendJson(res, 200, result.payload);
}

function handleApiLayoutStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  layoutService.layoutSubscribers.add(res);
  LayoutStateService.sendSseEvent(res, 'layout', layoutService.buildLayoutPayload(null));
  LayoutStateService.sendSseEvent(res, 'playback', layoutService.buildPlaybackPayload(null));
  LayoutStateService.sendSseEvent(res, 'auth-users', buildAuthUsersPayload(null));

  req.on('close', () => {
    layoutService.layoutSubscribers.delete(res);
  });
}

function handleAuthSession(req, res) {
  sendJson(res, 200, {
    authenticated: req.auth.authenticated,
    isServer: req.auth.isServer,
    role: req.auth.role,
    username: req.auth.username,
  });
}

async function handleAuthLogin(req, res) {
  if (req.auth.isServer) {
    sendJson(res, 200, { authenticated: true, isServer: true, role: ROLE_HOST, username: 'server' });
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

    const session = createSession(username);
    setSessionCookie(res, session.token);
    sendJson(res, 200, { authenticated: true, isServer: false, role: session.role, username });
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

function handleAuthClientsGet(req, res) {
  sendJson(res, 200, buildAuthUsersPayload(null));
}

async function handleAuthClientsRoleUpdate(req, res) {
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
  if (!username) {
    sendJson(res, 400, { error: 'Некорректный логин пользователя' });
    return;
  }

  const nextRole = sanitizeManagedUserRole(body.role);
  const result = setRoleForActiveUserSessions(username, nextRole);

  if (result.matchedSessions < 1) {
    sendJson(res, 404, { error: 'Пользователь не найден среди активных сессий' });
    return;
  }

  sendJson(res, 200, {
    users: collectActiveAuthUsers(),
    updated: {
      username,
      role: nextRole,
      changed: result.changed,
    },
  });
}

async function handleAuthClientsDisconnect(req, res) {
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
  if (!username) {
    sendJson(res, 400, { error: 'Некорректный логин пользователя' });
    return;
  }

  const result = disconnectActiveUserSessions(username);
  if (result.removedSessions < 1) {
    sendJson(res, 404, { error: 'Пользователь не найден среди активных сессий' });
    return;
  }

  sendJson(res, 200, {
    users: collectActiveAuthUsers(),
    disconnected: {
      username,
      removedSessions: result.removedSessions,
    },
  });
}

async function handleApiPlaybackCommand(req, res) {
  const auth = req.auth;

  let body;
  try {
    body = await readJsonBody(req, PLAYBACK_COMMAND_BODY_LIMIT_BYTES);
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

  const result = await playbackGateway.dispatchCommand(body, auth);
  sendJson(res, result.status, result.ok ? result.payload : { error: result.error });
}

async function handleUpdateCheck(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const result = await updateService.checkForUpdate(url);
    sendJson(res, 200, result);
  } catch (err) {
    console.error('Update check failed', err);
    sendJson(res, 500, { error: 'Не удалось проверить наличие обновлений', details: err.message });
  }
}

async function handleUpdateApply(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { status, body } = await updateService.applyUpdate(url);
    sendJson(res, status, body);
  } catch (err) {
    console.error('Update apply failed', err);
    sendJson(res, 500, { error: 'Не удалось выполнить обновление', details: err.message });
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


// --- HttpRouter + AuthSessionManager wiring ---
const authGuard = createAuthGuard(authSessionManager);
const router = new HttpRouter({ authGuard });

// Auth endpoints
router.register('GET', '/api/auth/session', handleAuthSession, { auth: 'none' });
router.register('POST', '/api/auth/login', handleAuthLogin, { auth: 'none' });
router.register('POST', '/api/auth/logout', handleAuthLogout, { auth: 'none' });
router.register('GET', '/api/auth/clients', handleAuthClientsGet, { auth: 'host' });
router.register('POST', '/api/auth/clients/role', handleAuthClientsRoleUpdate, { auth: 'host' });
router.register('POST', '/api/auth/clients/disconnect', handleAuthClientsDisconnect, { auth: 'host' });

// Layout/playback endpoints
router.register('GET', '/api/layout/stream', handleApiLayoutStream, { auth: 'session' });
router.register('POST', '/api/layout/reset', handleApiLayoutReset, { auth: 'host' });
router.register('GET', '/api/layout', handleApiLayoutGet, { auth: 'session' });
router.register('POST', '/api/layout', handleApiLayoutUpdate, { auth: 'session' });
router.register('GET', '/api/playback', handleApiPlaybackGet, { auth: 'session' });
router.register('POST', '/api/playback', handleApiPlaybackUpdate, { auth: 'host' });
router.register('POST', '/api/playback/command', handleApiPlaybackCommand, { auth: 'host|cohost' });
router.register('POST', '/api/shutdown', handleShutdown, { auth: 'host' });

// Catalog/DSP/config/update endpoints
router.register('GET', '/api/audio', handleApiAudio, { auth: 'session' });
router.register('GET', '/api/audio/attributes', (req, res) => handleApiAudioAttributes(req, res, req.parsedUrl), { auth: 'session' });
router.register('GET', '/api/dsp/transitions', (req, res) => handleApiDspTransitionsGet(req, res, req.parsedUrl), { auth: 'session' });
router.register('POST', '/api/dsp/transitions', handleApiDspTransitionsPost, { auth: 'host' });
router.register('GET|HEAD', '/api/dsp/transitions/file/:id', (req, res) => handleApiDspTransitionFile(req, res, req.pathname), { auth: 'session' });
router.register('GET', '/api/config', handleApiConfig, { auth: 'session' });
router.register('GET', '/api/version', handleApiVersion, { auth: 'session' });
router.register('GET', '/api/update/check', handleUpdateCheck, { auth: 'session' });
router.register('POST', '/api/update/apply', handleUpdateApply, { auth: 'session' });

// Wildcard routes (catch-alls, order matters: more specific first)
router.register('GET|HEAD', '/api/*', (req, res) => handlePublic(req, res, req.pathname), { auth: 'session' });
router.register('GET|HEAD', '/audio/*', (req, res) => handleAudioFile(req, res, req.pathname, AUDIO_DIR_RESOLVED, '/audio/'), { auth: 'session', authResponseKind: 'text' });
router.register('GET|HEAD', '/*', (req, res) => handlePublic(req, res, req.pathname), { auth: 'none' });

const server = http.createServer((req, res) => {
  router.dispatch(req, res);
});

if (DSP_ENABLED) {
  dspJobManager.appendLog('dsp.startup', {
    enabled: DSP_ENABLED,
    ffmpegBinary: DSP_FFMPEG_BINARY,
    ffprobeBinary: DSP_FFPROBE_BINARY,
    transitionOutputFormat: DSP_TRANSITION_OUTPUT_FORMAT,
    transitionOutputCodec: DSP_TRANSITION_OUTPUT_CODEC,
    transitionSeconds: DSP_DEFAULT_TRANSITION_SECONDS,
    sliceSeconds: DSP_DEFAULT_SLICE_SECONDS,
    queueLimit: DSP_MAX_QUEUE_LENGTH,
    tempoAlignEnabled: DSP_TEMPO_ALIGN_ENABLED,
    tempoMaxAdjustPercent: DSP_TEMPO_MAX_ADJUST_PERCENT,
    tempoGlideEnabled: DSP_TEMPO_GLIDE_ENABLED,
    tempoGlideSegments: DSP_TEMPO_GLIDE_SEGMENTS,
    tempoGlideAnchorSeconds: DSP_TEMPO_GLIDE_ANCHOR_SECONDS,
    aggressiveJoinEnabled: DSP_AGGRESSIVE_JOIN_ENABLED,
    joinIntensity: DSP_JOIN_INTENSITY,
    trimSilenceEnabled: DSP_TRIM_SILENCE_ENABLED,
    trimSilenceDb: DSP_TRIM_SILENCE_THRESHOLD_DB,
    trimMinSilenceSeconds: DSP_TRIM_MIN_SILENCE_SECONDS,
    trimMaxSeconds: DSP_TRIM_MAX_SECONDS,
    noGapGuardEnabled: DSP_NO_GAP_GUARD_ENABLED,
    trimGuardThresholdBoostDb: DSP_TRIM_GUARD_THRESHOLD_BOOST_DB,
    noGapEnergyTrimEnabled: DSP_NO_GAP_ENERGY_TRIM_ENABLED,
    noGapEnergySampleRate: DSP_NO_GAP_ENERGY_SAMPLE_RATE,
    noGapEnergyFrameMs: DSP_NO_GAP_ENERGY_FRAME_MS,
    noGapEnergyFloorRatio: DSP_NO_GAP_ENERGY_FLOOR_RATIO,
    noGapEnergyMeanMultiplier: DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER,
    tempoCacheItems: dspJobManager.getTempoCacheSize(),
  });
  dspJobManager.scheduleFromLayout(layoutService.layoutState.layout, {
    source: 'startup',
    priority: 'normal',
    force: false,
    playlistDspFlags: layoutService.layoutState.playlistDsp,
  });
}

function isPrivateIpv4Address(address) {
  if (typeof address !== 'string') return false;
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true;
  if (!address.startsWith('172.')) return false;
  const secondOctet = Number.parseInt(address.split('.')[1], 10);
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

function resolveLocalNetworkIp() {
  let privateFallbackAddress = null;
  let fallbackAddress = null;
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
      if (entry.address.startsWith('192.168.')) return entry.address;
      if (!privateFallbackAddress && isPrivateIpv4Address(entry.address)) privateFallbackAddress = entry.address;
      if (!fallbackAddress) fallbackAddress = entry.address;
    }
  }

  return privateFallbackAddress || fallbackAddress;
}

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  const localNetworkIp = resolveLocalNetworkIp();
  if (localNetworkIp) {
    console.log(`Local network URL for slaves: http://${localNetworkIp}:${PORT}`);
  } else {
    console.log('Local network URL for slaves: not detected');
  }
});
