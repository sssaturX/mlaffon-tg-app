import { useCallback, useEffect, useRef, useState } from "react";

const ADMIN_NAV_ITEMS = [
  { id: "giveaways" as const, label: "Розыгрыши" },
  { id: "promos" as const, label: "Промокоды" },
  { id: "shop" as const, label: "Магазин" },
  { id: "drops" as const, label: "Дропы" },
  { id: "live" as const, label: "Эфир" },
  { id: "users" as const, label: "Пользователи" },
  { id: "appeals" as const, label: "Апелляции" },
  { id: "tasks" as const, label: "Задания" },
  { id: "predictions" as const, label: "Предикты" },
] as const;

type AdminNavId = (typeof ADMIN_NAV_ITEMS)[number]["id"];

const TOKEN_KEY = "mlaffon_admin_token";
/** Интервалы авто-обновления активной вкладки (видимая вкладка браузера). */
const ADMIN_AUTO_REFRESH_MS = {
  fast: 8000,
  normal: 20000,
  slow: 45000,
} as const;
/** Не чаще: `/api/admin/stats` при тике авто-рефреша (цифры в шапке редко критичны каждые N сек). */
const ADMIN_STATS_AUTO_REFRESH_MIN_MS = 45_000;

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

type AdminUserPlatform = { linked: boolean; displayName: string | null };

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
  streakTwitch?: number;
  streakKick?: number;
  dropsActivatedCount?: number;
  predictionsJoinedCount?: number;
  platforms?: {
    twitch: AdminUserPlatform;
    kick: AdminUserPlatform;
  };
};

type AdminUserReferralRow = {
  refereeId: string;
  username: string | null;
  firstName: string | null;
  telegramId: string | null;
  qualified: boolean;
  createdAt: string;
};

/** `silent: true` — фоновый авто-рефреш без «Обновляем…», чтобы таблицы не прыгали. */
type AdminFetchOpts = { silent?: boolean };

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
  userStats: Array<{
    userId: string;
    username: string | null;
    firstName: string | null;
    dropsWon: number;
  }>;
};

type DropHistoryRow = {
  id: string;
  platform: string;
  code: string;
  rewardMin: number;
  rewardMax: number;
  maxWinners: number;
  winnersCount: number;
  startedAt: string;
  endsAt: string;
  active: boolean;
};

type DropClaimantRow = {
  userId: string;
  rewardCoins: number;
  username: string | null;
  firstName: string | null;
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

type AdminShopItemRow = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  kind: string;
  priceCoins: number;
  meta: unknown;
  active: boolean;
  stockTotal: number | null;
  stockSold: number;
};

type AdminShopPurchaseRow = {
  id: string;
  createdAt: string;
  shopItemId: string;
  itemTitle: string;
  priceCoins: number;
  platform: string;
  userId: string;
  telegramId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  telegramChatLink: string | null;
};

type AdminTaskEvidenceRow = {
  id: string;
  userId: string;
  taskId: string;
  taskTitle: string;
  stage: number;
  status: string;
  images: string[];
  note: string | null;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
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

  const [tab, setTab] = useState<AdminNavId>("giveaways");
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [banAppeals, setBanAppeals] = useState<BanAppealRow[] | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[] | null>(null);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const [usersSearchDraft, setUsersSearchDraft] = useState("");
  const [usersSearch, setUsersSearch] = useState("");
  const USERS_PAGE = 50;

  useEffect(() => {
    const id = window.setTimeout(() => setUsersSearch(usersSearchDraft.trim()), 350);
    return () => window.clearTimeout(id);
  }, [usersSearchDraft]);

  const selectTab = useCallback((id: AdminNavId) => {
    setNavDrawerOpen(false);
    if (id === "users") setUsersOffset(0);
    setTab(id);
  }, []);

  const [dropStatus, setDropStatus] = useState<AdminDropStatus | null>(null);
  const [dropHistory, setDropHistory] = useState<DropHistoryRow[] | null>(null);
  const [dropHistoryTotal, setDropHistoryTotal] = useState(0);
  const [dropHistoryLoading, setDropHistoryLoading] = useState(false);
  const [dropHistoryOpen, setDropHistoryOpen] = useState(false);
  const [dropClaimantsDropId, setDropClaimantsDropId] = useState<string | null>(null);
  const [dropClaimants, setDropClaimants] = useState<DropClaimantRow[] | null>(null);
  const [dropClaimantsLoading, setDropClaimantsLoading] = useState(false);
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
  const [taskEvidenceRows, setTaskEvidenceRows] = useState<AdminTaskEvidenceRow[] | null>(null);
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
  const [taskFormChainKey, setTaskFormChainKey] = useState("");
  const [taskFormChainOrder, setTaskFormChainOrder] = useState(1);
  const [taskFormProgressSource, setTaskFormProgressSource] = useState("");
  const [taskFormTargetValue, setTaskFormTargetValue] = useState(0);
  const [taskFormProgressLabel, setTaskFormProgressLabel] = useState("");
  const [taskFormCoverImageUrl, setTaskFormCoverImageUrl] = useState("");
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
  const [userManageModal, setUserManageModal] = useState<AdminUserRow | null>(null);
  const [userManageRefs, setUserManageRefs] = useState<AdminUserReferralRow[] | null>(
    null
  );
  const [userManageRefsLoading, setUserManageRefsLoading] = useState(false);
  const [userManageTwDelta, setUserManageTwDelta] = useState("");
  const [userManageKiDelta, setUserManageKiDelta] = useState("");
  const [dropStatusLoading, setDropStatusLoading] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskEvidenceLoading, setTaskEvidenceLoading] = useState(false);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [predictionPlatformsLoading, setPredictionPlatformsLoading] = useState(false);
  const [predictionsLoading, setPredictionsLoading] = useState(false);
  const [adminShopItems, setAdminShopItems] = useState<AdminShopItemRow[] | null>(null);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopEditingId, setShopEditingId] = useState<string | null>(null);
  const [shopFormId, setShopFormId] = useState("");
  const [shopFormTitle, setShopFormTitle] = useState("");
  const [shopFormDescription, setShopFormDescription] = useState("");
  const [shopFormImageUrl, setShopFormImageUrl] = useState("");
  const [shopFormPrice, setShopFormPrice] = useState(50);
  const [shopFormSpins, setShopFormSpins] = useState(3);
  const [shopFormSubtitle, setShopFormSubtitle] = useState("");
  const [shopFormBadgeText, setShopFormBadgeText] = useState("");
  const [shopFormButtonLabel, setShopFormButtonLabel] = useState("");
  const [shopFormSortOrder, setShopFormSortOrder] = useState(0);
  const [shopFormStockUnlimited, setShopFormStockUnlimited] = useState(true);
  const [shopFormStockTotal, setShopFormStockTotal] = useState(100);
  const [shopFormActive, setShopFormActive] = useState(true);
  const [shopFormKind, setShopFormKind] = useState<"extra_spin" | "manual_fulfillment">(
    "extra_spin"
  );
  const [adminShopPurchases, setAdminShopPurchases] = useState<AdminShopPurchaseRow[] | null>(
    null
  );
  const [shopPurchasesLoading, setShopPurchasesLoading] = useState(false);
  const [shopPurchaseFilterItemId, setShopPurchaseFilterItemId] = useState("");
  const [shopGlobalNotice, setShopGlobalNotice] = useState("");
  const [shopGlobalWarning, setShopGlobalWarning] = useState("");
  const [shopGlobalCopyLoading, setShopGlobalCopyLoading] = useState(false);
  const autoRefreshRunningRef = useRef(false);
  const lastStatsAutoRefreshAtRef = useRef(0);
  const usersPrevSearchRef = useRef<string | undefined>(undefined);

  const getAutoRefreshMs = useCallback(() => {
    if (tab === "predictions" || tab === "live" || tab === "drops") {
      return ADMIN_AUTO_REFRESH_MS.fast;
    }
    if (tab === "promos" || tab === "tasks" || tab === "shop") {
      return ADMIN_AUTO_REFRESH_MS.slow;
    }
    return ADMIN_AUTO_REFRESH_MS.normal;
  }, [tab]);

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

  const resetShopForm = useCallback(() => {
    setShopEditingId(null);
    setShopFormId("");
    setShopFormTitle("");
    setShopFormDescription("");
    setShopFormImageUrl("");
    setShopFormPrice(50);
    setShopFormSpins(3);
    setShopFormSubtitle("");
    setShopFormBadgeText("");
    setShopFormButtonLabel("");
    setShopFormSortOrder(0);
    setShopFormStockUnlimited(true);
    setShopFormStockTotal(100);
    setShopFormActive(true);
    setShopFormKind("extra_spin");
  }, []);

  const applyShopImageFromFile = useCallback((file: File | null) => {
    if (!file) return;
    const maxBytes = 3 * 1024 * 1024;
    if (!/^image\//i.test(file.type)) {
      setErr("Выберите файл изображения (png/jpg/webp/gif).");
      return;
    }
    if (file.size > maxBytes) {
      setErr("Слишком большой файл. Максимум 3 МБ.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:image/")) {
        setErr("Не удалось прочитать изображение.");
        return;
      }
      setShopFormImageUrl(result);
      setErr(null);
    };
    reader.onerror = () => setErr("Не удалось загрузить файл.");
    reader.readAsDataURL(file);
  }, []);

  const applyTaskCoverFromFile = useCallback((file: File | null) => {
    if (!file) return;
    const maxBytes = 3 * 1024 * 1024;
    if (!/^image\//i.test(file.type)) {
      setErr("Обложка: выберите файл изображения (png/jpg/webp/gif).");
      return;
    }
    if (file.size > maxBytes) {
      setErr("Обложка: слишком большой файл. Максимум 3 МБ.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:image/")) {
        setErr("Обложка: не удалось прочитать изображение.");
        return;
      }
      setTaskFormCoverImageUrl(result);
      setErr(null);
    };
    reader.onerror = () => setErr("Обложка: не удалось загрузить файл.");
    reader.readAsDataURL(file);
  }, []);

  const openUserManage = useCallback(
    async (u: AdminUserRow) => {
      setUserManageModal(u);
      setUserManageRefs(null);
      setUserManageTwDelta("");
      setUserManageKiDelta("");
      setUserManageRefsLoading(true);
      if (!token) {
        setUserManageRefsLoading(false);
        return;
      }
      try {
        const r = await fetch(
          `${apiBase()}/api/admin/users/${encodeURIComponent(u.id)}/referrals`,
          { headers: authHeaders() }
        );
        const j = (await r.json()) as { referrals?: AdminUserReferralRow[] };
        setUserManageRefs(j.referrals ?? []);
      } catch {
        setUserManageRefs([]);
      } finally {
        setUserManageRefsLoading(false);
      }
    },
    [token, authHeaders]
  );

  const loadStats = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setStatsLoading(true);
    if (!silent) setErr(null);
    try {
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
    } finally {
      if (!silent) setStatsLoading(false);
    }
  }, [token, authHeaders]);

  const loadGiveaways = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setGiveawaysLoading(true);
    if (!silent) setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/giveaways`, { headers: authHeaders() });
      const j = (await r.json()) as { giveaways?: GiveawayRow[]; error?: { message?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setGiveaways(j.giveaways ?? []);
    } finally {
      if (!silent) setGiveawaysLoading(false);
    }
  }, [token, authHeaders]);

  const loadPromos = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setPromosLoading(true);
    if (!silent) setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/promos`, { headers: authHeaders() });
      const j = (await r.json()) as { promos?: PromoRow[]; error?: { message?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setPromos(j.promos ?? []);
    } finally {
      if (!silent) setPromosLoading(false);
    }
  }, [token, authHeaders]);

  const loadAdminUsers = useCallback(
    async (offset: number, opts?: AdminFetchOpts) => {
      if (!token) return;
      const silent = opts?.silent === true;
      if (!silent) setUsersLoading(true);
      if (!silent) setErr(null);
      try {
        const params = new URLSearchParams({
          limit: String(USERS_PAGE),
          offset: String(offset),
        });
        if (usersSearch.length > 0) params.set("search", usersSearch);
        const r = await fetch(`${apiBase()}/api/admin/users?${params}`, {
          headers: authHeaders(),
        });
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
      } finally {
        if (!silent) setUsersLoading(false);
      }
    },
    [token, authHeaders, usersSearch]
  );

  const loadGiveawayDetail = useCallback(
    async (id: string, opts?: AdminFetchOpts) => {
      if (!token) return;
      const silent = opts?.silent === true;
      if (!silent) setDetailLoading(true);
      if (!silent) setErr(null);
      try {
        const r = await fetch(`${apiBase()}/api/admin/giveaways/${id}`, {
          headers: authHeaders(),
        });
        const j = (await r.json()) as GiveawayDetailResponse & { error?: { message?: string } };
        if (!r.ok) {
          setErr(j.error?.message ?? `Ошибка ${r.status}`);
          return;
        }
        setDetail(j);
      } finally {
        if (!silent) setDetailLoading(false);
      }
    },
    [token, authHeaders]
  );

  const loadDropStatus = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setDropStatusLoading(true);
    if (!silent) setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/drops`, { headers: authHeaders() });
      const j = (await r.json()) as AdminDropStatus & { error?: { message?: string } };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setDropStatus({ active: j.active, drop: j.drop ?? null, userStats: j.userStats ?? [] });
    } finally {
      if (!silent) setDropStatusLoading(false);
    }
  }, [token, authHeaders]);

  const loadDropHistory = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setDropHistoryLoading(true);
    try {
      const r = await fetch(`${apiBase()}/api/admin/drops/history?limit=60&offset=0`, {
        headers: authHeaders(),
      });
      const j = (await r.json()) as {
        drops?: DropHistoryRow[];
        total?: number;
        error?: { message?: string };
      };
      if (!r.ok) {
        if (r.status === 401) setToken(null);
        return;
      }
      setDropHistory(j.drops ?? []);
      setDropHistoryTotal(j.total ?? 0);
    } finally {
      if (!silent) setDropHistoryLoading(false);
    }
  }, [token, authHeaders]);

  const loadLiveBroadcast = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setLiveLoading(true);
    if (!silent) setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/live-broadcast`, {
        headers: authHeaders(),
      });
      const j = (await r.json()) as AdminLiveBroadcast & {
        error?: { message?: string };
      };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setLiveBroadcastStatus(j.active ? j : { active: false });
    } finally {
      if (!silent) setLiveLoading(false);
    }
  }, [token, authHeaders]);

  const loadAdminTasks = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setTasksLoading(true);
    if (!silent) setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/tasks`, { headers: authHeaders() });
      const j = (await r.json()) as {
        tasks?: AdminTaskRow[];
        error?: { message?: string };
      };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setAdminTasks(j.tasks ?? []);
    } finally {
      if (!silent) setTasksLoading(false);
    }
  }, [token, authHeaders]);

  const loadAdminShop = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setShopLoading(true);
    if (!silent) setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/shop/items`, { headers: authHeaders() });
      const j = (await r.json()) as {
        items?: AdminShopItemRow[];
        error?: { message?: string };
      };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setAdminShopItems(j.items ?? []);
    } finally {
      if (!silent) setShopLoading(false);
    }
  }, [token, authHeaders]);

  const loadAdminShopPurchases = useCallback(
    async (opts?: AdminFetchOpts) => {
      if (!token) return;
      const silent = opts?.silent === true;
      if (!silent) setShopPurchasesLoading(true);
      try {
        const q = shopPurchaseFilterItemId.trim();
        const url = `${apiBase()}/api/admin/shop/purchases?limit=300${
          q ? `&itemId=${encodeURIComponent(q)}` : ""
        }`;
        const r = await fetch(url, { headers: authHeaders() });
        const j = (await r.json()) as {
          purchases?: AdminShopPurchaseRow[];
          error?: { message?: string };
        };
        if (!r.ok) {
          setErr(j.error?.message ?? `Ошибка ${r.status}`);
          if (r.status === 401) setToken(null);
          return;
        }
        setAdminShopPurchases(j.purchases ?? []);
      } finally {
        if (!silent) setShopPurchasesLoading(false);
      }
    },
    [token, authHeaders, shopPurchaseFilterItemId]
  );

  const loadShopGlobalCopy = useCallback(async () => {
    if (!token) return;
    setShopGlobalCopyLoading(true);
    try {
      const r = await fetch(`${apiBase()}/api/admin/shop/global-copy`, {
        headers: authHeaders(),
      });
      const j = (await r.json()) as {
        notice?: string;
        warning?: string;
        error?: { message?: string };
      };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setShopGlobalNotice(typeof j.notice === "string" ? j.notice : "");
      setShopGlobalWarning(typeof j.warning === "string" ? j.warning : "");
    } finally {
      setShopGlobalCopyLoading(false);
    }
  }, [token, authHeaders]);

  const loadTaskEvidence = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setTaskEvidenceLoading(true);
    try {
      const r = await fetch(`${apiBase()}/api/admin/tasks/evidence?status=submitted`, {
        headers: authHeaders(),
      });
      const j = (await r.json()) as {
        evidence?: AdminTaskEvidenceRow[];
        error?: { message?: string };
      };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setTaskEvidenceRows(j.evidence ?? []);
    } finally {
      if (!silent) setTaskEvidenceLoading(false);
    }
  }, [token, authHeaders]);

  const loadPredictionPlatforms = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setPredictionPlatformsLoading(true);
    try {
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
        return;
      }
      setPredictionPlatforms(j.platforms ?? []);
      if ((j.platforms ?? []).length > 0 && !predictionPlatformType) {
        setPredictionPlatformType((j.platforms ?? [])[0]!.type);
      }
    } finally {
      if (!silent) setPredictionPlatformsLoading(false);
    }
  }, [token, authHeaders, predictionPlatformType]);

  const loadPredictions = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setPredictionsLoading(true);
    try {
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
        return;
      }
      setPredictions(j.predictions ?? []);
    } finally {
      if (!silent) setPredictionsLoading(false);
    }
  }, [token, authHeaders]);

  useEffect(() => {
    if (!navDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [navDrawerOpen]);

  useEffect(() => {
    if (token) {
      void loadStats();
      void loadGiveaways();
      void loadPromos();
    }
  }, [token, loadStats, loadGiveaways, loadPromos]);

  useEffect(() => {
    if (!token || tab !== "users") return;
    if (usersPrevSearchRef.current !== usersSearch) {
      usersPrevSearchRef.current = usersSearch;
      setUsersOffset(0);
      return;
    }
    void loadAdminUsers(usersOffset);
  }, [token, tab, usersOffset, usersSearch, loadAdminUsers]);

  useEffect(() => {
    if (token && tab === "drops") {
      void loadDropStatus();
      void loadDropHistory();
    }
  }, [token, tab, loadDropStatus, loadDropHistory]);

  useEffect(() => {
    if (token && tab === "live") void loadLiveBroadcast();
  }, [token, tab, loadLiveBroadcast]);

  useEffect(() => {
    if (token && tab === "tasks") {
      void loadAdminTasks();
      void loadTaskEvidence();
    }
  }, [token, tab, loadAdminTasks, loadTaskEvidence]);

  useEffect(() => {
    if (!token || tab !== "shop") return;
    void loadAdminShop();
    void loadShopGlobalCopy();
    void loadAdminShopPurchases();
  }, [token, tab, loadAdminShop, loadShopGlobalCopy, loadAdminShopPurchases]);

  useEffect(() => {
    if (token && tab === "predictions") {
      void loadPredictionPlatforms();
      void loadPredictions();
    }
  }, [token, tab, loadPredictionPlatforms, loadPredictions]);

  const loadBanAppeals = useCallback(async (opts?: AdminFetchOpts) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) setAppealsLoading(true);
    if (!silent) setErr(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/ban-appeals`, { headers: authHeaders() });
      const j = (await r.json()) as {
        appeals?: BanAppealRow[];
        error?: { message?: string };
      };
      if (!r.ok) {
        setErr(j.error?.message ?? `Ошибка ${r.status}`);
        if (r.status === 401) setToken(null);
        return;
      }
      setBanAppeals(j.appeals ?? []);
    } finally {
      if (!silent) setAppealsLoading(false);
    }
  }, [token, authHeaders]);

  useEffect(() => {
    if (token && tab === "appeals") void loadBanAppeals();
  }, [token, tab, loadBanAppeals]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const refreshActiveTab = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (autoRefreshRunningRef.current) return;
      autoRefreshRunningRef.current = true;
      try {
        const s = { silent: true } as const;
        const now = Date.now();
        if (now - lastStatsAutoRefreshAtRef.current >= ADMIN_STATS_AUTO_REFRESH_MIN_MS) {
          await loadStats(s);
          lastStatsAutoRefreshAtRef.current = now;
        }
        if (tab === "giveaways") {
          await loadGiveaways(s);
          if (expandedId) await loadGiveawayDetail(expandedId, s);
          return;
        }
        if (tab === "promos") {
          await loadPromos(s);
          return;
        }
        if (tab === "users") {
          await loadAdminUsers(usersOffset, s);
          return;
        }
        if (tab === "drops") {
          await Promise.all([loadDropStatus(s), loadDropHistory(s)]);
          return;
        }
        if (tab === "live") {
          await loadLiveBroadcast(s);
          return;
        }
        if (tab === "tasks") {
          await Promise.all([loadAdminTasks(s), loadTaskEvidence(s)]);
          return;
        }
        if (tab === "shop") {
          await Promise.all([loadAdminShop(s), loadAdminShopPurchases(s)]);
          return;
        }
        if (tab === "appeals") {
          await loadBanAppeals(s);
          return;
        }
        if (tab === "predictions") {
          await Promise.all([loadPredictionPlatforms(s), loadPredictions(s)]);
        }
      } finally {
        autoRefreshRunningRef.current = false;
      }
    };

    const id = window.setInterval(() => {
      void refreshActiveTab();
    }, getAutoRefreshMs());
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    token,
    tab,
    usersOffset,
    expandedId,
    loadStats,
    loadGiveaways,
    loadGiveawayDetail,
    loadPromos,
    loadAdminUsers,
    loadDropStatus,
    loadDropHistory,
    loadLiveBroadcast,
    loadAdminTasks,
    loadTaskEvidence,
    loadAdminShop,
    loadAdminShopPurchases,
    loadBanAppeals,
    loadPredictionPlatforms,
    loadPredictions,
    getAutoRefreshMs,
  ]);

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
      <div className="admin-login">
        <div className="admin-login__glow" aria-hidden />
        <div className="admin-login__inner">
          <div className="admin-login__card card stack">
            <div className="admin-login__brand">
              <span className="admin-login__logo" aria-hidden>
                M
              </span>
              <div>
                <p className="admin-login__eyebrow">Mlaffon</p>
                <h1 className="admin-login__title">Админка</h1>
              </div>
            </div>
            <p className="muted admin-login__lead">
              Вход по email, паролю и passphrase (см. ADMIN_* в API).
            </p>
            <form className="stack" onSubmit={login}>
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
          </div>
        </div>
      </div>
    );
  }

  const navButtons = ADMIN_NAV_ITEMS.map((item) => (
    <button
      key={item.id}
      type="button"
      className={
        tab === item.id ? "admin-nav-link admin-nav-link--active" : "admin-nav-link"
      }
      onClick={() => selectTab(item.id)}
    >
      {item.label}
    </button>
  ));

  return (
    <>
      <div className="admin-app">
        <header className="admin-topbar">
          <div className="admin-topbar__left">
            <button
              type="button"
              className="admin-icon-btn"
              aria-label={navDrawerOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={navDrawerOpen}
              onClick={() => setNavDrawerOpen((o) => !o)}
            >
              <span className="admin-icon-btn__bars" aria-hidden />
            </button>
            <span className="admin-topbar__title">Mlaffon</span>
          </div>
          <button type="button" className="secondary admin-topbar__out" onClick={logout}>
            Выйти
          </button>
        </header>

        <div
          className={
            navDrawerOpen ? "admin-scrim admin-scrim--visible" : "admin-scrim"
          }
          aria-hidden={!navDrawerOpen}
          onClick={() => setNavDrawerOpen(false)}
        />

        <aside
          className={navDrawerOpen ? "admin-drawer admin-drawer--open" : "admin-drawer"}
          aria-hidden={!navDrawerOpen}
        >
          <div className="admin-drawer__head">
            <span className="admin-drawer__title">Разделы</span>
            <button
              type="button"
              className="admin-icon-btn admin-icon-btn--ghost"
              aria-label="Закрыть"
              onClick={() => setNavDrawerOpen(false)}
            >
              ×
            </button>
          </div>
          <nav className="admin-drawer__nav stack" aria-label="Разделы">
            {navButtons}
          </nav>
        </aside>

        <div className="admin-layout">
          <aside className="admin-sidebar" aria-label="Разделы">
            <div className="admin-sidebar__brand">
              <span className="admin-sidebar__logo">M</span>
              <div className="admin-sidebar__titles">
                <span className="admin-sidebar__name">Mlaffon</span>
                <span className="admin-sidebar__role muted">Панель</span>
              </div>
            </div>
            <nav className="admin-sidebar__nav">{navButtons}</nav>
            <button
              type="button"
              className="secondary admin-sidebar__logout"
              onClick={logout}
            >
              Выйти
            </button>
          </aside>

          <main className="admin-main">
            <div className="admin-main__head">
              <h1 className="admin-page-title">
                {ADMIN_NAV_ITEMS.find((i) => i.id === tab)?.label ?? "Админка"}
              </h1>
              <p className="muted admin-main__crumb">Статистика и данные ниже</p>
            </div>

            {err ? <p className="err admin-main__err">{err}</p> : null}

            <h2 className="admin-section-title">Статистика</h2>
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
          <label htmlFor="gprize">Заголовок на карточке</label>
          <input
            id="gprize"
            value={gwPrize}
            onChange={(e) => setGwPrize(e.target.value)}
            placeholder="Как на главной и в списке розыгрышей"
            required
          />
          <p className="muted admin-m-0" style={{ fontSize: 12, marginTop: 6 }}>
            Жирная строка на превью (одна строка без дубля под ней).
          </p>
        </div>
        <div>
          <label htmlFor="gtitle">Заголовок на странице розыгрыша</label>
          <input
            id="gtitle"
            value={gwTitle}
            onChange={(e) => setGwTitle(e.target.value)}
            placeholder="Крупный заголовок под баннером"
            required
          />
          <p className="muted admin-m-0" style={{ fontSize: 12, marginTop: 6 }}>
            Отображается на экране «Розыгрыш» (h1), не дублируется на карточке.
          </p>
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
          <label htmlFor="gdesc">Описание и правила (необязательно)</label>
          <textarea
            id="gdesc"
            value={gwDescription}
            onChange={(e) => setGwDescription(e.target.value)}
            placeholder="Только на странице розыгрыша, под блоком с призом"
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
                  <strong>{g.prizeText}</strong>
                  <div className="muted">Страница: {g.title}</div>
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
          <p className="muted">
            Балансы и рефералы (по дате регистрации, новые сверху). Поиск — по Telegram-нику
            или имени, без учёта регистра.
          </p>
          <div className="admin-users-toolbar row">
            <div style={{ flex: "2 1 220px", minWidth: "min(100%, 200px)" }}>
              <label htmlFor="users-search">Поиск</label>
              <input
                id="users-search"
                type="search"
                placeholder="@ник или часть имени"
                value={usersSearchDraft}
                onChange={(e) => setUsersSearchDraft(e.target.value)}
                autoComplete="off"
                enterKeyHint="search"
              />
            </div>
            {usersSearchDraft.trim().length > 0 ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setUsersSearchDraft("");
                  setUsersSearch("");
                }}
              >
                Сбросить
              </button>
            ) : null}
          </div>
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
                      <th>Платформы</th>
                      <th>Стрик TW</th>
                      <th>Стрик Kick</th>
                      <th>Дропы</th>
                      <th>Предикты</th>
                      <th>Текущий баланс</th>
                      <th>Рефералов</th>
                      <th>Регистрация</th>
                      <th>Управление</th>
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
                        <td className="admin-user-platforms">
                          {(() => {
                            const p = u.platforms;
                            const tw = p?.twitch;
                            const ki = p?.kick;
                            const twLabel = tw?.linked
                              ? tw.displayName ?? "без ника"
                              : "—";
                            const kiLabel = ki?.linked
                              ? ki.displayName ?? "без ника"
                              : "—";
                            return (
                              <>
                                <span className="admin-user-platforms__row">
                                  <span className="admin-user-platforms__tag">TW</span>
                                  {twLabel}
                                </span>
                                <span className="admin-user-platforms__row">
                                  <span className="admin-user-platforms__tag">Kick</span>
                                  {kiLabel}
                                </span>
                              </>
                            );
                          })()}
                        </td>
                        <td>{u.streakTwitch ?? 0}</td>
                        <td>{u.streakKick ?? 0}</td>
                        <td>{u.dropsActivatedCount ?? 0}</td>
                        <td>{u.predictionsJoinedCount ?? 0}</td>
                        <td>{u.coins.toLocaleString("ru-RU")}</td>
                        <td>{u.referralCount}</td>
                        <td className="muted admin-table-nowrap">
                          {new Date(u.createdAt).toLocaleString("ru-RU")}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            disabled={loading}
                            onClick={() => void openUserManage(u)}
                          >
                            Открыть
                          </button>
                        </td>
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

      {tab === "shop" ? (
        <>
          <h2 className="admin-mt-0">Магазин</h2>
          <p className="muted">
            Витрина, покупки и тексты в попапе (серый абзац и красное предупреждение). Тип{" "}
            <code>manual_fulfillment</code> — только списание монет и запись покупки (выдача вручную в
            Telegram). <code>extra_spin</code> — начисляет спины в инвентарь.
          </p>

          <div className="card stack admin-mt-3">
            <h3 className="admin-mt-0">Тексты в попапе покупки</h3>
            <p className="muted admin-m-0">
              Упоминания вида <code>@Username</code> в приложении станут ссылками на Telegram.
            </p>
            {shopGlobalCopyLoading ? (
              <p className="muted">Загружаем…</p>
            ) : (
              <>
                <div>
                  <label htmlFor="shopglobnotice">Текст под товаром (серый)</label>
                  <textarea
                    id="shopglobnotice"
                    value={shopGlobalNotice}
                    onChange={(e) => setShopGlobalNotice(e.target.value)}
                    rows={3}
                  />
                </div>
                <div>
                  <label htmlFor="shopglobwarn">Предупреждение (красный блок)</label>
                  <textarea
                    id="shopglobwarn"
                    value={shopGlobalWarning}
                    onChange={(e) => setShopGlobalWarning(e.target.value)}
                    rows={3}
                  />
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={loading || !shopGlobalNotice.trim() || !shopGlobalWarning.trim()}
                  onClick={async () => {
                    if (!token) return;
                    setLoading(true);
                    setErr(null);
                    try {
                      const r = await fetch(`${apiBase()}/api/admin/shop/global-copy`, {
                        method: "PUT",
                        headers: authHeaders(true),
                        body: JSON.stringify({
                          notice: shopGlobalNotice.trim(),
                          warning: shopGlobalWarning.trim(),
                        }),
                      });
                      const j = (await r.json()) as { error?: { message?: string } };
                      if (!r.ok) {
                        setErr(j.error?.message ?? `Ошибка ${r.status}`);
                        return;
                      }
                      await loadShopGlobalCopy();
                    } catch {
                      setErr("Сеть недоступна");
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Сохранить тексты попапа
                </button>
              </>
            )}
          </div>

          <div className="card stack admin-mt-3">
            <h3 className="admin-mt-0">Покупки</h3>
            <div className="row">
              <div>
                <label htmlFor="shoppurchfilter">Товар</label>
                <select
                  id="shoppurchfilter"
                  value={shopPurchaseFilterItemId}
                  onChange={(e) => setShopPurchaseFilterItemId(e.target.value)}
                >
                  <option value="">Все</option>
                  {(adminShopItems ?? []).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.title} ({it.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {shopPurchasesLoading ? (
              <p className="muted">Загружаем покупки…</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Дата (UTC)</th>
                      <th>Товар</th>
                      <th>Пользователь</th>
                      <th>Цена</th>
                      <th>Счёт</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(adminShopPurchases ?? []).map((p) => (
                      <tr key={p.id}>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {p.createdAt.slice(0, 19).replace("T", " ")}
                        </td>
                        <td>
                          <strong>{p.itemTitle}</strong>
                          <div className="muted mono" style={{ fontSize: 11 }}>
                            {p.shopItemId}
                          </div>
                        </td>
                        <td>
                          {[p.firstName, p.lastName].filter(Boolean).join(" ") || "—"}
                          {p.username ? (
                            <div className="mono" style={{ fontSize: 12 }}>
                              @{p.username.replace(/^@+/, "")}
                            </div>
                          ) : p.telegramId ? (
                            <div className="mono muted" style={{ fontSize: 12 }}>
                              id {p.telegramId}
                            </div>
                          ) : null}
                        </td>
                        <td>{p.priceCoins.toLocaleString("ru-RU")}</td>
                        <td>{p.platform}</td>
                        <td>
                          {p.telegramChatLink ? (
                            <a
                              href={p.telegramChatLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="admin-link"
                            >
                              Написать
                            </a>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(adminShopPurchases ?? []).length === 0 && !shopPurchasesLoading ? (
              <p className="muted">Покупок пока нет.</p>
            ) : null}
          </div>

          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!token) return;
              if (!shopFormStockUnlimited && shopFormStockTotal < 1) {
                setErr("Укажите лимит ≥ 1 или включите «без лимита».");
                return;
              }
              const stockTotal = shopFormStockUnlimited ? null : shopFormStockTotal;
              setLoading(true);
              setErr(null);
              try {
                const shopBodyBase = {
                  title: shopFormTitle,
                  description: shopFormDescription.trim() || null,
                  imageUrl: shopFormImageUrl.trim() || null,
                  kind: shopFormKind,
                  priceCoins: shopFormPrice,
                  subtitle: shopFormSubtitle.trim() || null,
                  badgeText: shopFormBadgeText.trim() || null,
                  buttonLabel: shopFormButtonLabel.trim() || null,
                  sortOrder: shopFormSortOrder,
                  active: shopFormActive,
                  stockTotal,
                };
                const shopBody =
                  shopFormKind === "extra_spin"
                    ? { ...shopBodyBase, spins: shopFormSpins }
                    : shopBodyBase;

                if (shopEditingId) {
                  const r = await fetch(
                    `${apiBase()}/api/admin/shop/items/${encodeURIComponent(shopEditingId)}`,
                    {
                      method: "PUT",
                      headers: authHeaders(true),
                      body: JSON.stringify(shopBody),
                    }
                  );
                  const j = (await r.json()) as { error?: { message?: string } };
                  if (!r.ok) {
                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                    return;
                  }
                } else {
                  const r = await fetch(`${apiBase()}/api/admin/shop/items`, {
                    method: "POST",
                    headers: authHeaders(true),
                    body: JSON.stringify({
                      id: shopFormId.trim(),
                      ...shopBody,
                    }),
                  });
                  const j = (await r.json()) as { error?: { message?: string } };
                  if (!r.ok) {
                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                    return;
                  }
                }
                resetShopForm();
                await loadAdminShop();
                await loadAdminShopPurchases();
              } catch {
                setErr("Сеть недоступна");
              } finally {
                setLoading(false);
              }
            }}
          >
            <div>
              <label htmlFor="shopid">ID товара (латиница, без пробелов)</label>
              <input
                id="shopid"
                value={shopFormId}
                onChange={(e) => setShopFormId(e.target.value)}
                disabled={shopEditingId != null}
                required={shopEditingId == null}
                placeholder="extra_spin_pack_2"
              />
            </div>
            <div>
              <label htmlFor="shoptitle">Название</label>
              <input
                id="shoptitle"
                value={shopFormTitle}
                onChange={(e) => setShopFormTitle(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="shopdesc">Описание</label>
              <textarea
                id="shopdesc"
                value={shopFormDescription}
                onChange={(e) => setShopFormDescription(e.target.value)}
                rows={3}
                placeholder="Текст на карточке в приложении"
              />
            </div>
            <div>
              <label htmlFor="shopimg">Картинка (URL или data:image/*)</label>
              <textarea
                id="shopimg"
                value={shopFormImageUrl}
                onChange={(e) => setShopFormImageUrl(e.target.value)}
                rows={3}
                placeholder="https://... или data:image/png;base64,..."
              />
              <div className="row admin-mt-3">
                <div>
                  <label htmlFor="shopimgfile">Загрузить файл</label>
                  <input
                    id="shopimgfile"
                    type="file"
                    accept="image/*"
                    onChange={(e) => applyShopImageFromFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
              {shopFormImageUrl.trim() ? (
                <div className="admin-shop-preview admin-shop-preview--img admin-mt-3">
                  <img src={shopFormImageUrl.trim()} alt="Предпросмотр товара" />
                </div>
              ) : null}
            </div>
            <div>
              <label htmlFor="shopkind">Тип товара</label>
              <select
                id="shopkind"
                value={shopFormKind}
                onChange={(e) =>
                  setShopFormKind(e.target.value as "extra_spin" | "manual_fulfillment")
                }
              >
                <option value="extra_spin">Доп. спины (extra_spin)</option>
                <option value="manual_fulfillment">
                  Ручная выдача / подарок (manual_fulfillment)
                </option>
              </select>
            </div>
            <div className="row">
              <div>
                <label htmlFor="shopprice">Цена (монет)</label>
                <input
                  id="shopprice"
                  type="number"
                  min={1}
                  value={shopFormPrice}
                  onChange={(e) => setShopFormPrice(Number(e.target.value))}
                  required
                />
              </div>
              {shopFormKind === "extra_spin" ? (
                <div>
                  <label htmlFor="shopspins">Спинов в пакете</label>
                  <input
                    id="shopspins"
                    type="number"
                    min={1}
                    max={99}
                    value={shopFormSpins}
                    onChange={(e) => setShopFormSpins(Number(e.target.value))}
                    required
                  />
                </div>
              ) : null}
            </div>
            <div className="row">
              <div>
                <label htmlFor="shopsubtitle">Подзаголовок на карточке</label>
                <input
                  id="shopsubtitle"
                  value={shopFormSubtitle}
                  onChange={(e) => setShopFormSubtitle(e.target.value)}
                  placeholder="Короткая подпись под названием"
                />
              </div>
              <div>
                <label htmlFor="shopbadge">Бейдж (верхний левый)</label>
                <input
                  id="shopbadge"
                  value={shopFormBadgeText}
                  onChange={(e) => setShopFormBadgeText(e.target.value)}
                  placeholder="например: HOT"
                />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="shopbtnlabel">Текст кнопки/CTA</label>
                <input
                  id="shopbtnlabel"
                  value={shopFormButtonLabel}
                  onChange={(e) => setShopFormButtonLabel(e.target.value)}
                  placeholder="например: Купить сейчас"
                />
              </div>
              <div>
                <label htmlFor="shopsort">Порядок (меньше = выше)</label>
                <input
                  id="shopsort"
                  type="number"
                  value={shopFormSortOrder}
                  onChange={(e) => setShopFormSortOrder(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <label className="admin-checkbox-row">
                <input
                  type="checkbox"
                  checked={shopFormStockUnlimited}
                  onChange={(e) => setShopFormStockUnlimited(e.target.checked)}
                />
                <span className="admin-checkbox-row__text">Без лимита в наличии</span>
              </label>
              {!shopFormStockUnlimited ? (
                <div style={{ marginTop: 8 }}>
                  <label htmlFor="shopstock">Всего в наличии (штук)</label>
                  <input
                    id="shopstock"
                    type="number"
                    min={1}
                    value={shopFormStockTotal}
                    onChange={(e) => setShopFormStockTotal(Number(e.target.value))}
                  />
                </div>
              ) : null}
            </div>
            <div>
              <label className="admin-checkbox-row">
                <input
                  type="checkbox"
                  checked={shopFormActive}
                  onChange={(e) => setShopFormActive(e.target.checked)}
                />
                <span className="admin-checkbox-row__text">Активен (виден в приложении)</span>
              </label>
            </div>
            <div className="row">
              <button type="submit" className="primary" disabled={loading}>
                {shopEditingId ? "Сохранить" : "Добавить товар"}
              </button>
              {shopEditingId ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={loading}
                  onClick={() => {
                    resetShopForm();
                  }}
                >
                  Отменить правку
                </button>
              ) : null}
            </div>
          </form>

          {adminShopItems === null ? (
            <AdminSkeletonRows rows={3} />
          ) : (
            <>
              {shopLoading ? <p className="muted admin-refreshing">Загружаем…</p> : null}
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Изобр.</th>
                      <th>ID</th>
                      <th>Тип</th>
                      <th>Название</th>
                      <th>Цена</th>
                      <th>Порядок</th>
                      <th>Продано / лимит</th>
                      <th>Активен</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {adminShopItems.map((row) => (
                      <tr key={row.id}>
                        <td>
                          {row.imageUrl ? (
                            <img
                              src={row.imageUrl}
                              alt=""
                              className="admin-shop-table__thumb"
                            />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="mono">{row.id}</td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {row.kind}
                        </td>
                        <td>
                          <strong>{row.title}</strong>
                          {row.description ? (
                            <p className="muted admin-m-0" style={{ fontSize: 12, marginTop: 4 }}>
                              {row.description.length > 80
                                ? `${row.description.slice(0, 80)}…`
                                : row.description}
                            </p>
                          ) : null}
                          {((row.meta as { subtitle?: string | null } | null)?.subtitle ?? null) ? (
                            <p className="muted admin-m-0" style={{ fontSize: 12, marginTop: 4 }}>
                              {(row.meta as { subtitle?: string | null }).subtitle}
                            </p>
                          ) : null}
                        </td>
                        <td>{row.priceCoins.toLocaleString("ru-RU")}</td>
                        <td>
                          {typeof (row.meta as { sortOrder?: unknown } | null)?.sortOrder === "number"
                            ? (row.meta as { sortOrder?: number }).sortOrder
                            : 0}
                        </td>
                        <td>
                          {row.stockTotal == null
                            ? `${row.stockSold} / ∞`
                            : `${row.stockSold} / ${row.stockTotal}`}
                        </td>
                        <td>{row.active ? "да" : "нет"}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            disabled={loading}
                            onClick={() => {
                              const meta =
                                (row.meta && typeof row.meta === "object"
                                  ? (row.meta as {
                                      spins?: number;
                                      subtitle?: string | null;
                                      badgeText?: string | null;
                                      buttonLabel?: string | null;
                                      sortOrder?: number;
                                    })
                                  : null) ?? null;
                              setShopEditingId(row.id);
                              setShopFormId(row.id);
                              setShopFormTitle(row.title);
                              setShopFormDescription(row.description ?? "");
                              setShopFormImageUrl(row.imageUrl ?? "");
                              setShopFormPrice(row.priceCoins);
                              const sp = meta?.spins ?? 1;
                              setShopFormSpins(sp);
                              setShopFormSubtitle(meta?.subtitle ?? "");
                              setShopFormBadgeText(meta?.badgeText ?? "");
                              setShopFormButtonLabel(meta?.buttonLabel ?? "");
                              setShopFormSortOrder(meta?.sortOrder ?? 0);
                              setShopFormStockUnlimited(row.stockTotal == null);
                              setShopFormStockTotal(row.stockTotal ?? 100);
                              setShopFormActive(row.active);
                              setShopFormKind(
                                row.kind === "manual_fulfillment"
                                  ? "manual_fulfillment"
                                  : "extra_spin"
                              );
                            }}
                          >
                            Править
                          </button>{" "}
                          <button
                            type="button"
                            className="secondary"
                            disabled={loading}
                            onClick={async () => {
                              if (!token) return;
                              if (!window.confirm(`Удалить товар «${row.title}» (${row.id})?`)) return;
                              setLoading(true);
                              setErr(null);
                              try {
                                const r = await fetch(
                                  `${apiBase()}/api/admin/shop/items/${encodeURIComponent(row.id)}`,
                                  { method: "DELETE", headers: authHeaders() }
                                );
                                const j = (await r.json()) as { error?: { message?: string } };
                                if (!r.ok) {
                                  setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                  return;
                                }
                                if (shopEditingId === row.id) {
                                  resetShopForm();
                                }
                                await loadAdminShop();
                                await loadAdminShopPurchases();
                              } catch {
                                setErr("Сеть недоступна");
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >
                            Удалить
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {adminShopItems.length === 0 ? (
                <p className="muted">Пока нет товаров — добавьте первый формой выше.</p>
              ) : null}
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
              if (taskFormChainKey.trim()) {
                meta.chainKey = taskFormChainKey.trim();
                meta.chainOrder = taskFormChainOrder;
              } else {
                delete meta.chainKey;
                delete meta.chainOrder;
              }
              if (taskFormProgressSource.trim()) {
                meta.progressSource = taskFormProgressSource.trim();
                meta.targetValue = taskFormTargetValue;
                if (taskFormProgressLabel.trim()) meta.progressLabel = taskFormProgressLabel.trim();
              } else {
                delete meta.progressSource;
                delete meta.targetValue;
                delete meta.progressLabel;
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
              if (taskFormCoverImageUrl.trim())
                meta.coverImageUrl = taskFormCoverImageUrl.trim();
              else delete meta.coverImageUrl;

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
                setTaskFormChainKey("");
                setTaskFormChainOrder(1);
                setTaskFormProgressSource("");
                setTaskFormTargetValue(0);
                setTaskFormProgressLabel("");
                setTaskFormCoverImageUrl("");
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
            <p className="muted admin-m-0" style={{fontWeight:600}}>Цепочка / прогрессия (динамические задания)</p>
            <div className="row">
              <div>
                <label htmlFor="tchk">Chain Key</label>
                <input
                  id="tchk"
                  value={taskFormChainKey}
                  onChange={(e) => setTaskFormChainKey(e.target.value)}
                  placeholder="invite, streams_twitch…"
                />
              </div>
              <div>
                <label htmlFor="tcho">Порядок</label>
                <input
                  id="tcho"
                  type="number"
                  min={1}
                  value={taskFormChainOrder}
                  onChange={(e) => setTaskFormChainOrder(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="tpsrc">Источник прогресса</label>
                <select
                  id="tpsrc"
                  value={taskFormProgressSource}
                  onChange={(e) => setTaskFormProgressSource(e.target.value)}
                >
                  <option value="">— нет —</option>
                  <option value="referrals_total">Рефералы</option>
                  <option value="streak_twitch">Стрик Twitch</option>
                  <option value="streak_kick">Стрик Kick</option>
                  <option value="linked_twitch">Привязка Twitch</option>
                  <option value="linked_kick">Привязка Kick</option>
                  <option value="stream_messages_twitch">Сообщения Twitch</option>
                  <option value="stream_messages_kick">Сообщения Kick</option>
                </select>
              </div>
              <div>
                <label htmlFor="ttarget">Цель</label>
                <input
                  id="ttarget"
                  type="number"
                  min={1}
                  value={taskFormTargetValue}
                  onChange={(e) => setTaskFormTargetValue(Number(e.target.value))}
                  placeholder="5"
                />
              </div>
              <div>
                <label htmlFor="tplbl">Подпись</label>
                <input
                  id="tplbl"
                  value={taskFormProgressLabel}
                  onChange={(e) => setTaskFormProgressLabel(e.target.value)}
                  placeholder="Друзья"
                />
              </div>
            </div>
            <div>
              <label htmlFor="tcover">Фон карточки (URL или data:image/*)</label>
              <textarea
                id="tcover"
                value={taskFormCoverImageUrl}
                onChange={(e) => setTaskFormCoverImageUrl(e.target.value)}
                rows={2}
                placeholder="https://... — в приложении размытый фон карточки и модалки"
              />
              <div className="row admin-mt-3">
                <div>
                  <label htmlFor="tcoverfile">Загрузить файл обложки</label>
                  <input
                    id="tcoverfile"
                    type="file"
                    accept="image/*"
                    onChange={(e) => applyTaskCoverFromFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
              {taskFormCoverImageUrl.trim() ? (
                <div className="admin-shop-preview admin-shop-preview--img admin-mt-3">
                  <img src={taskFormCoverImageUrl.trim()} alt="Предпросмотр обложки задания" />
                </div>
              ) : null}
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
                    setTaskFormChainKey("");
                    setTaskFormChainOrder(1);
                    setTaskFormProgressSource("");
                    setTaskFormTargetValue(0);
                    setTaskFormProgressLabel("");
                    setTaskFormCoverImageUrl("");
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
                <li key={row.id} style={row.active ? undefined : { background: "rgba(248,113,113,0.06)", borderRadius: 8, padding: "2px 0" }}>
                  <div className="admin-gw-row">
                    <div className="admin-gw-main">
                      <strong>{row.title}</strong>{" "}
                      <span className="muted">
                        <code>{row.id}</code> · {row.platform} · {row.type} · {row.validationType} ·{" "}
                        <span style={row.active ? { color: "#4ade80" } : { color: "#f87171", fontWeight: 700 }}>
                          {row.active ? "вкл" : "выкл"}
                        </span>
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
                          setTaskFormChainKey(typeof m.chainKey === "string" ? m.chainKey : "");
                          setTaskFormChainOrder(typeof m.chainOrder === "number" ? m.chainOrder : 1);
                          setTaskFormProgressSource(typeof m.progressSource === "string" ? m.progressSource : "");
                          setTaskFormTargetValue(typeof m.targetValue === "number" ? m.targetValue : 0);
                          setTaskFormProgressLabel(typeof m.progressLabel === "string" ? m.progressLabel : "");
                          setTaskFormCoverImageUrl(
                            typeof m.coverImageUrl === "string" ? m.coverImageUrl : ""
                          );
                        }}
                      >
                        Править
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={loading}
                        style={row.active ? undefined : { borderColor: "#4ade80", color: "#4ade80" }}
                        onClick={async () => {
                          if (!token) return;
                          const newActive = !row.active;
                          const msg = newActive
                            ? `Включить задание «${row.id}»?`
                            : `Скрыть задание «${row.id}»?`;
                          if (!window.confirm(msg)) return;
                          setLoading(true);
                          setErr(null);
                          try {
                            const r = await fetch(
                              `${apiBase()}/api/admin/tasks/${encodeURIComponent(row.id)}/toggle`,
                              {
                                method: "PATCH",
                                headers: authHeaders(true),
                                body: JSON.stringify({ active: newActive }),
                              }
                            );
                            const j = (await r.json()) as { error?: { message?: string } };
                            if (!r.ok) {
                              setErr(j.error?.message ?? `Ошибка ${r.status}`);
                              return;
                            }
                            await loadAdminTasks();
                          } catch {
                            setErr("Сеть недоступна");
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        {row.active ? "Скрыть" : "Включить"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={loading}
                        style={{ borderColor: "#f87171", color: "#f87171" }}
                        title="Удалить задание и связанные user_tasks / evidence из БД"
                        onClick={async () => {
                          if (!token) return;
                          if (
                            !window.confirm(
                              `Удалить задание «${row.id}» безвозвратно?\n\nБудут удалены прогресс пользователей и загруженные доказательства по этому заданию.`
                            )
                          ) {
                            return;
                          }
                          setLoading(true);
                          setErr(null);
                          try {
                            const r = await fetch(
                              `${apiBase()}/api/admin/tasks/${encodeURIComponent(row.id)}`,
                              {
                                method: "DELETE",
                                headers: authHeaders(),
                              }
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
                              setTaskFormChainKey("");
                              setTaskFormChainOrder(1);
                              setTaskFormProgressSource("");
                              setTaskFormTargetValue(0);
                              setTaskFormProgressLabel("");
                            }
                            await loadAdminTasks();
                          } catch {
                            setErr("Сеть недоступна");
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              </ul>
            </>
          )}
          <h3 className="admin-mt-0">BR / task evidence (pending)</h3>
          {taskEvidenceRows === null ? (
            <AdminSkeletonRows rows={2} />
          ) : taskEvidenceRows.length === 0 ? (
            <p className="muted">Нет заявок на проверку.</p>
          ) : (
            <>
              {taskEvidenceLoading ? <p className="muted admin-refreshing">Обновляем evidence…</p> : null}
              <ul className="list">
                {taskEvidenceRows.map((ev) => (
                  <li key={ev.id}>
                    <div className="admin-gw-row">
                      <div className="admin-gw-main">
                        <strong>{ev.taskTitle}</strong>{" "}
                        <span className="muted">
                          <code>{ev.taskId}</code> · stage {ev.stage} · user {ev.userId.slice(0, 8)}…
                        </span>
                        <div className="muted admin-muted-gap">
                          {ev.images.length} изображений · {new Date(ev.createdAt).toLocaleString("ru-RU")}
                        </div>
                        {ev.note ? <p className="muted admin-m-0">{ev.note}</p> : null}
                        <div className="admin-evidence-grid">
                          {(Array.isArray(ev.images) ? ev.images : []).map((img, idx) => {
                            if (typeof img !== "string" || !img.trim()) return null;
                            const isData = /^data:image\//i.test(img);
                            const isHttp = /^https?:\/\//i.test(img);
                            const canInline = isData || isHttp;
                            return (
                              <div key={idx} className="admin-evidence-card">
                                {canInline ? (
                                  <>
                                    <img
                                      src={img}
                                      alt={`Скриншот ${idx + 1} · ${ev.taskTitle}`}
                                      className="admin-evidence-thumb"
                                      loading="lazy"
                                    />
                                    <details className="admin-evidence-details">
                                      <summary className="admin-evidence-details__summary">
                                        Крупнее
                                      </summary>
                                      <div className="admin-evidence-full-wrap">
                                        <img
                                          src={img}
                                          alt=""
                                          className="admin-evidence-full"
                                        />
                                      </div>
                                    </details>
                                    {isHttp ? (
                                      <a
                                        href={img}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="secondary admin-evidence-link"
                                      >
                                        Открыть URL
                                      </a>
                                    ) : (
                                      <a
                                        href={img}
                                        download={`${ev.taskId}-stage${ev.stage}-${idx + 1}.png`}
                                        className="secondary admin-evidence-link"
                                      >
                                        Скачать файл
                                      </a>
                                    )}
                                  </>
                                ) : (
                                  <a
                                    href={img}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="secondary"
                                  >
                                    Вложение {idx + 1}
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="admin-actions">
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
                                `${apiBase()}/api/admin/tasks/evidence/${encodeURIComponent(ev.id)}`,
                                {
                                  method: "PATCH",
                                  headers: authHeaders(true),
                                  body: JSON.stringify({ status: "approved" }),
                                }
                              );
                              const j = (await r.json()) as { error?: { message?: string } };
                              if (!r.ok) {
                                setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                return;
                              }
                              await loadTaskEvidence();
                            } catch {
                              setErr("Сеть недоступна");
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          Одобрить
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={loading}
                          onClick={async () => {
                            if (!token) return;
                            const note = window.prompt("Причина отклонения (опционально)") ?? "";
                            setLoading(true);
                            setErr(null);
                            try {
                              const r = await fetch(
                                `${apiBase()}/api/admin/tasks/evidence/${encodeURIComponent(ev.id)}`,
                                {
                                  method: "PATCH",
                                  headers: authHeaders(true),
                                  body: JSON.stringify({ status: "rejected", adminNote: note }),
                                }
                              );
                              const j = (await r.json()) as { error?: { message?: string } };
                              if (!r.ok) {
                                setErr(j.error?.message ?? `Ошибка ${r.status}`);
                                return;
                              }
                              await loadTaskEvidence();
                            } catch {
                              setErr("Сеть недоступна");
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          Отклонить
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
              <div className="card stack">
                <button
                  type="button"
                  className="admin-disclosure"
                  aria-expanded={dropHistoryOpen}
                  onClick={() => {
                    setDropHistoryOpen((open) => {
                      if (open) {
                        setDropClaimantsDropId(null);
                        setDropClaimants(null);
                        setDropClaimantsLoading(false);
                      }
                      return !open;
                    });
                  }}
                >
                  <span className="admin-disclosure__text">
                    <strong>История дропов</strong>{" "}
                    <span className="muted">
                      (всего в базе: {dropHistoryTotal})
                    </span>
                  </span>
                  <span className="admin-disclosure__chev" aria-hidden>
                    {dropHistoryOpen ? "▼" : "▶"}
                  </span>
                </button>
                {dropHistoryOpen ? (
                  <>
                    <p className="muted admin-m-0">
                      Нажмите строку таблицы, чтобы увидеть получивших монеты.
                    </p>
                    {dropHistoryLoading ? (
                      <p className="muted admin-m-0">Загрузка…</p>
                    ) : !dropHistory || dropHistory.length === 0 ? (
                      <p className="muted admin-m-0">Пока нет записей дропов.</p>
                    ) : (
                      <div className="admin-users-wrap">
                        <table className="admin-users-table">
                          <thead>
                            <tr>
                              <th>Код</th>
                              <th>Платформа</th>
                              <th>Победители</th>
                              <th>Награда</th>
                              <th>Старт</th>
                              <th>Статус</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dropHistory.map((d) => (
                              <tr
                                key={d.id}
                                style={{
                                  cursor: "pointer",
                                  background:
                                    dropClaimantsDropId === d.id
                                      ? "rgba(94, 234, 212, 0.08)"
                                      : undefined,
                                }}
                                onClick={() => {
                                  setDropClaimantsDropId(d.id);
                                  setDropClaimants(null);
                                  setDropClaimantsLoading(true);
                                  void (async () => {
                                    try {
                                      const r = await fetch(
                                        `${apiBase()}/api/admin/drops/${encodeURIComponent(d.id)}/claimants`,
                                        { headers: authHeaders() }
                                      );
                                      const j = (await r.json()) as {
                                        claimants?: DropClaimantRow[];
                                      };
                                      if (r.ok) setDropClaimants(j.claimants ?? []);
                                    } finally {
                                      setDropClaimantsLoading(false);
                                    }
                                  })();
                                }}
                              >
                                <td className="mono">{d.code}</td>
                                <td>{d.platform}</td>
                                <td>
                                  {d.winnersCount} / {d.maxWinners}
                                </td>
                                <td>
                                  {d.rewardMin}–{d.rewardMax}
                                </td>
                                <td className="muted admin-table-nowrap">
                                  {new Date(d.startedAt).toLocaleString("ru-RU")}
                                </td>
                                <td>{d.active ? "активен" : "завершён"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {dropClaimantsDropId ? (
                      <div className="admin-drop-claimants">
                        <p className="admin-m-0">
                          <strong>Получили монеты</strong>{" "}
                          <span className="muted">
                            (дроп {dropClaimantsDropId.slice(0, 8)}…)
                          </span>
                        </p>
                        {dropClaimantsLoading ? (
                          <p className="muted admin-m-0">Загрузка…</p>
                        ) : !dropClaimants || dropClaimants.length === 0 ? (
                          <p className="muted admin-m-0">
                            Никто не получил награду в этом дропе.
                          </p>
                        ) : (
                          <ul className="list">
                            {dropClaimants.map((c) => (
                              <li key={c.userId}>
                                <strong>
                                  {c.username
                                    ? `@${c.username}`
                                    : c.firstName || `${c.userId.slice(0, 8)}…`}
                                </strong>
                                : +{c.rewardCoins} монет
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </>
                ) : null}
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
                await loadDropHistory();
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

          </main>
        </div>
      </div>

      {userManageModal ? (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={() => setUserManageModal(null)}
        >
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-user-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal__head">
              <h2 id="admin-user-modal-title" className="admin-modal__title">
                Пользователь{" "}
                {userManageModal.username
                  ? `@${userManageModal.username}`
                  : userManageModal.firstName ?? userManageModal.id.slice(0, 8)}
              </h2>
              <button
                type="button"
                className="secondary"
                onClick={() => setUserManageModal(null)}
              >
                Закрыть
              </button>
            </div>
            <p className="muted mono">id: {userManageModal.id}</p>

            <h3 className="admin-modal__h3">Дерево рефералов (прямые)</h3>
            {userManageRefsLoading ? (
              <p className="muted">Загрузка…</p>
            ) : userManageRefs && userManageRefs.length === 0 ? (
              <p className="muted">Нет приглашённых.</p>
            ) : (
              <div className="admin-users-wrap">
                <table className="admin-users-table">
                  <thead>
                    <tr>
                      <th>Имя / ник</th>
                      <th>TG</th>
                      <th>Статус</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(userManageRefs ?? []).map((ref) => (
                      <tr key={ref.refereeId}>
                        <td>
                          {ref.username
                            ? `@${ref.username}`
                            : ref.firstName ?? ref.refereeId.slice(0, 8)}
                        </td>
                        <td className="mono">{ref.telegramId ?? "—"}</td>
                        <td>{ref.qualified ? "квал." : "ожидает"}</td>
                        <td className="muted admin-table-nowrap">
                          {new Date(ref.createdAt).toLocaleString("ru-RU")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 className="admin-modal__h3">Корректировка баланса</h3>
            <p className="muted">
              Целые монеты Twitch / Kick (отрицательное число — списание). Суммарный баланс в
              таблице обновится после сохранения.
            </p>
            <div className="row">
              <div>
                <label htmlFor="admTwD">Δ Twitch</label>
                <input
                  id="admTwD"
                  type="number"
                  value={userManageTwDelta}
                  onChange={(e) => setUserManageTwDelta(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="admKiD">Δ Kick</label>
                <input
                  id="admKiD"
                  type="number"
                  value={userManageKiDelta}
                  onChange={(e) => setUserManageKiDelta(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="primary"
              disabled={loading || !token}
              onClick={async () => {
                if (!token || !userManageModal) return;
                const twitchDelta = Number.parseInt(userManageTwDelta, 10);
                const kickDelta = Number.parseInt(userManageKiDelta, 10);
                if (!Number.isFinite(twitchDelta) || !Number.isFinite(kickDelta)) {
                  setErr("Введите целые числа для дельт");
                  return;
                }
                if (twitchDelta === 0 && kickDelta === 0) {
                  setErr("Укажите ненулевую корректировку");
                  return;
                }
                setLoading(true);
                setErr(null);
                try {
                  const r = await fetch(
                    `${apiBase()}/api/admin/users/${encodeURIComponent(userManageModal.id)}/balance`,
                    {
                      method: "POST",
                      headers: authHeaders(true),
                      body: JSON.stringify({ twitchDelta, kickDelta }),
                    }
                  );
                  const j = (await r.json()) as { error?: { message?: string } };
                  if (!r.ok) {
                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                    return;
                  }
                  setUserManageTwDelta("");
                  setUserManageKiDelta("");
                  await loadAdminUsers(usersOffset);
                  setUserManageModal(null);
                } catch {
                  setErr("Сеть недоступна");
                } finally {
                  setLoading(false);
                }
              }}
            >
              Применить баланс
            </button>

            <h3 className="admin-modal__h3">Платформы</h3>
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={loading || !token}
                onClick={async () => {
                  if (!token || !userManageModal) return;
                  if (!window.confirm("Снять привязку Twitch?")) return;
                  setLoading(true);
                  setErr(null);
                  try {
                    const r = await fetch(
                      `${apiBase()}/api/admin/users/${encodeURIComponent(userManageModal.id)}/platforms/twitch`,
                      { method: "DELETE", headers: authHeaders() }
                    );
                    const j = (await r.json()) as { error?: { message?: string } };
                    if (!r.ok) {
                      setErr(j.error?.message ?? `Ошибка ${r.status}`);
                      return;
                    }
                    await loadAdminUsers(usersOffset);
                    setUserManageModal(null);
                  } catch {
                    setErr("Сеть недоступна");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Отвязать Twitch
              </button>
              <button
                type="button"
                className="secondary"
                disabled={loading || !token}
                onClick={async () => {
                  if (!token || !userManageModal) return;
                  if (!window.confirm("Снять привязку Kick?")) return;
                  setLoading(true);
                  setErr(null);
                  try {
                    const r = await fetch(
                      `${apiBase()}/api/admin/users/${encodeURIComponent(userManageModal.id)}/platforms/kick`,
                      { method: "DELETE", headers: authHeaders() }
                    );
                    const j = (await r.json()) as { error?: { message?: string } };
                    if (!r.ok) {
                      setErr(j.error?.message ?? `Ошибка ${r.status}`);
                      return;
                    }
                    await loadAdminUsers(usersOffset);
                    setUserManageModal(null);
                  } catch {
                    setErr("Сеть недоступна");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Отвязать Kick
              </button>
            </div>

            <h3 className="admin-modal__h3">Удаление</h3>
            <button
              type="button"
              className="secondary"
              style={{ borderColor: "#b45309", color: "#fdba74" }}
              disabled={loading || !token}
              onClick={async () => {
                if (!token || !userManageModal) return;
                if (
                  !window.confirm(
                    "Удалить пользователя и все связанные данные? Действие необратимо."
                  )
                ) {
                  return;
                }
                setLoading(true);
                setErr(null);
                try {
                  const r = await fetch(
                    `${apiBase()}/api/admin/users/${encodeURIComponent(userManageModal.id)}`,
                    { method: "DELETE", headers: authHeaders() }
                  );
                  const j = (await r.json()) as { error?: { message?: string } };
                  if (!r.ok) {
                    setErr(j.error?.message ?? `Ошибка ${r.status}`);
                    return;
                  }
                  setUserManageModal(null);
                  await loadAdminUsers(usersOffset);
                } catch {
                  setErr("Сеть недоступна");
                } finally {
                  setLoading(false);
                }
              }}
            >
              Удалить аккаунт
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
