import { WebSocketServer, WebSocket } from "ws";
import { verifyToken } from "./auth.js";
import { registerClient, unregisterClient } from "./channelBroadcaster.js";
import { addBalanceListener, removeBalanceListener } from "./balanceRouter.js";
import { PORT } from "./env.js";

export function startWssGateway(): WebSocketServer {
  const wss = new WebSocketServer({ port: PORT });

  wss.on("connection", (socket: WebSocket, request) => {
    const token = new URL(request.url ?? "", "http://localhost").searchParams.get("token");
    const userId = token ? verifyToken(token) : null;

    if (!userId) {
      socket.close(4001, "Unauthorized");
      return;
    }

    registerClient(socket);
    addBalanceListener(userId, socket);

    const cleanup = (): void => {
      unregisterClient(socket);
      removeBalanceListener(userId, socket);
    };

    socket.on("close", cleanup);


    socket.on("error", (err) => {
      console.error("socket error:", err);
      cleanup();
    });
  });

  console.log(`WSS gateway listening on ${PORT}`);
  return wss;
}
