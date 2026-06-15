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
