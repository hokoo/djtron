// public/modules/ui/status.js — status bar + notifications

import { state, COLLAPSED_PLAYLIST_HINT_DURATION_MS } from '../state.js';

let _deps = {};

export function setStatusDeps(d) {
  Object.assign(_deps, d);
}

export function setStatus(message) {
  const statusEl = _deps.statusEl;
  if (statusEl) statusEl.textContent = message;
}

export function announcePlaybackAction(message) {
  setStatus(message);
}

export function removeCollapsedPlaylistsHint() {
  if (state.collapsedPlaylistsHintTimer !== null) {
    clearTimeout(state.collapsedPlaylistsHintTimer);
    state.collapsedPlaylistsHintTimer = null;
  }
  if (state.collapsedPlaylistsHintEl) {
    state.collapsedPlaylistsHintEl.remove();
    state.collapsedPlaylistsHintEl = null;
  }
}

export function showCollapsedPlaylistsHint(message) {
  if (typeof message !== 'string' || !message.trim()) return;
  removeCollapsedPlaylistsHint();

  const hintEl = document.createElement('div');
  hintEl.className = 'collapsed-playlists-hint';
  hintEl.textContent = message.trim();
  document.body.appendChild(hintEl);
  state.collapsedPlaylistsHintEl = hintEl;

  requestAnimationFrame(() => {
    if (!state.collapsedPlaylistsHintEl) return;
    state.collapsedPlaylistsHintEl.classList.add('is-visible');
  });

  state.collapsedPlaylistsHintTimer = setTimeout(() => {
    if (!state.collapsedPlaylistsHintEl) return;
    state.collapsedPlaylistsHintEl.classList.remove('is-visible');
    state.collapsedPlaylistsHintTimer = setTimeout(() => {
      removeCollapsedPlaylistsHint();
    }, 180);
  }, COLLAPSED_PLAYLIST_HINT_DURATION_MS);
}

export function hideCollapsedPlaylistsOverlay() {
  if (!state.collapsedPlaylistsOverlayEl) return;
  state.collapsedPlaylistsOverlayEl.remove();
  state.collapsedPlaylistsOverlayEl = null;
}

export function showCollapsedPlaylistsOverlay() {
  if (!_deps.isTouchPlaylistCollapseEnabled || !_deps.isTouchPlaylistCollapseEnabled()) return;
  const collapsedIndices = _deps.getCollapsedPlaylistIndicesInRenderOrder
    ? _deps.getCollapsedPlaylistIndicesInRenderOrder()
    : [];
  if (!collapsedIndices.length) {
    hideCollapsedPlaylistsOverlay();
    showCollapsedPlaylistsHint('Скрытых плей-листов нет.');
    return;
  }

  hideCollapsedPlaylistsOverlay();

  const overlay = document.createElement('div');
  overlay.className = 'collapsed-playlists-overlay';
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      hideCollapsedPlaylistsOverlay();
    }
  });

  const panel = document.createElement('div');
  panel.className = 'collapsed-playlists-panel';

  const title = document.createElement('p');
  title.className = 'collapsed-playlists-panel__title';
  title.textContent = 'Скрытые плей-листы';
  panel.appendChild(title);

  const sanitizePlaylistName = _deps.sanitizePlaylistName;
  const restoreCollapsedPlaylistForLocalView = _deps.restoreCollapsedPlaylistForLocalView;

  collapsedIndices.forEach((playlistIndex) => {
    const restoreButton = document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.className = 'collapsed-playlists-panel__item';
    restoreButton.textContent = sanitizePlaylistName(state.playlistNames[playlistIndex], playlistIndex);
    restoreButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      restoreCollapsedPlaylistForLocalView(playlistIndex);
    });
    panel.appendChild(restoreButton);
  });

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  state.collapsedPlaylistsOverlayEl = overlay;
}
