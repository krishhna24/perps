import "dotenv/config";
import "./channelBroadcaster.js";
import { startWssGateway } from "./server.js";

const wss = startWssGateway();


const shutdown = (signal: string): void => {
  console.log(`${signal} received — closing WSS gateway`);
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
