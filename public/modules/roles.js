// public/modules/roles.js — role helper functions

import { state, ROLE_HOST, ROLE_SLAVE, ROLE_COHOST } from './state.js';

const _deps = {};

export function setRoleDeps(deps) {
  Object.assign(_deps, deps);
}

export function isHostRole(role = state.currentRole) {
  return role === ROLE_HOST;
}

export function isSlaveRole(role = state.currentRole) {
  return role === ROLE_SLAVE;
}

export function isCoHostRole(role = state.currentRole) {
  return role === ROLE_COHOST;
}

export function isRemoteLiveMirrorRole(role = state.currentRole) {
  return role === ROLE_SLAVE || role === ROLE_COHOST;
}

export function updateDapNowPlayingVisibility(role = state.currentRole) {
  const dapNowPlayingEl = document.getElementById('dapNowPlaying');
  if (!dapNowPlayingEl) return false;
  const shouldShow = (isHostRole(role) || isCoHostRole(role)) && _deps.isDapEnabled(state.dapConfig);
  dapNowPlayingEl.hidden = !shouldShow;
  const nowPlayingGridEl = document.querySelector('.now-playing-grid');
  if (nowPlayingGridEl) {
    const shouldCenterSingle = (isHostRole(role) || isCoHostRole(role)) && !shouldShow;
    nowPlayingGridEl.classList.toggle('now-playing-grid--single', shouldCenterSingle);
  }
  return shouldShow;
}
