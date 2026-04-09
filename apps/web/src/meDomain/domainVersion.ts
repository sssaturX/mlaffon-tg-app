/**
 * Монотонные версии домена `me`. Меняются ТОЛЬКО из `meEventReducer`
 * (кроме полного сброса при clear).
 */
let me = 0;
let profile = 0;
let economy = 0;

export function getDomainVersion(): { me: number; profile: number; economy: number } {
  return { me, profile, economy };
}

export function resetDomainVersion(): void {
  me = 0;
  profile = 0;
  economy = 0;
}

/** @internal — вызывать только из reducer. */
export function bumpDomainVersion(
  which: "me" | "profile" | "economy" | "profile+economy"
): void {
  if (which === "profile+economy") {
    profile++;
    economy++;
    me++;
    return;
  }
  if (which === "me") {
    me++;
    return;
  }
  if (which === "profile") {
    profile++;
    me++;
    return;
  }
  economy++;
  me++;
}
