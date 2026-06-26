import "dotenv/config";
import { Queue } from "bullmq";

if (!process.env["REDIS_HOST"] || !process.env["REDIS_PORT"]) {
  throw new Error("Missing REDIS_HOST or REDIS_PORT in env");
}

const connection = {
  host: process.env["REDIS_HOST"],
  port: Number(process.env["REDIS_PORT"]),
};

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export const eventQueue = new Queue("EVENT_QUEUE", { connection, defaultJobOptions });
export const liquidationQueue = new Queue("LIQUIDATION_QUEUE", { connection, defaultJobOptions });
export const fundingQueue = new Queue("FUNDING_QUEUE", { connection, defaultJobOptions });

export const eventDlq = new Queue("EVENT_DLQ", { connection });
export const liquidationDlq = new Queue("LIQUIDATION_DLQ", { connection });
export const fundingDlq = new Queue("FUNDING_DLQ", { connection });

const deadLetterQueues: Record<string, Queue> = {
  EVENT_QUEUE: eventDlq,
  LIQUIDATION_QUEUE: liquidationDlq,
  FUNDING_QUEUE: fundingDlq,
};

export async function moveToDeadLetter(
  sourceQueueName: string,
  job: { name: string; data: unknown; id?: string },
): Promise<void> {
  const dlq = deadLetterQueues[sourceQueueName];
  if (!dlq) return;
  await dlq.add(job.name, job.data, job.id ? { jobId: job.id } : undefined);
}
