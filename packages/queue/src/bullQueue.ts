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
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export const eventQueue = new Queue("EVENT_QUEUE", { connection, defaultJobOptions });
export const liquidationQueue = new Queue("LIQUIDATION_QUEUE", { connection, defaultJobOptions });
export const fundingQueue = new Queue("FUNDING_QUEUE", { connection, defaultJobOptions });
