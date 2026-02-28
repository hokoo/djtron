class PlaybackController {
  constructor({ audioEngine, playlistRepository, remoteSync } = {}) {
    this.audioEngine = audioEngine;
    this.playlistRepository = playlistRepository;
    this.remoteSync = remoteSync || { broadcastState: () => {} };
    this.nextPlaylistIdCounter = 1;
    this.state = {
      activeMode: 'simple',
      activePlaylistId: null,
      activeSegment: null,
      isPlaying: false,
      playbackPhase: 'idle',
      transitionContext: null,
      dapState: 'off',
      dapPlaylistId: null,
      settings: {
        overlapEnabled: false,
        fadeEnabled: false,
      },
      playNextSession: null,
      scheduledSwitch: null,
    };
  }

  handleCommand(command = {}) {
    const type = command.type;
    switch (type) {
      case 'play-track':
        return this.playTrack(command);
      case 'stop':
        return this.stop();
      case 'toggle-autoplay':
        return this.toggleAutoplay(command);
      case 'toggle-dsp':
        return this.toggleDsp(command);
      case 'toggle-dap':
        return this.toggleDap(command);
      case 'activate-dap-from-current':
        return this.activateDapFromCurrent();
      case 'play-next-request':
        return this.playNext(command);
      case 'segment-ended':
        return this.onSegmentEnded(command);
      default:
        return this.getState();
    }
  }

  playTrack({ playlistId, trackId, sourceRole, target }) {
    const playlist = this.playlistRepository.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error('Playlist not found');
    }
    const track = playlist.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw new Error('Track not found');
    }
    if (sourceRole === 'slave' && (target === 'self' || !target) && playlist.settings && playlist.settings.autoPlayEnabled) {
      throw new Error('NOT_SUPPORTED_IN_LOCAL_CONTEXT');
    }
    if (this.state.activeMode === 'dap' && this.state.dapState === 'active' && playlistId !== this.state.dapPlaylistId) {
      this.state.dapState = 'suspended';
    }
    this.state.activePlaylistId = playlistId;
    this.state.activeSegment = { kind: 'track', playlistId, trackId: track.id, src: track.src };
    this.state.isPlaying = true;
    this.state.playbackPhase = 'track';
    if (this.state.dapState === 'armed' && this.state.dapPlaylistId === playlistId) {
      this.state.activeMode = 'dap';
      this.state.dapState = 'active';
    } else {
      this.state.activeMode = this.resolvePlaylistMode(playlist);
    }
    if (this.audioEngine) {
      this.audioEngine.play(this.state.activeSegment);
    }
    return this.broadcast();
  }

  stop() {
    if (this.audioEngine) {
      this.audioEngine.stopAll();
    }
    this.state.isPlaying = false;
    this.state.activeSegment = null;
    this.state.playbackPhase = 'idle';
    this.state.transitionContext = null;
    this.state.playNextSession = null;
    this.state.scheduledSwitch = null;
    this.state.dapState = 'off';
    this.state.activeMode = 'simple';
    return this.broadcast();
  }

  toggleAutoplay({ playlistId, enabled }) {
    const playlist = this.playlistRepository.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error('Playlist not found');
    }
    playlist.settings = playlist.settings || {};
    playlist.settings.autoPlayEnabled = Boolean(enabled);
    if (!playlist.settings.autoPlayEnabled) {
      playlist.settings.dspEnabled = false;
    }
    this.playlistRepository.updatePlaylist(playlist);
    if (this.state.activePlaylistId === playlistId && this.state.activeMode !== 'dap') {
      this.state.activeMode = this.resolvePlaylistMode(playlist);
    }
    return this.broadcast();
  }

  toggleDsp({ playlistId, enabled }) {
    const playlist = this.playlistRepository.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error('Playlist not found');
    }
    playlist.settings = playlist.settings || {};
    playlist.settings.dspEnabled = Boolean(enabled) && Boolean(playlist.settings.autoPlayEnabled);
    this.playlistRepository.updatePlaylist(playlist);
    if (this.state.activePlaylistId === playlistId && this.state.activeMode !== 'dap') {
      this.state.activeMode = this.resolvePlaylistMode(playlist);
    }
    return this.broadcast();
  }

  toggleDap({ enabled, playlistId }) {
    if (!enabled) {
      this.state.dapState = 'off';
      if (this.state.activeMode === 'dap') {
        const playlist = this.playlistRepository.getPlaylist(this.state.activePlaylistId);
        this.state.activeMode = playlist ? this.resolvePlaylistMode(playlist) : 'simple';
      }
      return this.broadcast();
    }
    this.state.dapState = 'armed';
    this.state.dapPlaylistId = playlistId || this.state.dapPlaylistId;
    return this.broadcast();
  }

  activateDapFromCurrent() {
    if (this.state.dapState === 'armed' && this.state.dapPlaylistId === this.state.activePlaylistId) {
      this.state.activeMode = 'dap';
      this.state.dapState = 'active';
    }
    return this.broadcast();
  }

  playNext({ strategy = 'copy-into-active', track, fifoSession }) {
    if (this.state.activeMode !== 'autoplay' && this.state.activeMode !== 'dsp') {
      throw new Error('Play Next доступен только в AutoPlay/DSP');
    }
    const anchorTrackId = this.state.playbackPhase === 'transition' && this.state.transitionContext
      ? this.state.transitionContext.toTrackId
      : this.state.activeSegment && this.state.activeSegment.trackId;
    if (!anchorTrackId) {
      throw new Error('Anchor track is required');
    }
    if (strategy === 'create-new-playnext-playlist') {
      return this.playNextCreateNewPlaylist(track, anchorTrackId);
    }
    return this.playNextCopyIntoActive(track, anchorTrackId, fifoSession);
  }

  playNextCopyIntoActive(track, anchorTrackId, fifoSession) {
    const playlist = this.playlistRepository.getPlaylist(this.state.activePlaylistId);
    if (!playlist) {
      throw new Error('Active playlist not found');
    }
    this.state.scheduledSwitch = null;
    const anchorIndex = playlist.tracks.findIndex((item) => item.id === anchorTrackId);
    const baseInsertIndex = anchorIndex < 0 ? playlist.tracks.length : anchorIndex + 1;
    if (!this.state.playNextSession || this.state.playNextSession.anchorTrackId !== anchorTrackId) {
      this.state.playNextSession = {
        anchorTrackId,
        playlistId: this.state.activePlaylistId,
        baseInsertIndex,
        insertedCount: 0,
        policy: fifoSession ? 'fifo' : 'lifo',
      };
    }
    const insertIndex = this.state.playNextSession.policy === 'fifo'
      ? this.state.playNextSession.baseInsertIndex + this.state.playNextSession.insertedCount
      : this.state.playNextSession.baseInsertIndex;
    this.playlistRepository.copyTrackIntoPlaylist(track, this.state.activePlaylistId, insertIndex);
    this.state.playNextSession.insertedCount += 1;
    return this.broadcast();
  }

  playNextCreateNewPlaylist(track, anchorTrackId) {
    const playlistId = `playnext-${this.nextPlaylistIdCounter++}`;
    this.playlistRepository.createPlaylist({
      id: playlistId,
      name: `Play Next ${playlistId}`,
      tracks: [track],
      settings: { autoPlayEnabled: true, dspEnabled: false },
      uiState: 'quick_build_armed',
    });
    this.state.playNextSession = null;
    this.state.scheduledSwitch = {
      toPlaylistId: playlistId,
      afterTrackId: anchorTrackId,
      switchMode: 'autoplay',
    };
    return this.broadcast();
  }

  onSegmentEnded({ segment } = {}) {
    if (segment && segment.kind === 'dsp_fragment' && this.state.transitionContext && this.state.transitionContext.toTrackId) {
      const nextTrackId = this.state.transitionContext.toTrackId;
      this.state.playbackPhase = 'track';
      this.state.transitionContext = null;
      return this.playTrack({ playlistId: this.state.activePlaylistId, trackId: nextTrackId });
    }
    const endedTrackId = segment && segment.trackId;
    if (
      this.state.scheduledSwitch &&
      endedTrackId &&
      this.state.scheduledSwitch.afterTrackId === endedTrackId
    ) {
      const playlist = this.playlistRepository.getPlaylist(this.state.scheduledSwitch.toPlaylistId);
      this.state.activePlaylistId = playlist.id;
      this.state.activeMode = 'autoplay';
      this.state.scheduledSwitch = null;
      if (playlist.tracks.length > 0) {
        return this.playTrack({ playlistId: playlist.id, trackId: playlist.tracks[0].id });
      }
    }
    if (this.state.dapState === 'suspended' && this.state.activeMode === 'simple') {
      this.state.activeMode = 'dap';
      this.state.dapState = 'active';
      return this.broadcast();
    }
    this.state.isPlaying = false;
    this.state.activeSegment = null;
    this.state.playbackPhase = 'idle';
    return this.broadcast();
  }

  resolvePlaylistMode(playlist) {
    if (playlist.settings && playlist.settings.autoPlayEnabled) {
      return playlist.settings.dspEnabled ? 'dsp' : 'autoplay';
    }
    return 'simple';
  }

  broadcast() {
    const snapshot = this.getState();
    this.remoteSync.broadcastState(snapshot);
    return snapshot;
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }
}

module.exports = {
  PlaybackController,
};
