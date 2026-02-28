function cloneTrack(track) {
  return { ...track, meta: track && track.meta ? { ...track.meta } : track.meta };
}

function clonePlaylist(playlist) {
  return {
    ...playlist,
    tracks: Array.isArray(playlist.tracks) ? playlist.tracks.map(cloneTrack) : [],
    settings: playlist && playlist.settings ? { ...playlist.settings } : {},
  };
}

class PlaylistRepository {
  constructor(initialPlaylists = []) {
    this.playlists = new Map();
    for (const playlist of initialPlaylists) {
      this.playlists.set(playlist.id, clonePlaylist(playlist));
    }
  }

  getPlaylist(id) {
    const playlist = this.playlists.get(id);
    return playlist ? clonePlaylist(playlist) : null;
  }

  getPlaylists() {
    return Array.from(this.playlists.values()).map(clonePlaylist);
  }

  createPlaylist(playlist) {
    if (!playlist || !playlist.id) {
      throw new Error('Playlist id is required');
    }
    this.playlists.set(playlist.id, clonePlaylist(playlist));
    return this.getPlaylist(playlist.id);
  }

  updatePlaylist(playlist) {
    if (!playlist || !playlist.id || !this.playlists.has(playlist.id)) {
      throw new Error('Playlist not found');
    }
    this.playlists.set(playlist.id, clonePlaylist(playlist));
    return this.getPlaylist(playlist.id);
  }

  deletePlaylist(id) {
    return this.playlists.delete(id);
  }

  copyTrackIntoPlaylist(trackRef, playlistId, index) {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) {
      throw new Error('Playlist not found');
    }
    const track = cloneTrack(trackRef);
    const insertionIndex = Math.max(0, Math.min(index, playlist.tracks.length));
    playlist.tracks.splice(insertionIndex, 0, track);
    this.playlists.set(playlistId, playlist);
    return this.getPlaylist(playlistId);
  }
}

module.exports = {
  PlaylistRepository,
};
