// public/modules/config.js — runtime config, volume presets, and config parsing

import { state, RUNTIME_LOCAL_OVERRIDE_KEYS, RUNTIME_OVERRIDE_SCOPE_NONE,
  RUNTIME_OVERRIDE_SCOPE_CLIENT, RUNTIME_OVERRIDE_SCOPE_HOST,
  DEFAULT_RUNTIME_CONFIG_SCHEMA, DEFAULT_LIVE_VOLUME_PRESET_VALUES,
  DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS, DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS,
  DEFAULT_LIVE_VOLUME, DAP_DEFAULT_VOLUME_PERCENT } from './state.js';
import * as api from './api.js';
import { isHostRole, isCoHostRole } from './roles.js';

const _deps = {};

export function setConfigDeps(deps) {
  Object.assign(_deps, deps);
}

export function parseBooleanConfigValue(value, fallback = null) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized)) return false;
  return fallback;
}

export function normalizeVolumePresetValues(values, fallback = DEFAULT_LIVE_VOLUME_PRESET_VALUES) {
  const source = Array.isArray(values) ? values : [];
  const normalized = [];
  const seen = new Set();

  for (const rawValue of source) {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) continue;

    let ratioValue = null;
    if (numericValue > 0 && numericValue < 1) {
      ratioValue = numericValue;
    } else if (numericValue >= 1 && numericValue < 100) {
      ratioValue = numericValue / 100;
    }
    if (!Number.isFinite(ratioValue)) continue;

    const rounded = Math.round(ratioValue * 1000) / 1000;
    if (rounded <= 0 || rounded >= 1) continue;
    const dedupeKey = rounded.toFixed(3);
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    normalized.push(rounded);
    if (normalized.length >= 8) break;
  }

  if (normalized.length) return normalized;
  if (Array.isArray(fallback)) return fallback.slice();
  return DEFAULT_LIVE_VOLUME_PRESET_VALUES.slice();
}

export function parseVolumePresetsConfigValue(value, fallback = null) {
  const fallbackArray = Array.isArray(fallback) ? fallback : null;

  if (Array.isArray(value)) {
    const normalized = normalizeVolumePresetValues(value, []);
    if (normalized.length) return normalized;
    return fallbackArray ? fallbackArray.slice() : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = normalizeVolumePresetValues([value], []);
    if (normalized.length) return normalized;
    return fallbackArray ? fallbackArray.slice() : null;
  }

  if (typeof value !== 'string') return fallbackArray ? fallbackArray.slice() : null;
  const trimmed = value.trim();
  if (!trimmed) return fallbackArray ? fallbackArray.slice() : null;

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const normalized = normalizeVolumePresetValues(parsed, []);
        if (normalized.length) return normalized;
        return fallbackArray ? fallbackArray.slice() : null;
      }
    } catch (err) {
      // fallback to token parsing
    }
  }

  const tokens = trimmed.split(/[,\s;|]+/).filter(Boolean);
  if (!tokens.length) return fallbackArray ? fallbackArray.slice() : null;
  const normalized = normalizeVolumePresetValues(tokens, []);
  if (normalized.length) return normalized;
  return fallbackArray ? fallbackArray.slice() : null;
}

export function parsePortCandidate(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const numeric = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return fallback;
  return numeric;
}

export function parseDspCompensationMsConfigValue(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.trunc(numeric);
  if (normalized < 0 || normalized > 250) return fallback;
  return normalized;
}

export function getDefaultRuntimeConfigSchema() {
  return {
    port: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
    allowContextMenu: { localOverride: RUNTIME_OVERRIDE_SCOPE_CLIENT },
    volumePresets: { localOverride: RUNTIME_OVERRIDE_SCOPE_HOST },
    dspEntryCompensationMs: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
    dspExitCompensationMs: { localOverride: RUNTIME_OVERRIDE_SCOPE_NONE },
  };
}

export function sanitizeRuntimeOverrideScope(value, fallback = RUNTIME_OVERRIDE_SCOPE_NONE) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    normalized === RUNTIME_OVERRIDE_SCOPE_NONE ||
    normalized === RUNTIME_OVERRIDE_SCOPE_CLIENT ||
    normalized === RUNTIME_OVERRIDE_SCOPE_HOST
  ) {
    return normalized;
  }
  return fallback;
}

export function sanitizeRuntimeConfigSchema(rawSchema) {
  const schema = getDefaultRuntimeConfigSchema();
  if (!rawSchema || typeof rawSchema !== 'object') return schema;

  for (const key of Object.keys(schema)) {
    const rawEntry = rawSchema[key];
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    schema[key].localOverride = sanitizeRuntimeOverrideScope(rawEntry.localOverride, schema[key].localOverride);
  }

  return schema;
}

export function sanitizeRuntimeConfigPayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const payloadValues = payload.values && typeof payload.values === 'object' ? payload.values : payload;
  const schema = sanitizeRuntimeConfigSchema(payload.schema);

  return {
    port: parsePortCandidate(payloadValues.port, null),
    allowContextMenu: parseBooleanConfigValue(payloadValues.allowContextMenu, false),
    volumePresets: parseVolumePresetsConfigValue(payloadValues.volumePresets, DEFAULT_LIVE_VOLUME_PRESET_VALUES),
    dspEntryCompensationMs: parseDspCompensationMsConfigValue(
      payloadValues.dspEntryCompensationMs,
      DEFAULT_LIVE_DSP_ENTRY_COMPENSATION_MS,
    ),
    dspExitCompensationMs: parseDspCompensationMsConfigValue(
      payloadValues.dspExitCompensationMs,
      DEFAULT_LIVE_DSP_EXIT_COMPENSATION_MS,
    ),
    schema,
  };
}

export function getRuntimeLocalOverrideScope(configKey, schema = state.runtimeServerConfig.schema) {
  const fallbackScope = DEFAULT_RUNTIME_CONFIG_SCHEMA[configKey]
    ? DEFAULT_RUNTIME_CONFIG_SCHEMA[configKey].localOverride
    : RUNTIME_OVERRIDE_SCOPE_NONE;
  if (!schema || typeof schema !== 'object') return fallbackScope;
  const schemaEntry = schema[configKey];
  if (!schemaEntry || typeof schemaEntry !== 'object') return fallbackScope;
  return sanitizeRuntimeOverrideScope(schemaEntry.localOverride, fallbackScope);
}

export function canUseRuntimeLocalOverride(configKey, role = state.currentRole, schema = state.runtimeServerConfig.schema) {
  const scope = getRuntimeLocalOverrideScope(configKey, schema);
  if (scope === RUNTIME_OVERRIDE_SCOPE_CLIENT) return true;
  if (scope === RUNTIME_OVERRIDE_SCOPE_HOST) return isHostRole(role);
  return false;
}

export function readRuntimeLocalOverrides(schema = state.runtimeServerConfig.schema, role = state.currentRole) {
  const overrides = {
    allowContextMenu: null,
    volumePresets: null,
  };

  if (canUseRuntimeLocalOverride('allowContextMenu', role, schema)) {
    const allowContextMenuRaw = readStoredValueByKeys(RUNTIME_LOCAL_OVERRIDE_KEYS.allowContextMenu);
    overrides.allowContextMenu = parseBooleanConfigValue(allowContextMenuRaw, null);
  }

  if (canUseRuntimeLocalOverride('volumePresets', role, schema)) {
    const volumePresetsRaw = readStoredValueByKeys(RUNTIME_LOCAL_OVERRIDE_KEYS.volumePresets);
    overrides.volumePresets = parseVolumePresetsConfigValue(volumePresetsRaw, null);
  }

  return overrides;
}

export function readStoredValueByKeys(keys) {
  if (!Array.isArray(keys)) return null;
  for (const key of keys) {
    if (typeof key !== 'string' || !key) continue;
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  }
  return null;
}

export function setContextMenuBlocked(blocked) {
  const shouldBlock = Boolean(blocked);
  if (shouldBlock === state.contextMenuGuardAttached) return;

  if (shouldBlock) {
    document.addEventListener('contextmenu', preventContextMenu);
  } else {
    document.removeEventListener('contextmenu', preventContextMenu);
  }
  state.contextMenuGuardAttached = shouldBlock;
}

export function preventContextMenu(event) {
  event.preventDefault();
}

export function applyRuntimeClientConfig() {
  setContextMenuBlocked(!state.runtimeAllowContextMenu);
  state.LIVE_VOLUME_PRESET_VALUES = normalizeVolumePresetValues(state.LIVE_VOLUME_PRESET_VALUES);
  _deps.rebuildVolumePresetButtons();
}

export function applyRuntimeConfigFromSources(serverConfig = null) {
  if (serverConfig && typeof serverConfig === 'object') {
    state.runtimeServerConfig = sanitizeRuntimeConfigPayload(serverConfig);
  }

  const schema = state.runtimeServerConfig.schema || getDefaultRuntimeConfigSchema();
  const localOverrides = readRuntimeLocalOverrides(schema, state.currentRole);

  state.runtimeAllowContextMenu =
    localOverrides.allowContextMenu !== null ? localOverrides.allowContextMenu : state.runtimeServerConfig.allowContextMenu;
  state.LIVE_VOLUME_PRESET_VALUES =
    localOverrides.volumePresets && localOverrides.volumePresets.length
      ? localOverrides.volumePresets.slice()
      : state.runtimeServerConfig.volumePresets.slice();
  state.liveDspEntryCompensationSeconds = state.runtimeServerConfig.dspEntryCompensationMs / 1000;
  state.liveDspExitCompensationSeconds = state.runtimeServerConfig.dspExitCompensationMs / 1000;

  applyRuntimeClientConfig();
}

export async function fetchRuntimeConfig() {
  const { ok, data } = await api.fetchConfig();
  if (!ok) {
    throw new Error('Не удалось загрузить runtime-конфиг');
  }
  return data && typeof data === 'object' ? data : {};
}

export function clampVolume(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function normalizeLiveVolumePreset(value, fallback = DEFAULT_LIVE_VOLUME) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = clampVolume(numeric);
  if (Math.abs(normalized - 1) < 0.0001) {
    return 1;
  }
  return normalized;
}

export function isVolumePresetMatch(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) < 0.0001;
}

export function getActiveVolumePresetValue(volume = state.livePlaybackVolume, presets = state.LIVE_VOLUME_PRESET_VALUES) {
  const normalized = normalizeLiveVolumePreset(volume, DEFAULT_LIVE_VOLUME);
  const source = Array.isArray(presets) ? presets : [];
  for (const preset of source) {
    if (isVolumePresetMatch(normalized, preset)) {
      return preset;
    }
  }
  return null;
}

export function getDapVolumePresetValue(config = state.dapConfig) {
  return clampVolume(_deps.normalizeDapVolumePercent(config ? config.volumePercent : null, DAP_DEFAULT_VOLUME_PERCENT) / 100);
}

export function isDapVolumePresetPlaybackActive(role = state.currentRole, config = state.dapConfig) {
  if (!_deps.isDapEnabled(config)) return false;

  if (isHostRole(role)) {
    return Boolean(state.currentTrack && state.currentAudio && !state.currentAudio.paused && _deps.isDapTrackContext(state.currentTrack, config));
  }

  if (isCoHostRole(role)) {
    const hasLiveTrack =
      state.hostPlaybackState &&
      typeof state.hostPlaybackState.trackFile === 'string' &&
      state.hostPlaybackState.trackFile.trim();
    if (!hasLiveTrack) return false;
    return Boolean(!state.hostPlaybackState.paused && _deps.isDapTrackContext(state.hostPlaybackState, config));
  }

  return false;
}

export function formatVolumePresetLabel(volume) {
  return `${Math.round(clampVolume(volume) * 100)}%`;
}

export function hasActiveStandardVolumePreset(volume = state.livePlaybackVolume) {
  if (isDapVolumePresetPlaybackActive()) return false;
  return getActiveVolumePresetValue(volume) !== null;
}

export function canDisableVolumePresetsSetting(volume = state.livePlaybackVolume) {
  return !hasActiveStandardVolumePreset(volume);
}

export function normalizePlaybackSeekRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return 0;
  if (numeric >= 1) return 1;
  return numeric;
}
