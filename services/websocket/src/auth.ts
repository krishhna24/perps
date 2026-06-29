import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./env.js";

export function verifyToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}

export function verifyTicket(ticket: string): string | null {
  try {
    const decoded = jwt.verify(ticket, JWT_SECRET) as {
      userId?: string;
      ws?: boolean;
    };
    if (decoded.ws !== true || !decoded.userId) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}
