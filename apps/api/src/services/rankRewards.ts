import { applyCreditSplit } from "./economy.js";
import {
  computeRankFromLifetime,
  RANK_MILESTONE_EXTRA,
  RANK_STEP_COINS,
} from "../rankTable.js";

/**
 * Начисляет награды за переход lifetime через пороги рангов (шаг + бонусы каждые 5).
 * Вызывать после успешного кредита, вне основной транзакции.
 */
export async function grantRankBonusesForLifetimeRange(
  userId: string,
  prevLifetime: number,
  newLifetime: number
): Promise<void> {
  if (newLifetime <= prevLifetime) return;
  const oldRank = computeRankFromLifetime(prevLifetime);
  const newRank = computeRankFromLifetime(newLifetime);
  if (newRank <= oldRank) return;

  for (let r = oldRank + 1; r <= newRank; r++) {
    const step = RANK_STEP_COINS[r];
    if (step && step > 0) {
      await applyCreditSplit({
        userId,
        amount: step,
        idempotencyKey: `rank_step:${userId}:${r}`,
        kind: "rank_up",
        referenceType: "rank",
        referenceId: String(r),
      });
    }
    const extra = RANK_MILESTONE_EXTRA[r];
    if (extra && extra > 0) {
      await applyCreditSplit({
        userId,
        amount: extra,
        idempotencyKey: `rank_milestone:${userId}:${r}`,
        kind: "rank_up",
        referenceType: "rank_milestone",
        referenceId: String(r),
      });
    }
  }
}
