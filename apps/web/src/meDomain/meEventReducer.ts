import type { MeEconomyResponse, MeProfileResponse, MeResponse } from "shared";
import { queryClient } from "../query/queryClient";
import { queryKeys } from "../query/queryKeys";
import { appEventBus } from "../events/appEventBus";
import type { MeUpdateEvent } from "../events/appEvents";
import {
  bumpDomainVersion,
  getDomainVersion,
  resetDomainVersion,
} from "./domainVersion";
import {
  isMeEconomyPatch,
  pickPartialEconomyFields,
} from "../utils/mergeEconomyPatch";
import { splitMePartial } from "../utils/splitMePartial";

function setProfile(next: MeProfileResponse): void {
  queryClient.setQueryData<MeProfileResponse>(queryKeys.me.profile(), next);
}

function setEconomy(next: MeEconomyResponse): void {
  queryClient.setQueryData<MeEconomyResponse>(queryKeys.me.economy(), next);
}

function mergeEconomyIntoCache(partial: Partial<MeResponse>): void {
  queryClient.setQueryData<MeEconomyResponse>(queryKeys.me.economy(), (prev) => {
    if (!prev) return prev;
    const next = { ...prev };
    for (const k of [
      "coins",
      "coinsTwitch",
      "coinsKick",
      "lifetimeEarned",
      "lifetimeTwitch",
      "lifetimeKick",
      "level",
      "rewardMultiplier",
    ] as const) {
      const v = partial[k];
      if (typeof v === "number") next[k] = v;
    }
    return next;
  });
}

function applyWsRaw(data: unknown): void {
  if (isMeEconomyPatch(data)) {
    bumpDomainVersion("economy");
    queryClient.setQueryData<MeEconomyResponse>(queryKeys.me.economy(), (prev) =>
      prev ? { ...prev, ...data } : prev
    );
    return;
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const partial = pickPartialEconomyFields(data);
    if (partial) {
      bumpDomainVersion("economy");
      mergeEconomyIntoCache(partial);
      if (!isMeEconomyPatch(partial)) {
        appEventBus.emit("me:reconcile:economy", { delayMs: 200 });
      }
      return;
    }
  }
  appEventBus.emit("me:reconcile:economy", { delayMs: 0 });
}

/**
 * Единственная точка записи кэша `me/*` (кроме removeQueries при clear).
 */
export function reduceMeUpdate(event: MeUpdateEvent): void {
  switch (event.kind) {
    case "clear": {
      queryClient.removeQueries({ queryKey: queryKeys.me.all });
      resetDomainVersion();
      return;
    }

    case "bump_economy_only": {
      bumpDomainVersion("economy");
      return;
    }

    case "ws_raw": {
      applyWsRaw(event.data);
      return;
    }

    case "economy_patch": {
      bumpDomainVersion("economy");
      const patch = event.patch;
      if (isMeEconomyPatch(patch)) {
        queryClient.setQueryData<MeEconomyResponse>(queryKeys.me.economy(), (prev) =>
          prev ? { ...prev, ...patch } : prev
        );
      } else if (patch && typeof patch === "object") {
        mergeEconomyIntoCache(patch as Partial<MeResponse>);
      }
      if (event.source === "mutation") {
        appEventBus.emit("me:reconcile:economy", { delayMs: 450 });
      }
      return;
    }

    case "merged_partial": {
      const { profile: pp, economy: ep } = splitMePartial(event.partial);
      if (Object.keys(pp).length > 0) {
        bumpDomainVersion("profile");
        queryClient.setQueryData<MeProfileResponse>(queryKeys.me.profile(), (old) =>
          old ? { ...old, ...pp } : old
        );
      }
      if (Object.keys(ep).length > 0) {
        bumpDomainVersion("economy");
        queryClient.setQueryData<MeEconomyResponse>(queryKeys.me.economy(), (old) =>
          old ? { ...old, ...ep } : old
        );
      }
      if (event.source === "optimistic") {
        appEventBus.emit("me:reconcile:economy", { delayMs: 450 });
      }
      return;
    }

    case "http_snapshot": {
      const { profileV0, economyV0 } = event;
      if (event.profile !== undefined) {
        if (getDomainVersion().profile === profileV0) {
          bumpDomainVersion("profile");
          setProfile(event.profile);
        }
      }
      if (event.economy !== undefined) {
        if (getDomainVersion().economy === economyV0) {
          bumpDomainVersion("economy");
          setEconomy(event.economy);
        }
      }
      return;
    }

    default:
      return;
  }
}

export function registerMeEventReducer(): void {
  appEventBus.subscribe("me:update", reduceMeUpdate);
}
