/**
 * Telegram WebApp SDK adapter.
 *
 * Цели:
 * 1. Не делать запрос к https://telegram.org/js/telegram-web-app.js в обычном браузере —
 *    в регионах, где Telegram заблокирован, такой запрос вешает первый рендер.
 * 2. В Telegram Mini App поведение должно остаться прежним: реальный `window.Telegram.WebApp`
 *    должен быть подгружен и доступен до того, как приложение начинает им пользоваться.
 * 3. Любой вызов адаптера в обычном браузере не должен бросать исключений и вообще что-либо
 *    делать неожиданное — есть безопасные no-op фолбэки.
 *
 * Снаружи модуль экспортирует:
 *   - `isTelegramEnv()`           — детект Telegram-окружения.
 *   - `loadTelegramSdk(timeout?)` — единоразовая попытка подгрузить SDK (только в TMA).
 *   - `getTelegramWebApp()`       — текущий объект WebApp (реальный или фолбэк).
 *   - `TelegramWebApp`            — Proxy с тем же API, что и `WebApp` из `@twa-dev/sdk`.
 *
 * Существующие импорты `import WebApp from "@twa-dev/sdk"` заменяются на
 * `import { TelegramWebApp as WebApp } from "@/lib/telegramAdapter"` (или относительный путь).
 */

import type { WebApp as TelegramWebAppType } from "@twa-dev/types";

/** Тег скрипта, чтобы не подгрузить SDK дважды. */
const SCRIPT_ID = "telegram-web-app-sdk";
const SDK_URL = "https://telegram.org/js/telegram-web-app.js";
const DEFAULT_TIMEOUT_MS = 600;
const IS_DEV = import.meta.env.DEV;

type TelegramGlobal = {
  WebApp?: TelegramWebAppType;
};

type SdkLoadResult = "loaded" | "timeout" | "skipped";

function devDebug(message: string, details?: Record<string, unknown>): void {
  if (!IS_DEV) return;
  try {
    if (details) {
      console.debug(`[telegram-adapter] ${message}`, details);
      return;
    }
    console.debug(`[telegram-adapter] ${message}`);
  } catch {
    /* ignore */
  }
}

/** Любая глобальная сущность браузера может отсутствовать (SSR/prerender). */
const hasWindow = (): boolean => typeof window !== "undefined";
const hasDocument = (): boolean => typeof document !== "undefined";
const hasNavigator = (): boolean => typeof navigator !== "undefined";

/** Безопасный no-op haptic, если SDK ещё не загружен или вне Telegram. */
const fallbackHaptic = {
  impactOccurred: () => fallbackHaptic,
  notificationOccurred: () => fallbackHaptic,
  selectionChanged: () => fallbackHaptic,
};

/**
 * Универсальное «открыть ссылку в обычной вкладке».
 * SSR-safe: если `window` нет, ничего не делаем.
 */
function webOpen(url: string): void {
  try {
    if (hasWindow() && typeof window.open === "function") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    /* ignore */
  }
}

/**
 * Минимальный фолбэк WebApp для обычного веба.
 * Покрывает все методы и поля, которые используются в репозитории:
 *   - initData, initDataUnsafe, platform
 *   - ready, expand, close
 *   - openLink, openTelegramLink
 *   - HapticFeedback.{impactOccurred,notificationOccurred,selectionChanged}
 *   - isFullscreen / exitFullscreen / disableVerticalSwipes
 * Все методы — no-op, ссылки открываются обычным `window.open`.
 */
function createFallbackWebApp(): TelegramWebAppType {
  /**
   * Точные типы из `@twa-dev/types` довольно строгие — нам нужен лишь рабочий no-op.
   * Поэтому собираем объект с нужными методами и приводим к целевому типу.
   */
  const fallback: Record<string, unknown> = {
    initData: "",
    initDataUnsafe: {},
    platform: "unknown",
    version: "0.0",
    colorScheme: "light",
    themeParams: {},
    isExpanded: true,
    isFullscreen: false,
    viewportHeight: hasWindow() ? window.innerHeight : 0,
    viewportStableHeight: hasWindow() ? window.innerHeight : 0,
    headerColor: "#ffffff",
    backgroundColor: "#ffffff",
    isClosingConfirmationEnabled: false,
    BackButton: {
      isVisible: false,
      show: () => {},
      hide: () => {},
      onClick: () => {},
      offClick: () => {},
    },
    MainButton: {
      text: "",
      color: "#000000",
      textColor: "#ffffff",
      isVisible: false,
      isActive: false,
      isProgressVisible: false,
      setText: () => {},
      onClick: () => {},
      offClick: () => {},
      show: () => {},
      hide: () => {},
      enable: () => {},
      disable: () => {},
      showProgress: () => {},
      hideProgress: () => {},
      setParams: () => {},
    },
    HapticFeedback: fallbackHaptic,
    ready: () => {},
    expand: () => {},
    close: () => {},
    enableClosingConfirmation: () => {},
    disableClosingConfirmation: () => {},
    onEvent: () => {},
    offEvent: () => {},
    sendData: () => {},
    switchInlineQuery: () => {},
    openLink: (url: string) => webOpen(url),
    openTelegramLink: (url: string) => webOpen(url),
    openInvoice: () => {},
    showPopup: () => {},
    showAlert: (message: string, cb?: () => void) => {
      try {
        if (hasWindow() && typeof window.alert === "function") {
          window.alert(message);
        }
      } catch {
        /* ignore */
      }
      cb?.();
    },
    showConfirm: (
      _message: string,
      cb?: (confirmed: boolean) => void
    ) => {
      cb?.(false);
    },
    showScanQrPopup: () => {},
    closeScanQrPopup: () => {},
    readTextFromClipboard: () => {},
    requestWriteAccess: (cb?: (granted: boolean) => void) => {
      cb?.(false);
    },
    requestContact: (cb?: (granted: boolean) => void) => {
      cb?.(false);
    },
    setHeaderColor: () => {},
    setBackgroundColor: () => {},
    requestFullscreen: () => {},
    exitFullscreen: () => {},
    lockOrientation: () => {},
    unlockOrientation: () => {},
    addToHomeScreen: () => {},
    checkHomeScreenStatus: () => {},
    disableVerticalSwipes: () => {},
    enableVerticalSwipes: () => {},
  };

  return fallback as unknown as TelegramWebAppType;
}

/** Лениво создаём фолбэк, чтобы не делать работу зря в TMA. */
let cachedFallback: TelegramWebAppType | null = null;
function getFallback(): TelegramWebAppType {
  if (cachedFallback == null) cachedFallback = createFallbackWebApp();
  return cachedFallback;
}

/** Реальный `window.Telegram.WebApp`, если он уже подгружен. */
function readNativeWebApp(): TelegramWebAppType | null {
  try {
    if (!hasWindow()) return null;
    const tg = (window as unknown as { Telegram?: TelegramGlobal }).Telegram;
    return tg?.WebApp ?? null;
  } catch {
    return null;
  }
}

/**
 * Признаки запуска внутри Telegram. Срабатывает до загрузки SDK,
 * чтобы решить, надо ли его вообще тянуть с telegram.org.
 *
 * Совпадение по любому из источников:
 *   - `tgWebAppData` в `location.search`
 *   - `tgWebAppData` в `location.hash`
 *   - `Telegram` в `navigator.userAgent`
 *   - уже существующий `window.Telegram.WebApp`
 */
export function isTelegramEnv(): boolean {
  if (!hasWindow()) return false;
  try {
    if (readNativeWebApp() != null) return true;
  } catch {
    /* ignore */
  }
  try {
    const search = hasWindow() ? window.location?.search ?? "" : "";
    if (search.includes("tgWebAppData")) return true;
  } catch {
    /* ignore */
  }
  try {
    const hash = hasWindow() ? window.location?.hash ?? "" : "";
    if (hash.includes("tgWebAppData")) return true;
  } catch {
    /* ignore */
  }
  try {
    const ua = hasNavigator() ? navigator.userAgent ?? "" : "";
    if (/Telegram/i.test(ua)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Promise-кэш загрузки SDK. Вне Telegram сразу резолвится в `null` без сети.
 * В Telegram-окружении грузит скрипт один раз, с таймаутом — на случай, если
 * сеть до telegram.org медленная или заблокирована точечным фаерволом.
 */
let sdkPromise: Promise<TelegramWebAppType | null> | null = null;

/**
 * Лёгкий диагностический хук на таймаут SDK.
 *
 * Если в проекте появится Sentry/иной мониторинг — здесь надо будет вызвать
 * `Sentry.captureMessage('telegram_sdk_timeout', 'warning')`. Пока такого нет
 * в репозитории, ограничиваемся `console.warn` и не тянем новых зависимостей.
 */
function reportTelegramSdkTimeout(): void {
  try {
    if (IS_DEV && typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[telegram-adapter] Telegram SDK timeout, using web fallback");
    }
  } catch {
    /* ignore */
  }
}

/**
 * Динамически грузит официальный telegram-web-app.js, только если мы в Telegram-окружении.
 *
 * - В обычном браузере — мгновенно резолвится в фолбэк, без сетевого запроса.
 * - В TMA — добавляет `<script async>` в `<head>`, ждёт `onload`/`onerror` или таймаут.
 * - При таймауте — НЕ удаляет тег скрипта: если SDK подгрузится позже, `window.Telegram.WebApp`
 *   всё равно окажется доступен, и Proxy-`TelegramWebApp` начнёт его использовать.
 * - При сетевой ошибке (`onerror`) тег удаляется — повторное появление SDK невозможно.
 * - Повторные вызовы переиспользуют тот же Promise (не грузим скрипт дважды).
 */
export function loadTelegramSdk(
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<TelegramWebAppType | null> {
  if (sdkPromise) {
    devDebug("loadTelegramSdk reused existing promise");
    return sdkPromise;
  }

  if (!hasWindow() || !hasDocument()) {
    devDebug("loadTelegramSdk skipped", { reason: "no_window_or_document" });
    sdkPromise = Promise.resolve(null);
    return sdkPromise;
  }

  const existing = readNativeWebApp();
  if (existing) {
    devDebug("loadTelegramSdk loaded", { source: "existing_window_telegram" });
    sdkPromise = Promise.resolve(existing);
    return sdkPromise;
  }

  if (!isTelegramEnv()) {
    const wa = readNativeWebApp();
    devDebug("startup mode: browser fallback", {
      sdkLoadResult: "skipped",
      hasInitData: Boolean(wa?.initData?.trim()),
    });
    sdkPromise = Promise.resolve(null);
    return sdkPromise;
  }

  devDebug("startup mode: Telegram SDK", { sdkLoadResult: "loading" });
  sdkPromise = new Promise<TelegramWebAppType | null>((resolve) => {
    let settled = false;
    let loadResult: SdkLoadResult = "skipped";
    const settle = (value: TelegramWebAppType | null) => {
      if (settled) return;
      settled = true;
      try {
        if (hasWindow()) window.clearTimeout(timeoutId);
      } catch {
        /* ignore */
      }
      devDebug("loadTelegramSdk result", { result: loadResult });
      resolve(value);
    };

    const prev = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    /** Может оказаться, что внешний шаблон всё-таки добавил тег раньше — переиспользуем его. */
    const script = prev ?? document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";

    const onLoad = () => {
      const wa = readNativeWebApp();
      loadResult = wa ? "loaded" : "skipped";
      devDebug("initData presence after SDK load", {
        hasInitData: Boolean(wa?.initData?.trim()),
      });
      settle(wa);
    };
    /**
     * Сетевая ошибка: дальше SDK уже не появится — снимаем тег, чтобы он не «висел»,
     * и резолвимся в фолбэк.
     */
    const onError = () => {
      loadResult = "skipped";
      try {
        script.parentNode?.removeChild(script);
      } catch {
        /* ignore */
      }
      settle(null);
    };

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });

    /**
     * Таймаут только разблокирует старт приложения. Тег скрипта остаётся в DOM:
     * если ответ всё-таки придёт через несколько секунд (медленные сети), браузер
     * выполнит SDK, выставит `window.Telegram.WebApp`, и Proxy-`TelegramWebApp`
     * автоматически начнёт делегировать вызовы реальному API.
     */
    const timeoutId = window.setTimeout(() => {
      reportTelegramSdkTimeout();
      loadResult = "timeout";
      const wa = readNativeWebApp();
      devDebug("initData presence after SDK timeout", {
        hasInitData: Boolean(wa?.initData?.trim()),
      });
      settle(null);
    }, Math.max(0, timeoutMs));

    if (!prev) {
      try {
        (document.head ?? document.documentElement).appendChild(script);
      } catch {
        settle(null);
      }
    }
  });

  return sdkPromise;
}

/**
 * Возвращает текущий WebApp: реальный из `window.Telegram.WebApp`,
 * либо безопасный фолбэк, если SDK ещё не загружен / мы вне Telegram.
 */
export function getTelegramWebApp(): TelegramWebAppType {
  return readNativeWebApp() ?? getFallback();
}

/**
 * Унифицированный «открой ссылку».
 *
 * - Если есть реальный `window.Telegram.WebApp.openLink`/`openTelegramLink` — используем его
 *   (для t.me-ссылок предпочитаем `openTelegramLink`).
 * - Иначе — обычный `window.open(url, "_blank", "noopener,noreferrer")`.
 *
 * SSR-safe: если `window` нет, ничего не делает.
 */
export function openLink(
  url: string,
  options?: { tryInstantView?: boolean }
): void {
  if (!url) return;
  const native = readNativeWebApp();
  if (native) {
    try {
      const isTelegramHttpLink = /^https?:\/\/(t\.me|telegram\.me|telegram\.dog)\//i.test(url);
      const wa = native as unknown as {
        openTelegramLink?: (u: string) => void;
        openLink?: (u: string, opts?: { try_instant_view?: boolean }) => void;
      };
      if (isTelegramHttpLink && typeof wa.openTelegramLink === "function") {
        wa.openTelegramLink(url);
        return;
      }
      if (typeof wa.openLink === "function") {
        wa.openLink(
          url,
          options?.tryInstantView != null
            ? { try_instant_view: options.tryInstantView }
            : undefined
        );
        return;
      }
    } catch {
      /* ignore — упадём в web-фолбэк ниже */
    }
  }
  webOpen(url);
}

/**
 * Прокси с тем же API, что у дефолтного экспорта `@twa-dev/sdk`.
 *
 * Все обращения и вызовы делегируются через `getTelegramWebApp()`,
 * поэтому если SDK подгрузится позже (после старта приложения), компоненты
 * автоматически начнут использовать реальный объект без перезапуска.
 */
export const TelegramWebApp: TelegramWebAppType = new Proxy(
  {} as TelegramWebAppType,
  {
    get(_target, prop, receiver) {
      const wa = getTelegramWebApp() as unknown as Record<string | symbol, unknown>;
      const value = wa[prop as string];
      if (typeof value === "function") {
        /** bind, чтобы внутри методов сохранялся правильный `this` (HapticFeedback и пр.). */
        return (value as (...args: unknown[]) => unknown).bind(wa);
      }
      return value ?? Reflect.get(_target, prop, receiver);
    },
    set(_target, prop, value) {
      try {
        const wa = getTelegramWebApp() as unknown as Record<string | symbol, unknown>;
        wa[prop as string] = value;
        return true;
      } catch {
        return false;
      }
    },
    has(_target, prop) {
      const wa = getTelegramWebApp() as unknown as Record<string | symbol, unknown>;
      return prop in wa;
    },
  }
);

export default TelegramWebApp;
