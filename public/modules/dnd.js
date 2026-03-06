// public/modules/dnd.js — desktop drag-and-drop

import { DESKTOP_TRACK_DRAG_CANCEL_MOVE_PX, DESKTOP_TRACK_DRAG_HOLD_MS, PLAYLIST_TYPE_FOLDER, PLAYLIST_TYPE_MANUAL, QUEUE_NEXT_CHAIN_WINDOW_MS, ROLE_HOST, state } from './state.js';
import { isHostRole, isRemoteLiveMirrorRole } from './roles.js';
import { setStatus } from './ui/status.js';
import { PlaybackCommandBus } from '/shared/playback/index.js';

const _deps = {};
let zonesContainer = null;
const TRACK_MUTATION_DELETE_FROM_CONTEXT = 'track-delete-from-context';
const TRACK_MUTATION_QUEUE_NEXT_FROM_CONTEXT = 'track-queue-next-from-context';
const TRACK_MUTATION_DROP = 'track-drop';

const hostTrackMutationCommandBus = new PlaybackCommandBus({
  authorize: ({ sourceRole }) =>
    sourceRole === ROLE_HOST
      ? { allowed: true }
      : { allowed: false, reason: 'ACCESS_DENIED', message: 'Только хост может менять треки плей-листов.' },
  execute: async (payload) => {
    if (!payload || typeof payload.run !== 'function') {
      throw new Error('Некорректная команда мутации трека.');
    }
    await payload.run();
  },
});

async function dispatchHostTrackMutationCommand(commandType, run) {
  let runResult;
  const result = await hostTrackMutationCommandBus.dispatch(
    {
      sourceRole: ROLE_HOST,
      commandType,
      target: 'self',
    },
    {
      run: async () => {
        runResult = await run();
      },
    },
  );
  if (!result.ok) {
    throw new Error(result.message || 'Команда мутации трека отклонена.');
  }
  return runResult;
}

export function setDndDeps(d) {
  Object.assign(_deps, d);
  if (Object.prototype.hasOwnProperty.call(d, 'zonesContainer')) {
    zonesContainer = d.zonesContainer;
  }
}

export function isCopyDragModifier(event) {
  return Boolean(event && (event.ctrlKey || event.metaKey));
}

export function getZoneIndexFromElement(element) {
  if (!(element instanceof Element)) return null;
  const zone = element.closest('.zone');
  if (!zone) return null;
  const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
  if (!Number.isInteger(zoneIndex) || zoneIndex < 0) return null;
  return zoneIndex;
}

export function capturePlaylistBodyScrollTops(playlistIndices = []) {
  const captured = new Map();
  if (!zonesContainer) return captured;

  const uniqueIndices = new Set();
  playlistIndices.forEach((playlistIndex) => {
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return;
    uniqueIndices.add(playlistIndex);
  });

  uniqueIndices.forEach((playlistIndex) => {
    const body = zonesContainer.querySelector(`.zone[data-zone-index="${playlistIndex}"] .zone-body`);
    if (!(body instanceof HTMLElement)) return;
    captured.set(playlistIndex, body.scrollTop);
  });

  return captured;
}

export function restorePlaylistBodyScrollTops(scrollTopsByPlaylist) {
  if (!zonesContainer) return;
  if (!(scrollTopsByPlaylist instanceof Map) || !scrollTopsByPlaylist.size) return;

  scrollTopsByPlaylist.forEach((scrollTop, playlistIndex) => {
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return;
    if (!Number.isFinite(scrollTop)) return;
    const body = zonesContainer.querySelector(`.zone[data-zone-index="${playlistIndex}"] .zone-body`);
    if (!(body instanceof HTMLElement)) return;
    body.scrollTop = scrollTop;
  });
}

export function resolveRequestedCopyMode(event) {
  if (state.touchCopyDragActive) {
    return state.touchDragMode === 'copy';
  }
  return isCopyDragModifier(event);
}

export function resolveEffectiveDragMode(event, targetZoneIndex = null) {
  const requestedCopy = resolveRequestedCopyMode(event);
  if (!state.touchCopyDragActive) {
    return requestedCopy ? 'copy' : 'move';
  }

  if (!state.dragContext || state.dragContext.sourcePlaylistType !== PLAYLIST_TYPE_FOLDER) {
    return requestedCopy ? 'copy' : 'move';
  }

  const sourceZoneIndex = Number.isInteger(state.dragContext.sourceZoneIndex) ? state.dragContext.sourceZoneIndex : -1;
  const hasTargetZone = Number.isInteger(targetZoneIndex) && targetZoneIndex >= 0;
  const isSameZone = hasTargetZone && sourceZoneIndex >= 0 && sourceZoneIndex === targetZoneIndex;

  if (isSameZone) {
    return requestedCopy ? 'copy' : 'move';
  }

  return 'copy';
}

export function setDropEffectFromEvent(event, targetZoneIndex = null) {
  if (!event || !event.dataTransfer) return;
  const mode = resolveEffectiveDragMode(event, targetZoneIndex);
  event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
}

export function normalizeDragMode(mode) {
  if (mode === 'copy' || mode === 'cancel' || mode === 'delete' || mode === 'next') return mode;
  return 'move';
}

export function applyDragModeBadgeToElement(element, mode) {
  if (!(element instanceof HTMLElement)) return;
  const normalizedMode = normalizeDragMode(mode);
  element.dataset.dragMode = normalizedMode;
  element.classList.add('has-drag-mode');
}

export function clearDragModeBadgeFromElement(element) {
  if (!(element instanceof HTMLElement)) return;
  element.classList.remove('has-drag-mode');
  delete element.dataset.dragMode;
}

export function applyDragModeBadge(mode) {
  const normalizedMode = normalizeDragMode(mode);
  applyDragModeBadgeToElement(state.draggingCard, normalizedMode);
  applyDragModeBadgeToElement(state.dragPreviewCard, normalizedMode);
  applyDragModeBadgeToElement(state.desktopDragGhost, normalizedMode);
}

export function clearDragModeBadge() {
  clearDragModeBadgeFromElement(state.draggingCard);
  clearDragModeBadgeFromElement(state.dragPreviewCard);
  clearDragModeBadgeFromElement(state.desktopDragGhost);
}

export function isActiveCopyDrag(event, targetZoneIndex = null) {
  return resolveEffectiveDragMode(event, targetZoneIndex) === 'copy';
}

export function clearDragPreviewCard() {
  if (!state.dragPreviewCard) return;
  state.dragPreviewCard.remove();
  state.dragPreviewCard = null;
}

export function ensureDragPreviewCard() {
  if (state.dragPreviewCard) return state.dragPreviewCard;
  if (!state.draggingCard) return null;

  const preview = state.draggingCard.cloneNode(true);
  preview.classList.add('drag-copy-preview');
  preview.classList.remove('dragging');
  preview.removeAttribute('draggable');
  const playButton = preview.querySelector('button.play');
  if (playButton) playButton.disabled = true;
  state.dragPreviewCard = preview;
  if (state.draggingCard.classList.contains('has-drag-mode')) {
    applyDragModeBadgeToElement(state.dragPreviewCard, state.draggingCard.dataset.dragMode || 'move');
  }
  return state.dragPreviewCard;
}

export function getEmptyDragImage() {
  if (state.emptyDragImage) return state.emptyDragImage;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  state.emptyDragImage = canvas;
  return state.emptyDragImage;
}

export function clearDesktopDragGhost() {
  if (!state.desktopDragGhost) return;
  state.desktopDragGhost.remove();
  state.desktopDragGhost = null;
}

export function updateDesktopDragGhostPosition(clientX, clientY) {
  if (!state.desktopDragGhost) return;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  state.desktopDragGhost.style.transform = `translate(${clientX - state.desktopDragGhostOffsetX}px, ${clientY - state.desktopDragGhostOffsetY}px)`;
}

export function createDesktopDragGhost(card, clientX, clientY) {
  clearDesktopDragGhost();
  if (!card || !card.isConnected) return;

  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('desktop-drag-ghost');
  ghost.classList.remove('dragging');
  ghost.removeAttribute('draggable');

  const playButton = ghost.querySelector('button.play');
  if (playButton) playButton.disabled = true;

  ghost.style.width = `${rect.width}px`;
  state.desktopDragGhost = ghost;
  document.body.appendChild(ghost);

  if (state.draggingCard && state.draggingCard.classList.contains('has-drag-mode')) {
    applyDragModeBadgeToElement(state.desktopDragGhost, state.draggingCard.dataset.dragMode || 'move');
  }

  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    state.desktopDragGhostOffsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    state.desktopDragGhostOffsetY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    updateDesktopDragGhostPosition(clientX, clientY);
  } else {
    state.desktopDragGhostOffsetX = rect.width / 2;
    state.desktopDragGhostOffsetY = rect.height / 2;
  }
}

export function ensureTrashDropzone() {
  if (state.trashDropzoneEl) return state.trashDropzoneEl;

  const trash = document.createElement('div');
  trash.className = 'drag-trash';
  trash.setAttribute('aria-label', 'Удалить трек');
  trash.innerHTML = '<span class="drag-trash__icon">🗑</span><span class="drag-trash__label">Удалить</span>';
  document.body.appendChild(trash);

  trash.addEventListener('dragover', (event) => {
    if (!state.draggingCard || !state.dragContext) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    trash.classList.add('is-active');
    applyDragModeBadge('delete');
    updateDesktopDragGhostPosition(event.clientX, event.clientY);
  });

  trash.addEventListener('dragleave', () => {
    trash.classList.remove('is-active');
  });

  trash.addEventListener('drop', (event) => {
    if (!state.draggingCard || !state.dragContext) return;
    event.preventDefault();
    event.stopPropagation();
    trash.classList.remove('is-active');
    handleDragDeleteFromContext().catch((err) => {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось удалить трек.');
    });
  });

  state.trashDropzoneEl = trash;
  return state.trashDropzoneEl;
}

export function showTrashDropzone() {
  const trash = ensureTrashDropzone();
  trash.classList.add('is-visible');
  syncQueueNextDropzoneVisibility();
}

export function hideTrashDropzone() {
  if (state.trashDropzoneEl) {
    state.trashDropzoneEl.classList.remove('is-visible', 'is-active');
  }
  stopQueueNextDropzoneCountdownLoop();
  if (state.queueNextDropzoneEl) {
    state.queueNextDropzoneEl.classList.remove('is-visible', 'is-active', 'has-timer');
    const timerEl = state.queueNextDropzoneEl.querySelector('.drag-next__timer');
    if (timerEl instanceof HTMLElement) {
      timerEl.textContent = '';
    }
  }
}

export function isTrashDropzoneTarget(target) {
  if (!state.trashDropzoneEl || !(target instanceof Element)) return false;
  return state.trashDropzoneEl.contains(target);
}

export function isPointOverTrashDropzone(clientX, clientY) {
  if (!state.trashDropzoneEl || !state.trashDropzoneEl.classList.contains('is-visible')) return false;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const rect = state.trashDropzoneEl.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

export function resolveQueueNextPlaybackAnchor() {
  const localTrackFile = state.currentTrack && typeof state.currentTrack.file === 'string' ? state.currentTrack.file.trim() : '';
  if (localTrackFile && state.currentAudio && !state.currentAudio.paused) {
    return {
      file: localTrackFile,
      playlistIndex: _deps.normalizePlaylistTrackIndex(state.currentTrack.playlistIndex),
      playlistPosition: _deps.normalizePlaylistTrackIndex(state.currentTrack.playlistPosition),
    };
  }

  if (!isRemoteLiveMirrorRole()) return null;
  const hostTrackFile = state.hostPlaybackState && typeof state.hostPlaybackState.trackFile === 'string'
    ? state.hostPlaybackState.trackFile.trim()
    : '';
  if (!hostTrackFile || state.hostPlaybackState.paused) return null;
  const hostPlaybackContext = _deps.normalizeTrackPlaybackContext(state.hostPlaybackState);

  return {
    file: hostTrackFile,
    playlistIndex: _deps.normalizePlaylistTrackIndex(hostPlaybackContext.playlistIndex),
    playlistPosition: _deps.normalizePlaylistTrackIndex(hostPlaybackContext.playlistPosition),
  };
}

export function clearQueueNextChainAnchor() {
  state.queueNextChainAnchor = null;
  state.queueNextChainExpiresAt = 0;
}

export function getQueueNextChainRemainingMs() {
  if (!state.queueNextChainAnchor || !Number.isFinite(state.queueNextChainExpiresAt) || state.queueNextChainExpiresAt <= 0) {
    return 0;
  }

  const remainingMs = state.queueNextChainExpiresAt - Date.now();
  if (remainingMs > 0) {
    return remainingMs;
  }

  clearQueueNextChainAnchor();
  return 0;
}

export function setQueueNextChainAnchor(trackContext) {
  if (!trackContext || typeof trackContext.file !== 'string' || !trackContext.file.trim()) {
    clearQueueNextChainAnchor();
    return;
  }

  state.queueNextChainAnchor = {
    file: trackContext.file.trim(),
    playlistIndex: _deps.normalizePlaylistTrackIndex(trackContext.playlistIndex),
    playlistPosition: _deps.normalizePlaylistTrackIndex(trackContext.playlistPosition),
  };
  state.queueNextChainExpiresAt = Date.now() + QUEUE_NEXT_CHAIN_WINDOW_MS;
}

export function resolveQueueNextInsertTargetFromAnchor(anchor, layoutState = state.layout) {
  if (!anchor || typeof anchor.file !== 'string' || !anchor.file.trim()) return null;

  const normalizedLayout = _deps.ensurePlaylists(layoutState);
  const resolution = resolveTrackIndexByContext(normalizedLayout, {
    sourceZoneIndex: _deps.normalizePlaylistTrackIndex(anchor.playlistIndex),
    sourceIndex: _deps.normalizePlaylistTrackIndex(anchor.playlistPosition),
    file: anchor.file.trim(),
  });
  if (resolution.playlistIndex < 0 || resolution.trackIndex < 0) return null;

  const playlist = Array.isArray(normalizedLayout[resolution.playlistIndex])
    ? normalizedLayout[resolution.playlistIndex]
    : [];
  const insertIndex = Math.max(0, Math.min(resolution.trackIndex + 1, playlist.length));
  return {
    playlistIndex: resolution.playlistIndex,
    insertIndex,
  };
}

export function resolveQueueNextChainInsertTarget(layoutState = state.layout) {
  if (!state.queueNextChainAnchor || !Number.isFinite(state.queueNextChainExpiresAt) || state.queueNextChainExpiresAt <= 0) {
    return null;
  }
  if (Date.now() > state.queueNextChainExpiresAt) {
    clearQueueNextChainAnchor();
    return null;
  }

  const target = resolveQueueNextInsertTargetFromAnchor(state.queueNextChainAnchor, layoutState);
  if (!target) {
    clearQueueNextChainAnchor();
    return null;
  }

  state.queueNextChainAnchor.playlistIndex = target.playlistIndex;
  state.queueNextChainAnchor.playlistPosition = Math.max(0, target.insertIndex - 1);
  return target;
}

export function resolveQueueNextInsertTarget(layoutState = state.layout) {
  const playbackAnchor = resolveQueueNextPlaybackAnchor();
  if (!playbackAnchor || !playbackAnchor.file) {
    clearQueueNextChainAnchor();
    return null;
  }

  const chainedTarget = resolveQueueNextChainInsertTarget(layoutState);
  if (chainedTarget) return chainedTarget;
  return resolveQueueNextInsertTargetFromAnchor(playbackAnchor, layoutState);
}

export function ensureQueueNextDropzone() {
  if (state.queueNextDropzoneEl) return state.queueNextDropzoneEl;

  const dropzone = document.createElement('div');
  dropzone.className = 'drag-next';
  dropzone.setAttribute('aria-label', 'Поставить следующим');
  dropzone.innerHTML =
    '<span class="drag-next__icon">↪</span><span class="drag-next__label">воспроизвести следующим</span><span class="drag-next__timer"></span>';
  document.body.appendChild(dropzone);

  dropzone.addEventListener('dragover', (event) => {
    if (!state.draggingCard || !state.dragContext) return;
    const queueTarget = resolveQueueNextInsertTarget(state.layout);
    if (!queueTarget) return;
    event.preventDefault();
    const mode = resolveEffectiveDragMode(event, queueTarget.playlistIndex);
    event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
    dropzone.classList.add('is-active');
    applyDragModeBadge('next');
    updateDesktopDragGhostPosition(event.clientX, event.clientY);
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('is-active');
  });

  dropzone.addEventListener('drop', (event) => {
    if (!state.draggingCard || !state.dragContext) return;
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove('is-active');
    handleDragQueueNextFromContext(event).catch((err) => {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось поставить трек следующим.');
    });
  });

  state.queueNextDropzoneEl = dropzone;
  return state.queueNextDropzoneEl;
}

export function updateQueueNextDropzoneCountdownUi() {
  if (!state.queueNextDropzoneEl) return;
  const labelEl = state.queueNextDropzoneEl.querySelector('.drag-next__label');
  const timerEl = state.queueNextDropzoneEl.querySelector('.drag-next__timer');
  if (!(timerEl instanceof HTMLElement)) return;

  const remainingMs = getQueueNextChainRemainingMs();
  if (remainingMs <= 0) {
    state.queueNextDropzoneEl.classList.remove('has-timer');
    timerEl.textContent = '';
    if (labelEl instanceof HTMLElement) {
      labelEl.textContent = 'воспроизвести следующим';
    }
    return;
  }

  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  state.queueNextDropzoneEl.classList.add('has-timer');
  if (labelEl instanceof HTMLElement) {
    labelEl.textContent = 'Добавить в стек';
  }
  timerEl.textContent = `${remainingSeconds}s`;
}

export function stopQueueNextDropzoneCountdownLoop() {
  if (state.queueNextCountdownTimer === null) return;
  clearInterval(state.queueNextCountdownTimer);
  state.queueNextCountdownTimer = null;
}

export function startQueueNextDropzoneCountdownLoop() {
  if (state.queueNextCountdownTimer !== null) return;
  updateQueueNextDropzoneCountdownUi();
  state.queueNextCountdownTimer = setInterval(() => {
    if (!state.queueNextDropzoneEl || !state.queueNextDropzoneEl.classList.contains('is-visible')) {
      stopQueueNextDropzoneCountdownLoop();
      return;
    }
    updateQueueNextDropzoneCountdownUi();
  }, 200);
}

export function syncQueueNextDropzoneVisibility() {
  const dragActive = Boolean(state.draggingCard && state.dragContext);
  if (!dragActive && !state.queueNextDropzoneEl) return;
  const dropzone = ensureQueueNextDropzone();
  const shouldShow = dragActive && Boolean(resolveQueueNextInsertTarget(state.layout));
  if (shouldShow) {
    dropzone.classList.add('is-visible');
    updateQueueNextDropzoneCountdownUi();
    if (dropzone.classList.contains('has-timer')) {
      startQueueNextDropzoneCountdownLoop();
    } else {
      stopQueueNextDropzoneCountdownLoop();
    }
    return;
  }
  stopQueueNextDropzoneCountdownLoop();
  dropzone.classList.remove('is-visible', 'is-active', 'has-timer');
  const timerEl = dropzone.querySelector('.drag-next__timer');
  if (timerEl instanceof HTMLElement) {
    timerEl.textContent = '';
  }
}

export function isQueueNextDropzoneTarget(target) {
  if (!state.queueNextDropzoneEl || !(target instanceof Element)) return false;
  return state.queueNextDropzoneEl.contains(target);
}

export function isPointOverQueueNextDropzone(clientX, clientY) {
  if (!state.queueNextDropzoneEl || !state.queueNextDropzoneEl.classList.contains('is-visible')) return false;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const rect = state.queueNextDropzoneEl.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

export function handleGlobalDragOver(event) {
  if (!state.draggingCard || !event.dataTransfer) return;
  updateDesktopDragGhostPosition(event.clientX, event.clientY);
  const target = event.target instanceof Element ? event.target : null;
  if (isQueueNextDropzoneTarget(target)) {
    const queueTarget = resolveQueueNextInsertTarget(state.layout);
    if (queueTarget) {
      const mode = resolveEffectiveDragMode(event, queueTarget.playlistIndex);
      applyDragModeBadge('next');
      event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
      return;
    }
  }
  if (isTrashDropzoneTarget(target)) {
    applyDragModeBadge('delete');
    event.dataTransfer.dropEffect = 'move';
    return;
  }
  if (target && zonesContainer.contains(target)) {
    const targetZoneIndex = getZoneIndexFromElement(target);
    const mode = resolveEffectiveDragMode(event, targetZoneIndex);
    applyDragModeBadge(mode);
    event.dataTransfer.dropEffect = mode === 'copy' ? 'copy' : 'move';
    return;
  }
  applyDragModeBadge('cancel');
  event.dataTransfer.dropEffect = 'none';
}

export function removeDesktopDragHoldListeners() {
  window.removeEventListener('pointermove', onDesktopDragHoldPointerMove, true);
  window.removeEventListener('pointerup', onDesktopDragHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onDesktopDragHoldPointerEnd, true);
}

export function clearDesktopDragHold() {
  if (state.desktopDragHoldTimer !== null) {
    clearTimeout(state.desktopDragHoldTimer);
    state.desktopDragHoldTimer = null;
  }
  state.desktopDragHoldPointerId = null;
  state.desktopDragHoldStartedAt = 0;
  state.desktopDragHoldStartX = 0;
  state.desktopDragHoldStartY = 0;
  state.desktopDragHoldCard = null;
  state.desktopDragHoldReady = false;
  removeDesktopDragHoldListeners();
}

export function onDesktopDragHoldPointerMove(event) {
  if (state.desktopDragHoldPointerId === null || event.pointerId !== state.desktopDragHoldPointerId) return;
  if (state.desktopDragHoldReady) return;

  const deltaX = event.clientX - state.desktopDragHoldStartX;
  const deltaY = event.clientY - state.desktopDragHoldStartY;
  if (Math.hypot(deltaX, deltaY) <= DESKTOP_TRACK_DRAG_CANCEL_MOVE_PX) return;

  clearDesktopDragHold();
}

export function onDesktopDragHoldPointerEnd(event) {
  if (state.desktopDragHoldPointerId === null || event.pointerId !== state.desktopDragHoldPointerId) return;
  clearDesktopDragHold();
}

export function startDesktopDragHold(card, event) {
  if (!card || !event) return;
  clearDesktopDragHold();

  state.desktopDragHoldPointerId = Number.isInteger(event.pointerId) ? event.pointerId : null;
  state.desktopDragHoldStartedAt = Date.now();
  state.desktopDragHoldStartX = event.clientX;
  state.desktopDragHoldStartY = event.clientY;
  state.desktopDragHoldCard = card;
  state.desktopDragHoldReady = false;

  if (state.desktopDragHoldPointerId !== null) {
    window.addEventListener('pointermove', onDesktopDragHoldPointerMove, true);
    window.addEventListener('pointerup', onDesktopDragHoldPointerEnd, true);
    window.addEventListener('pointercancel', onDesktopDragHoldPointerEnd, true);
  }

  state.desktopDragHoldTimer = setTimeout(() => {
    state.desktopDragHoldTimer = null;
    if (!state.desktopDragHoldCard || !state.desktopDragHoldCard.isConnected) {
      clearDesktopDragHold();
      return;
    }
    state.desktopDragHoldReady = true;
  }, DESKTOP_TRACK_DRAG_HOLD_MS);
}

export function isDesktopDragHoldReadyForPointer(pointerId) {
  return (
    state.desktopDragHoldReady &&
    state.desktopDragHoldPointerId !== null &&
    pointerId === state.desktopDragHoldPointerId &&
    !!state.desktopDragHoldCard
  );
}

export function isDesktopDragHoldReadyForCard(card) {
  if (!card || state.desktopDragHoldCard !== card) return false;
  if (state.desktopDragHoldReady) return true;
  if (!state.desktopDragHoldStartedAt) return false;
  return Date.now() - state.desktopDragHoldStartedAt >= DESKTOP_TRACK_DRAG_HOLD_MS;
}

export function attachDragHandlers(card) {
  card.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('button, input, textarea, select, a, .track-order')) return;

    if (!_deps.isTouchPointerEvent(event)) {
      if (event.button !== undefined && event.button !== 0) return;
      startDesktopDragHold(card, event);
      return;
    }

    if (_deps.isTrackCardDragBlocked(card)) {
      setStatus('Активный трек нельзя перемещать или копировать.');
      return;
    }

    _deps.startTouchCopyHold(card, event);
  });

  card.addEventListener('dragstart', (e) => {
    if (_deps.isLikelyTouchNativeDragEvent(e)) {
      e.preventDefault();
      return;
    }

    if (!isDesktopDragHoldReadyForCard(card)) {
      e.preventDefault();
      return;
    }
    clearDesktopDragHold();
    if (state.zonesPanActive) {
      _deps.cleanupZonesPanInteraction();
    }
    _deps.stopZonesPanMomentum();

    if (_deps.isTrackCardDragBlocked(card)) {
      e.preventDefault();
      setStatus('Активный трек нельзя перемещать или копировать.');
      return;
    }

    const sourceZone = card.closest('.zone');
    const sourceZoneIndex = sourceZone ? Number.parseInt(sourceZone.dataset.zoneIndex || '', 10) : -1;
    const sourceBody = card.parentElement;
    const sourceIndexFromDataset = Number.parseInt(card.dataset.playlistPosition || '', 10);
    const sourceIndex = Number.isInteger(sourceIndexFromDataset)
      ? sourceIndexFromDataset
      : sourceBody
        ? Array.from(sourceBody.querySelectorAll('.track-card')).indexOf(card)
        : -1;
    const sourcePlaylistType = _deps.isFolderPlaylistIndex(sourceZoneIndex) ? PLAYLIST_TYPE_FOLDER : PLAYLIST_TYPE_MANUAL;

    state.dragContext = {
      file: card.dataset.file || '',
      sourceZoneIndex: Number.isInteger(sourceZoneIndex) ? sourceZoneIndex : -1,
      sourceIndex,
      sourcePlaylistType,
      snapshotLayout: _deps.cloneLayoutState(state.layout),
    };

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', card.dataset.file);
    setDropEffectFromEvent(e);
    createDesktopDragGhost(card, e.clientX, e.clientY);
    e.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);
    showTrashDropzone();
    applyDragModeBadge(isActiveCopyDrag(e) ? 'copy' : 'move');
    card.classList.add('dragging');
    state.draggingCard = card;
    state.dragDropHandled = false;
  });

  card.addEventListener('dragend', () => {
    clearDesktopDragHold();
    hideTrashDropzone();
    clearDesktopDragGhost();
    clearDragModeBadge();
    clearDragPreviewCard();
    card.classList.remove('dragging');
    if (!state.dragDropHandled) {
      _deps.renderZones();
    }
    state.draggingCard = null;
    state.dragContext = null;
    state.dragDropHandled = false;
    document.querySelectorAll('.zone.drag-over').forEach((zone) => zone.classList.remove('drag-over'));
  });
}

export function getDragInsertBefore(container, event, { includeDraggingCard = false } = {}) {
  const selector = includeDraggingCard
    ? '.track-card:not(.drag-copy-preview)'
    : '.track-card:not(.dragging):not(.drag-copy-preview)';
  const draggableCards = Array.from(container.querySelectorAll(selector));
  const cursorY = event.clientY;
  return draggableCards.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = cursorY - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null },
  ).element;
}

export function applyDragPreview(zoneBody, event) {
  if (!state.draggingCard || !zoneBody) return;
  event.preventDefault();
  const zone = zoneBody.closest('.zone');
  const targetZoneIndex = zone ? Number.parseInt(zone.dataset.zoneIndex || '', 10) : NaN;
  const normalizedTargetZoneIndex = Number.isInteger(targetZoneIndex) && targetZoneIndex >= 0 ? targetZoneIndex : null;
  const mode = resolveEffectiveDragMode(event, normalizedTargetZoneIndex);

  setDropEffectFromEvent(event, normalizedTargetZoneIndex);
  updateDesktopDragGhostPosition(event.clientX, event.clientY);
  applyDragModeBadge(mode);

  if (mode === 'copy') {
    const previewCard = ensureDragPreviewCard();
    if (!previewCard) return;
    const beforeElement = getDragInsertBefore(zoneBody, event, { includeDraggingCard: true });
    if (beforeElement) {
      zoneBody.insertBefore(previewCard, beforeElement);
    } else {
      zoneBody.appendChild(previewCard);
    }
    return;
  }

  clearDragPreviewCard();
  const beforeElement = getDragInsertBefore(zoneBody, event, { includeDraggingCard: false });
  if (beforeElement) {
    zoneBody.insertBefore(state.draggingCard, beforeElement);
  } else {
    zoneBody.appendChild(state.draggingCard);
  }
}

export function parsePlaylistPositionFromCard(card) {
  if (!(card instanceof HTMLElement)) return null;
  const playlistPosition = Number.parseInt(card.dataset.playlistPosition || '', 10);
  if (!Number.isInteger(playlistPosition) || playlistPosition < 0) return null;
  return playlistPosition;
}

export function getAdjacentTrackCardForDrop(referenceCard, direction) {
  if (!(referenceCard instanceof HTMLElement)) return null;
  const searchDirection = direction === 'previous' ? 'previousElementSibling' : 'nextElementSibling';
  let cursor = referenceCard;

  while (cursor) {
    cursor = cursor[searchDirection];
    if (!(cursor instanceof HTMLElement)) return null;
    if (!cursor.classList.contains('track-card')) continue;
    if (cursor === state.draggingCard || cursor === state.dragPreviewCard) continue;
    return cursor;
  }

  return null;
}

export function resolveDropInsertIndex(targetBody, targetZoneIndex, layoutState) {
  const normalizedLayout = _deps.ensurePlaylists(layoutState);
  const targetPlaylist =
    Number.isInteger(targetZoneIndex) && targetZoneIndex >= 0 && targetZoneIndex < normalizedLayout.length
      ? normalizedLayout[targetZoneIndex]
      : [];
  const fallbackIndex = Array.isArray(targetPlaylist) ? targetPlaylist.length : 0;

  if (!(targetBody instanceof HTMLElement)) return fallbackIndex;

  const marker =
    state.dragPreviewCard && state.dragPreviewCard.parentElement === targetBody
      ? state.dragPreviewCard
      : state.draggingCard && state.draggingCard.parentElement === targetBody
        ? state.draggingCard
        : null;

  if (!marker) {
    return fallbackIndex;
  }

  const previousCard = getAdjacentTrackCardForDrop(marker, 'previous');
  const nextCard = getAdjacentTrackCardForDrop(marker, 'next');
  const previousPosition = parsePlaylistPositionFromCard(previousCard);
  const nextPosition = parsePlaylistPositionFromCard(nextCard);

  if (Number.isInteger(nextPosition)) {
    return Math.max(0, Math.min(nextPosition, fallbackIndex));
  }

  if (Number.isInteger(previousPosition)) {
    return Math.max(0, Math.min(previousPosition + 1, fallbackIndex));
  }

  return fallbackIndex;
}

export function buildTrackOccurrenceMap(layoutState) {
  const occurrence = new Map();
  _deps.ensurePlaylists(layoutState).forEach((playlist) => {
    playlist.forEach((file) => {
      if (typeof file !== 'string' || !file) return;
      occurrence.set(file, (occurrence.get(file) || 0) + 1);
    });
  });
  return occurrence;
}

export function getTrackDeleteEligibility(layoutState, playlistIndex, trackIndex) {
  const normalizedLayout = _deps.ensurePlaylists(layoutState);
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= normalizedLayout.length) {
    return { canDelete: false, reason: 'Трек не найден.' };
  }

  const playlist = normalizedLayout[playlistIndex];
  if (!Array.isArray(playlist) || !Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= playlist.length) {
    return { canDelete: false, reason: 'Трек не найден.' };
  }

  const file = playlist[trackIndex];
  if (typeof file !== 'string' || !file) {
    return { canDelete: false, reason: 'Трек не найден.' };
  }

  const occurrence = buildTrackOccurrenceMap(normalizedLayout);
  if ((occurrence.get(file) || 0) > 1) {
    return { canDelete: true, reason: '', file };
  }

  return {
    canDelete: false,
    reason: 'Нельзя удалить единственный экземпляр трека. Сначала создайте его копию.',
    file,
  };
}

export function resolveTrackIndexByContext(layoutState, context) {
  if (!context || typeof context !== 'object') return { playlistIndex: -1, trackIndex: -1, file: '' };

  const normalizedLayout = _deps.ensurePlaylists(layoutState);
  const playlistIndex = Number.isInteger(context.sourceZoneIndex) ? context.sourceZoneIndex : -1;
  if (playlistIndex < 0 || playlistIndex >= normalizedLayout.length) {
    return { playlistIndex: -1, trackIndex: -1, file: context.file || '' };
  }

  const playlist = normalizedLayout[playlistIndex];
  const expectedFile = typeof context.file === 'string' ? context.file : '';
  let trackIndex = Number.isInteger(context.sourceIndex) ? context.sourceIndex : -1;

  if (trackIndex < 0 || trackIndex >= playlist.length || playlist[trackIndex] !== expectedFile) {
    trackIndex = expectedFile ? playlist.indexOf(expectedFile) : -1;
  }

  return {
    playlistIndex,
    trackIndex,
    file: expectedFile,
  };
}

export async function handleDragDeleteFromContext() {
  if (isHostRole()) {
    try {
      return await dispatchHostTrackMutationCommand(TRACK_MUTATION_DELETE_FROM_CONTEXT, () => handleDragDeleteFromContextLocally());
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось удалить трек.');
      return false;
    }
  }
  return handleDragDeleteFromContextLocally();
}

async function handleDragDeleteFromContextLocally() {
  if (!state.dragContext) return false;

  const snapshotLayout = _deps.cloneLayoutState(state.dragContext.snapshotLayout);
  const snapshotNames = _deps.normalizePlaylistNames(state.playlistNames, snapshotLayout.length);
  const snapshotMeta = _deps.normalizePlaylistMeta(state.playlistMeta, snapshotLayout.length);
  const snapshotDap = _deps.normalizeDapConfig(state.dapConfig, snapshotLayout.length, state.dapConfig);
  const snapshotAutoplay = _deps.normalizePlaylistAutoplayWithDap(state.playlistAutoplay, snapshotDap, snapshotLayout.length);
  const snapshotDsp = _deps.normalizePlaylistDspFlags(state.playlistDsp, snapshotAutoplay, snapshotLayout.length);

  const resolution = resolveTrackIndexByContext(snapshotLayout, state.dragContext);
  const eligibility = getTrackDeleteEligibility(snapshotLayout, resolution.playlistIndex, resolution.trackIndex);
  if (!eligibility.canDelete) {
    setStatus(`Удаление недоступно: ${eligibility.reason}`);
    return false;
  }

  snapshotLayout[resolution.playlistIndex].splice(resolution.trackIndex, 1);

  const previousLayout = _deps.cloneLayoutState(state.layout);
  const previousNames = state.playlistNames.slice();
  const previousMeta = _deps.clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...state.dapConfig };

  state.layout = _deps.ensurePlaylists(snapshotLayout);
  state.playlistNames = _deps.normalizePlaylistNames(snapshotNames, state.layout.length);
  state.playlistMeta = _deps.normalizePlaylistMeta(snapshotMeta, state.layout.length);
  state.dapConfig = _deps.normalizeDapConfig(snapshotDap, state.layout.length, snapshotDap);
  state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(snapshotAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = _deps.normalizePlaylistDspFlags(snapshotDsp, state.playlistAutoplay, state.layout.length);
  state.dragDropHandled = true;
  clearDragModeBadge();
  clearDragPreviewCard();
  hideTrashDropzone();
  _deps.renderZones();

  try {
    await _deps.pushSharedLayout();
    setStatus('Трек удален через корзину и синхронизирован.');
    return true;
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = previousNames;
    state.playlistMeta = previousMeta;
    state.dapConfig = _deps.normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = _deps.normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    _deps.renderZones();
    setStatus('Не удалось синхронизировать удаление трека.');
    return false;
  }
}

export async function handleDragQueueNextFromContext(event = null) {
  if (isHostRole()) {
    try {
      return await dispatchHostTrackMutationCommand(
        TRACK_MUTATION_QUEUE_NEXT_FROM_CONTEXT,
        () => handleDragQueueNextFromContextLocally(event),
      );
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось поставить трек следующим.');
      return false;
    }
  }
  return handleDragQueueNextFromContextLocally(event);
}

async function handleDragQueueNextFromContextLocally(event = null) {
  if (!state.dragContext) return false;

  const snapshotLayout = _deps.cloneLayoutState(state.dragContext.snapshotLayout);
  const snapshotNames = _deps.normalizePlaylistNames(state.playlistNames, snapshotLayout.length);
  const snapshotMeta = _deps.normalizePlaylistMeta(state.playlistMeta, snapshotLayout.length);
  const snapshotDap = _deps.normalizeDapConfig(state.dapConfig, snapshotLayout.length, state.dapConfig);
  const snapshotAutoplay = _deps.normalizePlaylistAutoplayWithDap(state.playlistAutoplay, snapshotDap, snapshotLayout.length);
  const snapshotDsp = _deps.normalizePlaylistDspFlags(state.playlistDsp, snapshotAutoplay, snapshotLayout.length);

  const queueTarget = resolveQueueNextInsertTarget(snapshotLayout);
  if (!queueTarget) {
    setStatus('Нет активного воспроизведения. Режим "Следующий" недоступен.');
    return false;
  }

  const targetZoneIndex = queueTarget.playlistIndex;
  if (!Number.isInteger(targetZoneIndex) || targetZoneIndex < 0 || !Array.isArray(snapshotLayout[targetZoneIndex])) {
    setStatus('Не удалось определить целевой плей-лист для режима "Следующий".');
    return false;
  }

  const isCopyDrop = isActiveCopyDrag(event, targetZoneIndex);
  let insertIndex = queueTarget.insertIndex;
  let queuedTrackAnchor = null;

  if (isCopyDrop) {
    if (!state.dragContext.file) {
      setStatus('Не удалось определить трек для копирования.');
      return false;
    }
    insertIndex = Math.max(0, Math.min(insertIndex, snapshotLayout[targetZoneIndex].length));
    snapshotLayout[targetZoneIndex].splice(insertIndex, 0, state.dragContext.file);
    queuedTrackAnchor = {
      file: state.dragContext.file,
      playlistIndex: targetZoneIndex,
      playlistPosition: insertIndex,
    };
  } else {
    const resolution = resolveTrackIndexByContext(snapshotLayout, state.dragContext);
    if (resolution.playlistIndex < 0 || resolution.trackIndex < 0) {
      setStatus('Не удалось определить исходную позицию трека.');
      return false;
    }

    const sourcePlaylist = snapshotLayout[resolution.playlistIndex];
    if (!Array.isArray(sourcePlaylist)) {
      setStatus('Не удалось прочитать исходный плей-лист.');
      return false;
    }

    const [removedFile] = sourcePlaylist.splice(resolution.trackIndex, 1);
    const movedFile = typeof removedFile === 'string' && removedFile ? removedFile : resolution.file;
    if (typeof movedFile !== 'string' || !movedFile) {
      setStatus('Не удалось подготовить трек для переноса.');
      return false;
    }

    if (resolution.playlistIndex === targetZoneIndex && resolution.trackIndex < insertIndex) {
      insertIndex -= 1;
    }

    insertIndex = Math.max(0, Math.min(insertIndex, snapshotLayout[targetZoneIndex].length));
    snapshotLayout[targetZoneIndex].splice(insertIndex, 0, movedFile);
    queuedTrackAnchor = {
      file: movedFile,
      playlistIndex: targetZoneIndex,
      playlistPosition: insertIndex,
    };
  }

  const previousLayout = _deps.cloneLayoutState(state.layout);
  const previousNames = state.playlistNames.slice();
  const previousMeta = _deps.clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...state.dapConfig };
  const undoSnapshot = _deps.createTrackRelocationUndoSnapshot({
    layoutState: previousLayout,
    namesState: previousNames,
    metaState: previousMeta,
    autoplayState: previousAutoplay,
    dspState: previousDsp,
    dapState: previousDap,
  });

  state.layout = _deps.ensurePlaylists(snapshotLayout);
  state.playlistNames = _deps.normalizePlaylistNames(snapshotNames, state.layout.length);
  state.playlistMeta = _deps.normalizePlaylistMeta(snapshotMeta, state.layout.length);
  state.dapConfig = _deps.normalizeDapConfig(snapshotDap, state.layout.length, snapshotDap);
  state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(snapshotAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = _deps.normalizePlaylistDspFlags(snapshotDsp, state.playlistAutoplay, state.layout.length);
  state.dragDropHandled = true;
  hideTrashDropzone();
  clearDragModeBadge();
  clearDragPreviewCard();
  _deps.renderZones();
  const undoActionId = queuedTrackAnchor ? _deps.registerTrackRelocationUndoAction(queuedTrackAnchor, undoSnapshot) : null;

  try {
    await _deps.pushSharedLayout();
    setQueueNextChainAnchor(queuedTrackAnchor);
    setStatus(isCopyDrop ? 'Копия трека поставлена следующей и синхронизирована.' : 'Трек поставлен следующим и синхронизирован.');
    return true;
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = previousNames;
    state.playlistMeta = previousMeta;
    state.dapConfig = _deps.normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = _deps.normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    _deps.renderZones();
    if (undoActionId) {
      _deps.clearTrackRelocationUndoAction(undoActionId);
    } else if (queuedTrackAnchor) {
      _deps.clearTrackRelocationHighlight(queuedTrackAnchor);
    }
    setStatus(isCopyDrop ? 'Не удалось синхронизировать "следующую" копию трека.' : 'Не удалось синхронизировать трек как следующий.');
    return false;
  }
}

export async function handleDrop(event, targetZoneIndex) {
  if (isHostRole()) {
    try {
      return await dispatchHostTrackMutationCommand(
        TRACK_MUTATION_DROP,
        () => handleDropLocally(event, targetZoneIndex),
      );
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : 'Не удалось переместить трек.');
      return false;
    }
  }
  return handleDropLocally(event, targetZoneIndex);
}

async function handleDropLocally(event, targetZoneIndex) {
  event.preventDefault();
  if (!state.draggingCard || !state.dragContext) {
    hideTrashDropzone();
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }
  if (!Number.isInteger(targetZoneIndex) || targetZoneIndex < 0) {
    hideTrashDropzone();
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }

  const targetZone = event.currentTarget;
  if (!targetZone) {
    hideTrashDropzone();
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }
  targetZone.classList.remove('drag-over');
  state.dragDropHandled = true;

  const previousLayout = _deps.cloneLayoutState(state.layout);
  const previousNames = state.playlistNames.slice();
  const previousMeta = _deps.clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...state.dapConfig };
  const undoSnapshot = _deps.createTrackRelocationUndoSnapshot({
    layoutState: previousLayout,
    namesState: previousNames,
    metaState: previousMeta,
    autoplayState: previousAutoplay,
    dspState: previousDsp,
    dapState: previousDap,
  });
  const sourceZoneIndex = Number.isInteger(state.dragContext.sourceZoneIndex) ? state.dragContext.sourceZoneIndex : null;
  const preservedScrollTops = capturePlaylistBodyScrollTops([sourceZoneIndex, targetZoneIndex]);
  const isCopyDrop = isActiveCopyDrag(event, targetZoneIndex);
  const targetBody = targetZone.querySelector('.zone-body');
  let relocatedTrackContext = null;

  let nextLayout = _deps.cloneLayoutState(state.dragContext.snapshotLayout);
  if (!Array.isArray(nextLayout[targetZoneIndex])) {
    hideTrashDropzone();
    clearDragModeBadge();
    clearDragPreviewCard();
    return;
  }

  if (isCopyDrop) {
    if (!state.dragContext.file) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }
    let insertIndex = resolveDropInsertIndex(targetBody, targetZoneIndex, nextLayout);
    insertIndex = Math.max(0, Math.min(insertIndex, nextLayout[targetZoneIndex].length));
    nextLayout[targetZoneIndex].splice(insertIndex, 0, state.dragContext.file);
    relocatedTrackContext = {
      file: state.dragContext.file,
      playlistIndex: targetZoneIndex,
      playlistPosition: insertIndex,
    };
  } else {
    clearDragPreviewCard();
    const resolution = resolveTrackIndexByContext(nextLayout, state.dragContext);
    if (resolution.playlistIndex < 0 || resolution.trackIndex < 0) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }

    const sourcePlaylist = nextLayout[resolution.playlistIndex];
    if (!Array.isArray(sourcePlaylist)) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }

    let insertIndex = resolveDropInsertIndex(targetBody, targetZoneIndex, nextLayout);
    const [removedFile] = sourcePlaylist.splice(resolution.trackIndex, 1);
    const movedFile = typeof removedFile === 'string' && removedFile ? removedFile : resolution.file;
    if (typeof movedFile !== 'string' || !movedFile) {
      hideTrashDropzone();
      clearDragModeBadge();
      clearDragPreviewCard();
      return;
    }

    if (resolution.playlistIndex === targetZoneIndex && resolution.trackIndex < insertIndex) {
      insertIndex -= 1;
    }

    insertIndex = Math.max(0, Math.min(insertIndex, nextLayout[targetZoneIndex].length));
    nextLayout[targetZoneIndex].splice(insertIndex, 0, movedFile);
    relocatedTrackContext = {
      file: movedFile,
      playlistIndex: targetZoneIndex,
      playlistPosition: insertIndex,
    };
  }

  hideTrashDropzone();
  clearDragModeBadge();
  clearDragPreviewCard();
  state.layout = _deps.ensurePlaylists(nextLayout);
  state.playlistNames = _deps.normalizePlaylistNames(previousNames, state.layout.length);
  state.playlistMeta = _deps.normalizePlaylistMeta(previousMeta, state.layout.length);
  state.dapConfig = _deps.normalizeDapConfig(previousDap, state.layout.length, previousDap);
  state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = _deps.normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
  _deps.renderZones();
  restorePlaylistBodyScrollTops(preservedScrollTops);
  const undoActionId = relocatedTrackContext
    ? _deps.registerTrackRelocationUndoAction(relocatedTrackContext, undoSnapshot)
    : null;
  try {
    await _deps.pushSharedLayout();
    setStatus(isCopyDrop ? 'Трек продублирован и синхронизирован.' : 'Плей-листы обновлены и синхронизированы.');
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = _deps.normalizePlaylistNames(previousNames, state.layout.length);
    state.playlistMeta = _deps.normalizePlaylistMeta(previousMeta, state.layout.length);
    state.dapConfig = _deps.normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = _deps.normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    _deps.renderZones();
    restorePlaylistBodyScrollTops(preservedScrollTops);
    if (undoActionId) {
      _deps.clearTrackRelocationUndoAction(undoActionId);
    } else if (relocatedTrackContext) {
      _deps.clearTrackRelocationHighlight(relocatedTrackContext);
    }
    setStatus(isCopyDrop ? 'Не удалось синхронизировать копирование трека.' : 'Не удалось синхронизировать плей-листы.');
  }
}
