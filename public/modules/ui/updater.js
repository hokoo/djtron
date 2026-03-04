// public/modules/ui/updater.js — update UI

import { state, SETTINGS_KEYS } from '../state.js';
import * as api from '../api.js';
import { isHostRole } from '../roles.js';

let _deps = {};

export function setUpdaterDeps(d) {
  Object.assign(_deps, d);
}

export function updatePrereleaseSettingUi(role = state.currentRole) {
  const isHost = isHostRole(role);
  if (_deps.allowPrereleaseRow) {
    _deps.allowPrereleaseRow.style.display = isHost ? 'flex' : 'none';
  }
  if (_deps.allowPrereleaseInput) {
    _deps.allowPrereleaseInput.disabled = !isHost;
  }
  if (!isHost) {
    showUpdateBlock(false);
  }
}

export function showUpdateBlock(isVisible) {
  if (!_deps.updateInfoEl) return;
  _deps.updateInfoEl.hidden = !(isVisible && isHostRole());
}

export function resetUpdateUi() {
  setUpdateMessage('');
  setUpdateStatus('');
  if (_deps.updateButton) {
    _deps.updateButton.disabled = true;
  }
  showUpdateBlock(false);
}

export function setUpdateMessage(text, linkUrl = null, linkLabel = '') {
  if (!_deps.updateMessageEl) return;
  if (linkUrl && linkLabel) {
    _deps.updateMessageEl.textContent = '';
    _deps.updateMessageEl.append(document.createTextNode(text || ''));
    const linkEl = document.createElement('a');
    linkEl.className = 'sidebar-repo__link';
    linkEl.href = linkUrl;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.textContent = linkLabel;
    _deps.updateMessageEl.append(linkEl);
    return;
  }
  _deps.updateMessageEl.textContent = text;
}

export function setUpdateStatus(text) {
  if (!_deps.updateStatusEl) return;
  _deps.updateStatusEl.textContent = text;
}

export function startShutdownCountdown(seconds = 20) {
  let remaining = Math.max(0, Math.floor(seconds));

  if (state.shutdownCountdownTimer) {
    clearTimeout(state.shutdownCountdownTimer);
    state.shutdownCountdownTimer = null;
  }

  const tick = () => {
    if (remaining <= 0) {
      state.shutdownCountdownTimer = null;
      _deps.stopServer({ requireConfirmation: false });
      return;
    }

    setUpdateMessage(`Приложение будет закрыто через ${remaining} с.`);
    remaining -= 1;
    state.shutdownCountdownTimer = setTimeout(tick, 1000);
  };

  tick();
}

export async function checkForUpdates() {
  if (!_deps.updateInfoEl || !_deps.updateMessageEl || !_deps.updateButton) return;
  if (!isHostRole()) {
    resetUpdateUi();
    return;
  }

  resetUpdateUi();

  const allowPrerelease = Boolean(isHostRole() && _deps.allowPrereleaseInput && _deps.allowPrereleaseInput.checked);

  try {
    const { ok, data } = await api.fetchUpdateCheck(allowPrerelease);
    if (!ok) {
      throw new Error('Request failed');
    }

    if (data && data.currentVersion && _deps.appVersionEl) {
      _deps.appVersionEl.textContent = `Версия: ${data.currentVersion}`;
    }

    if (data && data.hasUpdate && data.latestVersion) {
      const releaseLabel = data.releaseName || `v${data.latestVersion}`;
      if (data.releaseUrl) {
        setUpdateMessage('Доступен релиз: ', data.releaseUrl, releaseLabel);
      } else {
        setUpdateMessage(`Доступен релиз: ${releaseLabel}`);
      }
      _deps.updateButton.disabled = false;
      showUpdateBlock(true);
    }
  } catch (err) {
    console.error('Не удалось проверить обновления', err);
    resetUpdateUi();
  }
}

export async function applyUpdate() {
  if (!_deps.updateButton) return;
  if (!isHostRole()) {
    resetUpdateUi();
    return;
  }

  _deps.updateButton.disabled = true;
  setUpdateStatus('Скачиваем и устанавливаем обновление...');

  const allowPrerelease = Boolean(isHostRole() && _deps.allowPrereleaseInput && _deps.allowPrereleaseInput.checked);

  try {
    const { ok, data } = await api.postUpdateApply(allowPrerelease);

    if (!ok) {
      const message = data && (data.error || data.message);
      throw new Error(message || 'Не удалось выполнить запрос');
    }

    const message = (data && (data.message || data.error)) || 'Обновление выполнено';
    const installed = ok && typeof message === 'string' && message.toLowerCase().includes('обновление установлено');

    if (installed) {
      setUpdateStatus('Обновление установлено.');
      startShutdownCountdown(20);
      return;
    }

    setUpdateStatus(message);
  } catch (err) {
    console.error('Ошибка при обновлении', err);
    setUpdateStatus(err.message);
    _deps.updateButton.disabled = false;
  }
}

export async function loadVersion() {
  if (!_deps.appVersionEl) return;

  try {
    const { ok, data } = await api.fetchVersion();
    if (!ok) {
      throw new Error('Request failed');
    }
    if (data && data.version) {
      _deps.appVersionEl.textContent = `Версия: ${data.version}`;
    } else {
      _deps.appVersionEl.textContent = 'Версия: неизвестна';
    }
  } catch (err) {
    console.error('Не удалось загрузить версию приложения', err);
    _deps.appVersionEl.textContent = 'Версия: неизвестна';
  }
}

export function initUpdater() {
  if (_deps.allowPrereleaseInput) {
    _deps.allowPrereleaseInput.checked = _deps.loadBooleanSetting(SETTINGS_KEYS.allowPrerelease, false);
    _deps.allowPrereleaseInput.addEventListener('change', () => {
      if (!isHostRole()) {
        _deps.allowPrereleaseInput.checked = false;
        return;
      }
      _deps.saveSetting(SETTINGS_KEYS.allowPrerelease, _deps.allowPrereleaseInput.checked ? 'true' : 'false');
      checkForUpdates();
    });
  }

  updatePrereleaseSettingUi();

  if (_deps.updateButton) {
    _deps.updateButton.addEventListener('click', applyUpdate);
  }
  checkForUpdates();
}
