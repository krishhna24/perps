import "dotenv/config";
import { connectBinanceFeed } from "./binanceFeed.js";
import { connectOrderbookFeed } from "./orderbookFeed.js";
import "./markPricePublisher.js";

connectBinanceFeed();
connectOrderbookFeed();



const shutdown = (signal: string): void => {
  console.log(`${signal} received — stopping mark-price engine`);
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
