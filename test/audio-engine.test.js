const test = require('node:test');
const assert = require('node:assert/strict');
const { AudioEngine } = require('../lib/playback/audioEngine');

test('audio engine disables overlap/fade flags for dsp fragments', () => {
  const engine = new AudioEngine();
  engine.play({ kind: 'dsp_fragment', src: 'transition.wav', overlapAllowed: true, fadeAllowed: true });
  const source = engine.getActiveSources()[0];
  assert.equal(source.overlapAllowed, false);
  assert.equal(source.fadeAllowed, false);
});

test('audio engine applies overlap on track-to-track and never on dsp fragment transition', () => {
  const engine = new AudioEngine();
  const trackPlan = engine.planTransition(
    { kind: 'track', trackId: 'a' },
    { kind: 'track', trackId: 'b' },
    { overlapEnabled: true, fadeEnabled: true },
  );
  assert.equal(trackPlan.overlapApplied, true);
  assert.equal(trackPlan.fadeApplied, false);

  const dspPlan = engine.planTransition(
    { kind: 'track', trackId: 'a' },
    { kind: 'dsp_fragment', fromTrackId: 'a', toTrackId: 'b' },
    { overlapEnabled: true, fadeEnabled: true },
  );
  assert.equal(dspPlan.overlapApplied, false);
  assert.equal(dspPlan.fadeApplied, false);
});

test('audio engine applies fade only on silence to track boundaries', () => {
  const engine = new AudioEngine();
  const silenceToTrack = engine.planTransition(
    { kind: 'silence' },
    { kind: 'track', trackId: 'a' },
    { overlapEnabled: true, fadeEnabled: true },
  );
  assert.equal(silenceToTrack.fadeApplied, true);

  const trackToSilence = engine.planTransition(
    { kind: 'track', trackId: 'a' },
    { kind: 'silence' },
    { overlapEnabled: true, fadeEnabled: true },
  );
  assert.equal(trackToSilence.fadeApplied, true);
});
