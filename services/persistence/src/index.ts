import "dotenv/config";
import { startConsumer } from "./consumer.js";
import { startRelay } from "./relay.js";

const worker = startConsumer();
const relay = startRelay();


const shutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received — draining persistence consumer`);
  try {
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
