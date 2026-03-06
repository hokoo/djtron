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
- `script.js` → ~620 строк (bootstrap + wiring)
- модули в `public/modules/` (20+ файлов):

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

### Phase 3B (current): Server Data Model Migration
- `src/layout/LayoutStateService.js` переведён на M2A-формат:
  - `layoutState.playlists[]` вместо `layout + playlistNames + playlistMeta + playlistAutoplay + playlistDsp`
  - `dapConfig.playlistId` вместо `dapConfig.playlistIndex`
- `/api/layout` и SSE `layout` теперь публикуют M2A payload (`playlists`, `dapConfig`, `trackTitleModesByTrack`)
- Legacy payload для `POST /api/layout` более не принимается (новое приложение без backward compatibility)
- DSP планирование переведено на snapshot из M2A (`layoutService.buildDspLayoutSnapshot()`)
- Host init больше не использует fallback из legacy `localStorage` layout при пустом server-layout.
- Канонический envelope playback-команд: `origin + actorRole + target`; `sourceRole` поддерживается как backward-compatible alias на входе.

## Статус фазы 3
- 3A: выполнено
- 3B: выполнено (серверная модель M2A активирована)
- 3C: выполнено
