const test = require('node:test');
const assert = require('node:assert/strict');
const { PlaybackController } = require('../lib/playback/playbackController');
const { AudioEngine } = require('../lib/playback/audioEngine');
const { PlaylistRepository } = require('../lib/playback/playlistRepository');

function createController(playlists) {
  const repository = new PlaylistRepository(playlists);
  const audioEngine = new AudioEngine();
  const snapshots = [];
  const controller = new PlaybackController({
    audioEngine,
    playlistRepository: repository,
    remoteSync: { broadcastState: (state) => snapshots.push(state) },
  });
  return { controller, repository, snapshots };
}

test('playback controller switches mode based on active playlist toggles', () => {
  const { controller } = createController([
    { id: 'p1', name: 'P1', tracks: [{ id: 't1', src: 'a.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't1' });
  assert.equal(controller.getState().activeMode, 'simple');

  controller.toggleAutoplay({ playlistId: 'p1', enabled: true });
  assert.equal(controller.getState().activeMode, 'autoplay');

  controller.toggleDsp({ playlistId: 'p1', enabled: true });
  assert.equal(controller.getState().activeMode, 'dsp');
});

test('play-next strategy A supports LIFO and FIFO insertion', () => {
  const { controller, repository } = createController([
    {
      id: 'p1',
      name: 'P1',
      tracks: [{ id: 't0', src: '0.mp3' }, { id: 't1', src: '1.mp3' }, { id: 't2', src: '2.mp3' }],
      settings: { autoPlayEnabled: true, dspEnabled: false },
    },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't0' });
  controller.playNext({ strategy: 'copy-into-active', track: { id: 'x', src: 'x.mp3' }, fifoSession: false });
  controller.playNext({ strategy: 'copy-into-active', track: { id: 'y', src: 'y.mp3' }, fifoSession: false });

  assert.deepEqual(
    repository.getPlaylist('p1').tracks.map((item) => item.id),
    ['t0', 'y', 'x', 't1', 't2'],
  );

  controller.state.playNextSession = null;
  controller.playNext({ strategy: 'copy-into-active', track: { id: 'f1', src: 'f1.mp3' }, fifoSession: true });
  controller.playNext({ strategy: 'copy-into-active', track: { id: 'f2', src: 'f2.mp3' }, fifoSession: true });

  assert.deepEqual(
    repository.getPlaylist('p1').tracks.map((item) => item.id),
    ['t0', 'f1', 'f2', 'y', 'x', 't1', 't2'],
  );
});

test('play-next strategy B creates quick build playlist and scheduled switch', () => {
  const { controller, repository } = createController([
    {
      id: 'p1',
      name: 'P1',
      tracks: [{ id: 't0', src: '0.mp3' }],
      settings: { autoPlayEnabled: true, dspEnabled: false },
    },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't0' });
  controller.playNext({ strategy: 'create-new-playnext-playlist', track: { id: 'x', src: 'x.mp3' } });
  const state = controller.getState();
  assert.ok(state.scheduledSwitch);
  assert.equal(state.scheduledSwitch.afterTrackId, 't0');
  const createdPlaylist = repository.getPlaylist(state.scheduledSwitch.toPlaylistId);
  assert.equal(createdPlaylist.uiState, 'quick_build_armed');
  assert.deepEqual(createdPlaylist.tracks.map((item) => item.id), ['x']);
});

test('dsp fragment completion always continues with B track', () => {
  const { controller } = createController([
    {
      id: 'p1',
      name: 'P1',
      tracks: [{ id: 'a', src: 'a.mp3' }, { id: 'b', src: 'b.mp3' }],
      settings: { autoPlayEnabled: true, dspEnabled: true },
    },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 'a' });
  controller.state.playbackPhase = 'transition';
  controller.state.transitionContext = { fromTrackId: 'a', toTrackId: 'b' };
  controller.onSegmentEnded({ segment: { kind: 'dsp_fragment', fromTrackId: 'a', toTrackId: 'b' } });
  const state = controller.getState();
  assert.equal(state.activeSegment.trackId, 'b');
  assert.equal(state.playbackPhase, 'track');
});

test('stop performs full stop and clears play-next and dap state', () => {
  const { controller } = createController([
    {
      id: 'p1',
      name: 'P1',
      tracks: [{ id: 't1', src: 'a.mp3' }],
      settings: { autoPlayEnabled: true, dspEnabled: false },
    },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't1' });
  controller.state.playNextSession = { playlistId: 'p1' };
  controller.state.scheduledSwitch = { toPlaylistId: 'p2', afterTrackId: 't1' };
  controller.state.dapState = 'suspended';
  controller.stop();
  const state = controller.getState();
  assert.equal(state.isPlaying, false);
  assert.equal(state.playbackPhase, 'idle');
  assert.equal(state.playNextSession, null);
  assert.equal(state.scheduledSwitch, null);
  assert.equal(state.dapState, 'off');
});
