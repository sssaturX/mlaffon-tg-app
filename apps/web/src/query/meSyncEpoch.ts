/**
 * Монотонные эпохи для защиты кэша `me/*` от гонки:
 * HTTP-ответ завершился после более нового WS `me_update` → не перетираем кэш.
 */
let economyEpoch = 0;
let profileEpoch = 0;

export function bumpEconomyEpoch(): void {
  economyEpoch++;
}

export function getEconomyEpoch(): number {
  return economyEpoch;
}

export function bumpProfileEpoch(): void {
  profileEpoch++;
}

export function getProfileEpoch(): number {
  return profileEpoch;
}
