import { SubscriptionManager } from "@repo/pubsub";
import { WebSocket } from "ws";
import { sendToSockets } from "./send.js";

const socketsByUser = new Map<string, Set<WebSocket>>();


const perUserChannels = (userId: string): string[] => [
  `balance@${userId}`,
  `order:rejected@${userId}`,
];

function broadcastToUser(userId: string, channel: string, data: unknown): void {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return;
  sendToSockets(sockets, channel, data);
}

export function addBalanceListener(userId: string, socket: WebSocket): void {
  let sockets = socketsByUser.get(userId);
  if (!sockets) {
    sockets = new Set();
    socketsByUser.set(userId, sockets);
    for (const channel of perUserChannels(userId)) {
      SubscriptionManager.getInstance().subscribe(channel, (data: unknown) => {
        broadcastToUser(userId, channel, data);
      });
    }
  }
  sockets.add(socket);
}

export function removeBalanceListener(userId: string, socket: WebSocket): void {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) {
    socketsByUser.delete(userId);
    for (const channel of perUserChannels(userId)) {
      SubscriptionManager.getInstance().unsubscribe(channel);
    }
  }
}






interface WirePosition {
  userId: string;
}
SubscriptionManager.getInstance().subscribe("position:update", (raw: unknown) => {
  const payload = raw as { data?: WirePosition[] };
  if (!payload?.data) return;
  const byUser = new Map<string, WirePosition[]>();
  for (const position of payload.data) {
    const list = byUser.get(position.userId) ?? [];
    list.push(position);
    byUser.set(position.userId, list);
  }
  for (const [userId, positions] of byUser) {
    const sockets = socketsByUser.get(userId);


    if (sockets) sendToSockets(sockets, "position:update", { data: positions });
  }
});
