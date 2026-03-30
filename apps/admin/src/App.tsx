import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "mlaffon_admin_token";

/**
 * База URL для запросов к API.
 * На поддомене admin.* всегда используем тот же origin (`/api/...` → Caddy → 127.0.0.1:3001),
 * даже если в билде случайно задан VITE_API_ORIGIN на другой хост — иначе логин ломается.
 */
function apiBase(): string {
  const env = (import.meta.env.VITE_API_ORIGIN ?? "").trim().replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.hostname.startsWith("admin.")) {
    return "";
  }
  return env;
}

type GiveawayRow = {
  id: string;
  title: string;
  prizeText: string;
  imageUrl: string | null;
  endsAt: string;
  active: boolean;
  sortOrder: number;
};

type PromoRow = {
  id: string;
  code: string;
  rewardCoins: number;
  maxUses: number;
  usesCount: number;
  active: boolean;
  createdAt: string;
};

export function App() {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [giveaways, setGiveaways] = useState<GiveawayRow[] | null>(null);
  const [promos, setPromos] = useState<PromoRow[] | null>(null);
  const [gwTitle, setGwTitle] = useState("");
  const [gwPrize, setGwPrize] = useState("");
  const [gwEnds, setGwEnds] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 16);
  });
  const [gwImage, setGwImage] = useState("");

  const [promoCode, setPromoCode] = useState("");
  const [promoReward, setPromoReward] = useState(100);
  const [promoMaxUses, setPromoMaxUses] = useState(100);

  const authHeaders = useCallback((): HeadersInit => {
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (token) (h as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);

  const loadGiveaways = useCallback(async () => {
    if (!token) return;
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/giveaways`, { headers: authHeaders() });
    const j = (await r.json()) as { giveaways?: GiveawayRow[]; error?: { message?: string } };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      return;
    }
    setGiveaways(j.giveaways ?? []);
  }, [token, authHeaders]);

  const loadPromos = useCallback(async () => {
    if (!token) return;
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/promos`, { headers: authHeaders() });
    const j = (await r.json()) as { promos?: PromoRow[]; error?: { message?: string } };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      return;
    }
    setPromos(j.promos ?? []);
  }, [token, authHeaders]);

  useEffect(() => {
    if (token) {
      void loadGiveaways();
      void loadPromos();
    }
  }, [token, loadGiveaways, loadPromos]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, passphrase }),
      });
      const j = (await r.json()) as { token?: string; error?: { message?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? "Вход не удался");
        return;
      }
      if (!j.token) {
        setErr("Нет токена в ответе");
        return;
      }
      localStorage.setItem(TOKEN_KEY, j.token);
      setToken(j.token);
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setGiveaways(null);
    setPromos(null);
  }

  async function createGiveaway(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const endsAt = new Date(gwEnds).toISOString();
      const body: Record<string, unknown> = {
        title: gwTitle,
        prizeText: gwPrize,
        endsAt,
        active: true,
      };
      if (gwImage.trim()) body.imageUrl = gwImage.trim();
      const r = await fetch(`${apiBase()}/api/admin/giveaways`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { id?: string; error?: { message?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        return;
      }
      setGwTitle("");
      setGwPrize("");
      await loadGiveaways();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function createPromo(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/promos`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          code: promoCode.trim(),
          rewardCoins: promoReward,
          maxUses: promoMaxUses,
          active: true,
        }),
      });
      const j = (await r.json()) as { id?: string; error?: { message?: string; code?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        return;
      }
      setPromoCode("");
      await loadPromos();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <>
        <h1>Админка Mlaffon</h1>
        <p className="muted">Вход по email, паролю и passphrase (см. ADMIN_* в API).</p>
        <form className="card stack" onSubmit={login} style={{ marginTop: 16 }}>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="passphrase">Passphrase</label>
            <input
              id="passphrase"
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
            />
          </div>
          {err ? <p className="err">{err}</p> : null}
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "…" : "Войти"}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Админка</h1>
        <button type="button" className="secondary" onClick={logout}>
          Выйти
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}

      <h2>Розыгрыши</h2>
      <form className="card stack" onSubmit={createGiveaway}>
        <div>
          <label htmlFor="gtitle">Заголовок</label>
          <input id="gtitle" value={gwTitle} onChange={(e) => setGwTitle(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="gprize">Приз (текст)</label>
          <input id="gprize" value={gwPrize} onChange={(e) => setGwPrize(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="gends">Окончание (локальное время)</label>
          <input
            id="gends"
            type="datetime-local"
            value={gwEnds}
            onChange={(e) => setGwEnds(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="gimg">Картинка URL (опционально)</label>
          <input id="gimg" type="url" value={gwImage} onChange={(e) => setGwImage(e.target.value)} />
        </div>
        <button type="submit" className="primary" disabled={loading}>
          Создать розыгрыш
        </button>
      </form>

      {giveaways === null ? (
        <p className="muted">Загрузка…</p>
      ) : giveaways.length === 0 ? (
        <p className="muted">Пока нет розыгрышей.</p>
      ) : (
        <ul className="list">
          {giveaways.map((g) => (
            <li key={g.id}>
              <strong>{g.title}</strong>
              <div className="muted">{g.prizeText}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                до {new Date(g.endsAt).toLocaleString("ru-RU")} ·{" "}
                {g.active ? "активен" : "выкл"}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 32 }}>Промокоды</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Код вводят на главной. Разные промокоды — разные суммы; макс. активаций{" "}
        <strong>0</strong> = без лимита.
      </p>
      <form className="card stack" onSubmit={createPromo}>
        <div>
          <label htmlFor="pcode">Код (латиница/цифры)</label>
          <input
            id="pcode"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder="SUMMER2026"
            required
            autoComplete="off"
          />
        </div>
        <div className="row">
          <div>
            <label htmlFor="preward">Монет (бонус)</label>
            <input
              id="preward"
              type="number"
              min={1}
              value={promoReward}
              onChange={(e) => setPromoReward(Number(e.target.value))}
              required
            />
          </div>
          <div>
            <label htmlFor="pmax">Макс. активаций</label>
            <input
              id="pmax"
              type="number"
              min={0}
              value={promoMaxUses}
              onChange={(e) => setPromoMaxUses(Number(e.target.value))}
              required
            />
          </div>
        </div>
        <button type="submit" className="primary" disabled={loading}>
          Создать промокод
        </button>
      </form>

      {promos === null ? (
        <p className="muted">Загрузка промокодов…</p>
      ) : promos.length === 0 ? (
        <p className="muted">Промокодов пока нет.</p>
      ) : (
        <ul className="list">
          {promos.map((p) => (
            <li key={p.id}>
              <strong>{p.code}</strong> — {p.rewardCoins} мон. · активаций {p.usesCount}
              {p.maxUses > 0 ? ` / ${p.maxUses}` : " / ∞"} ·{" "}
              {p.active ? "активен" : "выкл"}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
