import { describe, expect, test } from "bun:test";
import { Decimal } from "@repo/types";
import {
  computeLiquidationPrice,
  maintenanceMarginRateFromBps,
  DEFAULT_MAINTENANCE_MARGIN_RATE,
} from "./risk.js";

const d = (n: number | string) => new Decimal(n);
const MMR = new Decimal("0.05");

const position = (
  side: "LONG" | "SHORT" | "UNINITIALIZED",
  quantity: number | string,
  entryPrice: number | string,
  margin: number | string,
) => ({ side, quantity: d(quantity), entryPrice: d(entryPrice), margin: d(margin) });

describe("maintenanceMarginRateFromBps", () => {
  test("converts basis points to a rate", () => {
    expect(maintenanceMarginRateFromBps(500n).equals(d("0.05"))).toBe(true);
    expect(maintenanceMarginRateFromBps(50n).equals(d("0.005"))).toBe(true);
    expect(maintenanceMarginRateFromBps(10_000n).equals(d(1))).toBe(true);
  });

  test("the seeded 500 bps reproduces the rate liquidation used to hardcode", () => {
    expect(maintenanceMarginRateFromBps(500n).equals(DEFAULT_MAINTENANCE_MARGIN_RATE)).toBe(true);
  });
});

describe("computeLiquidationPrice", () => {
  test("a LONG liquidates below entry", () => {
    const price = computeLiquidationPrice(position("LONG", 1, 100, 10), MMR);
    expect(price.equals(d(95))).toBe(true);
  });

  test("a SHORT liquidates above entry", () => {
    const price = computeLiquidationPrice(position("SHORT", 1, 100, 10), MMR);
    expect(price.equals(d(105))).toBe(true);
  });

  test("higher leverage (less margin) liquidates closer to entry", () => {
    const low = computeLiquidationPrice(position("LONG", 1, 100, 20), MMR); // 5x
    const high = computeLiquidationPrice(position("LONG", 1, 100, 4), MMR); // 25x
    expect(low.equals(d(85))).toBe(true);
    expect(high.equals(d(101))).toBe(true);
    expect(high.greaterThan(low)).toBe(true);
  });

  test("scales with quantity — the price is per-unit, not per-position", () => {
    const one = computeLiquidationPrice(position("LONG", 1, 100, 10), MMR);
    const ten = computeLiquidationPrice(position("LONG", 10, 100, 100), MMR);
    expect(ten.equals(one)).toBe(true);
  });

  test("a higher maintenance rate liquidates earlier", () => {
    const lenient = computeLiquidationPrice(position("LONG", 1, 100, 10), d("0.01"));
    const strict = computeLiquidationPrice(position("LONG", 1, 100, 10), d("0.10"));
    expect(lenient.equals(d(91))).toBe(true);
    expect(strict.equals(d(100))).toBe(true);
    expect(strict.greaterThan(lenient)).toBe(true);
  });

  test("a flat position has no liquidation price", () => {
    expect(computeLiquidationPrice(position("UNINITIALIZED", 0, 0, 0), MMR).isZero()).toBe(true);
  });

  test("zero quantity does not divide by zero", () => {
    expect(computeLiquidationPrice(position("LONG", 0, 100, 10), MMR).isZero()).toBe(true);
  });

  test("an over-margined LONG clamps at zero rather than going negative", () => {
    const price = computeLiquidationPrice(position("LONG", 1, 100, 500), MMR);
    expect(price.isZero()).toBe(true);
  });

  test("stays exact — no float drift on awkward values", () => {
    const price = computeLiquidationPrice(position("LONG", "0.30000003", "0.1", "0.003"), MMR);
    expect(price.toFixed(8)).toBe("0.09500000");
  });

  test("margin lost to funding moves the liquidation price toward the mark", () => {
    const before = computeLiquidationPrice(position("LONG", 1, 100, 10), MMR);
    const after = computeLiquidationPrice(position("LONG", 1, 100, 6), MMR);
    expect(before.equals(d(95))).toBe(true);
    expect(after.equals(d(99))).toBe(true);
  });
});
