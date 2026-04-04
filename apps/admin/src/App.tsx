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
  platform: string;
  active: boolean;
  sortOrder: number;
  winnerCount: number;
  ticketPriceCoins: number;
  drawnAt: string | null;
  participantCount: number;
  requireChannelSubscription: boolean;
  telegramChannelId: string | null;
  channelInviteUrl: string | null;
};

type PromoRow = {
  id: string;
  displayName: string | null;
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
  banned?: boolean;
  banReason?: string | null;
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
    requireChannelSubscription: boolean;
    telegramChannelId: string | null;
    channelInviteUrl: string | null;
  };
  participants: GiveawayParticipant[];
  publicSnapshot: {
    winners: { rank: number; username: string }[];
  } | null;
};

type AdminDropStatus = {
  active: boolean;
  drop: {
    id: string;
    platform: string;
    code: string;
    rewardMin: number;
    rewardMax: number;
    maxWinners: number;
    winnersCount: number;
    startedAt: string;
    endsAt: string;
  } | null;
};

type BanAppealRow = {
  id: string;
  userId: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  message: string;
  status: string;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type AdminTaskRow = {
  id: string;
  title: string;
  description: string;
  reward: number;
  platform: string;
  type: string;
  validationType: string;
  meta: unknown;
  active: boolean;
};

type PredictionPlatformRow = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
};

type PredictionRow = {
  id: string;
  title: string;
  status: "draft" | "active" | "paused" | "closed" | "resolved";
  optionA: string;
  optionB: string;
  platform: { id: string; type: string; name: string };
  totalPool: number;
  optionAPool: number;
  optionBPool: number;
  participantsA: number;
  participantsB: number;
  winnerOption: "A" | "B" | null;
  autoCloseAt?: string | null;
  bettingDurationSec?: number;
};

function AdminSkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="admin-skeleton-list" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="admin-skeleton-row" />
      ))}
    </div>
  );
}

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
  const [gwRequireChannel, setGwRequireChannel] = useState(false);
  const [gwTelegramChannelId, setGwTelegramChannelId] = useState("");
  const [gwChannelInviteUrl, setGwChannelInviteUrl] = useState("");
  const [gwPlatform, setGwPlatform] = useState<"twitch" | "kick" | "both">("both");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GiveawayDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawLoadingId, setDrawLoadingId] = useState<string | null>(null);

  const [promoCode, setPromoCode] = useState("");
  const [promoDisplayName, setPromoDisplayName] = useState("");
  const [promoReward, setPromoReward] = useState(100);
  const [promoMaxUses, setPromoMaxUses] = useState(100);
  const [promoCreditPlatform, setPromoCreditPlatform] = useState<"split" | "twitch" | "kick">("split");

  const [tab, setTab] = useState<
    | "giveaways"
    | "promos"
    | "users"
    | "drops"
    | "live"
    | "tasks"
    | "appeals"
    | "predictions"
  >("giveaways");
  const [banAppeals, setBanAppeals] = useState<BanAppealRow[] | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[] | null>(null);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const USERS_PAGE = 50;

  const [dropStatus, setDropStatus] = useState<AdminDropStatus | null>(null);
  const [dropCode, setDropCode] = useState("4821");
  const [dropDurationSec, setDropDurationSec] = useState(120);
  const [dropMaxWinners, setDropMaxWinners] = useState(100);
  const [dropRewardMin, setDropRewardMin] = useState(0);
  const [dropRewardMax, setDropRewardMax] = useState(100);
  const [dropPlatform, setDropPlatform] = useState<"twitch" | "kick" | "both">(
    "both"
  );

  type AdminLiveBroadcast =
    | { active: false }
    | {
        active: true;
        id: string;
        platform: string;
        streamUrl: string;
        vpnNote: string | null;
        startedAt: string;
      };
  const [liveBroadcastStatus, setLiveBroadcastStatus] =
    useState<AdminLiveBroadcast | null>(null);
  const [liveStartPlatform, setLiveStartPlatform] = useState<"twitch" | "kick">(
    "kick"
  );
  const [liveStartUrl, setLiveStartUrl] = useState("");
  const [liveStartVpn, setLiveStartVpn] = useState("");

  const [adminTasks, setAdminTasks] = useState<AdminTaskRow[] | null>(null);
  const [taskEditingId, setTaskEditingId] = useState<string | null>(null);
  const [taskFormId, setTaskFormId] = useState("");
  const [taskFormTitle, setTaskFormTitle] = useState("");
  const [taskFormDescription, setTaskFormDescription] = useState("");
  const [taskFormReward, setTaskFormReward] = useState(10);
  const [taskFormPlatform, setTaskFormPlatform] = useState<
    "twitch" | "kick" | "global" | "telegram"
  >("kick");
  const [taskFormType, setTaskFormType] = useState<"daily" | "one-time">("daily");
  const [taskFormValidation, setTaskFormValidation] = useState<"api" | "manual">(
    "manual"
  );
  const [taskFormActionUrl, setTaskFormActionUrl] = useState("");
  const [taskFormActionLabel, setTaskFormActionLabel] = useState("");
  const [taskFormVerifyLabel, setTaskFormVerifyLabel] = useState("");
  const [taskFormHelpTitle, setTaskFormHelpTitle] = useState("");
  const [taskFormHelpBody, setTaskFormHelpBody] = useState("");
  const [taskFormHelpIcon, setTaskFormHelpIcon] = useState<
    "" | "tv" | "gift" | "help" | "radio"
  >("");
  const [taskFormMetaJson, setTaskFormMetaJson] = useState("{}");
  const [predictionPlatforms, setPredictionPlatforms] = useState<PredictionPlatformRow[] | null>(null);
  const [predictions, setPredictions] = useState<PredictionRow[] | null>(null);
  const [predictionTitle, setPredictionTitle] = useState("");
  const [predictionOptionA, setPredictionOptionA] = useState("");
  const [predictionOptionB, setPredictionOptionB] = useState("");
  const [predictionPlatformType, setPredictionPlatformType] = useState("twitch");
  const [predictionBettingDurationSec, setPredictionBettingDurationSec] = useState(40);
  const [statsLoading, setStatsLoading] = useState(false);
  const [giveawaysLoading, setGiveawaysLoading] = useState(false);
  const [promosLoading, setPromosLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [dropStatusLoading, setDropStatusLoading] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [predictionPlatformsLoading, setPredictionPlatformsLoading] = useState(false);
  const [predictionsLoading, setPredictionsLoading] = useState(false);

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
    setStatsLoading(true);
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/stats`, { headers: authHeaders() });
    const j = (await r.json()) as AdminStats & { error?: { message?: string } };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setStatsLoading(false);
      return;
    }
    setStats({
      usersCount: j.usersCount,
      coinsEarnedTotal: j.coinsEarnedTotal,
      activeGiveaways: j.activeGiveaways,
      giveawayEntriesTotal: j.giveawayEntriesTotal,
    });
    setStatsLoading(false);
  }, [token, authHeaders]);

  const loadGiveaways = useCallback(async () => {
    if (!token) return;
    setGiveawaysLoading(true);
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/giveaways`, { headers: authHeaders() });
    const j = (await r.json()) as { giveaways?: GiveawayRow[]; error?: { message?: string } };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setGiveawaysLoading(false);
      return;
    }
    setGiveaways(j.giveaways ?? []);
    setGiveawaysLoading(false);
  }, [token, authHeaders]);

  const loadPromos = useCallback(async () => {
    if (!token) return;
    setPromosLoading(true);
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/promos`, { headers: authHeaders() });
    const j = (await r.json()) as { promos?: PromoRow[]; error?: { message?: string } };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setPromosLoading(false);
      return;
    }
    setPromos(j.promos ?? []);
    setPromosLoading(false);
  }, [token, authHeaders]);

  const loadAdminUsers = useCallback(
    async (offset: number) => {
      if (!token) return;
      setUsersLoading(true);
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
        setUsersLoading(false);
        return;
      }
      setAdminUsers(j.users ?? []);
      setUsersTotal(j.total ?? 0);
      setUsersLoading(false);
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

  const loadDropStatus = useCallback(async () => {
    if (!token) return;
    setDropStatusLoading(true);
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/drops`, { headers: authHeaders() });
    const j = (await r.json()) as AdminDropStatus & { error?: { message?: string } };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setDropStatusLoading(false);
      return;
    }
    setDropStatus({ active: j.active, drop: j.drop ?? null });
    setDropStatusLoading(false);
  }, [token, authHeaders]);

  const loadLiveBroadcast = useCallback(async () => {
    if (!token) return;
    setLiveLoading(true);
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/live-broadcast`, {
      headers: authHeaders(),
    });
    const j = (await r.json()) as AdminLiveBroadcast & {
      error?: { message?: string };
    };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setLiveLoading(false);
      return;
    }
    setLiveBroadcastStatus(j.active ? j : { active: false });
    setLiveLoading(false);
  }, [token, authHeaders]);

  const loadAdminTasks = useCallback(async () => {
    if (!token) return;
    setTasksLoading(true);
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/tasks`, { headers: authHeaders() });
    const j = (await r.json()) as {
      tasks?: AdminTaskRow[];
      error?: { message?: string };
    };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setTasksLoading(false);
      return;
    }
    setAdminTasks(j.tasks ?? []);
    setTasksLoading(false);
  }, [token, authHeaders]);

  const loadPredictionPlatforms = useCallback(async () => {
    if (!token) return;
    setPredictionPlatformsLoading(true);
    const r = await fetch(`${apiBase()}/api/admin/predictions/platforms`, {
      headers: authHeaders(),
    });
    const j = (await r.json()) as {
      platforms?: PredictionPlatformRow[];
      error?: { message?: string };
    };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setPredictionPlatformsLoading(false);
      return;
    }
    setPredictionPlatforms(j.platforms ?? []);
    if ((j.platforms ?? []).length > 0 && !predictionPlatformType) {
      setPredictionPlatformType((j.platforms ?? [])[0]!.type);
    }
    setPredictionPlatformsLoading(false);
  }, [token, authHeaders, predictionPlatformType]);

  const loadPredictions = useCallback(async () => {
    if (!token) return;
    setPredictionsLoading(true);
    const r = await fetch(`${apiBase()}/api/admin/predictions`, {
      headers: authHeaders(),
    });
    const j = (await r.json()) as {
      predictions?: PredictionRow[];
      error?: { message?: string };
    };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setPredictionsLoading(false);
      return;
    }
    setPredictions(j.predictions ?? []);
    setPredictionsLoading(false);
  }, [token, authHeaders]);

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

  useEffect(() => {
    if (token && tab === "drops") void loadDropStatus();
  }, [token, tab, loadDropStatus]);

  useEffect(() => {
    if (token && tab === "live") void loadLiveBroadcast();
  }, [token, tab, loadLiveBroadcast]);

  useEffect(() => {
    if (token && tab === "tasks") void loadAdminTasks();
  }, [token, tab, loadAdminTasks]);

  useEffect(() => {
    if (token && tab === "predictions") {
      void loadPredictionPlatforms();
      void loadPredictions();
    }
  }, [token, tab, loadPredictionPlatforms, loadPredictions]);

  const loadBanAppeals = useCallback(async () => {
    if (!token) return;
    setAppealsLoading(true);
    setErr(null);
    const r = await fetch(`${apiBase()}/api/admin/ban-appeals`, { headers: authHeaders() });
    const j = (await r.json()) as {
      appeals?: BanAppealRow[];
      error?: { message?: string };
    };
    if (!r.ok) {
      setErr(j.error?.message ?? `Ошибка ${r.status}`);
      if (r.status === 401) setToken(null);
      setAppealsLoading(false);
      return;
    }
    setBanAppeals(j.appeals ?? []);
    setAppealsLoading(false);
  }, [token, authHeaders]);

  useEffect(() => {
    if (token && tab === "appeals") void loadBanAppeals();
  }, [token, tab, loadBanAppeals]);

  useEffect(() => {
    if (taskFormPlatform !== "telegram") return;
    setTaskFormValidation((v) => (v === "api" ? "manual" : v));
  }, [taskFormPlatform]);

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
    setBanAppeals(null);
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
        platform: gwPlatform,
      };
      if (gwImage.trim()) body.imageUrl = gwImage.trim();
      if (gwDescription.trim()) body.description = gwDescription.trim();
      if (gwRequireChannel) {
        body.requireChannelSubscription = true;
        body.telegramChannelId = gwTelegramChannelId.trim();
        body.channelInviteUrl = gwChannelInviteUrl.trim();
      }
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
          displayName: promoDisplayName.trim() || null,
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
      setPromoDisplayName("");
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
        <form className="card stack admin-mt-4" onSubmit={login}>
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
      <div className="row admin-flex-between">
        <h1 className="admin-h1-title">Админка</h1>
        <button type="button" className="secondary" onClick={logout}>
          Выйти
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}

      <p className="muted admin-tabs-hint">
        Все разделы в ряд — при узком экране прокрутите вкладки вправо (Задания, Дропы, …).
      </p>

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
          className={tab === "drops" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setTab("drops")}
        >
          Дропы
        </button>
        <button
          type="button"
          className={tab === "live" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setTab("live")}
        >
          Эфир
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
        <button
          type="button"
          className={tab === "appeals" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setTab("appeals")}
        >
          Апелляции
        </button>
        <button
          type="button"
          className={tab === "tasks" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setTab("tasks")}
        >
          Задания
        </button>
        <button
          type="button"
          className={tab === "predictions" ? "admin-tab admin-tab--active" : "admin-tab"}
          onClick={() => setTab("predictions")}
        >
          Предикты
        </button>
      </nav>

      <h2>Статистика</h2>
      {stats === null ? (
        <AdminSkeletonRows rows={4} />
      ) : (
        <>
          {statsLoading ? <p className="muted admin-refreshing">Обновляем статистику…</p> : null}
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
        </>
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
          <label htmlFor="gplat">Платформа</label>
          <select
            id="gplat"
            value={gwPlatform}
            onChange={(e) =>
              setGwPlatform(e.target.value as "twitch" | "kick" | "both")
            }
          >
            <option value="both">Twitch + Kick (обе)</option>
            <option value="twitch">Только Twitch</option>
            <option value="kick">Только Kick</option>
          </select>
          <p className="muted admin-m-0" style={{ fontSize: 12, marginTop: 6 }}>
            Участник должен иметь OAuth выбранной платформы в профиле.
          </p>
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
        <div className="admin-field-full">
          <span className="admin-field-label">Условие участия</span>
          <label className="admin-checkbox-row">
            <input
              type="checkbox"
              checked={gwRequireChannel}
              onChange={(e) => setGwRequireChannel(e.target.checked)}
            />
            <span className="admin-checkbox-row__text">
              Подписка на Telegram-канал (проверка через getChatMember; бот должен быть
              администратором канала)
            </span>
          </label>
        </div>
        {gwRequireChannel ? (
          <>
            <div>
              <label htmlFor="gch">ID канала для API</label>
              <input
                id="gch"
                value={gwTelegramChannelId}
                onChange={(e) => setGwTelegramChannelId(e.target.value)}
                placeholder="@channelname или -1001234567890"
                required
              />
              <p className="muted admin-hint-sm">
                Тот же идентификатор, что в getChatMember. Канал должен добавить бота администратором.
              </p>
            </div>
            <div>
              <label htmlFor="gchurl">Ссылка для пользователя</label>
              <input
                id="gchurl"
                type="text"
                value={gwChannelInviteUrl}
                onChange={(e) => setGwChannelInviteUrl(e.target.value)}
                placeholder="https://t.me/channel или t.me/+invite"
                required
              />
            </div>
          </>
        ) : null}
        <button type="submit" className="primary" disabled={loading}>
          Создать розыгрыш
        </button>
      </form>

      {giveaways === null ? (
        <AdminSkeletonRows rows={4} />
      ) : giveaways.length === 0 ? (
        <p className="muted">Пока нет розыгрышей.</p>
      ) : (
        <>
          {giveawaysLoading ? <p className="muted admin-refreshing">Обновляем список розыгрышей…</p> : null}
          <ul className="list">
          {giveaways.map((g) => (
            <li key={g.id}>
              <div className="admin-gw-row">
                <div className="admin-gw-main">
                  <strong>{g.title}</strong>
                  <div className="muted">{g.prizeText}</div>
                  <div className="muted admin-muted-gap">
                    до {new Date(g.endsAt).toLocaleString("ru-RU")} ·{" "}
                    {g.active ? "активен" : "выкл"} · участников {g.participantCount} · победителей{" "}
                    {g.winnerCount}
                    {g.ticketPriceCoins > 0 ? ` · билет ${g.ticketPriceCoins} мон.` : " · бесплатно"}
                    {g.requireChannelSubscription ? " · подписка на канал" : ""}
                    {g.drawnAt ? ` · розыгрыш ${new Date(g.drawnAt).toLocaleString("ru-RU")}` : ""}
                  </div>
                  {!g.drawnAt &&
                  g.participantCount > 0 &&
                  g.participantCount < g.winnerCount ? (
                    <p className="muted admin-hint-sm">
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
                <div className="giveaway-admin-detail admin-detail-block">
                  {detailLoading ? (
                    <AdminSkeletonRows rows={2} />
                  ) : detail && detail.giveaway.id === g.id ? (
                    <>
                      <p className="muted admin-mt-0">
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
        </>
      )}
        </>
      ) : null}

      {tab === "promos" ? (
        <>
      <h2 className="admin-mt-0">Промокоды</h2>
      <p className="muted admin-mt-0">
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
          <label htmlFor="pname">Название (необязательно, можно дублировать)</label>
          <input
            id="pname"
            value={promoDisplayName}
            onChange={(e) => setPromoDisplayName(e.target.value)}
            placeholder="Летняя акция"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="pcode">Код (уникален)</label>
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
              min={0}
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
        <AdminSkeletonRows rows={3} />
      ) : promos.length === 0 ? (
        <p className="muted">Промокодов пока нет.</p>
      ) : (
        <>
          {promosLoading ? <p className="muted admin-refreshing">Обновляем промокоды…</p> : null}
          <ul className="list">
          {promos.map((p) => (
            <li key={p.id}>
              {p.displayName ? (
                <span className="muted">{p.displayName} · </span>
              ) : null}
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
        </>
      )}
        </>
      ) : null}

      {tab === "users" ? (
        <>
          <h2 className="admin-mt-0">Пользователи</h2>
          <p className="muted">Балансы и рефералы (по дате регистрации, новые сверху).</p>
          {adminUsers === null ? (
            <AdminSkeletonRows rows={5} />
          ) : (
            <>
              {usersLoading ? <p className="muted admin-refreshing">Обновляем список пользователей…</p> : null}
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
                      <th>Бан</th>
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
                          {u.banned === true ? (
                            <span className="admin-user-banned"> заблокирован</span>
                          ) : null}
                        </td>
                        <td className="mono">{u.telegramId}</td>
                        <td>{u.coins.toLocaleString("ru-RU")}</td>
                        <td>{u.twitchCoins.toLocaleString("ru-RU")}</td>
                        <td>{u.kickCoins.toLocaleString("ru-RU")}</td>
                        <td>{u.lifetimeEarned.toLocaleString("ru-RU")}</td>
                        <td>{u.twitchLifetimeEarned.toLocaleString("ru-RU")}</td>
                        <td>{u.kickLifetimeEarned.toLocaleString("ru-RU")}</td>
                        <td>{u.referralCount}</td>
                        <td className="muted admin-table-nowrap">
                          {new Date(u.createdAt).toLocaleString("ru-RU")}</td>
                        <td>
                          {u.banned === true ? (
                            <button
                              type="button"
                              className="secondary"
                              disabled={loading}
                              onClick={async () => {
                                if (!token) return;
                                if (!window.confirm("Снять блокировку с пользователя?")) return;
                                setLoading(true);
                                setErr(null);
                                try {
                                  const r = await fetch(
                                    `${apiBase()}/api/admin/users/${encodeURIComponent(u.id)}`,
                                    {
                                      method: "PATCH",
                                      headers: authHeaders(true),
                                      body: JSON.stringify({ banned: false, banReason: null }),
                                    }
                                  );
                                  const j = (await r.json()) as { error?: { message?: string } };
                                  if (!r.ok) {
                                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                    return;
                                  }
                                  await loadAdminUsers(usersOffset);
                                } catch {
                                  setErr("Сеть недоступна");
                                } finally {
                                  setLoading(false);
                                }
                              }}
                            >
                              Разбан
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary"
                              disabled={loading}
                              onClick={async () => {
                                if (!token) return;
                                if (
                                  !window.confirm(
                                    `Заблокировать доступ к мини-приложению для TG ${u.telegramId}?`
                                  )
                                ) {
                                  return;
                                }
                                const reason =
                                  window.prompt("Причина (необязательно)")?.trim() || null;
                                setLoading(true);
                                setErr(null);
                                try {
                                  const r = await fetch(
                                    `${apiBase()}/api/admin/users/${encodeURIComponent(u.id)}`,
                                    {
                                      method: "PATCH",
                                      headers: authHeaders(true),
                                      body: JSON.stringify({
                                        banned: true,
                                        banReason: reason,
                                      }),
                                    }
                                  );
                                  const j = (await r.json()) as { error?: { message?: string } };
                                  if (!r.ok) {
                                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                    return;
                                  }
                                  await loadAdminUsers(usersOffset);
                                } catch {
                                  setErr("Сеть недоступна");
                                } finally {
                                  setLoading(false);
                                }
                              }}
                            >
                              Бан
                            </button>
                          )}
                        </td>
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

      {tab === "appeals" ? (
        <>
          <h2 className="admin-mt-0">Апелляции на блокировку</h2>
          <p className="muted">
            Тексты от заблокированных пользователей. После проверки отметьте апелляцию как
            рассмотренную — пользователь увидит статус при следующем обновлении (ожидание снято
            после пометки).
          </p>
          {banAppeals === null ? (
            <AdminSkeletonRows rows={3} />
          ) : banAppeals.length === 0 ? (
            <p className="muted">Пока нет апелляций.</p>
          ) : (
            <>
              {appealsLoading ? <p className="muted admin-refreshing">Обновляем апелляции…</p> : null}
              <ul className="list admin-appeals-list">
              {banAppeals.map((a) => (
                <li key={a.id} className="admin-appeal-card">
                  <div className="admin-appeal-head">
                    <strong>
                      {a.username ? `@${a.username}` : a.firstName || "Без имени"}
                    </strong>
                    <span className="muted mono">tg:{a.telegramId}</span>
                  </div>
                  <p className="muted admin-appeal-date">
                    {new Date(a.createdAt).toLocaleString("ru-RU")} · статус: {a.status}
                  </p>
                  <p className="admin-appeal-msg">{a.message}</p>
                  {a.status === "pending" ? (
                    <button
                      type="button"
                      className="primary"
                      disabled={loading}
                      onClick={async () => {
                        const note = window.prompt(
                          "Заметка для себя (необязательно), затем ОК — апелляция помечена как рассмотренная"
                        );
                        if (note === null) return;
                        if (!token) return;
                        setLoading(true);
                        setErr(null);
                        try {
                          const r = await fetch(
                            `${apiBase()}/api/admin/ban-appeals/${encodeURIComponent(a.id)}`,
                            {
                              method: "PATCH",
                              headers: authHeaders(true),
                              body: JSON.stringify({
                                adminNote: note.trim() ? note.trim() : null,
                              }),
                            }
                          );
                          const j = (await r.json()) as { error?: { message?: string } };
                          if (!r.ok) {
                            setErr(j.error?.message ?? `Ошибка ${r.status}`);
                            return;
                          }
                          await loadBanAppeals();
                        } catch {
                          setErr("Сеть недоступна");
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      Пометить рассмотренной
                    </button>
                  ) : (
                    <p className="muted admin-appeal-note">
                      {a.reviewedAt
                        ? `Рассмотрено: ${new Date(a.reviewedAt).toLocaleString("ru-RU")}`
                        : null}
                      {a.adminNote ? ` · ${a.adminNote}` : ""}
                    </p>
                  )}
                </li>
              ))}
              </ul>
            </>
          )}
        </>
      ) : null}

      {tab === "tasks" ? (
        <>
          <h2 className="admin-mt-0">Задания</h2>
          <p className="muted">
            Создание и правка заданий для мини-приложения. Поля «ссылка / кнопки / справка» попадают в{" "}
            <code>meta</code> и отображаются в модалке. Для проверки Helix/Kick укажите{" "}
            <code>helix</code> / <code>kick</code> в JSON. Telegram — только ручная проверка.
          </p>
          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!token) return;
              let meta: Record<string, unknown> = {};
              try {
                meta = JSON.parse(taskFormMetaJson.trim() || "{}") as Record<string, unknown>;
              } catch {
                setErr("meta: невалидный JSON");
                return;
              }
              if (taskFormActionUrl.trim()) meta.actionUrl = taskFormActionUrl.trim();
              else delete meta.actionUrl;
              if (taskFormActionLabel.trim()) meta.actionLabel = taskFormActionLabel.trim();
              else delete meta.actionLabel;
              if (taskFormVerifyLabel.trim()) meta.verifyLabel = taskFormVerifyLabel.trim();
              else delete meta.verifyLabel;
              if (taskFormHelpTitle.trim() && taskFormHelpBody.trim()) {
                meta.help = {
                  title: taskFormHelpTitle.trim(),
                  body: taskFormHelpBody.trim(),
                  ...(taskFormHelpIcon ? { icon: taskFormHelpIcon } : {}),
                };
              } else delete meta.help;

              setLoading(true);
              setErr(null);
              try {
                if (taskEditingId) {
                  const r = await fetch(`${apiBase()}/api/admin/tasks/${encodeURIComponent(taskEditingId)}`, {
                    method: "PUT",
                    headers: authHeaders(true),
                    body: JSON.stringify({
                      title: taskFormTitle,
                      description: taskFormDescription,
                      reward: taskFormReward,
                      platform: taskFormPlatform,
                      type: taskFormType,
                      validationType: taskFormValidation,
                      meta,
                      active: true,
                    }),
                  });
                  const j = (await r.json()) as { error?: { message?: string } };
                  if (!r.ok) {
                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                    return;
                  }
                } else {
                  const r = await fetch(`${apiBase()}/api/admin/tasks`, {
                    method: "POST",
                    headers: authHeaders(true),
                    body: JSON.stringify({
                      id: taskFormId.trim(),
                      title: taskFormTitle,
                      description: taskFormDescription,
                      reward: taskFormReward,
                      platform: taskFormPlatform,
                      type: taskFormType,
                      validationType: taskFormValidation,
                      meta,
                      active: true,
                    }),
                  });
                  const j = (await r.json()) as { error?: { message?: string } };
                  if (!r.ok) {
                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                    return;
                  }
                }
                setTaskEditingId(null);
                setTaskFormId("");
                setTaskFormTitle("");
                setTaskFormDescription("");
                setTaskFormReward(10);
                setTaskFormPlatform("kick");
                setTaskFormType("daily");
                setTaskFormValidation("manual");
                setTaskFormActionUrl("");
                setTaskFormActionLabel("");
                setTaskFormVerifyLabel("");
                setTaskFormHelpTitle("");
                setTaskFormHelpBody("");
                setTaskFormHelpIcon("");
                setTaskFormMetaJson("{}");
                await loadAdminTasks();
              } catch {
                setErr("Сеть недоступна");
              } finally {
                setLoading(false);
              }
            }}
          >
            <div>
              <label
                htmlFor="tid"
                title="Внутренний стабильный идентификатор задания в БД; после создания не меняется."
              >
                ID (латиница, без пробелов)
              </label>
              <input
                id="tid"
                value={taskFormId}
                onChange={(e) => setTaskFormId(e.target.value)}
                disabled={taskEditingId != null}
                required={taskEditingId == null}
                placeholder="daily_kick_follow"
              />
            </div>
            <div>
              <label htmlFor="ttitle">Заголовок</label>
              <input
                id="ttitle"
                value={taskFormTitle}
                onChange={(e) => setTaskFormTitle(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="tdesc"
                title="Текст для пользователя: правила и что сделать для получения награды."
              >
                Описание
              </label>
              <textarea
                id="tdesc"
                value={taskFormDescription}
                onChange={(e) => setTaskFormDescription(e.target.value)}
                required
                rows={3}
              />
            </div>
            <div className="row">
              <div>
                <label htmlFor="trew">Награда (база, монет)</label>
                <input
                  id="trew"
                  type="number"
                  min={0}
                  value={taskFormReward}
                  onChange={(e) => setTaskFormReward(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="tplat"
                  title="Для какой платформы показывается задание: Twitch, Kick, общее или Telegram."
                >
                  Платформа
                </label>
                <select
                  id="tplat"
                  value={taskFormPlatform}
                  onChange={(e) =>
                    setTaskFormPlatform(
                      e.target.value as "twitch" | "kick" | "global" | "telegram"
                    )
                  }
                >
                  <option value="kick">Kick</option>
                  <option value="twitch">Twitch</option>
                  <option value="global">Global</option>
                  <option value="telegram">Telegram</option>
                </select>
              </div>
            </div>
            <div className="row">
              <div>
                <label
                  htmlFor="ttype"
                  title="daily — можно выполнять каждый день; one-time — один раз."
                >
                  Тип
                </label>
                <select
                  id="ttype"
                  value={taskFormType}
                  onChange={(e) => setTaskFormType(e.target.value as "daily" | "one-time")}
                >
                  <option value="daily">Ежедневно</option>
                  <option value="one-time">Разово</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="tval"
                  title="manual — подтверждение админом/синхронно; api — проверка через Helix/Kick и очередь."
                >
                  Проверка
                </label>
                <select
                  id="tval"
                  value={taskFormValidation}
                  onChange={(e) => setTaskFormValidation(e.target.value as "api" | "manual")}
                  disabled={taskFormPlatform === "telegram"}
                >
                  <option value="manual">Ручная / синхронно</option>
                  <option value="api">API (очередь)</option>
                </select>
              </div>
            </div>
            <div>
              <label
                htmlFor="turl"
                title="URL, куда ведёт кнопка «Подписаться» / действие в мини-приложении."
              >
                Ссылка для кнопки (meta.actionUrl)
              </label>
              <input
                id="turl"
                type="url"
                value={taskFormActionUrl}
                onChange={(e) => setTaskFormActionUrl(e.target.value)}
                placeholder="https://kick.com/…"
              />
            </div>
            <div className="row">
              <div>
                <label htmlFor="tact">Текст кнопки ссылки</label>
                <input
                  id="tact"
                  value={taskFormActionLabel}
                  onChange={(e) => setTaskFormActionLabel(e.target.value)}
                  placeholder="Подписаться на Kick"
                />
              </div>
              <div>
                <label htmlFor="tver">Текст кнопки проверки</label>
                <input
                  id="tver"
                  value={taskFormVerifyLabel}
                  onChange={(e) => setTaskFormVerifyLabel(e.target.value)}
                  placeholder="Проверить подписку"
                />
              </div>
            </div>
            <p className="muted admin-m-0">Справка (модалка как на референсе)</p>
            <div className="row">
              <div>
                <label htmlFor="tht">Заголовок справки</label>
                <input
                  id="tht"
                  value={taskFormHelpTitle}
                  onChange={(e) => setTaskFormHelpTitle(e.target.value)}
                  placeholder="Где найти промокод"
                />
              </div>
              <div>
                <label htmlFor="thic">Иконка</label>
                <select
                  id="thic"
                  value={taskFormHelpIcon}
                  onChange={(e) =>
                    setTaskFormHelpIcon(
                      e.target.value as "" | "tv" | "gift" | "help" | "radio"
                    )
                  }
                >
                  <option value="">По умолчанию</option>
                  <option value="tv">TV</option>
                  <option value="gift">Подарок</option>
                  <option value="help">Помощь</option>
                  <option value="radio">Радио</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="thb">Текст справки</label>
              <textarea
                id="thb"
                value={taskFormHelpBody}
                onChange={(e) => setTaskFormHelpBody(e.target.value)}
                rows={2}
                placeholder="Промокоды можно найти на стримах…"
              />
            </div>
            <div>
              <label htmlFor="tmeta">meta (JSON, Helix/Kick + любые поля)</label>
              <textarea
                id="tmeta"
                className="mono"
                value={taskFormMetaJson}
                onChange={(e) => setTaskFormMetaJson(e.target.value)}
                rows={6}
                spellCheck={false}
              />
            </div>
            <div className="row">
              <button type="submit" className="primary" disabled={loading}>
                {taskEditingId ? "Сохранить изменения" : "Создать задание"}
              </button>
              {taskEditingId ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setTaskEditingId(null);
                    setTaskFormId("");
                    setTaskFormTitle("");
                    setTaskFormDescription("");
                    setTaskFormReward(10);
                    setTaskFormPlatform("kick");
                    setTaskFormType("daily");
                    setTaskFormValidation("manual");
                    setTaskFormActionUrl("");
                    setTaskFormActionLabel("");
                    setTaskFormVerifyLabel("");
                    setTaskFormHelpTitle("");
                    setTaskFormHelpBody("");
                    setTaskFormHelpIcon("");
                    setTaskFormMetaJson("{}");
                  }}
                >
                  Новое (сброс)
                </button>
              ) : null}
            </div>
          </form>

          {adminTasks === null ? (
            <AdminSkeletonRows rows={4} />
          ) : adminTasks.length === 0 ? (
            <p className="muted">Пока нет заданий в БД.</p>
          ) : (
            <>
              {tasksLoading ? <p className="muted admin-refreshing">Обновляем задания…</p> : null}
              <ul className="list">
              {adminTasks.map((row) => (
                <li key={row.id}>
                  <div className="admin-gw-row">
                    <div className="admin-gw-main">
                      <strong>{row.title}</strong>{" "}
                      <span className="muted">
                        <code>{row.id}</code> · {row.platform} · {row.type} · {row.validationType} ·{" "}
                        {row.active ? "вкл" : "выкл"}
                      </span>
                      <div className="muted admin-muted-gap">
                        Награда {row.reward} · {row.description.slice(0, 120)}
                        {row.description.length > 120 ? "…" : ""}
                      </div>
                    </div>
                    <div className="admin-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setTaskEditingId(row.id);
                          setTaskFormId(row.id);
                          setTaskFormTitle(row.title);
                          setTaskFormDescription(row.description);
                          setTaskFormReward(row.reward);
                          setTaskFormPlatform(
                            row.platform as "twitch" | "kick" | "global" | "telegram"
                          );
                          setTaskFormType(row.type as "daily" | "one-time");
                          setTaskFormValidation(row.validationType as "api" | "manual");
                          setTaskFormMetaJson(JSON.stringify(row.meta ?? {}, null, 2));
                          const m =
                            row.meta && typeof row.meta === "object"
                              ? (row.meta as Record<string, unknown>)
                              : {};
                          setTaskFormActionUrl(
                            typeof m.actionUrl === "string" ? m.actionUrl : ""
                          );
                          setTaskFormActionLabel(
                            typeof m.actionLabel === "string" ? m.actionLabel : ""
                          );
                          setTaskFormVerifyLabel(
                            typeof m.verifyLabel === "string" ? m.verifyLabel : ""
                          );
                          const h = m.help;
                          if (h && typeof h === "object") {
                            const o = h as Record<string, unknown>;
                            setTaskFormHelpTitle(
                              typeof o.title === "string" ? o.title : ""
                            );
                            setTaskFormHelpBody(
                              typeof o.body === "string" ? o.body : ""
                            );
                            const ic = o.icon;
                            setTaskFormHelpIcon(
                              ic === "tv" || ic === "gift" || ic === "help" || ic === "radio"
                                ? ic
                                : ""
                            );
                          } else {
                            setTaskFormHelpTitle("");
                            setTaskFormHelpBody("");
                            setTaskFormHelpIcon("");
                          }
                        }}
                      >
                        Править
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={loading || !row.active}
                        onClick={async () => {
                          if (!token || !row.active) return;
                          if (!window.confirm(`Скрыть задание «${row.id}»?`)) return;
                          setLoading(true);
                          setErr(null);
                          try {
                            const r = await fetch(
                              `${apiBase()}/api/admin/tasks/${encodeURIComponent(row.id)}`,
                              { method: "DELETE", headers: authHeaders() }
                            );
                            const j = (await r.json()) as { error?: { message?: string } };
                            if (!r.ok) {
                              setErr(j.error?.message ?? `Ошибка ${r.status}`);
                              return;
                            }
                            if (taskEditingId === row.id) {
                              setTaskEditingId(null);
                              setTaskFormId("");
                              setTaskFormTitle("");
                              setTaskFormDescription("");
                              setTaskFormMetaJson("{}");
                            }
                            await loadAdminTasks();
                          } catch {
                            setErr("Сеть недоступна");
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        Скрыть
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              </ul>
            </>
          )}
        </>
      ) : null}

      {tab === "predictions" ? (
        <>
          <h2 className="admin-mt-0">Предикты (Live Predictions)</h2>
          <p className="muted">
            Админ создаёт предикт, запускает/ставит на паузу/закрывает и выбирает победивший исход.
            Балансы списываются и выплачиваются строго в выбранной платформе.
          </p>
          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!token) return;
              setLoading(true);
              setErr(null);
              try {
                const r = await fetch(`${apiBase()}/api/admin/predictions`, {
                  method: "POST",
                  headers: authHeaders(true),
                  body: JSON.stringify({
                    title: predictionTitle,
                    optionA: predictionOptionA,
                    optionB: predictionOptionB,
                    platformType: predictionPlatformType,
                    bettingDurationSec: Math.max(5, Math.min(300, predictionBettingDurationSec)),
                  }),
                });
                const j = (await r.json()) as { id?: string; error?: { message?: string } };
                if (!r.ok) {
                  setErr(j.error?.message ?? `Ошибка ${r.status}`);
                  return;
                }
                setPredictionTitle("");
                setPredictionOptionA("");
                setPredictionOptionB("");
                setPredictionBettingDurationSec(40);
                await loadPredictions();
              } catch {
                setErr("Сеть недоступна");
              } finally {
                setLoading(false);
              }
            }}
          >
            <div>
              <label htmlFor="ptitle">Заголовок</label>
              <input
                id="ptitle"
                value={predictionTitle}
                onChange={(e) => setPredictionTitle(e.target.value)}
                required
              />
            </div>
            <div className="row">
              <div>
                <label htmlFor="poptA">Исход A</label>
                <input
                  id="poptA"
                  value={predictionOptionA}
                  onChange={(e) => setPredictionOptionA(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="poptB">Исход B</label>
                <input
                  id="poptB"
                  value={predictionOptionB}
                  onChange={(e) => setPredictionOptionB(e.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="pplatform">Платформа</label>
              <select
                id="pplatform"
                value={predictionPlatformType}
                onChange={(e) => setPredictionPlatformType(e.target.value)}
              >
                {(predictionPlatforms ?? []).map((p) => (
                  <option key={p.id} value={p.type}>
                    {p.name} ({p.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pduration">Таймер приёма ставок (секунды, до 300)</label>
              <input
                id="pduration"
                type="number"
                min={5}
                max={300}
                value={predictionBettingDurationSec}
                onChange={(e) => setPredictionBettingDurationSec(Number(e.target.value))}
                required
              />
            </div>
            <button type="submit" className="primary" disabled={loading}>
              Создать предикт
            </button>
          </form>

          {predictions === null ? (
            <AdminSkeletonRows rows={4} />
          ) : predictions.length === 0 ? (
            <p className="muted">Пока нет предиктов.</p>
          ) : (
            <>
              {(predictionsLoading || predictionPlatformsLoading) ? (
                <p className="muted admin-refreshing">Обновляем предикты…</p>
              ) : null}
              <ul className="list">
              {predictions.map((p) => (
                <li key={p.id}>
                  <div className="admin-gw-row">
                    <div className="admin-gw-main">
                      <strong>{p.title}</strong>
                      <div className="muted">
                        {p.platform.name} · статус {p.status} · пул {p.totalPool.toLocaleString("ru-RU")}
                        {typeof p.bettingDurationSec === "number"
                          ? ` · таймер ${p.bettingDurationSec}с`
                          : ""}
                        {p.autoCloseAt ? ` · закрытие ${new Date(p.autoCloseAt).toLocaleString("ru-RU")}` : ""}
                      </div>
                      <div className="muted admin-muted-gap">
                        A: {p.optionA} — {p.optionAPool.toLocaleString("ru-RU")} ({p.participantsA} уч.) · B:{" "}
                        {p.optionB} — {p.optionBPool.toLocaleString("ru-RU")} ({p.participantsB} уч.)
                        {p.winnerOption ? ` · победил ${p.winnerOption}` : ""}
                      </div>
                    </div>
                    <div className="admin-actions">
                      {p.status === "draft" || p.status === "paused" ? (
                        <button
                          type="button"
                          className="primary"
                          disabled={loading}
                          onClick={async () => {
                            if (!token) return;
                            setLoading(true);
                            setErr(null);
                            try {
                              const r = await fetch(
                                `${apiBase()}/api/admin/predictions/${encodeURIComponent(p.id)}/start`,
                                { method: "PATCH", headers: authHeaders() }
                              );
                              const j = (await r.json()) as { error?: { message?: string } };
                              if (!r.ok) {
                                setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                return;
                              }
                              await loadPredictions();
                            } catch {
                              setErr("Сеть недоступна");
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          Старт
                        </button>
                      ) : null}
                      {p.status === "active" ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={loading}
                          onClick={async () => {
                            if (!token) return;
                            setLoading(true);
                            setErr(null);
                            try {
                              const r = await fetch(
                                `${apiBase()}/api/admin/predictions/${encodeURIComponent(p.id)}/pause`,
                                { method: "PATCH", headers: authHeaders() }
                              );
                              const j = (await r.json()) as { error?: { message?: string } };
                              if (!r.ok) {
                                setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                return;
                              }
                              await loadPredictions();
                            } catch {
                              setErr("Сеть недоступна");
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          Пауза
                        </button>
                      ) : null}
                      {p.status === "active" || p.status === "paused" ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={loading}
                          onClick={async () => {
                            if (!token) return;
                            setLoading(true);
                            setErr(null);
                            try {
                              const r = await fetch(
                                `${apiBase()}/api/admin/predictions/${encodeURIComponent(p.id)}/close`,
                                { method: "PATCH", headers: authHeaders() }
                              );
                              const j = (await r.json()) as { error?: { message?: string } };
                              if (!r.ok) {
                                setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                return;
                              }
                              await loadPredictions();
                            } catch {
                              setErr("Сеть недоступна");
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          Закрыть
                        </button>
                      ) : null}
                      {p.status === "closed" ? (
                        <>
                          <button
                            type="button"
                            className="primary"
                            disabled={loading}
                            onClick={async () => {
                              if (!token) return;
                              setLoading(true);
                              setErr(null);
                              try {
                                const r = await fetch(
                                  `${apiBase()}/api/admin/predictions/${encodeURIComponent(p.id)}/resolve`,
                                  {
                                    method: "PATCH",
                                    headers: authHeaders(true),
                                    body: JSON.stringify({ winnerOption: "A" }),
                                  }
                                );
                                const j = (await r.json()) as { error?: { message?: string } };
                                if (!r.ok) {
                                  setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                  return;
                                }
                                await loadPredictions();
                              } catch {
                                setErr("Сеть недоступна");
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >
                            Победил A
                          </button>
                          <button
                            type="button"
                            className="primary"
                            disabled={loading}
                            onClick={async () => {
                              if (!token) return;
                              setLoading(true);
                              setErr(null);
                              try {
                                const r = await fetch(
                                  `${apiBase()}/api/admin/predictions/${encodeURIComponent(p.id)}/resolve`,
                                  {
                                    method: "PATCH",
                                    headers: authHeaders(true),
                                    body: JSON.stringify({ winnerOption: "B" }),
                                  }
                                );
                                const j = (await r.json()) as { error?: { message?: string } };
                                if (!r.ok) {
                                  setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                  return;
                                }
                                await loadPredictions();
                              } catch {
                                setErr("Сеть недоступна");
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >
                            Победил B
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
              </ul>
            </>
          )}
        </>
      ) : null}

      {tab === "drops" ? (
        <>
          <h2 className="admin-mt-0">Стрим-дропы</h2>
          <p className="muted">
            Запускать можно только пока идёт эфир (раздел «Эфир»). Код вводят в
            модалке. Награда случайная в диапазоне. Платформа{" "}
            <strong>both</strong> — split 50/50 (нужны OAuth Twitch и Kick);{" "}
            <strong>twitch/kick</strong> — весь бонус на счёт платформы. Дроп
            завершается по таймеру; при остановке эфира дроп тоже снимается.
          </p>
          {dropStatus === null ? (
            <AdminSkeletonRows rows={2} />
          ) : (
            <>
              {dropStatusLoading ? <p className="muted admin-refreshing">Обновляем статус дропа…</p> : null}
              <div className="card stack admin-drop-status">
                <p className="admin-m-0">
                  <strong>Статус:</strong>{" "}
                  {dropStatus.active && dropStatus.drop ? (
                    <>
                      активен · {dropStatus.drop.platform} · код{" "}
                      <code>{dropStatus.drop.code}</code> · победителей{" "}
                      {dropStatus.drop.winnersCount} / {dropStatus.drop.maxWinners} · до{" "}
                      {new Date(dropStatus.drop.endsAt).toLocaleString("ru-RU")}
                    </>
                  ) : (
                    "нет активного дропа"
                  )}
                </p>
              </div>
            </>
          )}
          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!token) return;
              setLoading(true);
              setErr(null);
              try {
                const r = await fetch(`${apiBase()}/api/admin/drops/start`, {
                  method: "POST",
                  headers: authHeaders(true),
                  body: JSON.stringify({
                    code: dropCode.replace(/\D/g, "").slice(0, 8),
                    durationSeconds: dropDurationSec,
                    maxWinners: dropMaxWinners,
                    rewardMin: dropRewardMin,
                    rewardMax: dropRewardMax,
                    platform: dropPlatform,
                  }),
                });
                const j = (await r.json()) as { ok?: boolean; error?: { message?: string } };
                if (!r.ok) {
                  setErr(j.error?.message ?? `Ошибка ${r.status}`);
                  return;
                }
                await loadDropStatus();
              } catch {
                setErr("Сеть недоступна");
              } finally {
                setLoading(false);
              }
            }}
          >
            <div>
              <label htmlFor="dcode">Код (цифры, мин. 4)</label>
              <input
                id="dcode"
                inputMode="numeric"
                value={dropCode}
                onChange={(e) => setDropCode(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="dplat">Платформа</label>
              <select
                id="dplat"
                value={dropPlatform}
                onChange={(e) =>
                  setDropPlatform(e.target.value as "twitch" | "kick" | "both")
                }
              >
                <option value="both">Both (split, нужны оба OAuth)</option>
                <option value="twitch">Twitch</option>
                <option value="kick">Kick</option>
              </select>
            </div>
            <div className="row">
              <div>
                <label htmlFor="ddur">Длительность (сек)</label>
                <input
                  id="ddur"
                  type="number"
                  min={5}
                  max={86400}
                  value={dropDurationSec}
                  onChange={(e) => setDropDurationSec(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <label htmlFor="dmax">Лимит победителей</label>
                <input
                  id="dmax"
                  type="number"
                  min={1}
                  value={dropMaxWinners}
                  onChange={(e) => setDropMaxWinners(Number(e.target.value))}
                  required
                />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="dmin">Награда от (монет)</label>
                <input
                  id="dmin"
                  type="number"
                  min={0}
                  value={dropRewardMin}
                  onChange={(e) => setDropRewardMin(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <label htmlFor="dmaxr">Награда до (монет)</label>
                <input
                  id="dmaxr"
                  type="number"
                  min={0}
                  value={dropRewardMax}
                  onChange={(e) => setDropRewardMax(Number(e.target.value))}
                  required
                />
              </div>
            </div>
            <button type="submit" className="primary" disabled={loading}>
              Запустить дроп
            </button>
          </form>
        </>
      ) : null}

      {tab === "live" ? (
        <>
          <h2 className="admin-mt-0">Трансляция</h2>
          <p className="muted">
            Запустите эфир: выберите платформу и вставьте ссылку на стрим. В приложении
            появится карточка «Смотреть стрим»; стрик начисляется только на выбранной
            платформе. Завершите эфир — карточка исчезнет.
          </p>
          {liveBroadcastStatus === null ? (
            <AdminSkeletonRows rows={2} />
          ) : liveBroadcastStatus.active ? (
            <>
              {liveLoading ? <p className="muted admin-refreshing">Обновляем статус эфира…</p> : null}
              <div className="card stack">
                <p className="admin-m-0">
                  <strong>Эфир активен</strong> · {liveBroadcastStatus.platform} ·{" "}
                  <a href={liveBroadcastStatus.streamUrl} target="_blank" rel="noreferrer">
                    {liveBroadcastStatus.streamUrl}
                  </a>
                  <br />
                  Старт: {new Date(liveBroadcastStatus.startedAt).toLocaleString("ru-RU")}
                </p>
                {liveBroadcastStatus.vpnNote ? (
                  <p className="muted admin-m-0">VPN: {liveBroadcastStatus.vpnNote}</p>
                ) : null}
                <button
                  type="button"
                  className="secondary"
                  disabled={loading}
                  onClick={async () => {
                    if (!token) return;
                    setLoading(true);
                    setErr(null);
                    try {
                      const r = await fetch(`${apiBase()}/api/admin/live-broadcast/end`, {
                        method: "POST",
                        headers: authHeaders(),
                      });
                      const j = (await r.json()) as { error?: { message?: string } };
                      if (!r.ok) {
                        setErr(j.error?.message ?? `Ошибка ${r.status}`);
                        return;
                      }
                      await loadLiveBroadcast();
                    } catch {
                      setErr("Сеть недоступна");
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Завершить эфир
                </button>
              </div>
            </>
          ) : (
            <form
              className="card stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!token) return;
                setLoading(true);
                setErr(null);
                try {
                  const r = await fetch(`${apiBase()}/api/admin/live-broadcast/start`, {
                    method: "POST",
                    headers: authHeaders(true),
                    body: JSON.stringify({
                      platform: liveStartPlatform,
                      streamUrl: liveStartUrl.trim(),
                      vpnNote: liveStartVpn.trim() || null,
                    }),
                  });
                  const j = (await r.json()) as { error?: { message?: string } };
                  if (!r.ok) {
                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                    return;
                  }
                  setLiveStartUrl("");
                  setLiveStartVpn("");
                  await loadLiveBroadcast();
                } catch {
                  setErr("Сеть недоступна");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <div>
                <label htmlFor="livePlat">Платформа</label>
                <select
                  id="livePlat"
                  value={liveStartPlatform}
                  onChange={(e) =>
                    setLiveStartPlatform(e.target.value as "twitch" | "kick")
                  }
                >
                  <option value="kick">Kick</option>
                  <option value="twitch">Twitch</option>
                </select>
              </div>
              <div>
                <label htmlFor="liveUrl">Ссылка на стрим</label>
                <input
                  id="liveUrl"
                  type="url"
                  placeholder="https://kick.com/… или https://twitch.tv/…"
                  value={liveStartUrl}
                  onChange={(e) => setLiveStartUrl(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="liveVpn">Заметка про VPN (в карточке в приложении)</label>
                <input
                  id="liveVpn"
                  placeholder="Например: Для захода на стрим нужен VPN."
                  value={liveStartVpn}
                  onChange={(e) => setLiveStartVpn(e.target.value)}
                />
              </div>
              <button type="submit" className="primary" disabled={loading}>
                Запустить эфир
              </button>
            </form>
          )}
        </>
      ) : null}
    </>
  );
}
