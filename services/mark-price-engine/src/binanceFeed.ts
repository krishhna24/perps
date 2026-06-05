import WebSocket from "ws";
import { RedisManager } from "@repo/pubsub";
import { emitIndexPrice } from "./priceBus.js";

const STREAM = "btcusdt@markPrice";
const RECONNECT_DELAY_MS = 2000;

export function connectBinanceFeed(): void {
  const ws = new WebSocket(`wss://fstream.binance.com/ws/${STREAM}`);

  ws.on("open", () => console.log("Binance WS connected"));



  ws.on("close", () => {
    console.warn(`Binance WS closed — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(connectBinanceFeed, RECONNECT_DELAY_MS);
  });

  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as {
      p: string;
      i: string;
      r: string;
      T: number;
    };



    RedisManager.getInstance().publishToChannel("prices:update", {
      s: "btcusdt",
      m: message.p,
      i: message.i,
      r: message.r,
      T: message.T,
    });

    emitIndexPrice(message.i);
  });

  ws.on("error", (error) => console.error("Binance WS error:", error));
}
