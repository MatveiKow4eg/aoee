# Challenges History (HUD “История”) — точный контекст (frontend + backend + data model)

Цель: собрать **текущую** реализацию кнопки **«История»** вызовов в HUD, какой endpoint она вызывает, и какие backend-файлы за это отвечают. Код **не менялся** — только анализ.

---

## 0) TL;DR (самое важное)

- Кнопка **«История»** находится во фронтенде в `frontend/src/app/components/PlayerHud.tsx`.
- По клику открывается **модалка** (portal в `document.body`) внутри того же компонента `PlayerHud`.
- Для загрузки истории модалка вызывает **admin API метод** `adminListChallenges()` из `frontend/src/lib/api/challenges.ts`.
- `adminListChallenges()` делает `GET /api/admin/challenges` (опц��онально `?status=...`).
- На бэкенде это обрабатывается роутом `GET /admin/challenges` в `backend/src/routes/adminChallengeRoutes.ts`.
- Роут защищён `requireAuth()` (cookie session), а **проверка admin role** делается **внутри controller** `requireAdmin()` в `backend/src/controllers/adminChallengeController.ts`.
- Controller вызывает service: `ChallengeService.listAdminChallenges()` в `backend/src/services/challengeService.ts`.
- В базе это `prisma.userChallenge` (Prisma model `UserChallenge` в `backend/prisma/schema.prisma`).
- **Почему обычный пользователь не видит историю:** HUD использует **admin endpoint**, который возвращает 403 для `role !== 'ADMIN'`.
- При этом на бэке уже есть user endpoint: `GET /challenges/my` (frontend метод `listMyChallenges()`), но HUD его **не использует**.

---

## 1) FRONTEND

### 1.1 Где находится кнопка «История»

**Файл:** `frontend/src/app/components/PlayerHud.tsx`

**Роль файла:** HUD-панель игрока на карте. Внутри есть tools panel (Поиск/Фильтр/История) и модалки.

**Фрагмент кода (кнопка):**

```tsx
<button
  type="button"
  aria-label="History"
  title="История"
  onClick={(e) => {
    e.stopPropagation();
    openHistoryModal();
  }}
>
  ...
  <span>История</span>
</button>
```

### 1.2 Модалка/экран/VM, который открывается по кнопке

**Файл:** `frontend/src/app/components/PlayerHud.tsx`

**Роль:** модалка истории реализована прямо в `PlayerHud` через `createPortal(...)`.

- Состояния:
  - `historyModalOpen: boolean`
  - `historyExpanded: boolean`
  - `historyState: { idle | loading | ok(challenges) | error(message) }`

**Фрагмент кода (открытие модалки + загрузка):**

```tsx
const openHistoryModal = async () => {
  setHistoryExpanded(false);
  setHistoryModalOpen(true);
  setHistoryState({ status: "loading" });
  try {
    const { adminListChallenges } = await import("../../lib/api/challenges");
    const r = await adminListChallenges();
    const list = (r as any)?.challenges ?? [];
    const items = Array.isArray(list) ? list : [];
    const filtered = items.filter((ch: any) => String(ch?.status || "").toUpperCase() !== "CANCELLED");
    setHistoryState({ status: "ok", challenges: filtered });
  } catch (e: any) {
    setHistoryState({ status: "error", message: e?.message ? String(e.message) : "Failed to load history" });
  }
};
```

**Фрагмент кода (рендер модалки):**

```tsx
{historyModalOpen && typeof document !== "undefined" &&
  createPortal(
    <>
      <div onPointerDown={() => setHistoryModalOpen(false)} ... />
      <div ...>
        <div>История вызовов</div>
        ...
        {historyState.status === "ok" && historyState.challenges.map(...)}
      </div>
    </>,
    document.body
  )
}
```

### 1.3 Текущий API метод, который вызывается для загрузки истории

**Файл:** `frontend/src/lib/api/challenges.ts`

**Метод:** `adminListChallenges(status?: string)`

```ts
export async function adminListChallenges(status?: string): Promise<{ challenges: any[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return jsonFetch<{ challenges: any[] }>(`/api/admin/challenges${qs}`, { method: "GET" });
}
```

### 1.4 Файл, где объявлен `adminListChallenges()` или аналог

- `frontend/src/lib/api/challenges.ts` — содержит `adminListChallenges`, `adminResolveChallenge`, `adminCancelChallenge`, а также user методы `canChallenge`, `createChallenge`, `listMyChallenges`.

### 1.5 Тип данных, которы�� ожидает UI

**Важно:** в HUD-истории типизация **нестрогая** — используется `any`.

- `historyState` хранит `challenges: any[]`.
- `challengeVm(ch)` читает поля из `ch` и вложенных `challengerUser/targetUser`.

**Фрагмент (VM читает поля):**

```tsx
const challenger = ch?.challengerUser ?? null;
const target = ch?.targetUser ?? null;

const aName = challenger?.displayName ?? ch?.challengerUserId ?? "?";

const mapKey = typeof ch?.targetPlayerKey === "string" ? ch.targetPlayerKey.trim() : "";
const mapRec = mapKey && mapPlayers ? (mapPlayers as any)[mapKey] : null;
const mapName = mapRec ? String((mapRec as any)?.name ?? (mapRec as any)?.nickname ?? "").trim() : "";

const bName = target?.displayName ?? (mapName || null) ?? ch?.targetUserId ?? "?";

const status = String(ch?.status || "").toUpperCase();
const result = String(ch?.result || "").toUpperCase();

const ts = ch?.createdAt ? String(ch.createdAt) : "";

const ratingAppliedAt = ch?.ratingAppliedAt ?? (ch as any)?.rating_applied_at ?? null;
```

**Ожидаемая форма объекта challenge для HUD (фактически):**

- top-level:
  - `id`
  - `challengerUserId`
  - `targetUserId` (может быть null)
  - `targetPlayerKey` (может быть null; важен для unclaimed)
  - `challengerPlayerKey` (enriched админ-контроллером)
  - `status` (`ACTIVE|COMPLETED|EXPIRED|CANCELLED`)
  - `result` (`CHALLENGER_WON|CHALLENGER_LOST|DRAW|NO_SHOW`)
  - `createdAt`
  - `ratingAppliedAt` (для отображения дельт)
- relations (если include на бэке):
  - `challengerUser: { id, displayName, email? }`
  - `targetUser: { id, displayName, email? }`

**Примечание:** UI также пытается использовать `winnerUserId/loserUserId`, но в HUD-рендере они напрямую не обязательны; важнее `status/result/ratingAppliedAt`.

---

## 2) BACKEND

### 2.1 Routes файлы, связанные с challenges

1) `backend/src/routes/challengeRoutes.ts`
- **Роль:** user endpoints (auth required)
- Роуты:
  - `GET /challenges/can-challenge/:targetUserId`
  - `POST /challenges`
  - `GET /challenges/my`

Фрагмент:
```ts
challengeRoutes.get('/challenges/can-challenge/:targetUserId', limiter, requireAuth(), getCanChallenge);
challengeRoutes.post('/challenges', limiter, requireAuth(), postCreateChallenge);
challengeRoutes.get('/challenges/my', limiter, requireAuth(), getMyChallenges);
```

2) `backend/src/routes/adminChallengeRoutes.ts`
- **Роль:** admin endpoints (auth required + admin check в controller)
- Роуты:
  - `GET /admin/challenges`
  - `POST /admin/challenges/:id/resolve`
  - `POST /admin/challenges/:id/cancel`
  - `GET /admin/cooldowns`
  - `POST /admin/cooldowns/:userId/clear`

Фрагмент:
```ts
adminChallengeRoutes.get('/admin/challenges', adminLimiter, requireAuth(), getAdminChallenges);
```

3) `backend/src/routes/index.ts`
- **Роль:** подключение роутов к express app.
- Важно: роуты монтируются и с `/v1`, и без него.

Фрагмент (из результатов поиска):
- `apiRoutes.use('/v1', challengeRoutes);`
- `apiRoutes.use('/v1', adminChallengeRoutes);`
- `apiRoutes.use(challengeRoutes);`
- `apiRoutes.use(adminChallengeRoutes);`

Это означает, что endpoint может быть доступен как:
- `/api/admin/challenges` (если префикс `/api` добавляется на уровне app)
- и/или `/api/v1/admin/challenges` (если фронт использует v1)

Фронт сейчас вызывает **`/api/admin/challenges`**.

### 2.2 Controller для challenges

1) User controller: `backend/src/controllers/challengeController.ts`
- `getCanChallenge`
- `postCreateChallenge`
- `getMyChallenges`

2) Admin controller: `backend/src/controllers/adminChallengeController.ts`
- `getAdminChallenges`
- `postAdminResolveChallenge`
- `postAdminCancelChallenge`
- `getAdminCooldownUsers`
- `postAdminClearCooldown`

### 2.3 Service для challenges

**Файл:** `backend/src/services/challengeService.ts`

**Роль:** бизнес-логика challenges:
- expiry
- canChallenge
- createChallenge
- listMyChallenges
- listAdminChallenges
- resolveChallenge
- cancelChallenge

### 2.4 Admin endpoint, который сейчас используется фронтом

**Frontend:** `adminListChallenges()` -> `GET /api/admin/challenges`

**Backend route:** `GET /admin/challenges` (в `adminChallengeRoutes.ts`)

**Controller:** `getAdminChallenges` (в `adminChallengeController.ts`)

**Service:** `ChallengeService.listAdminChallenges()`

### 2.5 Middleware/guard, который проверяет admin role

Фактическая проверка admin сейчас **не в middleware**, а в controller:

**Файл:** `backend/src/controllers/adminChallengeController.ts`

```ts
function requireAdmin(req: any) {
  const user = req?.user;
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
  if (user.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Admin only');
  return user;
}
```

При этом есть общий middleware `requireRole(role)`:

**Файл:** `backend/src/middleware/auth.ts`

```ts
export function requireRole(role: string): RequestHandler {
  return (req, res, next) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    if (user.role !== role) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    next();
  };
}
```

Но `adminChallengeRoutes.ts` его **не использует**, использует только `requireAuth()`.

### 2.6 Есть ли уже обычный user-auth endpoint для списка challenges

Да.

- **Route:** `GET /challenges/my` (`backend/src/routes/challengeRoutes.ts`)
- **Controller:** `getMyChallenges` (`backend/src/controllers/challengeController.ts`)
- **Service:** `ChallengeService.listMyChallenges(userId, ...)`

`listMyChallenges` возвращает challenges, где пользователь либо challenger, либо target:

```ts
const where: any = {
  OR: [{ challengerUserId: userId }, { targetUserId: userId }],
};
...
return prisma.userChallenge.findMany({
  where,
  orderBy: { createdAt: 'desc' },
  include: {
    challengerUser: { select: { id: true, displayName: true } },
    targetUser: { select: { id: true, displayName: true } },
  },
});
```

---

## 3) МОДЕЛЬ ДАННЫХ

### 3.1 Prisma model / entity / type для challenges

**Файл:** `backend/prisma/schema.prisma`

**Model:** `UserChallenge`

Ключевые поля:
- `id: String`
- `challengerUserId: String`
- `targetUserId: String?`
- `targetPlayerKey: String?`
- `targetAoeProfileId: String?`
- `challengerPlayerKey: String?`
- `winnerPlayerKey: String?`
- `loserPlayerKey: String?`
- `status: ChallengeStatus`
- `result: ChallengeResult?`
- `createdAt: DateTime`
- `acceptedAt: DateTime`
- `expiresAt: DateTime`
- `resolvedAt: DateTime?`
- `resolvedByUserId: String?`
- `winnerUserId: String?`
- `loserUserId: String?`
- `ratingAppliedAt: DateTime?`
- `notes: String?`

Relations:
- `challengerUser: User`
- `targetUser: User?`
- `resolvedByUser: User?`

### 3.2 Какие поля используются на фронте для истории

HUD (`PlayerHud.tsx`) использует/читает:

- `challengerUserId` ✅
- `targetUserId` ✅ (может быть null)
- `challengerUser` ✅ (displayName, avatarUrl опционально)
- `targetUser` ✅ (displayName)
- `targetPlayerKey` ✅ (для unclaimed targets; мапится на `mapPlayers[u005]`)
- `status` ✅
- `createdAt` ✅
- `completedAt` ❌ (в модели нет; эквивалент: `resolvedAt` + `status=COMPLETED`)
- `cancelledAt` ❌ (в модели нет; эквивалент: `resolvedAt` + `status=CANCELLED`)
- `winnerUserId` (в HUD напрямую не обязателен, но есть в модели) ✅

Дополнительно важные для UI поля:
- `result` (для Win/Loss) ✅
- `ratingAppliedAt` (чтобы показывать дельты) ✅
- `challengerPlayerKey` (enriched админ-контроллером; для аватарок `/people/uXXX.png`) ✅

---

## 4) Полный текущий call chain (как есть сейчас)

### 4.1 HUD “История вызовов” (то, что вы просили)

1) **Кнопка**
- `frontend/src/app/components/PlayerHud.tsx`
- onClick -> `openHistoryModal()`

2) **Модалка/VM**
- `openHistoryModal()` внутри `PlayerHud.tsx`
- грузит данные и кладёт в `historyState`

3) **Frontend API method**
- динамический импорт `../../lib/api/challenges`
- вызов `adminListChallenges()`

4) **HTTP endpoint**
- `GET /api/admin/challenges`

5) **Backend route**
- `backend/src/routes/adminChallengeRoutes.ts`

```ts
adminChallengeRoutes.get('/admin/challenges', adminLimiter, requireAuth(), getAdminChallenges);
```

6) **Backend controller**
- `backend/src/controllers/adminChallengeController.ts`
- `getAdminChallenges`
  - `requireAdmin(req)` (роль ADMIN)
  - `challengeService.listAdminChallenges({ status })`
  - enrich: добавляет `challengerPlayerKey` и `targetPlayerKey` (если можно)

7) **Backend service**
- `backend/src/services/challengeService.ts`
- `listAdminChallenges(filter)` -> `prisma.userChallenge.findMany({ include: ... })`

8) **DB**
- Prisma model `UserChallenge` (`backend/prisma/schema.prisma`)

---

## 5) Отдельные ответы на ваши пункты

### (а) Почему обычный пользователь не видит историю

Потому что HUD-история сейчас грузится через **admin endpoint**:
- фронт: `adminListChallenges()` -> `GET /api/admin/challenges`
- бэк: `getAdminChallenges` вызывает `requireAdmin()`, который проверяет `user.role === 'ADMIN'`
- для обычного пользователя будет `403 FORBIDDEN (Admin only)`.

То есть проблема не в UI-скрытии кнопки, а в том, что endpoint недоступен.

### (б) Можно ли переиспользовать существующий user endpoint

Да, частично.

Уже есть:
- `GET /challenges/my` (auth required)
- service: `listMyChallenges(userId)` возвращает только те challenges, где пользователь участник (challenger или target).

Но есть нюансы относительно текущего HUD-рендера:
- HUD сейчас ожидает (и использует) `targetPlayerKey` для unclaimed targets — **это поле есть в модели** и будет возвращаться.
- `listMyChallenges` включает `challengerUser` и `targetUser` (displayName), но **не делает enrich** `challengerPlayerKey/targetPlayerKey` через map payload как admin controller.
  - Однако `targetPlayerKey` в БД уже хранится (если challenge создавался по playerKey/aoeProfileId), так что для unclaimed целей UI может отрендерить имя через `mapPlayers[targetPlayerKey]`.
  - `challengerPlayerKey` для аватарки в HUD может отсутствовать (в БД он тоже есть как `challengerPlayerKey`, но заполняется best-effort при создании challenge; не гарантирован).

Итого: endpoint `GET /challenges/my` **логически подходит** для “истор��и пользователя”, но UI сейчас вызывает не его.

### (в) Если нельзя — какой новый endpoint лучше добавить с минимальным риском

Если цель — **история вызовов конкретного пользователя** (а не “все вызовы в системе”), то самый низкорисковый путь:

1) **Переиспользовать `GET /challenges/my`** и/или добавить новый user endpoint, который по сути является “read-only view”:

- Вариант A (минимум изменений в API):
  - использовать существующий `GET /challenges/my` во фронте для HUD-истории.

- Вариант B (минимальный риск, но новый endpoint):
  - добавить `GET /challenges/history` (auth required)
  - внутри: `listMyChallenges(user.id, { includeCompleted: true })` + возможно лёгкий enrich (playerKey) аналогично admin, но только для текущего пользователя.

Почему это минимальный риск:
- не трогает admin endpoints
- не раскрывает чужие challenges
- использует уже существующую модель и service-логику

Если же нужна “глобальная история всех challenges” — это по определению admin-only.

---

## 6) Список релевантных файлов (с ролями)

### Frontend
- `frontend/src/app/components/PlayerHud.tsx`
  - кнопка «История»
  - модалка «История вызовов»
  - загрузка через `adminListChallenges()`
  - VM `challengeVm(ch)` — как UI интерпретирует данные

- `frontend/src/lib/api/challenges.ts`
  - `adminListChallenges()` -> `GET /api/admin/challenges`
  - `listMyChallenges()` -> `GET /api/challenges/my`
  - тип `Challenge` (частично соответствует DB, но не включает playerKey-поля)

- `frontend/src/app/admin/challenges/page.tsx`
  - админ-страница challenges, тоже использует `adminListChallenges()`

### Backend
- `backend/src/routes/adminChallengeRoutes.ts`
  - роут `GET /admin/challenges` (используется HUD-историей)

- `backend/src/controllers/adminChallengeController.ts`
  - `getAdminChallenges`
  - `requireAdmin()` (проверка роли ADMIN)
  - enrich: добавляет `challengerPlayerKey/targetPlayerKey` для UI

- `backend/src/services/challengeService.ts`
  - `listAdminChallenges()`
  - `listMyChallenges()`

- `backend/src/routes/challengeRoutes.ts`
  - user endpoint `GET /challenges/my`

- `backend/src/controllers/challengeController.ts`
  - `getMyChallenges`

- `backend/src/middleware/auth.ts`
  - `requireAuth()`
  - `requireRole(role)` (есть, но не используется в adminChallengeRoutes)

### Data model
- `backend/prisma/schema.prisma`
  - `model UserChallenge`
  - enums `ChallengeStatus`, `ChallengeResult`

---

## 7) Примечания по несоответствиям полей (важно для истории)

Вы перечислили поля:
- `completedAt`, `cancelledAt`

В текущей Prisma-модели таких полей **нет**.

Эквиваленты:
- `completedAt` ≈ `resolvedAt` при `status=COMPLETED`
- `cancelledAt` ≈ `resolvedAt` при `status=CANCELLED`

UI в HUD сейчас показывает время по `createdAt` (переменная `ts = ch.createdAt`).

---

## 8) Что реально участвует в загрузке истории (минимальный набор фрагментов)

### Frontend: кнопка -> openHistoryModal -> adminListChallenges
- `frontend/src/app/components/PlayerHud.tsx`:
  - `openHistoryModal()`
  - `import("../../lib/api/challenges")`
  - `adminListChallenges()`

### Frontend API: adminListChallenges -> GET /api/admin/challenges
- `frontend/src/lib/api/challenges.ts`:
  - `adminListChallenges()`

### Backend: route -> controller -> service -> prisma
- `backend/src/routes/adminChallengeRoutes.ts`:
  - `GET /admin/challenges` -> `getAdminChallenges`

- `backend/src/controllers/adminChallengeController.ts`:
  - `requireAdmin()`
  - `challengeService.listAdminChallenges()`

- `backend/src/services/challengeService.ts`:
  - `listAdminChallenges()` -> `prisma.userChallenge.findMany({ include: ... })`

- `backend/prisma/schema.prisma`:
  - `model UserChallenge`
