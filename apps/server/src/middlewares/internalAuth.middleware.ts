import type { Response, NextFunction } from "express";
import { INTERNAL_SERVICE_KEY } from "../config/env.js";
import type { AuthRequest } from "./auth.middleware.js";

export interface InternalAuthRequest extends AuthRequest {
  isInternalLiquidation?: boolean;
}

export const internalAuthMiddleware = (
  req: InternalAuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const key = req.headers["x-internal-key"];

  if (key !== INTERNAL_SERVICE_KEY) {
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
