import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { WebSocket } from "ws";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { appSettings } from "../db/schema.js";
import {
  MEDIA_CACHE_CONTROL,
  getS3Client,
  mediaBucket,
  mediaPublicBaseUrl,
  mediaStorageConfigured,
} from "./mediaConfig.js";

const SETTINGS_KEY = "obs_purchase_widget";
const DEFAULT_STREAMER_ID = "default";

export type ObsWidgetPosition =
  | "bottom"
  | "center"
  | "top"
  | "bottom-left"
  | "bottom-right";

export type ObsWidgetStyle = "auto" | "twitch" | "kick" | "neon" | "minimal";
export type ObsWidgetDefaultSound = "soft" | "spark" | "bell";

export type ObsPurchaseWidgetSettings = {
  token: string;
  streamerId: string;
  soundEnabled: boolean;
  soundUrl: string | null;
  defaultSound: ObsWidgetDefaultSound;
  volume: number;
  position: ObsWidgetPosition;
  durationMs: number;
  showBuyerMessage: boolean;
  style: ObsWidgetStyle;
  accentColor: string;
  fontFamily: string;
};

export type ObsPurchaseAlertEvent = {
  type: "purchase_alert";
  v: 1;
  data: {
    buyerName: string;
    buyerUsername: string | null;
    productName: string;
    productImage: string | null;
    price: number;
    currency: string;
    buyerMessage: string | null;
    createdAt: string;
    streamerId: string;
    purchasePlatform: "twitch" | "kick";
    streamPlatform: "twitch" | "kick";
  };
};

export type ObsWidgetWireEvent =
  | ObsPurchaseAlertEvent
  | {
      type: "widget_settings";
      v: 1;
      data: Omit<ObsPurchaseWidgetSettings, "token">;
    };

const DEFAULT_SETTINGS: ObsPurchaseWidgetSettings = {
  token: "",
  streamerId: DEFAULT_STREAMER_ID,
  soundEnabled: true,
  soundUrl: null,
  defaultSound: "soft",
  volume: 0.7,
  position: "bottom",
  durationMs: 6500,
  showBuyerMessage: true,
  style: "auto",
  accentColor: "#00d38a",
  fontFamily: "Inter, system-ui, sans-serif",
};

const positions: ObsWidgetPosition[] = [
  "bottom",
  "center",
  "top",
  "bottom-left",
  "bottom-right",
];
const styles: ObsWidgetStyle[] = ["auto", "twitch", "kick", "neon", "minimal"];
const sounds: ObsWidgetDefaultSound[] = ["soft", "spark", "bell"];

const widgetSockets = new Map<string, Set<WebSocket>>();

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

function normalizeFont(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_SETTINGS.fontFamily;
  const v = raw.trim().slice(0, 120);
  if (!v) return DEFAULT_SETTINGS.fontFamily;
  return v.replace(/[<>{}]/g, "");
}

export function normalizeBuyerMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 150) : null;
}

function normalizeSettings(raw: unknown): ObsPurchaseWidgetSettings {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const position = positions.includes(o.position as ObsWidgetPosition)
    ? (o.position as ObsWidgetPosition)
    : DEFAULT_SETTINGS.position;
  const style = styles.includes(o.style as ObsWidgetStyle)
    ? (o.style as ObsWidgetStyle)
    : DEFAULT_SETTINGS.style;
  const defaultSound = sounds.includes(o.defaultSound as ObsWidgetDefaultSound)
    ? (o.defaultSound as ObsWidgetDefaultSound)
    : DEFAULT_SETTINGS.defaultSound;

  return {
    ...DEFAULT_SETTINGS,
    token:
      typeof o.token === "string" && o.token.trim().length >= 20
        ? o.token.trim()
        : "",
    streamerId:
      typeof o.streamerId === "string" && o.streamerId.trim()
        ? o.streamerId.trim().slice(0, 64)
        : DEFAULT_STREAMER_ID,
    soundEnabled: typeof o.soundEnabled === "boolean" ? o.soundEnabled : true,
    soundUrl:
      typeof o.soundUrl === "string" && /^https?:\/\//i.test(o.soundUrl.trim())
        ? o.soundUrl.trim().slice(0, 2000)
        : null,
    defaultSound,
    volume: clampNumber(o.volume, 0, 1, DEFAULT_SETTINGS.volume),
    position,
    durationMs: Math.round(clampNumber(o.durationMs, 5000, 8000, DEFAULT_SETTINGS.durationMs)),
    showBuyerMessage:
      typeof o.showBuyerMessage === "boolean" ? o.showBuyerMessage : true,
    style,
    accentColor: normalizeHexColor(o.accentColor, DEFAULT_SETTINGS.accentColor),
    fontFamily: normalizeFont(o.fontFamily),
  };
}

export function publicWidgetSettings(
  settings: ObsPurchaseWidgetSettings
): Omit<ObsPurchaseWidgetSettings, "token"> {
  const { token: _token, ...rest } = settings;
  return rest;
}

export async function getObsPurchaseWidgetSettings(): Promise<ObsPurchaseWidgetSettings> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SETTINGS_KEY))
    .limit(1);
  const current = normalizeSettings(row?.value);
  if (current.token) return current;

  const next = { ...current, token: nanoid(40) };
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value: next, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: next, updatedAt: sql`now()` },
    });
  return next;
}

export async function updateObsPurchaseWidgetSettings(
  patch: Partial<Omit<ObsPurchaseWidgetSettings, "token" | "streamerId">>
): Promise<ObsPurchaseWidgetSettings> {
  const current = await getObsPurchaseWidgetSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value: next, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: next, updatedAt: sql`now()` },
    });
  sendToObsWidget(next.streamerId, {
    type: "widget_settings",
    v: 1,
    data: publicWidgetSettings(next),
  });
  return next;
}

export async function regenerateObsPurchaseWidgetToken(): Promise<ObsPurchaseWidgetSettings> {
  const current = await getObsPurchaseWidgetSettings();
  const next = { ...current, token: nanoid(40) };
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value: next, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: next, updatedAt: sql`now()` },
    });
  return next;
}

export function sendToObsWidget(streamerId: string, event: ObsWidgetWireEvent): void {
  const set = widgetSockets.get(streamerId);
  if (!set?.size) return;
  const msg = JSON.stringify(event);
  for (const socket of set) {
    if (socket.readyState === 1) {
      try {
        socket.send(msg);
      } catch {
        /* ignore */
      }
    }
  }
}

function trackSocket(streamerId: string, socket: WebSocket): void {
  let set = widgetSockets.get(streamerId);
  if (!set) {
    set = new Set();
    widgetSockets.set(streamerId, set);
  }
  set.add(socket);
  const cleanup = () => {
    set!.delete(socket);
    if (set!.size === 0) widgetSockets.delete(streamerId);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

function extractQueryParam(pathAndQuery: string, name: string): string | null {
  try {
    const u = new URL(pathAndQuery, "http://localhost");
    const v = u.searchParams.get(name);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

export async function handleObsWidgetWsConnection(
  socket: WebSocket,
  pathAndQuery: string
): Promise<void> {
  socket.on("message", () => {
    /* OBS widget is receive-only */
  });

  const token = extractQueryParam(pathAndQuery, "token");
  if (!token) {
    socket.close(4001, "missing token");
    return;
  }

  const settings = await getObsPurchaseWidgetSettings();
  if (token !== settings.token) {
    socket.close(4003, "invalid token");
    return;
  }

  trackSocket(settings.streamerId, socket);
  if (socket.readyState === 1) {
    socket.send(
      JSON.stringify({
        type: "widget_settings",
        v: 1,
        data: publicWidgetSettings(settings),
      } satisfies ObsWidgetWireEvent)
    );
  }
}

export async function uploadObsWidgetSound(input: {
  buffer: Buffer;
  mime: string;
  ext: string;
}): Promise<
  | { ok: true; url: string }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!mediaStorageConfigured()) {
    return {
      ok: false,
      status: 503,
      code: "media_unconfigured",
      message:
        "Загрузка звуков не настроена (S3 / MEDIA_PUBLIC_BASE_URL / ключи AWS).",
    };
  }

  const key = `obs-widget/sounds/${nanoid(20)}.${input.ext}`;
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: mediaBucket(),
      Key: key,
      Body: input.buffer,
      ContentType: input.mime,
      CacheControl: MEDIA_CACHE_CONTROL,
    })
  );
  return { ok: true, url: `${mediaPublicBaseUrl()}/${key}` };
}
