'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DspJobManager } = require('../src/dsp/DspJobManager');

function createTestManager(overrides = {}) {
  const enqueued = [];
  const transitions = new Map();
  const defaults = {
    enqueue: (from, to, opts) => {
      enqueued.push({ from, to, opts });
      const item = { id: `${from}-${to}`, fromFile: from, toFile: to, status: 'queued', updatedAt: Date.now() };
      transitions.set(item.id, item);
      return { ok: true, created: true, enqueued: true, item };
    },
    getTransitionByPair: (from, to) => {
      const id = `${from}-${to}`;
      const item = transitions.get(id) || null;
      return { ok: true, item, descriptor: { id, fromFile: from, toFile: to, transitionSeconds: 5, sliceSeconds: 8, outputPath: '/tmp/test.mp3', outputFileName: 'test.mp3' } };
    },
    getQueueSummary: () => ({ queued: 0, processing: 0, ready: 0 }),
    serializeTransition: (item) => ({ ...item }),
    getTransitions: () => transitions.values(),
    scheduleFromLayout: () => ({ created: 0, enqueued: 0 }),
    resolveOutputPath: (id) => /^[a-f0-9]+/.test(id) ? `/audio/dsp/${id}.mp3` : null,
    buildOutputUrl: (id) => `/api/dsp/transitions/file/${id}`,
    ensureReady: async () => {},
    enabled: true,
    STATUS_READY: 'ready',
  };
  return { manager: new DspJobManager({ ...defaults, ...overrides }), enqueued, transitions };
}

describe('DspJobManager', () => {
  it('ensureReady delegates when enabled', async () => {
    let called = false;
    const { manager } = createTestManager({ ensureReady: async () => { called = true; } });
    await manager.ensureReady();
    assert.equal(called, true);
  });

  it('ensureReady skips when disabled', async () => {
    let called = false;
    const { manager } = createTestManager({ enabled: false, ensureReady: async () => { called = true; } });
    await manager.ensureReady();
    assert.equal(called, false);
  });

  it('getQueueSummary delegates', () => {
    const { manager } = createTestManager({ getQueueSummary: () => ({ queued: 3, processing: 1 }) });
    assert.deepEqual(manager.getQueueSummary(), { queued: 3, processing: 1 });
  });

  it('serializeTransition delegates', () => {
    const { manager } = createTestManager({ serializeTransition: (item) => ({ id: item.id }) });
    assert.deepEqual(manager.serializeTransition({ id: 'abc', extra: true }), { id: 'abc' });
  });

  it('getTransitionByPair delegates', () => {
    const { manager } = createTestManager();
    const result = manager.getTransitionByPair('a.mp3', 'b.mp3');
    assert.equal(result.ok, true);
    assert.equal(result.descriptor.fromFile, 'a.mp3');
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

  it('listTransitions sorts by updatedAt desc and limits', () => {
    const { manager, transitions } = createTestManager();
    transitions.set('a', { id: 'a', updatedAt: 100 });
    transitions.set('b', { id: 'b', updatedAt: 300 });
    transitions.set('c', { id: 'c', updatedAt: 200 });
    const result = manager.listTransitions(2);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'b');
    assert.equal(result[1].id, 'c');
  });

  it('enqueue delegates correctly', () => {
    const { manager, enqueued } = createTestManager();
    const result = manager.enqueue('a.mp3', 'b.mp3', { force: true });
    assert.equal(result.ok, true);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].opts.force, true);
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

  it('scheduleFromLayout delegates', () => {
    let called = false;
    const { manager } = createTestManager({ scheduleFromLayout: () => { called = true; return { created: 1 }; } });
    const result = manager.scheduleFromLayout([], {});
    assert.equal(called, true);
    assert.deepEqual(result, { created: 1 });
  });

  it('resolveOutputPath delegates', () => {
    const { manager } = createTestManager();
    assert.equal(manager.resolveOutputPath('abc123'), '/audio/dsp/abc123.mp3');
    assert.equal(manager.resolveOutputPath('!!invalid'), null);
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
});
