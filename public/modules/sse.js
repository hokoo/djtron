// public/modules/sse.js — SSE layout stream management
import { state, LAYOUT_STREAM_RETRY_MS } from './state.js';

export function createLayoutStream({ onLayout, onPlayback, onAuthUsers, onPlaybackCommand, onError, onOpen }) {
  if (typeof EventSource === 'undefined') return;
  if (state.layoutStream) return;

  const stream = new EventSource('/api/layout/stream');
  state.layoutStream = stream;

  stream.addEventListener('layout', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (onLayout) onLayout(payload);
  });

  stream.addEventListener('playback', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (onPlayback) onPlayback(payload);
  });

  stream.addEventListener('auth-users', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (onAuthUsers) onAuthUsers(payload);
  });

  stream.addEventListener('playback-command', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (onPlaybackCommand) onPlaybackCommand(payload);
  });

  stream.onerror = () => {
    if (state.layoutStream !== stream) return;
    stream.close();
    state.layoutStream = null;
    if (onError) onError();
  };

  if (onOpen) {
    stream.onopen = () => onOpen();
  }
}

export function closeLayoutStream() {
  if (state.layoutStream) {
    state.layoutStream.close();
    state.layoutStream = null;
  }
  if (state.layoutStreamReconnectTimer !== null) {
    clearTimeout(state.layoutStreamReconnectTimer);
    state.layoutStreamReconnectTimer = null;
  }
}

export function scheduleReconnect(connectFn, delayMs) {
  if (state.layoutStreamReconnectTimer !== null) return;
  state.layoutStreamReconnectTimer = setTimeout(() => {
    state.layoutStreamReconnectTimer = null;
    connectFn();
  }, delayMs !== undefined ? delayMs : LAYOUT_STREAM_RETRY_MS);
}
