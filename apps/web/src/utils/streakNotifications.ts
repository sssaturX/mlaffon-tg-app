import { TelegramWebApp as WebApp } from "../lib/telegramAdapter";
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
  streak: number,
  bonusCoinsAwarded?: number
) {
  const bonus =
    bonusCoinsAwarded != null && bonusCoinsAwarded > 0
      ? ` Бонус: +${bonusCoinsAwarded} монет на баланс ${platRu} за 7 стримов подряд.`
      : "";
  showToast(
    `Вам засчитан стрик: ${streak} подряд на ${platRu}.${bonus}`,
    "success",
    STREAK_TOAST
  );
  hapticSuccess();
}

/** Повторное нажатие в том же эфире */
export function notifyStreakAlreadyWatchedThisBroadcast(
  showToast: ShowToast,
  platRu: string,
  currentStreak: number
) {
  showToast(
    `Стрик по этой трансляции уже был засчитан. На ${platRu} у вас сейчас: ${currentStreak} подряд.`,
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
