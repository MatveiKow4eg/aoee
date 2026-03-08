# Steam → AoE2 Insights auto-link spec

## Цель

После логина через **Steam OpenID** backend должен попытаться **автоматически привязать Steam-аккаунт** пользователя к:

1. профилю **AoE2 Insights**,
2. существующему игроку в базе **AoE Estonia**.

Автопривязка должна происходить **только при однозначном и безопасном совпадении**.

---

## Бизнес-логика

### Что должно происходить

1. Пользователь нажимает **Login with Steam**.
2. Steam OpenID возвращает backend'у подтвержденный `steamId`.
3. Backend получает **nickname Steam-пользователя**.
4. По этому nickname backend выполняет поиск на **AoE2 Insights**.
5. Если найден **ровно один** результат и nickname совпадает **на 100%** после нормализации:

   * извлекается `aoeProfileId` из ссылки `/user/<id>/`
   * backend проверяет, что этот `aoeProfileId` существует в базе **AoE Estonia**
   * backend проверяет, что этот `aoeProfileId` еще не связан с другим пользователем
   * backend проверяет, что текущий `steamId` тоже еще не связан с другим пользователем
6. Если все проверки пройдены:

   * Steam-аккаунт автоматически связывается с этим AoE-профилем
7. Если хотя бы одна проверка не пройдена:

   * логин через Steam все равно завершается успешно
   * но **без auto-link**

---

## Основной принцип безопасности

Никнейм нужен **только для поиска кандидата**.

После того как кандидат найден, связь должна храниться уже по:

* `steamId`
* `aoeProfileId`

**Нельзя** полагаться на ник как на постоянный уникальный идентификатор.

---

## Источник данных AoE2 Insights

### Пример search URL

```text
https://www.aoe2insights.com/search/?q=AoEE.%20Tsumi
```

### Пример HTML-фрагмента результата

```html
<div class="search-results-header">
    1 result for "AoEE. Tsumi "
</div>

<div class="user-tile card">
    <div class="user-tile-body">
        <div class="user-tile-alias">aka "<mark>AoEE</mark>. <mark>Tsumi</mark>"</div>
        <a href="/user/11375082/" class="stretched-link"></a>
    </div>
    <div class="user-tile-overlay">
        <span class="user-tile-name">AoEE. Tsumi</span>
    </div>
</div>
```

### Что нужно извлечь из HTML

Из search page нужно извлечь:

* `resultsCount` → из `.search-results-header`
* `exactName` → из `.user-tile-name`
* `profileId` → из `a.stretched-link[href="/user/<id>/"]`
* `profileUrl` → собрать как `https://www.aoe2insights.com/user/<id>/`

### Для примера выше

```json
{
  "resultsCount": 1,
  "exactName": "AoEE. Tsumi",
  "profileId": "11375082",
  "profileUrl": "https://www.aoe2insights.com/user/11375082/"
}
```

---

## Нормализация nickname

Перед сравнением nickname нужно нормализовать.

### Правила нормализации

1. Удалить пробелы по краям (`trim`)
2. Схлопнуть повторяющиеся пробелы в один
3. Привести к lowercase

### Пример

```ts
"AoEE. Tsumi " -> "aoee. tsumi"
"  AoEE.   Tsumi" -> "aoee. tsumi"
```

### Helper

```ts
export function normalizeNickname(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
```

---

## Условия для auto-link

Автопривязка разрешена **только если все условия одновременно истинны**:

1. `resultsCount === 1`
2. `exactName` найден
3. `profileId` найден
4. `normalizeNickname(exactName) === normalizeNickname(steamNickname)`
5. `profileId` существует в базе **AoE Estonia**
6. `profileId` еще не привязан к другому `user`
7. `steamId` еще не привязан к другому `user`

---

## Когда auto-link запрещен

### Сценарий 1: результатов 0

```text
AoE2 Insights search returned 0 results
```

**Результат:**

* Steam login успешен
* auto-link не выполняется

### Сценарий 2: результатов больше 1

```text
AoE2 Insights search returned 3 results
```

**Результат:**

* матч неоднозначен
* auto-link не выполняется

### Сценарий 3: найден 1 результат, но nickname отличается

Пример:

* Steam nickname: `AoEE. Tsumi`
* AoE2 result name: `AoEE Tsumi`

Даже если визуально похоже, это **не exact match** по заданной строгой логике.

**Результат:**

* auto-link не выполняется

### Сценарий 4: `profileId` найден, но отсутствует в базе AoE Estonia

Это значит, что профиль существует на AoE2 Insights, но не зарегистрирован в вашей внутренней базе игроков.

**Результат:**

* auto-link не выполняется

### Сценарий 5: `profileId` уже привязан к другому user

**Результат:**

* auto-link не выполняется
* логируется причина конфликта

### Сценарий 6: `steamId` уже привязан к другому user

**Результат:**

* auto-link не выполняется
* логируется причина конфликта

### Сценарий 7: AoE2 Insights временно недоступен

Например:

* HTTP 403
* HTTP 429
* HTTP 500
* Cloudflare challenge
* timeout

**Результат:**

* Steam login все равно должен завершиться успешно
* auto-link просто пропускается

---

## Flow по шагам

### Шаг 1. Получить steamId после OpenID callback

После подтверждения OpenID backend извлекает `steamId`.

Пример:

```ts
const steamId = extractSteamIdFromClaimedId(openid.claimed_id);
```

Где `claimed_id` выглядит так:

```text
https://steamcommunity.com/openid/id/76561199214506931
```

Helper:

```ts
export function extractSteamIdFromClaimedId(claimedId: string): string | null {
  const match = claimedId.match(/\/openid\/id\/(\d+)$/);
  return match ? match[1] : null;
}
```

---

### Шаг 2. Получить Steam nickname

OpenID обычно дает гарантированно `steamId`, но не всегда nickname.

Поэтому nickname лучше получать отдельным запросом к Steam Web API.

Ожидаемый результат:

```json
{
  "steamId": "76561199214506931",
  "steamNickname": "AoEE. Tsumi"
}
```

---

### Шаг 3. Выполнить поиск на AoE2 Insights

```ts
const searchUrl = `https://www.aoe2insights.com/search/?q=${encodeURIComponent(steamNickname)}`;
```

Пример:

```text
https://www.aoe2insights.com/search/?q=AoEE.%20Tsumi
```

---

### Шаг 4. Распарсить HTML результата

Для parsing использовать **cheerio**.

**Не использовать** хрупкий regex по всему HTML-документу.

---

### Шаг 5. Проверить exact match

```ts
const isExactMatch =
  !!parsed.exactName &&
  normalizeNickname(parsed.exactName) === normalizeNickname(steamNickname);
```

---

### Шаг 6. Проверить наличие игрока в базе AoE Estonia

Пример сущности игрока:

```ts
const aoePlayer = await prisma.aoePlayer.findUnique({
  where: { aoeProfileId: parsed.profileId },
});
```

Если `aoePlayer == null`, значит такой игрок не зарегистрирован во внутренней базе.

---

### Шаг 7. Проверить конфликты привязки

#### Проверка по aoeProfileId

```ts
const existingUserByAoe = await prisma.user.findFirst({
  where: { aoeProfileId: parsed.profileId },
});
```

#### Проверка по steamId

```ts
const existingUserBySteam = await prisma.user.findFirst({
  where: { steamId },
});
```

---

### Шаг 8. Привязать аккаунт

Если все проверки пройдены:

```ts
await prisma.user.update({
  where: { id: user.id },
  data: {
    steamId,
    steamNickname,
    aoeProfileId: parsed.profileId,
    aoeProfileUrl: parsed.profileUrl,
    aoeNickname: parsed.exactName,
    aoeLinkedAt: new Date(),
  },
});
```

---

## Рекомендуемая схема БД

### Таблица `users`

Пример полей:

```prisma
model User {
  id            String    @id @default(cuid())
  email         String?   @unique
  passwordHash  String?

  steamId       String?   @unique
  steamNickname String?

  aoeProfileId  String?
  aoeProfileUrl String?
  aoeNickname   String?
  aoeLinkedAt   DateTime?

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

### Таблица игроков AoE Estonia

```prisma
model AoePlayer {
  id           String @id @default(cuid())
  aoeProfileId String @unique
  nickname     String

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

---

## Helper для парсинга search page

```ts
import * as cheerio from 'cheerio';

export type ParsedAoeSearchResult = {
  resultsCount: number;
  exactName: string | null;
  profileId: string | null;
  profileUrl: string | null;
};

export function parseAoe2InsightsSearch(html: string): ParsedAoeSearchResult {
  const $ = cheerio.load(html);

  const headerText = $('.search-results-header').first().text().trim();
  let resultsCount = 0;

  const matchCount = headerText.match(/(\d+)\s+result/i);
  if (matchCount) {
    resultsCount = Number(matchCount[1]);
  }

  const firstTile = $('.user-tile').first();

  if (!firstTile.length) {
    return {
      resultsCount,
      exactName: null,
      profileId: null,
      profileUrl: null,
    };
  }

  const exactName = firstTile.find('.user-tile-name').first().text().trim() || null;
  const href = firstTile.find('a.stretched-link').attr('href') || null;

  let profileId: string | null = null;
  let profileUrl: string | null = null;

  if (href) {
    const idMatch = href.match(/\/user\/(\d+)\/?/);
    if (idMatch) {
      profileId = idMatch[1];
      profileUrl = `https://www.aoe2insights.com/user/${profileId}/`;
    }
  }

  return {
    resultsCount,
    exactName,
    profileId,
    profileUrl,
  };
}
```

---

## Helper для нормализации nickname

```ts
export function normalizeNickname(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
```

---

## Основной сервис auto-link

Ниже пример fail-safe логики.

```ts
type AutoLinkResult =
  | { ok: true; linked: true; aoeProfileId: string }
  | { ok: true; linked: false; reason: string }
  | { ok: false; linked: false; reason: string };

export async function tryAutoLinkSteamToAoe(params: {
  userId: string;
  steamId: string;
  steamNickname: string;
  prisma: any;
}): Promise<AutoLinkResult> {
  const { userId, steamId, steamNickname, prisma } = params;

  try {
    const searchUrl = `https://www.aoe2insights.com/search/?q=${encodeURIComponent(steamNickname)}`;

    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      return { ok: true, linked: false, reason: `aoe_search_http_${response.status}` };
    }

    const html = await response.text();
    const parsed = parseAoe2InsightsSearch(html);

    if (parsed.resultsCount !== 1) {
      return { ok: true, linked: false, reason: `results_count_${parsed.resultsCount}` };
    }

    if (!parsed.exactName || !parsed.profileId || !parsed.profileUrl) {
      return { ok: true, linked: false, reason: 'missing_parsed_fields' };
    }

    const isExactMatch =
      normalizeNickname(parsed.exactName) === normalizeNickname(steamNickname);

    if (!isExactMatch) {
      return { ok: true, linked: false, reason: 'nickname_not_exact_match' };
    }

    const aoePlayer = await prisma.aoePlayer.findUnique({
      where: { aoeProfileId: parsed.profileId },
    });

    if (!aoePlayer) {
      return { ok: true, linked: false, reason: 'aoe_profile_not_in_internal_db' };
    }

    const existingUserByAoe = await prisma.user.findFirst({
      where: {
        aoeProfileId: parsed.profileId,
        NOT: { id: userId },
      },
    });

    if (existingUserByAoe) {
      return { ok: true, linked: false, reason: 'aoe_profile_already_linked' };
    }

    const existingUserBySteam = await prisma.user.findFirst({
      where: {
        steamId,
        NOT: { id: userId },
      },
    });

    if (existingUserBySteam) {
      return { ok: true, linked: false, reason: 'steam_already_linked' };
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        steamId,
        steamNickname,
        aoeProfileId: parsed.profileId,
        aoeProfileUrl: parsed.profileUrl,
        aoeNickname: parsed.exactName,
        aoeLinkedAt: new Date(),
      },
    });

    return {
      ok: true,
      linked: true,
      aoeProfileId: parsed.profileId,
    };
  } catch (error) {
    return { ok: false, linked: false, reason: 'unexpected_error' };
  }
}
```

---

## Пример логирования

Логи должны быть подробными и понятными.

### Успешный сценарий

```text
[steam-auth] callback success steamId=76561199214506931
[steam-auth] resolved steamNickname="AoEE. Tsumi"
[steam-auth] aoe search url=https://www.aoe2insights.com/search/?q=AoEE.%20Tsumi
[steam-auth] parsed resultsCount=1 exactName="AoEE. Tsumi" profileId=11375082
[steam-auth] internal aoe player found profileId=11375082
[steam-auth] auto-link success userId=cmmg83ll4000004x34jri8t7z aoeProfileId=11375082
```

### Неуспешный сценарий

```text
[steam-auth] callback success steamId=76561199214506931
[steam-auth] resolved steamNickname="AoEE. Tsumi"
[steam-auth] aoe search url=https://www.aoe2insights.com/search/?q=AoEE.%20Tsumi
[steam-auth] parsed resultsCount=3 exactName="AoEE. Tsumi" profileId=11375082
[steam-auth] auto-link skipped reason=results_count_3
```

---

## Поведение API после Steam login

### Вариант 1: auto-link успешен

```json
{
  "user": {
    "id": "cmmg83ll4000004x34jri8t7z",
    "steamId": "76561199214506931",
    "steamNickname": "AoEE. Tsumi",
    "aoeProfileId": "11375082",
    "aoeProfileUrl": "https://www.aoe2insights.com/user/11375082/",
    "aoeNickname": "AoEE. Tsumi",
    "aoeLinkedAt": "2026-03-08T10:00:00.000Z"
  },
  "autoLinked": true
}
```

### Вариант 2: Steam login успешен, но auto-link не сработал

```json
{
  "user": {
    "id": "cmmg83ll4000004x34jri8t7z",
    "steamId": "76561199214506931",
    "steamNickname": "AoEE. Tsumi",
    "aoeProfileId": null,
    "aoeProfileUrl": null,
    "aoeNickname": null,
    "aoeLinkedAt": null
  },
  "autoLinked": false,
  "reason": "aoe_profile_not_in_internal_db"
}
```

---

## Что показать на frontend

### Если auto-link успешен

Показать обычный успешный вход.

Пример:

```text
Steam account successfully linked to your AoE profile.
```

### Если auto-link не сработал

Пользователь все равно должен быть залогинен, но интерфейс может показать мягкое уведомление.

Пример:

```text
We logged you in via Steam, but could not automatically match your AoE profile.
```

Можно предложить ручную привязку позже.

---

## Edge cases

### 1. У Steam nickname меняется

Это нормально. После уже созданной связи система должна опираться на:

* `steamId`
* `aoeProfileId`

А не на текущий nickname.

### 2. На AoE2 Insights nickname тоже меняется

Это тоже нормально. После установленной связи решающим остается `aoeProfileId`.

### 3. Cloudflare / anti-bot защита

AoE2 Insights может отдавать:

* challenge page
* 403
* неполный HTML

Поэтому auto-link должен быть **best effort**, но не критичным для самого входа.

### 4. Поиск может отдавать визуально одинаковый результат с лишними пробелами

Эта проблема решается нормализацией.

### 5. Символы вроде точек, дефисов, подчеркиваний

Если нужна строгая безопасность — сравнивать их **как есть**, без удаления символов.

То есть:

* `AoEE. Tsumi` != `AoEE Tsumi`
* `AoEE_Tsumi` != `AoEE. Tsumi`

Это уменьшает риск ложных совпадений.

---

## Что НЕ делать

### Не делать так

```ts
if (parsed.resultsCount > 0) {
  // берем первый результат и линкуем
}
```

Это опасно.

### Не делать fuzzy matching по умолчанию

Например:

* levenshtein
* includes
* startsWith
* contains

Для auto-link это слишком рискованно.

### Не падать всем Steam login flow из-за AoE2 Insights

Даже если поиск сломался, Steam login должен завершиться.

---

## Рекомендуемая архитектура файлов

```text
src/
  modules/
    auth/
      auth.controller.ts
      auth.service.ts
      steam-auth.service.ts
      steam-autolink.service.ts
  services/
    aoe2insights/
      aoe2insights.service.ts
      aoe2insights.parser.ts
  utils/
    normalizeNickname.ts
    extractSteamIdFromClaimedId.ts
```

---

## Пример разбиения по сервисам

### `steam-auth.service.ts`

Отвечает за:

* Steam OpenID callback
* получение `steamId`
* получение `steamNickname`

### `aoe2insights.service.ts`

Отвечает за:

* HTTP-запрос на search page
* возврат HTML

### `aoe2insights.parser.ts`

Отвечает за:

* разбор HTML через cheerio

### `steam-autolink.service.ts`

Отвечает за:

* все проверки
* матчинг
* обновление пользователя

---

## Минимальный алгоритм в псевдокоде

```text
onSteamCallback():
  verifyOpenId()
  steamId = extractSteamId()
  steamNickname = getSteamNickname(steamId)

  user = findOrCreateUserBySteamIdOrSession()

  result = tryAutoLinkSteamToAoe(user.id, steamId, steamNickname)

  createSessionOrJwt(user)
  redirectToFrontend()
```

---

## Пример reason-кодов

Полезно стандартизировать причины, почему auto-link не сработал.

```ts
export type AutoLinkSkipReason =
  | 'aoe_search_http_403'
  | 'aoe_search_http_429'
  | 'aoe_search_http_500'
  | 'results_count_0'
  | 'results_count_2'
  | 'results_count_3'
  | 'missing_parsed_fields'
  | 'nickname_not_exact_match'
  | 'aoe_profile_not_in_internal_db'
  | 'aoe_profile_already_linked'
  | 'steam_already_linked'
  | 'unexpected_error';
```

---

## Тест-кейсы

### Test 1 — happy path

**Input:**

* steamNickname = `AoEE. Tsumi`
* parsed.resultsCount = `1`
* parsed.exactName = `AoEE. Tsumi`
* parsed.profileId = `11375082`
* `11375082` существует в БД
* профиль не привязан

**Expected:**

* auto-link success

---

### Test 2 — лишний пробел

**Input:**

* steamNickname = `AoEE. Tsumi `
* parsed.exactName = `AoEE. Tsumi`

**Expected:**

* после нормализации матч считается exact
* auto-link success

---

### Test 3 — нет результатов

**Input:**

* parsed.resultsCount = `0`

**Expected:**

* auto-link skipped
* Steam login success

---

### Test 4 — несколько результатов

**Input:**

* parsed.resultsCount = `2`

**Expected:**

* auto-link skipped

---

### Test 5 — nickname отличается

**Input:**

* steamNickname = `AoEE. Tsumi`
* parsed.exactName = `AoEE Tsumi`

**Expected:**

* auto-link skipped with `nickname_not_exact_match`

---

### Test 6 — player не найден в internal DB

**Input:**

* parsed.profileId = `11375082`
* `aoePlayer.findUnique(...)` returns `null`

**Expected:**

* auto-link skipped with `aoe_profile_not_in_internal_db`

---

### Test 7 — aoe profile already linked

**Input:**

* другой user уже имеет `aoeProfileId = 11375082`

**Expected:**

* auto-link skipped with `aoe_profile_already_linked`

---

### Test 8 — aoe2insights temporary failure

**Input:**

* fetch throws timeout / 403 / 500

**Expected:**

* Steam login success
* auto-link skipped

---

## Итог

Идея flow правильная:

**Steam nickname → AoE2 Insights search → exact single result → extract aoeProfileId → verify in AoE Estonia DB → auto-link**

Но этот flow должен быть:

* строгим,
* fail-safe,
* без fuzzy matching,
* без падения всего логина, если AoE2 Insights временно не отвечает.

---

## Краткая формулировка для команды

> После логина через Steam backend получает steamId и steamNickname, ищет nickname на AoE2 Insights, извлекает profileId только при одном точном результате, проверяет наличие этого profileId во внутренней базе AoE Estonia и отсутствие конфликтов привязки, после чего автоматически связывает Steam-аккаунт с AoE-профилем. Если хотя бы одна проверка не проходит, пользователь все равно успешно логинится через Steam, но без auto-link.
