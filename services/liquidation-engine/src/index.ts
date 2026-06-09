import "dotenv/config";
import { Liquidator } from "./Liquidator.js";
import worker from "./liquidationWorker.js";

new Liquidator();

const shutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received — closing liquidation worker`);
  try {
    await worker.close();
  } catch (error) {
    console.error("error during shutdown:", error);
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
