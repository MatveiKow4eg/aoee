# Технический аудит перед удалением интеграции **aoe2insights**

Цель: **ничего не удаляя**, собрать исчерпывающий фактический контекст по текущей интеграции aoe2insights (HTML-парсинг/прокси, привязка профилей, выдача данных на фронт, хранение в БД), а также подготовить понимание для миграции на официальные API (World’s Edge) и Steam-логику.

Проект (по структуре):
- **backend**: Express + Prisma (PostgreSQL) + cookie sessions + Steam OpenID
- **frontend**: Next.js (App Router) + Pixi map UI; есть server route handlers в `src/app/api/*`

Отчёт основан **только на реально найденных файлах/импортах/роутах/ENV/схемах**.

---

## A. Executive summary

### A1. Как сейчас устроена интеграция aoe2insights (фактически)
Интеграция присутствует в 2 разных слоях и используется **в 2 разных смыслах**:

1) **“Roster/Claim model” (backend + DB + frontend)**
- В БД есть таблица `aoe_players` (Prisma model `AoePlayer`) — это **внутренняя сущность игрока**, которая хранит:
  - `aoeProfileId` (числовой id AoE2Insights, строка)
  - `aoeProfileUrl`
  - `nickname`
  - кто “заявил” игрока (`claimedByUserId`, `claimedAt`)
- User-to-player связь реализована через `AoePlayer.claimedByUserId` (unique) + `User.aoePlayerClaimed` relation.
- Есть UI “Claim player” (`/claim-player`) и backend endpoints `/api/aoe-players/*`.

2) **HTML-парсинг/прокси статистики aoe2insights (frontend server route)**
- На фронте (Next.js Route Handler) есть endpoint:
  - `GET /api/aoe2insights/statistics?userId=...`
  - Он делает `fetch` на `https://www.aoe2insights.com/user/<id>/includes/statistics`, парсит HTML через `cheerio` и отдаёт JSON.
- В UI (`PlayerHud`, карта `/`) это используется для отображения “rating = matchesPlayed.total” и для модалки статистики.

3) **Steam auto-link после Steam OpenID callback (backend)**
- После Steam login backend делает best-effort попытку привязки пользователя к AoE профилю, но **не через AoE2Insights search HTML**, а через **поиск в payload карты** (`maps/default`) по совпадению никнейма:
  - берёт `steamNickname` (через Steam Web API)
  - нормализует nickname
  - загружает map payload
  - ищет игрока с совпадающим `players[*].name`
  - берёт `players[*].insightsUserId` как `aoeProfileId`
  - создаёт/находит `AoePlayer` и делает atomic claim
  - параллельно обновляет legacy-поля в `users` (`aoeProfileId`, `aoeNickname`, ...)

### A2. Насколько глубоко aoe2insights “вшит”
- Вшит в:
  - Prisma schema и миграции (колонки на `users` + отдельная таблица `aoe_players`).
  - Backend auth flow (Steam callback вызывает авто-линковку, которая работает вокруг `insightsUserId` в map payload).
  - Frontend UI (HUD/карта) через server-side HTML парсинг статистики.
  - Frontend config (разрешённый remote image host и proxy `/api/img`).

### A3. Риск удаления
Высокий, если удалять “в лоб”, потому что:
- `aoeProfileId/aoeProfileUrl/aoeNickname` используются как **legacy compat поля** в `AuthService.toPublicUser()` и потенциально потребляются фронтом.
- Frontend напрямую зависит от `/api/aoe2insights/statistics`.
- В текущем Steam auto-link “источник правды” для `aoeProfileId` — это `players[*].insightsUserId` из map payload, что семантически связано с AoE2Insights.

### A4. Основные зоны, которые затронутся при удалении aoe2insights
1) Next.js route handlers: `/api/aoe2insights/statistics` и `/api/img` (белый список host’ов AoE2Insights)
2) UI: `PlayerHud` + карта `/` (логика “rating/stats” и зависимость от userId)
3) DB:
   - `users.aoe_*` поля
   - `aoe_players` таблица (если в новой архитектуре игроки будут уже не AoE2Insights)
4) Auth / Steam callback: `tryAutoLinkSteamToAoe` и логика, завязанная на `insightsUserId`

---

## B. Full file inventory (всё связанное с aoe2insights / insights / статистикой / claim)

Ниже перечислены файлы, в которых **фактически** присутствуют упоминан��я/логика вокруг aoe2insights / `insightsUserId` / статистики / привязки.

> В колонке **Delete / Refactor / Keep**: это рекомендация *для будущей фазы удаления*, не изменение.

### B1. Backend: Prisma / DB

#### 1) `backend/prisma/schema.prisma`
- Purpose:
  - Описывает модели `User`, `Account`, `Session`, `AoePlayer`, map-модели.
- AOE2Insights-related:
  - `User` legacy поля: `aoeLinkedAt`, `aoeNickname`, `aoeProfileId`, `aoeProfileUrl`
  - `AoePlayer` сущность: `aoeProfileId`, `aoeProfileUrl`, `nickname`, `claimedByUserId`, `claimedAt`
- Who uses:
  - Prisma client во всех репозиториях.
- Delete/Refactor/Keep:
  - **Refactor** (при миграции), т.к. новые API могут заменить смысл `AoePlayer`.

#### 2) `backend/prisma/migrations/20260307104143_add_user_aoe2insights_fields/migration.sql`
- Purpose: добавляет aoe2insights legacy колонки в `users`.
- Delete/Refactor/Keep: **Keep (history)**, но в будущем возможна новая миграция на удаление.

#### 3) `backend/prisma/migrations/20260307125644_add_aoe_players/migration.sql`
- Purpose: создаёт таблицу `aoe_players`.
- Delete/Refactor/Keep:
  - зависит от целевой модели “Player”; вероятно **Refactor** или **Replace**.

#### 4) `backend/prisma/seed-aoe-players.example.json`
- Purpose: пример seed’а, содержит `aoeProfileUrl` вида `https://www.aoe2insights.com/user/.../`.
- Delete/Refactor/Keep: **Refactor** (формат seed будет другим для новой модели).

#### 5) `backend/prisma/seed.ts`, `backend/prisma/scripts/seed-aoe-players.ts`
- Not read here полностью, но по структуре проекта это seed инструменты.
- Delete/Refactor/Keep: **Refactor** если сейчас сидирует AoE2Insights roster.

### B2. Backend: aoe2insights/insights логика

#### 6) `backend/src/services/aoe2insightsService.ts`
- Purpose:
  - HTML парсинг AoE2Insights search результатов (`/search/?q=...`).
  - Нормализация nickname.
- Exports:
  - `normalizeNickname(value: string): string`
  - `parseAoe2InsightsSearch(html): ParsedAoeSearchResult`
  - `aoe2InsightsSearchByNickname(nicknameRaw): Promise<ParsedAoeSearchResult | null>`
  - `aoe2InsightsSearchByNicknameDetailed(...): Promise<Aoe2InsightsSearchResult | null>`
- Data in/out:
  - In: nickname string
  - Out: `{ resultsCount, exactName, profileId, profileUrl }` + detailed diagnostics.
- Who calls:
  - **В ��оде найдено прямое использование** `normalizeNickname` в `steamAutoLinkService.ts`.
  - Использование search функций в реально прочитанных файлах **не обнаружено** (возможно dead/legacy, см. раздел H).
- Delete/Refactor/Keep:
  - для полной деинтеграции — **Delete** (если search больше нигде не используется), но пока помечаем как **candidate**.

#### 7) `backend/src/services/steamAutoLinkService.ts`
- Purpose:
  - Best-effort авто-claim игрока после Steam login.
  - По факту не парсит aoe2insights HTML, а использует `payload.players[*].insightsUserId`.
- Exports:
  - `tryAutoLinkSteamToAoe({ userId, steamId, steamNickname })`
- Data in/out:
  - In: `steamNickname` (Steam persona name), `steamId`, `userId`
  - Out: union `AutoLinkResult` (`linked true/false`, `reason`)
- Dependencies:
  - `MapService.getMapPayload('default')`
  - `normalizeNickname` из `aoe2insightsService.ts`
  - Prisma: `aoePlayer`, `account`, `user`
- Side effects:
  - может создать запись `aoePlayer` (если не существует)
  - делает atomic claim
  - обновляет legacy поля в `users` (`aoeProfileId`, `aoeProfileUrl`, `aoeNickname`, `aoeLinkedAt`)
- Who calls:
  - `backend/src/steam/routes.ts` в `steamAuthCallback`.
- Delete/Refactor/Keep:
  - **Refactor**: именно этот сервис нужно переписать под SteamID→existing player auto-link без aoe2insights.

### B3. Backend: endpoints вокруг claim / player roster

#### 8) `backend/src/routes/aoePlayerRoutes.ts`
- Purpose: Express routes для roster/claim.
- Endpoints:
  - `GET /aoe-players/available` (rate limit)
  - `GET /aoe-players/claimable-from-map` (rate limit)
  - `POST /aoe-players/claim` (auth required + rate limit)
- Delete/Refactor/Keep:
  - **Refactor** (если сущность игрока меняется).

#### 9) `backend/src/controllers/aoePlayerController.ts`
- Purpose: handlers для endpoints выше.
- Key logic:
  - `getClaimablePlayersFromMap`: читает `maps/default`, вытаскивает `players[*].name` + `players[*].insightsUserId`, фильтрует занятые id через `service.filterUnclaimedByProfileIds`.
- Delete/Refactor/Keep:
  - **Refactor** (заменить источники/поля).

#### 10) `backend/src/services/aoePlayerService.ts`
- Purpose:
  - список доступных игроков и claim.
- Key schemas:
  - `claimSchema`: `{ aoeProfileId: string, nickname?: string }`
- Key behavior:
  - `claimForCurrentUser`: создаёт `aoeProfileUrl` как `https://www.aoe2insights.com/user/<id>/` и при отсутствии записи создаёт `AoePlayer`.
- Delete/Refactor/Keep:
  - **Refactor**: нужно отвязать от aoe2insights url/id.

#### 11) `backend/src/repositories/aoePlayerRepository.ts`
- Purpose:
  - все DB операции по `aoe_players`.
- Delete/Refactor/Keep:
  - **Refactor** или **Replace**.

### B4. Backend: Steam auth

#### 12) `backend/src/steam/routes.ts`
- Purpose:
  - Steam OpenID start/callback.
  - В callback выполняет `tryAutoLinkSteamToAoe`.
- Endpoints:
  - `GET /api/auth/steam`
  - `GET /api/auth/steam/callback`
- Delete/Refactor/Keep:
  - **Keep** (Steam OpenID нужен), но **Refactor** в части auto-link.

#### 13) `backend/src/services/steamService.ts`
- Purpose:
  - Steam Web API calls: `getSteamPersonaName`, `getSteamPlayerSummary`.
- ENV:
  - `STEAM_WEB_API_KEY`.
- Delete/Refactor/Keep:
  - **Keep**.

#### 14) `backend/src/services/authService.ts`
- Purpose:
  - register/login/logout/me; формирует `PublicUser` и совместимость.
- AOE2Insights-related:
  - Legacy поля включены в `PublicUser` и `toPublicUser()`.
  - Возвращает `aoePlayer` (новая модель claim).
- Delete/Refactor/Keep:
  - **Keep**, но возможен **Refactor** DTO при удалении legacy aoe-полей.

#### 15) `backend/src/repositories/authRepository.ts`
- Purpose:
  - User/session/account операции.
- AOE2Insights-related:
  - `updateUserAoe2InsightsLink()` (прямо пишет legacy aoe_* поля в `users`).
  - `findAoePlayerClaimedByUserId()`.
- Delete/Refactor/Keep:
  - **Refactor**: `updateUserAoe2InsightsLink()` и часть dto могут стать не нужны.

### B5. Frontend: aoe2insights статистика / proxy

#### 16) `frontend/src/app/api/aoe2insights/statistics/route.ts`
- Purpose:
  - Next.js server route handler: HTML fetch + parse AoE2Insights statistics.
  - In-memory cache per userId (cooldown 6h).
- Endpoint:
  - `GET /api/aoe2insights/statistics?userId=<id>[,<id2>...]`
- Response shape (single):
  - `{ userId, data, source, stale, fetchedAt, error, upstreamStatus }`
  - `data` содержит:
    - `matchesPlayed.total`
    - `overallBestCiv/Map/Position` с `name`, `winRateText`, `matchesText`, `imageUrl` (через `/api/img`) и `upstreamImageUrl`.
- Who calls:
  - `frontend/src/app/components/PlayerHud.tsx`
  - `frontend/src/app/page.tsx` (building card “Статистика”)
- Delete/Refactor/Keep:
  - При полном отказе от aoe2insights: **Delete**.

#### 17) `frontend/src/app/api/img/route.ts`
- Purpose:
  - image proxy с allowlist host’ов `aoe2insights.com`/`www.aoe2insights.com`.
- Who calls:
  - косвенно через `statistics` route (поле `imageUrl=/api/img?url=...`).
- Delete/Refactor/Keep:
  - Если больше нет нужды проксировать aoe2insights изображения: **Delete** или **Refactor** под новые host’ы.

#### 18) `frontend/next.config.ts`
- Purpose:
  - Next image remotePatterns разрешает `www.aoe2insights.com`.
- Delete/Refactor/Keep:
  - **Refactor** (удалить host при деинтеграции).

### B6. Frontend: UI, ожидающая aoe2insights данные

#### 19) `frontend/src/app/components/PlayerHud.tsx`
- Purpose:
  - HUD отображение игрока + модалки settings/stats.
- AOE2Insights coupling:
  - useEffect подгружает `/api/aoe2insights/statistics?userId=...` и выставляет `rating = matchesPlayed.total`.
  - кнопка Statistics грузит те же данные.
- Ожидаемые поля от `/api/aoe2insights/statistics`:
  - в коде используются `data.matchesPlayed.total`, `overallBestCiv/Map/Position` включая `imageUrl`, `name`, `winRateText`, `matchesText`.
- Delete/Refactor/Keep:
  - **Refactor**: заменить источник статистики.

#### 20) `frontend/src/app/page.tsx`
- Purpose:
  - основная карта.
- AOE2Insights coupling:
  - `PlayerRec.insightsUserId?: string` в `players` payload.
  - В building card “Статистика” делает fetch `/api/aoe2insights/statistics`.
  - В `PlayerHud` прокидывает `userId` как `meUser.aoePlayer.aoeProfileId ?? meUser.aoePlayer.insightsUserId`.
  - Привязка UI к игроку часто делается через сравнение `insightsUserId`.
- Delete/Refactor/Keep:
  - **Refactor**: заменить идентификатор и поля маппинга.

#### 21) `frontend/src/app/claim-player/page.tsx`
- Purpose:
  - UI для ручного claim игрока.
- AOE2Insights coupling:
  - Работает с `insightsUserId` (из `claimable-from-map`) и считает это `aoeProfileId`.
  - UI текст и ссылки явно “Open AoE2Insights profile”.
- Delete/Refactor/Keep:
  - **Refactor** (или Delete, если onboarding будет по новой модели).

#### 22) `frontend/src/lib/api/aoePlayers.ts`
- Purpose:
  - API client к backend `/api/aoe-players/*`.
- AOE2Insights coupling:
  - возвращаемый тип `AoePlayer` содержит `aoeProfileId` и `aoeProfileUrl`.
  - `listClaimablePlayersFromMap()` возвращает `{ name, insightsUserId }`.
- Delete/Refactor/Keep:
  - **Refactor**.

### B7. Документация/спеки

#### 23) `steam.md`, `frontend/login.md`, `LOGIN_MD_RESPONSE_REPORT.md`
- Purpose:
  - описания и планы. `LOGIN_MD_RESPONSE_REPORT.md` содержит уже сформулированные концептуальные рекомендации.
- Delete/Refactor/Keep:
  - **Keep** (архив/контекст).

---

## C. Request/data flow (фактические цепочки)

### C1. Steam login → session → (best-effort) auto-link

**1) Frontend**
- Пользователь инициирует Steam login переходом на URL:
  - `frontend/src/lib/api/auth.ts` → `steamLoginUrl()`
  - `GET {API_ORIGIN}/api/auth/steam?mode=login`

**2) Backend: Steam OpenID start**
- Route:
  - `backend/src/routes/authRoutes.ts` → `steamAuthStart` из `backend/src/steam/routes.ts`
- Поведение:
  - формирует OpenID redirect на `https://steamcommunity.com/openid/login`
  - сохраняет state/nonce in-memory

**3) Backend: Steam OpenID callback**
- Route:
  - `GET /api/auth/steam/callback` → `steamAuthCallback`
- Поведение:
  - делает `check_authentication` POST на Steam OpenID endpoint
  - извлекает `steamId` из `openid.claimed_id`
  - mode=login:
    - `AuthRepository.findUserBySteamId(steamId)`
    - если нет → `AuthRepository.createUserWithSteam({ steamId })`
  - mode=link:
    - требует `req.user` (т.е. пользователь уже залогинен)
    - `AuthRepository.linkSteamToUser(userId, steamId)`

**4) Backend: Steam nickname (best-effort)**
- `getSteamPersonaName(steamId)` (`backend/src/services/steamService.ts`)
- Требует `STEAM_WEB_API_KEY`.

**5) Backend: auto-link (best-effort) к “AoE player”**
- Условие в `steamAuthCallback`:
  - выполняется только если `!user.aoeProfileId` и `steamNickname` есть.
- Вызов:
  - `tryAutoLinkSteamToAoe({ userId, steamId, steamNickname })` (`backend/src/services/steamAutoLinkService.ts`)
- Реальная логика auto-link:
  1. `MapService.getMapPayload('default')`
  2. ищет exact match по `payload.players[*].name` после `normalizeNickname`.
  3. берёт `payload.players[*].insightsUserId` как `aoeProfileId`.
  4. создает/находит запись `aoe_players` по `aoeProfileId`.
  5. делает atomic claim (`updateMany where claimedByUserId=null`).
  6. обновляет `users.aoe_*` legacy пол��.

**6) Backend: создаёт session cookie**
- Пишет `sessions` запись + `Set-Cookie`.

**7) Frontend: проверка `me()`**
- `frontend/src/lib/api/auth.ts` → `GET /api/auth/me`.
- Ответ содержит:
  - `providers` (из accounts)
  - `steamConnected`
  - `avatarUrl` (steam avatar через Steam Web API)
  - `aoePlayer` (claim модель)
  - legacy `aoeProfileId` и т.п. (на бекенде)

### C2. Manual claim player flow (`/claim-player`)

**1) UI**
- `frontend/src/app/claim-player/page.tsx`
- Сначала `me()` → если нет user → redirect `/login`.

**2) Получение списка claimable игроков**
- Frontend вызывает:
  - `listClaimablePlayersFromMap()` → `GET /api/aoe-players/claimable-from-map`

**3) Backend формирует список из map payload**
- `backend/src/controllers/aoePlayerController.ts:getClaimablePlayersFromMap`
  - читает `MapService.getMapPayload('default')`
  - из `payload.players` берёт `{name, insightsUserId}`
  - фильтрует уже claimed id по `AoePlayerService.filterUnclaimedByProfileIds()`

**4) Claim**
- Frontend вызывает:
  - `claimAoePlayer({ aoeProfileId: pendingPick.insightsUserId, nickname: pendingPick.name })`
  - `POST /api/aoe-players/claim`
- Backend:
  - `AoePlayerService.claimForCurrentUser(userId, body)`
  - создаёт `aoeProfileUrl` в домене aoe2insights
  - делает atomic claim
- Результат:
  - `{ player: { id, aoeProfileId, aoeProfileUrl, nickname, claimedAt } }`

### C3. aoe2insights statistics parsing flow (frontend server-side)

**1) UI вызывает статистику**
- `PlayerHud.tsx`:
  - при наличии `userId` делает fetch `/api/aoe2insights/statistics?userId=...`
  - ожидает `matchesPlayed.total`.
- `page.tsx` building card:
  - кнопка “Статистика” вызывает тот же endpoint.

**2) Next.js Route handler**
- `frontend/src/app/api/aoe2insights/statistics/route.ts`
- Делает upstream call:
  - `https://www.aoe2insights.com/user/<id>/includes/statistics`
- Парсит HTML `cheerio`.
- Возвращает JSON `ResponseShape`.
- Для картинок строит upstream URL на static assets aoe2insights и проксирует через `/api/img`.

---

## D. Database impact

### D1. Таблицы/модели, затронутые aoe2insights

#### 1) `users` (Prisma model `User`)
AoE2Insights поля:
- `aoe_profile_id` (nullable text)
- `aoe_profile_url` (nullable text)
- `aoe_nickname` (nullable text)
- `aoe_linked_at` (nullable timestamp)

Роль сейчас:
- используютс�� как **legacy compatibility** (AuthService отдает их наружу всегда).
- обновляются автоматически в `steamAutoLinkService`.
- метод `AuthRepository.updateUserAoe2InsightsLink` существует (но не найден в текущих вызовах, см. H).

#### 2) `aoe_players` (Prisma model `AoePlayer`)
Поля:
- `aoe_profile_id` (unique)
- `aoe_profile_url` (text)
- `nickname` (text)
- `claimed_by_user_id` (unique nullable FK to users)
- `claimed_at`

Роль сейчас:
- это фактическая “игровая сущность” (player roster) для системы claim.
- сильно завязана на “aoeProfileId” = AoE2Insights user id.

#### 3) `accounts` (Prisma model `Account`)
Поля:
- `provider`
- `provider_account_id` (SteamId для provider='steam')
- unique(provider, providerAccountId)

Роль:
- единственное место, где стабильно хранится SteamId.

#### 4) `sessions`
- хранит cookie session.

#### 5) map tables: `map_states`, `map_players`, ...
- В `MapPlayer` нет отдельного поля `insightsUserId` в Prisma schema.
- Но map payload (JSON) содержит `players[*].insightsUserId` внутри `extraJson/metaJson` или внешнего payload, который `MapService` возвращает.
  - Это важно: `insightsUserId` сейчас **живёт в payload**, а не как нормализованная колонка.

### D2. Какие поля критичны сейчас
- Для Steam login/идентификации: `accounts(provider='steam', provider_account_id=steamId)` — критично.
- Для “кто я на карте”: `aoe_players.claimed_by_user_id` (и `AuthService.me()` возвращает `aoePlayer`).
- Для UI статистики: `aoePlayer.aoeProfileId` используется как `userId` для aoe2insights statistics.

### D3. Какие поля можно будет удалить (после миграции)
Фактически “aoe2insights-only”:
- `users.aoe_*` legacy поля (если клиенты больше не завязаны)
- `frontend/src/app/api/aoe2insights/statistics` и связанные data-поля в UI
- `aoe_players.aoe_profile_url` и `aoe_profile_id` как именно AoE2Insights ID/URL — зависит от новой модели.

### D4. Что надо сохранить для новой логики Steam binding
Для новой логики “SteamID → existing player” обязательно нужны:
- `accounts` таблица (SteamId хранится там)
- `users` таблица
- **нужна связь Player/Profile ↔ SteamId**:
  - либо через новое поле в сущности игрока (например `steamId`),
  - либо через отдельную таблицу “PlayerExternalAccount”/“PlayerSteamLink”.

Сейчас такой связи в schema.prisma **нет** (steamId связан только с User).

---

## E. Frontend impact

### E1. Страницы/компоненты, завязанные на aoe2insights

1) `frontend/src/app/components/PlayerHud.tsx`
- Использует endpoint:
  - `GET /api/aoe2insights/statistics?userId=...`
- Ожидаемые поля:
  - `matchesPlayed.total` (для rating)
  - `overallBestCiv/Map/Position.{name,imageUrl,winRateText,matchesText}`
- Что сломается при удалении:
  - rating не загрузится
  - модалка Statistics перестанет показывать данные

2) `frontend/src/app/page.tsx`
- Использует endpoint:
  - `GET /api/aoe2insights/statistics?userId=...`
- Зависимость от `insightsUserId`:
  - логика маппинга текущего пользователя на карту через `players[*].insightsUserId`.
- Что сломается:
  - статистика в building card
  - потенциально идентификац��я игрока (если заменить `insightsUserId` идентификатор)

3) `frontend/src/app/api/img/route.ts`
- Работает только с AoE2Insights allowlist.
- Сломается (или станет не нужен), когда статистика/картинки будут из нового источника.

4) `frontend/next.config.ts`
- `remotePatterns` включает `www.aoe2insights.com`.

5) `frontend/src/app/claim-player/page.tsx` + `frontend/src/lib/api/aoePlayers.ts`
- UI и API подразумевают, что “player identity” = AoE2Insights id.

### E2. Какие UI-блоки наиболее критичны
- Onboarding gate на карте:
  - `/` редиректит на `/claim-player`, если `me().user.aoePlayer` отсутствует.
- HUD rating/stats.
- Claim Player страница.

---

## F. Steam auth impact (и привязк�� user ↔ player)

### F1. Как сейчас работает Steam login (фактически)
- Steam OpenID реализован в `backend/src/steam/routes.ts`.
- После callback:
  - user определяется/создается по `accounts(provider='steam', providerAccountId=steamId)`.
  - создается `sessions` запись и cookie.
- Steam persona name подтягивается через Steam Web API, если задан `STEAM_WEB_API_KEY`.

### F2. Где сейчас происходит привязка пользователя к профилю игрока
Есть 2 параллельных представления привязки:

1) **Новая модель** (основная для onboarding):
- `AoePlayer.claimedByUserId = user.id` (unique)
- Возвращается в `/auth/me` как `user.aoePlayer`.

2) **Legacy поля на User**:
- `users.aoe_profile_id`, `users.aoe_profile_url`, `users.aoe_nickname`, `users.aoe_linked_at`
- Заполняются в `steamAutoLinkService`.
- Также есть `AuthRepository.updateUserAoe2InsightsLink`.

### F3. Используется ли aoe2insights id как основной id игрока
Да:
- `AoePlayer.aoeProfileId` — primary внешняя идентичность (уникальная)
- Map payload хранит `players[*].insightsUserId`, который трактуется как `aoeProfileId`.
- Фронт использует `aoePlayer.aoeProfileId` как `userId` для статистики.

### F4. Где матчится nickname
- Auto-link после Steam login:
  - матчится `steamNickname` ↔ `payload.players[*].name` (exact match после `normalizeNickname`).
- Manual claim:
  - nickname передается с клиента как `pendingPick.name` (из payload карты).

### F5. Где матчится steam
- SteamId живет в `accounts`.
- Проверка уникальности SteamId делается через `accounts @@unique([provider, providerAccountId])`.

### F6. Где создаётся/обновляется связь user ↔ player
- `AoePlayerRepository.claimByAoeProfileId` (atomic updateMany)
- `steamAutoLinkService` может сам создать `AoePlayer` при отсутствии.

---

## G. Migration plan (безопасный пошаговый план перехода)

Ниже план именно как “сначала отключить/заменить, потом удалить”, чтобы минимизировать риски.

### Шаг 0. Зафиксировать текущие контракты
1) Зафиксировать контракт `/api/auth/me` (что фронт реально читает):
   - `user.aoePlayer` используется для gating и hud.
2) Зафиксировать контракт `GET /api/aoe2insights/statistics` (UI полагается на shape).

### Шаг 1. Ввести целевую “Player/Profile” сущность, независимую от aoe2insights
Варианты (минимальный безопасный):
- Переименовать/переосмыслить `AoePlayer` в более общий `PlayerProfile` (не сейчас, а через новую таблицу/миграцию), или
- Добавить в `AoePlayer` новые поля, но не ломая старые:
  - `steamId` (nullable, unique) **или** `steamAccountId`.

С учётом твоей целевой логики (“я вручную внесу Steam ID в БД для уже существующих игровых профилей”):
- Самый прямой путь: добавить поле `steamId` в таблицу player-профилей (с уникальным индексом).

### Шаг 2. Изменить auto-link: SteamID → existing player
- В `steamAuthCallback` после получения steamId:
  - искать player profile по `steamId`.
  - если най��ен: связать текущего `userId` с найденным профилем (atomic claim/attach).
  - если не найден: логин успешен, но без claim.

### Шаг 3. Заменить aoe2insights statistics
- Удаление AoE2Insights статистики должно идти после появления нового источника.
- Временный fallback:
  - UI может показывать “нет статистики” вместо вызова aoe2insights.

### Шаг 4. Убрать зависимость payload карты от `insightsUserId`
- Сейчас `players[*].insightsUserId` — ключевой идентификатор.
- Нужно заменить на `playerId`/`profileId` вашей системы или хотя бы на `steamId` (если это подходит в payload).

### Шаг 5. Удалить legacy поля и сервисы aoe2insights
После того как:
- фронт больше не использует `/api/aoe2insights/statistics`
- auto-link не использует `insightsUserId` и `aoeProfileUrl`
- DTO `/auth/me` больше не требует legacy `aoeProfileId` и т.п.

Тогда:
- удалить `frontend/src/app/api/aoe2insights/statistics/route.ts`
- удалить/переписать `/api/img` allowlist
- удалить `backend/src/services/aoe2insightsService.ts` (если нет других вызовов)
- сделать миграцию на удаление `users.aoe_*` и/или рефактор `aoe_players`.

### Шаг 6. Тестирование
Минимальный набор:
- Steam login (mode=login) + редиректы
- Steam link (mode=link) для существующего session
- auto-link по SteamID (found / not found)
- конкурирующий claim (гонка) — должно быть безопасно
- `/claim-player` onboarding (если сохраняется)
- карта `/` gating по `me().user.aoePlayer`

---

## H. Open questions / risks (реальные неопределенности по коду)

1) **`backend/src/services/aoe2insightsService.ts` search-парсер выглядит как “legacy/unused”**
- В прочитанных файлах он используется только как `normalizeNickname`.
- Функции `aoe2InsightsSearchByNickname*` не нашли прямых вызовов в прочитанном наборе.
- Риск: это может быть dead code или используется в не просмотренных файлах/скриптах.

2) **Auto-link в текущем виде не использует AoE2Insights вообще**, но использует поле `insightsUserId` в payload карты.
- Это фактическая точка coupling: “aoe2insights id” хранится в map payload.
- При замене на официальные API важно понять, чем станет идентификатор.

3) **Дублирование модели привязки**
- Есть `AoePlayer.claimedByUserId` и параллельно legacy aoe_* поля на `users`.
- Нужно решить, что является source-of-truth.

4) **ENV-переменные**
- В backend `.env.example` есть `STEAM_WEB_API_KEY`, но нет явного `AOE2INSIGHTS_*` env.
- В frontend нет `AOE2INSIGHTS_*` env.
- Значит aoe2insights base URL сейчас хардкожен в коде.

5) **Уникальность claim**
- `AoePlayer.claimedByUserId` unique → один user может иметь только один claimed player.
- `AoePlayer.aoeProfileId` unique → один профиль только один.
- В новой архитектуре, если появится “Player” отдельный от “Profile”, потребуется переосмысление.

---

# Дополнительно: списки файлов для дальнейших действий

## 1) Список точных фай��ов, которые потом придётся менять

### Backend
- `backend/prisma/schema.prisma` (новые поля/модель под SteamID→player)
- `backend/prisma/migrations/*` (новая миграция)
- `backend/src/services/steamAutoLinkService.ts` (переписать auto-link)
- `backend/src/steam/routes.ts` (вызов auto-link и пост-логин redirect/поведение)
- `backend/src/services/authService.ts` (DTO `PublicUser` и `toPublicUser` при смене модели)
- `backend/src/repositories/authRepository.ts` (возможна новая функция поиска/линка профиля по steamId)
- `backend/src/controllers/aoePlayerController.ts` (если claim/claimable-from-map остаётся)
- `backend/src/services/aoePlayerService.ts` (если сущность игрока меняется)
- `backend/src/repositories/aoePlayerRepository.ts`

### Frontend
- `frontend/src/app/components/PlayerHud.tsx` (убрать зависимость от aoe2insights stats)
- `frontend/src/app/page.tsx` (убрать `insightsUserId` как ключ и убрать статистику)
- `frontend/src/app/claim-player/page.tsx` (смена onboarding flow)
- `frontend/src/lib/api/aoePlayers.ts` (API и типы)
- `frontend/src/lib/api/auth.ts` (тип `MeResponse` при изменении payload)
- `frontend/next.config.ts` (удалить remotePatterns aoe2insights)

## 2) Список файлов, которые потенциально можно удалить полностью (после миграции)
- `frontend/src/app/api/aoe2insights/statistics/route.ts`
- `frontend/src/app/api/img/route.ts` (если не нужен общий image-proxy)
- `backend/src/services/aoe2insightsService.ts` (если search не используется нигде кроме normalize)

## 3) Список файлов, которые нельзя просто удалить — их нужно переписать
- `backend/src/services/steamAutoLinkService.ts`
- `frontend/src/app/components/PlayerHud.tsx`
- `frontend/src/app/page.tsx`
- `backend/prisma/schema.prisma` (+ новые миграции)

---

# Черновик новой архитектуры: Steam ID → existing player auto-link

Ниже — проектирование на базе **реального текущего кода**, с минимальными ломками.

## Целевая логика (как ты описал)
1) Ты вручную вносишь Steam ID в БД для уже существующих игровых профилей.
2) Пользователь логинится через Steam.
3) После Steam login система получает Steam ID.
4) По Steam ID система находит существующий профиль игрока.
5) Если найден:
   - не создавать нового игрока
   - не создавать дубликат профиля
   - автоматически связать user с existing player/profile
   - от��равить в существующий профиль
6) Если не найден:
   - описать текущее поведение
   - предложить безопасный fallback

## Что сейчас произойдёт при “Steam login, профиль не найден”
Фактически сейчас:
- user будет найден/создан по steamId (Account).
- затем произойдёт попытка auto-link **по steamNickname через map payload** (не по steamId).
- если в payload нет точного совпадения имени, или `insightsUserId` не найден/ambiguous → user останется без claim.
- фронт на `/` после `me()` увидит, что `user.aoePlayer` = null и **редиректит на `/claim-player`**.

## Рекомендованный безопасный fallback
Если профиль по SteamID не найден:
- Логин не должен падать.
- UI должен отправлять пользователя на controlled onboarding:
  - либо `/claim-player` (если ручной claim остается),
  - либо страницу “профиль не найден, обратитесь к администратору / выберите профиль / создайте новый”.

## Мин��мальные изменения в данных

### Вариант A (наименее инвазивный): расширить `AoePlayer`
Добавить в `AoePlayer` поле:
- `steamId String? @unique @map("steam_id")`

Тогда твой ручной шаг:
- Ты вносишь `steam_id` в существующие строки `aoe_players`.

Auto-link в `steamAuthCallback`:
1) steamId получен
2) `find AoePlayer where steamId = steamId`
3) если найден и не claimedByUserId:
   - atomic claim
4) если найден и claimedByUserId != current user:
   - конфликт (409 / или просто логин без claim + сообщить)

Плюсы:
- минимум изменений в фронте (пока он ждёт `aoePlayer`).
Минусы:
- сущность всё ещё называется/семантически “AoePlayer” и хранит aoeProfileId/url.

### Вариант B (чище): новая таблица PlayerProfile + внешний ключ Steam
- Создать `PlayerProfile` (внутренний id)
- Создать `PlayerExternalAccount` с `{ provider='steam', providerAccountId=steamId, playerProfileId }`
- Claim/ownership — отдельное поле/таблица

Плюсы:
- правильно масштабируется на World’s Edge/Steam/прочие.
Минусы:
- больше рефакторинга сейчас.

## Где именно менять код (по текущим файлам)
- `backend/src/services/steamAutoLinkService.ts`:
  - заменить поиск по nickname в payload на поиск по `steamId` в таблице player.
- `backend/src/steam/routes.ts`:
  - оставить вызов auto-link, но поменять смысл.
- `backend/src/services/authService.ts`:
  - оставить `aoePlayer` в `/auth/me`, но возможно переименовать позже.
- `frontend/src/app/page.tsx`:
  - логика определения `userId` для статистики должна быть заменена (после замены статистики).

---

## Приложение: backend endpoints, которые прямо/косвенно используют aoe2insights

### 1) `GET /api/auth/steam/callback`
- Handler: `backend/src/steam/routes.ts:steamAuthCallback`
- Uses:
  - `tryAutoLinkSteamToAoe` → использует `payload.players[*].insightsUserId` и формирует `aoeProfileUrl` на aoe2insights.

### 2) `GET /api/aoe-players/claimable-from-map`
- Handler: `backend/src/controllers/aoePlayerController.ts:getClaimablePlayersFromMap`
- Uses:
  - читает `payload.players[*].insightsUserId`

### 3) `POST /api/aoe-players/claim`
- Handler: `backend/src/controllers/aoePlayerController.ts:postClaimAoePlayer`
- Service: `backend/src/services/aoePlayerService.ts:claimForCurrentUser`
- Uses:
  - строит `aoeProfileUrl` в домене aoe2insights.

---

## Приложение: frontend endpoints/страницы, использующие aoe2insights

### 1) `GET /api/aoe2insights/statistics?userId=...`
- Implemented: `frontend/src/app/api/aoe2insights/statistics/route.ts`
- Used by:
  - `frontend/src/app/components/PlayerHud.tsx`
  - `frontend/src/app/page.tsx`

### 2) `GET /api/img?url=...`
- Implemented: `frontend/src/app/api/img/route.ts`
- Used by:
  - `statistics` route handler возвращает `imageUrl=/api/img?...`

---

*Сгенерировано как аудит-контекст; код не изменялся.*
