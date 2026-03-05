const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
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
const { isAudioFile } = require('./src/utils');
const { getContentType, isInside, safeResolve, serveAudioWithRange, createPublicHandler } = require('./src/static/serve');
const { normalizeAudioRelativePath } = require('./src/audio/metadata');
const { isServerRequest, parseCookies, safeCompareStrings, resolveLocalNetworkIp } = require('./src/http/network');
const { readJsonBody } = require('./src/http/body');
const execFileAsync = promisify(execFile);

const configManager = new ConfigManager({ appDir: __dirname });
configManager.materialize();
const cfg = configManager.getAll();

const {
  PORT, AUDIO_DIR, PUBLIC_DIR, USERS_DIR,
  AUDIO_DIR_RESOLVED, PUBLIC_DIR_RESOLVED, USERS_DIR_RESOLVED,
  REPO_OWNER, REPO_NAME, GITHUB_API_URL,
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

let shuttingDown = false;
// authSessions managed by AuthSessionManager (instantiated after helper functions are defined)
// layoutSubscribers moved into LayoutStateService

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
  deps: { fs, path, buildAuthUsersPayload: (cid) => authSessionManager.buildAuthUsersPayload(cid) },
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
  sanitizeCommand: (cmd) => PlaybackGateway.sanitizePlaybackCommand(cmd, layoutService),
  sanitizeClientId: LayoutStateService.sanitizeClientId,
  sanitizeSessionRole: (v) => AuthSessionManager.sanitizeSessionRole(v, ROLE_COHOST, ROLE_SLAVE),
  commandBus: livePlaybackCommandBus,
  ROLE_HOST,
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function handleBodyError(res, err) {
  if (err.message === 'BODY_TOO_LARGE') {
    sendJson(res, 413, { error: 'Слишком большой запрос' });
    return;
  }
  if (err.message === 'INVALID_JSON') {
    sendJson(res, 400, { error: 'Неверный формат JSON' });
    return;
  }
  sendJson(res, 400, { error: 'Не удалось прочитать запрос' });
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);

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
    USERS_DIR: USERS_DIR_RESOLVED,
  },
  deps: {
    crypto,
    fs,
    path,
    isServerRequest: (req) => isServerRequest(req, LOOPBACK_ADDRESSES),
    parseCookies,
    safeCompareStrings,
    isInside,
    onSessionsChanged: () => layoutService.broadcastAuthUsersUpdate(),
  },
});

const updateService = new UpdateService({
  config: {
    appDir: __dirname,
    currentVersion: appVersion,
    UPDATE_STATE_PATH,
    GITHUB_API_URL,
    githubToken,
    UPDATE_CACHE_WINDOW_MS,
    appVersion,
  },
  deps: { fs, path, os, https, execFile },
});

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
    handleBodyError(res, err);
    return;
  }

  const dspSnapshot = layoutService.buildDspLayoutSnapshot();
  const result = dspJobManager.enqueueBatch(body, {
    layout: dspSnapshot.layout,
    playlistDsp: dspSnapshot.playlistDsp,
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

const audioCatalog = new AudioCatalogService({
  audioDir: AUDIO_DIR_RESOLVED,
  audioTagScanBytes: AUDIO_TAG_SCAN_BYTES,
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
    volumePresets: ConfigManager.serializeVolumePresetPercentValues(LIVE_VOLUME_PRESET_VALUES),
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
  const dspSnapshot = layoutService.buildDspLayoutSnapshot();
  dspJobManager.scheduleFromLayout(dspSnapshot.layout, {
    source: 'layout-update',
    priority: 'normal',
    force: false,
    playlistDspFlags: dspSnapshot.playlistDsp,
  });

  sendJson(res, 200, layoutService.buildLayoutPayload(null));
}

function handleApiPlaybackGet(req, res) {
  sendJson(res, 200, playbackGateway.getSnapshot(null));
}

async function handleApiLayoutUpdate(req, res) {
  let body;
  try {
    body = await readJsonBody(req, LAYOUT_BODY_LIMIT_BYTES);
  } catch (err) {
    handleBodyError(res, err);
    return;
  }

  const result = layoutService.applyLayoutUpdate(body, {
    isServer: req.auth.isServer,
    onLayoutChanged: (state) => {
      const dspSnapshot = layoutService.buildDspLayoutSnapshot(state);
      dspJobManager.scheduleFromLayout(dspSnapshot.layout, {
        source: 'layout-update',
        priority: 'normal',
        force: false,
        playlistDspFlags: dspSnapshot.playlistDsp,
      });
    },
  });
  sendJson(res, result.status, result.payload);
}

async function handleApiPlaybackUpdate(req, res) {
  let body;
  try {
    body = await readJsonBody(req, PLAYBACK_BODY_LIMIT_BYTES);
  } catch (err) {
    handleBodyError(res, err);
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
  LayoutStateService.sendSseEvent(res, 'auth-users', authSessionManager.buildAuthUsersPayload(null));

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
    handleBodyError(res, err);
    return;
  }

  const result = await authSessionManager.authenticateUser(body?.username, body?.password);
  if (!result.success) {
    sendJson(res, result.status, { error: result.error });
    return;
  }
  authSessionManager.setSessionCookie(res, result.token);
  sendJson(res, 200, { authenticated: true, isServer: false, role: result.role, username: result.username });
}

function handleAuthLogout(req, res) {
  const cookies = parseCookies(req);
  authSessionManager.destroySession(cookies[SESSION_COOKIE_NAME]);
  authSessionManager.clearSessionCookie(res);
  sendJson(res, 200, { authenticated: false });
}

function handleAuthClientsGet(req, res) {
  sendJson(res, 200, authSessionManager.buildAuthUsersPayload(null));
}

async function handleAuthClientsRoleUpdate(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    handleBodyError(res, err);
    return;
  }

  const username = AuthSessionManager.normalizeUsername(body.username, USERNAME_PATTERN);
  if (!username) {
    sendJson(res, 400, { error: 'Некорректный логин пользователя' });
    return;
  }

  const nextRole = AuthSessionManager.sanitizeManagedUserRole(body.role, ROLE_COHOST, ROLE_SLAVE);
  const result = authSessionManager.setRoleForActiveUserSessions(username, nextRole);

  if (result.matchedSessions < 1) {
    sendJson(res, 404, { error: 'Пользователь не найден среди активных сессий' });
    return;
  }

  sendJson(res, 200, {
    users: authSessionManager.collectActiveAuthUsers(),
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
    handleBodyError(res, err);
    return;
  }

  const username = AuthSessionManager.normalizeUsername(body.username, USERNAME_PATTERN);
  if (!username) {
    sendJson(res, 400, { error: 'Некорректный логин пользователя' });
    return;
  }

  const result = authSessionManager.disconnectActiveUserSessions(username);
  if (result.removedSessions < 1) {
    sendJson(res, 404, { error: 'Пользователь не найден среди активных сессий' });
    return;
  }

  sendJson(res, 200, {
    users: authSessionManager.collectActiveAuthUsers(),
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
    handleBodyError(res, err);
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

const handlePublic = createPublicHandler({ publicDirResolved: PUBLIC_DIR_RESOLVED });
const handleSharedStatic = createPublicHandler({ publicDirResolved: path.join(__dirname, 'shared') });


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
router.register('GET|HEAD', '/shared/*', (req, res) => handleSharedStatic(req, res, req.pathname.replace(/^\/shared/, '')), { auth: 'none' });
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
  const startupDspSnapshot = layoutService.buildDspLayoutSnapshot();
  dspJobManager.scheduleFromLayout(startupDspSnapshot.layout, {
    source: 'startup',
    priority: 'normal',
    force: false,
    playlistDspFlags: startupDspSnapshot.playlistDsp,
  });
}

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  const localNetworkIp = resolveLocalNetworkIp(os);
  if (localNetworkIp) {
    console.log(`Local network URL for slaves: http://${localNetworkIp}:${PORT}`);
  } else {
    console.log('Local network URL for slaves: not detected');
  }
});
