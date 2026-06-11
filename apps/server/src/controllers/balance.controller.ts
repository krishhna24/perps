import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import { depositSchema, withdrawSchema } from "@repo/types";
import { prisma } from "@repo/db";
import { addBalanceToQueue } from "@repo/queue";

export const getBalance = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.userId!;
    const balance = await prisma.balance.findUnique({ where: { userId } });

    if (!balance) {
      res.status(404).json({ message: "Balance not found" });
      return;
    }

    res.status(200).json({
      userId,
      availableMargin: balance.availableMargin.toString(),
      lockedMargin: balance.lockedMargin.toString(),
    });
  } catch (error) {
    console.error("getBalance failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


export const deposit = async (
  req: AuthRequest,
  res: Response
) => {
  const parsed = depositSchema.safeParse(req.body);
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
  try {
    const userId = req.userId!;
    const { amount } = parsed.data;

    const entry = await prisma.ledgerEntry.create({
      data: { userId, type: "DEPOSIT", amount },
    });
    await addBalanceToQueue(entry);

    res.status(202).json({
      message: "Deposit accepted",
      ledgerId: entry.id,
    });
  } catch (error) {
    console.error("deposit failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export const withdraw = async (
  req: AuthRequest,
  res: Response
) => {
  const parsed = withdrawSchema.safeParse(req.body);
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
  try {
    const userId = req.userId!;
    const { amount } = parsed.data;

    const entry = await prisma.ledgerEntry.create({
      data: { userId, type: "WITHDRAW", amount },
    });
    await addBalanceToQueue(entry);

    res.status(202).json({
      message: "Withdrawal accepted",
      ledgerId: entry.id,
    });
  } catch (error) {
    console.error("withdraw failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
