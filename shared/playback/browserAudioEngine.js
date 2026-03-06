import { AudioEngine } from './audioEngine.js';

/**
 * Browser implementation of AudioEngine using HTML5 Audio API.
 * Manages real audio playback with crossfade, volume control, and events.
 */
export class BrowserAudioEngine extends AudioEngine {
  constructor(options = {}) {
    super();
    this.currentAudio = null;
    this.currentSegment = null;
    this.fadingOutAudio = null;
    this.volume = 1.0;
    this.overlapSeconds = 0;
    this.fadeCurve = 'linear'; // 'linear' | 'ease'
    this.stopFadeSeconds = 0;
    this._listeners = {};
    this._progressRAF = null;
    this._fadeTimer = null;
    this._disposed = false;
  }

  // --- Event emitter ---

  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
    return this;
  }

  _emit(event, data) {
    const list = this._listeners[event];
    if (list) list.forEach(fn => { try { fn(data); } catch(e) { console.error(e); } });
  }

  // --- Configuration ---

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.currentAudio && !this._isFading) {
      this.currentAudio.volume = this.volume;
    }
  }

  setOverlap(seconds, curve = 'linear') {
    this.overlapSeconds = Math.max(0, seconds);
    this.fadeCurve = curve;
  }

  setStopFade(seconds) {
    this.stopFadeSeconds = Math.max(0, seconds);
  }

  cancelFade() {
    this._cancelFade();
    this._isFading = false;
    this.fadingOutAudio = null;
  }

  crossfade(outAudio, inAudio, targetVolume, durationSeconds) {
    this._crossfade(outAudio, inAudio, targetVolume, durationSeconds);
  }

  fadeOut(audio, durationSeconds, onComplete) {
    this._fadeOut(audio, durationSeconds, onComplete);
  }

  // --- Core playback (implements AudioEngine interface) ---

  play(segment) {
    super.play(segment);
    this.currentSegment = this.normalizeSegment(segment);

    const previousAudio = this.currentAudio;
    const useOverlap = previousAudio && !previousAudio.paused
      && this.overlapSeconds > 0
      && this.currentSegment.overlapAllowed;

    const audio = this._createAudio(this.currentSegment.src);

    if (useOverlap) {
      audio.volume = 0;
      this._crossfade(previousAudio, audio, this.volume, this.overlapSeconds);
    } else {
      if (previousAudio) this._hardStop(previousAudio);
      audio.volume = this.volume;
    }

    this.currentAudio = audio;
    this._bindAudioEvents(audio, this.currentSegment);
    this._startProgressLoop();

    const playPromise = audio.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(err => {
        this._emit('error', { segment: this.currentSegment, error: err });
      });
    }

    return this.getActiveSources();
  }

  pause() {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
      this._stopProgressLoop();
      this._emit('pause', { segment: this.currentSegment });
      return true;
    }
    return false;
  }

  resume() {
    if (this.currentAudio && this.currentAudio.paused) {
      const p = this.currentAudio.play();
      if (p && p.catch) p.catch(err => this._emit('error', { segment: this.currentSegment, error: err }));
      this._startProgressLoop();
      this._emit('resume', { segment: this.currentSegment });
      return true;
    }
    return false;
  }

  stopAll() {
    super.stopAll();
    this._cancelFade();

    if (this.stopFadeSeconds > 0 && this.currentAudio && !this.currentAudio.paused) {
      this._fadeOut(this.currentAudio, this.stopFadeSeconds, () => {
        this._hardStop(this.currentAudio);
        this.currentAudio = null;
        this.currentSegment = null;
        this._emit('stopped', {});
      });
    } else {
      if (this.currentAudio) this._hardStop(this.currentAudio);
      if (this.fadingOutAudio) this._hardStop(this.fadingOutAudio);
      this.currentAudio = null;
      this.fadingOutAudio = null;
      this.currentSegment = null;
      this._emit('stopped', {});
    }
    this._stopProgressLoop();
  }

  seekTo(seconds) {
    if (this.currentAudio && isFinite(seconds)) {
      this.currentAudio.currentTime = Math.max(0, Math.min(seconds, this.currentAudio.duration || 0));
    }
  }

  seekToRatio(ratio) {
    if (this.currentAudio && this.currentAudio.duration) {
      this.seekTo(ratio * this.currentAudio.duration);
    }
  }

  getCurrentTime() {
    return this.currentAudio ? this.currentAudio.currentTime : 0;
  }

  getDuration() {
    return this.currentAudio ? (this.currentAudio.duration || 0) : 0;
  }

  isPaused() {
    return this.currentAudio ? this.currentAudio.paused : true;
  }

  isPlaying() {
    return this.currentAudio ? !this.currentAudio.paused : false;
  }

  // --- Internal: Audio object management ---

  _createAudio(src) {
    const audio = new Audio(src);
    audio.preload = 'metadata';
    return audio;
  }

  _bindAudioEvents(audio, segment) {
    audio._djSegment = segment;

    audio.addEventListener('ended', () => {
      if (audio !== this.currentAudio) return;
      this._stopProgressLoop();
      this._emit('ended', { segment });
    });

    audio.addEventListener('error', () => {
      if (audio !== this.currentAudio) return;
      this._stopProgressLoop();
      this._emit('error', { segment, error: audio.error });
    });

    audio.addEventListener('loadedmetadata', () => {
      if (audio !== this.currentAudio) return;
      this._emit('loaded', { segment, duration: audio.duration });
    });
  }

  _hardStop(audio) {
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
      audio.load();
    } catch (_) { /* ignore */ }
  }

  // --- Internal: Crossfade ---

  _crossfade(outAudio, inAudio, targetVolume, durationSeconds) {
    this._cancelFade();
    this._isFading = true;
    if (this.fadingOutAudio) this._hardStop(this.fadingOutAudio);
    this.fadingOutAudio = outAudio;

    const steps = Math.max(1, Math.round(durationSeconds * 30)); // ~30fps
    const interval = (durationSeconds * 1000) / steps;
    const startVolume = outAudio.volume;
    let step = 0;

    this._fadeTimer = setInterval(() => {
      step++;
      const progress = step / steps;
      const curved = this.fadeCurve === 'ease'
        ? progress * progress * (3 - 2 * progress) // smoothstep
        : progress;

      inAudio.volume = curved * targetVolume;
      outAudio.volume = startVolume * (1 - curved);

      if (step >= steps) {
        this._cancelFade();
        this._isFading = false;
        inAudio.volume = targetVolume;
        this._hardStop(outAudio);
        this.fadingOutAudio = null;
      }
    }, interval);
  }

  _fadeOut(audio, durationSeconds, onComplete) {
    this._cancelFade();
    this._isFading = true;
    const steps = Math.max(1, Math.round(durationSeconds * 30));
    const interval = (durationSeconds * 1000) / steps;
    const startVolume = audio.volume;
    let step = 0;

    this._fadeTimer = setInterval(() => {
      step++;
      const progress = step / steps;
      audio.volume = startVolume * (1 - progress);

      if (step >= steps) {
        this._cancelFade();
        this._isFading = false;
        if (onComplete) onComplete();
      }
    }, interval);
  }

  _cancelFade() {
    if (this._fadeTimer) {
      clearInterval(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  // --- Internal: Progress loop ---

  _startProgressLoop() {
    this._stopProgressLoop();
    const tick = () => {
      if (!this.currentAudio || this.currentAudio.paused) return;
      this._emit('timeupdate', {
        currentTime: this.currentAudio.currentTime,
        duration: this.currentAudio.duration || 0,
        segment: this.currentSegment,
      });
      this._progressRAF = requestAnimationFrame(tick);
    };
    this._progressRAF = requestAnimationFrame(tick);
  }

  _stopProgressLoop() {
    if (this._progressRAF) {
      cancelAnimationFrame(this._progressRAF);
      this._progressRAF = null;
    }
  }

  // --- Cleanup ---

  dispose() {
    this._disposed = true;
    this.stopAll();
    this._listeners = {};
  }
}
