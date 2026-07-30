import "dotenv/config";
import { startHealthServer } from "@repo/health";
import { prisma } from "@repo/db";
import { startConsumer } from "./consumer.js";
import { startRelay } from "./relay.js";

const HEALTH_PORT = Number(process.env["HEALTH_PORT"] ?? 3011);

const worker = startConsumer();
const relay = startRelay();

const health = startHealthServer({
  service: "persistence",
  port: HEALTH_PORT,
  checks: {
    eventConsumer: () => worker.isRunning(),
    postgres: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
  },
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received — draining persistence consumer`);
  try {
    health.close();
    relay.stop();
    await worker.close();
  } catch (error) {
    console.error("error during shutdown:", error);
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
