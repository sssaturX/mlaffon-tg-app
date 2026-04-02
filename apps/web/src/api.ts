const TOKEN_KEY = "mlaffon_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export type ApiOk<T> = { ok: true; data: T };

export type ApiErr = {
  ok: false;
  status: number;
  err: unknown;
  /** Нет сети / DNS / CORS / прерванный fetch */
  networkError?: boolean;
};

export type ApiResult<T> = ApiOk<T> | ApiErr;

export function formatApiError(r: ApiErr): string {
  if (r.networkError) {
    return "Нет соединения. Проверьте интернет и попробуйте снова.";
  }
  const e = r.err as {
    error?: { code?: string; message?: string };
    message?: string;
  } | null;
  const rawMsg =
    e?.error?.message ??
    (typeof e?.message === "string" && e.message.trim() !== ""
      ? e.message
      : undefined);
  const serverMsg =
    rawMsg && !/^internal server error$/i.test(rawMsg) ? rawMsg : undefined;

  if (r.status === 429) {
    return serverMsg ?? "Слишком много запросов. Подождите минуту.";
  }
  if (r.status === 403 && e?.error?.code === "banned") {
    return e.error.message ?? "Доступ ограничен.";
  }
  if (serverMsg && r.status >= 400) {
    return serverMsg;
  }
  if (r.status >= 500) {
    return "Сервер временно недоступен. Попробуйте позже.";
  }
  return (
    e?.error?.message ??
    e?.error?.code ??
    (r.status ? `Ошибка (${r.status})` : "Ошибка запроса")
  );
}

export async function api<T>(
  path: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  const token = getToken();
  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
  };
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  if (init?.body && !(headers as Record<string, string>)["Content-Type"]) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }

  try {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      (headers as Record<string, string>)["Cache-Control"] = "no-cache";
      (headers as Record<string, string>)["Pragma"] = "no-cache";
    }
    const noStore =
      method === "GET" || method === "HEAD"
        ? ({ cache: "no-store" as const } satisfies Pick<RequestInit, "cache">)
        : {};
    const r = await fetch(path, { ...noStore, ...init, headers });
    let data: unknown = {};
    try {
      data = await r.json();
    } catch {
      data = {};
    }
    if (!r.ok) {
      return { ok: false, status: r.status, err: data };
    }
    return { ok: true, data: data as T };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, status: 0, err: null, networkError: true };
    }
    return { ok: false, status: 0, err: null, networkError: true };
  }
}

export async function authTelegram(initData: string) {
  return api<{ token: string; userId: string; accountsMerged?: boolean }>(
    "/api/v1/auth/telegram",
    {
      method: "POST",
      body: JSON.stringify({ initData }),
    }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Повтор при обрыве сети / 5xx (холодный старт API, флап WebView). */
export async function authTelegramWithRetry(initData: string) {
  let last = await authTelegram(initData);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (last.ok) return last;
    const transient =
      last.networkError === true ||
      last.status === 0 ||
      (last.status >= 500 && last.status < 600);
    if (!transient) return last;
    await sleep(350 * (attempt + 1));
    last = await authTelegram(initData);
  }
  return last;
}

export async function authDev(telegramId: number, username?: string) {
  return api<{ token: string; userId: string }>("/api/v1/auth/dev", {
    method: "POST",
    body: JSON.stringify({ telegramId, username }),
  });
}

export async function authRegister(email: string, password: string) {
  return api<{ token: string; userId: string }>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function authLogin(email: string, password: string) {
  return api<{ token: string; userId: string }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function createTelegramLink() {
  return api<{
    linkToken: string;
    expiresAt: string;
    botStartUrl: string;
  }>("/api/v1/auth/link/telegram", { method: "POST" });
}

/** Задать email/пароль для входа с сайта (уже вошли через Telegram). */
export async function attachWebCredentials(email: string, password: string) {
  return api<{ ok: true }>("/api/v1/me/web-credentials", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
