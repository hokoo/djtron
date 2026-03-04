/**
 * djTRON — Client Bootstrap (Phase 3A)
 *
 * This module instantiates the M2A domain layer and connects it to the server.
 * Currently runs alongside the legacy script.js for verification.
 */

import {
  PlaybackController,
  PlaylistRepository,
  PlaylistEditor,
  PlaybackCommandBus,
  BrowserAudioEngine,
  canDispatchLivePlaybackCommand,
  ROLE_HOST,
} from '/shared/playback/index.js';

import * as api from './modules/api.js';
import { LayoutSync } from './modules/layout-sync.js';
import { ConfigManager } from './modules/config.js';
import { legacyToPlaylists, playlistsToLegacy, legacyDapToM2A } from './modules/model-converter.js';

// --- Domain Layer ---
const audioEngine = new BrowserAudioEngine();
const playlistRepo = new PlaylistRepository();
const playlistEditor = new PlaylistEditor(playlistRepo);
const controller = new PlaybackController({
  audioEngine,
  playlistRepository: playlistRepo,
  remoteSync: {
    broadcastState: (state) => {
      api.playbackUpdate(state).catch(err => console.warn('Playback sync failed:', err));
    },
  },
});
const commandBus = new PlaybackCommandBus(controller);
const config = new ConfigManager();

// --- SSE Connection ---
const layoutSync = new LayoutSync({
  onLayoutUpdate: (data) => {
    const playlists = legacyToPlaylists(data);
    playlists.forEach(pl => {
      if (playlistRepo.getPlaylist(pl.id)) {
        playlistRepo.updatePlaylist(pl);
      } else {
        playlistRepo.createPlaylist(pl);
      }
    });
    console.log('[djTRON] Layout synced:', playlistRepo.getAllPlaylists().length, 'playlists');
  },
  onPlaybackUpdate: (data) => {
    console.log('[djTRON] Playback update:', data);
  },
  onOpen: () => console.log('[djTRON] SSE connected'),
  onError: () => console.warn('[djTRON] SSE error, reconnecting...'),
});

// --- Audio Engine Events ---
audioEngine.on('ended', ({ segment }) => {
  controller.handleCommand({ type: 'segment-ended', segment });
});

audioEngine.on('timeupdate', ({ currentTime, duration }) => {
  // Will be used by NowPlayingPanel in Phase 3C
});

audioEngine.on('error', ({ segment, error }) => {
  console.error('[djTRON] Audio error:', segment?.src, error);
});

// --- Initialization ---
async function init() {
  try {
    await config.loadFromServer(api.configGet);
    audioEngine.setVolume(config.get('liveVolume'));
    audioEngine.setOverlap(config.get('overlaySeconds'), config.get('fadeCurve'));
    audioEngine.setStopFade(config.get('stopFadeSeconds'));

    const layout = await api.layoutGet();
    const playlists = legacyToPlaylists(layout);
    playlists.forEach(pl => playlistRepo.createPlaylist(pl));

    layoutSync.connect();

    console.log('[djTRON] Domain layer initialized');
    console.log('[djTRON] Playlists:', playlistRepo.getAllPlaylists().length);
    console.log('[djTRON] Controller state:', controller.getState());
  } catch (err) {
    console.error('[djTRON] Init failed:', err);
  }
}

// Export for debugging in console
window.__djtron = {
  controller,
  playlistRepo,
  playlistEditor,
  commandBus,
  audioEngine,
  config,
  layoutSync,
  api,
};

init();
