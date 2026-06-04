import "dotenv/config";
import { startConsumer } from "./consumer.js";

const worker = startConsumer();



const shutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received — draining persistence consumer`);
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
