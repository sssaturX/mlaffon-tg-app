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

type AdminStats = {
  usersCount: number;
  coinsEarnedTotal: number;
  activeGiveaways: number;
  giveawayEntriesTotal: number;
};

type GiveawayRow = {
  id: string;
  title: string;
  prizeText: string;
  description: string | null;
  imageUrl: string | null;
  endsAt: string;
  active: boolean;
  sortOrder: number;
  winnerCount: number;
  ticketPriceCoins: number;
  drawnAt: string | null;
  participantCount: number;
};

type PromoRow = {
  id: string;
  code: string;
  rewardCoins: number;
  creditPlatform: string;
  maxUses: number;
  usesCount: number;
  active: boolean;
  createdAt: string;
};

type AdminUserRow = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  createdAt: string;
  coins: number;
  twitchCoins: number;
  kickCoins: number;
  /** Суммарно за всё время (оба баланса). */
  lifetimeEarned: number;
  twitchLifetimeEarned: number;
  kickLifetimeEarned: number;
  referralCount: number;
};

type GiveawayParticipant = {
  userId: string;
  username: string;
  joinedAt: string;
};

type GiveawayDetailResponse = {
  giveaway: {
    id: string;
    title: string;
    prizeText: string;
    description: string | null;
    imageUrl: string | null;
    endsAt: string;
    active: boolean;
    sortOrder: number;
    winnerCount: number;
    ticketPriceCoins: number;
    drawnAt: string | null;
  };
  participants: GiveawayParticipant[];
  publicSnapshot: {
    winners: { rank: number; username: string }[];
  } | null;
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

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [giveaways, setGiveaways] = useState<GiveawayRow[] | null>(null);
  const [promos, setPromos] = useState<PromoRow[] | null>(null);

  const [gwTitle, setGwTitle] = useState("");
  const [gwPrize, setGwPrize] = useState("");
  const [gwDescription, setGwDescription] = useState("");
  const [gwWinnerCount, setGwWinnerCount] = useState(3);
  const [gwTicketPrice, setGwTicketPrice] = useState(0);
  const [gwEnds, setGwEnds] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 16);
  });
  const [gwImage, setGwImage] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GiveawayDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawLoadingId, setDrawLoadingId] = useState<string | null>(null);

  const [promoCode, setPromoCode] = useState("");
  const [promoReward, setPromoReward] = useState(100);
  const [promoMaxUses, setPromoMaxUses] = useState(100);
  const [promoCreditPlatform, setPromoCreditPlatform] = useState<"split" | "twitch" | "kick">("split");

  const [tab, setTab] = useState<"giveaways" | "promos" | "users">("giveaways");
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[] | null>(null);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const USERS_PAGE = 50;

  /**
   * Только с `includeJsonContentType: true` для запросов с JSON-телом.
   * DELETE/POST без body + Content-Type: application/json даёт у Fastify FST_ERR_CTP_EMPTY_JSON_BODY.
   */
  const authHeaders = useCallback((includeJsonContentType = false): HeadersInit => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    if (includeJsonContentType) h["Content-Type"] = "application/json";
    return h;
  }, [token]);

  const loadStats = useCallback(async () => {
    if (!token) return;
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/stats`, { headers: authHeaders() });
    const j = (await r.json()) as AdminStats & { error?: { message?: string } };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      return;
    }
    setStats({
      usersCount: j.usersCount,
      coinsEarnedTotal: j.coinsEarnedTotal,
      activeGiveaways: j.activeGiveaways,
      giveawayEntriesTotal: j.giveawayEntriesTotal,
    });
  }, [token, authHeaders]);

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

  const loadAdminUsers = useCallback(
    async (offset: number) => {
      if (!token) return;
      setErr(null);
      const r = await fetch(
        `${apiBase()}/api/admin/users?limit=${USERS_PAGE}&offset=${offset}`,
        { headers: authHeaders() }
      );
      const j = (await r.json()) as {
        users?: AdminUserRow[];
        total?: number;
        error?: { message?: string };
      };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setAdminUsers(j.users ?? []);
      setUsersTotal(j.total ?? 0);
    },
    [token, authHeaders]
  );

  const loadGiveawayDetail = useCallback(
    async (id: string) => {
      if (!token) return;
      setDetailLoading(true);
      setErr(null);
      const r = await fetch(`${apiBase()}/api/admin/giveaways/${id}`, {
        headers: authHeaders(),
      });
      const j = (await r.json()) as GiveawayDetailResponse & { error?: { message?: string } };
      setDetailLoading(false);
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        return;
      }
      setDetail(j);
    },
    [token, authHeaders]
  );

  useEffect(() => {
    if (token) {
      void loadStats();
      void loadGiveaways();
      void loadPromos();
    }
  }, [token, loadStats, loadGiveaways, loadPromos]);

  useEffect(() => {
    if (token && tab === "users") void loadAdminUsers(usersOffset);
  }, [token, tab, usersOffset, loadAdminUsers]);

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
    setStats(null);
    setExpandedId(null);
    setDetail(null);
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
        winnerCount: gwWinnerCount,
        ticketPriceCoins: gwTicketPrice,
      };
      if (gwImage.trim()) body.imageUrl = gwImage.trim();
      if (gwDescription.trim()) body.description = gwDescription.trim();
      const r = await fetch(`${apiBase()}/api/admin/giveaways`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { id?: string; error?: { message?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        return;
      }
      setGwTitle("");
      setGwPrize("");
      setGwDescription("");
      await loadGiveaways();
      await loadStats();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function deleteGiveaway(id: string) {
    if (!token) return;
    if (!window.confirm("Удалить розыгрыш и всех участников?")) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/giveaways/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        return;
      }
      if (expandedId === id) {
        setExpandedId(null);
        setDetail(null);
      }
      await loadGiveaways();
      await loadStats();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function drawWinners(id: string) {
    if (!token) return;
    setDrawLoadingId(id);
    setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/giveaways/${id}/draw`, {
        method: "POST",
        headers: authHeaders(),
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        return;
      }
      await loadGiveaways();
      await loadStats();
      if (expandedId === id) await loadGiveawayDetail(id);
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setDrawLoadingId(null);
    }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    await loadGiveawayDetail(id);
  }

  async function createPromo(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/promos`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          code: promoCode.trim(),
          rewardCoins: promoReward,
          maxUses: promoMaxUses,
          active: true,
          creditPlatform: promoCreditPlatform,
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

      <nav className="admin-tabs" aria-label="Разделы">
        <button
          type="button"
          className={tab === "giveaways" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setTab("giveaways")}
        >
          Розыгрыши
        </button>
        <button
          type="button"
          className={tab === "promos" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setTab("promos")}
        >
          Промокоды
        </button>
        <button
          type="button"
          className={tab === "users" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => {
            setTab("users");
            setUsersOffset(0);
          }}
        >
          Пользователи
        </button>
      </nav>

      <h2>Статистика</h2>
      {stats === null ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <div className="admin-stats">
          <div className="admin-stat">
            <span className="admin-stat__label">Пользователей</span>
            <span className="admin-stat__val">{stats.usersCount.toLocaleString("ru-RU")}</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat__label">Монет заработано (всего)</span>
            <span className="admin-stat__val">{stats.coinsEarnedTotal.toLocaleString("ru-RU")}</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat__label">Активных розыгрышей</span>
            <span className="admin-stat__val">{stats.activeGiveaways}</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat__label">Участий в розыгрышах</span>
            <span className="admin-stat__val">{stats.giveawayEntriesTotal.toLocaleString("ru-RU")}</span>
          </div>
        </div>
      )}

      {tab === "giveaways" ? (
        <>
      <h2>Розыгрыши</h2>
      <form className="card stack" onSubmit={createGiveaway}>
        <div>
          <label htmlFor="gtitle">Заголовок</label>
          <input id="gtitle" value={gwTitle} onChange={(e) => setGwTitle(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="gprize">Кратко о призах (строка)</label>
          <input id="gprize" value={gwPrize} onChange={(e) => setGwPrize(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="gdesc">Описание / правила (необязательно)</label>
          <textarea
            id="gdesc"
            value={gwDescription}
            onChange={(e) => setGwDescription(e.target.value)}
            placeholder="Текст для карточки розыгрыша"
          />
        </div>
        <div className="row">
          <div>
            <label htmlFor="gwin">Число победителей</label>
            <input
              id="gwin"
              type="number"
              min={1}
              max={100}
              value={gwWinnerCount}
              onChange={(e) => setGwWinnerCount(Number(e.target.value))}
              required
            />
          </div>
          <div>
            <label htmlFor="gticket">Цена билета (монеты платформы, 0 = бесплатно)</label>
            <input
              id="gticket"
              type="number"
              min={0}
              value={gwTicketPrice}
              onChange={(e) => setGwTicketPrice(Number(e.target.value))}
              required
            />
          </div>
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start", justifyContent: "space-between" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <strong>{g.title}</strong>
                  <div className="muted">{g.prizeText}</div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    до {new Date(g.endsAt).toLocaleString("ru-RU")} ·{" "}
                    {g.active ? "активен" : "выкл"} · участников {g.participantCount} · победителей{" "}
                    {g.winnerCount}
                    {g.ticketPriceCoins > 0 ? ` · билет ${g.ticketPriceCoins} мон.` : " · бесплатно"}
                    {g.drawnAt ? ` · розыгрыш ${new Date(g.drawnAt).toLocaleString("ru-RU")}` : ""}
                  </div>
                  {!g.drawnAt &&
                  g.participantCount > 0 &&
                  g.participantCount < g.winnerCount ? (
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      Для кнопки «Выбрать победителей» нужно не меньше {g.winnerCount} участников.
                    </p>
                  ) : null}
                </div>
                <div className="admin-actions">
                  <button type="button" className="secondary" onClick={() => void toggleExpand(g.id)}>
                    {expandedId === g.id ? "Свернуть" : "Участники"}
                  </button>
                  {!g.drawnAt && g.participantCount >= g.winnerCount ? (
                    <button
                      type="button"
                      className="primary"
                      disabled={drawLoadingId === g.id || loading}
                      onClick={() => void drawWinners(g.id)}
                    >
                      {drawLoadingId === g.id ? "…" : "Выбрать победителей"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary"
                    disabled={loading}
                    onClick={() => void deleteGiveaway(g.id)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
              {expandedId === g.id && (
                <div className="giveaway-admin-detail" style={{ marginTop: 12 }}>
                  {detailLoading ? (
                    <p className="muted">Загрузка списка…</p>
                  ) : detail && detail.giveaway.id === g.id ? (
                    <>
                      <p className="muted" style={{ marginTop: 0 }}>
                        Участники ({detail.participants.length})
                      </p>
                      <ul className="admin-userlist">
                        {detail.participants.length === 0 ? (
                          <li className="muted">Пока никто не участвует.</li>
                        ) : (
                          detail.participants.map((p) => (
                            <li key={p.userId}>
                              <strong>{p.username}</strong>
                              <span className="muted"> · {new Date(p.joinedAt).toLocaleString("ru-RU")}</span>
                            </li>
                          ))
                        )}
                      </ul>
                      {detail.publicSnapshot?.winners && detail.publicSnapshot.winners.length > 0 ? (
                        <>
                          <p className="muted">Победители</p>
                          <ul className="admin-userlist">
                            {detail.publicSnapshot.winners.map((w) => (
                              <li key={w.rank}>
                                {w.rank}. <strong>{w.username}</strong>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="muted">Нет данных</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
        </>
      ) : null}

      {tab === "promos" ? (
        <>
      <h2 style={{ marginTop: 0 }}>Промокоды</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Код вводят на главной. Куда начислить монеты: <strong>50/50</strong> — как раньше;{" "}
        <strong>Twitch</strong> / <strong>Kick</strong> — весь бонус на счёт платформы. Макс. активаций{" "}
        <strong>0</strong> = без лимита.
      </p>
      <form className="card stack" onSubmit={createPromo}>
        <div>
          <label htmlFor="pcredit">Куда начислить бонус</label>
          <select
            id="pcredit"
            value={promoCreditPlatform}
            onChange={(e) =>
              setPromoCreditPlatform(e.target.value as "split" | "twitch" | "kick")
            }
          >
            <option value="split">50/50 Twitch и Kick</option>
            <option value="twitch">Только Twitch</option>
            <option value="kick">Только Kick</option>
          </select>
        </div>
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
              <strong>{p.code}</strong> — {p.rewardCoins} мон. ·{" "}
              {(p.creditPlatform ?? "split") === "twitch"
                ? "Twitch"
                : (p.creditPlatform ?? "split") === "kick"
                  ? "Kick"
                  : "50/50"}
              {" · "}
              активаций {p.usesCount}
              {p.maxUses > 0 ? ` / ${p.maxUses}` : " / ∞"} ·{" "}
              {p.active ? "активен" : "выкл"}
            </li>
          ))}
        </ul>
      )}
        </>
      ) : null}

      {tab === "users" ? (
        <>
          <h2 style={{ marginTop: 0 }}>Пользователи</h2>
          <p className="muted">Балансы и рефералы (по дате регистрации, новые сверху).</p>
          {adminUsers === null ? (
            <p className="muted">Загрузка…</p>
          ) : (
            <>
              <div className="admin-users-wrap">
                <table className="admin-users-table">
                  <thead>
                    <tr>
                      <th>Пользователь</th>
                      <th>TG ID</th>
                      <th>Всего монет</th>
                      <th>Twitch</th>
                      <th>Kick</th>
                      <th>Заработано всего</th>
                      <th>Twitch всего</th>
                      <th>Kick всего</th>
                      <th>Рефералов</th>
                      <th>Регистрация</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>
                            {u.username
                              ? `@${u.username}`
                              : u.firstName || `${u.id.slice(0, 8)}…`}
                          </strong>
                        </td>
                        <td className="mono">{u.telegramId}</td>
                        <td>{u.coins.toLocaleString("ru-RU")}</td>
                        <td>{u.twitchCoins.toLocaleString("ru-RU")}</td>
                        <td>{u.kickCoins.toLocaleString("ru-RU")}</td>
                        <td>{u.lifetimeEarned.toLocaleString("ru-RU")}</td>
                        <td>{u.twitchLifetimeEarned.toLocaleString("ru-RU")}</td>
                        <td>{u.kickLifetimeEarned.toLocaleString("ru-RU")}</td>
                        <td>{u.referralCount}</td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>
                          {new Date(u.createdAt).toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-users-pager">
                <button
                  type="button"
                  className="secondary"
                  disabled={usersOffset <= 0}
                  onClick={() => setUsersOffset(Math.max(0, usersOffset - USERS_PAGE))}
                >
                  Назад
                </button>
                <span className="muted">
                  {usersOffset + 1}–{Math.min(usersOffset + adminUsers.length, usersTotal)} из{" "}
                  {usersTotal}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={usersOffset + adminUsers.length >= usersTotal}
                  onClick={() => setUsersOffset(usersOffset + USERS_PAGE)}
                >
                  Далее
                </button>
              </div>
            </>
          )}
        </>
      ) : null}
    </>
  );
}
