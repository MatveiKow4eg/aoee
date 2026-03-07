# AOE Estonia Map — пошаговый prompt-план улучшения проекта

## Цель
Улучшить уже существующий проект **без поломки текущей логики карты**.

Нужно:
- **оставить текущую логику карты, рендера, PixiJS, слоёв, зданий, игроков и UI как основу**;
- перевести хранение данных **с Firebase/Firestore на Vultr**;
- добавить **безопасную регистрацию и авторизацию**:
  - через **Steam**;
  - через **обычную регистрацию** (email + password);
- разделить проект на **2 главные папки**:
  - `frontend`
  - `backend`
- подготовить архитектуру под деплой через **GitHub**;
- сохранить совместимость с **Vercel + Vultr**;
- не делать realtime, websocket и игровые серверы;
- не переписывать заново карту, а **эволюционно улучшить существующий проект**.

---

## Что есть сейчас
Текущий стек:
- **Next.js 14 App Router**
- **TypeScript**
- **CSS Modules + globals.css**
- **Next.js API routes**
- **Firebase SDK**, но фактически используется только **Firestore**
- **состояние карты через собственный store** (`mapStateStore.ts`)
- **Vercel** как основной frontend-hosting
- **GitHub** как репозиторий

Firebase сейчас хранит **один документ** `maps/default`.

### Текущая схема Firestore
Документ `maps/default` содержит:
- `version: 1`
- `updatedAt: serverTimestamp()`
- `payload.world`
- `payload.buildings`
- `payload.players`
- `payload.meta` (опционально)

### Что важно
Текущую карту и бизнес-логику нужно **сохранить**, а не выкинуть.
Новая архитектура должна быть построена так, чтобы:
- карта продолжала работать почти как раньше;
- данные больше не зависели от Firebase;
- авторизация стала безопасной;
- проект стал чище по структуре.

---

# Целевой результат

## Новая структура проекта
Сделать monorepo-структуру с двумя основными папками:

```txt
project-root/
  frontend/
  backend/
  package.json
  README.md
  .gitignore
```

### `frontend/`
Здесь должен остаться и развиваться текущий Next.js проект:
- App Router
- страницы
- карта
- админка
- стили
- PixiJS логика
- клиентский store
- запросы к backend

### `backend/`
Здесь должен быть отдельный Node.js + TypeScript backend:
- REST API
- аутентификация
- авторизация
- работа с базой данных
- Steam login callback
- регистрация через email/password
- миграция схемы Firestore в PostgreSQL
- безопасные cookies / session / JWT rotation при необходимости

---

# Целевой стек после улучшения

## Frontend
- Next.js 14
- React
- TypeScript
- PixiJS + pixi-viewport
- CSS Modules / global styles
- fetch к backend API
- деплой на **Vercel**

## Backend
- Node.js
- TypeScript
- Express или Fastify
- Prisma ORM
- PostgreSQL на **Vultr Managed Database** или PostgreSQL на Vultr instance
- безопасная auth-система
- деплой из GitHub на **Vultr**

## Storage
- PostgreSQL на Vultr
- при необходимости ассеты оставить в `public/` или позже вынести в Object Storage

---

# Главный принцип
**Не ломать существующую карту.**

То есть:
- не переписывать заново PixiJS-слой;
- не переписывать всю клиентскую логику;
- не убирать текущие сущности `world`, `buildings`, `players`, `meta`;
- просто заменить слой хранения и добавить auth.

---

# Этапы работ step by step

## STEP 1. Подготовить новую структуру проекта

### Задача
Разделить текущий проект на `frontend` и `backend`.

### Что сделать
1. Создать папки:

```txt
/frontend
/backend
```

2. Перенести весь текущий Next.js проект в папку `frontend`.
3. В `backend` создать новый TypeScript backend проект.
4. В корне оставить общий `README.md` с описанием архитектуры.
5. Настроить `.gitignore` так, чтобы отдельно игнорировались:
   - `frontend/node_modules`
   - `backend/node_modules`
   - `.env`
   - `.next`
   - `dist`
   - `coverage`

### Критерий готовности
- проект открывается из одной корневой папки;
- frontend запускается отдельно;
- backend запускается отдельно;
- структура понятная и не ломает текущий код карты.

---

## STEP 2. Создать backend с чистой архитектурой

### Задача
Сделать backend как отдельный слой, а не держать критичную логику в Next.js route handlers.

### Что сделать
В `backend` создать структуру:

```txt
backend/
  src/
    app.ts
    server.ts
    config/
    routes/
    controllers/
    services/
    repositories/
    middleware/
    auth/
    steam/
    db/
    utils/
    types/
  prisma/
    schema.prisma
  package.json
  tsconfig.json
```

### Требования
- использовать TypeScript;
- выделить слои `routes -> controllers -> services -> repositories`;
- не писать всю логику в одном файле;
- конфиги брать только из env;
- добавить централизованный error handler;
- добавить input validation;
- добавить CORS только для доменов frontend.

### Критерий готовности
- backend стартует локально;
- есть health endpoint `/health`;
- есть базовый API prefix, например `/api`.

---

## STEP 3. Заменить Firebase на PostgreSQL на Vultr

### Задача
Полностью убрать зависимость от Firestore для хранения карты.

### Текущие данные
Firestore хранит документ `maps/default` со схемой:
- `version`
- `updatedAt`
- `payload.world`
- `payload.buildings`
- `payload.players`
- `payload.meta`

### Что сделать
Создать PostgreSQL схему, которая логически повторяет существующую модель.

### Рекомендуемая схема БД

#### Таблица `map_states`
Хранит одну основную карту:
- `id`
- `slug` = `default`
- `version`
- `updated_at`
- `world_w`
- `world_h`
- `map_texture_version`
- `meta_json` nullable

#### Таблица `map_buildings`
Хранит здания:
- `id`
- `map_state_id`
- `building_key` — бывший ключ из `payload.buildings`
- `x`
- `y`
- `zone_x`
- `zone_y`
- `zone_w`
- `zone_h`
- `scale` nullable
- `rotation` nullable
- `proj_0` nullable
- `proj_1` nullable
- `proj_2` nullable
- `proj_3` nullable
- `created_at`
- `updated_at`

#### Таблица `map_players`
Хранит игроков на карте:
- `id`
- `map_state_id`
- `player_key` — бывший ключ из `payload.players`
- `x` nullable
- `y` nullable
- `tier` nullable
- `name` nullable
- `title` nullable
- `desc` nullable
- `extra_json` nullable для UI-полей, которые раньше могли свободно персиститься
- `created_at`
- `updated_at`

### Почему так
Это сохраняет текущую логику карты, но переводит данные из одного Firestore-документа в нормализованную SQL-структуру.

### Критерий готовности
- данные карты читаются из PostgreSQL;
- форма данных на frontend остаётся совместимой с текущим `mapStateStore`;
- Firebase больше не нужен для `maps/default`.

---

## STEP 4. Сделать Prisma-схему и миграции

### Задача
Управлять базой через Prisma.

### Что сделать
1. Создать `backend/prisma/schema.prisma`.
2. Описать модели:
   - `User`
   - `Account`
   - `Session`
   - `MapState`
   - `MapBuilding`
   - `MapPlayer`
3. Добавить индексы:
   - `slug` для `MapState`
   - `building_key` + `map_state_id`
   - `player_key` + `map_state_id`
   - `email` для `User`
   - `steam_id` для `Account`
4. Создать миграцию для первичного развертывания.

### Критерий готовности
- Prisma миграция проходит локально;
- backend подключается к базе Vultr через `DATABASE_URL`;
- схема готова к импорту старых данных.

---

## STEP 5. Перенести текущий Firestore-документ в PostgreSQL

### Задача
Сделать безопасную миграцию без потери логики.

### Что сделать
1. Написать migration/import script в `backend/scripts/import-firestore-map.ts`.
2. Скрипт должен:
   - считать текущий документ `maps/default`;
   - преобразовать `payload.world` в запись `map_states`;
   - преобразовать `payload.buildings` в набор строк `map_buildings`;
   - преобразовать `payload.players` в набор строк `map_players`;
   - сохранить `meta` как JSON;
   - сохранить `version` и `updatedAt`.
3. Добавить dry-run режим.
4. Добавить логирование количества импортированных зданий и игроков.

### Обязательно
- не удалять старые данные автоматически;
- сперва импортировать в новую БД;
- только после проверки переключить frontend на backend API.

### Критерий готовности
- карта полностью собирается из новых данных;
- визуально на frontend всё остаётся прежним.

---

## STEP 6. Сделать backend API для карты

### Задача
Frontend не должен напрямую работать с Firestore.

### Нужные endpoint'ы

#### Public / protected API
- `GET /api/maps/default`
- `PUT /api/maps/default`
- `GET /api/maps/default/buildings`
- `GET /api/maps/default/players`
- `PUT /api/maps/default/buildings`
- `PUT /api/maps/default/players`

### Важно
Сохранить совместимость с текущей логикой:
- `world`
- `buildings`
- `players`
- `meta`

То есть backend должен отдавать данные в формате, максимально близком к текущему формату frontend.

### Правила записи
Повторить защитную бизнес-логику Firestore:
- если `players` пришёл пустым объектом, а в БД игроки уже есть, не перезаписывать их случайно;
- всегда обновлять `version`, `updatedAt`, `world`, `buildings`;
- `meta` сохранять, если поле присутствует.

### Критерий готовности
- frontend может читать и сохранять карту через backend API;
- структура ответа совместима с текущим store.

---

## STEP 7. Добавить обычную регистрацию через email/password

### Задача
Сделать безопасную обычную регистрацию.

### Требования по безопасности
- **никогда не хранить пароль в открытом виде**;
- использовать **argon2id** или `bcrypt` с безопасными параметрами, предпочтительно argon2id;
- email приводить к lower-case;
- делать валидацию пароля на сервере;
- добавить rate limit на login/register;
- не выдавать слишком подробные ошибки типа `email exists / user not found` в опасных местах;
- сессии хранить безопасно;
- использовать **HttpOnly cookies**;
- использовать `Secure` cookie в production;
- использовать `SameSite=Lax` или строже, где подходит;
- защитить auth endpoints от brute force;
- добавить CSRF-защиту, если используются cookie-based mutation формы;
- не хранить чувствительные данные в localStorage.

### Что сделать
Создать flow:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Рекомендуемые таблицы

#### `users`
- `id`
- `email` nullable unique
- `display_name` nullable
- `password_hash` nullable
- `created_at`
- `updated_at`
- `is_active`

#### `sessions`
- `id`
- `user_id`
- `token_hash`
- `ip`
- `user_agent`
- `expires_at`
- `created_at`
- `revoked_at` nullable

### Критерий готовности
- пользователь может зарегистрироваться и войти;
- пароль хранится только как хэш;
- при логине создаётся безопасная сессия;
- backend не раскрывает чувствительные детали.

---

## STEP 8. Добавить авторизацию через Steam

### Задача
Сделать вход через Steam так, чтобы основным идентификатором был **Steam ID**, а никнейм был только отображаемым полем.

### Что сделать
Поддержать flow:
- кнопка `Login with Steam` на frontend;
- redirect на backend;
- backend обрабатывает Steam callback;
- backend находит пользователя по Steam ID;
- если пользователя нет — создаёт нового;
- если есть — логинит в existing account;
- создаёт защищённую сессию.

### В БД добавить таблицу `accounts`
- `id`
- `user_id`
- `provider` (`steam`, `credentials`)
- `provider_account_id`
- `created_at`
- `updated_at`

### Для Steam хранить
- `provider = steam`
- `provider_account_id = steamId`

### Если получится получить публичные данные Steam
Дополнительно обновлять:
- `display_name`
- `avatar_url`
- `profile_url`

### Правила безопасности
- не доверять данным с frontend;
- весь Steam callback валидировать на backend;
- не логинить пользователя только по nickname;
- уникальным ключом считать только `Steam ID`;
- не класть токены в localStorage;
- финальная auth-сессия должна быть такой же безопасной, как и при email-login.

### Критерий готовности
- можно войти через Steam;
- в БД хранится Steam ID;
- никнейм используется только как display field.

---

## STEP 9. Сделать связывание аккаунтов

### Задача
Один пользователь должен при необходимости иметь:
- обычную регистрацию;
- Steam login;
- один и тот же профиль.

### Что сделать
Поддержать сценарии:
1. Пользователь зарегистрировался через email, потом привязал Steam.
2. Пользователь вошёл через Steam, потом добавил email/password.

### Правила
- не создавать дублирующихся пользователей без причины;
- связывать провайдеры через таблицу `accounts`;
- все risky операции выполнять только после re-auth или подтверждения текущей сессии.

### Критерий готовности
- один пользователь может иметь несколько способов входа;
- его профиль и роль остаются едиными.

---

## STEP 10. Ввести роли и доступ к изменению карты

### Задача
Сделать безопасный контроль доступа, чтобы карту нельзя было менять кем угодно.

### Минимальные роли
- `USER`
- `ADMIN`

### Поведение
- обычный `USER` может смотреть карту;
- `ADMIN` может изменять карту, здания, игроков, мета-информацию;
- при необходимости позже добавить `MODERATOR`.

### Что сделать
1. Добавить `role` в `users`.
2. Сделать middleware авторизации.
3. Защитить mutation endpoints карты.
4. Проверять права на backend, а не только в UI.

### Критерий готовности
- карта редактируется только авторизованными и разрешёнными пользователями.

---

## STEP 11. Переподключить frontend к backend API

### Задача
Не ломая текущую карту, заменить слой доступа к данным.

### Что сделать
1. Оставить текущий `mapStateStore` как основу.
2. Убрать прямую зависимость от Firebase в логике карты.
3. Создать новый клиентский слой, например:

```txt
frontend/src/lib/api/
  auth.ts
  maps.ts
```

4. Все чтение/сохранение карты перевести на backend API.
5. Firebase fallback убрать после полного завершения миграции.

### Критерий готовности
- карта по-прежнему работает как раньше;
- данные сохраняются через backend;
- Firebase больше не участвует в прод-логике.

---

## STEP 12. Обновить frontend-структуру, не ломая карту

### Задача
Чуть улучшить структуру frontend, но не переписать всё заново.

### Целевая структура

```txt
frontend/
  src/
    app/
    components/
      map/
      ui/
      auth/
      admin/
    lib/
      api/
      utils/
      config/
    store/
    hooks/
    types/
```

### Что перенести
- `mapStateStore.ts` -> `src/store/mapStateStore.ts`
- `firebase.ts` удалить после миграции или оставить временно как legacy-only файл
- API-утилиты в `src/lib/api`
- auth-компоненты в `components/auth`

### Критерий готовности
- структура стала понятнее;
- карта не сломана;
- auth UI отделён от карты.

---

## STEP 13. Добавить страницы регистрации и входа

### Нужно сделать во frontend
- `/login`
- `/register`
- `Login with Steam` button
- profile block
- logout button

### Поведение
- если пользователь залогинен — показывать профиль;
- если не залогинен — показывать кнопки входа;
- если роль admin — показывать доступ в `/admin` и сохранение карты.

### Критерий готовности
- пользователь может пройти оба варианта входа;
- UI работает на текущем frontend без ломки карты.

---

## STEP 14. Безопасность production-уровня

### Обязательные меры
1. Все секреты только в env.
2. Не коммитить `.env` в GitHub.
3. Для password hashing использовать `argon2id`.
4. Cookie:
   - `HttpOnly`
   - `Secure` в prod
   - `SameSite=Lax` или строже
5. Rate limiting на:
   - login
   - register
   - steam callback sensitive paths
6. Валидация всех входящих данных через schema validation.
7. CORS только для нужных frontend-origin.
8. Логировать auth-события без утечки паролей.
9. Не хранить пароли, session tokens и steam identity data в открытом виде на клиенте.
10. Session tokens хранить в БД в виде hash, а не plain value.
11. Добавить account lock / delay strategy при brute-force попытках.
12. Не доверять `role` с клиента — проверять роль только на backend.
13. Любые операции изменения карты защищать серверной авторизацией.

### Критерий готовности
- auth слой безопасен по коду;
- нельзя просто подделать доступ через frontend.

---

## STEP 15. GitHub-based deploy

### Что нужно
Проект должен удобно деплоиться из GitHub.

### Схема
- `frontend` деплоится на **Vercel** из GitHub;
- `backend` деплоится на **Vultr** из GitHub.

### Что сделать
1. Подготовить env-example файлы:
   - `frontend/.env.example`
   - `backend/.env.example`
2. Описать переменные отдельно.
3. Для backend добавить production build:
   - `npm run build`
   - `npm run start`
4. Добавить инструкции деплоя в README.
5. Настроить process manager на Vultr:
   - PM2 или Docker Compose

### Критерий готовности
- frontend и backend можно развернуть независимо;
- GitHub остаётся единым источником кода.

---

## STEP 16. Удалить Firebase из production-контура

### Задача
После полной миграции больше не использовать Firestore в проде.

### Что сделать
1. Убедиться, что:
   - чтение карты идёт из backend API;
   - запись карты идёт в PostgreSQL;
   - auth не завязан на Firebase;
   - frontend больше не зависит от `NEXT_PUBLIC_FIREBASE_*`.
2. Удалить Firebase-код или оставить в legacy-ветке.
3. Очистить документацию от старого потока.

### Критерий готовности
- Firebase полностью исключён из основной архитектуры.

---

# Требования к совместимости с текущей картой

Нельзя ломать:
- текущую механику карты;
- текущую загрузку и отображение зданий;
- текущую систему игроков на карте;
- текущий shape данных `world/buildings/players/meta` на уровне frontend-модели.

Можно улучшать:
- способ хранения;
- способ авторизации;
- структуру проекта;
- безопасность;
- backend API.

---

# Что должно получиться в конце

## Архитектура
- `frontend` на Next.js остаётся основной UI-картой;
- `backend` становится источником истины для auth и данных карты;
- `PostgreSQL on Vultr` хранит карту и пользователей;
- `Vercel` обслуживает frontend;
- `Vultr` обслуживает backend и БД.

## Авторизация
- обычная регистрация через email/password;
- вход через Steam;
- безопасные сессии;
- возможность связать оба способа входа с одним профилем.

## Данные карты
- больше не лежат в Firestore;
- лежат в PostgreSQL;
- совместимы с текущей картой.

---

# Итоговый prompt для AI IDE / разработчика

Используй этот проект как **существующую базу**, не переписывай карту заново.

Нужно выполнить рефакторинг и архитектурное улучшение проекта по шагам:

1. Разделить проект на `frontend` и `backend`.
2. Оставить текущую карту и её клиентскую логику как основу.
3. Создать отдельный backend на Node.js + TypeScript.
4. Убрать зависимость от Firebase Firestore.
5. Перенести хранение данных карты `maps/default` в PostgreSQL на Vultr.
6. Сохранить совместимость структуры данных карты с текущей frontend-логикой:
   - `world`
   - `buildings`
   - `players`
   - `meta`
7. Добавить безопасную регистрацию через email/password.
8. Добавить безопасную авторизацию через Steam.
9. Построить auth так, чтобы основными идентификаторами были:
   - email для credentials auth
   - Steam ID для steam auth
10. Никогда не хранить пароль в открытом виде.
11. Использовать безопасные cookie-based sessions.
12. Защитить mutation endpoints карты ролями.
13. Оставить frontend на Vercel.
14. Деплоить backend на Vultr.
15. Подготовить проект к GitHub-based deploy.
16. Не добавлять realtime и websocket.
17. Не ломать текущую карту визуально и логически.

---

# Минимальный definition of done

Считать задачу выполненной, если:
- проект разделён на `frontend` и `backend`;
- карта продолжает работать;
- Firebase больше не используется для основной логики;
- данные карты читаются и пишутся в PostgreSQL на Vultr;
- работают регистрация и логин по email/password;
- работает логин через Steam;
- авторизация реализована безопасно;
- backend защищает изменение карты по ролям;
- всё это можно деплоить через GitHub, Vercel и Vultr.
