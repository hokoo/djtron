# Server Refactoring — Implementation-ready Spec (Node.js)

Дата: 2026-02-28  
Основание: «Server Refactoring Analysis (дополнение к M2A)»

Цель документа — превратить аналитическую записку в **рабочую спецификацию**, по которой AI‑агент/разработчик сможет выполнять рефакторинг небольшими PR без “big bang”, сохраняя поведение и API.

---

## 0) TL;DR

- Разбить `server.js` на слои: **bootstrap → router → middleware(auth) → domain services → adapters**.  
- Вынести отдельные компоненты: `HttpRouter`, `AuthService`, `PlaybackGateway`, `DspJobManager`, `AudioCatalogService`, `UpdateService`, `ConfigManager`.  
- Сохранить текущие endpoint’ы и формат ответов (backward compatible).
- Вести миграцию по этапам с чёткими acceptance criteria и тестами.

---

## 1) Контекст и проблема (as-is)

### 1.1 Текущее положение
В `server.js` смешаны: HTTP транспорт, авторизация, состояние, DSP‑очередь/кэши, update‑flow, выдача файлов. Это вызывает сильную связность и снижает тестируемость.

### 1.2 Симптомы (что нужно устранить)
- длинная логика в `http.createServer(...)` и множество `handle*` функций;
- прямые мутации shared-state;
- DSP pipeline живёт рядом с роутингом;
- auth/role-control смешаны с API обработкой;
- каталог аудио/метаданные не оформлены как сервис.

---

## 2) Цели и не-цели

### 2.1 Цели
1) Сделать код **компонентным**, чтобы каждый блок тестировался отдельно.  
2) Снизить связность: transport не знает деталей домена (например playback FSM).  
3) Сохранить существующие API/поведение (по возможности 1:1).  
4) Ввести “thin server.js”: только wiring зависимостей и запуск.  
5) Подготовить инфраструктуру для дальнейших изменений (ролей, режимов, DSP).

### 2.2 Не-цели
- Не переписываем playback-домен целиком (он уже в `lib/playback`).
- Не меняем публичные API пути/форматы без deprecation-плана.
- Не делаем миграцию на другой HTTP фреймворк (Express/Fastify) **в рамках этого этапа**, если это увеличивает риск.

---

## 3) Принципы дизайна

1) **Single Responsibility**: один компонент — одна зона ответственности.  
2) **Explicit contracts**: каждый сервис имеет интерфейс и понятные вход/выход.  
3) **No shared mutable state**: состояние хранится в сервисах и меняется через методы.  
4) **Backward compatibility**: API-слой обеспечивает прежние контрактные ответы.  
5) **Incremental PRs**: рефакторинг делается этапами, каждый этап — рабочий.

---

## 4) Target архитектура (to-be)

### 4.1 Предлагаемая структура файлов (минимально)
```
src/
  server.js                  # bootstrap (создание зависимостей, запуск)
  config/
    ConfigManager.js
  http/
    HttpRouter.js
    errors.js                # единый формат ошибок
    body.js                  # body parsing / limits
    middlewares/
      auth.js                # auth guard: none|session|host
  auth/
    AuthService.js
  layout/
    LayoutStateService.js
  playback/
    PlaybackGateway.js
  dsp/
    DspJobManager.js
  catalog/
    AudioCatalogService.js
  update/
    UpdateService.js
  static/
    StaticFilesService.js    # если есть выдача статики/аудио
test/
  unit/
  integration/
```

> Если проект не использует `src/`, адаптировать под текущие пути. Важно отделить *bootstrap* от *доменов*.

### 4.2 Единый формат ответа/ошибки (контракт)
**Успех:**
```json
{ "ok": true, "data": { ... } }
```
**Ошибка:**
```json
{ "ok": false, "error": { "code": "ACCESS_DENIED", "message": "..." } }
```

Коды ошибок (минимум):
- `ACCESS_DENIED`
- `UNAUTHORIZED`
- `BAD_REQUEST`
- `NOT_FOUND`
- `INTERNAL_ERROR`
- `DSP_NOT_READY` (пример)

---

## 5) Компоненты: интерфейсы, ответственность, DoD

Ниже интерфейсы, которые должны быть реализованы. (Это формализует предложенные в анализе компоненты.)

### 5.1 ConfigManager
**Ответственность:** загрузка `.env`/`extra.conf`, нормализация, валидация.

```js
class ConfigManager {
  load() {}
  get(key, fallback) {}
  getAll() {}
  validate() {} // { valid, errors }
}
```

**Acceptance / DoD**
- `server.js` больше не читает `.env` напрямую.
- При старте валидируются обязательные настройки, иначе server не стартует.
- Есть unit-тест на `validate()` для отсутствующих ключей.

---

### 5.2 HttpRouter
**Ответственность:** декларативные маршруты, dispatch, единые body limit и ошибки.

```js
class HttpRouter {
  register(method, path, handler, options = {}) {}
  dispatch(req, res) {}
}
// options: { auth: "none"|"session"|"host", bodyLimitBytes?: number }
```

**Acceptance / DoD**
- В `server.js` нет большого if/else/цепочек роутинга.
- Каждый endpoint зарегистрирован одной строкой `router.register(...)`.
- Есть интеграционный тест “route dispatch + auth guard + body limit”.

---

### 5.3 AuthService
**Ответственность:** login/logout, session token, role-check.

```js
class AuthService {
  login(credentials) {}            // { token, user }
  logout(token) {}
  getAuthState(req) {}             // { isServer, role, username, token }
  disconnectUserSessions(username) {}
  can(role, action, target) {}     // { allowed, reason?, message? }
}
```

**Acceptance / DoD**
- В HTTP handlers нет “ручных” проверок роли — только `auth middleware + authService.can(...)`.
- Есть unit-тесты для `can()` на роли и действия.
- Нет дублирования логики “кто может что”.

---

### 5.4 LayoutStateService
**Ответственность:** layout state + patch + broadcast.

```js
class LayoutStateService {
  getState() {}
  applyPatch(patch, actor) {}      // { changed, state }
  subscribe(client) {}
  unsubscribe(client) {}
}
```

**Acceptance / DoD**
- Любое изменение layout идёт через `applyPatch` (валидация обязательна).
- Broadcast отделён от HTTP обработчика (handler только вызывает `applyPatch`).

---

### 5.5 PlaybackGateway
**Ответственность:** транспортный фасад для playback: HTTP/WebSocket → playback command bus.

```js
class PlaybackGateway {
  dispatchCommand(command, context) {}   // { ok, reason?, message? }
  getSnapshot() {}
  onStateChanged(listener) {}
}
```

**Acceptance / DoD**
- HTTP handlers не импортируют `PlaybackController` напрямую.
- Вся интеграция с playback проходит через gateway.
- Есть контрактный тест: “dispatchCommand возвращает ok/failed + reason”.
- Snapshot используется для `/api/playback/state` (если есть).

---

### 5.6 DspJobManager
**Ответственность:** очередь DSP задач, статусы, кэш, выдача результатов.

```js
class DspJobManager {
  enqueue(descriptor) {}                 // { jobId, status }
  getStatus(jobId) {}
  getTransition(jobId) {}
  cancel(jobId) {}
}
```

Статусы: `queued`, `processing`, `ready`, `failed`.

**Acceptance / DoD**
- DSP очередь/кэши больше не живут рядом с HTTP роутингом.
- Есть unit тесты:
  - enqueue → queued
  - processing→ready / processing→failed
  - getTransition только в ready
- Есть интеграционный тест endpoint’ов DSP.

---

### 5.7 AudioCatalogService
**Ответственность:** сканирование каталога аудио и метаданные.

```js
class AudioCatalogService {
  collectCatalog() {}                    // full refresh
  getCatalog() {}
  getTrackMeta(trackPath) {}
}
```

**Acceptance / DoD**
- Сканирование каталога и метаданные доступны через сервис.
- Любые API, которые раньше читали каталог напрямую, теперь вызывают этот сервис.
- Есть unit/integ тест на “collectCatalog → getCatalog”.

---

### 5.8 UpdateService
**Ответственность:** check/apply updates как bounded context.

```js
class UpdateService {
  check({ allowPrerelease }) {}
  apply({ allowPrerelease }) {}
  isInProgress() {}
}
```

**Acceptance / DoD**
- В server.js нет логики обновлений, только вызовы UpdateService.
- Есть защита от параллельного apply (`isInProgress`).

---

## 6) API surface: полная карта endpoint’ов (as-is → to-be service)

Источник: фактические роуты в `server.js` (ветка `http.createServer(...)` + соответствующие `handle*` функции).

Обозначения auth:
- `none` — без предварительной авторизации;
- `session` — проходит через `requireAuthorizedRequest`;
- `host` — только host (`requireHostRequest` или `auth.isServer`);
- `host|cohost` — доступ host и co-host;
- `session (host-restricted fields)` — endpoint доступен для любой валидной сессии, но часть полей может менять только host (проверка на уровне service-layer).

| Endpoint | Method | Auth (as-is) | Текущий handler | Handler → Service (target) | Notes |
|---|---|---|---|---|---|
| `/api/auth/session` | GET | none | `handleAuthSession` | `AuthService.getAuthState` | Проверка текущей сессии/роли |
| `/api/auth/login` | POST | none | `handleAuthLogin` | `AuthService.login` | Логин + выдача session cookie |
| `/api/auth/logout` | POST | none | `handleAuthLogout` | `AuthService.logout` | Логаут по cookie token |
| `/api/auth/clients` | GET | host | `handleAuthClientsGet` | `AuthService.getClients` | Список активных сессий |
| `/api/auth/clients/role` | POST | host | `handleAuthClientsRoleUpdate` | `AuthService.setClientRole` | Переключение роли active-сессий |
| `/api/auth/clients/disconnect` | POST | host | `handleAuthClientsDisconnect` | `AuthService.disconnectUserSessions` | Принудительный disconnect |
| `/api/layout/stream` | GET | session | `handleApiLayoutStream` | `LayoutStateService.subscribe` | SSE stream (`layout`/`playback`/`auth-users`) |
| `/api/layout/reset` | POST | host | `handleApiLayoutReset` | `LayoutStateService.reset` | Сброс layout + broadcast + DSP schedule |
| `/api/layout` | GET | session | `handleApiLayoutGet` | `LayoutStateService.getState` | Snapshot layout state |
| `/api/layout` | POST | session + host-only fields | `handleApiLayoutUpdate` | `LayoutStateService.applyPatch` | Обновление layout; DAP/autoplay/DSP флаги полноценно меняет host |
| `/api/playback` | GET | session | `handleApiPlaybackGet` | `PlaybackGateway.getSnapshot` | Snapshot playback state |
| `/api/playback` | POST | host | `handleApiPlaybackUpdate` | `PlaybackGateway.updateState` | Прямое обновление playback state (host-only) |
| `/api/playback/command` | POST | host\|cohost | `handleApiPlaybackCommand` | `PlaybackGateway.dispatchCommand` | Команды через `livePlaybackCommandBus` |
| `/api/shutdown` | POST | host | `handleShutdown` | `ServerControlService.shutdown` | Служебный endpoint остановки процесса |
| `/api/audio` | GET | session | `handleApiAudio` | `AudioCatalogService.getCatalog` | Каталог аудиофайлов |
| `/api/audio/attributes` | GET | session | `handleApiAudioAttributes` | `AudioCatalogService.getTrackMeta` | Метаданные/название трека |
| `/api/dsp/transitions` | GET | session | `handleApiDspTransitionsGet` | `DspJobManager.getStatus/list` | Список/поиск transitions + queue summary |
| `/api/dsp/transitions` | POST | host | `handleApiDspTransitionsPost` | `DspJobManager.enqueue` | enqueue DSP transitions |
| `/api/dsp/transitions/file/:id` | GET, HEAD | session | `handleApiDspTransitionFile` | `DspJobManager.getTransition` + `StaticFilesService.stream` | Выдача подготовленного transition файла |
| `/api/config` | GET | session | `handleApiConfig` | `ConfigManager.getAll` | Runtime config/schema для UI |
| `/api/version` | GET | session | `handleApiVersion` | `ConfigManager.get('version')` | Текущая версия приложения |
| `/api/update/check` | GET | session | `handleUpdateCheck` | `UpdateService.check` | Проверка обновлений (as-is). Риск: endpoint доступен любой авторизованной сессии, hardening до `host` вынести в отдельный security PR/task. |
| `/api/update/apply` | POST | session | `handleUpdateApply` | `UpdateService.apply` | Применение обновления (as-is); блокировка parallel apply. Риск: privileged операция доступна любой сессии. Обязательный follow-up security task: либо `auth:host`, либо временные меры (rate limit + audit log вызовов update). |
| `/audio/:filePath*` | GET, HEAD | session | `handleAudioFile` | `StaticFilesService.serveAudio` | Стрим треков с range support |
| `/*` (public files) | GET, HEAD | none | `handlePublic` | `StaticFilesService.servePublic` | `index.html`/статика из `public/` |

> Примечание: `ServerControlService` формально не описан в разделе 5 (описания сервисов), но endpoint `/api/shutdown` уже существует. Для PR1 маршрут сохраняется как есть, а в PR2+ можно либо добавить явный подпункт `5.9 ServerControlService`, либо встроить shutdown-функциональность в существующий bounded context.

---

## 7) Порядок миграции (этапы PR)

План “без большого взрыва”:

### PR1 — HttpRouter + AuthService
- Ввести `HttpRouter` и зарегистрировать **все существующие** маршруты.
- Вынести проверку сессий/ролей в `AuthService` и auth middleware.

**PR1 checklist (implementation-ready, route-by-route)**

- [ ] Добавить `HttpRouter.register(method, path, handler, { auth, bodyLimitBytes })` и `dispatch(req, res)` без изменения payload-контрактов.
- [ ] Добавить auth middleware (`none|session|host|cohost`) поверх `AuthService.getAuthState()` и убрать inline-проверки в router-ветке `server.js`.
- [ ] Зарегистрировать auth endpoints:
  - [ ] `GET /api/auth/session` → `AuthService.getAuthState` (`auth:none`)
  - [ ] `POST /api/auth/login` → `AuthService.login` (`auth:none`)
  - [ ] `POST /api/auth/logout` → `AuthService.logout` (`auth:none`)
  - [ ] `GET /api/auth/clients` → `AuthService.getClients` (`auth:host`)
  - [ ] `POST /api/auth/clients/role` → `AuthService.setClientRole` (`auth:host`)
  - [ ] `POST /api/auth/clients/disconnect` → `AuthService.disconnectUserSessions` (`auth:host`)
- [ ] Зарегистрировать layout/playback endpoints:
  - [ ] `GET /api/layout/stream` (`auth:session`)
  - [ ] `POST /api/layout/reset` (`auth:host`)
  - [ ] `GET /api/layout` (`auth:session`)
  - [ ] `POST /api/layout` (`auth:session`, сохранить field-level host restrictions внутри сервиса; в follow-up PR стандартизировать правила для `dapConfig`, `playlistAutoplay`, `playlistDsp`)
  - [ ] `GET /api/playback` (`auth:session`)
  - [ ] `POST /api/playback` (`auth:host`)
  - [ ] `POST /api/playback/command` (`auth:host|cohost`)
  - [ ] `POST /api/shutdown` (`auth:host`)
- [ ] Зарегистрировать catalog/DSP/config/update endpoints:
  - [ ] `GET /api/audio` (`auth:session`)
  - [ ] `GET /api/audio/attributes` (`auth:session`)
  - [ ] `GET /api/dsp/transitions` (`auth:session`)
  - [ ] `POST /api/dsp/transitions` (`auth:host`)
  - [ ] `GET|HEAD /api/dsp/transitions/file/:id` (`auth:session`)
  - [ ] `GET /api/config` (`auth:session`)
  - [ ] `GET /api/version` (`auth:session`)
  - [ ] `GET /api/update/check` (`auth:session`, сохранить текущую политику в PR1; potential hardening до `host` вынести отдельно)
  - [ ] `POST /api/update/apply` (`auth:session`, сохранить текущую политику в PR1; potential hardening до `host` вынести отдельно)
- [ ] Зарегистрировать non-API маршруты:
  - [ ] `GET|HEAD /audio/:filePath*` (`auth:session`)
  - [ ] `GET|HEAD /*` (`auth:none`, public static)
- [ ] Добавить интеграционные тесты PR1: dispatch(method/path), auth guard, body-limit и 405/401/403 parity с текущим поведением.

**Acceptance PR1**
- Поведение endpoint’ов не изменилось (интеграционные тесты/ручные проверки).
- `server.js` стал тоньше: только создание router + register.

### PR2 — PlaybackGateway
- Вынести все места, где HTTP напрямую трогает playback, в `PlaybackGateway`.

**Acceptance PR2**
- Нет прямых импортов playback домена в handlers.
- Команды playback идут через gateway.

### PR3 — DspJobManager
- Вынести очередь/кэш DSP из HTTP слоя в `DspJobManager`.

**Acceptance PR3**
- Есть unit тесты статусов/кэша.
- DSP endpoint’ы используют только сервис.

### PR4 — AudioCatalogService + UpdateService
- Вынести каталог и updates в отдельные сервисы.

### PR5 — ConfigManager
- Стандартизировать конфиг.
- Убрать “разрозненные” чтения env/файлов.

---

## 8) Тест-стратегия (обязательная для “готов к работе”)

### 8.1 Unit tests
- AuthService: роли/действия.
- DspJobManager: статусы + выдача результатов.
- ConfigManager.validate.
- LayoutStateService.applyPatch (валидация + changed flags).

### 8.2 Integration tests
- HttpRouter dispatch (method/path/bodyLimit/auth).
- “Smoke test” набора ключевых endpoint’ов (login, layout, playback command, dsp enqueue/status).

### 8.3 Contract tests (рекомендуется)
- Формат ошибок/успеха (ok/data vs ok/error).
- Совместимость payload’ов (если уже есть клиенты).

---

## 9) Чек-лист Definition of Done для PR

Каждый PR считается готовым, если:
1) Сборка проходит (lint/test).  
2) Добавлены unit/integ тесты для новых сервисов.  
3) Не изменены внешние API контракты (или есть явный migration note).  
4) Убрана прямая зависимость transport→domain (через gateway/service).  
5) Логи/ошибки стандартизированы через `http/errors.js`.

---

## 10) Открытые вопросы (заполнить перед стартом)

1) Полный список endpoint’ов и их текущая семантика.  
2) Transport: HTTP-only или есть WebSocket/SSE?  
3) Где и как хранится session token (cookie/header)?  
4) Формат DSP descriptor/jobId и где лежат transitions (файлы/память).  
5) Нужна ли персистентность DSP кэшей между рестартами.

---

## 11) Шаблон секции “Endpoint spec” (копировать для каждого endpoint)

### Endpoint: `<METHOD> <PATH>`
- Auth: `none|session|host`
- Input: JSON schema (минимум поля/типы)
- Output (success): JSON schema
- Output (error): возможные коды
- Side effects: какие сервисы вызываются
- Notes: backward compatibility, edge cases, limits
