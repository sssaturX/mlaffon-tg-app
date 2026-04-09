import type { MeEconomyPatch, MeEconomyResponse, MeProfileResponse, MeResponse } from "shared";

export type MeUpdateSource = "ws" | "http" | "mutation" | "optimistic";

/** Единственный тип события для мутации кэша `me/*` (кроме logout). */
export type MeUpdateEvent =
  | {
      kind: "ws_raw";
      source: "ws";
      data: unknown;
    }
  | {
      kind: "economy_patch";
      source: MeUpdateSource;
      patch: MeEconomyPatch | Record<string, unknown>;
    }
  | {
      kind: "merged_partial";
      source: MeUpdateSource;
      partial: Partial<MeResponse>;
    }
  | {
      kind: "http_snapshot";
      source: "http";
      profile?: MeProfileResponse;
      economy?: MeEconomyResponse;
      /** Версии на момент старта HTTP-запроса (для отбраковки устаревших ответов). */
      profileV0: number;
      economyV0: number;
    }
  | {
      kind: "bump_economy_only";
      source: "ws";
    }
  | {
      kind: "clear";
      reason: "logout" | "auth_error";
    };

export type AppEventMap = {
  "me:update": MeUpdateEvent;
  /** Полная гидратация me по HTTP (bootstrap, retry, OAuth); только эмитит `me:update`. */
  "app:me:hydrate": {
    showToast?: (
      message: string,
      variant?: "info" | "success" | "error",
      third?: number | { durationMs?: number; streak?: boolean }
    ) => void;
  };
  /** Отложенная подтяжка экономики (замена invalidate me.economy). */
  "me:reconcile:economy": { delayMs?: number };
  /** Старт приложения: не трогает кэш напрямую — слушатели эмитят hydrate/prefetch. */
  "app:bootstrap": { phase: "token_ready" | "shell_ready" };
};
