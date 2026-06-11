import express from "express";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import "dotenv/config";
import { prisma } from "@repo/db";
import { eventQueue } from "@repo/queue";
import router from "./routes/index.routes.js";

const app = express();
app.disable("x-powered-by");



const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
};



const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : true;
app.use(securityHeaders);
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/api", router);


const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("health check timed out")), ms).unref()
    ),
  ]);


app.get("/health", async (_req, res) => {
  const checks = { postgres: false, redis: false };
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 1000);
    checks.postgres = true;
  } catch {

  }
  try {

    const client = (await withTimeout(eventQueue.client, 1000)) as unknown as {
      ping: () => Promise<string>;
    };
    await withTimeout(client.ping(), 1000);
    checks.redis = true;
  } catch {

  }
  const ok = checks.postgres && checks.redis;
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", checks });
});

const port = process.env.PORT || 3001;

const server = app.listen(port, () => {
  console.log(`SERVER RUNNING ON : ${port}`);
});


const shutdown = (signal: string): void => {
  console.log(`${signal} received — closing HTTP server`);
  server.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
