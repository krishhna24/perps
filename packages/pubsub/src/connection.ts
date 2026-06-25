export function redisSocket(): { host: string; port: number; reconnectStrategy: (retries: number) => number } {
  const host = process.env["REDIS_HOST"];
  const port = process.env["REDIS_PORT"];
  if (!host || !port) {
    throw new Error("Missing REDIS_HOST or REDIS_PORT in env");
  }
  return {
    host,
    port: Number(port),
    reconnectStrategy: (retries: number) => Math.min(50 * 2 ** retries, 3000),
  };
}
