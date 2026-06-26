import type { Response, NextFunction } from "express";
import crypto from "node:crypto";
import { INTERNAL_SERVICE_KEY, INTERNAL_MAX_SKEW_MS } from "../config/env.js";
import type { AuthRequest } from "./auth.middleware.js";

export interface InternalAuthRequest extends AuthRequest {
  isInternalLiquidation?: boolean;
}

const seenSignatures = new Map<string, number>();

const isFirstUse = (signature: string): boolean => {
  const now = Date.now();
  for (const [seen, at] of seenSignatures) {
    if (now - at > INTERNAL_MAX_SKEW_MS * 2) seenSignatures.delete(seen);
  }
  if (seenSignatures.has(signature)) return false;
  seenSignatures.set(signature, now);
  return true;
};

const safeHexEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
};

export const internalAuthMiddleware = (
  req: InternalAuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const signature = req.headers["x-internal-signature"];
  const timestamp = req.headers["x-internal-timestamp"];

  if (
    typeof signature !== "string" ||
    typeof timestamp !== "string" ||
    !signature ||
    !timestamp
  ) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > INTERNAL_MAX_SKEW_MS) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";
  const expected = crypto
    .createHmac("sha256", INTERNAL_SERVICE_KEY)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (!safeHexEqual(signature, expected)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (!isFirstUse(signature)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { userId } = req.body as { userId?: string };
  if (!userId) {
    res.status(400).json({ message: "userId is required" });
    return;
  }

  req.userId = userId;
  req.isInternalLiquidation = true;
  next();
};
