const test = require('node:test');
const assert = require('node:assert/strict');
const { PlaybackCommandBus, createLivePlaybackCommandBus } = require('../lib/playback/commandBus');

test('command bus executes commands in dispatch order', async () => {
  const seen = [];
  const bus = new PlaybackCommandBus({
    authorize: () => ({ allowed: true }),
    execute: async (payload) => {
      await new Promise((resolve) => setTimeout(resolve, payload.delayMs));
      seen.push(payload.id);
    },
  });

  await Promise.all([
    bus.dispatch({}, { id: 'a', delayMs: 20 }),
    bus.dispatch({}, { id: 'b', delayMs: 0 }),
    bus.dispatch({}, { id: 'c', delayMs: 0 }),
  ]);

  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('command bus rejects command when policy denies access', async () => {
  const seen = [];
  const bus = new PlaybackCommandBus({
    authorize: () => ({ allowed: false, reason: 'ACCESS_DENIED', message: 'denied' }),
    execute: (payload) => {
      seen.push(payload);
    },
  });

  const result = await bus.dispatch({}, { id: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ACCESS_DENIED');
  assert.equal(result.message, 'denied');
  assert.equal(seen.length, 0);
});

test('live command bus routes allowed command to playback controller', async () => {
  const seen = [];
  const bus = createLivePlaybackCommandBus({
    sourceRole: 'co-host',
    isServer: false,
    controller: {
      handleCommand: (payload) => {
        seen.push(payload.type);
      },
    },
  });

  const allowed = await bus.dispatch({ commandType: 'play-track', target: 'host' }, { type: 'play-track' });
  const denied = await bus.dispatch({ commandType: 'toggle-dsp', target: 'host' }, { type: 'toggle-dsp' });

  assert.equal(allowed.ok, true);
  assert.equal(denied.ok, false);
  assert.deepEqual(seen, ['play-track']);
});

test('live command bus allows co-host to route play-track and stop to host', async () => {
  const seen = [];
  const bus = createLivePlaybackCommandBus({
    sourceRole: 'co-host',
    isServer: false,
    controller: {
      handleCommand: (payload) => {
        seen.push(payload.type);
      },
    },
  });

  const playTrack = await bus.dispatch({ commandType: 'play-track', target: 'host' }, { type: 'play-track' });
  const stop = await bus.dispatch({ commandType: 'stop', target: 'host' }, { type: 'stop' });

  assert.equal(playTrack.ok, true);
  assert.equal(stop.ok, true);
  assert.deepEqual(seen, ['play-track', 'stop']);
});
