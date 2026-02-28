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

test('simple to autoplay toggle keeps current segment seamless', () => {
  const { controller } = createController([
    { id: 'p1', name: 'P1', tracks: [{ id: 't1', src: 'a.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't1' });
  const before = controller.getState();
  controller.toggleAutoplay({ playlistId: 'p1', enabled: true });
  const state = controller.getState();
  assert.equal(state.activeMode, 'autoplay');
  assert.equal(state.isPlaying, true);
  assert.deepEqual(state.activeSegment, before.activeSegment);
});

test('autoplay to simple toggle keeps track and idles on segment end', () => {
  const { controller } = createController([
    { id: 'p1', name: 'P1', tracks: [{ id: 't1', src: 'a.mp3' }], settings: { autoPlayEnabled: true, dspEnabled: false } },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't1' });
  controller.toggleAutoplay({ playlistId: 'p1', enabled: false });
  const afterToggle = controller.getState();
  assert.equal(afterToggle.activeMode, 'simple');
  assert.equal(afterToggle.activeSegment.trackId, 't1');
  controller.onSegmentEnded({ segment: { kind: 'track', trackId: 't1' } });
  const state = controller.getState();
  assert.equal(state.playbackPhase, 'idle');
  assert.equal(state.isPlaying, false);
});

test('dsp to autoplay toggle keeps current track seamless', () => {
  const { controller } = createController([
    { id: 'p1', name: 'P1', tracks: [{ id: 'a', src: 'a.mp3' }, { id: 'b', src: 'b.mp3' }], settings: { autoPlayEnabled: true, dspEnabled: true } },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 'a' });
  controller.toggleDsp({ playlistId: 'p1', enabled: false });
  const state = controller.getState();
  assert.equal(state.activeMode, 'autoplay');
  assert.equal(state.activeSegment.trackId, 'a');
  assert.equal(state.isPlaying, true);
});

test('toggling inactive playlist settings does not change active playback mode', () => {
  const { controller } = createController([
    { id: 'p1', name: 'P1', tracks: [{ id: 't1', src: '1.mp3' }], settings: { autoPlayEnabled: true, dspEnabled: false } },
    { id: 'p2', name: 'P2', tracks: [{ id: 'u1', src: 'u.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't1' });
  const before = controller.getState();
  controller.toggleAutoplay({ playlistId: 'p2', enabled: true });
  const state = controller.getState();
  assert.equal(state.activeMode, before.activeMode);
  assert.deepEqual(state.activeSegment, before.activeSegment);
});

test('play-next during fragment waits for mandatory B as immediate next', () => {
  const { controller, repository } = createController([
    {
      id: 'p1',
      name: 'P1',
      tracks: [{ id: 'a', src: 'a.mp3' }, { id: 'b', src: 'b.mp3' }, { id: 'c', src: 'c.mp3' }],
      settings: { autoPlayEnabled: true, dspEnabled: true },
    },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 'a' });
  controller.state.playbackPhase = 'transition';
  controller.state.transitionContext = { fromTrackId: 'a', toTrackId: 'b' };
  controller.playNext({ strategy: 'copy-into-active', track: { id: 'x', src: 'x.mp3' } });
  assert.deepEqual(repository.getPlaylist('p1').tracks.map((item) => item.id), ['a', 'b', 'x', 'c']);
  controller.onSegmentEnded({ segment: { kind: 'dsp_fragment', fromTrackId: 'a', toTrackId: 'b' } });
  const state = controller.getState();
  assert.equal(state.activeSegment.trackId, 'b');
});

test('play-next strategy A in transition inserts after B', () => {
  const { controller, repository } = createController([
    {
      id: 'p1',
      name: 'P1',
      tracks: [{ id: 'a', src: 'a.mp3' }, { id: 'b', src: 'b.mp3' }, { id: 'c', src: 'c.mp3' }],
      settings: { autoPlayEnabled: true, dspEnabled: true },
    },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 'a' });
  controller.state.playbackPhase = 'transition';
  controller.state.transitionContext = { fromTrackId: 'a', toTrackId: 'b' };
  controller.playNext({ strategy: 'copy-into-active', track: { id: 'x', src: 'x.mp3' } });
  assert.deepEqual(repository.getPlaylist('p1').tracks.map((item) => item.id), ['a', 'b', 'x', 'c']);
});

test('play-next strategy A cancels scheduled switch from strategy B', () => {
  const { controller } = createController([
    { id: 'p1', name: 'P1', tracks: [{ id: 't0', src: '0.mp3' }], settings: { autoPlayEnabled: true, dspEnabled: false } },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't0' });
  controller.playNext({ strategy: 'create-new-playnext-playlist', track: { id: 'x', src: 'x.mp3' } });
  assert.ok(controller.getState().scheduledSwitch);
  controller.playNext({ strategy: 'copy-into-active', track: { id: 'y', src: 'y.mp3' } });
  assert.equal(controller.getState().scheduledSwitch, null);
});

test('play-next strategy B in transition anchors switch after B', () => {
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
  controller.playNext({ strategy: 'create-new-playnext-playlist', track: { id: 'x', src: 'x.mp3' } });
  assert.equal(controller.getState().scheduledSwitch.afterTrackId, 'b');
});

test('scheduled switch executes on ended anchor track and keeps quick build ui state', () => {
  const { controller, repository } = createController([
    { id: 'p1', name: 'P1', tracks: [{ id: 't0', src: '0.mp3' }], settings: { autoPlayEnabled: true, dspEnabled: false } },
  ]);
  controller.playTrack({ playlistId: 'p1', trackId: 't0' });
  controller.playNext({ strategy: 'create-new-playnext-playlist', track: { id: 'x', src: 'x.mp3' } });
  const scheduled = controller.getState().scheduledSwitch;
  controller.onSegmentEnded({ segment: { kind: 'track', trackId: 't0' } });
  const state = controller.getState();
  assert.equal(state.activePlaylistId, scheduled.toPlaylistId);
  assert.equal(state.activeMode, 'autoplay');
  assert.equal(state.activeSegment.trackId, 'x');
  assert.equal(repository.getPlaylist(scheduled.toPlaylistId).uiState, 'quick_build_armed');
});

test('toggle dap true arms dap without autoplay start', () => {
  const { controller } = createController([
    { id: 'dap', name: 'DAP', tracks: [{ id: 'd1', src: 'd.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.toggleDap({ enabled: true, playlistId: 'dap' });
  const state = controller.getState();
  assert.equal(state.dapState, 'armed');
  assert.equal(state.isPlaying, false);
});

test('dap classic start from armed state activates dap mode', () => {
  const { controller } = createController([
    { id: 'dap', name: 'DAP', tracks: [{ id: 'd1', src: 'd.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.toggleDap({ enabled: true, playlistId: 'dap' });
  controller.playTrack({ playlistId: 'dap', trackId: 'd1' });
  const state = controller.getState();
  assert.equal(state.activeMode, 'dap');
  assert.equal(state.dapState, 'active');
});

test('activate dap from current promotes seamlessly without replacing segment', () => {
  const { controller } = createController([
    { id: 'dap', name: 'DAP', tracks: [{ id: 'd1', src: 'd.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.playTrack({ playlistId: 'dap', trackId: 'd1' });
  const before = controller.getState();
  controller.toggleDap({ enabled: true, playlistId: 'dap' });
  controller.activateDapFromCurrent();
  const state = controller.getState();
  assert.equal(state.activeMode, 'dap');
  assert.equal(state.dapState, 'active');
  assert.deepEqual(state.activeSegment, before.activeSegment);
});

test('starting another playlist while dap active suspends dap', () => {
  const { controller } = createController([
    { id: 'dap', name: 'DAP', tracks: [{ id: 'd1', src: 'd.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
    { id: 'p2', name: 'P2', tracks: [{ id: 't2', src: 't2.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.toggleDap({ enabled: true, playlistId: 'dap' });
  controller.playTrack({ playlistId: 'dap', trackId: 'd1' });
  controller.playTrack({ playlistId: 'p2', trackId: 't2' });
  const state = controller.getState();
  assert.equal(state.dapState, 'suspended');
  assert.equal(state.activeMode, 'simple');
});

test('simple completion resumes suspended dap', () => {
  const { controller } = createController([
    { id: 'dap', name: 'DAP', tracks: [{ id: 'd1', src: 'd.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
    { id: 'p2', name: 'P2', tracks: [{ id: 't2', src: 't2.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.toggleDap({ enabled: true, playlistId: 'dap' });
  controller.playTrack({ playlistId: 'dap', trackId: 'd1' });
  controller.playTrack({ playlistId: 'p2', trackId: 't2' });
  controller.onSegmentEnded({ segment: { kind: 'track', trackId: 't2' } });
  const state = controller.getState();
  assert.equal(state.dapState, 'active');
  assert.equal(state.activeMode, 'dap');
});

test('toggle dap false in suspended mode keeps current non-dap mode', () => {
  const { controller } = createController([
    { id: 'dap', name: 'DAP', tracks: [{ id: 'd1', src: 'd.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
    { id: 'p2', name: 'P2', tracks: [{ id: 't2', src: 't2.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.toggleDap({ enabled: true, playlistId: 'dap' });
  controller.playTrack({ playlistId: 'dap', trackId: 'd1' });
  controller.playTrack({ playlistId: 'p2', trackId: 't2' });
  controller.toggleDap({ enabled: false });
  const state = controller.getState();
  assert.equal(state.dapState, 'off');
  assert.equal(state.activeMode, 'simple');
});

test('toggle dap false in active mode exits seamlessly without stopping track', () => {
  const { controller } = createController([
    { id: 'dap', name: 'DAP', tracks: [{ id: 'd1', src: 'd.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
  ]);
  controller.toggleDap({ enabled: true, playlistId: 'dap' });
  controller.playTrack({ playlistId: 'dap', trackId: 'd1' });
  const before = controller.getState();
  controller.toggleDap({ enabled: false });
  const state = controller.getState();
  assert.equal(state.dapState, 'off');
  assert.equal(state.activeMode, 'simple');
  assert.equal(state.isPlaying, true);
  assert.deepEqual(state.activeSegment, before.activeSegment);
});

test('stop delegates to audio engine stopAll', () => {
  const stopCalls = [];
  const controller = new PlaybackController({
    audioEngine: {
      play: () => {},
      stopAll: () => {
        stopCalls.push('stopAll');
      },
    },
    playlistRepository: new PlaylistRepository([
      { id: 'p1', name: 'P1', tracks: [{ id: 't1', src: 'a.mp3' }], settings: { autoPlayEnabled: false, dspEnabled: false } },
    ]),
    remoteSync: { broadcastState: () => {} },
  });
  controller.playTrack({ playlistId: 'p1', trackId: 't1' });
  controller.stop();
  assert.deepEqual(stopCalls, ['stopAll']);
});

test('slave local play-track rejects autoplay playlist in local context', () => {
  const { controller } = createController([
    { id: 'p1', name: 'P1', tracks: [{ id: 't1', src: 'a.mp3' }], settings: { autoPlayEnabled: true, dspEnabled: false } },
  ]);
  assert.throws(
    () => controller.playTrack({ playlistId: 'p1', trackId: 't1', sourceRole: 'slave', target: 'self' }),
    /NOT_SUPPORTED_IN_LOCAL_CONTEXT/,
  );
});
