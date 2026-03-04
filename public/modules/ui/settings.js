// public/modules/ui/settings.js — settings panel + transition UI

import { state, SETTINGS_KEYS } from '../state.js';
import { isOverlayEnabled, isStopFadeEnabled } from '../audio.js';

let _deps = {};

export function setSettingsDeps(d) {
  Object.assign(_deps, d);
}

export function updateTransitionSettingsUi() {
  if (_deps.overlayTimeInput) {
    _deps.overlayTimeInput.disabled = !isOverlayEnabled();
  }
  if (_deps.stopFadeInput) {
    _deps.stopFadeInput.disabled = !isStopFadeEnabled();
  }
}

export function initSettings() {
  const {
    overlayTimeInput, overlayCurveSelect, stopFadeInput,
    overlayEnabledToggle, stopFadeEnabledToggle,
    loadSetting, saveSetting, loadBooleanSetting,
    loadTrackTitleModesByTrackSetting,
  } = _deps;

  loadTrackTitleModesByTrackSetting();

  overlayTimeInput.value = loadSetting(SETTINGS_KEYS.overlayTime, '0.3');
  overlayCurveSelect.value = loadSetting(SETTINGS_KEYS.overlayCurve, 'linear');
  stopFadeInput.value = loadSetting(SETTINGS_KEYS.stopFade, '0.4');
  if (overlayEnabledToggle) {
    overlayEnabledToggle.checked = loadBooleanSetting(SETTINGS_KEYS.overlayEnabled, true);
  }
  if (stopFadeEnabledToggle) {
    stopFadeEnabledToggle.checked = loadBooleanSetting(SETTINGS_KEYS.stopFadeEnabled, true);
  }
  updateTransitionSettingsUi();

  overlayTimeInput.addEventListener('change', () => {
    const sanitized = Math.max(0, parseFloat(overlayTimeInput.value) || 0).toString();
    overlayTimeInput.value = sanitized;
    saveSetting(SETTINGS_KEYS.overlayTime, sanitized);
  });

  stopFadeInput.addEventListener('change', () => {
    const sanitized = Math.max(0, parseFloat(stopFadeInput.value) || 0).toString();
    stopFadeInput.value = sanitized;
    saveSetting(SETTINGS_KEYS.stopFade, sanitized);
  });

  overlayCurveSelect.addEventListener('change', () => {
    saveSetting(SETTINGS_KEYS.overlayCurve, overlayCurveSelect.value);
  });

  if (overlayEnabledToggle) {
    overlayEnabledToggle.addEventListener('change', () => {
      saveSetting(SETTINGS_KEYS.overlayEnabled, overlayEnabledToggle.checked ? 'true' : 'false');
      updateTransitionSettingsUi();
    });
  }

  if (stopFadeEnabledToggle) {
    stopFadeEnabledToggle.addEventListener('change', () => {
      saveSetting(SETTINGS_KEYS.stopFadeEnabled, stopFadeEnabledToggle.checked ? 'true' : 'false');
      updateTransitionSettingsUi();
    });
  }
}

export function setSidebarOpen(isOpen) {
  const { sidebar, sidebarToggle, saveSetting } = _deps;
  if (!sidebar || !sidebarToggle) return;
  sidebar.classList.toggle('collapsed', !isOpen);
  sidebarToggle.textContent = isOpen ? '⟨' : '☰';
  saveSetting(SETTINGS_KEYS.sidebarOpen, isOpen ? '1' : '0');
}

export function initSidebarToggle() {
  const { sidebar, sidebarToggle, loadSetting } = _deps;
  const saved = loadSetting(SETTINGS_KEYS.sidebarOpen, '1');
  setSidebarOpen(saved !== '0');
  sidebarToggle.addEventListener('click', () => {
    const openNow = !sidebar.classList.contains('collapsed');
    setSidebarOpen(!openNow);
  });
}
