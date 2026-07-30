import { Decimal } from "@repo/types";
import type { Order, UserBalance, UserPosition } from "../domain/types.js";
import { Orderbook } from "../domain/Orderbook.js";

export interface EngineLike {
  orderbook: Orderbook | null;
  userBalance: Map<string, UserBalance>;
  userPosition: Map<string, UserPosition>;
  lastSeq: bigint;
  processOrder: (o: Order) => Promise<void>;
  dispatchCommand: (data: unknown) => Promise<void>;
  requiredLock: (userId: string) => Decimal;
  createOrder: (
    id: string,
    userId: string,
    entryPrice: string,
    quantity: string,
    side: Order["side"],
    leverage: number,
  ) => Promise<void>;
  createMarketOrder: (
    id: string,
    userId: string,
    quantity: string,
    side: Order["side"],
    leverage: number,
  ) => Promise<void>;
  applyFunding: (fundingRate: string, markPrice: string, settlementSeq?: string) => void;
}

export function seedUsers(engine: EngineLike, users: string[], available: number): void {
  for (const userId of users) {
    engine.userBalance.set(userId, {
      availableBalance: new Decimal(available),
      lockedBalance: new Decimal(0),
    });
    engine.userPosition.set(userId, {
      side: "UNINITIALIZED",
      quantity: new Decimal(0),
      entryPrice: new Decimal(0),
      margin: new Decimal(0),
      unrealizedPnl: new Decimal(0),
      market: "BTCUSDT",
      leverage: 1,
    });
  }
}

export function assertSolvent(engine: EngineLike, users: string[]): void {
  for (const userId of users) {
    const balance = engine.userBalance.get(userId);
    if (!balance) continue;
    const required = engine.requiredLock(userId);
    if (!balance.lockedBalance.equals(required)) {
      throw new Error(
        `${userId}: locked ${balance.lockedBalance.toFixed(8)} != required ${required.toFixed(8)}`,
      );
    }
    if (balance.lockedBalance.isNegative()) {
      throw new Error(`${userId}: negative locked balance ${balance.lockedBalance.toFixed(8)}`);
    }
    if (balance.availableBalance.isNegative()) {
      throw new Error(
        `${userId}: negative available balance ${balance.availableBalance.toFixed(8)}`,
      );
    }
  }
}

export function totalCollateral(engine: EngineLike): Decimal {
  let total = new Decimal(0);
  for (const b of engine.userBalance.values()) {
    total = total.plus(b.availableBalance).plus(b.lockedBalance);
  }
  return total;
}

export function lockedOf(engine: EngineLike, userId: string): Decimal {
  return engine.userBalance.get(userId)?.lockedBalance ?? new Decimal(0);
}

export function openInterest(engine: EngineLike): { long: Decimal; short: Decimal } {
  let long = new Decimal(0);
  let short = new Decimal(0);
  for (const position of engine.userPosition.values()) {
    if (position.side === "LONG") long = long.plus(position.quantity);
    else if (position.side === "SHORT") short = short.plus(position.quantity);
  }
  return { long, short };
}

export function totalEquity(engine: EngineLike, markPrice: Decimal): Decimal {
  let total = totalCollateral(engine);
  for (const position of engine.userPosition.values()) {
    if (position.side === "UNINITIALIZED") continue;
    const pnl =
      position.side === "LONG"
        ? markPrice.minus(position.entryPrice).times(position.quantity)
        : position.entryPrice.minus(markPrice).times(position.quantity);
    total = total.plus(pnl);
  }
  return total;
}

export function engineDigest(engine: EngineLike): string {
  const balances = [...engine.userBalance.entries()]
    .map(([u, b]) => `${u}:${b.availableBalance.toString()}:${b.lockedBalance.toString()}`)
    .sort();
  const positions = [...engine.userPosition.entries()]
    .map(
      ([u, p]) =>
        `${u}:${p.side}:${p.quantity.toString()}:${p.entryPrice.toString()}:${p.margin.toString()}`,
    )
    .sort();
  const bids = (engine.orderbook?.bids ?? []).map((o) => `${o.id}:${o.filled}/${o.quantity}@${o.entryPrice}`).sort();
  const asks = (engine.orderbook?.asks ?? []).map((o) => `${o.id}:${o.filled}/${o.quantity}@${o.entryPrice}`).sort();
  return JSON.stringify({ balances, positions, bids, asks, lastSeq: engine.lastSeq.toString() });
}

export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenOptions {
  users: string[];
  count: number;
  minPrice?: number;
  maxPrice?: number;
  maxQty?: number;
  leverages?: number[];
  cancelRate?: number;
}

export function randomLimitCommands(rng: () => number, opts: GenOptions): Order[] {
  const { users, count } = opts;
  const minPrice = opts.minPrice ?? 90;
  const maxPrice = opts.maxPrice ?? 110;
  const maxQty = opts.maxQty ?? 5;
  const leverages = opts.leverages ?? [1];
  const cancelRate = opts.cancelRate ?? 0;

  const cmds: Order[] = [];
  const created: Order[] = [];

  for (let i = 0; i < count; i++) {
    if (created.length > 0 && rng() < cancelRate) {
      const victim = created[Math.floor(rng() * created.length)]!;
      cmds.push({
        ...victim,
        type: "LIMIT-CANCEL",
        seq: String(i + 1),
        filled: "0",
      });
      continue;
    }

    const side = rng() < 0.5 ? "LONG" : "SHORT";
    const price = Math.round(minPrice + rng() * (maxPrice - minPrice));
    const quantity = 1 + Math.floor(rng() * maxQty);
    const userId = users[Math.floor(rng() * users.length)]!;
    const leverage = leverages[Math.floor(rng() * leverages.length)]!;
    const order: Order = {
      id: `o${i}`,
      type: "LIMIT-CREATE",
      seq: String(i + 1),
      userId,
      side,
      entryPrice: String(price),
      quantity: String(quantity),
      leverage,
      filled: "0",
    };
    cmds.push(order);
    created.push(order);
  }
  return cmds;
}
