import type { Request, Response } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@repo/db";
import { registerSchema, loginSchema } from "@repo/types";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN,
  REFRESH_COOKIE_MAX_AGE_MS,
  LOGIN_MAX_FAILURES,
  LOGIN_LOCKOUT_MS,
} from "../config/env.js";

const signToken = (userId: string): string =>
  jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

const signRefreshToken = (userId: string): string =>
  jwt.sign({ userId }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

const hashRefreshToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: REFRESH_COOKIE_MAX_AGE_MS,
};

const safeHexEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
};

const issueSession = async (userId: string, res: Response): Promise<string> => {
  const token = signToken(userId);
  const refreshToken = signRefreshToken(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: hashRefreshToken(refreshToken) },
  });
  res.cookie("refreshToken", refreshToken, refreshCookieOptions);
  return token;
};

interface FailureRecord {
  count: number;
  until: number;
}
const loginFailures = new Map<string, FailureRecord>();

const lockoutKey = (email: string, ip: string): string => `${email}::${ip}`;

const isLockedOut = (key: string): boolean => {
  const record = loginFailures.get(key);
  if (!record) return false;
  if (record.until <= Date.now()) {
    loginFailures.delete(key);
    return false;
  }
  return record.count >= LOGIN_MAX_FAILURES;
};

const recordFailure = (key: string): void => {
  const now = Date.now();
  const record = loginFailures.get(key);
  if (!record || record.until <= now) {
    loginFailures.set(key, { count: 1, until: now + LOGIN_LOCKOUT_MS });
    return;
  }
  record.count += 1;
  record.until = now + LOGIN_LOCKOUT_MS;
};

const clearFailures = (key: string): void => {
  loginFailures.delete(key);
};

const requestIp = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = header?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
};

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of loginFailures) {
    if (record.until <= now) loginFailures.delete(key);
  }
}, LOGIN_LOCKOUT_MS).unref();

export const register = async (
  req: Request,
  res: Response
) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  const { username, email, password } = parsed.data;

  try {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existing) {
      res.status(409).json({ message: "Username or email already taken" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        balance: {
          create: { availableMargin: 0, lockedMargin: 0 },
        },
      },
    });

    const token = await issueSession(user.id, res);
    res.status(201).json({ token });
  } catch {
    res.status(500).json({ message: "Internal server error" });
  }
}

export const login = async (
  req: Request,
  res: Response
) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  const { email, password } = parsed.data;
  const key = lockoutKey(email, requestIp(req));

  if (isLockedOut(key)) {
    res.status(429).json({
      message: "Too many failed login attempts. Try again later.",
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      recordFailure(key);
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      recordFailure(key);
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    clearFailures(key);
    const token = await issueSession(user.id, res);
    res.status(200).json({ token });
  } catch {
    res.status(500).json({ message: "Internal server error" });
  }
}

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const presented = (req.cookies as { refreshToken?: string } | undefined)
    ?.refreshToken;
  if (!presented) {
    res.status(401).json({ message: "Missing refresh token" });
    return;
  }

  let userId: string;
  try {
    const decoded = jwt.verify(presented, JWT_REFRESH_SECRET) as {
      userId: string;
    };
    userId = decoded.userId;
  } catch {
    res.status(401).json({ message: "Invalid or expired refresh token" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      !user.refreshToken ||
      !safeHexEqual(user.refreshToken, hashRefreshToken(presented))
    ) {
      res.status(401).json({ message: "Invalid or expired refresh token" });
      return;
    }

    const token = await issueSession(userId, res);
    res.status(200).json({ token });
  } catch {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    res.clearCookie("refreshToken", refreshCookieOptions);
    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch {
    res.status(500).json({ success: false, message: "Logout failed" });
  }
}
