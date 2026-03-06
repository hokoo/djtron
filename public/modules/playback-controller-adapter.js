// public/modules/playback-controller-adapter.js

import { AudioEngine, PlaybackController, PlaylistRepository } from '/shared/playback/index.js';

function normalizePlaylistIndex(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function sanitizeTrackFile(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toControllerPlaylistId(playlistIndex) {
  return `playlist-${playlistIndex}`;
}

function toControllerTrackId(playlistIndex, trackIndex) {
  return `track-${playlistIndex}-${trackIndex}`;
}

function buildControllerProjection({ layout = [], playlistAutoplay = [], playlistDsp = [] } = {}) {
  const safeLayout = Array.isArray(layout)
    ? layout.map((playlist) => (Array.isArray(playlist) ? playlist : []))
    : [];
  const playlists = safeLayout.map((playlist, playlistIndex) => {
    const autoplayEnabled = Boolean(Array.isArray(playlistAutoplay) && playlistAutoplay[playlistIndex]);
    const dspEnabled = autoplayEnabled && Boolean(Array.isArray(playlistDsp) && playlistDsp[playlistIndex]);
    return {
      id: toControllerPlaylistId(playlistIndex),
      name: `Playlist ${playlistIndex + 1}`,
      tracks: playlist.map((file, trackIndex) => {
        const src = sanitizeTrackFile(file) || `track-${playlistIndex}-${trackIndex}`;
        return {
          id: toControllerTrackId(playlistIndex, trackIndex),
          src,
        };
      }),
      settings: {
        autoPlayEnabled: autoplayEnabled,
        dspEnabled,
      },
    };
  });

  return {
    createController() {
      return new PlaybackController({
        audioEngine: new AudioEngine(),
        playlistRepository: new PlaylistRepository(playlists),
      });
    },
    getPlaylistId(playlistIndex) {
      const normalizedIndex = normalizePlaylistIndex(playlistIndex);
      if (normalizedIndex === null || normalizedIndex >= playlists.length) return null;
      return playlists[normalizedIndex].id;
    },
    getTrackId(playlistIndex, trackIndex) {
      const normalizedPlaylistIndex = normalizePlaylistIndex(playlistIndex);
      const normalizedTrackIndex = normalizePlaylistIndex(trackIndex);
      if (
        normalizedPlaylistIndex === null ||
        normalizedTrackIndex === null ||
        normalizedPlaylistIndex >= playlists.length ||
        normalizedTrackIndex >= playlists[normalizedPlaylistIndex].tracks.length
      ) {
        return null;
      }
      return playlists[normalizedPlaylistIndex].tracks[normalizedTrackIndex].id;
    },
    getPlaybackMode(playlistIndex) {
      const normalizedIndex = normalizePlaylistIndex(playlistIndex);
      if (normalizedIndex === null) return 'simple';
      const autoplayEnabled = Boolean(Array.isArray(playlistAutoplay) && playlistAutoplay[normalizedIndex]);
      const dspEnabled = autoplayEnabled && Boolean(Array.isArray(playlistDsp) && playlistDsp[normalizedIndex]);
      if (dspEnabled) return 'dsp';
      if (autoplayEnabled) return 'autoplay';
      return 'simple';
    },
  };
}

export function createHostPlaybackControllerAdapter(deps = {}) {
  const {
    getSnapshot = () => ({}),
    resolvePlayTrackContext = () => null,
    resolvePlayNextAnchorContext = () => null,
    isTransitionPlaybackActive = () => false,
    onStop = async () => {},
    onToggle = async () => {},
    onPlayNext = async () => {},
    onPlayTrack = async () => {},
  } = deps;

  async function validatePlayTrackWithController(command) {
    const context = resolvePlayTrackContext(command);
    if (
      !context ||
      normalizePlaylistIndex(context.playlistIndex) === null ||
      normalizePlaylistIndex(context.playlistPosition) === null
    ) {
      return;
    }

    const projection = buildControllerProjection(getSnapshot());
    const playlistId = projection.getPlaylistId(context.playlistIndex);
    const trackId = projection.getTrackId(context.playlistIndex, context.playlistPosition);
    if (!playlistId || !trackId) return;

    const controller = projection.createController();
    controller.handleCommand({
      type: 'play-track',
      playlistId,
      trackId,
      sourceRole: 'host',
      target: 'self',
    });
  }

  async function validatePlayNextWithController(command) {
    const anchorContext = resolvePlayNextAnchorContext();
    if (!anchorContext) return;

    const anchorPlaylistIndex = normalizePlaylistIndex(anchorContext.playlistIndex);
    const anchorTrackPosition = normalizePlaylistIndex(anchorContext.playlistPosition);
    if (anchorPlaylistIndex === null || anchorTrackPosition === null) return;

    const projection = buildControllerProjection(getSnapshot());
    const activePlaylistId = projection.getPlaylistId(anchorPlaylistIndex);
    const anchorTrackId = projection.getTrackId(anchorPlaylistIndex, anchorTrackPosition);
    if (!activePlaylistId || !anchorTrackId) return;

    const controller = projection.createController();
    const inTransition = Boolean(isTransitionPlaybackActive());
    controller.state.activePlaylistId = activePlaylistId;
    controller.state.activeMode = projection.getPlaybackMode(anchorPlaylistIndex);
    controller.state.playbackPhase = inTransition ? 'transition' : 'track';
    controller.state.isPlaying = true;
    controller.state.activeSegment = {
      kind: 'track',
      playlistId: activePlaylistId,
      trackId: anchorTrackId,
      src: sanitizeTrackFile(anchorContext.file) || 'anchor-track',
    };
    controller.state.transitionContext = inTransition
      ? { fromTrackId: anchorTrackId, toTrackId: anchorTrackId }
      : null;

    controller.handleCommand({
      type: 'play-next-request',
      strategy:
        command && command.strategy === 'create-new-playnext-playlist'
          ? 'create-new-playnext-playlist'
          : 'copy-into-active',
      fifoSession: Boolean(command && command.fifoSession),
      track: {
        id: `play-next-${Date.now()}`,
        src: sanitizeTrackFile(command && command.file) || 'play-next-track',
      },
    });
  }

  function validateStopWithController() {
    const controller = buildControllerProjection(getSnapshot()).createController();
    controller.handleCommand({ type: 'stop' });
  }

  return {
    async execute(command, { sourceTag = '' } = {}) {
      if (!command || typeof command !== 'object') return false;

      if (command.type === 'stop') {
        validateStopWithController();
        await onStop(command, { sourceTag });
        return true;
      }

      if (command.type === 'toggle-current') {
        await onToggle(command, { sourceTag });
        return true;
      }

      if (command.type === 'play-next-request') {
        await validatePlayNextWithController(command);
        await onPlayNext(command, { sourceTag });
        return true;
      }

      if (command.type === 'play-track') {
        await validatePlayTrackWithController(command);
        await onPlayTrack(command, { sourceTag });
        return true;
      }

      return false;
    },
  };
}
