/**
 * Тексты только для экрана пользователя: без кодов ошибок, URL и терминов для разработчиков.
 */

const API_ERROR_BY_CODE: Record<string, string> = {
  bad_request: "Проверьте введённые данные и попробуйте снова.",
  unauthorized: "Войдите снова.",
  session_invalid: "Сессия устарела. Войдите снова.",
  invalid_init_data: "Не удалось подтвердить вход из Telegram. Закройте приложение и откройте его снова из бота.",
  no_user: "Не удалось получить профиль Telegram. Откройте приложение из бота.",
  server_misconfigured: "Сервис временно недоступен. Попробуйте позже.",
  internal_error: "Что-то пошло не так. Попробуйте позже.",
  rate_limited: "Слишком много действий подряд. Подождите немного.",
  not_found: "Не найдено.",
  task_not_found: "Задание не найдено.",
  already_completed: "Уже выполнено.",
  platform_required: "Подключите Twitch или Kick в профиле.",
  progress_not_reached: "Сначала выполните условие задания.",
  not_live: "Сейчас нет активного стрима.",
  platform_mismatch: "Это задание для другой платформы стрима.",
  watch_required: "Сначала зайдите на стрим.",
  too_frequent: "Не чаще одного зачтённого сообщения в минуту.",
  message_too_short: "Сообщение слишком короткое.",
  queue_unavailable: "Проверка задания временно недоступна. Попробуйте позже.",
  not_following: "Подписка на канал не найдена. Подпишитесь и попробуйте снова.",
  not_subscribed: "Платная подписка на канал не найдена.",
  no_oauth: "Подключите Twitch или Kick в профиле.",
  helix_user:
    "Не удалось проверить Twitch. Обновите привязку в профиле и попробуйте снова.",
  no_broadcaster: "Задание настроено неверно. Напишите в поддержку.",
  kick_user:
    "Не удалось проверить Kick. Обновите привязку в профиле и попробуйте снова.",
  no_channel: "Задание настроено неверно. Напишите в поддержку.",
  unknown_platform: "Тип задания не поддерживается.",
  telegram_chat_not_configured: "Задание настроено неверно. Напишите в поддержку.",
  telegram_not_linked: "Привяжите Telegram в профиле.",
  telegram_not_subscribed: "Нужна подписка на канал из задания.",
  grant_failed: "Не удалось начислить награду. Попробуйте позже.",
  verify_failed: "Проверка не прошла. Попробуйте позже.",
  free_spin_used: "Бесплатное вращение на сегодня уже использовано.",
  insufficient_coins: "Недостаточно монет на этом счёте.",
  duplicate_spin: "Это действие уже выполнялось.",
  item_not_found: "Товар недоступен.",
  duplicate: "Операция уже выполнялась.",
  email_taken: "Этот email уже зарегистрирован.",
  invalid_credentials: "Неверный email или пароль.",
  weak_password: "Пароль слишком простой — выберите более сложный.",
  already_has_credentials: "Для этого аккаунта вход на сайте уже настроен.",
  invalid_or_expired_link: "Ссылка недействительна или устарела. Создайте новую в профиле на сайте.",
  account_already_linked: "К этому профилю уже привязан другой Telegram.",
  merge_failed: "Не удалось объединить аккаунты. Попробуйте позже или напишите в поддержку.",
  exhausted: "Акция закончилась.",
  already_used: "Уже использовано.",
  empty_code: "Введите промокод.",
  credit_failed: "Не удалось начислить награду. Попробуйте позже.",
  bad_platform: "Выберите Twitch или Kick.",
  not_active: "Эфир уже завершён.",
  duplicate_debit: "Повторное списание",
  inactive: "Розыгрыш неактивен",
  ended: "Розыгрыш уже завершён",
  already_drawn: "Победители уже выбраны",
  already_joined: "Вы уже участвуете",
  channel_not_subscribed:
    "Нужна подписка на канал из карточки розыгрыша — подпишитесь и снова нажмите «Участвовать»",
  channel_not_configured:
    "Проверка подписки для розыгрыша не настроена на сервере. Напишите администратору.",
  platform_not_allowed:
    "Этот розыгрыш для другой платформы — переключите платформу в шапке",
};

function looksTechnicalMessage(msg: string): boolean {
  const m = msg.trim();
  if (m.length < 2) return true;
  if (/^https?:\/\//i.test(m)) return true;
  if (/localhost|127\.0\.0\.1|:\d{4}\//.test(m)) return true;
  if (/redirect_uri|oauth|callback|Bearer |bad_request|internal server/i.test(m))
    return true;
  if (/^Expected |^Invalid |^Required |received /i.test(m)) return true;
  if (/^[a-z][a-z0-9_]*$/i.test(m) && m.length < 48 && m.includes("_")) return true;
  return false;
}

type ApiErrShape = {
  error?: { code?: string; message?: string };
  message?: string;
};

/**
 * Сообщение для тоста/экрана из ответа API.
 */
export function formatApiErrorForUser(r: {
  status: number;
  err: unknown;
  networkError?: boolean;
}): string {
  if (r.networkError) {
    return "Нет соединения с интернетом. Проверьте сеть и попробуйте снова.";
  }
  const e = r.err as ApiErrShape | null;
  const code = e?.error?.code;
  if (code && API_ERROR_BY_CODE[code]) {
    return API_ERROR_BY_CODE[code];
  }
  const rawMsg =
    e?.error?.message ??
    (typeof e?.message === "string" && e.message.trim() !== ""
      ? e.message
      : undefined);
  const serverMsg =
    rawMsg && !/^internal server error$/i.test(rawMsg) ? rawMsg : undefined;

  if (r.status === 429) {
    return serverMsg && !looksTechnicalMessage(serverMsg)
      ? serverMsg
      : "Слишком много запросов. Подождите минуту.";
  }
  if (r.status === 403 && e?.error?.code === "banned") {
    return e.error.message ?? "Доступ к приложению ограничен.";
  }
  if (serverMsg && r.status >= 400 && !looksTechnicalMessage(serverMsg)) {
    return serverMsg;
  }
  if (r.status >= 500) {
    return "Сервис временно недоступен. Попробуйте позже.";
  }
  return "Что-то пошло не так. Попробуйте ещё раз.";
}

/**
 * Ошибка из query после OAuth — не показываем сырой текст от Twitch/Kick.
 */
export function formatOAuthRedirectError(raw: string | null | undefined): string {
  if (!raw?.trim()) {
    return "Не удалось подключить аккаунт. Попробуйте снова из профиля.";
  }
  const t = raw.trim();
  if (t.length > 220) {
    return "Не удалось подключить аккаунт. Попробуйте снова из профиля в приложении.";
  }
  if (looksTechnicalMessage(t)) {
    return "Не удалось подключить аккаунт. Попробуйте снова из профиля в приложении.";
  }
  return t;
}
