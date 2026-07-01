import crypto from "node:crypto";
import { logger } from "@repo/logger";
import { Worker } from "@repo/queue";
import { Decimal } from "@repo/types";
import axios from "axios";

if (
  !process.env["REDIS_HOST"] ||
  !process.env["REDIS_PORT"] ||
  !process.env["API_URL"] ||
  !process.env["INTERNAL_SERVICE_KEY"] ||
  !process.env["MARKET_ID"]
) {
  throw new Error(
    "Missing REDIS_HOST, REDIS_PORT, API_URL, INTERNAL_SERVICE_KEY, or MARKET_ID in env",
  );
}

const worker = new Worker(
  "LIQUIDATION_QUEUE",
  async (job) => {
    const order = job.data as {
      userId: string;
      side: "LONG" | "SHORT";
      entryPrice: string;
      quantity: string;
      liquidationQty: string;
      margin: string;
      leverage?: number;
    };

    const closingSide = order.side === "LONG" ? "SHORT" : "LONG";

    let leverage = order.leverage ?? 0;
    if (!leverage) {
      const margin = new Decimal(order.margin);
      leverage = margin.isZero()
        ? 1
        : new Decimal(order.entryPrice).times(order.quantity).div(margin).round().toNumber();
    }
    if (!Number.isFinite(leverage)) leverage = 1;
    leverage = Math.min(125, Math.max(1, leverage));

    const rawBody = JSON.stringify({
      userId: order.userId,
      marketId: process.env["MARKET_ID"],
      side: closingSide,
      orderType: "MARKET",
      quantity: order.liquidationQty,
      leverage,
    });
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHmac("sha256", process.env["INTERNAL_SERVICE_KEY"] as string)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    await axios.post(
      `${process.env["API_URL"]}/api/orders/internal/liquidate`,
      rawBody,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Timestamp": timestamp,
          "X-Internal-Signature": signature,
        },
      },
    );
  },
  {
    connection: {
      host: process.env["REDIS_HOST"],
      port: Number(process.env["REDIS_PORT"]),
    },
  },
);

const STUCK_THRESHOLD = 3;
let consecutiveFailures = 0;

worker.on("completed", (job) => {
  consecutiveFailures = 0;
  logger.info("liquidation completed:", job.id);
});

worker.on("failed", (job, err) => {
  consecutiveFailures += 1;
  logger.error("liquidation failed:", job?.id, err);
  if (consecutiveFailures >= STUCK_THRESHOLD) {
    logger.error(
      `LIQUIDATIONS STUCK — ${consecutiveFailures} consecutive failures; at-risk positions may not be closing. Last job: ${job?.id}`,
    );
  }
});

export default worker;
