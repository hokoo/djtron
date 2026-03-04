# Фаза 3 — Клиентский рефакторинг (script.js)

## Цель
Разбить монолитный `public/script.js` (11972 строк, 584 функции) на модули.
Фаза 3 — отдельный трек, не блокирует фазу 2.

## Текущее состояние
- Один файл `public/script.js` — 12K строк
- Vanilla JS, нет build-системы/bundler'а
- Тесно связанные блоки: UI rendering, state management, network, audio, drag-and-drop

## Предварительный план

### PR-A — Ввести ES modules или bundler
- Выбрать подход: ES modules (`<script type="module">`) или simple bundler (esbuild)
- Создать entry point, разбить на logical modules

### PR-B — Network layer extraction
- `src/client/api.js` — fetch-обёртки для всех API endpoints
- `src/client/sse.js` — SSE client (layout stream)

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
