import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { verifyTicket } from "./auth.js";
import { registerClient, unregisterClient } from "./channelBroadcaster.js";
import { addBalanceListener, removeBalanceListener } from "./balanceRouter.js";
import {
  PORT,
  WS_MAX_PAYLOAD_BYTES,
  WS_ALLOWED_ORIGINS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_CONNECTIONS_PER_IP,
} from "./env.js";

interface LiveSocket extends WebSocket {
  isAlive?: boolean;
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (WS_ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return true;
  return WS_ALLOWED_ORIGINS.includes(origin);
}

function remoteIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (header) {
    const first = header.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? "unknown";
}

export function startWssGateway(): WebSocketServer {
  const wss = new WebSocketServer({
    port: PORT,
    maxPayload: WS_MAX_PAYLOAD_BYTES,
  });

  if (WS_ALLOWED_ORIGINS.length === 0) {
    console.warn(
      "WS_ALLOWED_ORIGINS is empty — allowing all origins (dev only). Set it in production.",
    );
  }

  const connectionsByIp = new Map<string, number>();

  wss.on("connection", (socket: LiveSocket, request) => {
    const origin = request.headers.origin;
    if (!isOriginAllowed(origin)) {
      socket.close(4403, "Forbidden origin");
      return;
    }

    const ip = remoteIp(request);
    const current = connectionsByIp.get(ip) ?? 0;
    if (current >= WS_MAX_CONNECTIONS_PER_IP) {
      socket.close(4429, "Too many connections");
      return;
    }

    const ticket = new URL(request.url ?? "", "http://localhost").searchParams.get("ticket");
    const userId = ticket ? verifyTicket(ticket) : null;

    if (!userId) {
      socket.close(4001, "Unauthorized");
      return;
    }

    connectionsByIp.set(ip, current + 1);
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    registerClient(socket);
    addBalanceListener(userId, socket);

    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      unregisterClient(socket);
      removeBalanceListener(userId, socket);
      const count = connectionsByIp.get(ip) ?? 0;
      if (count <= 1) connectionsByIp.delete(ip);
      else connectionsByIp.set(ip, count - 1);
    };

    socket.on("close", cleanup);

    socket.on("error", (err) => {
      console.error("socket error:", err);
      cleanup();
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const socket = client as LiveSocket;
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, WS_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  console.log(`WSS gateway listening on ${PORT}`);
  return wss;
}
