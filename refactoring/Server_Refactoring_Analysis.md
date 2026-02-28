# Server Refactoring Analysis (дополнение к M2A)

Дата: 2026-02-28  
Контекст: в `server.js` сосредоточена значительная часть backend-логики, которая пока не разложена по компонентам так же, как `PlaybackController` в `lib/playback`.

---

## 1) Что ещё нуждается в рефакторинге

Ниже — зоны, где ответственность смешана и где декомпозиция даст наибольший эффект.

1. **Монолитный HTTP+domain слой в `server.js`**
   - Один файл совмещает конфиг, auth/session, маршрутизацию, state, DSP-очередь, update-flow и файловую выдачу.
   - Признак: длинная цепочка роутинга внутри `http.createServer(...)` и большое количество `handle*` функций.

2. **Сильная связность состояния**
   - Layout/playback/auth/DSP-состояния управляются в одном модуле, с большим количеством прямых мутаций.
   - При росте функционала это усложняет атомарность и тестируемость.

3. **DSP-пайплайн и кэш переходов**
   - Очередь, кэши и статус переходов живут рядом с HTTP-обработчиками.
   - Это усложняет контроль жизненного цикла задач и повторное использование.

4. **Auth и role-control смешаны с API-слоем**
   - Проверка сессии/роли/доступов выполняется рядом с обработкой HTTP и бизнес-логикой.
   - Нужна явная граница между authentication/authorization и transport.

5. **Каталог аудио и metadata extraction**
   - Сканирование каталога и сбор метаданных логически отдельная подсистема.
   - Сейчас она не оформлена как сервис с независимым контрактом.

---

## 2) Предлагаемые компоненты и интерфейсы

## 2.1 ConfigManager
**Задача:** чтение `.env`/`extra.conf`, нормализация и валидация конфигурации.

```js
class ConfigManager {
  load() {}
  get(key, fallback) {}
  getAll() {}
  validate() {} // { valid, errors }
}
```

---

## 2.2 HttpRouter
**Задача:** декларативная регистрация маршрутов и единая обработка method/permission/body.

```js
class HttpRouter {
  register(method, path, handler, options = {}) {}
  dispatch(req, res) {}
}
```

`options` рекомендуется поддерживать минимум:
- `auth: "none" | "session" | "host"`
- `bodyLimitBytes?: number`

---

## 2.3 AuthService
**Задача:** управление сессиями, извлечение auth state, роль-проверки.

```js
class AuthService {
  login(credentials) {}            // { token, user }
  logout(token) {}
  getAuthState(req) {}             // { isServer, role, username, token }
  disconnectUserSessions(username) {}
  can(role, action, target) {}     // { allowed, reason?, message? }
}
```

---

## 2.4 LayoutStateService
**Задача:** хранение и обновление layout-состояния с валидацией и broadcast.

```js
class LayoutStateService {
  getState() {}
  applyPatch(patch, actor) {}      // { changed, state }
  subscribe(client) {}
  unsubscribe(client) {}
}
```

---

## 2.5 PlaybackGateway
**Задача:** связка transport-слоя с `PlaybackCommandBus`/`PlaybackController`.

```js
class PlaybackGateway {
  dispatchCommand(command, context) {}   // { ok, reason?, message? }
  getSnapshot() {}
  onStateChanged(listener) {}
}
```

Назначение — убрать прямую зависимость HTTP-обработчиков от деталей playback FSM.

---

## 2.6 DspJobManager
**Задача:** очередь DSP-задач, статусы, кэш и выдача результатов.

```js
class DspJobManager {
  enqueue(descriptor) {}                 // { jobId, status }
  getStatus(jobId) {}
  getTransition(jobId) {}
  cancel(jobId) {}
}
```

Рекомендуемые статусы:
- `queued`
- `processing`
- `ready`
- `failed`

---

## 2.7 AudioCatalogService
**Задача:** сканирование каталога и унификация метаданных треков.

```js
class AudioCatalogService {
  collectCatalog() {}                    // full refresh
  getCatalog() {}
  getTrackMeta(trackPath) {}
}
```

---

## 2.8 UpdateService
**Задача:** проверка/применение обновлений приложения как отдельный bounded context.

```js
class UpdateService {
  check({ allowPrerelease }) {}
  apply({ allowPrerelease }) {}
  isInProgress() {}
}
```

---

## 3) Минимальный порядок распила (без «большого взрыва»)

1. **Вынести `HttpRouter` + `AuthService`** (уменьшить размер `createServer`-ветвления).  
2. **Вынести `PlaybackGateway`** (оставить `PlaybackController` центром playback-домена).  
3. **Вынести `DspJobManager`** (очередь и кэши отдельно от HTTP).  
4. **Вынести `AudioCatalogService` и `UpdateService`**.  
5. **Вынести `ConfigManager`** и стандартизовать доступ к конфигу.

Такой порядок минимизирует риск регрессий и позволяет закрывать этапы независимыми PR.

---

## 4) Что это даст

- Меньше связности и проще тестирование каждого блока изолированно.
- Явные интерфейсы между transport/domain/infrastructure слоями.
- Более предсказуемая эволюция серверной части при добавлении ролей, режимов и DSP-функциональности.
- Более безопасные изменения: меньше вероятности сломать несвязанные API-эндпоинты.
