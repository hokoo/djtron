// public/modules/touch.js — touch interactions, zones pan, playlist reorder

import { COLLAPSED_PLAYLIST_TAP_MAX_DURATION_MS, COLLAPSED_PLAYLIST_TAP_MOVE_TOLERANCE_PX, COLLAPSED_PLAYLIST_TRIPLE_TAP_DISTANCE_PX, COLLAPSED_PLAYLIST_TRIPLE_TAP_WINDOW_MS, PLAYLIST_COLLAPSE_HOLD_MS, PLAYLIST_COLLAPSE_POINTER_MOVE_TOLERANCE_PX, PLAYLIST_REORDER_HOLD_MS, PLAYLIST_REORDER_POINTER_MOVE_TOLERANCE_PX, PLAYLIST_TYPE_FOLDER, PLAYLIST_TYPE_MANUAL, ROLE_HOST, TOUCH_COPY_HOLD_MS, TOUCH_DRAG_ACTIVATION_DELAY_MS, TOUCH_DRAG_COMMIT_PX, TOUCH_DRAG_EDGE_SCROLL_MAX_SPEED_PX_PER_FRAME, TOUCH_DRAG_EDGE_SCROLL_MIN_SPEED_PX_PER_FRAME, TOUCH_DRAG_EDGE_SCROLL_THRESHOLD_PX, TOUCH_DRAG_START_MOVE_PX, TOUCH_NATIVE_DRAG_BLOCK_WINDOW_MS, ZONES_PAN_DRAG_THRESHOLD_PX, ZONES_PAN_TOUCH_GAIN, ZONES_PAN_TOUCH_MOMENTUM_DECAY_PER_FRAME, ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS, ZONES_PAN_TOUCH_MOMENTUM_STOP_SPEED_PX_PER_MS, ZONES_TWO_FINGER_PAN_TOUCH_GAIN, ZONES_WHEEL_SMOOTH_EASE, ZONES_WHEEL_SMOOTH_MIN_DELTA_PX, state } from './state.js';
import { applyLiveVolumeToCurrentAudio } from './audio.js';
import { isHostRole } from './roles.js';
import { isDapTrackContext, updateDapSettingsUi } from './ui/dap.js';
import { hideCollapsedPlaylistsOverlay,
  setStatus, showCollapsedPlaylistsHint, showCollapsedPlaylistsOverlay
} from './ui/status.js';
import { PlaybackCommandBus } from '/shared/playback/index.js';

const _deps = {};
const PLAYLIST_REORDER_COMMAND = 'playlist-reorder';

const hostPlaylistReorderCommandBus = new PlaybackCommandBus({
  authorize: ({ sourceRole }) =>
    sourceRole === ROLE_HOST
      ? { allowed: true }
      : { allowed: false, reason: 'ACCESS_DENIED', message: 'Только хост может менять порядок плей-листов.' },
  execute: async (payload) => {
    if (!payload || typeof payload.run !== 'function') {
      throw new Error('Некорректная команда перестановки плей-листов.');
    }
    await payload.run();
  },
});

async function dispatchHostPlaylistReorderCommand(run) {
  let runResult;
  const result = await hostPlaylistReorderCommandBus.dispatch(
    {
      sourceRole: ROLE_HOST,
      commandType: PLAYLIST_REORDER_COMMAND,
      target: 'self',
    },
    {
      run: async () => {
        runResult = await run();
      },
    },
  );
  if (!result.ok) {
    throw new Error(result.message || 'Команда перестановки плей-листов отклонена.');
  }
  return runResult;
}

export function setTouchDeps(d) {
  Object.assign(_deps, d);
}

export function isTouchPointerEvent(event) {
  if (!event) return false;
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

export function isLikelyTouchNativeDragEvent(event) {
  if (!event) return false;
  if (event.sourceCapabilities && event.sourceCapabilities.firesTouchEvents) {
    return true;
  }
  return Date.now() - state.lastTouchPointerDownAt < TOUCH_NATIVE_DRAG_BLOCK_WINDOW_MS;
}

export function removeTouchHoldListeners() {
  window.removeEventListener('pointermove', onTouchHoldPointerMove, true);
  window.removeEventListener('pointerup', onTouchHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onTouchHoldPointerEnd, true);
}

export function clearTouchCopyHold() {
  const holdCard = state.touchHoldCard;
  if (holdCard) {
    holdCard.classList.remove('touch-hold-copy');
  }
  if (holdCard && state.touchHoldPointerId !== null && typeof holdCard.releasePointerCapture === 'function') {
    try {
      if (holdCard.hasPointerCapture && holdCard.hasPointerCapture(state.touchHoldPointerId)) {
        holdCard.releasePointerCapture(state.touchHoldPointerId);
      }
    } catch (err) {
      // ignore pointer capture release errors from browsers that do not fully support it
    }
  }

  if (state.touchHoldTimer !== null) {
    clearTimeout(state.touchHoldTimer);
    state.touchHoldTimer = null;
  }
  state.touchHoldPointerId = null;
  state.touchHoldStartedAt = 0;
  state.touchHoldCard = null;
  removeTouchHoldListeners();
}

export function onTouchHoldPointerMove(event) {
  if (state.touchHoldPointerId === null || event.pointerId !== state.touchHoldPointerId) return;
  const deltaX = event.clientX - state.touchHoldStartX;
  const deltaY = event.clientY - state.touchHoldStartY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= TOUCH_DRAG_START_MOVE_PX) return;

  const elapsed = Date.now() - state.touchHoldStartedAt;
  if (elapsed < TOUCH_DRAG_ACTIVATION_DELAY_MS) {
    // Treat early movement as a regular scroll gesture, not as drag.
    clearTouchCopyHold();
    return;
  }

  const heldCard = state.touchHoldCard;
  const pointerId = state.touchHoldPointerId;
  clearTouchCopyHold();
  if (!heldCard || pointerId === null) return;
  event.preventDefault();
  startTouchCopyDrag(heldCard, pointerId, event.clientX, event.clientY, {
    mode: 'move',
    moved: true,
  });
  updateTouchCopyDragPreview(event.clientX, event.clientY);
}

export function onTouchHoldPointerEnd(event) {
  if (state.touchHoldPointerId === null || event.pointerId !== state.touchHoldPointerId) return;
  clearTouchCopyHold();
}

export function updateTouchCopyGhostPosition(clientX, clientY) {
  if (!state.touchCopyDragGhost) return;
  const offsetX = 16;
  const offsetY = 16;
  state.touchCopyDragGhost.style.transform = `translate(${clientX + offsetX}px, ${clientY + offsetY}px)`;
}

export function stopTouchCopyDragEdgeAutoScroll() {
  if (state.touchCopyDragEdgeScrollRaf !== null) {
    cancelAnimationFrame(state.touchCopyDragEdgeScrollRaf);
    state.touchCopyDragEdgeScrollRaf = null;
  }
  state.touchCopyDragEdgeScrollVelocity = 0;
}

export function resolveTouchCopyDragEdgeScrollVelocity(clientX) {
  if (!Number.isFinite(clientX)) return 0;
  const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
  if (viewportWidth <= 0) return 0;
  const threshold = Math.max(0, Math.min(TOUCH_DRAG_EDGE_SCROLL_THRESHOLD_PX, viewportWidth / 2));
  if (threshold <= 0) return 0;

  let direction = 0;
  let edgeRatio = 0;
  if (clientX <= threshold) {
    direction = -1;
    edgeRatio = (threshold - clientX) / threshold;
  } else if (clientX >= viewportWidth - threshold) {
    direction = 1;
    edgeRatio = (clientX - (viewportWidth - threshold)) / threshold;
  } else {
    return 0;
  }

  const clampedRatio = Math.max(0, Math.min(1, edgeRatio));
  const speed =
    TOUCH_DRAG_EDGE_SCROLL_MIN_SPEED_PX_PER_FRAME +
    (TOUCH_DRAG_EDGE_SCROLL_MAX_SPEED_PX_PER_FRAME - TOUCH_DRAG_EDGE_SCROLL_MIN_SPEED_PX_PER_FRAME) *
      clampedRatio;
  return direction * speed;
}

export function runTouchCopyDragEdgeAutoScrollStep() {
  state.touchCopyDragEdgeScrollRaf = null;
  if (!state.touchCopyDragActive || !zonesContainer) return;
  if (Math.abs(state.touchCopyDragEdgeScrollVelocity) < 0.01) return;

  const maxScrollLeft = Math.max(0, zonesContainer.scrollWidth - zonesContainer.clientWidth);
  if (maxScrollLeft <= 0) {
    state.touchCopyDragEdgeScrollVelocity = 0;
    return;
  }

  const previousScrollLeft = zonesContainer.scrollLeft;
  const nextScrollLeft = Math.max(
    0,
    Math.min(maxScrollLeft, previousScrollLeft + state.touchCopyDragEdgeScrollVelocity),
  );
  zonesContainer.scrollLeft = nextScrollLeft;

  if (Number.isFinite(state.touchCopyDragLastClientX) && Number.isFinite(state.touchCopyDragLastClientY)) {
    updateTouchCopyDragPreview(state.touchCopyDragLastClientX, state.touchCopyDragLastClientY);
  }

  if (Math.abs(nextScrollLeft - previousScrollLeft) < 0.01) {
    state.touchCopyDragEdgeScrollVelocity = 0;
    return;
  }

  state.touchCopyDragEdgeScrollRaf = requestAnimationFrame(runTouchCopyDragEdgeAutoScrollStep);
}

export function updateTouchCopyDragEdgeAutoScroll(clientX, clientY) {
  state.touchCopyDragLastClientX = clientX;
  state.touchCopyDragLastClientY = clientY;
  const velocity = resolveTouchCopyDragEdgeScrollVelocity(clientX);
  if (Math.abs(velocity) < 0.01) {
    stopTouchCopyDragEdgeAutoScroll();
    return;
  }

  state.touchCopyDragEdgeScrollVelocity = velocity;
  if (state.touchCopyDragEdgeScrollRaf === null) {
    state.touchCopyDragEdgeScrollRaf = requestAnimationFrame(runTouchCopyDragEdgeAutoScrollStep);
  }
}

export function removeTouchCopyDragListeners() {
  window.removeEventListener('pointermove', onTouchCopyDragPointerMove, true);
  window.removeEventListener('pointerup', onTouchCopyDragPointerUp, true);
  window.removeEventListener('pointercancel', onTouchCopyDragPointerCancel, true);
}

export function clearZoneDragOverState() {
  document.querySelectorAll('.zone.drag-over').forEach((zone) => zone.classList.remove('drag-over'));
}

export function cleanupTouchCopyDrag({ restoreLayout = false } = {}) {
  stopTouchCopyDragEdgeAutoScroll();
  if (state.touchCopyDragGhost) {
    state.touchCopyDragGhost.remove();
    state.touchCopyDragGhost = null;
  }
  _deps.hideTrashDropzone();
  _deps.clearDesktopDragGhost();
  _deps.clearDragModeBadge();
  _deps.clearDragPreviewCard();

  removeTouchCopyDragListeners();
  clearZoneDragOverState();

  if (state.draggingCard) {
    state.draggingCard.classList.remove('dragging');
  }

  const shouldRestoreLayout = restoreLayout && !state.dragDropHandled;

  state.draggingCard = null;
  state.dragContext = null;
  state.dragDropHandled = false;
  state.touchCopyDragActive = false;
  state.touchCopyDragPointerId = null;
  state.touchCopyDragMoved = false;
  state.touchCopyDragLastClientX = 0;
  state.touchCopyDragLastClientY = 0;
  state.touchDragMode = null;

  if (shouldRestoreLayout) {
    _deps.renderZones();
  }
}

export function getZoneFromPoint(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  if (!(target instanceof Element)) return null;
  const zoneBody = target.closest('.zone-body');
  if (zoneBody) {
    return zoneBody.closest('.zone');
  }
  return target.closest('.zone');
}

export function updateTouchCopyDragPreview(clientX, clientY) {
  updateTouchCopyGhostPosition(clientX, clientY);
  clearZoneDragOverState();
  _deps.syncQueueNextDropzoneVisibility();

  if (_deps.isPointOverQueueNextDropzone(clientX, clientY)) {
    if (state.queueNextDropzoneEl) {
      state.queueNextDropzoneEl.classList.add('is-active');
    }
    if (state.trashDropzoneEl) {
      state.trashDropzoneEl.classList.remove('is-active');
    }
    _deps.applyDragModeBadge('next');
    if (state.touchCopyDragGhost) {
      state.touchCopyDragGhost.classList.remove('is-copy', 'is-move', 'is-cancel', 'is-delete');
      state.touchCopyDragGhost.classList.add('is-next');
    }
    return;
  }

  if (state.queueNextDropzoneEl) {
    state.queueNextDropzoneEl.classList.remove('is-active');
  }

  if (_deps.isPointOverTrashDropzone(clientX, clientY)) {
    if (state.trashDropzoneEl) {
      state.trashDropzoneEl.classList.add('is-active');
    }
    _deps.applyDragModeBadge('delete');
    if (state.touchCopyDragGhost) {
      state.touchCopyDragGhost.classList.remove('is-copy', 'is-move', 'is-cancel', 'is-next');
      state.touchCopyDragGhost.classList.add('is-delete');
    }
    return;
  }

  if (state.trashDropzoneEl) {
    state.trashDropzoneEl.classList.remove('is-active');
  }

  const zone = getZoneFromPoint(clientX, clientY);
  if (!zone) {
    _deps.applyDragModeBadge('cancel');
    if (state.touchCopyDragGhost) {
      state.touchCopyDragGhost.classList.remove('is-copy', 'is-move', 'is-delete', 'is-next');
      state.touchCopyDragGhost.classList.add('is-cancel');
    }
    return;
  }

  const targetZoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
  const dropMode = _deps.resolveEffectiveDragMode(null, Number.isInteger(targetZoneIndex) ? targetZoneIndex : null);
  _deps.applyDragModeBadge(dropMode);
  if (state.touchCopyDragGhost) {
    state.touchCopyDragGhost.classList.remove('is-delete', 'is-cancel', 'is-copy', 'is-move', 'is-next');
    state.touchCopyDragGhost.classList.add(dropMode === 'copy' ? 'is-copy' : 'is-move');
  }

  zone.classList.add('drag-over');
  const zoneBody = zone.querySelector('.zone-body');
  if (!zoneBody) return;

  _deps.applyDragPreview(zoneBody, {
    clientY,
    preventDefault() {},
    dataTransfer: null,
  });
}

export async function finishTouchCopyDrag(clientX, clientY) {
  if (!state.touchCopyDragActive) return;
  const dropMode = state.touchDragMode === 'copy' ? 'copy' : 'move';

  if (!state.touchCopyDragMoved) {
    cleanupTouchCopyDrag({ restoreLayout: true });
    setStatus(dropMode === 'copy' ? 'Копирование отменено.' : 'Перемещение отменено.');
    return;
  }

  if (_deps.isPointOverTrashDropzone(clientX, clientY)) {
    try {
      await _deps.handleDragDeleteFromContext();
    } finally {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
    return;
  }

  if (_deps.isPointOverQueueNextDropzone(clientX, clientY)) {
    try {
      await _deps.handleDragQueueNextFromContext();
    } finally {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
    return;
  }

  const zone = getZoneFromPoint(clientX, clientY);
  const targetZoneIndex = zone ? Number.parseInt(zone.dataset.zoneIndex || '', 10) : NaN;

  if (Number.isInteger(targetZoneIndex) && targetZoneIndex >= 0 && zone) {
    const fakeDropEvent = {
      preventDefault() {},
      currentTarget: zone,
      ctrlKey: dropMode === 'copy',
      metaKey: false,
      dataTransfer: null,
    };

    try {
      await _deps.handleDrop(fakeDropEvent, targetZoneIndex);
    } finally {
      cleanupTouchCopyDrag({ restoreLayout: false });
    }
    return;
  }

  cleanupTouchCopyDrag({ restoreLayout: true });
  setStatus(dropMode === 'copy' ? 'Копирование отменено.' : 'Перемещение отменено.');
}

export function onTouchCopyDragPointerMove(event) {
  if (!state.touchCopyDragActive || event.pointerId !== state.touchCopyDragPointerId) return;
  event.preventDefault();
  const deltaX = event.clientX - state.touchCopyDragStartX;
  const deltaY = event.clientY - state.touchCopyDragStartY;
  if (!state.touchCopyDragMoved && Math.hypot(deltaX, deltaY) > TOUCH_DRAG_COMMIT_PX) {
    state.touchCopyDragMoved = true;
  }
  updateTouchCopyDragPreview(event.clientX, event.clientY);
  updateTouchCopyDragEdgeAutoScroll(event.clientX, event.clientY);
}

export function onTouchCopyDragPointerUp(event) {
  if (!state.touchCopyDragActive || event.pointerId !== state.touchCopyDragPointerId) return;
  event.preventDefault();
  finishTouchCopyDrag(event.clientX, event.clientY).catch((err) => {
    console.error(err);
    const dropMode = state.touchDragMode === 'copy' ? 'copy' : 'move';
    cleanupTouchCopyDrag({ restoreLayout: true });
    setStatus(
      dropMode === 'copy'
        ? 'Не удалось завершить копирование на тач-устройстве.'
        : 'Не удалось завершить перемещение на тач-устройстве.',
    );
  });
}

export function onTouchCopyDragPointerCancel(event) {
  if (!state.touchCopyDragActive || event.pointerId !== state.touchCopyDragPointerId) return;
  const dropMode = state.touchDragMode === 'copy' ? 'copy' : 'move';
  cleanupTouchCopyDrag({ restoreLayout: true });
  setStatus(dropMode === 'copy' ? 'Копирование отменено.' : 'Перемещение отменено.');
}

export function startTouchCopyDrag(card, pointerId, clientX, clientY, { mode = 'copy', moved = false } = {}) {
  if (!card || !card.isConnected) return;
  if (_deps.isTrackCardDragBlocked(card)) {
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
  const resolvedMode = mode === 'copy' ? 'copy' : 'move';

  state.dragContext = {
    file: card.dataset.file || '',
    sourceZoneIndex: Number.isInteger(sourceZoneIndex) ? sourceZoneIndex : -1,
    sourceIndex,
    sourcePlaylistType,
    snapshotLayout: _deps.cloneLayoutState(state.layout),
  };

  state.draggingCard = card;
  state.dragDropHandled = false;
  state.touchCopyDragActive = true;
  state.touchCopyDragPointerId = pointerId;
  state.touchCopyDragStartX = clientX;
  state.touchCopyDragStartY = clientY;
  state.touchCopyDragMoved = Boolean(moved);
  state.touchCopyDragLastClientX = clientX;
  state.touchCopyDragLastClientY = clientY;
  state.touchDragMode = resolvedMode;
  card.classList.add('dragging');

  const ghost = card.cloneNode(true);
  ghost.classList.add('touch-drag-ghost');
  ghost.classList.add(state.touchDragMode === 'copy' ? 'is-copy' : 'is-move');
  ghost.classList.remove('dragging');
  state.touchCopyDragGhost = ghost;
  document.body.appendChild(ghost);
  updateTouchCopyGhostPosition(clientX, clientY);
  _deps.showTrashDropzone();
  _deps.applyDragModeBadge(state.touchDragMode);
  updateTouchCopyDragEdgeAutoScroll(clientX, clientY);

  window.addEventListener('pointermove', onTouchCopyDragPointerMove, true);
  window.addEventListener('pointerup', onTouchCopyDragPointerUp, true);
  window.addEventListener('pointercancel', onTouchCopyDragPointerCancel, true);
  setStatus(
    state.touchDragMode === 'copy'
      ? 'Режим копирования: перетащите трек в нужный плей-лист.'
      : 'Режим перемещения: перетащите трек в нужный плей-лист.',
  );
}

export function startTouchCopyHold(card, event) {
  if (state.touchCopyDragActive) return;

  state.lastTouchPointerDownAt = Date.now();
  clearTouchCopyHold();
  state.touchHoldPointerId = event.pointerId;
  state.touchHoldStartX = event.clientX;
  state.touchHoldStartY = event.clientY;
  state.touchHoldStartedAt = Date.now();
  state.touchHoldCard = card;
  card.classList.add('touch-hold-copy');

  window.addEventListener('pointermove', onTouchHoldPointerMove, true);
  window.addEventListener('pointerup', onTouchHoldPointerEnd, true);
  window.addEventListener('pointercancel', onTouchHoldPointerEnd, true);

  state.touchHoldTimer = setTimeout(() => {
    const heldCard = state.touchHoldCard;
    const pointerId = state.touchHoldPointerId;
    const startX = state.touchHoldStartX;
    const startY = state.touchHoldStartY;

    clearTouchCopyHold();

    if (!heldCard || pointerId === null) return;
    startTouchCopyDrag(heldCard, pointerId, startX, startY, { mode: 'copy' });
  }, TOUCH_COPY_HOLD_MS);
}

export function removePlaylistCollapseHoldListeners() {
  window.removeEventListener('pointermove', onPlaylistCollapseHoldPointerMove, true);
  window.removeEventListener('pointerup', onPlaylistCollapseHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onPlaylistCollapseHoldPointerCancel, true);
}

export function clearPlaylistCollapsePendingVisual() {
  if (!state.playlistCollapseHoldZone) return;
  state.playlistCollapseHoldZone.classList.remove('zone--collapse-pending');
  state.playlistCollapseHoldZone = null;
}

export function clearPlaylistCollapseHold({ resetTriggered = true } = {}) {
  if (state.playlistCollapseHoldTimer !== null) {
    clearTimeout(state.playlistCollapseHoldTimer);
    state.playlistCollapseHoldTimer = null;
  }

  if (
    state.playlistCollapseHoldTarget &&
    state.playlistCollapseHoldPointerId !== null &&
    typeof state.playlistCollapseHoldTarget.releasePointerCapture === 'function'
  ) {
    try {
      if (
        state.playlistCollapseHoldTarget.hasPointerCapture &&
        state.playlistCollapseHoldTarget.hasPointerCapture(state.playlistCollapseHoldPointerId)
      ) {
        state.playlistCollapseHoldTarget.releasePointerCapture(state.playlistCollapseHoldPointerId);
      }
    } catch (err) {
      // ignore pointer capture release errors
    }
  }

  clearPlaylistCollapsePendingVisual();
  removePlaylistCollapseHoldListeners();
  state.playlistCollapseHoldPointerId = null;
  state.playlistCollapseHoldStartX = 0;
  state.playlistCollapseHoldStartY = 0;
  state.playlistCollapseHoldPlaylistIndex = null;
  state.playlistCollapseHoldTarget = null;
  state.playlistCollapseHoldZone = null;
  if (resetTriggered) {
    state.playlistCollapseHoldTriggered = false;
  }
}

export function onPlaylistCollapseHoldPointerMove(event) {
  if (state.playlistCollapseHoldPointerId === null || event.pointerId !== state.playlistCollapseHoldPointerId) return;
  if (state.playlistCollapseHoldTriggered) {
    event.preventDefault();
    return;
  }

  const deltaX = event.clientX - state.playlistCollapseHoldStartX;
  const deltaY = event.clientY - state.playlistCollapseHoldStartY;
  if (Math.hypot(deltaX, deltaY) <= PLAYLIST_COLLAPSE_POINTER_MOVE_TOLERANCE_PX) return;
  clearPlaylistCollapseHold();
}

export function onPlaylistCollapseHoldPointerEnd(event) {
  if (state.playlistCollapseHoldPointerId === null || event.pointerId !== state.playlistCollapseHoldPointerId) return;
  const shouldCollapse = state.playlistCollapseHoldTriggered;
  const collapsePlaylistIndex = state.playlistCollapseHoldPlaylistIndex;
  clearPlaylistCollapseHold();
  if (!shouldCollapse) return;
  event.preventDefault();
  event.stopPropagation();
  collapsePlaylistForLocalView(collapsePlaylistIndex);
}

export function onPlaylistCollapseHoldPointerCancel(event) {
  if (state.playlistCollapseHoldPointerId === null || event.pointerId !== state.playlistCollapseHoldPointerId) return;
  const shouldCollapse = state.playlistCollapseHoldTriggered;
  const collapsePlaylistIndex = state.playlistCollapseHoldPlaylistIndex;
  clearPlaylistCollapseHold();
  if (!shouldCollapse) return;
  collapsePlaylistForLocalView(collapsePlaylistIndex);
}

export function startPlaylistCollapseHold(event, playlistIndex) {
  if (isHostRole()) return;
  if (!isTouchPlaylistCollapseEnabled()) return;
  const pointerType = typeof event.pointerType === 'string' ? event.pointerType : '';
  if (pointerType && pointerType !== 'touch' && pointerType !== 'pen') return;
  if (state.touchCopyDragActive || state.draggingCard) return;
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return;

  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  clearPlaylistCollapseHold();
  state.playlistCollapseHoldPointerId = event.pointerId;
  state.playlistCollapseHoldStartX = event.clientX;
  state.playlistCollapseHoldStartY = event.clientY;
  state.playlistCollapseHoldPlaylistIndex = playlistIndex;
  state.playlistCollapseHoldTarget = target;
  state.playlistCollapseHoldZone = target ? target.closest('.zone') : null;
  state.playlistCollapseHoldTriggered = false;

  if (target && typeof target.setPointerCapture === 'function') {
    try {
      target.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors
    }
  }

  window.addEventListener('pointermove', onPlaylistCollapseHoldPointerMove, true);
  window.addEventListener('pointerup', onPlaylistCollapseHoldPointerEnd, true);
  window.addEventListener('pointercancel', onPlaylistCollapseHoldPointerCancel, true);

  state.playlistCollapseHoldTimer = setTimeout(() => {
    state.playlistCollapseHoldTimer = null;
    const targetPlaylistIndex = state.playlistCollapseHoldPlaylistIndex;
    if (
      !Number.isInteger(targetPlaylistIndex) ||
      targetPlaylistIndex < 0 ||
      targetPlaylistIndex >= state.layout.length ||
      state.collapsedPlaylistIndices.has(targetPlaylistIndex)
    ) {
      clearPlaylistCollapseHold();
      return;
    }

    state.playlistCollapseHoldTriggered = true;
    if (state.playlistCollapseHoldZone && state.playlistCollapseHoldZone.isConnected) {
      state.playlistCollapseHoldZone.classList.add('zone--collapse-pending');
    }
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
      focused.blur();
    }
  }, PLAYLIST_COLLAPSE_HOLD_MS);
}

export function isTouchFullscreenPreferredDevice() {
  const hasTouchPoints = (() => {
    if (typeof navigator !== 'object' || !navigator) return false;
    const maxTouchPoints = Number.isFinite(navigator.maxTouchPoints) ? navigator.maxTouchPoints : 0;
    const legacyTouchPoints = Number.isFinite(navigator.msMaxTouchPoints) ? navigator.msMaxTouchPoints : 0;
    return maxTouchPoints > 0 || legacyTouchPoints > 0;
  })();
  if (!hasTouchPoints) return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function hasFullscreenSupport() {
  const root = document.documentElement;
  return Boolean(root && (root.requestFullscreen || root.webkitRequestFullscreen));
}

export function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function isFullscreenActive() {
  return Boolean(getFullscreenElement());
}

export function updateTouchFullscreenToggleState() {
  if (!touchFullscreenToggleBtn) return;
  const isActive = isFullscreenActive();
  touchFullscreenToggleBtn.textContent = isActive ? '⤡' : '⛶';
  touchFullscreenToggleBtn.title = isActive ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим';
  touchFullscreenToggleBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
}

export async function enterFullscreenMode() {
  const root = document.documentElement;
  if (!root) return;
  if (root.requestFullscreen) {
    await root.requestFullscreen();
    return;
  }
  if (root.webkitRequestFullscreen) {
    await root.webkitRequestFullscreen();
    return;
  }
  throw new Error('Fullscreen API не поддерживается');
}

export async function exitFullscreenMode() {
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  if (document.webkitExitFullscreen) {
    await document.webkitExitFullscreen();
  }
}

export async function toggleTouchFullscreenMode() {
  try {
    if (isFullscreenActive()) {
      await exitFullscreenMode();
    } else {
      await enterFullscreenMode();
    }
  } catch (err) {
    console.error('Не удалось переключить полноэкранный режим', err);
    setStatus('Не удалось включить полноэкранный режим.');
  } finally {
    updateTouchFullscreenToggleState();
  }
}

export function initTouchFullscreenToggle() {
  if (!touchFullscreenToggleBtn) return;

  const shouldShow = hasFullscreenSupport() && isTouchFullscreenPreferredDevice();
  touchFullscreenToggleBtn.hidden = !shouldShow;
  if (!shouldShow) return;

  touchFullscreenToggleBtn.addEventListener('click', toggleTouchFullscreenMode);
  document.addEventListener('fullscreenchange', updateTouchFullscreenToggleState);
  document.addEventListener('webkitfullscreenchange', updateTouchFullscreenToggleState);
  updateTouchFullscreenToggleState();
}

export function isTouchPlaylistCollapseEnabled() {
  return isTouchFullscreenPreferredDevice();
}

export function pruneCollapsedPlaylistIndices(expectedLength = state.layout.length) {
  const length = Number.isInteger(expectedLength) && expectedLength >= 0 ? expectedLength : 0;
  for (const playlistIndex of Array.from(state.collapsedPlaylistIndices)) {
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= length) {
      state.collapsedPlaylistIndices.delete(playlistIndex);
    }
  }
}

export function getCollapsedPlaylistIndicesInRenderOrder() {
  pruneCollapsedPlaylistIndices(state.layout.length);
  if (!state.collapsedPlaylistIndices.size) return [];
  const renderOrder = _deps.buildPlaylistRenderOrder(state.layout.length, state.dapConfig);
  const indices = renderOrder.filter((playlistIndex) => state.collapsedPlaylistIndices.has(playlistIndex));
  if (indices.length === state.collapsedPlaylistIndices.size) return indices;

  const unknown = Array.from(state.collapsedPlaylistIndices).filter((playlistIndex) => !indices.includes(playlistIndex));
  unknown.sort((left, right) => left - right);
  return indices.concat(unknown);
}

export function isPlaylistCollapsedForLocalView(playlistIndex) {
  if (!isTouchPlaylistCollapseEnabled()) return false;
  return state.collapsedPlaylistIndices.has(playlistIndex);
}

export function restoreCollapsedPlaylistForLocalView(playlistIndex) {
  if (!state.collapsedPlaylistIndices.has(playlistIndex)) return false;
  state.collapsedPlaylistIndices.delete(playlistIndex);
  hideCollapsedPlaylistsOverlay();
  _deps.renderZones();
  return true;
}

export function collapsePlaylistForLocalView(playlistIndex) {
  if (!isTouchPlaylistCollapseEnabled()) return false;
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return false;
  if (state.collapsedPlaylistIndices.has(playlistIndex)) return false;
  state.collapsedPlaylistIndices.add(playlistIndex);
  hideCollapsedPlaylistsOverlay();
  _deps.renderZones();
  const title = _deps.sanitizePlaylistName(state.playlistNames[playlistIndex], playlistIndex);
  showCollapsedPlaylistsHint(`Свернут: ${title}`);
  return true;
}

export function canPanZonesContainer() {
  if (!zonesContainer) return false;
  return zonesContainer.scrollWidth - zonesContainer.clientWidth > 1;
}

export function stopZonesPanMomentum() {
  if (state.zonesPanMomentumRaf === null) return;
  cancelAnimationFrame(state.zonesPanMomentumRaf);
  state.zonesPanMomentumRaf = null;
}

export function stopZonesWheelSmoothScroll() {
  if (state.zonesWheelSmoothRaf !== null) {
    cancelAnimationFrame(state.zonesWheelSmoothRaf);
    state.zonesWheelSmoothRaf = null;
  }
  state.zonesWheelTargets.clear();
}

export function runZonesWheelSmoothStep() {
  state.zonesWheelSmoothRaf = null;
  if (!zonesContainer || !state.zonesWheelTargets.size) {
    state.zonesWheelTargets.clear();
    return;
  }

  let hasPending = false;
  const activeBodies = new Set(getZoneBodies());

  for (const [body, targetValue] of state.zonesWheelTargets.entries()) {
    if (!(body instanceof HTMLElement) || !activeBodies.has(body)) {
      state.zonesWheelTargets.delete(body);
      continue;
    }

    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const target = Math.max(0, Math.min(maxScrollTop, Number.isFinite(targetValue) ? targetValue : body.scrollTop));
    const current = body.scrollTop;
    const delta = target - current;

    if (Math.abs(delta) <= ZONES_WHEEL_SMOOTH_MIN_DELTA_PX) {
      body.scrollTop = target;
      state.zonesWheelTargets.delete(body);
      continue;
    }

    body.scrollTop = current + delta * ZONES_WHEEL_SMOOTH_EASE;
    state.zonesWheelTargets.set(body, target);
    hasPending = true;
  }

  if (hasPending && state.zonesWheelTargets.size) {
    state.zonesWheelSmoothRaf = requestAnimationFrame(runZonesWheelSmoothStep);
  }
}

export function scheduleZonesWheelSmoothScroll() {
  if (state.zonesWheelSmoothRaf !== null) return;
  state.zonesWheelSmoothRaf = requestAnimationFrame(runZonesWheelSmoothStep);
}

export function startZonesPanMomentum(initialVelocityPxPerMs) {
  if (!zonesContainer) return;
  stopZonesPanMomentum();

  let velocity = Number.isFinite(initialVelocityPxPerMs) ? initialVelocityPxPerMs : 0;
  if (Math.abs(velocity) < ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) return;

  let previousTimestamp = performance.now();

  const step = (timestamp) => {
    if (!zonesContainer) {
      state.zonesPanMomentumRaf = null;
      return;
    }

    const deltaMs = Math.max(1, timestamp - previousTimestamp);
    previousTimestamp = timestamp;

    const maxScrollLeft = Math.max(0, zonesContainer.scrollWidth - zonesContainer.clientWidth);
    if (maxScrollLeft <= 0) {
      state.zonesPanMomentumRaf = null;
      return;
    }

    const previousScrollLeft = zonesContainer.scrollLeft;
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, previousScrollLeft + velocity * deltaMs));
    zonesContainer.scrollLeft = nextScrollLeft;

    const hitBoundary = Math.abs(nextScrollLeft - previousScrollLeft) < 0.01;
    if (hitBoundary) {
      state.zonesPanMomentumRaf = null;
      return;
    }

    const decay = Math.pow(ZONES_PAN_TOUCH_MOMENTUM_DECAY_PER_FRAME, deltaMs / 16);
    velocity *= decay;

    if (Math.abs(velocity) < ZONES_PAN_TOUCH_MOMENTUM_STOP_SPEED_PX_PER_MS) {
      state.zonesPanMomentumRaf = null;
      return;
    }

    state.zonesPanMomentumRaf = requestAnimationFrame(step);
  };

  state.zonesPanMomentumRaf = requestAnimationFrame(step);
}

export function getZoneBodies() {
  if (!zonesContainer) return [];
  return state.zoneBodiesCache;
}

export function normalizeWheelDeltaPixels(event) {
  if (!event) return { deltaX: 0, deltaY: 0 };
  let factor = 1;
  if (event.deltaMode === 1) {
    factor = 16;
  } else if (event.deltaMode === 2) {
    factor = window.innerHeight || 800;
  }
  return {
    deltaX: Number.isFinite(event.deltaX) ? event.deltaX * factor : 0,
    deltaY: Number.isFinite(event.deltaY) ? event.deltaY * factor : 0,
  };
}

export function applySharedZonesVerticalScroll(deltaY, { smooth = false } = {}) {
  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.01) return false;

  let changed = false;
  const bodies = getZoneBodies();
  for (const body of bodies) {
    if (!(body instanceof HTMLElement)) continue;

    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    if (maxScrollTop <= 0) continue;

    if (smooth) {
      const previousTarget = state.zonesWheelTargets.has(body) ? state.zonesWheelTargets.get(body) : body.scrollTop;
      const nextTarget = Math.max(0, Math.min(maxScrollTop, previousTarget + deltaY));
      if (Math.abs(nextTarget - previousTarget) < 0.01 && Math.abs(nextTarget - body.scrollTop) < 0.01) continue;
      state.zonesWheelTargets.set(body, nextTarget);
      changed = true;
      continue;
    }

    const previousScrollTop = body.scrollTop;
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, previousScrollTop + deltaY));
    if (Math.abs(nextScrollTop - previousScrollTop) < 0.01) continue;
    body.scrollTop = nextScrollTop;
    changed = true;
  }

  if (smooth && changed) {
    scheduleZonesWheelSmoothScroll();
  }

  return changed;
}

export function onZonesWheel(event) {
  if (!zonesContainer) return;
  if (!event) return;
  if (event.ctrlKey) return;
  if (state.draggingCard || state.touchCopyDragActive) return;

  const target = event.target instanceof Element ? event.target : null;
  if (!target || !zonesContainer.contains(target)) return;

  const { deltaX, deltaY } = normalizeWheelDeltaPixels(event);
  if (Math.abs(deltaY) < Math.abs(deltaX)) {
    return;
  }

  if (applySharedZonesVerticalScroll(deltaY, { smooth: true })) {
    event.preventDefault();
  }
}

export function getTouchMidpoint(touches) {
  if (!touches || touches.length < 2) return null;
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return null;
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

export function getTouchByIdentifier(touches, identifier) {
  if (!touches || !Number.isFinite(identifier)) return null;
  for (let index = 0; index < touches.length; index += 1) {
    const touch = typeof touches.item === 'function' ? touches.item(index) : touches[index];
    if (touch && touch.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

export function resetZonesFreeAreaTapTracking({ resetTapCount = false } = {}) {
  state.zonesFreeAreaTapCandidate = null;
  if (!resetTapCount) return;
  state.zonesFreeAreaTapCount = 0;
  state.zonesFreeAreaLastTapAt = 0;
  state.zonesFreeAreaLastTapX = 0;
  state.zonesFreeAreaLastTapY = 0;
}

export function onZonesFreeAreaTapStart(event) {
  if (!isTouchPlaylistCollapseEnabled()) return;
  if (!event || !event.touches) return;
  if (event.touches.length !== 1) {
    resetZonesFreeAreaTapTracking({ resetTapCount: event.touches.length > 1 });
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (!isZonesPanFreeAreaTarget(target)) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  const touch = event.touches[0];
  if (!touch) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  state.zonesFreeAreaTapCandidate = {
    identifier: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    startedAt: Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(),
  };
}

export function onZonesFreeAreaTapMove(event) {
  if (!state.zonesFreeAreaTapCandidate || !event || !event.touches) return;
  if (event.touches.length !== 1) {
    resetZonesFreeAreaTapTracking({ resetTapCount: event.touches.length > 1 });
    return;
  }

  const candidateTouch = getTouchByIdentifier(event.touches, state.zonesFreeAreaTapCandidate.identifier);
  if (!candidateTouch) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  const deltaX = candidateTouch.clientX - state.zonesFreeAreaTapCandidate.startX;
  const deltaY = candidateTouch.clientY - state.zonesFreeAreaTapCandidate.startY;
  if (Math.hypot(deltaX, deltaY) > COLLAPSED_PLAYLIST_TAP_MOVE_TOLERANCE_PX) {
    resetZonesFreeAreaTapTracking();
  }
}

export function registerZonesFreeAreaTap(clientX, clientY, eventTime, event) {
  const timestamp = Number.isFinite(eventTime) ? eventTime : performance.now();
  const withinWindow = timestamp - state.zonesFreeAreaLastTapAt <= COLLAPSED_PLAYLIST_TRIPLE_TAP_WINDOW_MS;
  const nearPreviousTap =
    Math.hypot(clientX - state.zonesFreeAreaLastTapX, clientY - state.zonesFreeAreaLastTapY) <=
    COLLAPSED_PLAYLIST_TRIPLE_TAP_DISTANCE_PX;
  state.zonesFreeAreaTapCount = withinWindow && nearPreviousTap ? state.zonesFreeAreaTapCount + 1 : 1;
  state.zonesFreeAreaLastTapAt = timestamp;
  state.zonesFreeAreaLastTapX = clientX;
  state.zonesFreeAreaLastTapY = clientY;

  if (state.zonesFreeAreaTapCount < 3) return;

  resetZonesFreeAreaTapTracking({ resetTapCount: true });
  if (state.collapsedPlaylistsOverlayEl) {
    hideCollapsedPlaylistsOverlay();
  } else {
    showCollapsedPlaylistsOverlay();
  }
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
}

export function onZonesFreeAreaTapEnd(event) {
  if (!isTouchPlaylistCollapseEnabled()) return;
  if (!state.zonesFreeAreaTapCandidate || !event || !event.changedTouches) return;
  if (state.zonesTouchPanActive || state.zonesPanActive || state.draggingCard || state.touchCopyDragActive) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  const completedTouch = getTouchByIdentifier(event.changedTouches, state.zonesFreeAreaTapCandidate.identifier);
  const candidate = state.zonesFreeAreaTapCandidate;
  state.zonesFreeAreaTapCandidate = null;
  if (!completedTouch) return;

  const finishedAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  if (finishedAt - candidate.startedAt > COLLAPSED_PLAYLIST_TAP_MAX_DURATION_MS) return;
  const deltaX = completedTouch.clientX - candidate.startX;
  const deltaY = completedTouch.clientY - candidate.startY;
  if (Math.hypot(deltaX, deltaY) > COLLAPSED_PLAYLIST_TAP_MOVE_TOLERANCE_PX) return;

  registerZonesFreeAreaTap(completedTouch.clientX, completedTouch.clientY, finishedAt, event);
}

export function onZonesFreeAreaTapCancel() {
  resetZonesFreeAreaTapTracking();
}

export function cleanupZonesTouchPanInteraction() {
  if (zonesContainer) {
    zonesContainer.classList.remove('is-pan-scrolling');
  }

  state.zonesTouchPanActive = false;
  state.zonesTouchPanMoved = false;
  state.zonesTouchPanStartMidX = 0;
  state.zonesTouchPanStartMidY = 0;
  state.zonesTouchPanStartScrollLeft = 0;
  state.zonesTouchPanLastMidX = 0;
  state.zonesTouchPanLastAt = 0;
  state.zonesTouchPanVelocityX = 0;
}

export function onZonesTouchStart(event) {
  if (!zonesContainer) return;
  if (!event || !event.touches) return;
  if (state.draggingCard || state.touchCopyDragActive) {
    resetZonesFreeAreaTapTracking();
    return;
  }

  onZonesFreeAreaTapStart(event);

  if (!canPanZonesContainer()) return;
  if (event.touches.length !== 2) return;

  if (!areZonesTouchPanTouchesEligible(event.touches)) return;

  const midpoint = getTouchMidpoint(event.touches);
  if (!midpoint) return;

  stopZonesPanMomentum();
  stopZonesWheelSmoothScroll();
  cleanupZonesTouchPanInteraction();

  state.zonesTouchPanActive = true;
  state.zonesTouchPanMoved = false;
  state.zonesTouchPanStartMidX = midpoint.x;
  state.zonesTouchPanStartMidY = midpoint.y;
  state.zonesTouchPanStartScrollLeft = zonesContainer.scrollLeft;
  state.zonesTouchPanLastMidX = midpoint.x;
  state.zonesTouchPanLastAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  state.zonesTouchPanVelocityX = 0;
  event.preventDefault();
}

export function areZonesTouchPanTouchesEligible(touches) {
  if (!zonesContainer || !touches || touches.length < 2) return false;
  for (let index = 0; index < touches.length; index += 1) {
    const touch = typeof touches.item === 'function' ? touches.item(index) : touches[index];
    if (!touch || !(touch.target instanceof Element)) return false;
    if (!zonesContainer.contains(touch.target)) return false;
  }
  return true;
}

export function onZonesTouchMove(event) {
  if (!event || !event.touches) return;
  onZonesFreeAreaTapMove(event);
  if (!state.zonesTouchPanActive) return;
  if (!zonesContainer) return;

  if (event.touches.length < 2) {
    const momentumVelocity = state.zonesTouchPanMoved ? -state.zonesTouchPanVelocityX * ZONES_TWO_FINGER_PAN_TOUCH_GAIN : 0;
    cleanupZonesTouchPanInteraction();
    if (Math.abs(momentumVelocity) >= ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) {
      startZonesPanMomentum(momentumVelocity);
    }
    return;
  }

  const midpoint = getTouchMidpoint(event.touches);
  if (!midpoint) return;

  const nowTimestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const sampleDeltaMs = nowTimestamp - state.zonesTouchPanLastAt;
  if (Number.isFinite(sampleDeltaMs) && sampleDeltaMs > 0) {
    const sampleVelocityX = (midpoint.x - state.zonesTouchPanLastMidX) / sampleDeltaMs;
    state.zonesTouchPanVelocityX = state.zonesTouchPanVelocityX * 0.7 + sampleVelocityX * 0.3;
  }
  state.zonesTouchPanLastMidX = midpoint.x;
  state.zonesTouchPanLastAt = nowTimestamp;

  const deltaX = midpoint.x - state.zonesTouchPanStartMidX;
  const deltaY = midpoint.y - state.zonesTouchPanStartMidY;

  if (!state.zonesTouchPanMoved) {
    const dragThreshold = 2;
    if (Math.abs(deltaX) < dragThreshold && Math.abs(deltaY) < dragThreshold) return;
    const verticalDominanceRatio = 2.6;
    if (Math.abs(deltaY) > Math.abs(deltaX) * verticalDominanceRatio) {
      cleanupZonesTouchPanInteraction();
      return;
    }
  }

  state.zonesTouchPanMoved = true;
  zonesContainer.classList.add('is-pan-scrolling');
  event.preventDefault();
  zonesContainer.scrollLeft = state.zonesTouchPanStartScrollLeft - deltaX * ZONES_TWO_FINGER_PAN_TOUCH_GAIN;
}

export function onZonesTouchEnd(event) {
  onZonesFreeAreaTapEnd(event);
  if (!state.zonesTouchPanActive) return;
  const hasEnoughTouches = Boolean(event && event.touches && event.touches.length >= 2);
  if (hasEnoughTouches) return;

  const momentumVelocity = state.zonesTouchPanMoved ? -state.zonesTouchPanVelocityX * ZONES_TWO_FINGER_PAN_TOUCH_GAIN : 0;
  cleanupZonesTouchPanInteraction();
  if (Math.abs(momentumVelocity) >= ZONES_PAN_TOUCH_MOMENTUM_MIN_SPEED_PX_PER_MS) {
    startZonesPanMomentum(momentumVelocity);
  }
}

export function onZonesTouchCancel() {
  onZonesFreeAreaTapCancel();
  if (!state.zonesTouchPanActive) return;
  cleanupZonesTouchPanInteraction();
}

export function isZonesPanFreeAreaTarget(target) {
  if (!(target instanceof Element)) return false;
  if (!zonesContainer || !zonesContainer.contains(target)) return false;
  if (target.closest('.track-card')) return false;
  if (target.closest('button, input, textarea, select, a, label')) return false;
  return true;
}

export function cleanupZonesPanInteraction() {
  if (zonesContainer) {
    zonesContainer.classList.remove('is-pan-scrolling');
    if (state.zonesPanPointerId !== null && typeof zonesContainer.releasePointerCapture === 'function') {
      try {
        if (zonesContainer.hasPointerCapture && zonesContainer.hasPointerCapture(state.zonesPanPointerId)) {
          zonesContainer.releasePointerCapture(state.zonesPanPointerId);
        }
      } catch (err) {
        // ignore pointer capture release errors
      }
    }
  }

  state.zonesPanActive = false;
  state.zonesPanMoved = false;
  state.zonesPanPointerId = null;
  state.zonesPanStartX = 0;
  state.zonesPanStartY = 0;
  state.zonesPanStartScrollLeft = 0;
  state.zonesPanPreferHorizontal = false;
  state.zonesPanPointerType = '';
  state.zonesPanMoveGain = 1;
  state.zonesPanLastX = 0;
  state.zonesPanLastAt = 0;
  state.zonesPanVelocityX = 0;
  window.removeEventListener('pointermove', onZonesPanPointerMove, true);
  window.removeEventListener('pointerup', onZonesPanPointerUp, true);
  window.removeEventListener('pointercancel', onZonesPanPointerCancel, true);
}

export function onZonesPanPointerMove(event) {
  if (!state.zonesPanActive || event.pointerId !== state.zonesPanPointerId) return;
  if (!zonesContainer) return;
  if (_deps.isDesktopDragHoldReadyForPointer(event.pointerId)) return;

  const deltaX = event.clientX - state.zonesPanStartX;
  const deltaY = event.clientY - state.zonesPanStartY;
  const nowTimestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const sampleDeltaMs = nowTimestamp - state.zonesPanLastAt;
  if (Number.isFinite(sampleDeltaMs) && sampleDeltaMs > 0) {
    const sampleVelocityX = (event.clientX - state.zonesPanLastX) / sampleDeltaMs;
    state.zonesPanVelocityX = state.zonesPanVelocityX * 0.7 + sampleVelocityX * 0.3;
  }
  state.zonesPanLastX = event.clientX;
  state.zonesPanLastAt = nowTimestamp;

  if (!state.zonesPanMoved) {
    const dragThreshold = state.zonesPanPreferHorizontal ? Math.max(2, Math.floor(ZONES_PAN_DRAG_THRESHOLD_PX / 2)) : ZONES_PAN_DRAG_THRESHOLD_PX;
    if (Math.abs(deltaX) < dragThreshold && Math.abs(deltaY) < dragThreshold) {
      return;
    }
    const verticalDominanceRatio = state.zonesPanPreferHorizontal ? 2.6 : 1;
    if (Math.abs(deltaY) > Math.abs(deltaX) * verticalDominanceRatio) {
      // Vertical gesture: keep native vertical scroll behavior.
      cleanupZonesPanInteraction();
      return;
    }
  }

  state.zonesPanMoved = true;
  zonesContainer.classList.add('is-pan-scrolling');
  event.preventDefault();
  zonesContainer.scrollLeft = state.zonesPanStartScrollLeft - deltaX * state.zonesPanMoveGain;
}

export function onZonesPanPointerUp(event) {
  if (!state.zonesPanActive || event.pointerId !== state.zonesPanPointerId) return;
  const shouldUseMomentum = state.zonesPanMoved && state.zonesPanPointerType === 'touch';
  const momentumVelocity = shouldUseMomentum ? -state.zonesPanVelocityX * zonesPanMoveGain : 0;
  cleanupZonesPanInteraction();
  if (shouldUseMomentum) {
    startZonesPanMomentum(momentumVelocity);
  }
}

export function onZonesPanPointerCancel(event) {
  if (!state.zonesPanActive || event.pointerId !== state.zonesPanPointerId) return;
  cleanupZonesPanInteraction();
}

export function onZonesPanPointerDown(event) {
  if (!zonesContainer) return;
  if (!event.isPrimary) return;
  if (event.pointerType === 'touch') return;
  if (event.button !== undefined && event.button !== 0) return;
  if (!canPanZonesContainer()) return;
  if (state.draggingCard || state.touchCopyDragActive) return;
  if (!isZonesPointerPanTarget(event.target instanceof Element ? event.target : null)) return;

  stopZonesPanMomentum();
  stopZonesWheelSmoothScroll();

  if (state.zonesPanActive) {
    cleanupZonesPanInteraction();
  }

  state.zonesPanActive = true;
  state.zonesPanMoved = false;
  state.zonesPanPointerId = event.pointerId;
  state.zonesPanStartX = event.clientX;
  state.zonesPanStartY = event.clientY;
  state.zonesPanStartScrollLeft = zonesContainer.scrollLeft;
  const targetElement = event.target instanceof Element ? event.target : null;
  state.zonesPanPreferHorizontal = Boolean(
    targetElement &&
      targetElement.closest('.zone-body') &&
      !targetElement.closest('.playlist-header, button, input, textarea, select, a, label'),
  );
  state.zonesPanPointerType = typeof event.pointerType === 'string' ? event.pointerType : '';
  state.zonesPanMoveGain =
    state.zonesPanPointerType === 'touch' && state.zonesPanPreferHorizontal
      ? ZONES_PAN_TOUCH_GAIN
      : 1;
  state.zonesPanLastX = event.clientX;
  state.zonesPanLastAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  state.zonesPanVelocityX = 0;

  const shouldCapturePointer =
    !(targetElement && targetElement.closest('.track-card')) && typeof zonesContainer.setPointerCapture === 'function';
  if (shouldCapturePointer) {
    try {
      zonesContainer.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors
    }
  }

  window.addEventListener('pointermove', onZonesPanPointerMove, true);
  window.addEventListener('pointerup', onZonesPanPointerUp, true);
  window.addEventListener('pointercancel', onZonesPanPointerCancel, true);
}

export function isZonesPointerPanTarget(target) {
  if (!(target instanceof Element)) return false;
  if (!zonesContainer || !zonesContainer.contains(target)) return false;
  if (target.closest('button, input, textarea, select, a, label, .track-order')) return false;
  return true;
}

export function initZonesPanControls() {
  if (!zonesContainer) return;
  zonesContainer.addEventListener('pointerdown', onZonesPanPointerDown);
  zonesContainer.addEventListener('wheel', onZonesWheel, { passive: false });
  zonesContainer.addEventListener('touchstart', onZonesTouchStart, { passive: false });
  zonesContainer.addEventListener('touchmove', onZonesTouchMove, { passive: false });
  zonesContainer.addEventListener('touchend', onZonesTouchEnd, { passive: false });
  zonesContainer.addEventListener('touchcancel', onZonesTouchCancel, { passive: false });
}

export function moveArrayItem(items, fromIndex, toIndex) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return list;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return list;
  if (fromIndex === toIndex) return list;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list;
}

export function remapPlaylistIndexAfterMove(index, fromIndex, toIndex) {
  if (!Number.isInteger(index) || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return index;
  if (fromIndex === toIndex) return index;
  if (index === fromIndex) return toIndex;
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
    return index - 1;
  }
  if (fromIndex > toIndex && index >= toIndex && index < fromIndex) {
    return index + 1;
  }
  return index;
}

export function remapCollapsedPlaylistIndicesAfterMove(fromIndex, toIndex, expectedLength = state.layout.length) {
  if (!state.collapsedPlaylistIndices.size) return;
  const length = Number.isInteger(expectedLength) && expectedLength >= 0 ? expectedLength : 0;
  const remapped = new Set();
  for (const playlistIndex of state.collapsedPlaylistIndices) {
    const normalizedIndex = _deps.normalizePlaylistTrackIndex(playlistIndex);
    if (normalizedIndex === null || normalizedIndex < 0 || normalizedIndex >= length) continue;
    const nextIndex = remapPlaylistIndexAfterMove(normalizedIndex, fromIndex, toIndex);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= length) continue;
    remapped.add(nextIndex);
  }
  state.collapsedPlaylistIndices.clear();
  remapped.forEach((playlistIndex) => state.collapsedPlaylistIndices.add(playlistIndex));
}

export async function reorderPlaylistsByHeaderDrag(sourcePlaylistIndex, targetPlaylistIndex) {
  if (!isHostRole()) {
    setStatus('Порядок плей-листов может менять только хост.');
    return;
  }
  try {
    await dispatchHostPlaylistReorderCommand(() =>
      reorderPlaylistsByHeaderDragLocally(sourcePlaylistIndex, targetPlaylistIndex),
    );
  } catch (err) {
    console.error(err);
    setStatus(err && err.message ? err.message : 'Не удалось изменить порядок плей-листов.');
  }
}

async function reorderPlaylistsByHeaderDragLocally(sourcePlaylistIndex, targetPlaylistIndex) {
  state.layout = _deps.ensurePlaylists(state.layout);
  const sourceIndex = _deps.normalizePlaylistTrackIndex(sourcePlaylistIndex);
  const normalizedTargetIndex =
    targetPlaylistIndex === null || targetPlaylistIndex === undefined
      ? null
      : _deps.normalizePlaylistTrackIndex(targetPlaylistIndex);
  if (sourceIndex === null) return;
  if (sourceIndex < 0 || sourceIndex >= state.layout.length) return;
  if (normalizedTargetIndex !== null && (normalizedTargetIndex < 0 || normalizedTargetIndex >= state.layout.length)) return;

  const destinationIndex =
    normalizedTargetIndex === null
      ? state.layout.length - 1
      : sourceIndex < normalizedTargetIndex
        ? normalizedTargetIndex - 1
        : normalizedTargetIndex;
  if (!Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= state.layout.length) return;
  if (sourceIndex === destinationIndex) return;

  const previousLayout = _deps.cloneLayoutState(state.layout);
  const previousNames = state.playlistNames.slice();
  const previousMeta = _deps.clonePlaylistMetaState(state.playlistMeta);
  const previousAutoplay = state.playlistAutoplay.slice();
  const previousDsp = state.playlistDsp.slice();
  const previousDap = { ...dapConfig };
  const previousCollapsedIndices = new Set(state.collapsedPlaylistIndices);
  const previousCurrentTrackWasDap = isDapTrackContext(state.currentTrack, previousDap);
  const previousCurrentTrackContext =
    state.currentTrack && typeof state.currentTrack === 'object'
      ? {
          playlistIndex: state.currentTrack.playlistIndex,
          playlistPosition: state.currentTrack.playlistPosition,
        }
      : null;
  const previousDapInterruptedSnapshot = state.dapInterruptedPlaybackSnapshot
    ? { ...dapInterruptedPlaybackSnapshot }
    : null;

  const nextLayout = moveArrayItem(previousLayout, sourceIndex, destinationIndex);
  const nextNames = moveArrayItem(previousNames, sourceIndex, destinationIndex);
  const nextMeta = moveArrayItem(previousMeta, sourceIndex, destinationIndex);
  const nextAutoplay = moveArrayItem(previousAutoplay, sourceIndex, destinationIndex);
  const nextDsp = moveArrayItem(previousDsp, sourceIndex, destinationIndex);

  const previousDapIndex = _deps.normalizePlaylistTrackIndex(previousDap.playlistIndex);
  const nextDapRaw = {
    ...previousDap,
    playlistIndex:
      previousDapIndex === null ? null : remapPlaylistIndexAfterMove(previousDapIndex, sourceIndex, destinationIndex),
  };

  state.layout = _deps.ensurePlaylists(nextLayout);
  state.playlistNames = _deps.normalizePlaylistNames(nextNames, state.layout.length);
  state.playlistMeta = _deps.normalizePlaylistMeta(nextMeta, state.layout.length);
  state.dapConfig = _deps.normalizeDapConfig(nextDapRaw, state.layout.length, nextDapRaw);
  state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(nextAutoplay, state.dapConfig, state.layout.length);
  state.playlistDsp = _deps.normalizePlaylistDspFlags(nextDsp, state.playlistAutoplay, state.layout.length);
  remapCollapsedPlaylistIndicesAfterMove(sourceIndex, destinationIndex, state.layout.length);

  const preferredCurrentTrackPlaylistIndex = previousCurrentTrackWasDap ? _deps.getDapPlaylistIndex(state.dapConfig) : null;
  const currentTrackContextChanged = _deps.reconcileTrackContextWithLayout(state.currentTrack, {
    preferredPlaylistIndex: preferredCurrentTrackPlaylistIndex,
  });
  const dapSnapshotContextChanged = _deps.reconcileDapInterruptedSnapshotWithLayout();
  if ((currentTrackContextChanged || dapSnapshotContextChanged) && state.currentAudio) {
    applyLiveVolumeToCurrentAudio();
  }

  updateDapSettingsUi(state.currentRole);
  _deps.renderZones();
  if (currentTrackContextChanged && isHostRole()) {
    _deps.requestHostPlaybackSync(true);
  }

  try {
    await _deps.pushSharedLayout();
    const movedTitle = _deps.sanitizePlaylistName(state.playlistNames[destinationIndex], destinationIndex);
    setStatus(`Плей-лист "${movedTitle}" перемещен и синхронизирован.`);
  } catch (err) {
    console.error(err);
    state.layout = previousLayout;
    state.playlistNames = previousNames;
    state.playlistMeta = previousMeta;
    state.dapConfig = _deps.normalizeDapConfig(previousDap, state.layout.length, previousDap);
    state.playlistAutoplay = _deps.normalizePlaylistAutoplayWithDap(previousAutoplay, state.dapConfig, state.layout.length);
    state.playlistDsp = _deps.normalizePlaylistDspFlags(previousDsp, state.playlistAutoplay, state.layout.length);
    state.collapsedPlaylistIndices.clear();
    previousCollapsedIndices.forEach((playlistIndex) => state.collapsedPlaylistIndices.add(playlistIndex));
    if (state.currentTrack && previousCurrentTrackContext) {
      state.currentTrack.playlistIndex = previousCurrentTrackContext.playlistIndex;
      state.currentTrack.playlistPosition = previousCurrentTrackContext.playlistPosition;
    }
    state.dapInterruptedPlaybackSnapshot = previousDapInterruptedSnapshot ? { ...previousDapInterruptedSnapshot } : null;
    const rollbackPreferredIndex = previousCurrentTrackWasDap ? _deps.getDapPlaylistIndex(state.dapConfig) : null;
    const rollbackTrackContextChanged = _deps.reconcileTrackContextWithLayout(state.currentTrack, {
      preferredPlaylistIndex: rollbackPreferredIndex,
    });
    const rollbackSnapshotContextChanged = _deps.reconcileDapInterruptedSnapshotWithLayout();
    if ((rollbackTrackContextChanged || rollbackSnapshotContextChanged) && state.currentAudio) {
      applyLiveVolumeToCurrentAudio();
    }
    updateDapSettingsUi(state.currentRole);
    _deps.renderZones();
    setStatus(err && err.message ? err.message : 'Не удалось синхронизировать порядок плей-листов.');
  }
}

export function removePlaylistReorderHoldListeners() {
  window.removeEventListener('pointermove', onPlaylistReorderHoldPointerMove, true);
  window.removeEventListener('pointerup', onPlaylistReorderHoldPointerEnd, true);
  window.removeEventListener('pointercancel', onPlaylistReorderHoldPointerCancel, true);
}

export function clearPlaylistReorderTargetVisual() {
  if (!state.playlistReorderHoldTargetZone) return;
  state.playlistReorderHoldTargetZone.classList.remove('zone--playlist-reorder-target');
  state.playlistReorderHoldTargetZone = null;
}

export function getPlaylistReorderVisibleOrderFromDom() {
  if (!zonesContainer) return [];
  return Array.from(zonesContainer.querySelectorAll('.zone'))
    .map((zone) => Number.parseInt(zone.dataset.zoneIndex || '', 10))
    .filter((playlistIndex) => Number.isInteger(playlistIndex) && playlistIndex >= 0);
}

export function getPlaylistReorderPointerContentX(clientX) {
  if (!zonesContainer) return null;
  const rect = zonesContainer.getBoundingClientRect();
  return clientX - rect.left + zonesContainer.scrollLeft;
}

export function resolvePlaylistReorderSlotFromPointer(clientX) {
  const centers = Array.isArray(state.playlistReorderHoldCandidateCenters) ? playlistReorderHoldCandidateCenters : [];
  if (!centers.length) return 0;
  const pointerContentX = getPlaylistReorderPointerContentX(clientX);
  if (!Number.isFinite(pointerContentX)) {
    return Number.isInteger(state.playlistReorderHoldCurrentSlot) ? playlistReorderHoldCurrentSlot : 0;
  }

  let slot = 0;
  while (slot < centers.length && pointerContentX > centers[slot]) {
    slot += 1;
  }
  return slot;
}

export function getPlaylistReorderTargetPlaylistBySlot(slotIndex) {
  const candidateOrder = Array.isArray(state.playlistReorderHoldCandidateOrder) ? playlistReorderHoldCandidateOrder : [];
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= candidateOrder.length) return null;
  return candidateOrder[slotIndex];
}

export function applyPlaylistReorderPreviewOrder(slotIndex = state.playlistReorderHoldCurrentSlot) {
  if (!zonesContainer) return;
  const sourcePlaylistIndex = _deps.normalizePlaylistTrackIndex(state.playlistReorderHoldPlaylistIndex);
  if (sourcePlaylistIndex === null) return;

  const initialOrder = Array.isArray(state.playlistReorderHoldInitialVisibleOrder)
    ? playlistReorderHoldInitialVisibleOrder
    : [];
  if (!initialOrder.length || !initialOrder.includes(sourcePlaylistIndex)) return;

  const orderWithoutSource = initialOrder.filter((playlistIndex) => playlistIndex !== sourcePlaylistIndex);
  const normalizedSlot = Number.isInteger(slotIndex)
    ? Math.max(0, Math.min(slotIndex, orderWithoutSource.length))
    : 0;
  const nextOrder = orderWithoutSource.slice();
  nextOrder.splice(normalizedSlot, 0, sourcePlaylistIndex);
  const nextSignature = nextOrder.join('|');
  if (nextSignature === state.playlistReorderHoldPreviewSignature) return;
  state.playlistReorderHoldPreviewSignature = nextSignature;

  const zones = Array.from(zonesContainer.querySelectorAll('.zone'));
  const zoneByIndex = new Map();
  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (!Number.isInteger(zoneIndex) || zoneIndex < 0) return;
    zoneByIndex.set(zoneIndex, zone);
  });

  const appended = new Set();
  const fragment = document.createDocumentFragment();
  nextOrder.forEach((playlistIndex) => {
    const zone = zoneByIndex.get(playlistIndex);
    if (!zone) return;
    fragment.appendChild(zone);
    appended.add(playlistIndex);
  });

  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (Number.isInteger(zoneIndex) && appended.has(zoneIndex)) return;
    fragment.appendChild(zone);
  });

  zonesContainer.appendChild(fragment);
}

export function restorePlaylistReorderPreviewOrder() {
  if (!zonesContainer) return;
  const initialOrder = Array.isArray(state.playlistReorderHoldInitialVisibleOrder)
    ? playlistReorderHoldInitialVisibleOrder
    : [];
  if (!initialOrder.length) return;
  const initialSignature = initialOrder.join('|');
  if (initialSignature === state.playlistReorderHoldPreviewSignature) return;

  const zones = Array.from(zonesContainer.querySelectorAll('.zone'));
  const zoneByIndex = new Map();
  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (!Number.isInteger(zoneIndex) || zoneIndex < 0) return;
    zoneByIndex.set(zoneIndex, zone);
  });

  const appended = new Set();
  const fragment = document.createDocumentFragment();
  initialOrder.forEach((playlistIndex) => {
    const zone = zoneByIndex.get(playlistIndex);
    if (!zone) return;
    fragment.appendChild(zone);
    appended.add(playlistIndex);
  });

  zones.forEach((zone) => {
    const zoneIndex = Number.parseInt(zone.dataset.zoneIndex || '', 10);
    if (Number.isInteger(zoneIndex) && appended.has(zoneIndex)) return;
    fragment.appendChild(zone);
  });

  zonesContainer.appendChild(fragment);
  state.playlistReorderHoldPreviewSignature = initialSignature;
}

export function clearPlaylistReorderHold({ resetTriggered = true, preservePreview = false } = {}) {
  if (state.playlistReorderHoldTimer !== null) {
    clearTimeout(state.playlistReorderHoldTimer);
    state.playlistReorderHoldTimer = null;
  }

  if (
    state.playlistReorderHoldTarget &&
    state.playlistReorderHoldPointerId !== null &&
    typeof state.playlistReorderHoldTarget.releasePointerCapture === 'function'
  ) {
    try {
      if (
        state.playlistReorderHoldTarget.hasPointerCapture &&
        state.playlistReorderHoldTarget.hasPointerCapture(state.playlistReorderHoldPointerId)
      ) {
        state.playlistReorderHoldTarget.releasePointerCapture(state.playlistReorderHoldPointerId);
      }
    } catch (err) {
      // ignore pointer capture release errors
    }
  }

  if (zonesContainer) {
    zonesContainer.classList.remove('is-playlist-reordering');
  }
  if (!preservePreview) {
    restorePlaylistReorderPreviewOrder();
  }
  if (state.playlistReorderHoldSourceZone) {
    state.playlistReorderHoldSourceZone.classList.remove('zone--playlist-reorder-source');
  }
  clearPlaylistReorderTargetVisual();
  removePlaylistReorderHoldListeners();
  state.playlistReorderHoldPointerId = null;
  state.playlistReorderHoldStartX = 0;
  state.playlistReorderHoldStartY = 0;
  state.playlistReorderHoldPlaylistIndex = null;
  state.playlistReorderHoldTarget = null;
  state.playlistReorderHoldSourceZone = null;
  state.playlistReorderHoldTargetPlaylistIndex = null;
  state.playlistReorderHoldInitialVisibleOrder = null;
  state.playlistReorderHoldCandidateOrder = null;
  state.playlistReorderHoldCandidateCenters = null;
  state.playlistReorderHoldCurrentSlot = null;
  state.playlistReorderHoldPreviewSignature = '';
  if (resetTriggered) {
    state.playlistReorderHoldTriggered = false;
  }
}

export function updatePlaylistReorderHoldTarget(clientX) {
  const nextSlot = resolvePlaylistReorderSlotFromPointer(clientX);
  const nextTargetPlaylistIndex = getPlaylistReorderTargetPlaylistBySlot(nextSlot);
  const nextTargetZone =
    zonesContainer && nextTargetPlaylistIndex !== null
      ? zonesContainer.querySelector(`.zone[data-zone-index="${nextTargetPlaylistIndex}"]`)
      : null;
  if (state.playlistReorderHoldTargetZone && state.playlistReorderHoldTargetZone !== nextTargetZone) {
    state.playlistReorderHoldTargetZone.classList.remove('zone--playlist-reorder-target');
  }

  state.playlistReorderHoldCurrentSlot = nextSlot;
  state.playlistReorderHoldTargetZone = nextTargetZone;
  state.playlistReorderHoldTargetPlaylistIndex = nextTargetPlaylistIndex;
  if (nextTargetZone) {
    nextTargetZone.classList.add('zone--playlist-reorder-target');
  }
  applyPlaylistReorderPreviewOrder(nextSlot);
}

export function onPlaylistReorderHoldPointerMove(event) {
  if (state.playlistReorderHoldPointerId === null || event.pointerId !== state.playlistReorderHoldPointerId) return;
  if (!state.playlistReorderHoldTriggered) {
    const deltaX = event.clientX - state.playlistReorderHoldStartX;
    const deltaY = event.clientY - state.playlistReorderHoldStartY;
    if (Math.hypot(deltaX, deltaY) <= PLAYLIST_REORDER_POINTER_MOVE_TOLERANCE_PX) return;
    clearPlaylistReorderHold();
    return;
  }

  event.preventDefault();
  if (state.zonesPanActive) {
    cleanupZonesPanInteraction();
  }
  if (zonesContainer) {
    const rect = zonesContainer.getBoundingClientRect();
    const edgeThreshold = 52;
    if (event.clientX <= rect.left + edgeThreshold) {
      zonesContainer.scrollLeft -= 8;
    } else if (event.clientX >= rect.right - edgeThreshold) {
      zonesContainer.scrollLeft += 8;
    }
  }
  updatePlaylistReorderHoldTarget(event.clientX);
}

export function onPlaylistReorderHoldPointerEnd(event) {
  if (state.playlistReorderHoldPointerId === null || event.pointerId !== state.playlistReorderHoldPointerId) return;
  const shouldReorder = state.playlistReorderHoldTriggered;
  const sourcePlaylistIndex = state.playlistReorderHoldPlaylistIndex;
  const targetPlaylistIndex = state.playlistReorderHoldTargetPlaylistIndex;
  clearPlaylistReorderHold({ preservePreview: true });
  if (!shouldReorder) return;
  event.preventDefault();
  event.stopPropagation();
  if (!Number.isInteger(sourcePlaylistIndex)) return;
  if (targetPlaylistIndex !== null && !Number.isInteger(targetPlaylistIndex)) return;
  reorderPlaylistsByHeaderDrag(sourcePlaylistIndex, targetPlaylistIndex).catch((err) => {
    console.error(err);
    setStatus('Не удалось изменить порядок плей-листов.');
  });
}

export function onPlaylistReorderHoldPointerCancel(event) {
  if (state.playlistReorderHoldPointerId === null || event.pointerId !== state.playlistReorderHoldPointerId) return;
  clearPlaylistReorderHold();
}

export function startPlaylistReorderHold(event, playlistIndex) {
  if (!isHostRole()) return;
  if (event.isPrimary === false) return;
  if (event.button !== undefined && event.button !== 0) return;
  if (state.touchCopyDragActive || state.draggingCard) return;
  if (!Number.isInteger(playlistIndex) || playlistIndex < 0 || playlistIndex >= state.layout.length) return;

  const targetElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!targetElement) return;

  const eventTarget = event.target instanceof Element ? event.target : null;
  if (eventTarget && eventTarget.closest('.playlist-header-control, .playlist-delete-btn')) return;

  clearPlaylistReorderHold();
  state.playlistReorderHoldPointerId = event.pointerId;
  state.playlistReorderHoldStartX = event.clientX;
  state.playlistReorderHoldStartY = event.clientY;
  state.playlistReorderHoldPlaylistIndex = playlistIndex;
  state.playlistReorderHoldTarget = targetElement;
  state.playlistReorderHoldSourceZone = targetElement.closest('.zone');
  state.playlistReorderHoldTargetPlaylistIndex = null;
  state.playlistReorderHoldInitialVisibleOrder = null;
  state.playlistReorderHoldCandidateOrder = null;
  state.playlistReorderHoldCandidateCenters = null;
  state.playlistReorderHoldCurrentSlot = null;
  state.playlistReorderHoldPreviewSignature = '';
  state.playlistReorderHoldTriggered = false;

  if (typeof targetElement.setPointerCapture === 'function') {
    try {
      targetElement.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore pointer capture errors
    }
  }

  window.addEventListener('pointermove', onPlaylistReorderHoldPointerMove, true);
  window.addEventListener('pointerup', onPlaylistReorderHoldPointerEnd, true);
  window.addEventListener('pointercancel', onPlaylistReorderHoldPointerCancel, true);

  state.playlistReorderHoldTimer = setTimeout(() => {
    state.playlistReorderHoldTimer = null;
    const sourceIndex = state.playlistReorderHoldPlaylistIndex;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= state.layout.length) {
      clearPlaylistReorderHold();
      return;
    }
    const initialOrder = getPlaylistReorderVisibleOrderFromDom();
    if (!initialOrder.includes(sourceIndex)) {
      clearPlaylistReorderHold();
      return;
    }
    state.playlistReorderHoldInitialVisibleOrder = initialOrder;
    const candidateOrder = initialOrder.filter((playlistIdx) => playlistIdx !== sourceIndex);
    const pointerContentX = getPlaylistReorderPointerContentX(state.playlistReorderHoldStartX);
    if (!Number.isFinite(pointerContentX) && !candidateOrder.length) {
      clearPlaylistReorderHold();
      return;
    }
    const candidateCenters = candidateOrder.map((playlistIdx) => {
      if (!zonesContainer) return null;
      const zone = zonesContainer.querySelector(`.zone[data-zone-index="${playlistIdx}"]`);
      if (!(zone instanceof HTMLElement)) return null;
      const rect = zone.getBoundingClientRect();
      const containerRect = zonesContainer.getBoundingClientRect();
      return rect.left - containerRect.left + zonesContainer.scrollLeft + rect.width / 2;
    });
    if (candidateCenters.some((centerX) => !Number.isFinite(centerX))) {
      clearPlaylistReorderHold();
      return;
    }
    state.playlistReorderHoldCandidateOrder = candidateOrder;
    state.playlistReorderHoldCandidateCenters = candidateCenters;
    const sourceSlot = initialOrder.indexOf(sourceIndex);
    state.playlistReorderHoldCurrentSlot = sourceSlot >= 0 ? Math.min(sourceSlot, candidateOrder.length) : 0;
    state.playlistReorderHoldTargetPlaylistIndex = getPlaylistReorderTargetPlaylistBySlot(state.playlistReorderHoldCurrentSlot);

    state.playlistReorderHoldTriggered = true;
    if (state.zonesPanActive) {
      cleanupZonesPanInteraction();
    }
    stopZonesPanMomentum();
    if (zonesContainer) {
      zonesContainer.classList.add('is-playlist-reordering');
    }
    if (state.playlistReorderHoldSourceZone && state.playlistReorderHoldSourceZone.isConnected) {
      state.playlistReorderHoldSourceZone.classList.add('zone--playlist-reorder-source');
    }
    updatePlaylistReorderHoldTarget(state.playlistReorderHoldStartX);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
      focused.blur();
    }
    setStatus('Режим переноса: перетащите плей-лист влево или вправо.');
  }, PLAYLIST_REORDER_HOLD_MS);
}
