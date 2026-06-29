import "dotenv/config";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const JWT_SECRET = required("JWT_SECRET");
export const PORT = Number(process.env["PORT"] ?? 8080);

export const WS_MAX_PAYLOAD_BYTES = Number(
  process.env["WS_MAX_PAYLOAD_BYTES"] ?? 4 * 1024,
);

export const WS_ALLOWED_ORIGINS = (process.env["WS_ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const WS_HEARTBEAT_INTERVAL_MS = Number(
  process.env["WS_HEARTBEAT_INTERVAL_MS"] ?? 30_000,
);

export const WS_MAX_CONNECTIONS_PER_IP = Number(
  process.env["WS_MAX_CONNECTIONS_PER_IP"] ?? 20,
);
