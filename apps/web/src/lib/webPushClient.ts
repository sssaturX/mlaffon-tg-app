import { api, formatApiError } from "../api";

export function supportsWebPushUi(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const r = await api<{ publicKey: string | null }>(
    "/api/v1/push/vapid-public-key"
  );
  if (!r.ok) return null;
  return r.data.publicKey;
}

export async function getPushSubscriptionState(): Promise<
  "none" | "subscribed" | "server_off"
> {
  const pub = await getVapidPublicKey();
  if (!pub) return "server_off";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "subscribed" : "none";
}

export async function subscribeToLivePush(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const pub = await getVapidPublicKey();
  if (!pub) {
    return { ok: false, message: "На сервере не настроены push-уведомления." };
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    return {
      ok: false,
      message: "Нужно разрешение на уведомления.",
    };
  }
  const reg = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(pub) as BufferSource,
  });
  const body = sub.toJSON();
  const r = await api<{ ok?: boolean }>("/api/v1/push/subscribe", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    await sub.unsubscribe().catch(() => {});
    return {
      ok: false,
      message: formatApiError(r),
    };
  }
  return { ok: true };
}

export async function unsubscribeFromLivePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await api("/api/v1/push/subscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
  await sub.unsubscribe();
}
