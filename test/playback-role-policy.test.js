const test = require('node:test');
const assert = require('node:assert/strict');
const { canDispatchLivePlaybackCommand } = require('../lib/playback/rolePolicy');

test('host commands are always allowed', () => {
  const decision = canDispatchLivePlaybackCommand({
    sourceRole: 'host',
    commandType: 'set-volume',
    isServer: false,
  });
  assert.equal(decision.allowed, true);
});

test('co-host can send play-track and stop only', () => {
  assert.equal(
    canDispatchLivePlaybackCommand({
      sourceRole: 'co-host',
      commandType: 'play-track',
      target: 'host',
      isServer: false,
    }).allowed,
    true,
  );
  assert.equal(
    canDispatchLivePlaybackCommand({
      sourceRole: 'co-host',
      commandType: 'stop',
      target: 'host',
      isServer: false,
    }).allowed,
    true,
  );
  assert.equal(
    canDispatchLivePlaybackCommand({
      sourceRole: 'co-host',
      commandType: 'set-live-seek-enabled',
      isServer: false,
    }).allowed,
    false,
  );
});

test('slave can send play-next-request to host only', () => {
  assert.equal(
    canDispatchLivePlaybackCommand({
      sourceRole: 'slave',
      commandType: 'play-next-request',
      target: 'host',
      isServer: false,
    }).allowed,
    true,
  );
  assert.equal(
    canDispatchLivePlaybackCommand({
      sourceRole: 'slave',
      commandType: 'play-next-request',
      target: 'self',
      isServer: false,
    }).allowed,
    false,
  );
});

test('non host/co-host/slave users are rejected', () => {
  const decision = canDispatchLivePlaybackCommand({
    sourceRole: 'guest',
    commandType: 'play-track',
    isServer: false,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'ACCESS_DENIED');
});
