import { Worker } from "@repo/queue";
import type { Job } from "@repo/queue";
import { persistEvent } from "./Persister.js";



type EventType =
  | "BALANCE_UPDATE"
  | "ORDER_UPDATE"
  | "FILL_UPDATE"
  | "POSITION_UPDATE"
  | "DEPTH_UPDATE"
  | "CANCEL_ORDER"
  | "LEDGER_UPDATE";

interface EventJob {
  type: EventType;
  data: unknown;
}

export function startConsumer(): Worker<EventJob> {
  if (!process.env["REDIS_HOST"] || !process.env["REDIS_PORT"]) {
    throw new Error("Missing REDIS_HOST or REDIS_PORT in env");
  }

  const worker = new Worker<EventJob>(
    "EVENT_QUEUE",
    (job: Job<EventJob>) => persistEvent(job.data.type, job.data.data),
    {
      connection: {
        host: process.env["REDIS_HOST"],
        port: Number(process.env["REDIS_PORT"]),
      },




      concurrency: 1,
    },
  );

  console.log("persistence consumer listening on EVENT_QUEUE → Postgres");
  return worker;
}
