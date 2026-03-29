/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOW_DEV?: string;
  readonly VITE_ALLOW_DEV_STUB?: string;
  /** URL политики конфиденциальности (онбординг) */
  readonly VITE_PRIVACY_POLICY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
