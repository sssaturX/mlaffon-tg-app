import "dotenv/config";
import { Worker } from "bullmq";
import { getBullConnection } from "./queue/bullmq.js";
import { processVerifyTaskJob } from "./workers/verifyTaskProcessor.js";

const connection = getBullConnection().duplicate();

const worker = new Worker(
  "task-verify",
  async (job) => {
    await processVerifyTaskJob(
      job.data as { userId: string; taskId: string; periodKey: string }
    );
  },
  { connection, concurrency: 8 }
);

worker.on("failed", (job, err) => {
  console.error("task-verify failed", job?.id, err);
});

worker.on("completed", (job) => {
  console.info("task-verify ok", job.id);
});

console.log("Worker task-verify started (Redis:", process.env.REDIS_URL ?? "redis://127.0.0.1:6379", ")");
