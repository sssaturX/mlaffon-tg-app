import type { MeResponse } from "shared";

/** Есть ли привязка Twitch или Kick (OAuth). */
export function hasLinkedStreamingAccount(me: MeResponse): boolean {
  return (
    me.platforms.twitch.status === "connected" ||
    me.platforms.kick.status === "connected"
  );
}
