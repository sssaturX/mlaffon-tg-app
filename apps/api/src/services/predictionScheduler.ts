import { getDomainTimersQueue } from "../queue/bullmq.js";

const MAX_DELAY_MS = 2_147_483_647;

export function predictionAutoCloseJobId(predictionId: string): string {
  return `prediction-auto-close:${predictionId}`;
}

export async function cancelPredictionAutoCloseJob(
  predictionId: string
): Promise<void> {
  try {
    const q = getDomainTimersQueue();
    const job = await q.getJob(predictionAutoCloseJobId(predictionId));
    if (job) await job.remove();
  } catch {
    /* ignore */
  }
}

export async function schedulePredictionAutoCloseJob(
  predictionId: string,
  runAt: Date
): Promise<void> {
  const delay = Math.min(
    Math.max(0, runAt.getTime() - Date.now()),
    MAX_DELAY_MS
  );
  try {
    const q = getDomainTimersQueue();
    await cancelPredictionAutoCloseJob(predictionId);
    await q.add(
      "prediction-auto-close",
      { predictionId },
      {
        jobId: predictionAutoCloseJobId(predictionId),
        delay,
        removeOnComplete: true,
        attempts: 4,
        backoff: { type: "exponential", delay: 2000 },
      }
    );
  } catch (e) {
    console.warn("schedulePredictionAutoCloseJob failed", predictionId, e);
  }
}
