import "dotenv/config";
import type { Job } from "bullmq";
import { Worker } from "bullmq";
import { getBullConnection } from "./queue/bullmq.js";
import type { FraudReviewJobPayload } from "./services/fraudReviewQueue.js";

const fraudReviewConn = getBullConnection().duplicate();

function jobLog(
  queue: string,
  job: Job,
  phase: "start" | "completed" | "failed",
  extra?: Record<string, unknown>
) {
  const line = {
    ts: new Date().toISOString(),
    queue,
    jobName: job.name,
    jobId: job.id,
    phase,
    ...extra,
  };
  if (phase === "failed") console.error(JSON.stringify(line));
  else console.info(JSON.stringify(line));
}

const fraudReviewWorker = new Worker(
  "fraud-review",
  async (job) => {
    jobLog("fraud-review", job, "start");
    const payload = job.data as FraudReviewJobPayload;
    console.info("[fraud-review]", JSON.stringify(payload));
    jobLog("fraud-review", job, "completed");
  },
  {
    connection: fraudReviewConn,
    concurrency: 2,
    stalledInterval: 60_000,
    maxStalledCount: 2,
  }
);

fraudReviewWorker.on("failed", (job, err) => {
  if (job) {
    jobLog("fraud-review", job, "failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
});

async function shutdown() {
  console.log("Shutting down fraud-review worker…");
  try {
    await fraudReviewWorker.close();
    await fraudReviewConn.quit();
  } catch (e) {
    console.error("shutdown error", e);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

console.log(
  "Worker: fraud-review only (Redis:",
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  ")"
);
