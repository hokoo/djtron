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

test('co-host can send play-track and toggle-current only', () => {
  assert.equal(
    canDispatchLivePlaybackCommand({
      sourceRole: 'co-host',
      commandType: 'play-track',
      isServer: false,
    }).allowed,
    true,
  );
  assert.equal(
    canDispatchLivePlaybackCommand({
      sourceRole: 'co-host',
      commandType: 'toggle-current',
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

test('non host/co-host users are rejected', () => {
  const decision = canDispatchLivePlaybackCommand({
    sourceRole: 'slave',
    commandType: 'play-track',
    isServer: false,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'ACCESS_DENIED');
});
