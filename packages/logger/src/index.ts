

type Level = "debug" | "info" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = RANK[(process.env["LOG_LEVEL"] as Level) ?? "info"] ?? RANK.info;

function emit(level: Level, args: unknown[]): void {
  if (RANK[level] < threshold) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(prefix, ...args);
}

export const logger = {
  debug: (...args: unknown[]): void => emit("debug", args),
  info: (...args: unknown[]): void => emit("info", args),
  warn: (...args: unknown[]): void => emit("warn", args),
  error: (...args: unknown[]): void => emit("error", args),
};
