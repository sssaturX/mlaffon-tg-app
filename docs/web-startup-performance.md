# Web app startup performance (bootstrap)

## 1. Startup path before

With a saved JWT, cold start typically triggered in parallel:

- `GET /api/v1/me/profile` and `GET /api/v1/me/economy` (two round-trips; economy waited on profile settlement in React Query).
- `prefetchShopCatalog()` after token (shop for both platforms).
- `prefetchOnBootstrap()` in `AppShell`: `home/content`, `home/giveaways`, **tasks**, **fortune config**, **shop**.
- On `ready`: second **`prefetchShopCatalog()`**.
- **Web Push**: opening Profile ran `getPushSubscriptionState()` → **`GET /api/v1/push/vapid-public-key`** on mount.
- **WebSocket**: `useRealtimeWebSocket` enabled as soon as `me` existed → **`POST /api/v1/ws-ticket`** and WS upgrade immediately after profile loaded.

## 2. Startup path after (critical path)

1. HTML/CSS/JS load (unchanged).
2. App mounts; auth gate resolves token (Telegram / existing JWT / web login / dev).
3. **Single** `GET /api/v1/me` via React Query key `me.session` → splits into profile + economy caches (same as before for WS/reducer).
4. **Shell-first**: при валидном JWT сразу рендерятся `app-shell`, шапка (баланс — skeleton), навигация и главная со скелетонами; `/me` не блокирует первый кадр.
5. **Deferred (idle / ~250–2500 ms)**: prefetch **only** `home/content` and `home/giveaways` — no tasks, fortune, shop on bootstrap.
6. **WebSocket**: connects only after `requestIdleCallback` (fallback `setTimeout(400)`) once `me` exists — ticket + upgrade not in the first paint frame.
7. **Push / VAPID**: no automatic `vapid-public-key` request; local subscription check only on Profile; VAPID fetched on explicit «Включить».

Heavy route data (tasks, shop, games/fortune, referrals, giveaways list/detail) loads from route `useQuery` or **nav prefetch** (hover), not from global bootstrap.

## 3. Files changed

| File | Purpose |
|------|---------|
| `packages/shared/src/index.ts` | `splitMeResponse()` for unified `/me` → profile + economy |
| `apps/web/src/query/fetchers.ts` | `fetchMe`, `fetchMeNoCache` |
| `apps/web/src/query/queryKeys.ts` | `me.session` |
| `apps/web/src/query/meQueryFns.ts` | `meSessionQueryFn`, `meSessionQueryFnNoCache` |
| `apps/web/src/hooks/queries/useMergedMe.ts` | Single session query + disabled profile/economy queries (cache subscribers) |
| `apps/web/src/hooks/queries/useMeQueries.ts` | **Removed** (unused) |
| `apps/web/src/App.tsx` | Session prefetch only; no `prefetchShopCatalog`; `sessionQ` errors; WS deferred |
| `apps/web/src/query/prefetch.ts` | Slim `prefetchOnBootstrap`; profile hover → session only; no referrals prefetch on profile hover |
| `apps/web/src/meDomain/meHydration.ts` | `hydrateMeThroughEventBus` uses one `fetchMe()` |
| `apps/web/src/lib/webPushClient.ts` | Local-only `getLocalPushSubscriptionState` (no VAPID on read path) |
| `apps/web/src/components/PushNotificationsRow.tsx` | Uses local state; removed `server_off` screen from mount path |
| `apps/web/src/components/ScreenHeader.tsx` | `balanceLoading` — плейсхолдер баланса без `me` |
| `apps/web/src/pages/Home.tsx` | Герой и стрик без блокировки: скелетон + копирайт «загрузка» |
| `apps/web/src/pages/Giveaways.tsx` | Список без ожидания `me` (prop убран) |
| `apps/web/src/pages/Giveaway.tsx` | Join/balance с `me == null` |

## Shell-first UX (me не блокирует root)

- Удалены полноэкранные спиннеры: `isInitialLoading`, `!me`, ошибка `session` как единственный экран.
- Ошибка загрузки профиля — полоска над shell + «Повторить» (`refetch` `me.session`).
- Бан по-прежнему полноэкранный `BannedScreen` после того, как `me` загружен и `banned === true`.

## Auth shell (нет блокировки на `!ready`)

- Удалён **`if (!ready) return <AppLoadingSpinner />`**: первый кадр — **AppShell** (и в TMA, и в браузере).
- Введено **`sessionBootstrapReady`**: в Telegram Mini App остаётся `false`, пока не отработал initData / обмен JWT — **`GET /me` не запускается** (защита от старого JWT в localStorage).
- В обычном браузере без TMA стартовое значение `sessionBootstrapReady === true`, чтобы сразу грузить профиль при наличии токена.
- Пока идёт bootstrap в TMA: полоска **«Подключение к Telegram…»** (`auth-init-banner`), skeleton баланса в шапке.
- Экран «Вход» без токена показывается только если **`sessionBootstrapReady && (!getToken() || error)`**, чтобы не мигать формой входа до завершения Telegram-auth.

## 4. Push / VAPID decision: **Scenario A — deferred**

- **Removed from startup / Profile mount**: `GET /api/v1/push/vapid-public-key` when only checking whether to show buttons.
- **Kept**: `getVapidPublicKey` inside `subscribeToLivePush` / user gesture; `POST/DELETE /api/v1/push/subscribe` unchanged.
- **UI**: Push row still on Profile; no permission prompt until «Включить»; server misconfiguration surfaces as toast from subscribe, not as a blocking mount request.

## 5. WebSocket strategy

- **When**: After `me` is set **and** `requestIdleCallback` fires (or 400 ms timeout without rIC), so `POST /api/v1/ws-ticket` and the WS handshake are not competing with the first shell frame and the initial `/me` fetch.

## 6. Route loading strategy

| Data | When |
|------|------|
| `GET /api/v1/me` | Bootstrap (single call) |
| Home content / home giveaways | Idle after shell (`prefetchOnBootstrap`) + Home `useQuery` |
| Tasks | `/tasks` mount or nav prefetch |
| Shop | `/shop` or nav prefetch (`prefetchShopCatalog` on shop hover only) |
| Fortune | `/games` or nav prefetch |
| Referrals | Profile mount (`useReferrals`) — not prefetched on tab hover anymore |
| Giveaways list/detail | Giveaways routes + nav prefetch where already wired |

## 7. React Query

- Global defaults unchanged (`refetchOnWindowFocus: false`, etc.).
- Bootstrap uses one query (`me.session`) instead of two chained fetches.
- Profile/economy queries stay `enabled: false` but subscribe to cache updates from session + WS.

## 8. Performance results

**Not run in CI** (environment-dependent). To measure before/after locally:

- Chrome DevTools **Network**: filter XHR/fetch; count requests until first meaningful screen; note `DOMContentLoaded` / `Load` in **Performance** or **Navigation** timing.
- Lighthouse performance / Web Vitals on staging.

Expected differences: fewer parallel requests at cold start (no shop/tasks/fortune prefetch; one `/me` instead of `/profile`+`/economy`; no VAPID on Profile open; WS ticket later).

## 9. Rollout notes

- No API contract break: `GET /api/v1/me`, `/me/profile`, `/me/economy` remain; clients now prefer `/me` for bootstrap.
- Monitor error rates on `/api/v1/me` and WS ticket latency.
- If WS-dependent features feel late by ~0–2 s, tune idle `timeout` in `App.tsx` only.

## 10. Definition of done

- [x] No automatic VAPID fetch on app or Profile load; subscribe still works on demand.
- [x] No `ws-ticket` / WS until after deferred hook in `AppShell`.
- [x] No tasks / fortune / shop in `prefetchOnBootstrap`; no `prefetchShopCatalog` on token ready.
- [x] Single HTTP bootstrap for `me` where dual fetch existed.
- [x] Documented startup path and file list (this file).
