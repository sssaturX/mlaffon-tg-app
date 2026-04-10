/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "0" — отключить вход email/пароль в браузере (только Telegram / dev) */
  readonly VITE_ALLOW_WEB_AUTH?: string;
  readonly VITE_ALLOW_DEV?: string;
  readonly VITE_ALLOW_DEV_STUB?: string;
  /** URL политики конфиденциальности (онбординг) */
  readonly VITE_PRIVACY_POLICY_URL?: string;
  /** Экран приветствия / эфир: имя (по умолчанию MlaffonXD) */
  readonly VITE_CREATOR_DISPLAY_NAME?: string;
  /** URL аватара на экране приветствия (иначе /streamer-kick.jpg) */
  readonly VITE_CREATOR_AVATAR_URL?: string;
  /** Подпись ссылки на Kick, напр. Kick.com/Nickname */
  readonly VITE_CREATOR_KICK_LABEL?: string;
  /** Полный URL канала Kick (открывается по клику) */
  readonly VITE_CREATOR_KICK_PAGE_URL?: string;
  /** Текст приветствия после «Привет, {имя}!» */
  readonly VITE_CREATOR_GREETING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
