// public/modules/ui/auth.js — auth UI + user management

import { state, ROLE_HOST, ROLE_SLAVE, ROLE_COHOST, HOST_SERVER_HINT } from '../state.js';
import * as api from '../api.js';
import { isHostRole, isCoHostRole, isRemoteLiveMirrorRole, updateDapNowPlayingVisibility } from '../roles.js';

let _deps = {};

export function setAuthDeps(d) {
  Object.assign(_deps, d);
}

export function setAuthOverlayVisible(visible) {
  const authOverlay = _deps.authOverlay;
  if (!authOverlay) return;
  authOverlay.hidden = !visible;
}

export function setAuthError(message) {
  const authError = _deps.authError;
  if (!authError) return;
  authError.textContent = message || '';
}

export async function fetchSessionInfo() {
  const { ok, data } = await api.fetchAuthSession();
  if (!ok) {
    throw new Error('Не удалось проверить сессию');
  }
  return {
    authenticated: Boolean(data && data.authenticated),
    isServer: Boolean(data && data.isServer),
    role: data && typeof data.role === 'string' ? data.role : null,
    username: data && typeof data.username === 'string' ? data.username : null,
  };
}

export async function login(username, password) {
  const { ok, data } = await api.postAuthLogin(username, password);
  if (!ok) {
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

export function normalizeRole(info) {
  if (info && info.role === ROLE_HOST) return ROLE_HOST;
  if (info && info.role === ROLE_COHOST) return ROLE_COHOST;
  if (info && info.role === ROLE_SLAVE) return ROLE_SLAVE;
  if (info && info.isServer) return ROLE_HOST;
  return ROLE_SLAVE;
}

export function normalizeAuthUsersPayload(payload) {
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

export function renderCohostUsers() {
  const cohostUsersEl = _deps.cohostUsersEl;
  if (!cohostUsersEl) return;

  if (!isHostRole()) {
    cohostUsersEl.innerHTML = '';
    return;
  }

  cohostUsersEl.innerHTML = '';
  if (!state.authUsersState.length) {
    const empty = document.createElement('p');
    empty.className = 'cohost-users__empty';
    empty.textContent = 'Нет активных пользователей.';
    cohostUsersEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.authUsersState.forEach((entry) => {
    const isRoleUpdatePending = state.cohostRoleUpdatesInFlight.has(entry.username);
    const isDisconnectPending = state.cohostDisconnectUpdatesInFlight.has(entry.username);

    const row = document.createElement('div');
    row.className = 'cohost-user';
    if (entry.role === ROLE_COHOST) {
      row.classList.add('is-cohost');
    }
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

export function applyIncomingAuthUsers(payload, { syncOwnRole = true } = {}) {
  state.authUsersState = normalizeAuthUsersPayload(payload);
  renderCohostUsers();

  if (!syncOwnRole || !state.currentUser || isHostRole()) return;

  const selfEntry = state.authUsersState.find((entry) => entry.username === state.currentUser);
  if (!selfEntry) {
    recoverFromRemoteSessionTermination('Хост завершил вашу сессию. Войдите снова.');
    return;
  }

  const nextRole = selfEntry && selfEntry.role === ROLE_COHOST ? ROLE_COHOST : ROLE_SLAVE;
  if (nextRole === state.currentRole) return;

  applyRoleUi(nextRole);
  _deps.setStatus(nextRole === ROLE_COHOST ? 'Вам назначена роль co-host.' : 'Роль co-host снята. Вы снова slave.');
}

export function applyRoleUi(role) {
  const resolvedRole = normalizeRole({ role });
  const previousRole = state.currentRole;
  state.currentRole = resolvedRole;
  document.body.dataset.role = resolvedRole;
  _deps.applyRuntimeConfigFromSources();

  const isHost = isHostRole(resolvedRole);
  const isCoHost = isCoHostRole(resolvedRole);

  if (!isCoHost) {
    _deps.stopCoHostProgressLoop();
    _deps.clearQueuedCoHostSeekCommands();
  }

  if (_deps.serverPanelEl) {
    _deps.serverPanelEl.hidden = !isHost;
  }
  if (_deps.clientSessionPanelEl) {
    _deps.clientSessionPanelEl.hidden = isHost;
  }
  if (_deps.cohostPanelEl) {
    _deps.cohostPanelEl.hidden = !isHost;
  }

  if (_deps.stopServerBtn) {
    _deps.stopServerBtn.hidden = !isHost;
    _deps.stopServerBtn.disabled = !isHost;
  }
  if (_deps.clientLogoutBtn) {
    _deps.clientLogoutBtn.hidden = isHost;
    _deps.clientLogoutBtn.disabled = isHost;
  }

  if (_deps.serverActionsHintEl) {
    _deps.serverActionsHintEl.textContent = HOST_SERVER_HINT;
  }

  if (isCoHost && !isCoHostRole(previousRole)) {
    _deps.stopAndClearLocalPlayback();
  }

  if (!isHost) {
    if (_deps.isDspTransitionPlaybackActive()) {
      _deps.stopDspTransitionPlayback({ stopAudio: true, clearTrackState: true });
    }
    _deps.resetLiveDspNextTrackPreview();
  }

  if (isHost) {
    _deps.stopHostProgressLoop();
    _deps.requestHostPlaybackSync(true);
  } else {
    _deps.stopHostProgressLoop();
    _deps.syncNowPlayingPanel();
    _deps.syncHostNowPlayingPanel();
  }

  renderCohostUsers();
  _deps.updateVolumePresetsUi();
  _deps.updateLiveSeekUi();
  _deps.updateDapSettingsUi(resolvedRole);
  updateDapNowPlayingVisibility(resolvedRole);
  _deps.updatePrereleaseSettingUi(resolvedRole);
  _deps.updateDspSetupUi(resolvedRole);
  _deps.renderZones();

  if (isHost && (!isHostRole(previousRole) || state.dspStatusState.checkedAt <= 0)) {
    _deps.refreshDspStatus({ announceError: false, userInitiated: false });
  }
}

export function updateCurrentUser(info) {
  const username = info && typeof info.username === 'string' ? info.username : null;
  state.currentUser = username;
  applyRoleUi(normalizeRole(info));

  if (isHostRole()) {
    fetchAuthUsersForHost().catch((err) => {
      console.error(err);
      _deps.setStatus(err && err.message ? err.message : 'Не удалось загрузить список активных пользователей.');
    });
  }
}

export async function ensureAuthorizedUser() {
  let session;
  try {
    session = await fetchSessionInfo();
  } catch (err) {
    console.error(err);
    _deps.setStatus('Не удалось проверить авторизацию.');
    return false;
  }

  applyRoleUi(normalizeRole(session));

  if (session.authenticated) {
    updateCurrentUser(session);
    setAuthOverlayVisible(false);
    return true;
  }

  const authForm = _deps.authForm;
  const authUsernameInput = _deps.authUsernameInput;
  const authPasswordInput = _deps.authPasswordInput;
  const authSubmit = _deps.authSubmit;

  if (!authForm || !authUsernameInput || !authPasswordInput || !authSubmit) {
    _deps.setStatus('Не удалось инициализировать форму входа.');
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

export function recoverFromRemoteSessionTermination(message = 'Сессия завершена. Войдите снова.') {
  if (state.authRecoveryInProgress) return;
  state.authRecoveryInProgress = true;

  _deps.closeLayoutStream();
  _deps.stopHostProgressLoop();
  _deps.stopCoHostProgressLoop();
  _deps.stopAndClearLocalPlayback();
  state.currentUser = null;
  state.authUsersState = [];
  applyRoleUi(ROLE_SLAVE);
  _deps.setStatus(message);

  ensureAuthorizedUser()
    .then((authorized) => {
      if (!authorized) return;
      _deps.connectLayoutStream();
    })
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      state.authRecoveryInProgress = false;
    });
}

export async function fetchAuthUsersForHost() {
  if (!isHostRole()) return;

  const { ok, data } = await api.fetchAuthClients();
  if (!ok) {
    const message = data && (data.error || data.message);
    throw new Error(message || 'Не удалось загрузить список активных пользователей');
  }

  applyIncomingAuthUsers(data, { syncOwnRole: false });
}

export async function updateCoHostRole(username, role, toggleInput = null) {
  if (!isHostRole()) return;
  const normalizedRole = role === ROLE_COHOST ? ROLE_COHOST : ROLE_SLAVE;
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!normalizedUsername) return;

  state.cohostRoleUpdatesInFlight.add(normalizedUsername);
  renderCohostUsers();

  try {
    const { ok, data } = await api.postAuthClientRole(normalizedUsername, normalizedRole);
    if (!ok) {
      const message = data && (data.error || data.message);
      throw new Error(message || 'Не удалось изменить роль пользователя');
    }

    applyIncomingAuthUsers(data, { syncOwnRole: false });
    _deps.setStatus(
      normalizedRole === ROLE_COHOST
        ? `Пользователь ${normalizedUsername} назначен co-host.`
        : `Роль co-host у ${normalizedUsername} снята.`,
    );
  } catch (err) {
    if (toggleInput) {
      toggleInput.checked = normalizedRole !== ROLE_COHOST;
    }
    _deps.setStatus(err && err.message ? err.message : 'Не удалось обновить роль co-host.');
  } finally {
    state.cohostRoleUpdatesInFlight.delete(normalizedUsername);
    renderCohostUsers();
  }
}

export async function disconnectClientSessions(username) {
  if (!isHostRole()) return;

  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!normalizedUsername) return;

  const confirmed = window.confirm(`Отключить ${normalizedUsername}? Будут завершены все его сессии.`);
  if (!confirmed) {
    _deps.setStatus('Отключение клиента отменено.');
    return;
  }

  state.cohostDisconnectUpdatesInFlight.add(normalizedUsername);
  renderCohostUsers();

  try {
    const { ok, data } = await api.postAuthClientDisconnect(normalizedUsername);
    if (!ok) {
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
    _deps.setStatus(
      removedSessions
        ? `Пользователь ${normalizedUsername} отключен (${removedSessions} сесс.).`
        : `Пользователь ${normalizedUsername} отключен.`,
    );
  } catch (err) {
    _deps.setStatus(err && err.message ? err.message : 'Не удалось отключить пользователя.');
  } finally {
    state.cohostDisconnectUpdatesInFlight.delete(normalizedUsername);
    renderCohostUsers();
  }
}

export async function stopServer({ requireConfirmation = true } = {}) {
  if (!isHostRole()) {
    _deps.setStatus('Остановку сервера может выполнить только хост (live).');
    return;
  }

  if (requireConfirmation) {
    const confirmed = window.confirm('Остановить сервер? Все подключенные клиенты будут отключены.');
    if (!confirmed) {
      _deps.setStatus('Остановка сервера отменена.');
      return;
    }
  }

  if (_deps.stopServerBtn) {
    _deps.stopServerBtn.disabled = true;
  }
  _deps.setStatus('Останавливаем сервер...');

  try {
    const { ok: shutdownOk, data: shutdownData } = await api.postShutdown();
    if (!shutdownOk) {
      const message = shutdownData && (shutdownData.error || shutdownData.message);
      throw new Error(message || 'Request failed');
    }
    _deps.setStatus('Сервер останавливается. Окно будет закрыто.');
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
    _deps.setStatus(err.message || 'Не удалось остановить сервер. Попробуйте ещё раз.');
    if (_deps.stopServerBtn) {
      _deps.stopServerBtn.disabled = false;
    }
  }
}

export async function logoutClient({ requireConfirmation = true } = {}) {
  if (isHostRole()) return;
  if (!_deps.clientLogoutBtn) return;

  if (requireConfirmation) {
    const confirmed = window.confirm('Отключиться от сервера? Понадобится повторный вход.');
    if (!confirmed) {
      _deps.setStatus('Отключение отменено.');
      return;
    }
  }

  _deps.clientLogoutBtn.disabled = true;
  _deps.setStatus('Отключаемся...');

  try {
    const { ok, data } = await api.postAuthLogout();
    if (!ok) {
      const message = data && (data.error || data.message);
      throw new Error(message || 'Не удалось отключиться');
    }

    _deps.closeLayoutStream();
    _deps.stopHostProgressLoop();
    _deps.stopCoHostProgressLoop();
    _deps.stopAndClearLocalPlayback();

    state.currentUser = null;
    state.authUsersState = [];
    applyRoleUi(ROLE_SLAVE);
    _deps.setStatus('Вы отключены. Войдите снова.');

    ensureAuthorizedUser()
      .then((authorized) => {
        if (!authorized) return;
        _deps.connectLayoutStream();
      })
      .catch((err) => {
        console.error(err);
      });
  } catch (err) {
    console.error(err);
    _deps.setStatus(err && err.message ? err.message : 'Не удалось отключиться.');
    _deps.clientLogoutBtn.disabled = false;
  }
}

export function initServerControls() {
  if (_deps.stopServerBtn) {
    _deps.stopServerBtn.addEventListener('click', () => {
      stopServer({ requireConfirmation: true });
    });
  }

  if (_deps.clientLogoutBtn) {
    _deps.clientLogoutBtn.addEventListener('click', () => {
      logoutClient({ requireConfirmation: true });
    });
  }
}
