1. Критические / высокие риски
1.1 Токен сессии в query WebSocket (/api/v1/ws?token=…)
Суть: JWT передаётся в URL, не в заголовке.

Сценарии утечки:

Логи reverse proxy, CDN, WAF, access_log — часто пишут полный URI → скомпрометированный JWT.
История браузера, скриншоты, «поделиться ссылкой».
Referer при переходе с WS-страницы на внешний HTTP-ресурс (зависит от политики; для WebSocket напрямую реже, для смежных запросов — да).
Код: apps/web/src/hooks/useRealtimeWebSocket.ts (сборка URL), apps/api/src/services/realtimeWs.ts (extractWsToken из path/query), apps/api/src/plugins/auth.ts (исключение WS из обычного Bearer-hook).

Рекомендации:

Предпочтительно: короткоживущий WS-ticket (POST с Authorization: Bearer, сервер выдаёт одноразовый/краткоживущий ticket, клиент открывает wss://.../ws?ticket=...), либо Sec-WebSocket-Protocol / первое текстовое сообщение с токеном после upgrade (с таймаутом и закрытием при отсутствии auth).
Временная мера: отключить логирование query для /api/v1/ws на Caddy/сервере, не логировать raw.url с токеном в приложении.
1.2 CORS: origin: true + credentials: true
Код: apps/api/src/index.ts — @fastify/cors с origin: true, credentials: true.

Риск: Любой Origin получает разрешение на credentialed-запросы. Сейчас основной токен в Bearer + localStorage, не в cookie, поэтому классический CSRF на cookie не главная угроза. Но:

Усиливает последствия любой будущей схемы с cookies.
Упрощает orchestрацию запросов с украденного/встроенного контекста в связке с другими багами.
Рекомендация: Явный allowlist origin’ов (https://mlaffon.fun, https://admin.mlaffon.fun, при необходимости https://web.telegram.org и т.д.), без origin: true в проде.

1.3 Публичный кэш GET /api/v1/home/giveaways
Код: apps/api/src/index.ts — Cache-Control: public, max-age=30, stale-while-revalidate=120, тело = buildHomeGiveawaysResponse() (агрегированные счётчики, без персональных полей в этом снимке).

Оценка: Для текущей формы ответа это скорее низкий риск утечки PII (данные не персонализированы под пользователя). Риск логический: любой промежуточный кэш может отдавать устаревший список розыгрышей (не security, но продукт).

Рекомендация: Если когда-нибудь в этот эндпоинт попадёт персонализация — сразу private, no-store и отдельный приватный эндпоинт.

2. Аутентификация и авторизация
Что сделано хорошо:

JWT HS256, verify на сервере, expiresIn: "7d" (apps/api/src/lib/jwt.ts).
В проде пустой JWT_SECRET → падение при старте (нет silent dev-secret в production).
authUser на критичных маршрутах (/me/*, задачи, магазин, дропы, spin и т.д.).
Забаненные пользователи: ограничение набора путей (plugins/auth.ts).
Dev-login POST /api/v1/auth/dev не регистрируется в production (NODE_ENV !== "production" && ALLOW_DEV_AUTH === "1").
Пробелы / средние риски:

Тема	Деталь
Нет привязки sub к tg в JWT
В payload есть tg, но при обычном REST не видно проверки «токен выдан для этого Telegram». Для текущей модели (один sub = user id) это ок, если все пути выдачи токена доверенные.
WS без проверки «user существует в БД»
На WS: только verifySession + isUserBanned. HTTP-пайплайн дополнительно проверяет наличие пользователя в users. Удалённый/несуществующий sub теоретически может получить initial_state с пустыми/ошибочными доменными данными до истечения JWT — низкий edge case.
Хранение токена
localStorage (apps/web/src/api.ts) — стандартный риск XSS = полный захват сессии. dangerouslySetInnerHTML в web не найден — хорошо, но любой будущий HTML из API остаётся риском.
3. API: IDOR, публичные эндпоинты, валидация
Намеренно публичные (без Bearer):

GET /api/v1/home/public, home/content, home/giveaways
GET /api/v1/live-broadcast — без authUser, отдаёт активный эфир и streamUrl (index.ts). Это не IDOR, а намеренная утечка «куда смотреть» для всех (приемлемо для маркетинга; иначе закрыть auth или отдельный публичный сниппет).
GET /api/v1/giveaways, GET /api/v1/giveaways/:id — без обязательного auth; req.userId опционален для персонализации (routes/giveaways.ts). Перечисление розыгрышей и детали — по дизайну; IDOR на чужие приватные данные в типичном смысле не виден, если getGiveawayPublicDetail не отдаёт чужие PII.
Мутации: в просмотренных маршрутах используется authUser + zod-тела; экономика/дропы опираются на серверные транзакции и idempotency в сервисах (ранее видели publishBalanceUpdate, дебет с ключами и т.д.) — хорошая база против «двойного начисления», но гонки нужно оценивать точечно по каждому claim/spin (полный разбор всех tasks/fortune/shop без чтения каждой функции — в рамках аудита отмечаю как область для pentest).

4. WebSocket
Плюсы:

Подключение привязано к verifySession(token) → userId = sub (realtimeWs.ts).
Входящие сообщения игнорируются — нет поверхностного «обработчика команд» от клиента → меньше поверхность злоупотреблений.
sendToUser(userId, …) шлёт только в сокеты, зарегистрированные под этим userId.
Broadcast-события (дроп, эфир, предикты, розыгрыши) уходят всем — ожидаемо для публичного контента.
Минусы:

Токен в URL (см. критично).
Нет отдельного rate limit на upgrade (есть глобальный rate-limit Fastify с allowlist для /api/v1/ws — не лимитируется как обычные маршруты, см. index.ts). Возможен массовый reconnect / открытие сокетов с валидными токенами → нагрузка (скорее availability, не кража данных).
5. Фронтенд (React)
XSS: dangerouslySetInnerHTML / прямой innerHTML в apps/web не найдены.
Секреты в бандле: только VITE_* (бот, тексты, URL создателя) — не секреты API; ок при условии, что в VITE_* не кладут ключи.
Токен в URL REST: основной API — Bearer; исключение — WebSocket (см. выше).
React Query: кэш привязан к origin + данным в памяти; смена пользователя на том же origin требует смены токена в localStorage — типичный риск двух вкладок с разными аккаунтами низкий; основной риск — XSS или кража токена.
6. Кэширование и заголовки API
/me, /me/economy (и объединённый /me): private, no-store — хорошо.
/me/profile: private, max-age=60 — персональные данные с коротким private cache; не public — приемлемо.
Публичные home/* — осознанно public.
Прокси: Caddy не добавляет CSP/HSTS в вашем deploy/Caddyfile — см. инфраструктуру ниже.

7. Caddy (deploy/Caddyfile)
Есть:

Авто-HTTPS Caddy, reverse_proxy на API, flush_interval -1 для WS.
Нет (рекомендуется для продакшена):

Явного HSTS (Strict-Transport-Security) — часто Caddy с HTTPS подразумевает, но заголовок лучше задать явно.
CSP, X-Frame-Options / frame-ancestors, X-Content-Type-Options, Referrer-Policy — снижают XSS/clickjacking/утечки referrer.
Ограничение скорости на уровне Caddy (опционально; у вас частично есть на API).
8. Rate limiting и злоупотребления
Глобально: 200 запросов / 60 с на IP или на пользователя (если есть Bearer) — config.ts + keyGenerator в index.ts (JWT sub vs IP).
Точечные лимиты: дроп, промо, join giveaway, prediction bet, fortune spin — хорошо.
POST /api/v1/auth/login и /auth/register — отдельного жёсткого лимита в коде маршрута не видно; упираются в глобальный 200/мин. Для подбора паролей это много (зависит от IP и распределённой атаки).
Рекомендация: Отдельный bucket для auth/login (например 10–20/15 мин на IP + на email), register аналогично; капча/задержка по необходимости.

9. Утечки данных и ошибки
Ответы ошибок в основном структурированные (code, message); явного глобального setErrorHandler, который отдаёт stack trace клиенту, в grep не попался — риск утечки стека зависит от дефолтов Fastify + logger: true (в логи сервера стеки возможны — это нормально, если не уходят в JSON ответа).
Перечисление email: регистрация отдаёт email_taken, логин — общее «неверный email или пароль» — частичное перечисление (регистрация).
10. Бизнес-логика (кратко)
Награды завязаны на сервер (дропы с транзакциями, idempotency в economy — по ранее просмотренным фрагментам). Клиентский контроль исхода (напрямую выставить reward) в типичных мутациях не виден.
Полный разбор гонок claimTask / spinFortune / purchase без построчного чтения всех сервисов здесь не заявляется; для продакшена имеет смысл отдельный чеклист транзакций и уникальных ключей.
Сводка по уровням
Уровень	Примеры
Критический
Утечка JWT из URL WS через логи/историю (эксплуатация = долгоживущий токен 7d в чужих руках).
Высокий
CORS origin: true + credentials; слабый лимит на brute-force login относительно глобального лимита.
Средний
Токен в localStorage; перечисление email при регистрации; публичный live-broadcast / списки giveaways по продуктовой модели.
Низкий
WS без DB-проверки user при connect; отсутствие security headers в Caddy; кэш home/giveaways как публичный.
Затронутые файлы / эндпоинты (ключевые)
apps/api/src/lib/jwt.ts, plugins/auth.ts, index.ts (CORS, rate-limit, публичные GET).
apps/api/src/services/realtimeWs.ts, apps/web/src/hooks/useRealtimeWebSocket.ts.
apps/web/src/api.ts (localStorage token).
deploy/Caddyfile.
Публичные: GET /api/v1/home/*, GET /api/v1/giveaways, GET /api/v1/live-broadcast.
Auth: POST /api/v1/auth/login, register, telegram.
Security score (0–10)
6.5 / 10 для типичного Telegram mini-app + отдельный веб-вход: сильные стороны — JWT с истечением, zod, auth на мутациях, бан-политика, частичные per-route rate limits, WS без обработки клиентских команд. Ослабляют оценку: токен в URL WS, широкий CORS, нет отдельного жёсткого лимита на login, нет набора security headers в Caddy, localStorage session.

Приоритетный roadmap
Срочно: Убрать долгоживущий JWT из query WebSocket (ticket / subprotocol / post-handshake auth) + не логировать URL с токеном.
Срочно: Сузить CORS до allowlist в production.
Высокий: Отдельный rate limit на auth/login (и при необходимости register); мониторинг неудачных логинов.
Средний: Заголовки HSTS, CSP, X-Content-Type-Options, Referrer-Policy, политика фреймов для SPA/админки в Caddy.
Средний: Рассмотреть httpOnly Secure cookie + CSRF-стратегия вместо long-lived JWT в localStorage (большой рефакторинг).
По месту: Pentest транзакций наград (claim/spin/shop) на гонки и обход идемпотентности.