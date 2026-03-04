'use strict';

/**
 * DspJobManager — facade between HTTP transport and the DSP processing pipeline.
 *
 * Encapsulates queue/cache/transition management behind a clean interface
 * so HTTP handlers never touch DSP internals directly.
 */
class DspJobManager {
  /**
   * @param {object} deps
   * @param {function} deps.enqueue - (fromFile, toFile, options) => result
   * @param {function} deps.getTransitionByPair - (from, to, opts) => { ok, error, item, descriptor }
   * @param {function} deps.getQueueSummary - () => summary object
   * @param {function} deps.serializeTransition - (item) => serialized | null
   * @param {function} deps.getTransitions - () => Map iterator (dspTransitions.values())
   * @param {function} deps.scheduleFromLayout - (layout, options) => stats
   * @param {function} deps.resolveOutputPath - (id) => string | null
   * @param {function} deps.buildOutputUrl - (id) => string
   * @param {function} deps.ensureReady - () => Promise<void>
   * @param {boolean} deps.enabled - DSP_ENABLED
   * @param {string} deps.STATUS_READY - DSP_STATUS_READY constant
   */
  constructor(deps) {
    this._enqueue = deps.enqueue;
    this._getTransitionByPair = deps.getTransitionByPair;
    this._getQueueSummary = deps.getQueueSummary;
    this._serializeTransition = deps.serializeTransition;
    this._getTransitions = deps.getTransitions;
    this._scheduleFromLayout = deps.scheduleFromLayout;
    this._resolveOutputPath = deps.resolveOutputPath;
    this._buildOutputUrl = deps.buildOutputUrl;
    this._ensureReady = deps.ensureReady;
    this.enabled = deps.enabled;
    this._STATUS_READY = deps.STATUS_READY;
  }

  /** Ensure ffmpeg/ffprobe are available (async probe). */
  async ensureReady() {
    if (this.enabled) {
      await this._ensureReady();
    }
  }

  /** Get queue summary (counts, config flags). */
  getQueueSummary() {
    return this._getQueueSummary();
  }

  /** Serialize a transition item for API response. */
  serializeTransition(item) {
    return this._serializeTransition(item);
  }

  /**
   * Look up a single transition by from/to pair.
   * @returns {{ ok, error, item, descriptor }}
   */
  getTransitionByPair(fromFile, toFile, options) {
    return this._getTransitionByPair(fromFile, toFile, options || {});
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
      status: this._STATUS_READY,
      transitionSeconds: descriptor.transitionSeconds,
      sliceSeconds: descriptor.sliceSeconds,
      attempts: 0,
      error: null,
      outputUrl: this._buildOutputUrl(descriptor.id),
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
    return Array.from(this._getTransitions())
      .sort((left, right) => {
        const leftUpdated = Number.isFinite(left.updatedAt) ? left.updatedAt : 0;
        const rightUpdated = Number.isFinite(right.updatedAt) ? right.updatedAt : 0;
        return rightUpdated - leftUpdated;
      })
      .slice(0, limit)
      .map((item) => this._serializeTransition(item))
      .filter(Boolean);
  }

  /**
   * Enqueue a single transition.
   * @returns {{ ok, created, enqueued, error, item }}
   */
  enqueue(fromFile, toFile, options) {
    return this._enqueue(fromFile, toFile, options || {});
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
      const result = this._enqueue(entry.fromFile, entry.toFile, {
        force,
        transitionSeconds,
        sliceSeconds,
        source: sourceLabel,
        priority,
      });
      if (!result.ok || !result.item) {
        failed += 1;
        return;
      }
      if (result.created) created += 1;
      if (result.enqueued) enqueued += 1;
      transitions.push(this._serializeTransition(result.item));
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
      queue: this._getQueueSummary(),
      transitions: transitions.slice(0, 200),
    };
  }

  /**
   * Schedule transitions from a layout (delegates to server.js function).
   */
  scheduleFromLayout(layout, options) {
    return this._scheduleFromLayout(layout, options);
  }

  /**
   * Resolve output file path for a transition by id.
   * @returns {string|null}
   */
  resolveOutputPath(id) {
    return this._resolveOutputPath(id);
  }

  /** @private — collect adjacent layout transitions for batch processing. */
  _collectAdjacentTransitions(layout, playlistDspFlags) {
    // Delegate to the same function used by scheduleFromLayout
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
