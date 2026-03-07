# Response to `frontend/login.md`

This document is a structured, implementation-oriented response to the current state and next safe steps, based on:
- the content of `frontend/login.md`
- the already performed project analysis (see `AUTH_AOE2INSIGHTS_ANALYSIS_REPORT.md`)
- the actual repository state at the moment (frontend Next.js + backend Express + Prisma + sessions)

> Constraint honored: **no code changes proposed as immediate edits here**. This is analysis + safe plan.

---

## 1) CURRENT PROJECT STATE

### Architecture (as-is)
- Monorepo layout already exists:
  - `frontend/`: Next.js App Router UI (map, admin, login/register) + a couple of Next Route Handlers for server-side proxying/parsing.
  - `backend/`: Express API server under `/api/*`, Prisma + Postgres, cookie-based sessions.

### Auth (as-is)
- **Credentials auth (email/password)**
  - `POST /api/auth/register`: creates `users` row with `password_hash`.
  - `POST /api/auth/login`: validates password, creates `sessions` row, sets **HttpOnly cookie**.
  - `POST /api/auth/logout`: revokes session + clears cookie.
  - `GET /api/auth/me`: returns `{ user }` from `attachUser` middleware.

- **Steam auth (OpenID)**
  - Frontend links to backend `GET /api/auth/steam`.
  - Backend performs OpenID redirect and callback validation.
  - Backend finds/creates user via `accounts(provider='steam', provider_account_id=steamId)`.
  - Backend creates a session (same cookie model).

### Map storage (as-is)
- Backend provides map endpoints (e.g. `PUT /api/maps/default`) protected by `requireRole('ADMIN')`.
- Frontend uses `NEXT_PUBLIC_BACKEND_API_BASE` for API calls.

### AoE2Insights auto-linking (as-is)
- Backend has best-effort auto-linking after Steam login:
  - Steam persona name is fetched via Steam Web API (env `STEAM_WEB_API_KEY`).
  - AoE2Insights search HTML is parsed server-side (cheerio) to find an exact match.
  - If exact match found, it writes these optional fields onto `User`:
    - `aoeProfileId`, `aoeProfileUrl`, `aoeNickname`, `aoeLinkedAt`.
  - Must not break login if external services fail.

### Frontend routing (as-is)
- Next.js **App Router**.
- `/login` and `/register` exist.
- `/` is auth-gated (redirect to `/login` if not authenticated).
- `/admin` has been updated to also be auth-gated and require `ADMIN` role before initializing the admin editor.

---

## 2) FOUND FILES

### Backend
- `backend/src/app.ts`
  - Express app wiring: CORS, JSON parsing, global `attachUser`, routes under `/api`.
- `backend/src/middleware/auth.ts`
  - `attachUser`, `requireAuth`, `requireRole`.
- `backend/src/routes/authRoutes.ts`
  - `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/steam`, `/auth/steam/callback`.
- `backend/src/controllers/authController.ts`
  - Credentials login/register/logout + cookie set/clear.
- `backend/src/services/authService.ts`
  - Core auth domain logic; `toPublicUser()` shapes `/auth/me` response.
  - Extended to include AoE2Insights fields.
- `backend/src/repositories/authRepository.ts`
  - User/session/account queries + Steam helpers.
  - Has a method to persist AoE2Insights link onto user.
- `backend/src/steam/routes.ts`
  - Steam OpenID start/callback, session creation.
  - Hooks in best-effort AoE2Insights auto-link.
- `backend/src/services/steamService.ts`
  - Steam Web API profile summary lookup; returns `personaname` best-effort.
- `backend/src/services/aoe2insightsService.ts`
  - AoE2Insights search HTML parsing; exact match logic.
- `backend/prisma/schema.prisma`
  - Models: `User`, `Session`, `Account`, `MapState`, `MapBuilding`, `MapPlayer`.
  - `User` includes AoE2Insights optional fields.
- `backend/prisma/migrations/20260307104143_add_user_aoe2insights_fields/migration.sql`
  - Adds AoE2Insights columns to `users`.

### Frontend
- `frontend/src/lib/api/auth.ts`
  - `me/login/register/logout`, always uses `credentials: 'include'`.
- `frontend/src/lib/api/maps.ts`
  - Map API calls; includes `credentials: 'include'`.
- `frontend/src/app/login/page.tsx`
  - Credentials login UI + “Login with Steam” link.
- `frontend/src/app/register/page.tsx`
  - Credentials register UI.
- `frontend/src/app/page.tsx`
  - Auth gate on `/`.
- `frontend/src/app/admin/page.tsx`
  - Admin editor (Pixi), now auth-gated + requires `ADMIN`.
- `frontend/src/app/api/aoe2insights/statistics/route.ts`
  - Next route handler parsing AoE2Insights statistics (cheerio). (Existing pattern for HTML parsing on the frontend server-side.)

---

## 3) CURRENT DATA MODEL

### Existing Prisma models
- `User`
  - `id`, `email?`, `displayName?`, `passwordHash?`, `role`, `isActive`, timestamps
  - **AoE2Insights optional fields**: `aoeProfileId?`, `aoeProfileUrl?`, `aoeNickname?`, `aoeLinkedAt?`
- `Account`
  - Auth provider linkage: `provider`, `providerAccountId` (unique pair), `userId`.
  - Steam identity is stored here (`provider='steam'`, `providerAccountId=steamId`).
- `Session`
  - Cookie-based sessions stored as `tokenHash` with expiration.

### What can be reused / what is missing for the new “claim player” model
- There is currently **no dedicated AoE2Insights player entity**.
- AoE2Insights is currently stored directly on `User`.

This is enough for auto-linking, but not enough for:
- pre-seeded roster of AoE2Insights players
- “unclaimed/available” list
- atomic “claim” operation that prevents two users from taking the same player

---

## 4) CURRENT AUTH FLOWS

### Email signup flow
1. `POST /api/auth/register` creates the user.
2. Frontend shows “Account created” and sends user to `/login`.
3. No session is created during register.

### Email login flow
1. `POST /api/auth/login` validates password.
2. Backend creates session row + `Set-Cookie`.
3. Frontend navigates to `next`.

### Steam login flow
1. Frontend navigates to `GET /api/auth/steam`.
2. Backend redirects to Steam OpenID.
3. Steam returns to `GET /api/auth/steam/callback`.
4. Backend validates, extracts steamId, find/create user, optionally auto-links AoE2Insights, creates session cookie.
5. Backend redirects to frontend login (configurable via `FRONTEND_BASE_URL`).

### `/api/auth/me` flow
- Backend uses `attachUser` middleware (cookie parsing + DB session lookup) and returns `{ user }`.

### Post-login redirect flow
- Frontend pages use `next` param and `router.push(nextUrl)`.
- `/` is auth-gated.
- `/admin` is auth-gated and role-gated.

---

## 5) WHAT IS ALREADY IMPLEMENTED

You do **not** need to rebuild these:
- Separate `frontend/` and `backend/` folders already exist.
- Backend has a layered structure (routes → controllers → services → repositories).
- Credentials auth (register/login/logout/me) is implemented.
- Steam OpenID auth is implemented.
- Cookie-based sessions stored hashed in DB are implemented.
- Role-based authorization exists (`requireRole('ADMIN')`) and map mutations are protected.
- AoE2Insights best-effort auto-linking after Steam login is implemented.
- Prisma schema and migrations exist; AoE2Insights user fields exist.

---

## 6) RISKS / CONSTRAINTS

- Existing users may already have AoE2Insights fields filled. Introducing a new “Player entity” must not break `/auth/me` consumers.
- Any new “claim” logic must be race-safe (two users cannot claim the same player).
- Avoid wide refactors: keep current auth/session mechanisms.
- HTML parsing dependencies (AoE2Insights) are brittle; logic must remain best-effort.
- Steam nickname is not a stable identifier; strict exact match reduces false positives but can reduce auto-link rate.

---

## 7) RECOMMENDED DATA MODEL

### Goal
Add a dedicated entity for AoE2Insights players, pre-seeded by you, with claim/ownership tracked.

### Recommended minimal Prisma models (conceptual)
Introduce a new table, e.g. `AoePlayer` (name can be `Aoe2InsightsPlayer` if you prefer explicit naming), with:
- `id` (internal cuid)
- `aoeProfileId` (unique)
- `aoeProfileUrl`
- `nickname`
- `createdAt`, `updatedAt`
- `claimedByUserId` (nullable unique) → points to `User`
- `claimedAt` (nullable)

Then connect `User` to at most one claimed player:
- Either via `User.aoePlayerId?` (FK to AoePlayer) **or** via `AoePlayer.claimedByUserId?`.

**Best option for race-safety and “unclaimed list”:**
- Keep ownership on `AoePlayer.claimedByUserId` with a **unique index** on `claimedByUserId` (optional) and a unique index on `aoeProfileId`.
- Claim operation becomes an atomic update: “set claimedByUserId where claimedByUserId IS NULL”.

### What to do with existing `User.aoeProfile*` fields
Don’t delete immediately.
- Keep them temporarily as legacy/compat.
- Later migration can backfill/link to `AoePlayer`.
- `/auth/me` can continue returning them during transition.

---

## 8) RECOMMENDED USER FLOWS

### Flow A: Email signup → claim player
1. User registers.
2. User logs in.
3. If no claimed AoE player:
   - redirect to `/claim-player`.
4. Show list of unclaimed players (paginated/search).
5. User selects a player → backend claim endpoint.
6. On success: redirect to `/` (map) and/or `/admin` depending on role.

### Flow B: Steam login → auto-match → fallback
1. Steam login succeeds.
2. Backend gets Steam nickname.
3. Backend AoE2Insights exact match returns `aoeProfileId`.
4. If the `aoeProfileId` exists in `AoePlayer` and not claimed:
   - claim automatically.
5. Otherwise:
   - login still succeeds.
   - user is redirected to manual claim flow.

### Repeat login
- If user already has claimed player, no onboarding.

### “Player already claimed”
- Backend returns a clear error code (e.g. `PLAYER_ALREADY_CLAIMED`).
- Frontend displays “already taken, choose another”.

---

## 9) SAFE BACKEND PLAN

### New endpoints (minimal)
- `GET /api/aoe-players/available?search=...&limit=...&cursor=...`
  - returns list of unclaimed players.
- `POST /api/aoe-players/claim`
  - requires auth
  - body `{ aoeProfileId }` or internal `playerId`
  - atomically claims if unclaimed

### Services/repositories
- Add repository for AoE players (or extend existing repository set minimally):
  - `findAvailable()`
  - `claimByProfileId(userId, aoeProfileId)` (atomic)

### Steam callback integration update
- Keep current AoE2Insights lookup.
- After getting exact match `aoeProfileId`:
  - attempt to claim that player in the new table.
  - if claim fails (not found / claimed) → ignore and keep login success.

### Response
- Extend `/api/auth/me` to include:
  - claimed player information (either embedded object or ids)
  - keep existing user fields for compatibility.

---

## 10) SAFE FRONTEND PLAN

### Add onboarding page
- New route: `/claim-player`
  - fetch available players
  - search/filter
  - claim action

### Routing integration
- After login (credentials/steam), redirect to `next`.
- Pages with auth gate (`/`, `/admin`) should:
  - if authed but no claimed player → redirect to `/claim-player`.
  - keep map/admin code unchanged otherwise.

### UX states
- “No available players” empty state.
- “Player claimed successfully” state.
- “Player already claimed” state.

---

## 11) MIGRATION STRATEGY

1. Introduce `AoePlayer` table and seed it (manual script/Prisma seed).
2. Add read endpoint for unclaimed players.
3. Add claim endpoint with atomic claim logic.
4. Add frontend claim page.
5. Update auth gate to require “claimed player” for normal users (optional, depending on desired restriction).
6. Update Steam callback to attempt claim.
7. Backfill:
   - For users with `User.aoeProfileId` already set, try to find matching `AoePlayer` and claim/link.
8. Later cleanup:
   - decide whether to keep or deprecate `User.aoeProfile*` fields.

---

## 12) MINIMAL SAFE IMPLEMENTATION ORDER

1. **Data model**: add `AoePlayer` table + indexes (no behavior change yet).
2. **Seeding**: add seed script/command to insert your roster.
3. **Backend read API**: list available players.
4. **Backend claim API**: atomic claim.
5. **Frontend claim page**: manual linking.
6. **Steam callback update**: attempt claim using exact match profileId.
7. **Auth gate improvements**: optionally force onboarding if no claimed player.
8. **Backfill** existing users with `User.aoeProfileId`.
9. **Cleanup** legacy fields (optional, later).
