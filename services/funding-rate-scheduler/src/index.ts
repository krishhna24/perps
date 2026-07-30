import "dotenv/config";
import { startHealthServer } from "@repo/health";
import { getLatestFunding } from "./fundingRateCache.js";
import { startFundingScheduler } from "./fundingScheduler.js";

const HEALTH_PORT = Number(process.env["HEALTH_PORT"] ?? 3015);

const task = startFundingScheduler();

const health = startHealthServer({
  service: "funding-rate-scheduler",
  port: HEALTH_PORT,
  checks: {
    fundingRateAvailable: () => getLatestFunding() !== null,
  },
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received — stopping funding scheduler`);
  health.close();
  task.stop();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
