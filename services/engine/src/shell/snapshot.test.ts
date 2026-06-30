import { describe, expect, test } from "bun:test";
import { Decimal } from "@repo/types";
import {
  serializeSnapshot,
  deserializeBalances,
  deserializePositions,
} from "./snapshot.js";
import type { OrderbookSnapshot, UserBalance, UserPosition } from "../domain/types.js";

const EMPTY_BOOK: OrderbookSnapshot = { bids: [], asks: [], market: "BTCUSDT" };

describe("engine snapshot round-trip (S3 recovery)", () => {
  test("balances and positions survive serialize → deserialize as exact Decimals", () => {
    const balances = new Map<string, UserBalance>([
      [
        "u1",
        { availableBalance: new Decimal("1000.12345678"), lockedBalance: new Decimal("0.00000001") },
      ],
    ]);
    const positions = new Map<string, UserPosition>([
      [
        "u1",
        {
          side: "LONG",
          quantity: new Decimal("5.5"),
          entryPrice: new Decimal("100.25"),
          margin: new Decimal("551.375"),
          unrealizedPnl: new Decimal("0"),
          liquidatedPrice: new Decimal("90.1"),
          market: "BTCUSDT",
          leverage: 10,
        },
      ],
    ]);

    const snap = serializeSnapshot(EMPTY_BOOK, balances, positions, 42n, 17n);


    expect(typeof snap.userBalance[0]![1].availableBalance).toBe("string");
    expect(typeof snap.userPosition[0]![1].quantity).toBe("string");
    expect(snap.lastSeq).toBe("42");
    expect(snap.lastFundingSeq).toBe("17");

    const b = deserializeBalances(snap.userBalance);
    const p = deserializePositions(snap.userPosition);

    expect(b.get("u1")!.availableBalance.equals(new Decimal("1000.12345678"))).toBe(true);
    expect(b.get("u1")!.lockedBalance.equals(new Decimal("0.00000001"))).toBe(true);
    expect(p.get("u1")!.quantity.equals(new Decimal("5.5"))).toBe(true);
    expect(p.get("u1")!.entryPrice.equals(new Decimal("100.25"))).toBe(true);
    expect(p.get("u1")!.side).toBe("LONG");
    expect(p.get("u1")!.leverage).toBe(10);
  });

  test("JSON round-trip (the actual S3 storage path) preserves exact high-precision values", () => {
    const balances = new Map<string, UserBalance>([
      ["u1", { availableBalance: new Decimal("999999999999.99999999"), lockedBalance: new Decimal("0") }],
    ]);

    const snap = serializeSnapshot(EMPTY_BOOK, balances, new Map(), 7n, 1n);
    const roundTripped = JSON.parse(JSON.stringify(snap)) as typeof snap;

    const b = deserializeBalances(roundTripped.userBalance);
    expect(b.get("u1")!.availableBalance.toFixed(8)).toBe("999999999999.99999999");
    expect(BigInt(roundTripped.lastSeq)).toBe(7n);
    expect(BigInt(roundTripped.lastFundingSeq!)).toBe(1n);
  });

  test("UNINITIALIZED (flat) positions round-trip without becoming a direction", () => {
    const positions = new Map<string, UserPosition>([
      [
        "flat",
        {
          side: "UNINITIALIZED",
          quantity: new Decimal("0"),
          entryPrice: new Decimal("0"),
          margin: new Decimal("0"),
          unrealizedPnl: new Decimal("0"),
          liquidatedPrice: new Decimal("0"),
          market: "BTCUSDT",
          leverage: 1,
        },
      ],
    ]);

    const snap = serializeSnapshot(EMPTY_BOOK, new Map(), positions, 0n, 0n);
    const p = deserializePositions(snap.userPosition);
    expect(p.get("flat")!.side).toBe("UNINITIALIZED");
    expect(p.get("flat")!.quantity.isZero()).toBe(true);
  });
});
