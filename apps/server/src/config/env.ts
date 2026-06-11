import "dotenv/config";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const JWT_SECRET = required("JWT_SECRET");
export const JWT_EXPIRES_IN = "7d";
export const JWT_REFRESH_SECRET = required("JWT_REFRESH_SECRET");
export const JWT_REFRESH_EXPIRES_IN = "7d";
export const INTERNAL_SERVICE_KEY = required("INTERNAL_SERVICE_KEY");
