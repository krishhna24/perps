import http from "node:http";
import { logger } from "@repo/logger";

export type ProbeResult = boolean | Promise<boolean>;

export interface HealthServerOptions {
  service: string;
  port: number;
  checks?: Record<string, () => ProbeResult>;
}

const PROBE_TIMEOUT_MS = 2000;

const withTimeout = (p: ProbeResult): Promise<boolean> =>
  Promise.race([
    Promise.resolve(p),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROBE_TIMEOUT_MS).unref()),
  ]);

export function startHealthServer(options: HealthServerOptions): http.Server {
  const { service, port, checks = {} } = options;

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url === "/health") {
      send(200, { status: "ok", service });
      return;
    }

    if (url === "/ready") {
      const names = Object.keys(checks);
      void Promise.all(names.map((name) => withTimeout(checks[name]!())))
        .then((results) => {
          const detail: Record<string, boolean> = {};
          names.forEach((name, i) => (detail[name] = results[i]!));
          const ready = results.every(Boolean);
          send(ready ? 200 : 503, {
            status: ready ? "ready" : "not-ready",
            service,
            checks: detail,
          });
        })
        .catch(() => send(503, { status: "not-ready", service }));
      return;
    }

    send(404, { error: "not found" });
  });

  server.listen(port, () => {
    logger.info(`${service} health probes listening on :${port} (/health, /ready)`);
  });

  server.on("error", (error) => {
    logger.error(`${service} health server error:`, error);
  });

  return server;
}
