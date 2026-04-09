import { getFraudReviewQueue } from "../queue/bullmq.js";

export type FraudReviewJobPayload =
  | {
      kind: "task_claim_blocked";
      userId: string;
      sharedUsers: number;
      ip: string;
      userAgent: string;
      deviceId: string;
    }
  | {
      kind: "stream_message_blocked";
      userId: string;
      sharedUsers: number;
      ip: string;
      userAgent: string;
      deviceId: string;
    }
  | {
      kind: "web_register";
      userId: string;
      emailDomain: string;
      clientIp: string | null;
    };

export async function enqueueFraudReviewJob(
  payload: FraudReviewJobPayload
): Promise<void> {
  try {
    await getFraudReviewQueue().add("review", payload, {
      removeOnComplete: 100,
      attempts: 2,
      backoff: { type: "fixed", delay: 3000 },
    });
  } catch (e) {
    console.warn("[fraud-review] enqueue failed", e);
  }
}
