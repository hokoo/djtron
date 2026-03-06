'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DspJobManager } = require('../src/dsp/DspJobManager');

function createTestConfig(overrides = {}) {
  return {
    DSP_ENABLED: true,
    DSP_FFMPEG_BINARY: 'ffmpeg',
    DSP_FFPROBE_BINARY: 'ffprobe',
    DSP_TRANSITION_OUTPUT_FORMAT: 'mp3',
    DSP_TRANSITION_OUTPUT_CODEC: 'libmp3lame',
    DSP_DEFAULT_TRANSITION_SECONDS: 5,
    DSP_DEFAULT_SLICE_SECONDS: 15,
    DSP_JOB_TIMEOUT_MS: 90000,
    DSP_MAX_QUEUE_LENGTH: 500,
    DSP_HISTORY_LIMIT: 2000,
    DSP_PROBE_CACHE_MS: 60000,
    DSP_LOG_PATH: '/tmp/dsp-test.log',
    DSP_LOG_MAX_BYTES: 4 * 1024 * 1024,
    DSP_CACHE_DIR: '/tmp/dsp-cache',
    DSP_TRANSITIONS_DIR: '/tmp/dsp-cache/transitions',
    DSP_TEMPO_CACHE_PATH: '/tmp/dsp-cache/tempo-cache.json',
    DSP_TEMPO_ALIGN_ENABLED: false,
    DSP_TEMPO_ANALYSIS_SECONDS: 90,
    DSP_TEMPO_SAMPLE_RATE: 11025,
    DSP_TEMPO_MIN_BPM: 70,
    DSP_TEMPO_MAX_BPM: 170,
    DSP_TEMPO_MAX_ADJUST_PERCENT: 12,
    DSP_TEMPO_MIN_RATIO: 0.88,
    DSP_TEMPO_MAX_RATIO: 1.12,
    DSP_TEMPO_MIN_DELTA_RATIO: 0.012,
    DSP_TEMPO_GLIDE_ENABLED: false,
    DSP_TEMPO_GLIDE_SEGMENTS: 4,
    DSP_TEMPO_GLIDE_ANCHOR_SECONDS: 0.22,
    DSP_AGGRESSIVE_JOIN_ENABLED: false,
    DSP_JOIN_INTENSITY: 0.78,
    DSP_JOIN_MIN_TRANSITION_SECONDS: 0.3,
    DSP_TRIM_SILENCE_ENABLED: false,
    DSP_TRIM_SILENCE_THRESHOLD_DB: -36,
    DSP_TRIM_MIN_SILENCE_SECONDS: 0.14,
    DSP_TRIM_MAX_SECONDS: 4.8,
    DSP_NO_GAP_GUARD_ENABLED: false,
    DSP_TRIM_GUARD_THRESHOLD_BOOST_DB: 10,
    DSP_NO_GAP_ENERGY_TRIM_ENABLED: false,
    DSP_NO_GAP_ENERGY_SAMPLE_RATE: 12000,
    DSP_NO_GAP_ENERGY_FRAME_MS: 20,
    DSP_NO_GAP_ENERGY_FLOOR_RATIO: 0.18,
    DSP_NO_GAP_ENERGY_MEAN_MULTIPLIER: 1.7,
    ...overrides,
  };
}

function createTestDeps() {
  return {
    fs: {
      existsSync: () => false,
      appendFileSync: () => {},
      statSync: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
      readFileSync: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
      mkdirSync: () => {},
      writeFileSync: () => {},
      unlinkSync: () => {},
      renameSync: () => {},
      promises: {
        stat: async () => ({ isFile: () => true, size: 100, mtimeMs: 1000 }),
        mkdir: async () => {},
        rename: async () => {},
        unlink: async () => {},
      },
    },
    path: require('path'),
    crypto: require('crypto'),
    execFileAsync: async () => ({ stdout: '', stderr: '' }),
    normalizeAudioRelativePath: (p) => p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/'),
    safeResolve: (base, rel) => require('path').resolve(base, rel),
    isAudioFile: (f) => /\.(mp3|wav|ogg|m4a|flac)$/i.test(f),
    AUDIO_DIR_RESOLVED: '/tmp/audio',
  };
}

function createTestManager(configOverrides = {}) {
  const config = createTestConfig(configOverrides);
  const deps = createTestDeps();
  const manager = new DspJobManager({ config, deps });
  return { manager };
}

describe('DspJobManager', () => {
  it('ensureReady delegates when enabled', async () => {
    const { manager } = createTestManager();
    // Just verify it doesn't throw — actual ffmpeg probe would fail gracefully
    await manager.ensureReady();
  });

  it('ensureReady skips when disabled', async () => {
    const { manager } = createTestManager({ DSP_ENABLED: false });
    await manager.ensureReady();
    // Should not throw and queue summary shows disabled
    assert.equal(manager.enabled, false);
  });

  it('ensureReady falls back to .exe DSP binaries when needed', async () => {
    const config = createTestConfig({ DSP_PROBE_CACHE_MS: 0 });
    const deps = createTestDeps();
    deps.execFileAsync = async (binary) => {
      if (binary === 'ffmpeg' || binary === 'ffprobe') {
        const err = new Error(`spawn ${binary} ENOENT`);
        err.code = 'ENOENT';
        throw err;
      }
      return { stdout: '', stderr: '' };
    };
    const manager = new DspJobManager({ config, deps });

    await manager.ensureReady();

    const summary = manager.getQueueSummary();
    assert.equal(summary.ffmpegAvailable, true);
    assert.equal(summary.ffmpegBinary, 'ffmpeg.exe');
    assert.equal(summary.ffprobeBinary, 'ffprobe.exe');
  });

  it('getQueueSummary returns correct shape', () => {
    const { manager } = createTestManager();
    const summary = manager.getQueueSummary();
    assert.equal(summary.enabled, true);
    assert.equal(typeof summary.pending, 'number');
    assert.equal(typeof summary.total, 'number');
  });

  it('serializeTransition delegates', () => {
    const { manager } = createTestManager();
    const result = manager.serializeTransition({ id: 'abc', fromFile: 'a.mp3', toFile: 'b.mp3', status: 'queued' });
    assert.equal(result.id, 'abc');
  });

  it('serializeTransition returns null for invalid input', () => {
    const { manager } = createTestManager();
    assert.equal(manager.serializeTransition(null), null);
  });

  it('getTransitionByPair returns descriptor when enabled', () => {
    const { manager } = createTestManager();
    const result = manager.getTransitionByPair('a.mp3', 'b.mp3');
    assert.equal(result.ok, true);
    assert.ok(result.descriptor);
    assert.equal(result.descriptor.fromFile, 'a.mp3');
  });

  it('getTransitionByPair returns error when disabled', () => {
    const { manager } = createTestManager({ DSP_ENABLED: false });
    const result = manager.getTransitionByPair('a.mp3', 'b.mp3');
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('buildMissingTransitionStub returns correct shape', () => {
    const { manager } = createTestManager();
    const stub = manager.buildMissingTransitionStub({
      id: 'abc', fromFile: 'a.mp3', toFile: 'b.mp3',
      transitionSeconds: 5, sliceSeconds: 8,
    });
    assert.equal(stub.status, 'missing');
    assert.equal(stub.outputUrl, null);
    assert.equal(stub.id, 'abc');
  });

  it('buildInferredReadyStub returns correct shape', () => {
    const { manager } = createTestManager();
    const stub = manager.buildInferredReadyStub({
      id: 'abc', fromFile: 'a.mp3', toFile: 'b.mp3',
      transitionSeconds: 5, sliceSeconds: 8, outputFileName: 'test.mp3',
    });
    assert.equal(stub.status, 'ready');
    assert.equal(stub.outputUrl, '/api/dsp/transitions/file/abc');
  });

  it('listTransitions returns empty array when no transitions', () => {
    const { manager } = createTestManager();
    const result = manager.listTransitions(10);
    assert.equal(result.length, 0);
  });

  it('enqueue creates and enqueues a transition', () => {
    const { manager } = createTestManager();
    const result = manager.enqueue('a.mp3', 'b.mp3', { force: true });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.enqueued, true);
  });

  it('enqueue returns error when disabled', () => {
    const { manager } = createTestManager({ DSP_ENABLED: false });
    const result = manager.enqueue('a.mp3', 'b.mp3');
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('enqueueBatch processes single from/to pair', () => {
    const { manager } = createTestManager();
    const result = manager.enqueueBatch({ from: 'a.mp3', to: 'b.mp3' }, { layout: [], playlistDsp: [] });
    assert.equal(result.summary.created, 1);
    assert.equal(result.request.uniquePairs, 1);
  });

  it('enqueueBatch returns error for missing to field', () => {
    const { manager } = createTestManager();
    const result = manager.enqueueBatch({ from: 'a.mp3' }, {});
    assert.ok(result.error);
  });

  it('enqueueBatch processes transitions array', () => {
    const { manager } = createTestManager();
    const result = manager.enqueueBatch({
      transitions: [
        { from: 'a.mp3', to: 'b.mp3' },
        { from: 'c.mp3', to: 'd.mp3' },
      ],
    }, { layout: [], playlistDsp: [] });
    assert.equal(result.summary.created, 2);
    assert.equal(result.request.uniquePairs, 2);
  });

  it('enqueueBatch deduplicates pairs', () => {
    const { manager } = createTestManager();
    const result = manager.enqueueBatch({
      transitions: [
        { from: 'a.mp3', to: 'b.mp3' },
        { from: 'a.mp3', to: 'b.mp3' },
      ],
    }, { layout: [], playlistDsp: [] });
    assert.equal(result.request.totalPairs, 2);
    assert.equal(result.request.uniquePairs, 1);
  });

  it('enqueueBatch returns error when no transitions given', () => {
    const { manager } = createTestManager();
    const result = manager.enqueueBatch({ transitions: [] }, { layout: [], playlistDsp: [] });
    assert.ok(result.error);
  });

  it('scheduleFromLayout returns stats', () => {
    const { manager } = createTestManager();
    const result = manager.scheduleFromLayout([], {});
    assert.equal(result.total, 0);
    assert.equal(result.accepted, 0);
  });

  it('scheduleFromPlaylists schedules transitions from M2A playlists', () => {
    const { manager } = createTestManager();
    const result = manager.scheduleFromPlaylists([
      {
        id: 'p-0',
        settings: { autoPlayEnabled: true, dspEnabled: true },
        tracks: [
          { id: 't-0', src: '/audio/a.mp3' },
          { id: 't-1', src: '/audio/b.mp3' },
        ],
      },
    ], {});
    assert.equal(result.total, 1);
    assert.equal(result.accepted, 1);
    assert.equal(result.created, 1);
  });

  it('enqueueBatch supports fromLayout using playlists snapshot', () => {
    const { manager } = createTestManager();
    const result = manager.enqueueBatch(
      { fromLayout: true },
      {
        playlists: [
          {
            id: 'p-0',
            settings: { autoPlayEnabled: true, dspEnabled: true },
            tracks: [
              { id: 't-0', src: '/audio/a.mp3' },
              { id: 't-1', src: '/audio/b.mp3' },
            ],
          },
        ],
      },
    );
    assert.equal(result.request.fromLayout, true);
    assert.equal(result.request.uniquePairs, 1);
    assert.equal(result.summary.created, 1);
  });

  it('resolveOutputPath returns null for empty id', () => {
    const { manager } = createTestManager();
    assert.equal(manager.resolveOutputPath(''), null);
    assert.equal(manager.resolveOutputPath(null), null);
  });

  it('_collectAdjacentTransitions extracts pairs from layout', () => {
    const { manager } = createTestManager();
    const layout = [['a.mp3', 'b.mp3', 'c.mp3']];
    const result = manager._collectAdjacentTransitions(layout, [true]);
    assert.equal(result.length, 2);
    assert.equal(result[0].fromFile, 'a.mp3');
    assert.equal(result[0].toFile, 'b.mp3');
    assert.equal(result[1].fromFile, 'b.mp3');
    assert.equal(result[1].toFile, 'c.mp3');
  });

  it('_collectAdjacentTransitions skips disabled playlists', () => {
    const { manager } = createTestManager();
    const layout = [['a.mp3', 'b.mp3'], ['c.mp3', 'd.mp3']];
    const result = manager._collectAdjacentTransitions(layout, [true, false]);
    assert.equal(result.length, 1);
    assert.equal(result[0].fromFile, 'a.mp3');
  });

  it('_collectAdjacentTransitionsFromPlaylists extracts dsp-enabled adjacent pairs', () => {
    const { manager } = createTestManager();
    const result = manager._collectAdjacentTransitionsFromPlaylists([
      {
        id: 'p-0',
        settings: { autoPlayEnabled: true, dspEnabled: true },
        tracks: [
          { id: 't-0', src: '/audio/a.mp3' },
          { id: 't-1', src: '/audio/b.mp3?x=1' },
          { id: 't-2', meta: { originalPath: 'c.mp3' }, src: '/audio/c.mp3' },
        ],
      },
      {
        id: 'p-1',
        settings: { autoPlayEnabled: true, dspEnabled: false },
        tracks: [
          { id: 'x-0', src: '/audio/x.mp3' },
          { id: 'x-1', src: '/audio/y.mp3' },
        ],
      },
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].fromFile, 'a.mp3');
    assert.equal(result[0].toFile, 'b.mp3');
    assert.equal(result[1].fromFile, 'b.mp3');
    assert.equal(result[1].toFile, 'c.mp3');
  });
});
