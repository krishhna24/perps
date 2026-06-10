import "dotenv/config";
import "./fundingRateCache.js";
import { startFundingScheduler } from "./fundingScheduler.js";

const task = startFundingScheduler();


const shutdown = (signal: string): void => {
  console.log(`${signal} received — stopping funding scheduler`);
  task.stop();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
