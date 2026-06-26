import "dotenv/config";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const JWT_SECRET = required("JWT_SECRET");
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "15m";
export const JWT_REFRESH_SECRET = required("JWT_REFRESH_SECRET");
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? "7d";
export const INTERNAL_SERVICE_KEY = required("INTERNAL_SERVICE_KEY");

export const WS_TICKET_TTL_S = Number(process.env.WS_TICKET_TTL_S ?? 45);

export const REFRESH_COOKIE_MAX_AGE_MS = Number(
  process.env.REFRESH_COOKIE_MAX_AGE_MS ?? 7 * 24 * 60 * 60 * 1000,
);

export const RATE_LIMIT_WINDOW_MS = Number(
  process.env.RATE_LIMIT_WINDOW_MS ?? 60_000,
);
export const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 300);

export const AUTH_RATE_LIMIT_WINDOW_MS = Number(
  process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60_000,
);
export const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20);

export const LOGIN_MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES ?? 5);
export const LOGIN_LOCKOUT_MS = Number(
  process.env.LOGIN_LOCKOUT_MS ?? 15 * 60_000,
);

export const INTERNAL_MAX_SKEW_MS = Number(
  process.env.INTERNAL_MAX_SKEW_MS ?? 30_000,
);
