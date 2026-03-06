const test = require('node:test');
const assert = require('node:assert/strict');
const { PlaylistRepository } = require('../lib/playback/playlistRepository');
const { PlaylistEditor } = require('../lib/playback/playlistEditor');

test('playlist editor copyTrack keeps source and inserts into destination', () => {
  const repository = new PlaylistRepository([
    {
      id: 'a',
      name: 'A',
      tracks: [{ id: 't1', src: '1.mp3' }],
      settings: {},
    },
    {
      id: 'b',
      name: 'B',
      tracks: [{ id: 't2', src: '2.mp3' }],
      settings: {},
    },
  ]);
  const editor = new PlaylistEditor({ playlistRepository: repository });
  editor.copyTrack({ fromPlaylistId: 'a', trackId: 't1', toPlaylistId: 'b', index: 1 });
  assert.deepEqual(repository.getPlaylist('a').tracks.map((item) => item.id), ['t1']);
  assert.deepEqual(repository.getPlaylist('b').tracks.map((item) => item.id), ['t2', 't1']);
});

test('playlist editor commitQuickBuild clears quick build marker', () => {
  const repository = new PlaylistRepository([
    {
      id: 'playnext-1',
      name: 'Play Next',
      tracks: [{ id: 'x', src: 'x.mp3' }],
      settings: {},
      uiState: 'quick_build_armed',
    },
  ]);
  const editor = new PlaylistEditor({ playlistRepository: repository });
  const updated = editor.commitQuickBuild('playnext-1');
  assert.equal(updated.uiState, null);
});

test('playlist editor moveTrack removes source and inserts into destination', () => {
  const repository = new PlaylistRepository([
    {
      id: 'a',
      name: 'A',
      tracks: [{ id: 't1', src: '1.mp3' }, { id: 't2', src: '2.mp3' }],
      settings: {},
    },
    {
      id: 'b',
      name: 'B',
      tracks: [{ id: 'u1', src: 'u.mp3' }],
      settings: {},
    },
  ]);
  const editor = new PlaylistEditor({ playlistRepository: repository });
  editor.moveTrack({ fromPlaylistId: 'a', trackId: 't2', toPlaylistId: 'b', index: 1 });
  assert.deepEqual(repository.getPlaylist('a').tracks.map((item) => item.id), ['t1']);
  assert.deepEqual(repository.getPlaylist('b').tracks.map((item) => item.id), ['u1', 't2']);
});
