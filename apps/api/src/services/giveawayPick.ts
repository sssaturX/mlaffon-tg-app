import { randomInt } from "node:crypto";

function shuffleUserIds(ids: string[]): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function weightedPickUnique(
  weighted: { userId: string; weight: number }[],
  count: number
): string[] {
  const pool = weighted
    .map((x) => ({ ...x, weight: Math.max(0, x.weight) }))
    .filter((x) => x.weight > 0);
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    const total = pool.reduce((s, x) => s + x.weight, 0);
    if (total <= 0) break;
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx]!.weight;
      if (r <= 0) break;
    }
    const picked = pool[Math.min(idx, pool.length - 1)]!;
    out.push(picked.userId);
    const removeIdx = pool.findIndex((x) => x.userId === picked.userId);
    if (removeIdx >= 0) pool.splice(removeIdx, 1);
  }
  return out;
}

export function pickRandomFromParticipants(
  partUserIds: string[],
  pickCount: number
): string[] {
  const weighted = partUserIds.map((userId) => ({ userId, weight: 1 }));
  let picked = weightedPickUnique(weighted, pickCount);
  if (picked.length < pickCount) {
    const fallback = shuffleUserIds(partUserIds).filter((id) => !picked.includes(id));
    picked = [...picked, ...fallback.slice(0, pickCount - picked.length)];
  }
  return picked;
}

/**
 * Порядок в `predeterminedRaw` = приоритет мест; учитываются только участники.
 * Оставшиеся места — случайно среди ещё не выбранных.
 */
export function pickPredeterminedThenRandom(
  partUserIds: string[],
  pickCount: number,
  predeterminedRaw: unknown
): string[] {
  const partSet = new Set(partUserIds);
  const rawList = Array.isArray(predeterminedRaw)
    ? predeterminedRaw.filter((x): x is string => typeof x === "string")
    : [];
  const uniquePreset: string[] = [];
  const seen = new Set<string>();
  for (const id of rawList) {
    if (!seen.has(id)) {
      seen.add(id);
      uniquePreset.push(id);
    }
  }
  const picked: string[] = [];
  for (const uid of uniquePreset) {
    if (picked.length >= pickCount) break;
    if (partSet.has(uid) && !picked.includes(uid)) picked.push(uid);
  }
  if (picked.length >= pickCount) return picked;
  const remaining = partUserIds.filter((id) => !picked.includes(id));
  const needMore = pickCount - picked.length;
  const more = pickRandomFromParticipants(remaining, needMore);
  picked.push(...more);
  return picked.slice(0, pickCount);
}
