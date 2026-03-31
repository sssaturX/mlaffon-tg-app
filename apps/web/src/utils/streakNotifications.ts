import WebApp from "@twa-dev/sdk";
import type { ToastExtraOptions, ToastVariant } from "../context/ToastContext";

const STREAK_TOAST: ToastExtraOptions = {
  durationMs: 7000,
  streak: true,
};

type ShowToast = (
  message: string,
  variant?: ToastVariant,
  third?: number | ToastExtraOptions
) => void;

function hapticSuccess() {
  try {
    WebApp.HapticFeedback.notificationOccurred("success");
  } catch {
    /* ignore */
  }
}

function hapticWarning() {
  try {
    WebApp.HapticFeedback.notificationOccurred("warning");
  } catch {
    /* ignore */
  }
}

function hapticError() {
  try {
    WebApp.HapticFeedback.notificationOccurred("error");
  } catch {
    /* ignore */
  }
}

/** После успешного «Смотреть стрим» */
export function notifyStreakWatchSuccess(
  showToast: ShowToast,
  platRu: string,
  streak: number
) {
  const bonus =
    streak > 0 && streak % 7 === 0
      ? " Бонус за каждые 7 шагов начислен на баланс (если включён в конфиге)."
      : "";
  showToast(
    `${platRu}: стрик ${streak} подряд!${bonus}`,
    "success",
    STREAK_TOAST
  );
  hapticSuccess();
}

/** Повторное нажатие в том же эфире */
export function notifyStreakAlreadyWatchedThisBroadcast(
  showToast: ShowToast,
  platRu: string
) {
  showToast(
    `Уже отмечали этот эфир (${platRu}). Повторно стрик не начисляется.`,
    "info",
    { durationMs: 6000 }
  );
  hapticWarning();
}

/** Ошибка запроса watch */
export function notifyStreakWatchError(showToast: ShowToast, message: string) {
  showToast(message, "error");
  hapticError();
}
