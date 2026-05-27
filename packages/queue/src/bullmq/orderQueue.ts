import "dotenv/config";
import { Queue } from "bullmq";
import type { LedgerEntry, Order } from "@repo/db";
import {
  toEngineOrder,
  type BalanceAction,
  type EngineBalanceCommand,
  type EngineCommand,
  type EngineOrderAction,
} from "./orderMapper.js";

export type {
  BalanceAction,
  EngineBalanceCommand,
  EngineCommand,
  EngineOrderAction,
  EngineQueueOrder,
} from "./orderMapper.js";

if (!process.env["REDIS_HOST"] || !process.env["REDIS_PORT"]) {
  throw new Error("Missing REDIS_HOST or REDIS_PORT in env");
}

export const orderQueue = new Queue("ORDER_QUEUE", {
  connection: {
    host: process.env["REDIS_HOST"],
    port: Number(process.env["REDIS_PORT"]),
  },
});


export async function getCompletedCommands(): Promise<EngineCommand[]> {
  const jobs = await orderQueue.getJobs(["completed"], 0, -1, true);
  return jobs.map((job) => job.data as EngineCommand);
}

export async function addToQueue(order: Order, action: EngineOrderAction): Promise<void> {
  await orderQueue.add("order", toEngineOrder(order, action), {





    jobId: `${order.id}__${action}`,
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  });
}


export async function addBalanceToQueue(entry: LedgerEntry): Promise<void> {
  const action: BalanceAction = entry.type === "DEPOSIT" ? "BALANCE-DEPOSIT" : "BALANCE-WITHDRAW";
  const command: EngineBalanceCommand = {
    id: entry.id,
    type: action,
    seq: entry.seq != null ? entry.seq.toString() : undefined,
    userId: entry.userId,
    amount: entry.amount.toString(),
  };
  await orderQueue.add("balance", command, {
    jobId: `${entry.id}__${action}`,
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  });
}
