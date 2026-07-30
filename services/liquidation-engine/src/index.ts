import "dotenv/config";
import { startHealthServer } from "@repo/health";
import { Liquidator } from "./Liquidator.js";
import worker from "./liquidationWorker.js";

const HEALTH_PORT = Number(process.env["HEALTH_PORT"] ?? 3014);

new Liquidator();

const health = startHealthServer({
  service: "liquidation-engine",
  port: HEALTH_PORT,
  checks: {
    liquidationWorker: () => worker.isRunning(),
  },
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received — closing liquidation worker`);
  try {
    health.close();
    await worker.close();
  } catch (error) {
    console.error("error during shutdown:", error);
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
