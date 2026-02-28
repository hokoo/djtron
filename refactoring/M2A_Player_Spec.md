# M2A Audio Player — Спецификация рефакторинга (Frontend JS)

## Статус выполнения (что осталось)

- [x] Шаг 1. Вынести базовую авторизацию live-команд в `RolePolicy` и маршрутизацию в `CommandBus`.
- [x] Шаг 2. Ввести `PlaybackController` как единую точку управления воспроизведением.
- [x] Шаг 3. Перенести режимы `Simple/AutoPlay/DSP/DAP` в FSM `PlaybackController`.
- [x] Шаг 4. Внедрить `Play Next v3` (стратегии A/B, FIFO/LIFO сессии, ScheduledSwitch).
- [x] Шаг 5. Зафиксировать `AudioEngine` инварианты (overlap/fade, исключения для DSP fragments).
- [x] Шаг 6. Выделить `PlaylistEditor` и оставить `PlaylistRepository` только как data-layer.
- [x] Шаг 7. Закрыть тест-план из `M2A_Player_Tests.md` (A–I) — закрыто в текущем инкременте.

Дата: 2026-02-28  
Контекст: M2A (клиентская часть), управление воспроизведением в приложении с плейлистами, режимами Simple/AutoPlay/DSP/DAP, сетевыми ролями Host/Co-Host/Slave.

---

## 1) Цель рефакторинга

### 1.1 Главная цель
Упорядочить воспроизведение и исключить хаос/гонки/неожиданное поведение:

- **PlaybackController — единственная часть приложения, имеющая право запускать/останавливать/переключать аудио.**
- Все UI действия и все сетевые (API) сигналы превращаются в **команды** и проходят путь:  
  **UI / RemoteSync → CommandBus → PlaybackController → AudioEngine**

### 1.2 Сохраняем текущую продуктовую логику
- Логика ролей (Host/Co-Host/Slave) **сохраняется**.
- Возможности редактирования плейлистов Host/Slave **сохраняются** (переносятся в новый компонент PlaylistEditor).
- “Играть следующим” (Play Next) существует и меняется по уточнённым правилам (см. раздел 9).

---

## 2) Термины и определения

- **Track** — обычный трек плейлиста.
- **DSP fragment / transition fragment** — переходный фрагмент между треками в DSP-режиме. **Не считается треком.**
- **Playlist** — список треков + настройки (autoplay/dsp и др.).
- **Mode** — режим воспроизведения: **Simple / AutoPlay / DSP / DAP**.
- **Overlap** — наложение двух треков на N секунд на стыке Track→Track.
- **Fade** — плавный fade-in/fade-out на границе тишина↔Track.
- **HostLiveContext** — главный контекст воспроизведения (live). Существует только у Host.
- **LocalContext** — локальное воспроизведение на устройстве пользователя (актуально для Slave; у Co-Host отсутствует).

---

## 3) Инварианты (обязательные правила)

### 3.1 Инварианты режимов
- В каждый момент времени существует **ровно один ActiveMode**: `Simple | AutoPlay | DSP | DAP`.
- DAP имеет внутренние состояния `Off | Armed | Active | Suspended`, но **ActiveMode** всё равно один.

### 3.2 Инварианты аудио
- В любой момент времени звучит **не более одного источника**, кроме единственного исключения:
  - при включённом **Overlap** разрешено **до двух одновременных источников** в overlap-окно.
- **Overlap и Fade не применяются к DSP fragments.**

### 3.3 Инварианты управления
- Никакие компоненты, кроме PlaybackController (через AudioEngine), **не вызывают** `play/pause/stop` и не управляют WebAudio напрямую.
- Роли ограничивают, **кто и куда** может отправлять команды (см. раздел 10).

---

## 4) Доменные модели (сущности)

### 4.1 Track
Минимальная модель:
- `id`
- `src` (URI/URL/путь)
- `meta` (title/artist/duration и т.п. — опционально)

### 4.2 Playlist
- `id`
- `name`
- `tracks: Track[]`
- `settings`:
  - `autoPlayEnabled: boolean`
  - `dspEnabled: boolean` (валидно только при effective autoplay=true)
- `uiState?: null | "quick_build_armed"` — UI-состояние “быстрого формирования” (для Play Next стратегии B).

> Примечание: плейлист “быстрого формирования” — **обычный плейлист**; отдельного типа “виртуальный” не вводим. UI-state влияет только на интерфейс редактирования.

### 4.3 Segment (то, что реально играет)
`Segment = TrackSegment | DspFragmentSegment`

**TrackSegment**
- `kind: "track"`
- `playlistId`
- `trackId`
- `src`

**DspFragmentSegment**
- `kind: "dsp_fragment"`
- `fromTrackId`
- `toTrackId` (**обязательно известен**)
- `src | bufferRef` (как реализовано в AudioEngine)
- жёстко: `overlapAllowed=false`, `fadeAllowed=false`

### 4.4 GlobalPlaybackSettings
- `overlapEnabled: boolean`
- `overlapSeconds: number`
- `fadeEnabled: boolean`
- `fadeSeconds: number`
- `normalVolume: number`
- `dapVolume: number`

### 4.5 PlaybackState (публичное состояние)
- `activeMode: "simple"|"autoplay"|"dsp"|"dap"`
- `activePlaylistId?: string`
- `activeSegment?: Segment`
- `isPlaying: boolean`
- `playbackPhase: "idle" | "track" | "transition"`
- `transitionContext?: { fromTrackId: string, toTrackId: string }` (если `playbackPhase="transition"`)
- `dapState: "off"|"armed"|"active"|"suspended"`
- `dapPlaylistId?: string`
- `settings: GlobalPlaybackSettings`
- `hostNowPlaying` (на не-host клиентах, read-only)

---

## 5) Seamless Transition (бесшовные переходы)

### 5.1 Определение “бесшовно”
Переход между режимами бесшовный, если:
- текущий **TrackSegment** не прерывается и не перезапускается,
- сохраняется playhead,
- меняется только интерпретация “что будет дальше” и/или планирование next,
- допускается краткий ramp громкости (например вход/выход DAP), без паузы и без рестарта трека.

### 5.2 Hard transition
Любая смена, где текущий сегмент остановлен/перезапущен или возникла пауза — hard.

---

## 6) Команды и события

### 6.1 Команды (вход через CommandBus)
Обязательные поля у каждой команды:
- `origin: "ui" | "api" | "system"`
- `actorRole: "host" | "cohost" | "slave"`
- `target: "self" | "host"`

Команды:
- `PLAY_TRACK { playlistId, trackId, modeHint?, origin, actorRole, target }`
- `STOP { origin, actorRole, target }`
- `TOGGLE_AUTOPLAY { playlistId, enabled, origin, actorRole, target }`
- `TOGGLE_DSP { playlistId, enabled, origin, actorRole, target }`
- `TOGGLE_DAP { enabled, origin, actorRole, target }`
- `SET_DAP_PLAYLIST { playlistId, origin, actorRole, target }`
- `SET_OVERLAP { enabled, seconds, origin, actorRole, target }`
- `SET_FADE { enabled, seconds, origin, actorRole, target }`
- `SET_DAP_VOLUME { value, origin, actorRole, target }`
- `ACTIVATE_DAP_FROM_CURRENT { origin, actorRole, target }`

**Play Next v3**
- `PLAY_NEXT_REQUEST { trackRef, strategy, fifoSession?, origin, actorRole, target:"host" }`
  - `strategy: "COPY_INTO_ACTIVE" | "CREATE_NEW_PLAYNEXT_PLAYLIST"`
  - `fifoSession: "OFF" | "ON"` (только для COPY_INTO_ACTIVE)
  - `trackRef`: `{ src, trackId?, sourcePlaylistId?, meta? }`

### 6.2 События от AudioEngine
- `SEGMENT_STARTED { segment }`
- `SEGMENT_ENDED { segment }`
- `ERROR { segment?, error }`

---

## 7) Компоненты и области ответственности

### 7.1 PlaybackController (ядро)
Единственный владелец воспроизведения:
- принимает команды (после RolePolicy),
- управляет FSM режимов,
- планирует next, в т.ч. DSP fragments,
- применяет Overlap/Fade (кроме fragments),
- управляет DAP lifecycle,
- реализует Play Next v3 (копирование в плейлисты и scheduled switch),
- единственный компонент, который вызывает `AudioEngine.*`.

Зависимости:
- `AudioEngine`
- `PlaylistRepository`
- `SettingsStore`
- `DspTransitionProvider`
- `RemoteSync` (входящие команды/исходящее состояние)
- `CommandBus` (подача команд)
- `Logger`

### 7.2 AudioEngine
- проигрывание TrackSegment и DspFragmentSegment,
- overlap (до 2 источников) в заданном окне,
- fade-in/out на тишина↔Track,
- управление громкостью (normal/dap + ramp),
- события start/end/error.

### 7.3 CommandBus
- сериализация команд (очередь) и устранение гонок,
- нормализация/валидация структуры,
- проверка через `RolePolicy.can(...)`,
- маршрутизация `target=self/host`:
  - `target=host` → отправка через RemoteSync на Host, либо обработка на Host если уже там.

### 7.4 RolePolicy
Единый источник правил доступа по ролям (см. раздел 10).

### 7.5 RemoteSync
- доставка host-target команд на Host,
- трансляция HostNowPlaying state всем участникам как read-only,
- не запускает локальный AudioEngine на не-host клиентах.

### 7.6 PlaylistRepository
- хранение плейлистов и треков,
- атомарные операции редактирования:
  - create/delete playlist,
  - reorder playlists,
  - add/remove track,
  - move/copy track внутри/между плейлистами,
- не управляет воспроизведением.

### 7.7 PlaylistEditor (НОВЫЙ компонент)
Сюда переносится существующая логика редактирования плейлистов Host/Slave (сохранить функциональность 1:1):
- UI и orchestration редактирования,
- операции через PlaylistRepository (+ RemoteSync, если редактирование синхронизируется),
- поддержка special UI “quick build” (`playlist.uiState="quick_build_armed"`) и Commit-кнопки,
- **не** вызывает AudioEngine и не управляет режимами.

---

## 8) Режимы воспроизведения

### 8.1 SimpleMode
- один трек → конец → тишина,
- если `dapState="suspended"` → после конца трека resume DAP.

### 8.2 AutoPlayMode
- бесконечный цикл по текущему плейлисту,
- Track→Track с overlap если включён.

### 8.3 DspMode
- как AutoPlay, но возможны DSP fragments между треками,
- **DSP fragment A→B**: fragment не трек; после fragment **обязательно** играет B,
- overlap/fade к fragments не применяется.

### 8.4 DAP (Dead Air Prevention)
- состояния: Off/Armed/Active/Suspended
- Armed не запускает музыку автоматически: старт либо play в выбранном dapPlaylist, либо seamless “promote”.
- при старте другого режима DAP → Suspended,
- когда другой режим завершился/остановлен → resume DAP,
- dapVolume отличается от normalVolume.

---

## 9) Play Next v3 (итоговая логика)

### 9.1 Предусловия доступности (Host)
Play Next разрешён **только** если у Host:
- `activeMode ∈ {AutoPlay, DSP}`
- `activePlaylistId != null`
- `playbackPhase ∈ {"track","transition"}`
- если `playbackPhase="transition"` → `transitionContext.toTrackId` известен

### 9.2 UI: выбор стратегии (pop-up)
При запуске Play Next показывается pop-up:

**A) COPY_INTO_ACTIVE**
- копировать выбранный трек в **активный** плейлист “следующим”
- доп. опция: FIFO-сессия (докидывать “в очередь” после уже добавленных)

**B) CREATE_NEW_PLAYNEXT_PLAYLIST**
- создать новый обычный плейлист,
- добавить выбранный трек как первый,
- пометить `uiState="quick_build_armed"`,
- открыть special UI формирования (drag&drop),
- кнопка Commit (“Совершить редактирование”) снимает uiState,
- запланировать переключение воспроизведения на этот плейлист после якорного трека (см. ниже).

### 9.3 DSP transition правило (критично)
Если Play Next вызван во время DSP fragment A→B (`playbackPhase="transition"`):
- **Сразу после fragment обязателен трек B** (обычный трек плейлиста).
- Эффекты стратегии A и B применяются **только после B**.

Следовательно якорный трек:
- `anchor = currentTrackId` если `phase=track`
- `anchor = transitionContext.toTrackId` (это B) если `phase=transition`

### 9.4 Стратегия A: COPY_INTO_ACTIVE (реальное копирование)
- выполняется реальное копирование трека в активный плейлист через существующую операцию copy:
  - `PlaylistRepository.copyTrackIntoPlaylist(trackRef, activePlaylistId, insertAtIndex)`
- вставка выполняется после `anchor`:
  - `baseInsertIndex = index(anchor)+1`
- FIFO/LIFO (сессия):
  - LIFO: всегда вставлять на `baseInsertIndex` (каждый новый станет самым следующим)
  - FIFO: вставлять на `baseInsertIndex + insertedCount` (в порядке добавления)

`PlayNextInsertSession` (на Host, ephemeral):
- `{ playlistId, anchorTrackId, baseInsertIndex, policy, insertedCount }`

Сброс сессии:
- смена активного плейлиста,
- выход из AutoPlay/DSP,
- STOP,
- “после прохождения области вставок” (допускается упрощение реализации).

### 9.5 Стратегия B: CREATE_NEW_PLAYNEXT_PLAYLIST
- создать новый плейлист `Y` (обычный),
- добавить выбранный трек как первый,
- `Y.uiState="quick_build_armed"`,
- установить `ScheduledSwitch { toPlaylistId:Y, afterTrackId: anchor, switchMode="AutoPlay" }`.

Переключение:
- происходит **после завершения afterTrackId**,
- активируется AutoPlay на новом плейлисте,
- uiState остаётся до явного Commit UI (не влияет на playback).

### 9.6 Взаимодействие A/B и конкуренция
- Если стоит `ScheduledSwitch` (B) и приходит A: нормативно **отменить ScheduledSwitch** (пользователь выбрал “копировать в текущий”).  
- Если приходит новый B при существующем B: latest wins (заменить ScheduledSwitch).

---

## 10) Роли и права (сохранить текущую логику)

### 10.1 Роли
- Host — единственный, воспроизводит live, имеет максимальные права.
- Co-Host — ничего не играет локально; может посылать на Host **только play/stop**; не имеет тумблеров режимов, не имеет DAP/DSP/AutoPlay настроек, не имеет Play Next.
- Slave — видит host state (read-only), редактирует плейлисты, может играть локально **только Simple**, не может play/stop Host, но может Play Next для Host.

### 10.2 Матрица прав (нормативно)
- Host: всё (play/stop/режимы/DAP/PlayNext/редактирование).
- Co-Host: только `PLAY_TRACK(target=host)` и `STOP(target=host)`.
- Slave:
  - локально: `PLAY_TRACK(target=self)` и `STOP(target=self)` (Simple-only),
  - для Host: `PLAY_NEXT_REQUEST(target=host)` разрешено,
  - play/stop host запрещено,
  - toggle режимов/DAP для host запрещено,
  - редактирование плейлистов разрешено (как сейчас).

Enforcement:
- UI gating + CommandBus validation (второй слой, обязательный).

---

## 11) Definition of Done
- PlaybackController — единственный владелец управления аудио.
- Команды идут только через CommandBus.
- Инварианты соблюдены:
  - один ActiveMode,
  - максимум 2 источника только в overlap,
  - overlap/fade не применяются к DSP fragments,
  - во время DSP transition A→B трек B обязателен первым после fragment.
- Роли работают как сейчас.
- PlaylistEditor содержит всю логику редактирования (перенос без потерь).
- Play Next реализован по v3, включая стратегии A/B и quick build UI-state.
