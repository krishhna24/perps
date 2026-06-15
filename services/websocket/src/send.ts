import { WebSocket } from "ws";


export function sendToSockets(
  sockets: Iterable<WebSocket>,
  channel: string,
  data: unknown,
): void {
  const payload = JSON.stringify({ channel, data });
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}
