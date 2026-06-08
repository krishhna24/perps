import { describe, expect, test } from "bun:test";
import { Decimal } from "@repo/types";
import { computeLiquidationQty, type Position } from "./computeLiquidationQty.js";


const pos = (
  p: Pick<Position, "side" | "quantity" | "entryPrice" | "margin"> & { leverage?: number },
): Position => ({
  userId: "u1",
  unrealizedPnl: "0",
  liquidatedPrice: "0",
  market: "BTCUSDT",
  ...p,
});

const mark = (n: string) => new Decimal(n);

describe("computeLiquidationQty", () => {
  test("healthy LONG (equity >= maintenance) → null", () => {

    const result = computeLiquidationQty(
      pos({ side: "LONG", quantity: "10", entryPrice: "100", margin: "60", leverage: 10 }),
      mark("100"),
    );
    expect(result).toBeNull();
  });

  test("healthy SHORT (equity >= maintenance) → null", () => {
    const result = computeLiquidationQty(
      pos({ side: "SHORT", quantity: "10", entryPrice: "100", margin: "60", leverage: 10 }),
      mark("100"),
    );
    expect(result).toBeNull();
  });

  test("bankrupt LONG (equity <= 0) → full close", () => {

    const result = computeLiquidationQty(
      pos({ side: "LONG", quantity: "10", entryPrice: "100", margin: "60", leverage: 10 }),
      mark("90"),
    );
    expect(result?.toNumber()).toBe(10);
  });

  test("bankrupt SHORT (equity <= 0) → full close", () => {

    const result = computeLiquidationQty(
      pos({ side: "SHORT", quantity: "10", entryPrice: "100", margin: "60", leverage: 10 }),
      mark("110"),
    );
    expect(result?.toNumber()).toBe(10);
  });

  test("interior partial LONG (0 < qty < quantity)", () => {


    const result = computeLiquidationQty(
      pos({ side: "LONG", quantity: "10", entryPrice: "100", margin: "130", leverage: 10 }),
      mark("90"),
    );
    expect(result?.toNumber()).toBe(4);
    expect(result!.greaterThan(0)).toBe(true);
    expect(result!.lessThan(10)).toBe(true);
  });

  test("interior partial SHORT (0 < qty < quantity)", () => {


    const result = computeLiquidationQty(
      pos({ side: "SHORT", quantity: "10", entryPrice: "100", margin: "130", leverage: 10 }),
      mark("110"),
    );
    expect(result?.toNumber()).toBe(4);
    expect(result!.greaterThan(0)).toBe(true);
    expect(result!.lessThan(10)).toBe(true);
  });

  test("degenerate denominator (<= 0) → full close", () => {


    const result = computeLiquidationQty(
      pos({ side: "LONG", quantity: "10", entryPrice: "100", margin: "60", leverage: 10 }),
      mark("96"),
    );
    expect(result?.toNumber()).toBe(10);
  });

  test("missing leverage → safe full close (would otherwise be a partial)", () => {


    const result = computeLiquidationQty(
      pos({ side: "LONG", quantity: "10", entryPrice: "100", margin: "130" }),
      mark("90"),
    );
    expect(result?.toNumber()).toBe(10);
  });

  test("non-positive leverage → safe full close", () => {
    const result = computeLiquidationQty(
      pos({ side: "LONG", quantity: "10", entryPrice: "100", margin: "130", leverage: 0 }),
      mark("90"),
    );
    expect(result?.toNumber()).toBe(10);
  });

  test("R5 regression: analysis worked example → full close, not 2 of 10", () => {




    const result = computeLiquidationQty(
      pos({ side: "LONG", quantity: "10", entryPrice: "100", margin: "60", leverage: 10 }),
      mark("95"),
    );
    expect(result?.toNumber()).toBe(10);
  });

  test("computed qty >= quantity clamps to full", () => {


    const result = computeLiquidationQty(
      pos({ side: "LONG", quantity: "10", entryPrice: "100", margin: "70", leverage: 10 }),
      mark("94"),
    );
    expect(result?.toNumber()).toBe(10);
  });
});
