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
  speechEnabled: boolean;
  speechEngine: "browser" | "speakerpy";
  speechVoice: "auto" | "ru-female" | "ru-male" | "any";
  speakerpyVoice: "aidar" | "baya" | "kseniya" | "xenia" | "eugene" | "random";
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
const SPEECH_START_DELAY_MS = 650;
const SPEECH_VOICE_WAIT_MS = 8_000;
const SPEECH_RESUME_INTERVAL_MS = 250;

const DEFAULT_SETTINGS: WidgetSettings = {
  streamerId: "default",
  soundEnabled: true,
  soundUrl: null,
  defaultSound: "soft",
  volume: 0.7,
  position: "bottom",
  durationMs: OBS_ALERT_DURATION_MS,
  showBuyerMessage: true,
  speechEnabled: true,
  speechEngine: "browser",
  speechVoice: "auto",
  speakerpyVoice: "baya",
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

function apiUrl(pathname: string): string {
  const env = (import.meta.env.VITE_API_ORIGIN ?? "").trim().replace(/\/$/, "");
  const base = env ? new URL(env) : new URL(window.location.origin);
  base.pathname = pathname;
  base.search = "";
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

const FEMALE_VOICE_HINTS = [
  "alena",
  "alenka",
  "anna",
  "daria",
  "elena",
  "irina",
  "milena",
  "oksana",
  "svetlana",
  "tatiana",
  "tatyana",
  "victoria",
  "yulia",
  "алена",
  "анна",
  "дарья",
  "елена",
  "ирина",
  "милена",
  "оксана",
  "светлана",
  "татьяна",
  "юлия",
];

const MALE_VOICE_HINTS = [
  "alexander",
  "aleksey",
  "dmitry",
  "maxim",
  "nikolay",
  "pavel",
  "sergey",
  "yuri",
  "александр",
  "алексей",
  "дмитрий",
  "максим",
  "николай",
  "павел",
  "сергей",
  "юрий",
];

function isRussianVoice(voice: SpeechSynthesisVoice): boolean {
  const lang = voice.lang.trim().replace(/_/g, "-").toLowerCase();
  const name = voice.name.toLowerCase();
  const uri = voice.voiceURI.toLowerCase();
  return (
    lang === "ru-ru" ||
    lang === "ru" ||
    lang.startsWith("ru-") ||
    name.includes("russian") ||
    name.includes("рус") ||
    uri.includes("russian") ||
    uri.includes("рус")
  );
}

function isRussianSpeechPreference(preference: WidgetSettings["speechVoice"]): boolean {
  return preference !== "any";
}

function hasRussianSpeechVoice(synth: SpeechSynthesis): boolean {
  return synth.getVoices().some(isRussianVoice);
}

function normalizeRussianVoiceLang(voice: SpeechSynthesisVoice): string {
  const lang = voice.lang.trim().replace(/_/g, "-");
  const normalized = lang.toLowerCase();
  return normalized === "ru" || normalized.startsWith("ru-") ? lang : "ru-RU";
}

function voiceMatchesHint(voice: SpeechSynthesisVoice, hints: string[]): boolean {
  const haystack = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  return hints.some((hint) => haystack.includes(hint));
}

function selectSpeechVoice(
  preference: WidgetSettings["speechVoice"]
): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const russianVoices = voices.filter(isRussianVoice);

  if (preference === "ru-female") {
    return (
      russianVoices.find((voice) => voiceMatchesHint(voice, FEMALE_VOICE_HINTS)) ??
      russianVoices[0] ??
      null
    );
  }

  if (preference === "ru-male") {
    return (
      russianVoices.find((voice) => voiceMatchesHint(voice, MALE_VOICE_HINTS)) ??
      russianVoices[0] ??
      null
    );
  }

  if (preference === "any") {
    return russianVoices[0] ?? voices[0] ?? null;
  }

  return (
    russianVoices.find((voice) => voice.lang.toLowerCase() === "ru-ru") ??
    russianVoices[0] ??
    null
  );
}

function waitForSpeechVoices(
  synth: SpeechSynthesis,
  preference: WidgetSettings["speechVoice"],
  onReady: () => void
): () => void {
  let done = false;
  let timeout: number | null = null;

  const finish = () => {
    if (done) return;
    done = true;
    if (timeout != null) window.clearTimeout(timeout);
    synth.removeEventListener?.("voiceschanged", onVoicesChanged);
    onReady();
  };

  const hasUsableVoices = () => {
    const voices = synth.getVoices();
    if (voices.length === 0) return false;
    return !isRussianSpeechPreference(preference) || hasRussianSpeechVoice(synth);
  };

  const onVoicesChanged = () => {
    if (hasUsableVoices()) finish();
  };

  if (hasUsableVoices()) {
    finish();
    return () => undefined;
  }

  synth.addEventListener?.("voiceschanged", onVoicesChanged);
  timeout = window.setTimeout(finish, SPEECH_VOICE_WAIT_MS);

  return () => {
    done = true;
    if (timeout != null) window.clearTimeout(timeout);
    synth.removeEventListener?.("voiceschanged", onVoicesChanged);
  };
}

function buildSpeechText(alert: PurchaseAlert): string {
  const parts = [
    `${displayBuyer(alert)} купил товар ${alert.productName} за ${alert.price.toLocaleString(
      "ru-RU"
    )} ${alert.currency}.`,
  ];
  const message = alert.buyerMessage?.trim();
  if (message) parts.push(`Сообщение покупателя: ${message}`);
  return parts.join(" ");
}

function scheduleBrowserSpeech(
  settings: WidgetSettings,
  text: string
): (() => void) | null {
  if (!settings.speechEnabled || !text || !("speechSynthesis" in window)) return null;

  const synth = window.speechSynthesis;
  let cancelled = false;
  let cleanupVoiceWait: (() => void) | null = null;
  let resumeTimer: number | null = null;
  let speakTimer: number | null = null;

  const stopResumeTimer = () => {
    if (resumeTimer == null) return;
    window.clearInterval(resumeTimer);
    resumeTimer = null;
  };

  const speak = () => {
    if (cancelled) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ru-RU";
      utterance.volume = Math.max(0, Math.min(1, settings.volume));
      utterance.rate = 1;
      utterance.pitch = 1;
      const voice = selectSpeechVoice(settings.speechVoice);
      if (isRussianSpeechPreference(settings.speechVoice) && !voice) {
        console.warn(
          "[OBS widget] Russian speech voice is unavailable. Install/enable a Russian voice in the OBS browser environment to avoid English fallback."
        );
        stopResumeTimer();
        return;
      }
      if (voice) {
        utterance.voice = voice;
        utterance.lang = isRussianSpeechPreference(settings.speechVoice)
          ? normalizeRussianVoiceLang(voice)
          : voice.lang || "ru-RU";
      }
      utterance.onend = stopResumeTimer;
      utterance.onerror = stopResumeTimer;
      synth.cancel();
      speakTimer = window.setTimeout(() => {
        speakTimer = null;
        if (cancelled) return;
        synth.speak(utterance);
        if (synth.paused) synth.resume();
        resumeTimer = window.setInterval(() => {
          if (cancelled || (!synth.speaking && !synth.pending)) {
            stopResumeTimer();
            return;
          }
          if (synth.paused) synth.resume();
        }, SPEECH_RESUME_INTERVAL_MS);
      }, 0);
    } catch {
      /* ignore */
    }
  };

  const startTimer = window.setTimeout(() => {
    cleanupVoiceWait = waitForSpeechVoices(synth, settings.speechVoice, speak);
  }, SPEECH_START_DELAY_MS);

  return () => {
    cancelled = true;
    window.clearTimeout(startTimer);
    if (speakTimer != null) window.clearTimeout(speakTimer);
    cleanupVoiceWait?.();
    stopResumeTimer();
  };
}

function scheduleSpeakerpySpeech(
  token: string,
  settings: WidgetSettings,
  text: string
): (() => void) | null {
  if (!settings.speechEnabled || !text) return null;

  let cancelled = false;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let cleanupFallback: (() => void) | null = null;
  const controller = new AbortController();

  const cleanupAudioUrl = () => {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const play = async () => {
    try {
      const response = await fetch(apiUrl("/api/v1/obs/widget/tts"), {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          text,
          voice: settings.speakerpyVoice,
          speed: 1,
        }),
      });
      if (!response.ok) throw new Error(`speakerpy_tts_${response.status}`);
      const blob = await response.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      audio = new Audio(objectUrl);
      audio.volume = Math.max(0, Math.min(1, settings.volume));
      audio.onended = cleanupAudioUrl;
      audio.onerror = cleanupAudioUrl;
      await audio.play();
    } catch {
      if (!cancelled) cleanupFallback = scheduleBrowserSpeech(settings, text);
    }
  };

  const startTimer = window.setTimeout(() => {
    void play();
  }, SPEECH_START_DELAY_MS);

  return () => {
    cancelled = true;
    controller.abort();
    window.clearTimeout(startTimer);
    cleanupFallback?.();
    if (audio) {
      audio.pause();
      audio.src = "";
      audio = null;
    }
    cleanupAudioUrl();
  };
}

function scheduleBuyerMessageSpeech(
  token: string,
  settings: WidgetSettings,
  alert: PurchaseAlert
): (() => void) | null {
  const text = buildSpeechText(alert).trim();
  if (!settings.speechEnabled || !text) return null;
  if (settings.speechEngine === "speakerpy") {
    return scheduleSpeakerpySpeech(token, settings, text);
  }
  return scheduleBrowserSpeech(settings, text);
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
    const activeSettings = settingsRef.current;
    playAlertSound(activeSettings);
    const cleanupSpeech = scheduleBuyerMessageSpeech(token, activeSettings, current);

    const clearTimer = window.setTimeout(() => {
      setCurrent(null);
    }, OBS_ALERT_DURATION_MS);
    return () => {
      window.clearTimeout(clearTimer);
      cleanupSpeech?.();
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
