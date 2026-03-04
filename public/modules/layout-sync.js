/**
 * LayoutSync — SSE client for real-time layout/playback state synchronization.
 * Connects to /api/layout/stream, emits events on state changes.
 */

export class LayoutSync {
  constructor({ onLayoutUpdate, onPlaybackUpdate, onAuthUpdate, onError, onOpen, onClose } = {}) {
    this.onLayoutUpdate = onLayoutUpdate || (() => {});
    this.onPlaybackUpdate = onPlaybackUpdate || (() => {});
    this.onAuthUpdate = onAuthUpdate || (() => {});
    this.onError = onError || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
    this._es = null;
    this._reconnectTimer = null;
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 30000;
    this._disposed = false;
  }

  connect() {
    this.disconnect();
    if (this._disposed) return;

    this._es = new EventSource('/api/layout/stream');

    this._es.onopen = () => {
      this._reconnectDelay = 1000;
      this.onOpen();
    };

    this._es.addEventListener('layout', (e) => {
      try {
        this.onLayoutUpdate(JSON.parse(e.data));
      } catch (err) {
        console.error('LayoutSync: layout parse error', err);
      }
    });

    this._es.addEventListener('playback', (e) => {
      try {
        this.onPlaybackUpdate(JSON.parse(e.data));
      } catch (err) {
        console.error('LayoutSync: playback parse error', err);
      }
    });

    this._es.addEventListener('auth', (e) => {
      try {
        this.onAuthUpdate(JSON.parse(e.data));
      } catch (err) {
        console.error('LayoutSync: auth parse error', err);
      }
    });

    this._es.onmessage = (e) => {
      // Generic message (backwards compat with current server format)
      try {
        const data = JSON.parse(e.data);
        if (data.layout !== undefined) this.onLayoutUpdate(data);
        if (data.playbackState !== undefined) this.onPlaybackUpdate(data);
      } catch (_) { /* non-JSON or unrecognized */ }
    };

    this._es.onerror = () => {
      this.onError();
      this._scheduleReconnect();
    };
  }

  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._es) {
      this._es.close();
      this._es = null;
      this.onClose();
    }
  }

  _scheduleReconnect() {
    if (this._disposed) return;
    this._reconnectTimer = setTimeout(() => {
      this.connect();
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
  }

  dispose() {
    this._disposed = true;
    this.disconnect();
  }
}
