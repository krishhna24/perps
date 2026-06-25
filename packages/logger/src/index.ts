type Level = "debug" | "info" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = RANK[(process.env["LOG_LEVEL"] as Level) ?? "info"] ?? RANK.info;

const STRUCTURED = process.env["NODE_ENV"] === "production";

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) return { name: arg.name, message: arg.message, stack: arg.stack };
  return arg;
}

function makeLogger(bindings: Record<string, unknown>): Logger {
  const emit = (level: Level, args: unknown[]): void => {
    if (RANK[level] < threshold) return;
    const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

    if (STRUCTURED) {
      const [first, ...rest] = args;
      const record: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        ...bindings,
        msg: typeof first === "string" ? first : undefined,
        details: (typeof first === "string" ? rest : args).map(serializeArg),
      };
      if (!record["msg"]) delete record["msg"];
      if ((record["details"] as unknown[]).length === 0) delete record["details"];
      sink(JSON.stringify(record));
      return;
    }

    const ctx = Object.keys(bindings).length ? ` ${JSON.stringify(bindings)}` : "";
    const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}${ctx}`;
    sink(prefix, ...args);
  };

  return {
    debug: (...args: unknown[]): void => emit("debug", args),
    info: (...args: unknown[]): void => emit("info", args),
    warn: (...args: unknown[]): void => emit("warn", args),
    error: (...args: unknown[]): void => emit("error", args),
    child: (extra: Record<string, unknown>): Logger => makeLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = makeLogger({});
