# Фаза 2 — Реальная миграция кода из server.js

## Цель
Перенести **сам код** (не обёртки) из server.js в модули.
После фазы 2 server.js должен стать ~200–400 строк: imports, wiring, startup.

## Текущее состояние server.js (5275 строк)

| Блок | Строки | ~Размер | Что внутри |
|------|--------|---------|------------|
| Imports + config thin wrappers | 1–50 | ~50 | require(), делегаты ConfigManager |
| Config constants | 50–500 | ~450 | 52 const: PORT, DSP_*, LIVE_*, limits |
| State variables | 420–525 | ~100 | authSessions, dspTransitions, dspQueue, caches |
| Update helpers | 525–600 | ~75 | persistUpdateState, loadPersistedUpdateState |
| Layout state management | 600–1200 | ~600 | sanitize, normalize, persist, broadcast, SSE |
| Auth/session management | 1200–1700 | ~500 | sessions CRUD, cookies, getAuthState, roles |
| GitHub API + update flow | 1700–2040 | ~340 | fetchLatestRelease, compareVersions, download |
| DSP pipeline | 2040–4100 | ~2060 | 40+ функций: queue, tempo, trim, energy, ffmpeg |
| DSP handlers (already facade) | 4100–4240 | ~140 | handleApiDspTransitions* → dspJobManager.* |
| Audio metadata (ID3 parsing) | 4240–4500 | ~260 | parseId3v2/v1, readFileSlice, extractAttributes |
| Audio catalog helpers | 4500–4640 | ~140 | normalizePath, collectAudioCatalog, isAudioFile |
| Audio/catalog handlers | 4640–4720 | ~80 | handleApiAudio, handleApiAudioAttributes |
| Config/version handlers | 4720–4750 | ~30 | handleApiConfig, handleApiVersion |
| Layout handlers | 4750–4910 | ~160 | handleApiLayoutGet/Reset/Update/Stream |
| Auth handlers | 4910–5080 | ~170 | handleAuth*, handleClientsRole/Disconnect |
| Playback handlers (already facade) | 5080–5110 | ~30 | → playbackGateway.* |
| Update handlers (already facade) | 5110–5125 | ~15 | → updateService.* |
| Misc handlers | 5125–5170 | ~45 | handleShutdown, handleAudioFile, handlePublic |
| Router wiring + startup | 5170–5275 | ~105 | router.register(), http.createServer, listen |

---

## PR6 — DSP Pipeline extraction (~2060 строк → src/dsp/)

**Самый большой выигрыш.** Переносим 40+ DSP-функций из server.js в модули.

### Новые файлы
```
src/dsp/
  DspJobManager.js     — обновлённый: владеет кодом, а не делегирует
  pipeline.js          — enqueueDspTransition, processDspTransition, processDspQueue,
                         scheduleDspWorker, queueDspTransition, trimDspHistory,
                         markDspTransitionReady/Failed
  descriptor.js        — buildDspTransitionId, buildDspTransitionDescriptor,
                         normalizeDspTransition*, normalizeDspSlice*,
                         normalizeDspTransitionInputFile
  tempo.js             — detectTrackTempoBpm, probeTrackTempoBpmFromMetadata,
                         decodeTrackPcmForTempoAnalysis, estimateTempoBpmFromPcmBuffer,
                         buildTempoAlignedTargetFilter, loadDspTempoCache, persistDspTempoCache
  trim.js              — computeDspTrimSeconds, detectSegmentSilenceSeconds,
                         detectLeadingSilence*, detectTrailingSilence*,
                         computeDspEnergyTrimSeconds, estimateEnergyBoundaryTrimFromPcm,
                         decodeSegmentPcmForBoundaryAnalysis
  log.js               — appendDspLog, initializeDspLogFile, safeSerializeDspLogPayload
  encoding.js          — buildDspOutputEncodingArgs, resolveDspTransitionOutputPathById,
                         buildDspTransitionOutputUrl, ensureFfmpegAvailable
  summary.js           — buildDspQueueSummary, serializeDspTransition,
                         getDspTransitionByPair, collectAdjacentLayoutTransitions,
                         scheduleDspTransitionsFromLayout
```

### Изменения в server.js
- Удалить ~2060 строк DSP-кода (lines 2040–4100)
- Удалить DSP state vars (dspTransitions, dspQueue, dspTempoCache, etc.)
- DspJobManager создаётся с config-объектом, сам владеет state
- Handler'ы (handleApiDspTransitions*) переезжают внутрь DspJobManager или
  остаются thin-wrapper'ами на 5–10 строк

### Acceptance
- Все существующие тесты проходят
- DSP endpoint'ы работают идентично
- server.js уменьшается на ~2000 строк

---

## PR7 — LayoutStateService (~600 строк → src/layout/)

### Новые файлы
```
src/layout/
  LayoutStateService.js  — владеет sharedLayoutState, persistLayoutState,
                           loadPersistedLayoutState, broadcastLayoutUpdate,
                           buildLayoutPayload, keepLayoutStreamAlive
  sanitize.js            — sanitizeLayout, normalizePlaylistNames,
                           normalizePlaylistAutoplayFlags, normalizePlaylistDspFlags,
                           normalizePlaylistAutoplayWithDap, normalizePlaylistMeta,
                           sanitizeDapConfig
  detection.js           — isDeletingLivePlaybackPlaylist, detectRemovedPlaylistIndex
```

### Изменения в server.js
- Удалить lines ~512–1200 (state, sanitize, persist, broadcast, SSE)
- Удалить `sharedLayoutState`, `layoutSubscribers`
- `handleApiLayoutUpdate` делегирует `layoutService.applyPatch(body, auth)`
- `handleApiLayoutStream` делегирует `layoutService.subscribe(req, res)`
- `handleApiLayoutGet` → `layoutService.getSnapshot()`
- `handleApiLayoutReset` → `layoutService.reset()`

### Acceptance
- Layout broadcast/SSE работает
- server.js уменьшается на ~600 строк

---

## PR8 — AuthSessionManager (~500 строк → src/auth/)

### Новые файлы
```
src/auth/
  AuthService.js          — обновлённый: полноценный сервис
  SessionManager.js       — authSessions Map, createSession, destroySession,
                            getSessionByToken, cleanupExpiredSessions,
                            loadPersistedSessions, persistSessions
  cookies.js              — parseCookies, setSessionCookie, clearSessionCookie
  roles.js                — sanitizeSessionRole, resolveDefaultRoleForUsername,
                            setRoleForActiveUserSessions, disconnectActiveUserSessions,
                            collectActiveAuthUsers, buildAuthUsersPayload
```

### Изменения в server.js
- Удалить lines ~1200–1700 (auth/session management)
- Handler'ы (`handleAuthLogin`, `handleAuthLogout`, etc.) переезжают или
  становятся thin-wrapper'ами
- `getAuthState` → `authService.getAuthState(req)`
- `broadcastAuthUsersUpdate` → `authService.broadcastUpdate()`

### Acceptance
- Auth flow (login/logout/roles/SSE) работает
- server.js уменьшается на ~500 строк

---

## PR9 — Config constants materialization (~450 строк)

### Изменения
- ConfigManager получает метод `loadAll()` возвращающий все 52 константы
- server.js: `const cfg = configManager.loadAll()` + деструктуризация
- Все `DSP_*`, `LIVE_*`, `SESSION_*`, `*_BODY_LIMIT_BYTES` вычисляются внутри ConfigManager
- Удаляются ~450 строк const-инициализации

### Acceptance
- Все значения идентичны
- server.js уменьшается на ~400 строк

---

## PR10 — Static file serving + audio metadata (~400 строк → src/static/)

### Новые файлы
```
src/static/
  StaticFilesService.js  — serveFile, serveAudioWithRange, handleAudioFile,
                           handlePublic, getContentType
src/audio/
  metadata.js            — extractAudioAttributes, parseId3v2/v1Attributes,
                           readFileSlice, decodeUtf16Be, decodeId3TextFrame
```

### Изменения в server.js
- Удалить lines ~4240–4500 (ID3 parsing), lines ~5124–5170 (static handlers)
- AudioCatalogService получает metadata-функции напрямую
- Router wiring: `handleAudioFile` → `staticService.serveAudio()`

### Acceptance
- Аудио стриминг с range работает
- Metadata extraction идентична
- server.js уменьшается на ~400 строк

---

## PR11 — GitHub API + Update flow (~340 строк → src/update/)

### Изменения
- Перенести `fetchLatestRelease`, `fetchLatestPrerelease`, `parseReleaseVersion`,
  `compareVersions`, `downloadFile`, `extractTarball`, `findExtractedRoot`,
  `copyReleaseContents`, `computeRateLimitDelay` в `src/update/`
- UpdateService становится полноценным: владеет кодом, а не делегирует
- Удалить `updateCheckCache`, `githubCache`, `persistUpdateState`

### Acceptance
- Update check/apply работает
- server.js уменьшается на ~340 строк

---

## Ожидаемый результат фазы 2

| Метрика | До | После |
|---------|-----|-------|
| server.js | 5275 строк | ~250–400 строк |
| src/ | 1086 строк (обёртки) | ~5500 строк (реальный код) |
| Функций в server.js | 199 | ~10–15 (wiring + thin handlers) |

server.js после фазы 2:
```
// imports (~30 строк)
// configManager.loadAll() + destructuring (~10 строк)
// service instantiation + wiring (~40 строк)
// thin handlers that just call services (~80 строк)
// router.register() для всех маршрутов (~50 строк)
// http.createServer + startup (~30 строк)
```
