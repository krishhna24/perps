import "dotenv/config";
import { Queue } from "bullmq";
import type { EngineCommand } from "./orderMapper.js";

export type {
  BalanceAction,
  EngineBalanceCommand,
  EngineCommand,
  EngineOrderAction,
  EngineQueueOrder,
} from "./orderMapper.js";
export { toEngineOrder, toEngineBalanceCommand } from "./orderMapper.js";

if (!process.env["REDIS_HOST"] || !process.env["REDIS_PORT"]) {
  throw new Error("Missing REDIS_HOST or REDIS_PORT in env");
}

export const orderQueue = new Queue("ORDER_QUEUE", {
  connection: {
    host: process.env["REDIS_HOST"],
    port: Number(process.env["REDIS_PORT"]),
  },
});

export async function enqueueRelayedCommand(command: EngineCommand, commandId: string): Promise<void> {
  await orderQueue.add("command", command, {
    jobId: commandId,
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  });
}
