import "dotenv/config";
import { Worker } from "bullmq";
import { getBullConnection, getCronQueue } from "./queue/bullmq.js";
import { processVerifyTaskJob } from "./workers/verifyTaskProcessor.js";
import { runWeeklyReferralPayout } from "./services/referralWeekly.js";

const taskConn = getBullConnection().duplicate();
const cronConn = getBullConnection().duplicate();

const taskWorker = new Worker(
  "task-verify",
  async (job) => {
    await processVerifyTaskJob(
      job.data as { userId: string; taskId: string; periodKey: string }
    );
  },
  { connection: taskConn, concurrency: 8 }
);

taskWorker.on("failed", (job, err) => {
  console.error("task-verify failed", job?.id, err);
});

taskWorker.on("completed", (job) => {
  console.info("task-verify ok", job.id);
});

const cronWorker = new Worker(
  "cron",
  async (job) => {
    if (job.name === "weekly-referral") {
      const r = await runWeeklyReferralPayout();
      console.info("weekly-referral payout", r);
    }
  },
  { connection: cronConn }
);

cronWorker.on("failed", (job, err) => {
  console.error("cron failed", job?.id, err);
});

async function registerRepeatableJobs() {
  const q = getCronQueue();
  await q.add(
    "weekly-referral",
    {},
    {
      repeat: { pattern: "5 0 * * 1" },
      jobId: "weekly-referral-repeat",
    }
  );
}

registerRepeatableJobs().catch((e) => {
  console.error("registerRepeatableJobs", e);
});

console.log(
  "Workers: task-verify + cron (Redis:",
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  ")"
);
