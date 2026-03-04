'use strict';

const { DSP_STATUS_READY } = require('./constants');
const { buildDspTransitionOutputUrl, resolveDspTransitionOutputPathById } = require('./descriptor');
const { appendDspLog, initializeDspLogFile } = require('./log');
const { loadDspTempoCache } = require('./tempo');
const { buildDspQueueSummary, serializeDspTransition } = require('./queue');
const { ensureFfmpegAvailable, enqueueDspTransition, scheduleDspTransitionsFromLayout, getDspTransitionByPair } = require('./enqueue');

/**
 * DspJobManager — owns the DSP processing pipeline.
 *
 * Holds all DSP state (queues, caches, transitions) and delegates
 * to extracted module functions for the actual logic.
 */
class DspJobManager {
  /**
   * @param {object} params
   * @param {object} params.config - all DSP_* configuration constants
   * @param {object} params.deps - external utilities (fs, path, crypto, execFileAsync, etc.)
   */
  constructor({ config, deps }) {
    this._cfg = config;
    this.enabled = config.DSP_ENABLED;

    // Internal state — previously global variables in server.js
    this._state = {
      dspTransitions: new Map(),
      dspQueue: [],
      dspWorkerScheduled: false,
      dspWorkerRunning: false,
      dspProbeState: {
        checkedAt: 0,
        available: null,
        error: null,
      },
      dspTempoCache: new Map(),
      dspSilenceTrimCache: new Map(),
      dspEnergyTrimCache: new Map(),
      dspLogWriteErrorShown: false,
    };

    // Extend deps with bound ensureFfmpegAvailable for queue.js
    this._deps = Object.assign({}, deps, {
      ensureFfmpegAvailable: () => ensureFfmpegAvailable(this._state, this._cfg, deps),
    });

    // Initialize log rotation and load tempo cache
    initializeDspLogFile(this._cfg, this._deps);
    loadDspTempoCache(this._state, this._cfg, this._deps);
  }

  /** Ensure ffmpeg/ffprobe are available (async probe). */
  async ensureReady() {
    if (this.enabled) {
      await ensureFfmpegAvailable(this._state, this._cfg, this._deps);
    }
  }

  /** Get queue summary (counts, config flags). */
  getQueueSummary() {
    return buildDspQueueSummary(this._state, this._cfg);
  }

  /** Serialize a transition item for API response. */
  serializeTransition(item) {
    return serializeDspTransition(item);
  }

  /**
   * Look up a single transition by from/to pair.
   * @returns {{ ok, error, item, descriptor }}
   */
  getTransitionByPair(fromFile, toFile, options) {
    return getDspTransitionByPair(fromFile, toFile, options || {}, this._state, this._cfg, this._deps);
  }

  /**
   * Build a "missing" transition stub for API response when no item exists.
   */
  buildMissingTransitionStub(descriptor) {
    return {
      id: descriptor.id,
      fromFile: descriptor.fromFile,
      toFile: descriptor.toFile,
      status: 'missing',
      transitionSeconds: descriptor.transitionSeconds,
      sliceSeconds: descriptor.sliceSeconds,
      attempts: 0,
      error: null,
      outputUrl: null,
      outputFileName: null,
      outputSizeBytes: null,
      sourceMtimeMs: null,
      createdAt: null,
      updatedAt: null,
      lastRequestedAt: null,
    };
  }

  /**
   * Build an "inferred ready" transition stub (file exists but no queue item).
   */
  buildInferredReadyStub(descriptor) {
    return {
      id: descriptor.id,
      fromFile: descriptor.fromFile,
      toFile: descriptor.toFile,
      status: DSP_STATUS_READY,
      transitionSeconds: descriptor.transitionSeconds,
      sliceSeconds: descriptor.sliceSeconds,
      attempts: 0,
      error: null,
      outputUrl: buildDspTransitionOutputUrl(descriptor.id),
      outputFileName: descriptor.outputFileName,
      outputSizeBytes: null,
      sourceMtimeMs: null,
      createdAt: null,
      updatedAt: null,
      lastRequestedAt: null,
    };
  }

  /**
   * List transitions sorted by updatedAt desc.
   * @param {number} limit - max items to return
   * @returns {Array}
   */
  listTransitions(limit) {
    return Array.from(this._state.dspTransitions.values())
      .sort((left, right) => {
        const leftUpdated = Number.isFinite(left.updatedAt) ? left.updatedAt : 0;
        const rightUpdated = Number.isFinite(right.updatedAt) ? right.updatedAt : 0;
        return rightUpdated - leftUpdated;
      })
      .slice(0, limit)
      .map((item) => serializeDspTransition(item))
      .filter(Boolean);
  }

  /**
   * Enqueue a single transition.
   * @returns {{ ok, created, enqueued, error, item }}
   */
  enqueue(fromFile, toFile, options) {
    return enqueueDspTransition(fromFile, toFile, options || {}, this._state, this._cfg, this._deps);
  }

  /**
   * Enqueue batch of transitions from a POST request body.
   * @param {object} body - request body
   * @param {object} layoutState - { layout, playlistDsp } for fromLayout mode
   * @returns {{ request, summary, queue, transitions }}
   */
  enqueueBatch(body, layoutState) {
    const force = Boolean(body.force);
    const transitionSeconds = body.transitionSeconds;
    const sliceSeconds = body.sliceSeconds;
    const priority = body.priority === 'high' ? 'high' : 'normal';
    const sourceLabel = typeof body.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 64) : 'api';
    const requestTransitions = [];

    if (typeof body.from === 'string' || typeof body.to === 'string') {
      if (typeof body.from !== 'string' || typeof body.to !== 'string') {
        return { error: 'Для одиночного transition нужны оба поля: from и to.' };
      }
      requestTransitions.push({ fromFile: body.from, toFile: body.to });
    }

    if (Array.isArray(body.transitions)) {
      for (const entry of body.transitions) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.from !== 'string' || typeof entry.to !== 'string') continue;
        requestTransitions.push({ fromFile: entry.from, toFile: entry.to });
        if (requestTransitions.length >= 2000) break;
      }
    }

    const includeLayout = Boolean(body.fromLayout) || requestTransitions.length === 0;
    if (includeLayout && layoutState) {
      const layoutTransitions = this._collectAdjacentTransitions(layoutState.layout, layoutState.playlistDsp);
      layoutTransitions.forEach((entry) => requestTransitions.push(entry));
    }

    if (!requestTransitions.length) {
      return { error: 'Не переданы transition-пары для обработки.' };
    }

    const dedupe = new Set();
    const accepted = [];
    requestTransitions.forEach((entry) => {
      const fromFile = typeof entry.fromFile === 'string' ? entry.fromFile.trim() : '';
      const toFile = typeof entry.toFile === 'string' ? entry.toFile.trim() : '';
      if (!fromFile || !toFile) return;
      const key = `${fromFile}\n${toFile}`;
      if (dedupe.has(key)) return;
      dedupe.add(key);
      accepted.push({ fromFile, toFile });
    });

    let created = 0;
    let enqueued = 0;
    let failed = 0;
    const transitions = [];

    accepted.forEach((entry) => {
      const result = enqueueDspTransition(entry.fromFile, entry.toFile, {
        force,
        transitionSeconds,
        sliceSeconds,
        source: sourceLabel,
        priority,
      }, this._state, this._cfg, this._deps);
      if (!result.ok || !result.item) {
        failed += 1;
        return;
      }
      if (result.created) created += 1;
      if (result.enqueued) enqueued += 1;
      transitions.push(serializeDspTransition(result.item));
    });

    return {
      request: {
        totalPairs: requestTransitions.length,
        uniquePairs: accepted.length,
        force,
        priority,
        source: sourceLabel,
        fromLayout: includeLayout,
      },
      summary: { created, enqueued, failed },
      queue: buildDspQueueSummary(this._state, this._cfg),
      transitions: transitions.slice(0, 200),
    };
  }

  /**
   * Schedule transitions from a layout.
   */
  scheduleFromLayout(layout, options) {
    return scheduleDspTransitionsFromLayout(layout, options, this._state, this._cfg, this._deps);
  }

  /**
   * Resolve output file path for a transition by id.
   * @returns {string|null}
   */
  resolveOutputPath(id) {
    return resolveDspTransitionOutputPathById(id, this._state, this._cfg, this._deps);
  }

  /**
   * Append a DSP log entry (exposed for handler-level logging).
   */
  appendLog(eventName, payload) {
    appendDspLog(eventName, payload, this._state, this._cfg, this._deps);
  }

  /**
   * Return the number of entries in the tempo cache.
   */
  getTempoCacheSize() {
    return this._state.dspTempoCache.size;
  }

  /** @private — collect adjacent layout transitions for batch processing. */
  _collectAdjacentTransitions(layout, playlistDspFlags) {
    if (!Array.isArray(layout)) return [];
    const seen = new Set();
    const transitions = [];

    layout.forEach((playlist, playlistIndex) => {
      if (Array.isArray(playlistDspFlags) && !Boolean(playlistDspFlags[playlistIndex])) return;
      if (!Array.isArray(playlist) || playlist.length < 2) return;

      for (let index = 0; index < playlist.length - 1; index += 1) {
        const fromRaw = typeof playlist[index] === 'string' ? playlist[index].trim() : '';
        const toRaw = typeof playlist[index + 1] === 'string' ? playlist[index + 1].trim() : '';
        if (!fromRaw || !toRaw) continue;

        const dedupeKey = `${fromRaw}\n${toRaw}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        transitions.push({ fromFile: fromRaw, toFile: toRaw });
      }
    });

    return transitions;
  }
}

module.exports = { DspJobManager };
