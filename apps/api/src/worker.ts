import "dotenv/config";
import { initSentry, captureException } from "./lib/sentry.js";
initSentry();

import type { Job } from "bullmq";
import { Worker } from "bullmq";
import { getBullConnection, getCronQueue } from "./queue/bullmq.js";
import { processVerifyTaskJob } from "./workers/verifyTaskProcessor.js";
import { runWeeklyReferralPayout } from "./services/referralWeekly.js";
import { finalizePredictionAutoClose } from "./services/predictions.js";
import { finalizeDropAfterTimer } from "./services/drops.js";
import {
  endLiveBroadcast,
  getActiveLiveBroadcast,
} from "./services/liveBroadcast.js";
import { flushOutboxBatch } from "./services/outboxFlush.js";
import { rehydratePredictionAutoCloseJobs } from "./services/predictionWorkerBootstrap.js";
import { finalizeExpiredGiveaways } from "./services/giveaways.js";
import { cleanupOldOutboxEvents } from "./services/outboxCleanup.js";

const taskConn = getBullConnection().duplicate();
const cronConn = getBullConnection().duplicate();
const domainTimersConn = getBullConnection().duplicate();

import { jobDuration } from "./lib/metrics.js";

const jobStartTimes = new Map<string, number>();

function jobLog(
  queue: string,
  job: Job,
  phase: "start" | "completed" | "failed",
  extra?: Record<string, unknown>
) {
  const jobKey = `${queue}:${job.id}`;

  if (phase === "start") {
    jobStartTimes.set(jobKey, Date.now());
  }

  if (phase === "completed" || phase === "failed") {
    const start = jobStartTimes.get(jobKey);
    if (start) {
      const durationSec = (Date.now() - start) / 1000;
      jobDuration.observe({ queue, job_name: job.name }, durationSec);
      jobStartTimes.delete(jobKey);
    }
  }

  const line = {
    ts: new Date().toISOString(),
    queue,
    jobName: job.name,
    jobId: job.id,
    phase,
    attempt: job.attemptsMade,
    ...extra,
  };
  if (phase === "failed") console.error(JSON.stringify(line));
  else console.info(JSON.stringify(line));
}

const taskWorker = new Worker(
  "task-verify",
  async (job) => {
    jobLog("task-verify", job, "start");
    await processVerifyTaskJob(
      job.data as { userId: string; taskId: string; periodKey: string }
    );
    jobLog("task-verify", job, "completed");
  },
  {
    connection: taskConn,
    concurrency: 8,
    stalledInterval: 120_000,
    maxStalledCount: 2,
  }
);

taskWorker.on("failed", (job, err) => {
  if (job) {
    jobLog("task-verify", job, "failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    captureException(err, { queue: "task-verify", jobName: job.name, jobId: job.id });
  }
});

const cronWorker = new Worker(
  "cron",
  async (job) => {
    jobLog("cron", job, "start");
    if (job.name === "weekly-referral") {
      const r = await runWeeklyReferralPayout();
      console.info("weekly-referral payout", r);
      jobLog("cron", job, "completed", { referral: r });
      return;
    }
    if (job.name === "outbox-flush") {
      const n = await flushOutboxBatch(100);
      if (n > 0) console.info("outbox-flush: sent", n);
      jobLog("cron", job, "completed", { sent: n });
      return;
    }
    if (job.name === "giveaway-finalize") {
      await finalizeExpiredGiveaways();
      jobLog("cron", job, "completed");
      return;
    }
    if (job.name === "outbox-cleanup") {
      const deleted = await cleanupOldOutboxEvents();
      if (deleted > 0) console.info("outbox-cleanup: removed", deleted);
      jobLog("cron", job, "completed", { deleted });
      return;
    }
    jobLog("cron", job, "completed");
  },
  {
    connection: cronConn,
    stalledInterval: 60_000,
    maxStalledCount: 2,
  }
);

cronWorker.on("failed", (job, err) => {
  if (job) {
    jobLog("cron", job, "failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    captureException(err, { queue: "cron", jobName: job.name, jobId: job.id });
  }
});

const domainTimersWorker = new Worker(
  "domain-timers",
  async (job) => {
    jobLog("domain-timers", job, "start");
    if (job.name === "drop-end") {
      const { dropId } = job.data as { dropId: string };
      await finalizeDropAfterTimer(dropId);
      jobLog("domain-timers", job, "completed", { dropId });
      return;
    }
    if (job.name === "live-auto-end") {
      const { broadcastId } = job.data as { broadcastId: string };
      const b = await getActiveLiveBroadcast();
      if (!b || b.id !== broadcastId) {
        jobLog("domain-timers", job, "completed", { skipped: true, broadcastId });
        return;
      }
      await endLiveBroadcast();
      jobLog("domain-timers", job, "completed", { broadcastId });
      return;
    }
    if (job.name === "prediction-auto-close") {
      const { predictionId } = job.data as { predictionId: string };
      await finalizePredictionAutoClose(predictionId);
      jobLog("domain-timers", job, "completed", { predictionId });
      return;
    }
    jobLog("domain-timers", job, "completed");
  },
  {
    connection: domainTimersConn,
    stalledInterval: 90_000,
    maxStalledCount: 2,
  }
);

domainTimersWorker.on("failed", (job, err) => {
  if (job) {
    jobLog("domain-timers", job, "failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    captureException(err, { queue: "domain-timers", jobName: job.name, jobId: job.id });
  }
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
  await q.add(
    "outbox-flush",
    {},
    {
      repeat: { every: 500 },
      jobId: "outbox-flush-repeat",
    }
  );
  await q.add(
    "giveaway-finalize",
    {},
    {
      repeat: { every: 30_000 },
      jobId: "giveaway-finalize-repeat",
    }
  );
  await q.add(
    "outbox-cleanup",
    {},
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: "outbox-cleanup-repeat",
    }
  );
}

registerRepeatableJobs().catch((e) => {
  console.error("registerRepeatableJobs", e);
});

rehydratePredictionAutoCloseJobs().catch((e) => {
  console.error("rehydratePredictionAutoCloseJobs", e);
});

async function shutdown() {
  console.log("Shutting down workers…");
  try {
    await Promise.allSettled([
      taskWorker.close(),
      cronWorker.close(),
      domainTimersWorker.close(),
    ]);
    await Promise.allSettled([
      taskConn.quit(),
      cronConn.quit(),
      domainTimersConn.quit(),
    ]);
  } catch (e) {
    console.error("shutdown error", e);
  }
  console.log("Workers stopped.");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

console.log(
  "Workers: task-verify + cron + domain-timers (Redis:",
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  ") — fraud-review: отдельный процесс `npm run worker:fraud`"
);
