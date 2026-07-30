import "dotenv/config";
import { Worker } from "@repo/queue";
import { startHealthServer } from "@repo/health";
import { prisma } from "@repo/db";
import { Engine } from "./Engine.js";
import type { BalanceCommand, Order } from "./domain/types.js";

const QUEUE_NAME = "ORDER_QUEUE";
const HEALTH_PORT = Number(process.env["HEALTH_PORT"] ?? 3010);

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
    { connection, concurrency: 1 },
  );

  console.log(`engine up — consuming ${QUEUE_NAME}`);

  const health = startHealthServer({
    service: "engine",
    port: HEALTH_PORT,
    checks: {
      orderConsumer: () => worker.isRunning(),
      postgres: async () => {
        try {
          await prisma.$queryRaw`SELECT 1`;
          return true;
        } catch {
          return false;
        }
      },
      snapshots: () => engine.snapshotHealthy(),
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received — draining engine`);
    try {
      health.close();
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
