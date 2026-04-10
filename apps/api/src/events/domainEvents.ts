/**
 * Справочник realtime-событий (документация + реэкспорт для агентов/IDE).
 * Payload по-прежнему задаётся в `services/realtimePublish.ts`.
 * На wire к каждому broadcast после outbox добавляется монотонный `seq` (Redis INCR).
 */

import type { BroadcastWsEvent } from "../services/realtimePublish.js";

export { type BroadcastWsEvent, type DropClaimedEvent } from "../services/realtimePublish.js";

export const WS_EVENT_VERSION = 1 as const;

/** Известные типы broadcast (дублируйте при добавлении в publishBroadcastEvent). */
export const BROADCAST_EVENT_TYPES = [
  "drop_started",
  "drop_finished",
  "live_started",
  "live_ended",
  "prediction_state",
  "giveaways_updated",
] as const;

export type MeUpdateEvent = {
  type: "me_update";
  v: typeof WS_EVENT_VERSION;
  data: unknown;
};

/** Сообщение клиенту после flush outbox (поле `seq` добавляет worker). */
export type BroadcastWsWireMessage = BroadcastWsEvent & { seq: number };

/**
 * Строгий доменный union (имена из промпта ↔ wire `type` в snake_case).
 * Использовать для документации, валидации и AI-агентов.
 */
export type DomainBroadcastEvent =
  | {
      domainType: "STREAM_STARTED";
      wire: "live_started";
      data: Extract<BroadcastWsEvent, { type: "live_started" }>["data"];
    }
  | { domainType: "STREAM_ENDED"; wire: "live_ended"; data: null }
  | {
      domainType: "DROP_STARTED";
      wire: "drop_started";
      data: Extract<BroadcastWsEvent, { type: "drop_started" }>["data"];
    }
  | {
      domainType: "DROP_ENDED";
      wire: "drop_finished";
      data: Extract<BroadcastWsEvent, { type: "drop_finished" }>["data"];
    }
  | {
      domainType: "PREDICTION_STATE";
      wire: "prediction_state";
      data: Extract<BroadcastWsEvent, { type: "prediction_state" }>["data"];
    };
