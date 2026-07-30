import "dotenv/config";
import { startHealthServer } from "@repo/health";
import "./channelBroadcaster.js";
import { startWssGateway } from "./server.js";

const HEALTH_PORT = Number(process.env["HEALTH_PORT"] ?? 3012);

const wss = startWssGateway();

const health = startHealthServer({
  service: "websocket",
  port: HEALTH_PORT,
  checks: {
    listening: () => wss.address() !== null,
  },
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received — closing WSS gateway`);
  health.close();
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
