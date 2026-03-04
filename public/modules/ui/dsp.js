// public/modules/ui/dsp.js — DSP setup panel

import { state, DEFAULT_DSP_WINGET_COMMAND } from '../state.js';
import * as api from '../api.js';
import { isHostRole } from '../roles.js';

let _deps = {};

export function setDspDeps(d) {
  Object.assign(_deps, d);
}

export function setDspSetupStatus(message) {
  const dspSetupStatusEl = _deps.dspSetupStatusEl;
  if (!dspSetupStatusEl) return;
  dspSetupStatusEl.textContent = message || '';
}

export function updateDspSetupUi(role = state.currentRole) {
  const dspSetupPanelEl = _deps.dspSetupPanelEl;
  if (!dspSetupPanelEl) return;

  const isHost = isHostRole(role);
  if (!isHost) {
    dspSetupPanelEl.hidden = true;
    return;
  }

  const enabled = state.dspStatusState.enabled;
  const available = state.dspStatusState.ffmpegAvailable;
  const installCommand =
    typeof state.dspStatusState.wingetCommand === 'string' && state.dspStatusState.wingetCommand.trim()
      ? state.dspStatusState.wingetCommand.trim()
      : DEFAULT_DSP_WINGET_COMMAND;

  if (_deps.dspInstallCommandEl) {
    _deps.dspInstallCommandEl.textContent = installCommand;
  }

  const shouldShowPanel = enabled !== false && available !== true;
  dspSetupPanelEl.hidden = !shouldShowPanel;
  if (!shouldShowPanel) return;

  if (available === false) {
    const details = state.dspStatusState.ffmpegError ? ` (${state.dspStatusState.ffmpegError})` : '';
    setDspSetupStatus(`ffmpeg не найден${details}`);
    return;
  }

  if (state.dspStatusState.ffmpegError) {
    setDspSetupStatus(`Не удалось проверить ffmpeg: ${state.dspStatusState.ffmpegError}`);
    return;
  }

  setDspSetupStatus('Проверяем доступность ffmpeg...');
}

export function parseDspStatusPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const queue = payload.queue && typeof payload.queue === 'object' ? payload.queue : null;
  if (!queue) {
    throw new Error('Некорректный ответ DSP API');
  }

  state.dspStatusState.enabled = Boolean(queue.enabled);
  state.dspStatusState.ffmpegAvailable = typeof queue.ffmpegAvailable === 'boolean' ? queue.ffmpegAvailable : null;
  state.dspStatusState.ffmpegError =
    typeof queue.ffmpegError === 'string' && queue.ffmpegError.trim() ? queue.ffmpegError.trim() : null;
  state.dspStatusState.wingetCommand =
    typeof queue.wingetCommand === 'string' && queue.wingetCommand.trim()
      ? queue.wingetCommand.trim()
      : DEFAULT_DSP_WINGET_COMMAND;
  state.dspStatusState.checkedAt = Date.now();
}

export async function refreshDspStatus({ announceError = false, userInitiated = false } = {}) {
  if (!isHostRole()) return;
  if (state.dspStatusRequestInFlight) return;

  state.dspStatusRequestInFlight = true;
  if (_deps.dspCheckInstallBtn) {
    _deps.dspCheckInstallBtn.disabled = true;
  }

  if (userInitiated) {
    setDspSetupStatus('Проверяем наличие ffmpeg...');
  }

  try {
    const { ok: response_ok, data } = await api.fetchDspStatus(1);

    if (!response_ok) {
      const message = data && typeof data.error === 'string' && data.error ? data.error : 'Не удалось проверить DSP';
      throw new Error(message);
    }

    parseDspStatusPayload(data);
    updateDspSetupUi(state.currentRole);

    if (userInitiated && state.dspStatusState.ffmpegAvailable === true) {
      _deps.setStatus('ffmpeg найден. DSP готов.');
    }
  } catch (err) {
    console.error('Не удалось проверить ffmpeg', err);
    state.dspStatusState.enabled = true;
    state.dspStatusState.ffmpegAvailable = null;
    state.dspStatusState.ffmpegError = err && err.message ? err.message : 'Ошибка запроса';
    state.dspStatusState.checkedAt = Date.now();
    updateDspSetupUi(state.currentRole);

    if (announceError || userInitiated) {
      _deps.setStatus(state.dspStatusState.ffmpegError || 'Не удалось проверить ffmpeg.');
    }
  } finally {
    state.dspStatusRequestInFlight = false;
    if (_deps.dspCheckInstallBtn) {
      _deps.dspCheckInstallBtn.disabled = !isHostRole();
    }
  }
}

export function syncLiveDspNextTrackHighlight() {
  _deps.clearLiveDspNextTrackHighlight();
}

export function syncDspTransitionTrackHighlight() {
  _deps.clearDspTransitionTrackHighlight();
  if (!_deps.isDspTransitionPlaybackActive()) return;

  const sourceTrack = state.dspTransitionPlayback.fromTrack || null;
  const targetTrack = state.dspTransitionPlayback.toTrack || null;

  if (sourceTrack && sourceTrack.key) {
    const sourceCard = _deps.getTrackCardByContext(sourceTrack.key, sourceTrack);
    if (sourceCard) {
      sourceCard.classList.add('is-dsp-transition-source');
    }
  }

  if (targetTrack && targetTrack.key) {
    const targetCard = _deps.getTrackCardByContext(targetTrack.key, targetTrack);
    if (targetCard) {
      targetCard.classList.add('is-dsp-transition-target');
    }
  }
}

export function initDspSetupPanel() {
  updateDspSetupUi(state.currentRole);

  if (_deps.dspCopyInstallCommandBtn) {
    _deps.dspCopyInstallCommandBtn.addEventListener('click', async () => {
      const command =
        typeof state.dspStatusState.wingetCommand === 'string' && state.dspStatusState.wingetCommand.trim()
          ? state.dspStatusState.wingetCommand.trim()
          : DEFAULT_DSP_WINGET_COMMAND;
      try {
        await _deps.copyTextToClipboard(command);
        setDspSetupStatus('Команда скопирована. Вставьте ее в PowerShell или cmd.');
        _deps.setStatus('Команда установки ffmpeg скопирована.');
      } catch (err) {
        console.error('Не удалось скопировать команду установки ffmpeg', err);
        setDspSetupStatus('Не удалось скопировать автоматически. Скопируйте строку вручную.');
      }
    });
  }

  if (_deps.dspCheckInstallBtn) {
    _deps.dspCheckInstallBtn.addEventListener('click', () => {
      refreshDspStatus({ announceError: true, userInitiated: true });
    });
  }

  if (isHostRole()) {
    refreshDspStatus({ announceError: false, userInitiated: false });
  }
}
