'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PlaybackGateway } = require('../src/playback/PlaybackGateway');

function createTestGateway(overrides = {}) {
  let state = { trackFile: 'track.mp3', paused: false, currentTime: 10, duration: 200, updatedAt: 1 };

  const deps = {
    getState: () => state,
    setState: (next) => { state = next; },
    sanitizeState: (raw) => ({ ...raw, updatedAt: Date.now() }),
    serializeState: (s) => JSON.stringify(s),
    buildPayload: (clientId) => ({ ...state, sourceClientId: clientId }),
    broadcastUpdate: () => {},
    sanitizeCommand: (raw) => (raw && raw.type ? { type: raw.type } : null),
    sanitizeClientId: (v) => (typeof v === 'string' ? v : null),
    sanitizeSessionRole: (v) => v || 'slave',
    commandBus: {
      dispatch: async (ctx, payload) => ({ ok: true }),
    },
    ROLE_HOST: 'host',
    ...overrides,
  };

  return { gateway: new PlaybackGateway(deps), getState: () => state };
}

describe('PlaybackGateway', () => {
  it('getSnapshot returns current state payload', () => {
    const { gateway } = createTestGateway();
    const snap = gateway.getSnapshot('client-1');
    assert.equal(snap.trackFile, 'track.mp3');
    assert.equal(snap.sourceClientId, 'client-1');
  });

  it('getSnapshot with null clientId', () => {
    const { gateway } = createTestGateway();
    const snap = gateway.getSnapshot(null);
    assert.equal(snap.sourceClientId, null);
  });

  it('updateState detects change and sets new state', () => {
    let broadcastCalled = false;
    const { gateway, getState } = createTestGateway({
      broadcastUpdate: () => { broadcastCalled = true; },
    });

    const result = gateway.updateState({ trackFile: 'new.mp3', paused: true, currentTime: 0, duration: 100, clientId: 'c1' });
    assert.equal(result.changed, true);
    assert.ok(broadcastCalled);
    assert.equal(getState().trackFile, 'new.mp3');
  });

  it('updateState detects no change and skips broadcast', () => {
    let broadcastCalled = false;
    const { gateway } = createTestGateway({
      // State serialization will match because sanitizeState returns same shape
      sanitizeState: (raw) => ({ trackFile: 'track.mp3', paused: false, currentTime: 10, duration: 200, updatedAt: 1 }),
      broadcastUpdate: () => { broadcastCalled = true; },
    });

    const result = gateway.updateState({ trackFile: 'track.mp3', paused: false, currentTime: 10, duration: 200, clientId: null });
    assert.equal(result.changed, false);
    assert.ok(!broadcastCalled);
  });

  it('dispatchCommand returns 400 for invalid command', async () => {
    const { gateway } = createTestGateway();
    const result = await gateway.dispatchCommand({}, { isServer: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.ok(result.error.includes('Некорректная'));
  });

  it('dispatchCommand returns 403 when bus rejects', async () => {
    const { gateway } = createTestGateway({
      commandBus: {
        dispatch: async () => ({ ok: false, message: 'Access denied' }),
      },
    });

    const result = await gateway.dispatchCommand({ type: 'toggle-current' }, { isServer: false, role: 'slave', username: 'u' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.error, 'Access denied');
  });

  it('dispatchCommand returns 200 on success with command payload', async () => {
    let dispatched = null;
    const { gateway } = createTestGateway({
      commandBus: {
        dispatch: async (ctx, payload) => { dispatched = { ctx, payload }; return { ok: true }; },
      },
    });

    const auth = { isServer: true, role: 'host', username: 'server' };
    const result = await gateway.dispatchCommand({ type: 'toggle-current', clientId: 'c1' }, auth);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.payload.command.type, 'toggle-current');
    assert.equal(result.payload.command.sourceRole, 'host');
    assert.ok(dispatched);
    assert.equal(dispatched.ctx.isServer, true);
  });

  it('dispatchCommand forwards command target to command bus context', async () => {
    let dispatched = null;
    const { gateway } = createTestGateway({
      sanitizeCommand: () => ({ type: 'play-next-request', file: 'x.mp3', target: 'host' }),
      commandBus: {
        dispatch: async (ctx, payload) => { dispatched = { ctx, payload }; return { ok: true }; },
      },
    });

    const auth = { isServer: false, role: 'slave', username: 'listener' };
    const result = await gateway.dispatchCommand({ type: 'play-next-request' }, auth);
    assert.equal(result.ok, true);
    assert.ok(dispatched);
    assert.equal(dispatched.ctx.target, 'host');
    assert.equal(dispatched.payload.target, 'host');
  });

  it('dispatchCommand uses sanitizeSessionRole for non-server auth', async () => {
    const { gateway } = createTestGateway({
      sanitizeSessionRole: () => 'co-host',
      commandBus: { dispatch: async () => ({ ok: true }) },
    });

    const auth = { isServer: false, role: 'co-host', username: 'dj' };
    const result = await gateway.dispatchCommand({ type: 'toggle-current' }, auth);
    assert.equal(result.payload.command.sourceRole, 'co-host');
  });

  it('sanitizePlaybackCommand normalizes stop command with target', () => {
    const command = PlaybackGateway.sanitizePlaybackCommand(
      { type: 'stop', target: 'self' },
      { normalizeLiveVolumePreset: () => null },
    );
    assert.deepEqual(command, { type: 'stop', target: 'self' });
  });

  it('sanitizePlaybackCommand normalizes play-next-request trackRef/src payload', () => {
    const command = PlaybackGateway.sanitizePlaybackCommand(
      {
        type: 'play-next-request',
        trackRef: { src: '/audio/folder/Track%20Name.mp3' },
        strategy: 'create-new-playnext-playlist',
        fifoSession: 1,
        playlistId: '  playlist-1  ',
        trackId: '  track-9  ',
        target: 'host',
      },
      { normalizeLiveVolumePreset: () => null },
    );
    assert.deepEqual(command, {
      type: 'play-next-request',
      file: 'folder/Track Name.mp3',
      strategy: 'create-new-playnext-playlist',
      fifoSession: true,
      playlistId: 'playlist-1',
      trackId: 'track-9',
      target: 'host',
    });
  });

  it('sanitizePlaybackCommand rejects play-next-request without track', () => {
    const command = PlaybackGateway.sanitizePlaybackCommand(
      { type: 'play-next-request', target: 'host' },
      { normalizeLiveVolumePreset: () => null },
    );
    assert.equal(command, null);
  });
});
