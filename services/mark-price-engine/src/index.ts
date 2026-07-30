import "dotenv/config";
import { startHealthServer } from "@repo/health";
import { connectBinanceFeed } from "./binanceFeed.js";
import { connectOrderbookFeed } from "./orderbookFeed.js";
import { markPriceFresh } from "./markPricePublisher.js";

const HEALTH_PORT = Number(process.env["HEALTH_PORT"] ?? 3013);

connectBinanceFeed();
connectOrderbookFeed();

const health = startHealthServer({
  service: "mark-price-engine",
  port: HEALTH_PORT,
  checks: {
    markPrice: () => markPriceFresh(),
  },
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received — stopping mark-price engine`);
  health.close();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
