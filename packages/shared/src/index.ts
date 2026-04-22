export type Platform = "twitch" | "kick" | "global" | "telegram";
export type TaskType = "daily" | "one-time";
export type ValidationType = "api" | "manual";

/** Иконка в блоке справки (модалка «как на третьем скрине»). */
export type TaskHelpIcon = "tv" | "gift" | "help" | "radio";

export interface TaskHelpHint {
  title: string;
  body: string;
  icon?: TaskHelpIcon;
}

/** Примеры скринов для HARD-заданий (URL от корня сайта, например /tasks/br/…). */
export interface TaskEvidenceExample {
  src: string;
  caption?: string;
}

/** Ответ `POST /api/v1/media/images` — набор URL для `<picture>` + LQIP. */
export interface MediaImageUrlsByWidth {
  avif: string;
  webp: string;
  jpeg: string;
}

export interface MediaImageUploadResponse {
  hash: string;
  basePath: string;
  widths: number[];
  urlsByWidth: Record<string, MediaImageUrlsByWidth>;
  srcset: { avif: string; webp: string; jpeg: string };
  fallbackSrc: string;
  lqipDataUrl: string;
  processMs: number;
}

/** Совпадает с `IMAGE_WIDTHS` в apps/api — не рассинхронить. */
export const MEDIA_PIPELINE_WIDTHS = [320, 640, 960, 1280] as const;

const ADMIN_MEDIA_LQIP_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Из полного URL CDN (base `.../images/<hash>`, `.../images/<hash>/` или файл `.../640w.jpg`)
 * получает канонический base без завершающего слэша. Иначе null.
 */
export function extractCdnImageBasePath(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^data:image\//i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  let path = u.pathname.replace(/\/$/, "");
  if (/\/\d+w\.(avif|webp|jpe?g)$/i.test(path)) {
    path = path.replace(/\/\d+w\.(avif|webp|jpe?g)$/i, "");
  }
  const parts = path.split("/").filter(Boolean);
  const imagesIdx = parts.lastIndexOf("images");
  if (imagesIdx < 0 || imagesIdx + 1 >= parts.length) return null;
  const hash = parts[imagesIdx + 1]!;
  if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
  u.pathname = "/" + parts.slice(0, imagesIdx + 2).join("/");
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

/** Полный объект как после upload — для превью в админке по base path CDN. */
export function buildMediaImageFromCdnBasePath(basePath: string): MediaImageUploadResponse {
  const base = basePath.trim().replace(/\/+$/, "");
  const segments = base.split("/").filter(Boolean);
  const hash = segments[segments.length - 1] ?? "";
  const widths = [...MEDIA_PIPELINE_WIDTHS];
  const urlsByWidth: Record<string, MediaImageUrlsByWidth> = {};
  for (const w of widths) {
    urlsByWidth[String(w)] = {
      avif: `${base}/${w}w.avif`,
      webp: `${base}/${w}w.webp`,
      jpeg: `${base}/${w}w.jpg`,
    };
  }
  const srcset = {
    avif: widths.map((w) => `${base}/${w}w.avif ${w}w`).join(", "),
    webp: widths.map((w) => `${base}/${w}w.webp ${w}w`).join(", "),
    jpeg: widths.map((w) => `${base}/${w}w.jpg ${w}w`).join(", "),
  };
  const fallbackW = widths[widths.length - 1]!;
  return {
    hash,
    basePath: base,
    widths,
    urlsByWidth,
    srcset,
    fallbackSrc: `${base}/${fallbackW}w.jpg`,
    lqipDataUrl: ADMIN_MEDIA_LQIP_PLACEHOLDER,
    processMs: 0,
  };
}

export function tryBuildMediaImageFromImageUrl(
  url: string | null | undefined
): MediaImageUploadResponse | null {
  const b = url?.trim() ? extractCdnImageBasePath(url) : null;
  return b ? buildMediaImageFromCdnBasePath(b) : null;
}

export function parseMediaImageUploadResponse(v: unknown): MediaImageUploadResponse | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.fallbackSrc !== "string" || typeof o.hash !== "string") return null;
  if (!o.srcset || typeof o.srcset !== "object") return null;
  const ss = o.srcset as Record<string, unknown>;
  if (typeof ss.avif !== "string" || typeof ss.webp !== "string" || typeof ss.jpeg !== "string") {
    return null;
  }
  return v as MediaImageUploadResponse;
}

export type AdminImagePreviewResolved =
  | { mode: "responsive"; media: MediaImageUploadResponse }
  | { mode: "direct"; src: string };

/**
 * Нормализация для превью в админке: полный media-объект, CDN base → synthetic media,
 * иначе прямой URL (внешний, data, или неподходящий под паттерн CDN).
 */
export function resolveAdminImageForPreview(
  url: string | null | undefined,
  media: unknown
): AdminImagePreviewResolved | null {
  const parsed = parseMediaImageUploadResponse(media);
  if (parsed) return { mode: "responsive", media: parsed };
  const u = url?.trim();
  if (!u) return null;
  const fromCdn = tryBuildMediaImageFromImageUrl(u);
  if (fromCdn) return { mode: "responsive", media: fromCdn };
  if (/^data:image\//i.test(u)) return { mode: "direct", src: u };
  if (/^https?:\/\//i.test(u)) return { mode: "direct", src: u };
  return null;
}

export interface TaskDto {
  id: string;
  title: string;
  description: string;
  reward: number;
  platform: Platform;
  type: TaskType;
  validationType: ValidationType;
  userStatus: UserTaskStatus;
  periodKey?: string | null;
  /** Правила проверки API (Helix / Kick) + UI-поля (actionUrl, help, …) */
  meta?: Record<string, unknown> | null;
  lastError?: string | null;
  /** Ссылка для кнопки «Подписаться» / открыть канал (из meta.actionUrl). */
  actionUrl?: string | null;
  /** Текст кнопки внешнего действия (из meta.actionLabel). */
  actionLabel?: string | null;
  /** Текст кнопки проверки / получения награды (из meta.verifyLabel). */
  verifyLabel?: string | null;
  /** Справка в стиле отдельной модалки (из meta.help). */
  help?: TaskHelpHint | null;
  /** Единый прогресс для цепочек (invite/streams/messages/subscriptions). */
  progressCurrent?: number;
  progressTarget?: number;
  progressLabel?: string | null;
  /** Логическая категория цепочки, чтобы UI не дёргался при замене этапа. */
  chainKey?: string | null;
  /** Порядок этапа в цепочке (из meta.chainOrder); для evidence и цепочек с несколькими заданиями. */
  chainOrder?: number | null;
  /** Для визуального выделения сложных задач (например BR). */
  hard?: boolean;
  /** Для HARD-цепочек: сколько этапов подтверждено админом или уже получена награда (0…total). */
  hardStageCurrent?: number;
  hardStageTotal?: number;
  /** Группа на экране заданий (из meta.uiSection). */
  uiSection?: string | null;
  /** Порядок внутри группы (из meta.uiOrder). */
  uiOrder?: number;
  /** Фон карточки и модалки задания (из meta.coverImageUrl), URL или data:image. */
  coverImageUrl?: string | null;
  /** Обложка через медиа-пайплайн (AVIF/WebP/JPEG + LQIP), если задано в meta.coverImageMedia. */
  coverImageMedia?: MediaImageUploadResponse | null;
  /** Нужны скрины + модерация перед получением награды. */
  requiresEvidence?: boolean;
  evidenceExamples?: TaskEvidenceExample[];
  /** Статус скринов для этапа этого задания (stage = chainOrder ?? hardStageCurrent+1 из meta задания). */
  evidenceStageStatus?: "none" | "submitted" | "approved" | "rejected";
  /** Комментарий админа при отклонении. */
  evidenceAdminNote?: string | null;
}

export type UserTaskStatus =
  | "locked"
  | "available"
  | "pending"
  | "completed"
  | "expired";

export type MePlatformsState = {
  twitch:
    | { status: "not_connected" }
    | {
        status: "connected";
        displayName: string | null;
        avatarUrl: string | null;
      };
  kick:
    | { status: "not_connected" }
    | {
        status: "connected";
        displayName: string | null;
        avatarUrl: string | null;
      };
};

/** Профиль и привязки (без баланса/уровня/стрика). Кэш: semi-static. */
export interface MeProfileResponse {
  id: string;
  telegramId: string | null;
  email: string | null;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  referralCode: string;
  referralLinkMiniApp: string;
  referralLinkWeb: string;
  referralLink: string;
  referralCount: number;
  platforms: MePlatformsState;
  banned: boolean;
  banReason: string | null;
  banAppealPending: boolean;
  leaderboardRankCoins: number | null;
}

/** Баланс, прогресс и стрики. Основной источник обновлений — WebSocket. */
export interface MeEconomyResponse {
  coins: number;
  coinsTwitch: number;
  coinsKick: number;
  lifetimeEarned: number;
  lifetimeTwitch: number;
  lifetimeKick: number;
  level: number;
  rewardMultiplier: number;
  streak: number;
  streakTwitch: number;
  streakKick: number;
}

export function mergeMeProfileAndEconomy(
  profile: MeProfileResponse,
  economy: MeEconomyResponse
): MeResponse {
  return { ...profile, ...economy };
}

/** Обратное к merge: для одного ответа `GET /api/v1/me` и записи в раздельные кэши profile/economy. */
export function splitMeResponse(me: MeResponse): {
  profile: MeProfileResponse;
  economy: MeEconomyResponse;
} {
  const {
    coins,
    coinsTwitch,
    coinsKick,
    lifetimeEarned,
    lifetimeTwitch,
    lifetimeKick,
    level,
    rewardMultiplier,
    streak,
    streakTwitch,
    streakKick,
    ...profileRest
  } = me;
  return {
    profile: profileRest as MeProfileResponse,
    economy: {
      coins,
      coinsTwitch,
      coinsKick,
      lifetimeEarned,
      lifetimeTwitch,
      lifetimeKick,
      level,
      rewardMultiplier,
      streak,
      streakTwitch,
      streakKick,
    },
  };
}

export interface HomeContentResponse {
  faq: { q: string; a: string }[];
}

export interface HomeGiveawayPublic {
  id: string;
  title: string;
  prizeText: string;
  description: string | null;
  imageUrl: string | null;
  /** Полный набор URL после пайплайна (для `<picture>`). */
  imageMedia?: MediaImageUploadResponse | null;
  endsAt: string;
  winnerCount: number;
  ticketPriceCoins: number;
  participantCount: number;
  drawnAt: string | null;
}

export interface HomeGiveawaysResponse {
  /** Активные и ещё не разыгранные (как раньше). */
  giveaways: HomeGiveawayPublic[];
  /** Недавно завершённые для блока на главной и вкладки «История». */
  completedGiveaways: HomeGiveawayPublic[];
}

export interface FortuneConfigResponse {
  paidSpinCost: number;
  segments: {
    index: number;
    type: "coins" | "nothing";
    value?: number;
    label: string;
  }[];
}

export interface FortuneStateResponse {
  utcDate: string;
  freeAvailable: boolean;
}

export interface MeResponse {
  id: string;
  /** null — только веб, до привязки Telegram */
  telegramId: string | null;
  /** Email для входа с сайта */
  email: string | null;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  /** Сумма Twitch + Kick (всего). */
  coins: number;
  coinsTwitch: number;
  coinsKick: number;
  lifetimeEarned: number;
  lifetimeTwitch: number;
  lifetimeKick: number;
  level: number;
  rewardMultiplier: number;
  /** Максимум из streakTwitch и streakKick (топ по стрику). */
  streak: number;
  /** Дней подряд с заходом на стрим Twitch (UTC). */
  streakTwitch: number;
  /** Дней подряд с заходом на стрим Kick (UTC). */
  streakKick: number;
  referralCode: string;
  /** Мини-приложение: `t.me/...?startapp=ref_*` */
  referralLinkMiniApp: string;
  /** Сайт: главная с `?ref=` для регистрации в браузере */
  referralLinkWeb: string;
  /** Совместимость: то же, что referralLinkMiniApp */
  referralLink: string;
  referralCount: number;
  platforms: MePlatformsState;
  /** Доступ к приложению закрыт (кроме /me и апелляции). */
  banned: boolean;
  banReason: string | null;
  /** Отправлена апелляция, ожидает рассмотрения. */
  banAppealPending: boolean;
  /** Ранг в глобальном топе по сумме монет (Twitch+Kick). */
  leaderboardRankCoins: number | null;
}

/** Срез экономики из WS `me_update` / мутаций (совпадает с числовыми полями MeEconomyResponse). */
export interface MeEconomyPatch {
  coins: number;
  coinsTwitch: number;
  coinsKick: number;
  lifetimeEarned: number;
  lifetimeTwitch: number;
  lifetimeKick: number;
  level: number;
  rewardMultiplier: number;
  streak: number;
  streakTwitch: number;
  streakKick: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  value: number;
  photoUrl: string | null;
}

export interface LeaderboardResponse {
  sort: "coins" | "streak" | "referrals";
  platform: "all" | Platform;
  top: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

export interface ReferralRow {
  refereeId: string;
  displayName: string;
  createdAt: string;
  qualified: boolean;
}

export interface ReferralsResponse {
  referralLink: string;
  referralLinkMiniApp: string;
  referralLinkWeb: string;
  totalInvited: number;
  qualifiedCount: number;
  invited: ReferralRow[];
}
