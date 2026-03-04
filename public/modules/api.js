/**
 * API client — fetch wrappers for server endpoints.
 * All methods return Promises. Errors throw with message from server.
 */

const BASE = '';

async function request(method, url, body = null) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${url}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// --- Auth ---
export const authSession = () => request('GET', '/api/auth/session');
export const authLogin = (password) => request('POST', '/api/auth/login', { password });
export const authLogout = () => request('POST', '/api/auth/logout');
export const authClients = () => request('GET', '/api/auth/clients');
export const authSetRole = (clientId, role) => request('POST', '/api/auth/clients/role', { clientId, role });
export const authDisconnect = (clientId) => request('POST', '/api/auth/clients/disconnect', { clientId });

// --- Layout ---
export const layoutGet = () => request('GET', '/api/layout');
export const layoutUpdate = (state) => request('POST', '/api/layout', state);
export const layoutReset = () => request('POST', '/api/layout/reset');

// --- Playback ---
export const playbackGet = () => request('GET', '/api/playback');
export const playbackUpdate = (state) => request('POST', '/api/playback', state);
export const playbackCommand = (cmd) => request('POST', '/api/playback/command', cmd);

// --- Audio catalog ---
export const audioCatalog = () => request('GET', '/api/audio');
export const audioAttributes = (file) => request('GET', `/api/audio/attributes?file=${encodeURIComponent(file)}`);

// --- DSP transitions ---
export const dspTransitionsGet = (playlistId) => request('GET', `/api/dsp/transitions?playlist=${encodeURIComponent(playlistId || '')}`);
export const dspTransitionsPost = (data) => request('POST', '/api/dsp/transitions', data);

// --- Config ---
export const configGet = () => request('GET', '/api/config');

// --- Version / Update ---
export const versionGet = () => request('GET', '/api/version');
export const updateCheck = () => request('GET', '/api/update/check');
export const updateApply = () => request('POST', '/api/update/apply');

// --- Shutdown ---
export const shutdown = () => request('POST', '/api/shutdown');
