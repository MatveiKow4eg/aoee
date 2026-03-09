## A. Executive verdict

- Реализовано ли ТЗ по факту: в основном реализовано, критические части Steam login + авто-линк по steamId + новый source of truth на AoePlayer.claimedByUserId присутствуют и используются. Есть Transitional/Legacy остатки вокруг insightsUserId и client-side HUD, а также transitional claim из map (claimable-from-map) — помечено как LEGACY LEFT INTENTIONALLY.
- Что точно сделано:
  - В БД у AoePlayer добавлено поле steamId (nullable, unique, @map("steam_id")); связь claim — claimedByUserId (unique) с relation на User.
  - Авто-линк в backend/src/services/steamAutoLinkService.ts ищет строго по steamId и делает атомарный claim через updateMany(where: claimedByUserId: null).
  - Steam callback создает/находит User по Steam Account, вызывает авто-линк best-effort, сессия создаётся независимо от результата auto-link.
  - /auth/me формирует DTO с user.aoePlayer, включающим steamId и claimedAt из AoePlayer.
  - На фронтенде убраны прямые обращения к aoe2insights; статистика отключена; нет домена aoe2insights в next.config.ts.
- Что не доказано/частично: фронтенд HUD продолжает в ряде мест опираться на insightsUserId из map payload для отображения никнейма/аватара/тиер-лейбла — это TRANSITIONAL. Страница claim-player использует transitional «claimable-from-map» (insightsUserId) как источник кандидатов — LEGACY/TRANSITIONAL.
- Что не соответствует: отсутствуют обращения к steamNickname/normalizeNickname и никакого никнейм-матчинга по map payload в авто-линке — но это соответствует ТЗ «ищем по steamId». Если ТЗ требовало никнейм-матчинг — его НЕТ (NOT IMPLEMENTED).

## B. Prisma / DB validation

- Точная модель AoePlayer (backend/prisma/schema.prisma):
  ```prisma
  model AoePlayer {
    id              String    @id @default(cuid())
    aoeProfileId    String    @unique @map("aoe_profile_id")
    aoeProfileUrl   String    @map("aoe_profile_url")
    nickname        String
    steamId         String?   @unique @map("steam_id")
    claimedByUserId String?   @unique @map("claimed_by_user_id")
    claimedAt       DateTime? @map("claimed_at")
    createdAt       DateTime  @default(now()) @map("created_at")
    updatedAt       DateTime  @updatedAt @map("updated_at")
    claimedByUser   User?     @relation("AoePlayerClaim", fields: [claimedByUserId], references: [id])

    @@index([claimedByUserId])
    @@map("aoe_players")
  }
  ```
- Роль steamId: поле существует, тип String?, nullable, уникальное, с @map("steam_id"). Используется для поиска в авто-линке.
- Роль claimedByUserId: nullable, unique, @map("claimed_by_user_id"); является source of truth для claim. Используется в авто-линке и в AuthRepository.findAoePlayerClaimedByUserId.
- Legacy поля в users: aoeLinkedAt, aoeNickname, aoeProfileId, aoeProfileUrl — остались в модели User. Согласно комментариям репозитория, это transitional. В DTO authService они передаются как legacy совместимость, но source of truth — AoePlayer.claimedByUserId.
- Используется ли claimedByUserId как source of truth: да, см. backend/src/repositories/authRepository.ts -> findAoePlayerClaimedByUserId(where: { claimedByUserId: userId }). Комментарий к updateUserAoe2InsightsLink: «Source of truth ... is now AoePlayer.claimedByUserId».

## C. Steam auto-link validation

Файл: backend/src/services/steamAutoLinkService.ts

- Ищется ли player именно по steamId: да
  ```ts
  const player = await prisma.aoePlayer.findUnique({ where: { steamId: safeSteamId }, select: { id, claimedByUserId } });
  ```
- Что происходит, если player не найден: возвращается { ok: true, linked: false, reason: 'player_not_found_for_steam_id' } и логируется 'not_found'.
- Если user уже claimed другой player: заранее читается alreadyClaimed по claimedByUserId; если id отличается от найденного, то возвращается reason: 'user_already_claimed_other_player'.
- Если player уже claimed другим user: возвращается reason: 'already_claimed_by_another_user'.
- Если player уже claimed этим же user: возвращается { ok: true, linked: true, reason: 'already_linked', aoePlayerId }.
- Если player свободен: выполняется атомарный claim через prisma.aoePlayer.updateMany({ where: { id, claimedByUserId: null }, data: { claimedByUserId: userId, claimedAt: now } }); по count===1 — success, иначе race -> 'already_claimed_by_another_user'.
- Атомарность: есть, через updateMany с guard claimedByUserId: null.
- Реальные return shapes и reasons: см. тип AutoLinkResult: ok, linked, reason ('linked_by_steam_id' | 'already_linked' | 'player_not_found_for_steam_id' | 'already_claimed_by_another_user' | 'user_already_claimed_other_player' | 'unexpected_error'), aoePlayerId в success/"already_linked".
- Используется ли steamNickname: нет в этом сервисе. Логика не использует никнейм.
- Используется ли normalizeNickname: нет.
- Используется ли map payload nickname matching: нет.
- Используется ли insightsUserId: нет.
- Соответствие ТЗ: если ТЗ требовало строгий поиск по steamId и fail-safe — DONE. Если в ТЗ были условия по никнейм-матчингу — NOT IMPLEMENTED.

## D. Steam callback validation

Файл: backend/src/steam/routes.ts

- Где вызывается авто-линк: после успешной валидации OpenID, извлечения steamId, нахождения/создания пользователя и бест-эффорт обновления displayName. Вызов:
  ```ts
  const result = await tryAutoLinkSteamToAoe({ userId: user.id, steamId });
  log('auto_link_result', result);
  ```
- Успешен ли login, если player profile по steamId не найден: да. В этом случае auto-link возвращает linked=false; login не прерывается.
- Создаётся ли session независимо от результата auto-link: да, сессия создаётся после попытки авто-линка, а любые ошибки в блоке авто-линка перехватываются и игнорируются.
- Как логируется/возвращается результат авто-линка: логируется через console.log с event 'auto_link_result', но пользователю напрямую не возвращается (редирект на фронт).
- Есть ли жёсткая зависимость от наличия linked player: нет. Наличие связанного игрока не блокирует логин/сессию.

## E. Auth / me validation

Файлы: backend/src/services/authService.ts, backend/src/repositories/authRepository.ts, frontend/src/lib/api/auth.ts

- Exact response shape: authService.me() возвращает { user: PublicUser | null }.
  - PublicUser включает: id, email, displayName, role, steamConnected, providers, avatarUrl (из Steam Web API), LEGACY: aoeProfileId/Url/Nickname/LinkedAt, и новый aoePlayer.
  - aoePlayer shape: { id, aoeProfileId, aoeProfileUrl, nickname, steamId?, claimedAt? } — steamId включён на backend-DTO уровне (см. toPublicUser), но фронтендский тип MeResponse в frontend/src/lib/api/auth.ts пока не включает steamId в aoePlayer (легаси несовпадение типов — PARTIAL/LEGACY DTO MISMATCH), хотя UI его и не использует.
- Возвращается ли user.aoePlayer: да, если есть claim (repo.findAoePlayerClaimedByUserId) — select включает id, aoeProfileId, aoeProfileUrl, nickname, claimedAt, steamId.
- Попадает ли туда steamId: да, на backend включён и мапится в toPublicUser. На фронтенде тип не отражён — но это не ломает UI.
- Используются ли legacy users.aoe_* поля: они прокидываются в DTO для совместимости (aoeProfileId/Url/Nickname/LinkedAt), но не являются source of truth.
- Обновляются ли они ещё автоматически: в репозитории есть метод updateUserAoe2InsightsLink помеченный @deprecated. По коду текущих флоу он не вызывается в новых местах (в предоставленных файлах). Авто-линк и auth/me не используют их обновление. Следовательно, автоматического обновления сейчас нет — LEGACY, НЕ ИСПОЛЬЗУЕТСЯ как источник истины.
- Что сейчас реально является source of truth для связи user <-> player: AoePlayer.claimedByUserId.

## F. Frontend validation

Файлы: frontend/src/app/components/PlayerHud.tsx, frontend/src/app/page.tsx, frontend/next.config.ts

- Нет ли fetch к /api/aoe2insights/statistics: нет. В коде нет обращений к такому API.
- Нет ли прямых fetch на aoe2insights: не обнаружено. next.config.ts не содержит доменов для внешнего Image/remotePattern на aoe2insights.com; сам код не делает fetch на внешний домен.
- Не используется ли insightsUserId как основной источник player stats: статистика полностью выключена; однако insightsUserId продолжает использоваться как ключ для сопоставления me.user.aoePlayer.aoeProfileId с map payload players[...] (для никнейма, тайтла, tierLabel, аватара) — это transitional отображение карточки, а не статистики; статистика помечена как убранная.
- Тянет ли PlayerHud ещё какую-то статистику: нет. Окно Statistics теперь статично с текстом «Statistics are temporarily disabled…».
- Убраны ли old building/player stats from aoe2insights: да, код для статистики отсутствует. Имеется только UI-модал с заглушкой.
- Есть ли в next.config.ts домен aoe2insights.com: нет.
- Если статистика убрана, что UI показывает вместо неё: модальное окно с сообщением об отключении статистики.

## G. Claim / onboarding validation

Файл: frontend/src/app/claim-player/page.tsx (+ frontend/src/lib/api/aoePlayers.ts)

- Убраны ли тексты/ссылки на AoE2Insights profile: UI не содержит ссылок на внешние профили. Страница говорит о «Players (legacy insightsUserId, transitional)» — явная маркировка.
- Зависит ли claim flow от aoeProfileUrl: нет. Вызов claimAoePlayer передаёт { aoeProfileId, nickname? } и не использует aoeProfileUrl на клиенте. Источник списка — listClaimablePlayersFromMap -> /api/aoe-players/claimable-from-map (transitional список по insightsUserId из map payload).
- Зависит ли claim flow от insightsUserId: да, transitional. Список кандидатов строится из { name, insightsUserId } возвращаемых бэкендом. Выбор игрока -> передача insightsUserId как aoeProfileId.
- Используется ли claimable-from-map как transitional legacy source: да, явно.
- Не строится ли новая логика всё ещё вокруг insights: c точки зрения реального связывания user<->player — нет, source of truth AoePlayer.claimedByUserId. Однако первичный UX для выбора игрока базируется на legacy идентификаторах из карты — TRANSITIONAL, отмечено в UI.

## H. Remaining issues

- PARTIAL/LEGACY:
  - Фронтенд тип MeResponse не содержит aoePlayer.steamId (несоответствие backend DTO). Не критично, но желательно синхронизировать типы.
  - Home/Page и PlayerHud продолжают использовать insightsUserId из map payload чтобы «найти» данные отображения (ник/аватар/тиер) — это transitional. Безопасно для отображения, но это зависимость от legacy структуры карты.
  - Claim flow опирается на /api/aoe-players/claimable-from-map с insightsUserId. Это временно, но стоит иметь план миграции к чисто AoePlayer-based выбору.
- NOT IMPLEMENTED (если это было в ТЗ):
  - Никнейм-матчинг/normalizeNickname/steamNickname в авто-линке отсутствуют. Реализован только строгий steamId поиск.
- LEGACY LEFT INTENTIONALLY:
  - Пользовательские поля users.aoe_* оставлены и возвращаются в DTO для совместимости, но не используются как source of truth.
  - Методы обновления users.aoe_* существуют как @deprecated и не используются в новых флоу.

## I. File-by-file evidence

- backend/prisma/schema.prisma
  - Поля AoePlayer: steamId String? @unique @map("steam_id"); claimedByUserId String? @unique @map("claimed_by_user_id"); связь claimedByUser.
  - User содержит legacy aoe_* поля.
- backend/src/services/steamAutoLinkService.ts
  - Поиск по steamId, атомарный claim через updateMany, причины: 'player_not_found_for_steam_id', 'user_already_claimed_other_player', 'already_claimed_by_another_user', 'already_linked', 'linked_by_steam_id', 'unexpected_error'. Нет использования никнеймов/normalize.
- backend/src/steam/routes.ts
  - Авто-линк вызывается после успешного Steam OpenID и подготовки/обновления user; результат логируется и не влияет на создание сессии; редирект на фронт происходит всегда при успехе валидации OpenID.
- backend/src/services/authService.ts
  - toPublicUser включает aoePlayer со steamId и claimedAt. me() подтягивает claimed игрока через репозиторий и Steam providers/аватар.
- backend/src/repositories/authRepository.ts
  - findAoePlayerClaimedByUserId(where: { claimedByUserId: userId }, select: { id, aoeProfileId, aoeProfileUrl, nickname, claimedAt, steamId }).
  - updateUserAoe2InsightsLink помечен @deprecated; комментарий подчёркивает новый source of truth.
  - link/unlink steam аккаунтов; findUserBySteamId/createUserWithSteam — flow Steam-only auth.
- frontend/src/app/components/PlayerHud.tsx
  - Нет загрузки статистики aoe2insights; Statistics-модал — заглушка; отображение базируется на данных из map payload и me().
- frontend/src/app/page.tsx (Home)
  - Нет fetch к /api/aoe2insights/statistics; статистика отключена; использует me() и переадресует на /claim-player если нет aoePlayer; использование insightsUserId для сопоставления с map payload — transitional.
- frontend/next.config.ts
  - Чистая конфигурация, нет доменов aoe2insights.
- frontend/src/app/claim-player/page.tsx
  - Transitional flow: список кандидатов через listClaimablePlayersFromMap() -> { name, insightsUserId }, затем claimAoePlayer({ aoeProfileId: insightsUserId }). Нет ссылок на внешние AoE2Insights профили.

## J. Final verdict

- READY FOR NEXT STEP

Обязательные фиксы до следующего шага: отсутствуют блокирующие. Однако рекомендуется:
1) Синхронизировать фронтенд-тип MeResponse.aoePlayer с backend DTO (добавить steamId? как опциональное) — чтобы избежать скрытых расхождений.
2) Описать план по снятию transitional зависимостей от insightsUserId в Home/HUD и claim-player (перейти на чистый AoePlayer каталог/поиск строений по AoePlayer, когда появятся бекенд-данные), но это можно этапировать.

На второй этап (не блокирующие):
- Постепенно убрать legacy users.aoe_* из DTO, когда фронт перестанет ими пользоваться.
- Опционально внедрить никнейм-матчинг/normalize, если это действительно требуется по ТЗ (сейчас N/A — не реализовано намеренно).
