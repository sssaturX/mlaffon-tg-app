import { useEffect, useMemo, useRef, useState } from "react";
import type { AnimationEvent, CSSProperties } from "react";
import { Package } from "lucide-react";

type StreamPlatform = "twitch" | "kick";

type WidgetSettings = {
  streamerId: string;
  soundEnabled: boolean;
  soundUrl: string | null;
  defaultSound: "soft" | "spark" | "bell";
  volume: number;
  position: "bottom" | "center" | "top" | "bottom-left" | "bottom-right";
  durationMs: number;
  showBuyerMessage: boolean;
  style: "auto" | "twitch" | "kick" | "neon" | "minimal";
  accentColor: string;
  fontFamily: string;
};

type PurchaseAlert = {
  buyerName: string;
  buyerUsername: string | null;
  productName: string;
  productImage: string | null;
  price: number;
  currency: string;
  buyerMessage: string | null;
  createdAt: string;
  streamerId: string;
  purchasePlatform: StreamPlatform;
  streamPlatform: StreamPlatform;
};

type WidgetEvent =
  | { type: "widget_settings"; v: 1; data: WidgetSettings }
  | { type: "purchase_alert"; v: 1; data: PurchaseAlert };

const OBS_ALERT_DURATION_MS = 10_000;

const DEFAULT_SETTINGS: WidgetSettings = {
  streamerId: "default",
  soundEnabled: true,
  soundUrl: null,
  defaultSound: "soft",
  volume: 0.7,
  position: "bottom",
  durationMs: OBS_ALERT_DURATION_MS,
  showBuyerMessage: true,
  style: "auto",
  accentColor: "#00d38a",
  fontFamily: "Inter, system-ui, sans-serif",
};

function obsWsUrl(token: string): string {
  const env = (import.meta.env.VITE_API_ORIGIN ?? "").trim().replace(/\/$/, "");
  const base = env ? new URL(env) : new URL(window.location.origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/api/v1/obs/widget/ws";
  base.search = `?token=${encodeURIComponent(token)}`;
  return base.toString();
}

function playBuiltinSound(kind: WidgetSettings["defaultSound"], volume: number): void {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  const ctx = new AudioContextCtor();
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, volume));
  gain.connect(ctx.destination);

  const pattern =
    kind === "bell"
      ? [880, 1320, 1760]
      : kind === "spark"
        ? [520, 780]
        : [440, 660];
  const now = ctx.currentTime;
  pattern.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const localGain = ctx.createGain();
    const start = now + index * 0.08;
    osc.type = kind === "bell" ? "sine" : "triangle";
    osc.frequency.value = freq;
    localGain.gain.setValueAtTime(0.001, start);
    localGain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
    localGain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
    osc.connect(localGain);
    localGain.connect(gain);
    osc.start(start);
    osc.stop(start + 0.28);
  });
  window.setTimeout(() => void ctx.close().catch(() => undefined), 800);
}

function playAlertSound(settings: WidgetSettings): void {
  if (!settings.soundEnabled) return;
  const volume = Math.max(0, Math.min(1, settings.volume));
  if (settings.soundUrl) {
    const audio = new Audio(settings.soundUrl);
    audio.volume = volume;
    void audio.play().catch(() => undefined);
    return;
  }
  try {
    playBuiltinSound(settings.defaultSound, volume);
  } catch {
    /* ignore */
  }
}

function displayBuyer(alert: PurchaseAlert): string {
  const username = alert.buyerUsername?.replace(/^@+/, "");
  return username ? `@${username}` : alert.buyerName;
}

export function AlertWidget() {
  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token")?.trim() ?? "";
  }, []);
  const [settings, setSettings] = useState<WidgetSettings>(DEFAULT_SETTINGS);
  const [queue, setQueue] = useState<PurchaseAlert[]>([]);
  const [current, setCurrent] = useState<PurchaseAlert | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!token) return undefined;
    let closed = false;
    let socket: WebSocket | null = null;

    const connect = () => {
      socket = new WebSocket(obsWsUrl(token));
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as WidgetEvent;
          if (event.type === "widget_settings") {
            setSettings({ ...DEFAULT_SETTINGS, ...event.data });
          } else if (event.type === "purchase_alert") {
            setQueue((prev) => [...prev, event.data]);
          }
        } catch {
          /* ignore malformed realtime messages */
        }
      };
      socket.onclose = () => {
        if (closed) return;
        reconnectTimer.current = window.setTimeout(connect, 1600);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer.current != null) {
        window.clearTimeout(reconnectTimer.current);
      }
      socket?.close();
    };
  }, [token]);

  useEffect(() => {
    if (current || queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next ?? null);
    return undefined;
  }, [current, queue]);

  useEffect(() => {
    if (!current) return undefined;
    playAlertSound(settingsRef.current);

    const clearTimer = window.setTimeout(() => {
      setCurrent(null);
    }, OBS_ALERT_DURATION_MS);
    return () => {
      window.clearTimeout(clearTimer);
    };
  }, [current]);

  const handleAlertAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (
      event.currentTarget === event.target &&
      event.animationName === "obs-alert-lifetime"
    ) {
      setCurrent(null);
    }
  };

  const effectiveStyle =
    settings.style === "auto" ? current?.streamPlatform ?? "twitch" : settings.style;
  const message =
    settings.showBuyerMessage && current?.buyerMessage ? current.buyerMessage : null;

  return (
    <div
      className={`obs-widget-page obs-widget-page--${settings.position}`}
      style={{
        "--obs-accent": settings.accentColor,
        "--obs-font": settings.fontFamily,
      } as CSSProperties}
    >
      {current ? (
        <div
          className={`obs-alert obs-alert--${effectiveStyle} obs-alert--show`}
          onAnimationEnd={handleAlertAnimationEnd}
        >
          <div className="obs-alert__shine" />
          <div className="obs-alert__media">
            {current.productImage ? (
              <img src={current.productImage} alt="" />
            ) : (
              <Package size={42} strokeWidth={1.6} />
            )}
          </div>
          <div className="obs-alert__body">
            <div className="obs-alert__headline">
              <strong>{displayBuyer(current)}</strong> купил товар{" "}
              <strong>{current.productName}</strong> за{" "}
              <strong>
                {current.price.toLocaleString("ru-RU")} {current.currency}
              </strong>
            </div>
            {message ? (
              <div className="obs-alert__message">
                <span>Сообщение:</span> {message}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AlertWidget;

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
