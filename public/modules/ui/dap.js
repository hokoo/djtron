// public/modules/ui/dap.js — DAP settings + controls

import { state, SETTINGS_KEYS, DAP_NO_SILENCE_GUARD_INTERVAL_MS,
  DAP_DEFAULT_VOLUME_PERCENT, DAP_MIN_VOLUME_PERCENT, DAP_MAX_VOLUME_PERCENT } from '../state.js';
import { isHostRole, isCoHostRole, updateDapNowPlayingVisibility } from '../roles.js';

let _deps = {};

export function setDapDeps(d) {
  Object.assign(_deps, d);
}

export function updateDapSettingsUi(role = state.currentRole) {
  const isHost = isHostRole(role);
  const isHostOrCoHost = isHost || isCoHostRole(role);
  const normalizedLayout = _deps.ensurePlaylists(state.layout);
  const normalizedDap = _deps.normalizeDapConfig(state.dapConfig, normalizedLayout.length, state.dapConfig);
  state.dapConfig = normalizedDap;
  updateDapNowPlayingVisibility(role);

  if (_deps.dapSettingsPanelEl) {
    _deps.dapSettingsPanelEl.hidden = !isHostOrCoHost;
  }

  if (_deps.dapPlaylistSelect) {
    const selectedValue = normalizedDap.playlistIndex !== null
      ? String(normalizedDap.playlistIndex)
      : '';
    const previousValue = _deps.dapPlaylistSelect.value;
    _deps.dapPlaylistSelect.innerHTML = '';

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Выберите плей-лист';
    _deps.dapPlaylistSelect.appendChild(emptyOption);

    for (let index = 0; index < normalizedLayout.length; index += 1) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${index + 1}. ${_deps.getPlaylistDisplayLabel(index)}`;
      _deps.dapPlaylistSelect.appendChild(option);
    }

    _deps.dapPlaylistSelect.value = selectedValue;
    if (_deps.dapPlaylistSelect.value !== selectedValue) {
      _deps.dapPlaylistSelect.value = '';
    }
    if (previousValue && !selectedValue && !_deps.dapPlaylistSelect.value) {
      _deps.dapPlaylistSelect.value = '';
    }

    _deps.dapPlaylistSelect.disabled = !isHost || !normalizedDap.enabled || normalizedLayout.length <= 0;
  }

  if (_deps.dapEnabledToggle) {
    _deps.dapEnabledToggle.checked = normalizedDap.enabled;
    _deps.dapEnabledToggle.disabled = !isHost || normalizedLayout.length <= 0;
  }

  if (_deps.dapVolumePercentInput) {
    _deps.dapVolumePercentInput.value = String(normalizedDap.volumePercent);
    _deps.dapVolumePercentInput.disabled = !isHost || !normalizedDap.enabled;
  }
}

export function isDapEnabled(config = state.dapConfig) {
  return Boolean(config && config.enabled && Number.isInteger(config.playlistIndex) && config.playlistIndex >= 0);
}

export function isDapTrackContext(trackOrContext = null, config = state.dapConfig) {
  if (!trackOrContext || typeof trackOrContext !== 'object') return false;
  const playlistIndex = _deps.normalizePlaylistTrackIndex(trackOrContext.playlistIndex);
  if (playlistIndex === null) return false;
  return _deps.isDapPlaylistIndex(playlistIndex, config);
}

export function startDapNoSilenceGuard() {
  if (state.dapNoSilenceGuardTimer !== null) return;
  state.dapNoSilenceGuardTimer = setInterval(() => {
    _deps.ensureDapNoSilencePlayback({ reason: 'interval' }).catch(() => {});
  }, DAP_NO_SILENCE_GUARD_INTERVAL_MS);
}

export function stopDapNoSilenceGuard() {
  if (state.dapNoSilenceGuardTimer === null) return;
  clearInterval(state.dapNoSilenceGuardTimer);
  state.dapNoSilenceGuardTimer = null;
}

export function initDapSettingsControls() {
  updateDapSettingsUi(state.currentRole);

  if (_deps.dapEnabledToggle) {
    _deps.dapEnabledToggle.addEventListener('change', async () => {
      if (!isHostRole()) {
        updateDapSettingsUi(state.currentRole);
        _deps.setStatus('DAP может менять только хост.');
        return;
      }

      const enabled = Boolean(_deps.dapEnabledToggle.checked);
      let playlistIndex = _deps.normalizePlaylistTrackIndex(_deps.dapPlaylistSelect ? _deps.dapPlaylistSelect.value : null);
      if (playlistIndex === null) {
        playlistIndex = _deps.normalizePlaylistTrackIndex(state.dapConfig.playlistIndex);
      }
      if (playlistIndex === null && state.layout.length > 0) {
        playlistIndex = 0;
      }
      if (enabled && playlistIndex === null) {
        updateDapSettingsUi(state.currentRole);
        _deps.setStatus('Выберите плей-лист для DAP.');
        return;
      }

      const nextDap = {
        enabled,
        playlistIndex,
        volumePercent: _deps.normalizeDapVolumePercent(
          _deps.dapVolumePercentInput ? _deps.dapVolumePercentInput.value : state.dapConfig.volumePercent,
          state.dapConfig.volumePercent,
        ),
      };
      const message = enabled
        ? `DAP включен для плей-листа ${Number(playlistIndex) + 1}.`
        : 'DAP выключен.';
      await _deps.syncDapConfig(nextDap, { successMessage: message });
    });
  }

  if (_deps.dapPlaylistSelect) {
    _deps.dapPlaylistSelect.addEventListener('change', async () => {
      if (!isHostRole()) {
        updateDapSettingsUi(state.currentRole);
        _deps.setStatus('DAP может менять только хост.');
        return;
      }

      const playlistIndex = _deps.normalizePlaylistTrackIndex(_deps.dapPlaylistSelect.value);
      if (playlistIndex === null) {
        updateDapSettingsUi(state.currentRole);
        _deps.setStatus('Выберите плей-лист для DAP.');
        return;
      }

      const nextDap = {
        enabled: true,
        playlistIndex,
        volumePercent: _deps.normalizeDapVolumePercent(
          _deps.dapVolumePercentInput ? _deps.dapVolumePercentInput.value : state.dapConfig.volumePercent,
          state.dapConfig.volumePercent,
        ),
      };
      await _deps.syncDapConfig(nextDap, { successMessage: `DAP переключен на плей-лист ${playlistIndex + 1}.` });
    });
  }

  if (_deps.dapVolumePercentInput) {
    _deps.dapVolumePercentInput.addEventListener('change', async () => {
      if (!isHostRole()) {
        updateDapSettingsUi(state.currentRole);
        _deps.setStatus('DAP может менять только хост.');
        return;
      }

      const nextVolumePercent = _deps.normalizeDapVolumePercent(_deps.dapVolumePercentInput.value, state.dapConfig.volumePercent);
      _deps.dapVolumePercentInput.value = String(nextVolumePercent);
      const nextDap = {
        enabled: Boolean(state.dapConfig.enabled),
        playlistIndex: _deps.normalizePlaylistTrackIndex(state.dapConfig.playlistIndex),
        volumePercent: nextVolumePercent,
      };
      await _deps.syncDapConfig(nextDap, { successMessage: `Громкость DAP: ${nextVolumePercent}%.` });
    });
  }
}
