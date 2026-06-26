import type { Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { JWT_SECRET, WS_TICKET_TTL_S } from "../config/env.js";

export const getWsTicket = (req: AuthRequest, res: Response): void => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const ticket = jwt.sign({ userId, ws: true }, JWT_SECRET, {
    expiresIn: WS_TICKET_TTL_S,
  });
  res.status(200).json({ ticket });
};
