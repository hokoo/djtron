// public/modules/api.js — all fetch wrappers

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export async function fetchConfig() {
  return request('/api/config');
}

export async function fetchAuthSession() {
  return request('/api/auth/session');
}

export async function postAuthLogin(username, password) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ username, password }),
  });
}

export async function postAuthLogout() {
  return request('/api/auth/logout', { method: 'POST' });
}

export async function fetchAuthClients() {
  return request('/api/auth/clients');
}

export async function postAuthClientRole(username, role) {
  return request('/api/auth/clients/role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ username, role }),
  });
}

export async function postAuthClientDisconnect(username) {
  return request('/api/auth/clients/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ username }),
  });
}

export async function fetchLayout() {
  return request('/api/layout');
}

export async function postLayout(body) {
  return request('/api/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
}

export async function postLayoutReset() {
  return request('/api/layout/reset', { method: 'POST' });
}

export async function fetchPlayback() {
  return request('/api/playback');
}

export async function postPlayback(body) {
  return request('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
}

export async function postPlaybackCommand(command) {
  return request('/api/playback/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(command),
  });
}

export async function fetchDspStatus(limit) {
  const qs = Number.isFinite(limit) ? `?limit=${limit}` : '';
  return request(`/api/dsp/transitions${qs}`);
}

export async function fetchDspTransitionPair(fromFile, toFile) {
  return request(`/api/dsp/transitions?from=${encodeURIComponent(fromFile)}&to=${encodeURIComponent(toFile)}`);
}

export async function postDspTransitions(body) {
  return request('/api/dsp/transitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
}

export async function fetchAudioAttributes(file) {
  return request(`/api/audio/attributes?file=${encodeURIComponent(file)}`);
}

export async function fetchFileList(url) {
  return request(url);
}

export async function fetchVersion() {
  return request('/api/version');
}

export async function fetchUpdateCheck(allowPrerelease) {
  return request(`/api/update/check?allowPrerelease=${allowPrerelease ? 'true' : 'false'}`);
}

export async function postUpdateApply(allowPrerelease) {
  return request(`/api/update/apply?allowPrerelease=${allowPrerelease ? 'true' : 'false'}`, { method: 'POST' });
}

export async function postShutdown() {
  return request('/api/shutdown', { method: 'POST' });
}
