/**
 * Converts between the legacy server layout format (array-of-paths)
 * and the M2A playlist model used by PlaylistRepository.
 */

/**
 * Convert legacy server layout state to M2A playlists array.
 * @param {Object} state - Legacy layout state from server
 * @returns {Array} Array of M2A playlist objects
 */
export function legacyToPlaylists(state) {
  if (!state) return [];

  // If server already sends M2A format
  if (Array.isArray(state.playlists)) return state.playlists;

  const layout = state.layout || [];
  const names = state.playlistNames || [];
  const meta = state.playlistMeta || [];
  const autoplay = state.playlistAutoplay || [];
  const dsp = state.playlistDsp || [];

  return layout.map((trackPaths, index) => {
    const playlistId = `p-${index}`;
    const tracks = (trackPaths || []).map((filePath, trackIdx) => ({
      id: `t-${index}-${trackIdx}`,
      src: `/audio/${filePath}`,
      meta: {
        originalPath: filePath,
        titleMode: state.trackTitleModesByTrack
          ? state.trackTitleModesByTrack[filePath]
          : undefined,
      },
    }));

    const metaEntry = meta[index] || {};
    return {
      id: playlistId,
      name: names[index] || `Playlist ${index + 1}`,
      type: metaEntry.type || 'manual',
      tracks,
      settings: {
        autoPlayEnabled: Boolean(autoplay[index]),
        dspEnabled: Boolean(dsp[index]),
      },
      uiState: null,
    };
  });
}

/**
 * Convert M2A playlists array back to legacy server format.
 * Used to send updates to the server while it still expects the old format.
 * @param {Array} playlists - M2A playlist objects
 * @param {Object} extraState - Additional state fields to preserve
 * @returns {Object} Legacy layout state object
 */
export function playlistsToLegacy(playlists, extraState = {}) {
  const layout = [];
  const playlistNames = [];
  const playlistMeta = [];
  const playlistAutoplay = [];
  const playlistDsp = [];
  const trackTitleModesByTrack = {};

  for (const pl of playlists) {
    const trackPaths = pl.tracks.map(t => {
      const path = t.meta && t.meta.originalPath
        ? t.meta.originalPath
        : t.src.replace(/^\/audio\//, '');
      if (t.meta && t.meta.titleMode !== undefined) {
        trackTitleModesByTrack[path] = t.meta.titleMode;
      }
      return path;
    });
    layout.push(trackPaths);
    playlistNames.push(pl.name);
    playlistMeta.push({ type: pl.type || 'manual' });
    playlistAutoplay.push(Boolean(pl.settings && pl.settings.autoPlayEnabled));
    playlistDsp.push(Boolean(pl.settings && pl.settings.dspEnabled));
  }

  return {
    ...extraState,
    layout,
    playlistNames,
    playlistMeta,
    playlistAutoplay,
    playlistDsp,
    trackTitleModesByTrack,
  };
}

/**
 * Convert legacy DAP config to M2A format.
 */
export function legacyDapToM2A(dapConfig, playlistCount) {
  if (!dapConfig) return { enabled: false, playlistId: null, volumePercent: 5 };
  return {
    enabled: Boolean(dapConfig.enabled),
    playlistId: typeof dapConfig.playlistIndex === 'number' ? `p-${dapConfig.playlistIndex}` : null,
    volumePercent: dapConfig.volumePercent || 5,
  };
}

/**
 * Convert M2A DAP config back to legacy format.
 */
export function m2aDapToLegacy(dapConfig) {
  if (!dapConfig) return { enabled: false, playlistIndex: null, volumePercent: 5 };
  const idxMatch = dapConfig.playlistId ? dapConfig.playlistId.match(/^p-(\d+)$/) : null;
  return {
    enabled: Boolean(dapConfig.enabled),
    playlistIndex: idxMatch ? parseInt(idxMatch[1], 10) : null,
    volumePercent: dapConfig.volumePercent || 5,
  };
}
