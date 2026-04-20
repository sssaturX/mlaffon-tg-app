import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
  getLocalPushSubscriptionState,
  subscribeToLivePush,
  supportsWebPushUi,
  unsubscribeFromLivePush,
} from "../lib/webPushClient";
import { looksLikeTelegramMiniApp } from "../utils/waitForTelegramInitData";
import { useToast } from "../context/ToastContext";

export function PushNotificationsRow() {
  const { showToast } = useToast();
  const [state, setState] = useState<
    "loading" | "none" | "subscribed" | "hidden" | "unsupported"
  >("loading");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (looksLikeTelegramMiniApp()) {
      setState("hidden");
      return;
    }
    if (!supportsWebPushUi()) {
      setState("unsupported");
      return;
    }
    try {
      const s = await getLocalPushSubscriptionState();
      setState(s);
    } catch {
      setState("none");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === "hidden") {
    return (
      <p className="muted m-0 text-body">
        Push о старте эфира в мини-приложении Telegram недоступен. Откройте сайт
        в Chrome или Safari (на iOS — добавьте на экран «Домой» для PWA).
      </p>
    );
  }

  if (state === "unsupported") {
    return (
      <p className="muted m-0 text-body">
        Этот браузер не поддерживает web push (нужны актуальный Chrome / Safari
        и HTTPS или localhost).
      </p>
    );
  }

  if (state === "loading") {
    return <p className="muted m-0">…</p>;
  }

  async function onEnable() {
    setBusy(true);
    try {
      const r = await subscribeToLivePush();
      if (r.ok) {
        showToast("Уведомления включены", "success");
        setState("subscribed");
      } else {
        showToast(r.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    try {
      await unsubscribeFromLivePush();
      showToast("Уведомления отключены", "info");
      setState("none");
    } catch {
      showToast("Не удалось отключить", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-row">
      <div className="profile-row__left">
        <div className="profile-row__icon">
          <Bell size={20} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <div className="label-strong">Старт эфира</div>
          <div className="muted text-caption">
            {state === "subscribed"
              ? "Вы получите push, когда админ запустит стрим."
              : "Получить push, когда начнётся эфир."}
          </div>
        </div>
      </div>
      {state === "subscribed" ? (
        <button type="button" disabled={busy} onClick={() => void onDisable()}>
          {busy ? "…" : "Отключить"}
        </button>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void onEnable()}
        >
          {busy ? "…" : "Включить"}
        </button>
      )}
    </div>
  );
}
