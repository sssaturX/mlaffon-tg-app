import { Redis } from "ioredis";
import { Queue } from "bullmq";

/** Production defaults: retries + exponential backoff; failed jobs остаются в BullMQ (аналог DLQ). */
const defaultJobOptions = {
  attempts: 4,
  backoff: { type: "exponential" as const, delay: 2500 },
  removeOnComplete: 1000,
  removeOnFail: false,
};

let connection: Redis | null = null;
let taskQueue: Queue | null = null;
let cronQueue: Queue | null = null;
let domainTimersQueue: Queue | null = null;
let fraudReviewQueue: Queue | null = null;

export function getBullConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: null,
      connectTimeout: 10_000,
    });
  }
  return connection;
}

export function getTaskVerifyQueue(): Queue {
  if (!taskQueue) {
    taskQueue = new Queue("task-verify", {
      connection: getBullConnection(),
      defaultJobOptions,
    });
  }
  return taskQueue;
}

export function getCronQueue(): Queue {
  if (!cronQueue) {
    cronQueue = new Queue("cron", {
      connection: getBullConnection(),
      defaultJobOptions,
    });
  }
  return cronQueue;
}

export function getDomainTimersQueue(): Queue {
  if (!domainTimersQueue) {
    domainTimersQueue = new Queue("domain-timers", {
      connection: getBullConnection(),
      defaultJobOptions,
    });
  }
  return domainTimersQueue;
}

export function getFraudReviewQueue(): Queue {
  if (!fraudReviewQueue) {
    fraudReviewQueue = new Queue("fraud-review", {
      connection: getBullConnection(),
      defaultJobOptions,
    });
  }
  return fraudReviewQueue;
}
