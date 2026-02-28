# M2A Audio Player — Тест-план (Given/When/Then)

Дата: 2026-02-28  
Цель: закрепить спецификацию unit/integration тестами (в первую очередь для PlaybackController/RolePolicy/PlaylistEditor integration).

---

## Статус покрытия A–I (на текущем инкременте)

- [x] **A) Роли и права** — покрыто, включая A1/A3:
  - `test/playback-role-policy.test.js` (host/co-host/slave rules)
  - `test/playback-command-bus.test.js` (routing allow/deny)
- [x] **B) Тумблеры и режимы** — покрыты B1–B4:
  - `test/playback-controller.test.js` (seamless переключения и неактивный плейлист)
- [x] **C) DSP fragment A→B** — покрыты C1/C2:
  - `test/playback-controller.test.js` (`dsp fragment completion...`, `play-next during fragment...`)
- [x] **D) Play Next v3 стратегия A** — покрыты D1–D5:
  - `test/playback-controller.test.js` (`play-next strategy A ...`, `...cancels scheduled switch...`)
- [x] **E) Play Next v3 стратегия B** — покрыты E1–E4:
  - `test/playback-controller.test.js` (`...anchors switch...`, `scheduled switch executes...`)
- [x] **F) DAP** — покрыты F1–F7:
  - `test/playback-controller.test.js` (arm/start/promote/suspend/resume/exit)
- [x] **G) Overlap/Fade инварианты** — покрыты, включая G3 (fade только тишина↔Track):
  - `test/audio-engine.test.js`
- [x] **H) STOP как полная остановка** — покрыт reset + вызов `AudioEngine.stopAll`:
  - `test/playback-controller.test.js` (`stop performs full stop...`, `stop delegates...`)
- [x] **I) PlaylistEditor регрессия** — покрыты copy/move и quick build commit:
  - `test/playlist-editor.test.js`

---

## Что осталось закрыть

- [x] По текущему инкременту незакрытых кейсов в блоке A–I нет.

---

## A) Роли и права (RolePolicy + CommandBus)

### A1. Co-Host может только play/stop host
**Given** actorRole=cohost  
**When** dispatch PLAY_TRACK(target=host)  
**Then** команда доставляется на Host (RemoteSync), и Host начинает воспроизведение.

**Given** actorRole=cohost  
**When** dispatch STOP(target=host)  
**Then** Host останавливает воспроизведение.

**Given** actorRole=cohost  
**When** dispatch TOGGLE_AUTOPLAY / TOGGLE_DSP / TOGGLE_DAP / PLAY_NEXT_REQUEST  
**Then** CommandBus returns REJECTED(ACCESS_DENIED), ничего не уходит на Host.

### A2. Slave не может play/stop host, но может Play Next host
**Given** actorRole=slave  
**When** dispatch PLAY_TRACK(target=host) или STOP(target=host)  
**Then** REJECTED(ACCESS_DENIED).

**Given** actorRole=slave, Host находится в AutoPlay  
**When** dispatch PLAY_NEXT_REQUEST(target=host)  
**Then** команда доставляется на Host, и применяется по правилам Play Next v3.

### A3. Slave локально играет только Simple
**Given** actorRole=slave  
**When** dispatch PLAY_TRACK(target=self, playlist autoplayEnabled=true)  
**Then** REJECTED(NOT_SUPPORTED_IN_LOCAL_CONTEXT) или forced Simple (нормативно: запрещено, чтобы не расползалось поведение).

---

## B) Тумблеры и бесшовные переходы

### B1. Simple → AutoPlay seamless при включении autoplay на активном плейлисте
**Given** Host: M=Simple, играет track T в playlist P  
**When** TOGGLE_AUTOPLAY(P,true)  
**Then** M становится AutoPlay, трек T не прерывается (same playhead).

### B2. AutoPlay → Simple seamless при выключении autoplay на активном плейлисте
**Given** Host: M=AutoPlay, играет track T в P  
**When** TOGGLE_AUTOPLAY(P,false)  
**Then** M=Simple, T продолжается; по окончании T → idle (если DAP не suspended).

### B3. DSP → AutoPlay seamless при выключении DSP
**Given** Host: M=DSP, играет track T в P  
**When** TOGGLE_DSP(P,false)  
**Then** M=AutoPlay, T продолжается; далее переходы без DSP fragments.

### B4. Изменение тумблеров неактивного плейлиста не влияет на текущий режим
**Given** Host: M=AutoPlay, APL=P1  
**When** TOGGLE_AUTOPLAY(P2,false)  
**Then** M и воспроизведение не меняются; меняется только playlist settings P2.

---

## C) DSP fragments: обязательный B после fragment

### C1. После DSP fragment A→B всегда играет B
**Given** Host: M=DSP, P=transition, Seg=dsp_fragment(A→B)  
**When** SEGMENT_ENDED(fragment)  
**Then** следующий сегмент — Track B (без попыток переключить на другое).

### C2. Play Next во время fragment не перехватывает immediate next
**Given** Host: M=DSP, P=transition (A→B), SS=None, PS=None  
**When** приходит PLAY_NEXT_REQUEST (A или B)  
**Then** fragment доигрывает → играет B; эффекты Play Next применяются после B.

---

## D) Play Next v3 — стратегия A (COPY_INTO_ACTIVE)

### D1. Стратегия A вставляет трек реально в активный плейлист после текущего (track-phase)
**Given** Host: M=AutoPlay, P=track, текущий трек = T0, playlist=P имеет треки [T0,T1,T2]  
**When** PLAY_NEXT_REQUEST(strategy=A, fifoSession=OFF) с выбранным треком X  
**Then** X появляется в P сразу после T0: [T0,X,T1,T2].

### D2. Стратегия A во время transition вставляет после B
**Given** Host: M=DSP, P=transition(A→B), playlist=P содержит ...B,C...  
**When** PLAY_NEXT_REQUEST(strategy=A) с треком X  
**Then** в P X вставлен сразу после B (не после A).

### D3. LIFO (default): последний добавленный всегда становится самым следующим
**Given** Host: M=AutoPlay, current=T0, P=[T0,T1,T2]  
**When** PlayNext A добавили X, затем Y (fifoSession=OFF)  
**Then** порядок после T0: [T0,Y,X,T1,T2].

### D4. FIFO session: порядок добавлений сохраняется
**Given** Host: M=AutoPlay, current=T0, P=[T0,T1,T2]  
**When** PlayNext A с fifoSession=ON добавили X, затем Y  
**Then** [T0,X,Y,T1,T2].

### D5. Если ранее был ScheduledSwitch (стратегия B), стратегия A отменяет switch
**Given** SS={to:Y,after:T0}  
**When** PLAY_NEXT_REQUEST(strategy=A)  
**Then** SS=None, вставка выполняется в текущий плейлист.

---

## E) Play Next v3 — стратегия B (CREATE_NEW_PLAYNEXT_PLAYLIST)

### E1. Создание плейлиста + schedule switch (track-phase)
**Given** Host: M=AutoPlay, current=T0  
**When** PLAY_NEXT_REQUEST(strategy=B) с треком X  
**Then** создан новый playlist Y, Y.tracks[0]=X, Y.uiState=quick_build_armed, SS={to:Y,after:T0}.

### E2. Schedule switch во время transition — after=B
**Given** Host: M=DSP, P=transition(A→B)  
**When** PLAY_NEXT_REQUEST(strategy=B) с треком X  
**Then** SS.afterTrackId == B.

### E3. Исполнение switch после afterTrackId
**Given** SS={to:Y, after:T0}, Host заканчивает T0  
**When** SEGMENT_ENDED(T0)  
**Then** APL=Y, M=AutoPlay, начинается воспроизведение первого трека Y.

### E4. uiState не снимается автоматически переключением
**Given** Y.uiState=quick_build_armed, switch уже произошёл  
**Then** uiState остаётся до UI commit.

---

## F) DAP

### F1. Arm DAP не запускает воспроизведение
**Given** D=Off, dapPlaylistId=Pdap  
**When** TOGGLE_DAP(true)  
**Then** D=Armed, но ничего не играет автоматически.

### F2. DAP classic start
**Given** D=Armed  
**When** PLAY_TRACK(dapPlaylistId, anyTrack)  
**Then** M=DAP, D=Active, volume=dapVolume.

### F3. Seamless promote в DAP
**Given** D=Armed, APL==dapPlaylistId, играет track T (P=track)  
**When** ACTIVATE_DAP_FROM_CURRENT  
**Then** M=DAP, T продолжается, volume плавно к dapVolume.

### F4. Suspend DAP при старте другого режима
**Given** M=DAP,D=Active  
**When** PLAY_TRACK(non-dap playlist)  
**Then** D=Suspended, активный режим становится новым.

### F5. Resume DAP после окончания Simple
**Given** D=Suspended, M=Simple, играет track T  
**When** SEGMENT_ENDED(T)  
**Then** DAP возобновляется автоматически (M=DAP,D=Active).

### F6. TOGGLE_DAP(false) в suspended убивает DAP и не трогает текущий режим
**Given** D=Suspended, M=AutoPlay  
**When** TOGGLE_DAP(false)  
**Then** D=Off, M=AutoPlay без изменений.

### F7. TOGGLE_DAP(false) в active делает seamless exit без остановки трека
**Given** M=DAP,D=Active, играет track T  
**When** TOGGLE_DAP(false)  
**Then** T продолжается, volume ramp dap→normal, M становится Simple/AutoPlay/DSP по настройкам плейлиста.

---

## G) Overlap/Fade политики

### G1. Overlap применяется только Track→Track
**Given** overlapEnabled=true, track A заканчивается, next=track B  
**When** планируем переход  
**Then** AudioEngine запускает B за overlapSeconds до конца A; в окне overlap — два источника.

### G2. Overlap не применяется к dsp_fragment
**Given** next сегмент = dsp_fragment(A→B)  
**Then** overlap не используется; fragment стартует без наложения “как трек”.

### G3. Fade применяется только тишина↔Track
**Given** P=idle  
**When** play track  
**Then** fade-in используется если включён.

**Given** Simple заканчивает последний трек и уходит в idle  
**Then** fade-out используется если включён.

---

## H) STOP как “полная остановка”

### H1. STOP очищает PS/SS и выключает DAP
**Given** PS != None, SS != None, D != Off  
**When** STOP(target=host)  
**Then** AudioEngine.stopAll, PS=None, SS=None, D=Off, P=idle.

---

## I) PlaylistEditor перенос функциональности (регрессия)

### I1. Копирование трека между плейлистами сохраняется
**Given** существуют операции copy/move в старой версии  
**When** выполняем их через PlaylistEditor/PlaylistRepository  
**Then** результат идентичен старой версии (структура треков и порядок).

### I2. Quick build UI commit
**Given** playlist.uiState=quick_build_armed  
**When** пользователь нажимает Commit  
**Then** uiState снимается, плейлист визуально обычный, контент сохранён.
