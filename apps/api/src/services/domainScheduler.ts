import { getDomainTimersQueue } from "../queue/bullmq.js";

const MAX_DELAY_MS = 2_147_483_647;

export async function scheduleDropEndJob(
  dropId: string,
  delayMs: number
): Promise<void> {
  try {
    const q = getDomainTimersQueue();
    const delay = Math.min(Math.max(0, Math.floor(delayMs)), MAX_DELAY_MS);
    await q.add(
      "drop-end",
      { dropId },
      {
        delay,
        jobId: `drop-end:${dropId}`,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      }
    );
  } catch (e) {
    console.warn("scheduleDropEndJob failed", dropId, e);
  }
}

export async function scheduleLiveAutoEndJob(
  broadcastId: string,
  delayMs: number
): Promise<void> {
  try {
    const q = getDomainTimersQueue();
    const delay = Math.min(Math.max(0, Math.floor(delayMs)), MAX_DELAY_MS);
    if (delay <= 0) return;
    await q.add(
      "live-auto-end",
      { broadcastId },
      {
        delay,
        jobId: `live-auto-end:${broadcastId}`,
        removeOnComplete: true,
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
      }
    );
  } catch (e) {
    console.warn("scheduleLiveAutoEndJob failed", broadcastId, e);
  }
}
