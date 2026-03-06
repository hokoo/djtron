# Фаза 1 — Facade Layer (PR1–PR5) ✅ Завершена

## Цель
Создать фасадный слой между HTTP-транспортом и доменной логикой.
Не перемещать код, а обернуть его: handler'ы делегируют вызовы фасадам,
фасады вызывают те же функции, которые по-прежнему живут в `server.js`.

## Выполненные PR

### PR1 — HttpRouter + AuthService (merged, PR #11)
- `src/http/HttpRouter.js` — route registration + dispatch (specific→wildcard)
- `src/http/body.js` — `readJsonBody` helper
- `src/http/errors.js` — `sendJson` helper
- `src/http/middlewares/auth.js` — auth guard (`none|session|host|host|cohost`)
- `src/auth/AuthService.js` — thin wrapper над `getAuthState`
- Заменена ~270-строчная if/else routing chain на `router.dispatch(req, res)`
- 44 теста

### PR2 — PlaybackGateway (PR #12)
- `src/playback/PlaybackGateway.js` — фасад для playback state get/set/command
- Переписаны 3 handler'а: `handleApiPlaybackGet`, `handleApiPlaybackUpdate`, `handleApiPlaybackCommand`
- 8 тестов

### PR3 — DspJobManager (PR #13)
- `src/dsp/DspJobManager.js` — фасад для DSP queue/cache/transition management
- Переписаны 3 handler'а + 3 вызова `scheduleDspTransitionsFromLayout`
- 18 тестов

### PR4 — AudioCatalogService + UpdateService (PR #14)
- `src/catalog/AudioCatalogService.js` — фасад для каталога аудио + метаданных
- `src/update/UpdateService.js` — фасад для проверки/применения обновлений
- Переписаны 4 handler'а
- 15 тестов

### PR5 — ConfigManager (PR #15)
- `src/config/ConfigManager.js` — централизованная загрузка/парсинг конфига
- 9 функций-делегатов в server.js → ConfigManager static/instance methods
- 27 тестов

## Итоги фазы 1
- **Добавлено:** 1086 строк в `src/`, 112 новых тестов
- **Удалено из server.js:** ~486 строк (5761 → 5275)
- **Проблема:** server.js по-прежнему 5275 строк, потому что фасады — это обёртки,
  а весь код (~199 функций) остаётся inline
