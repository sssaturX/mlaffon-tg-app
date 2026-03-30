import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "mlaffon_admin_token";

function apiOrigin(): string {
  return (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
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
  const [gwTitle, setGwTitle] = useState("");
  const [gwPrize, setGwPrize] = useState("");
  const [gwEnds, setGwEnds] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 16);
  });
  const [gwImage, setGwImage] = useState("");

  const authHeaders = useCallback((): HeadersInit => {
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (token) (h as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);

  const loadGiveaways = useCallback(async () => {
    if (!token) return;
    setErr(null);
    const r = await fetch(`${apiOrigin()}/api/admin/giveaways`, { headers: authHeaders() });
    const j = (await r.json()) as { giveaways?: GiveawayRow[]; error?: { message?: string } };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      return;
    }
    setGiveaways(j.giveaways ?? []);
  }, [token, authHeaders]);

  useEffect(() => {
    if (token) void loadGiveaways();
  }, [token, loadGiveaways]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${apiOrigin()}/api/admin/login`, {
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
      const r = await fetch(`${apiOrigin()}/api/admin/giveaways`, {
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
    </>
  );
}
