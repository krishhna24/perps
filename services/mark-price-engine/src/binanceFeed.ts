import WebSocket from "ws";
import { RedisManager } from "@repo/pubsub";
import { emitIndexPrice } from "./priceBus.js";

const STREAM = "btcusdt@markPrice";
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

interface MarkPriceMessage {
  p: string;
  i: string;
  r: string;
  T: number;
}

function isMarkPriceMessage(v: unknown): v is MarkPriceMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m["p"] === "string" &&
    typeof m["i"] === "string" &&
    typeof m["r"] === "string" &&
    typeof m["T"] === "number"
  );
}

export function connectBinanceFeed(attempt = 0): void {
  const ws = new WebSocket(`wss://fstream.binance.com/ws/${STREAM}`);

  const reconnect = (): void => {
    const ceiling = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
    const delay = Math.random() * ceiling;
    console.warn(`Binance WS reconnecting in ${Math.round(delay)}ms (attempt ${attempt + 1})`);
    setTimeout(() => connectBinanceFeed(attempt + 1), delay);
  };

  ws.on("open", () => {
    attempt = 0;
    console.log("Binance WS connected");
  });

  ws.on("close", reconnect);

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      console.warn("Binance WS: dropping non-JSON frame");
      return;
    }
    if (!isMarkPriceMessage(parsed)) {
      console.warn("Binance WS: dropping frame with unexpected shape");
      return;
    }

    RedisManager.getInstance().publishToChannel("prices:update", {
      s: "btcusdt",
      m: parsed.p,
      i: parsed.i,
      r: parsed.r,
      T: parsed.T,
    });

    emitIndexPrice(parsed.i);
  });

  ws.on("error", (error) => console.error("Binance WS error:", error));
}
