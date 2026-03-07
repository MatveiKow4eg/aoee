Твоя задача — НЕ писать код сразу. 
Сначала тебе нужно полностью понять текущее состояние проекта, что уже реализовано, какие изменения уже внесены, и только потом предложить безопасный план следующего этапа.

КОНТЕКСТ ЗАДАЧИ

Сейчас в проекте уже есть:
1. Обычная регистрация / логин по email
2. Логин через Steam
3. В backend уже добавлялась логика автопоиска AoE2Insights профиля по Steam nickname
4. В User уже добавлены optional поля:
   - aoeProfileId
   - aoeProfileUrl
   - aoeNickname
   - aoeLinkedAt
5. В backend уже есть сервисы:
   - steamService.ts
   - aoe2insightsService.ts
6. Steam auth сейчас живёт в backend Express, а не во frontend
7. Нужно переосмыслить архитектуру и перейти к более правильной модели:
   - у нас будет отдельная сущность игроков AoE2Insights
   - я заранее занесу туда всех игроков
   - email-пользователь сможет выбрать из списка незанятых игроков и привязать аккаунт
   - Steam-пользователь будет пытаться матчиться автоматически через AoE2Insights search по имени
   - если найденный aoeProfileId уже есть в нашей базе игроков и ещё не занят, он привязывается к пользователю
   - если не найден / занят / нет exact match, пользователь потом сможет выбрать игрока вручную

ВАЖНО:
сначала тебе нужно понять, как проект устроен СЕЙЧАС, а не предлагать новую архитектуру вслепую.

================================
PHASE 1 — ПОЛНЫЙ АНАЛИЗ ТЕКУЩЕГО СОСТОЯНИЯ
================================

Сначала исследуй проект и дай полный отчёт по текущему состоянию.

Найди и проанализируй:

1. Все auth-related файлы
Ищи всё, что связано с:
- login
- register
- auth
- session
- cookies
- me
- logout
- middleware
- protected routes
- steam
- openid
- callback
- current user

Проверь:
- backend auth routes
- backend auth services
- steam routes
- user/session middleware
- frontend auth pages
- frontend auth hooks/providers
- frontend me-fetching

2. Все Prisma модели и связи
Проверь:
- User
- Account
- Session
- всё, что уже связано с external auth
- есть ли уже сущности под игроков, профили, участников и т.д.
- какие поля уже добавлены в User для AoE2Insights
- какие migration уже были созданы

3. Уже внесённые изменения по AoE2Insights
Найди:
- aoe2insightsService.ts
- steamService.ts
- все места, где используются aoeProfileId / aoeProfileUrl / aoeNickname / aoeLinkedAt
- как сейчас идёт автопривязка в steam callback
- что уже возвращает /api/auth/me

4. Frontend flow
Определи:
- как сейчас выглядит экран логина/регистрации
- как пользователь попадает в систему
- есть ли отдельные страницы для onboarding
- куда редиректится пользователь после обычной регистрации
- куда редиректится после Steam login
- где лучше встроить страницу выбора игрока

5. Все существующие patterns проекта
Найди:
- как устроены repositories
- как устроены services
- где располагаются route handlers
- есть ли DTO / validators / zod / schemas
- какие conventions используются для response shape
- как обрабатываются ошибки
- как называются сущности и связи
- есть ли admin pages / management pages

6. Проверить, есть ли уже похожая сущность, которую можно переиспользовать
Например:
- Player
- Member
- Profile
- Identity
- Participant
- Character
- UserProfile
- AccountLink
Не придумывай новую таблицу, пока не убедишься, что в проекте уже нет подходящей.

================================
PHASE 2 — ОТЧЁТ О ТЕКУЩЕМ СОСТОЯНИИ
================================

После анализа выведи подробный отчёт в таком формате:

1. CURRENT PROJECT STATE
- кратко опиши текущую архитектуру auth
- как сейчас работают email login/register
- как сейчас работает Steam login
- что уже сделано по AoE2Insights

2. FOUND FILES
Список всех важных файлов с кратким описанием роли каждого.
Например:
- backend/src/steam/routes.ts — ...
- backend/src/services/aoe2insightsService.ts — ...
- backend/src/services/steamService.ts — ...
- backend/src/services/authService.ts — ...
- backend/src/repositories/authRepository.ts — ...
- frontend/... — ...

3. CURRENT DATA MODEL
- какие сейчас есть модели
- какие поля в User уже относятся к AoE2Insights
- какие связи уже существуют
- что уже можно переиспользовать
- что сейчас мешает сделать систему “список незанятых игроков + claim”

4. CURRENT AUTH FLOWS
Отдельно опиши:
- email signup flow
- email login flow
- steam login flow
- /api/auth/me flow
- post-login redirect flow

5. WHAT IS ALREADY IMPLEMENTED
Отдельно перечисли:
- что уже готово и не надо делать заново
- какие части уже реализованы
- что уже работает
- какие новые решения нельзя предлагать в отрыве от уже сделанного

6. RISKS / CONSTRAINTS
- что может сломаться при смене архитектуры
- какие поля/связи уже используются
- где нельзя делать широкие рефакторинги
- какие migration уже лучше не ломать

================================
PHASE 3 — ТОЛЬКО ПОСЛЕ ЭТОГО ПРИДУМАЙ НОВЫЙ ПЛАН
================================

Только после полного отчёта предложи новую архитектуру и план внедрения следующей фичи:

НОВАЯ ЦЕЛЕВАЯ ЛОГИКА

Я хочу перейти к такой модели:

1. Есть 2 способа регистрации:
   - обычная регистрация по email
   - регистрация / логин через Steam

2. У меня будет отдельная сущность игроков AoE2Insights
Я сам занесу туда всех игроков заранее.
У каждого игрока будет как минимум:
- aoeProfileId
- aoeProfileUrl
- nickname
- статус, привязан ли игрок к user

3. Для обычной регистрации:
- пользователь создаёт аккаунт
- после этого ему показывается список игроков, которые ещё не привязаны
- он выбирает себя
- игрок привязывается к этому user
- после этого игрок исчезает из списка доступных

4. Для Steam регистрации:
- пользователь входит через Steam
- система берёт его Steam nickname
- делает поиск в AoE2Insights search
- если exact match найден и найденный aoeProfileId уже существует в нашей таблице игроков
- и этот игрок ещё не привязан
- то этот игрок автоматически привязывается к user

5. Если exact match нет / игрок уже занят / игрока нет в нашей базе:
- логин через Steam всё равно должен успешно пройти
- после логина пользователь должен попасть в ручной flow выбора игрока

================================
PHASE 4 — ПРЕДЛОЖИ SAFE PLAN
================================

После анализа предложи безопасный пошаговый план.

План должен быть в формате:

1. RECOMMENDED DATA MODEL
- использовать ли новую таблицу
- можно ли переиспользовать уже существующую сущность
- как лучше связать User и игрока
- что делать с уже существующими полями aoeProfileId / aoeProfileUrl / aoeNickname / aoeLinkedAt в User:
  - оставить временно
  - мигрировать
  - удалить позже
- предложи лучший вариант с учётом текущего проекта, а не с нуля

2. USER FLOWS
Опиши отдельно:
- email signup + claim player
- steam login + auto-match + fallback to manual claim
- повторный login
- случай “игрок уже занят”

3. BACKEND PLAN
Какие route/service/repository изменения нужны:
- список незанятых игроков
- claim игрока
- steam auto-link по найденному aoeProfileId
- проверка занятости
- response changes

4. FRONTEND PLAN
Какие страницы / экраны / шаги нужны:
- login/register
- claim player screen
- empty state
- auto-link success state
- already claimed state

5. MIGRATION STRATEGY
- как аккуратно перейти от текущего состояния
- как не сломать существующие user accounts
- как обработать пользователей, у которых уже есть aoeProfileId в User
- нужен ли backfill / data migration

6. MINIMAL SAFE IMPLEMENTATION ORDER
Дай порядок внедрения от самого безопасного к более сложному.
Например:
- сначала data model
- потом backend read APIs
- потом claim flow
- потом steam auto-link adaptation
- потом frontend integration
- потом cleanup legacy fields

================================
ВАЖНЫЕ ПРАВИЛА
================================

- Не пиши код сразу
- Не делай предположений без проверки файлов
- Не игнорируй уже сделанные изменения
- Не предлагай архитектуру “с нуля”, если уже есть рабочие части, которые лучше переиспользовать
- Не делай широких рефакторингов без необходимости
- Сначала анализ текущего состояния, потом отчёт, потом план
- Если найдёшь, что проект уже имеет подходящую сущность для игроков — предложи использовать её
- Если новой таблицы не избежать — объясни почему именно
- Обязательно учитывай уже существующие steamService / aoe2insightsService / steam callback / auth me response

ФИНАЛЬНЫЙ ФОРМАТ ОТВЕТА ДОЛЖЕН БЫТЬ ТАКОЙ:

1. CURRENT PROJECT STATE
2. FOUND FILES
3. CURRENT DATA MODEL
4. CURRENT AUTH FLOWS
5. WHAT IS ALREADY IMPLEMENTED
6. RISKS / CONSTRAINTS
7. RECOMMENDED DATA MODEL
8. RECOMMENDED USER FLOWS
9. SAFE BACKEND PLAN
10. SAFE FRONTEND PLAN
11. MIGRATION STRATEGY
12. MINIMAL SAFE IMPLEMENTATION ORDER