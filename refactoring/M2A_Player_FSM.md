# M2A Audio Player — FSM (нормативная таблица переходов)

Дата: 2026-02-28

Эта часть описывает строгое поведение **PlaybackController на HostLiveContext**.
Ролевые ограничения применяются до FSM (RolePolicy/CommandBus).

---

## Обозначения

- `M` — activeMode ∈ {Simple, AutoPlay, DSP, DAP}
- `P` — playbackPhase ∈ {idle, track, transition}
- `Seg.kind` — {track, dsp_fragment}
- `D` — dapState ∈ {Off, Armed, Active, Suspended}
- `APL` — activePlaylistId
- `SS` — ScheduledSwitch: None | {toPlaylistId, afterTrackId, switchMode="AutoPlay"}
- `PS` — PlayNextInsertSession: None | {playlistId, anchorTrackId, baseInsertIndex, policy(LIFO|FIFO), insertedCount}
- DSP transition контекст: если `P=transition`, то `transitionContext={from:A,to:B}` и **B обязателен к проигрыванию сразу после fragment**.

---

## 1) Команды PLAY_TRACK / STOP

| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| Любое | STOP | — | 1) AudioEngine.stopAll() 2) PS=None, SS=None 3) D=Off 4) P=idle | M=Simple,P=idle,D=Off |
| Любое | PLAY_TRACK(pid,tid) | playlist(pid).autoPlayEnabled=false | 1) если D=Active→D=Suspended 2) migrateMode(Simple) 3) AudioEngine.play(track) | M=Simple,P=track |
| Любое | PLAY_TRACK(pid,tid) | autoPlayEnabled=true & dspEnabled=false | 1) если D=Active→D=Suspended 2) migrateMode(AutoPlay) 3) AudioEngine.play(track) | M=AutoPlay,P=track |
| Любое | PLAY_TRACK(pid,tid) | autoPlayEnabled=true & dspEnabled=true | 1) если D=Active→D=Suspended 2) migrateMode(DSP) 3) AudioEngine.play(track) | M=DSP,P=track |

Примечание: migrateMode может быть seamless только если трек не меняется (тот же TrackSegment).

---

## 2) Тумблеры AutoPlay/DSP (seamless если активный плейлист)

| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| M=Simple,P=track,APL=X | TOGGLE_AUTOPLAY(X,true) | — | migrateMode(AutoPlay,seamless=true) | M=AutoPlay |
| M=AutoPlay,P=track,APL=X | TOGGLE_AUTOPLAY(X,false) | — | migrateMode(Simple,seamless=true) | M=Simple |
| M=DSP,P=track/transition,APL=X | TOGGLE_AUTOPLAY(X,false) | — | migrateMode(Simple,seamless=true) + DSP invalid | M=Simple |
| M=AutoPlay,P=track,APL=X | TOGGLE_DSP(X,true) | — | migrateMode(DSP,seamless=true) | M=DSP |
| M=Simple,P=track,APL=X | TOGGLE_DSP(X,true) | — | effective autoplay=true; migrateMode(DSP,seamless=true) | M=DSP |
| M=DSP,P=track/transition,APL=X | TOGGLE_DSP(X,false) | — | migrateMode(AutoPlay,seamless=true) | M=AutoPlay |

Если playlistId != APL: меняем настройку плейлиста без смены режима.

---

## 3) DAP lifecycle

### 3.1 Арминг
| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| Любое | SET_DAP_PLAYLIST(pid) | — | dapPlaylistId=pid | — |
| D=Off | TOGGLE_DAP(true) | dapPlaylistId!=null | D=Armed | D=Armed |
| D=Off | TOGGLE_DAP(true) | dapPlaylistId==null | REJECT | — |
| D=Armed/Active/Suspended | TOGGLE_DAP(true) | — | no-op | — |

### 3.2 Запуск (классический / seamless promote)
| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| D=Armed | PLAY_TRACK(dapPid,tid) | — | migrateMode(DAP,hard); AudioEngine.play(track) @dapVolume | M=DAP,D=Active |
| D=Armed | ACTIVATE_DAP_FROM_CURRENT | APL==dapPlaylistId && P=track | migrateMode(DAP,seamless); volumeRamp(normal→dap) | M=DAP,D=Active |

### 3.3 Suspend/resume
| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| M=DAP,D=Active | Любой запуск не-DAP режима | — | D=Suspended; затем выполнить команду | D=Suspended, M≠DAP |
| D=Suspended | Завершение активного не-DAP (track ended/stop) | — | resume DAP (play/resume) @dapVolume | M=DAP,D=Active |

### 3.4 Выключение
| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| D=Suspended | TOGGLE_DAP(false) | — | D=Off | D=Off |
| M=DAP,D=Active | TOGGLE_DAP(false) | — | D=Off; seamless exit to normal mode; volumeRamp(dap→normal) | D=Off, M=Simple/AutoPlay/DSP |
| D=Armed | TOGGLE_DAP(false) | — | D=Off | D=Off |

---

## 4) Внутренние события AudioEngine

### 4.1 DSP fragment ended: всегда B следующим
| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| M=DSP,P=transition,Seg=dsp_fragment(A→B) | SEGMENT_ENDED(fragment) | B известен | AudioEngine.play(track B); P=track; (SS/PS не применяются здесь) | M=DSP,P=track |

### 4.2 Track ended: выбор next
Приоритет при выборе next на `SEGMENT_ENDED(track T)`:
1) Если SS.afterTrackId == T → выполнить switch (см. 5)
2) Иначе — стандартная логика режима (AutoPlay/DSP)
3) Для Simple: если D=Suspended → resume DAP, иначе idle

---

## 5) ScheduledSwitch (Play Next стратегия B)

| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| SS={to:Y, after:T} | SEGMENT_ENDED(trackId=T) | — | SS=None; APL=Y; migrateMode(AutoPlay,seamless=true); play first track of Y | M=AutoPlay,APL=Y,P=track |

`playlist.uiState="quick_build_armed"` не влияет на playback и снимается только UI Commit’ом.

---

## 6) Play Next v3

### 6.1 Guard + вычисление anchor
Guard:
- M ∈ {AutoPlay, DSP}
- APL != null
- P ∈ {track, transition}
- если P=transition → transitionContext.to=B известен

Anchor:
- если P=track → anchor=currentTrackId
- если P=transition(A→B) → anchor=B (строго)

### 6.2 Стратегия A: COPY_INTO_ACTIVE
| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| M∈{AutoPlay,DSP},P=track,APL=X | PLAY_NEXT_REQUEST(A) | — | anchor=current; отменить SS; создать/обновить PS; copyTrackIntoPlaylist(..., X, insertAtIndex); PS.insertedCount++ | без смены |
| M∈{AutoPlay,DSP},P=transition(A→B),APL=X | PLAY_NEXT_REQUEST(A) | B известен | anchor=B; отменить SS; создать/обновить PS; copyTrackIntoPlaylist(..., X, index(B)+1±FIFO); PS.insertedCount++ | без смены |

Вставка:
- baseInsertIndex=index(anchor)+1
- LIFO: insertAtIndex=baseInsertIndex
- FIFO: insertAtIndex=baseInsertIndex + insertedCount (до ++)

### 6.3 Стратегия B: CREATE_NEW_PLAYNEXT_PLAYLIST
| Текущее | Событие | Guard | Действия | Следующее |
|---|---|---|---|---|
| M∈{AutoPlay,DSP},P=track,APL=X | PLAY_NEXT_REQUEST(B) | — | anchor=current; createPlaylist(Y); add first track; Y.uiState=quick_build_armed; PS=None; SS={to:Y,after:anchor} | SS set |
| M∈{AutoPlay,DSP},P=transition(A→B),APL=X | PLAY_NEXT_REQUEST(B) | B известен | anchor=B; createPlaylist(Y); add first track; uiState; PS=None; SS={to:Y,after:B} | SS set |

---

## 7) PlaylistEditor Commit (UI-only)
| Playlist | Событие | Действия | Итог |
|---|---|---|---|
| uiState=quick_build_armed | COMMIT_PLAYLIST_EDIT | uiState=null | обычный плейлист |
