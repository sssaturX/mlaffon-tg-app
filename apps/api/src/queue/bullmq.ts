import { Redis } from "ioredis";
import { Queue } from "bullmq";

let connection: Redis | null = null;
let taskQueue: Queue | null = null;
let cronQueue: Queue | null = null;

export function getBullConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export function getTaskVerifyQueue(): Queue {
  if (!taskQueue) {
    taskQueue = new Queue("task-verify", {
      connection: getBullConnection(),
    });
  }
  return taskQueue;
}

export function getCronQueue(): Queue {
  if (!cronQueue) {
    cronQueue = new Queue("cron", {
      connection: getBullConnection(),
    });
  }
  return cronQueue;
}
