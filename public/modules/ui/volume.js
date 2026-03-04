// public/modules/ui/volume.js — volume presets UI

import { state, SETTINGS_KEYS, DEFAULT_LIVE_VOLUME_PRESET_VALUES, DEFAULT_LIVE_VOLUME } from '../state.js';
import { isHostRole, isCoHostRole } from '../roles.js';
import {
  normalizeLiveVolumePreset, isVolumePresetMatch, getActiveVolumePresetValue,
  getDapVolumePresetValue, isDapVolumePresetPlaybackActive, formatVolumePresetLabel,
  canDisableVolumePresetsSetting,
} from '../config.js';
import { setLivePlaybackVolume } from '../audio.js';

let _deps = {};

export function setVolumeDeps(d) {
  Object.assign(_deps, d);
}

export function rebuildVolumePresetButtons() {
  if (!_deps.localVolumePresetsEl) {
    _deps.setLocalVolumePresetButtons([]);
    state.volumePresetButtonsSignature = '';
    return;
  }

  state.volumePresetButtonsSignature = '';
  updateVolumePresetsUi();
}

export function updateVolumePresetsUi() {
  const localVolumePresetsEl = _deps.localVolumePresetsEl;
  if (!localVolumePresetsEl) return;

  const canManagePresets = isHostRole() || isCoHostRole();
  if (_deps.showVolumePresetsToggleRow) {
    _deps.showVolumePresetsToggleRow.style.display = canManagePresets ? 'flex' : 'none';
  }

  const dapPresetActive = isDapVolumePresetPlaybackActive();
  const dapPresetVolume = getDapVolumePresetValue();
  const basePresetSource =
    Array.isArray(state.LIVE_VOLUME_PRESET_VALUES) && state.LIVE_VOLUME_PRESET_VALUES.length
      ? state.LIVE_VOLUME_PRESET_VALUES
      : DEFAULT_LIVE_VOLUME_PRESET_VALUES;
  const basePresets = basePresetSource
    .map((value) => normalizeLiveVolumePreset(value, null))
    .filter((value, index, source) => Number.isFinite(value) && value > 0 && value < 1 && source.indexOf(value) === index);
  const visibleBasePresets = dapPresetActive
    ? basePresets.filter((presetValue) => !isVolumePresetMatch(presetValue, dapPresetVolume))
    : basePresets.slice();
  const visiblePresetItems = visibleBasePresets.map((presetValue) => ({
    key: `base:${presetValue.toFixed(3)}`,
    kind: 'base',
    volume: presetValue,
    label: formatVolumePresetLabel(presetValue),
  }));
  if (dapPresetActive) {
    visiblePresetItems.push({
      key: `dap:${dapPresetVolume.toFixed(3)}`,
      kind: 'dap',
      volume: dapPresetVolume,
      label: formatVolumePresetLabel(dapPresetVolume),
    });
  }

  const shouldShow = state.showVolumePresetsEnabled && canManagePresets;
  localVolumePresetsEl.hidden = !shouldShow;
  const activePreset = getActiveVolumePresetValue();
  const showVolumePresetsToggle = _deps.showVolumePresetsToggle;
  if (showVolumePresetsToggle) {
    showVolumePresetsToggle.checked = state.showVolumePresetsEnabled;
    showVolumePresetsToggle.disabled = !canManagePresets || Boolean(state.showVolumePresetsEnabled && !canDisableVolumePresetsSetting());
  }

  let localVolumePresetButtons = _deps.getLocalVolumePresetButtons();

  const layoutSignature = visiblePresetItems.map((item) => item.key).join('|');
  if (layoutSignature !== state.volumePresetButtonsSignature) {
    localVolumePresetsEl.textContent = '';
    localVolumePresetButtons = visiblePresetItems.map((item) => {
      const button = document.createElement('button');
      button.className = 'volume-presets__button';
      button.type = 'button';
      button.dataset.volume = String(item.volume);
      button.dataset.presetKind = item.kind;
      button.textContent = item.label;
      button.addEventListener('click', onVolumePresetButtonClick);
      localVolumePresetsEl.append(button);
      return button;
    });
    _deps.setLocalVolumePresetButtons(localVolumePresetButtons);
    state.volumePresetButtonsSignature = layoutSignature;
  }

  if (!localVolumePresetButtons.length) return;

  for (const button of localVolumePresetButtons) {
    const buttonVolume = normalizeLiveVolumePreset(button.dataset.volume, null);
    const presetKind = button.dataset.presetKind === 'dap' ? 'dap' : 'base';
    const isDapButton = presetKind === 'dap';
    const isActive = isDapButton
      ? dapPresetActive
      : !dapPresetActive && buttonVolume !== null && activePreset !== null && isVolumePresetMatch(buttonVolume, activePreset);
    const isLocked = dapPresetActive;

    button.classList.toggle('is-dap', isDapButton);
    button.classList.toggle('is-active', isActive);
    button.classList.toggle('is-locked', isLocked);
    button.disabled = isLocked;
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    if (isDapButton) {
      button.title = `DAP громкость ${formatVolumePresetLabel(buttonVolume !== null ? buttonVolume : dapPresetVolume)} (зафиксировано)`;
    } else {
      button.title = dapPresetActive
        ? `Громкость ${formatVolumePresetLabel(buttonVolume !== null ? buttonVolume : DEFAULT_LIVE_VOLUME)} (временно недоступно)`
        : `Громкость ${formatVolumePresetLabel(buttonVolume !== null ? buttonVolume : DEFAULT_LIVE_VOLUME)}`;
    }
  }
}

export async function onVolumePresetButtonClick(event) {
  const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const presetKind = button && button.dataset.presetKind === 'dap' ? 'dap' : 'base';
  const presetVolume = normalizeLiveVolumePreset(button ? button.dataset.volume : null, null);
  if (presetVolume === null) return;
  const dapPresetActive = isDapVolumePresetPlaybackActive();
  if (dapPresetActive) {
    if (presetKind === 'dap') {
      _deps.setStatus(`DAP громкость ${formatVolumePresetLabel(presetVolume)} зафиксирована во время воспроизведения.`);
    } else {
      _deps.setStatus('Во время воспроизведения DAP доступен только DAP пресет громкости.');
    }
    updateVolumePresetsUi();
    return;
  }
  if (presetKind === 'dap') return;

  const activePreset = getActiveVolumePresetValue();
  const shouldTurnOffPreset = activePreset !== null && isVolumePresetMatch(activePreset, presetVolume);
  const targetVolume = shouldTurnOffPreset ? DEFAULT_LIVE_VOLUME : presetVolume;

  if (isHostRole()) {
    setLivePlaybackVolume(targetVolume, { sync: true, announce: true });
    return;
  }

  if (!isCoHostRole()) return;

  const previousVolume = _deps.getEffectiveLiveVolume();
  setLivePlaybackVolume(targetVolume, { sync: false, announce: false });
  try {
    await _deps.requestCoHostSetLiveVolume(targetVolume);
    _deps.setStatus(`Live громкость: ${formatVolumePresetLabel(targetVolume)}.`);
  } catch (err) {
    console.error(err);
    const fallbackVolume = normalizeLiveVolumePreset(state.hostPlaybackState.volume, previousVolume);
    setLivePlaybackVolume(fallbackVolume, { sync: false, announce: false });
    _deps.setStatus(err && err.message ? err.message : 'Не удалось изменить live-громкость.');
  }
}

export function setShowVolumePresetsEnabled(
  enabled,
  { persist = false, sync = false, announce = false } = {},
) {
  let normalized = Boolean(enabled);
  if (!normalized && !canDisableVolumePresetsSetting()) {
    normalized = true;
  }
  const changed = normalized !== state.showVolumePresetsEnabled;
  state.showVolumePresetsEnabled = normalized;

  if (_deps.showVolumePresetsToggle) {
    _deps.showVolumePresetsToggle.checked = normalized;
  }

  if (persist) {
    _deps.saveSetting(SETTINGS_KEYS.showVolumePresets, normalized ? 'true' : 'false');
  }

  updateVolumePresetsUi();

  if (sync && changed && isHostRole()) {
    _deps.requestHostPlaybackSync(true);
  }

  if (announce) {
    _deps.setStatus(normalized ? 'Пресеты громкости включены.' : 'Пресеты громкости выключены.');
  }

  return changed;
}

export function initVolumePresetControls() {
  if (isHostRole()) {
    setShowVolumePresetsEnabled(_deps.loadBooleanSetting(SETTINGS_KEYS.showVolumePresets, false), {
      persist: false,
      sync: false,
    });
  } else {
    setShowVolumePresetsEnabled(false, { persist: false, sync: false });
  }

  if (_deps.showVolumePresetsToggle) {
    _deps.showVolumePresetsToggle.checked = state.showVolumePresetsEnabled;
    _deps.showVolumePresetsToggle.addEventListener('change', async () => {
      const nextEnabled = Boolean(_deps.showVolumePresetsToggle.checked);
      if (!nextEnabled && !canDisableVolumePresetsSetting()) {
        _deps.showVolumePresetsToggle.checked = true;
        _deps.setStatus('Сначала выключите активный пресет громкости.');
        updateVolumePresetsUi();
        return;
      }

      if (isHostRole()) {
        setShowVolumePresetsEnabled(nextEnabled, { persist: true, sync: true });
        return;
      }

      if (!isCoHostRole()) {
        setShowVolumePresetsEnabled(nextEnabled, { persist: false, sync: false });
        return;
      }

      const previousEnabled = state.showVolumePresetsEnabled;
      setShowVolumePresetsEnabled(nextEnabled, { persist: false, sync: false });
      try {
        await _deps.requestCoHostSetVolumePresetsVisibility(nextEnabled);
        _deps.setStatus(`Пресеты громкости ${nextEnabled ? 'включены' : 'выключены'} на live.`);
      } catch (err) {
        console.error(err);
        setShowVolumePresetsEnabled(previousEnabled, { persist: false, sync: false });
        _deps.setStatus(err && err.message ? err.message : 'Не удалось изменить режим пресетов громкости.');
      }
    });
  }

  if (isHostRole()) {
    _deps.requestHostPlaybackSync(true);
  }

  updateVolumePresetsUi();
}
