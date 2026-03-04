# Фаза 3 — Клиентский рефакторинг (script.js)

## Результат
Монолит `public/script.js` (11,972 строк) разбит на 25 ES-модулей + доменный слой.

### Phase 3A (c7779c9): Domain Layer + Module Infrastructure
- `shared/playback/` — 8 ESM-модулей (source of truth для browser + server):
  AudioEngine, BrowserAudioEngine, PlaybackController, PlaylistRepository,
  PlaylistEditor, PlaybackCommandBus, RolePolicy
- Серверный маршрут `/shared/*` для browser ESM imports
- Клиентские адаптеры: api-domain.js, layout-sync.js, config-manager.js,
  model-converter.js (legacy↔M2A), bootstrap.js

### Phase 3C (3129ca7): Client Decomposition
- `script.js` → 575 строк (bootstrap + wiring)
- 25 модулей в `public/modules/` (12,627 строк):

**Core:**
| Module | Lines | Purpose |
|--------|-------|---------|
| state.js | 352 | Constants, shared state, DOM refs |
| config.js | 342 | Runtime config, volume presets |
| audio.js | 535 | createAudio, handlePlay, fade, overlay |
| sse.js | 80 | SSE layout stream |
| roles.js | 38 | isHostRole, isSlaveRole, etc. |
| utils.js | 22 | Shared utilities |

**Features:**
| Module | Lines | Purpose |
|--------|-------|---------|
| playlists.js | 2943 | Zone rendering, playlist CRUD, tracks |
| playback-sync.js | 1834 | Host/slave sync, progress, DSP |
| dnd.js | 1193 | Desktop drag-and-drop |
| touch.js | 1832 | Touch gestures, pan, collapse, reorder |
| dsp-live.js | 679 | DSP live transitions, autoplay |

**UI Panels:**
| Module | Lines | Purpose |
|--------|-------|---------|
| ui/auth.js | 538 | Auth overlay, server controls |
| ui/nowplaying.js | 678 | Now playing, seek, progress |
| ui/volume.js | 242 | Volume presets UI |
| ui/dap.js | 175 | DAP settings |
| ui/dsp.js | 177 | DSP setup |
| ui/updater.js | 197 | Version check, update |
| ui/settings.js | 89 | Transition settings |
| ui/status.js | 109 | Status bar, overlays |

### Phase 3B: Server Data Model Migration — DEFERRED
- model-converter.js handles legacy↔M2A conversion on the client
- Server keeps array-of-paths format for now
- Can be migrated later when client M2A integration deepens

### PR-C — Audio player extraction
- `src/client/audio/player.js` — Web Audio API wrapper
- `src/client/audio/probe.js` — audio duration detection

### PR-D — UI components
- `src/client/ui/playlists.js` — playlist rendering, drag-and-drop
- `src/client/ui/playback.js` — playback controls
- `src/client/ui/auth.js` — login form, user management
- `src/client/ui/dsp.js` — DSP setup panel

### PR-E — State management
- `src/client/state/layout.js` — client-side layout state
- `src/client/state/playback.js` — playback state sync
- `src/client/state/config.js` — runtime config

## Acceptance (фаза 3)
- script.js → entry point ~100 строк
- Все UI-функции работают идентично
- Нет регрессий в touch/drag-and-drop поведении
