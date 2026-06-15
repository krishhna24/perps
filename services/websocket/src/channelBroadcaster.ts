import { SubscriptionManager } from "@repo/pubsub";
import { WebSocket } from "ws";
import { sendToSockets } from "./send.js";

const GLOBAL_CHANNELS = [
  "trade:update",
  "depth:update",
  "order:cancelled",
  "prices:update",
] as const;

const clients = new Set<WebSocket>();

export function registerClient(socket: WebSocket): void {
  clients.add(socket);
}

export function unregisterClient(socket: WebSocket): void {
  clients.delete(socket);
}

for (const channel of GLOBAL_CHANNELS) {
  SubscriptionManager.getInstance().subscribe(channel, (data: unknown) => {
    sendToSockets(clients, channel, data);
  });
}
