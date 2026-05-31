import "dotenv/config";
import { Worker } from "@repo/queue";
import { Engine } from "./Engine.js";
import type { BalanceCommand, Order } from "./domain/types.js";

const QUEUE_NAME = "ORDER_QUEUE";

if (!process.env["REDIS_HOST"] || !process.env["REDIS_PORT"]) {
  throw new Error("Missing REDIS_HOST or REDIS_PORT in env");
}
const connection = {
  host: process.env["REDIS_HOST"],
  port: Number(process.env["REDIS_PORT"]),
};

async function main(): Promise<void> {
  const engine = await Engine.create();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {




      await engine.dispatchCommand(job.data as Order | BalanceCommand);
    },
    { connection },
  );

  console.log(`engine up — consuming ${QUEUE_NAME}`);



  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received — draining engine`);
    try {
      await worker.close();
      await engine.stop();
    } catch (error) {
      console.error("error during shutdown:", error);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("engine failed to start:", error);
  process.exit(1);
});
