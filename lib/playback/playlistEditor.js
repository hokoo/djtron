class PlaylistEditor {
  constructor({ playlistRepository }) {
    this.playlistRepository = playlistRepository;
  }

  copyTrack({ fromPlaylistId, trackId, toPlaylistId, index }) {
    const sourcePlaylist = this.playlistRepository.getPlaylist(fromPlaylistId);
    if (!sourcePlaylist) {
      throw new Error('Source playlist not found');
    }
    const track = sourcePlaylist.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw new Error('Track not found');
    }
    return this.playlistRepository.copyTrackIntoPlaylist(track, toPlaylistId, index);
  }

  moveTrack({ fromPlaylistId, trackId, toPlaylistId, index }) {
    const sourcePlaylist = this.playlistRepository.getPlaylist(fromPlaylistId);
    if (!sourcePlaylist) {
      throw new Error('Source playlist not found');
    }
    const sourceIndex = sourcePlaylist.tracks.findIndex((item) => item.id === trackId);
    if (sourceIndex === -1) {
      throw new Error('Track not found');
    }
    const [track] = sourcePlaylist.tracks.splice(sourceIndex, 1);
    this.playlistRepository.updatePlaylist(sourcePlaylist);
    return this.playlistRepository.copyTrackIntoPlaylist(track, toPlaylistId, index);
  }

  commitQuickBuild(playlistId) {
    const playlist = this.playlistRepository.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error('Playlist not found');
    }
    if (playlist.uiState === 'quick_build_armed') {
      playlist.uiState = null;
      this.playlistRepository.updatePlaylist(playlist);
    }
    return this.playlistRepository.getPlaylist(playlistId);
  }
}

module.exports = {
  PlaylistEditor,
};
