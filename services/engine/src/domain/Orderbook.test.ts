import { describe, expect, test } from "bun:test";
import { Orderbook } from "./Orderbook.js";
import type { Order } from "./types.js";

const order = (o: Partial<Order> & Pick<Order, "id" | "userId" | "side" | "entryPrice" | "quantity">): Order => ({
  leverage: 1,
  filled: 0,
  ...o,
});

describe("Orderbook matching", () => {
  test("a crossing bid fully fills against a resting ask at the ask price", () => {
    const book = new Orderbook([], [order({ id: "a1", userId: "maker", side: "SHORT", entryPrice: 100, quantity: 5 })]);

    const res = book.addOrder(order({ id: "b1", userId: "taker", side: "LONG", entryPrice: 100, quantity: 5 }));

    expect(res.executedQty).toBe(5);
    expect(res.fills).toHaveLength(1);
    expect(res.fills[0]!.price).toBe(100);
    expect(res.fills[0]!.otherUserId).toBe("maker");
    expect(book.asks).toHaveLength(0);
    expect(book.bids).toHaveLength(0);
  });

  test("price priority: the cheaper ask is matched first", () => {
    const book = new Orderbook(
      [],
      [
        order({ id: "a1", userId: "m1", side: "SHORT", entryPrice: 102, quantity: 5 }),
        order({ id: "a2", userId: "m2", side: "SHORT", entryPrice: 100, quantity: 5 }),
      ],
    );

    const res = book.addOrder(order({ id: "b1", userId: "taker", side: "LONG", entryPrice: 105, quantity: 5 }));

    expect(res.executedQty).toBe(5);
    expect(res.fills[0]!.price).toBe(100);
    expect(book.asks).toHaveLength(1);
    expect(book.asks[0]!.entryPrice).toBe(102);
  });

  test("partial fill: remainder rests with filled set", () => {
    const book = new Orderbook([], [order({ id: "a1", userId: "maker", side: "SHORT", entryPrice: 100, quantity: 3 })]);

    const res = book.addOrder(order({ id: "b1", userId: "taker", side: "LONG", entryPrice: 100, quantity: 10 }));

    expect(res.executedQty).toBe(3);
    expect(book.bids).toHaveLength(1);
    expect(book.bids[0]!.filled).toBe(3);
    expect(book.bids[0]!.quantity).toBe(10);
  });

  test("self-trade prevention: a user does not match their own resting order", () => {
    const book = new Orderbook([], [order({ id: "a1", userId: "same", side: "SHORT", entryPrice: 100, quantity: 5 })]);

    const res = book.addOrder(order({ id: "b1", userId: "same", side: "LONG", entryPrice: 100, quantity: 5 }));

    expect(res.executedQty).toBe(0);
    expect(res.fills).toHaveLength(0);
    expect(book.asks).toHaveLength(1);
    expect(book.bids).toHaveLength(1);
  });

  test("a partially-filled resting maker is never over-filled (uses remaining size)", () => {
    const book = new Orderbook([], []);

    book.addOrder(order({ id: "a1", userId: "mk", side: "SHORT", entryPrice: 100, quantity: 4 }));
    book.addOrder(order({ id: "b1", userId: "tk", side: "LONG", entryPrice: 100, quantity: 10 }));
    expect(book.bids[0]!.filled).toBe(4);


    const res = book.addOrder(order({ id: "a2", userId: "tk2", side: "SHORT", entryPrice: 100, quantity: 10 }));
    expect(res.executedQty).toBe(6);
    expect(res.fills[0]!.quantity).toBe(6);
    expect(book.bids).toHaveLength(0);
    expect(book.asks).toHaveLength(1);
    expect(book.asks[0]!.filled).toBe(6);
  });

  test("a non-crossing bid simply rests, no fills", () => {
    const book = new Orderbook([], [order({ id: "a1", userId: "maker", side: "SHORT", entryPrice: 101, quantity: 5 })]);

    const res = book.addOrder(order({ id: "b1", userId: "taker", side: "LONG", entryPrice: 100, quantity: 5 }));

    expect(res.executedQty).toBe(0);
    expect(book.bids).toHaveLength(1);
    expect(book.asks).toHaveLength(1);
  });
});

describe("Orderbook depth & helpers", () => {
  test("depth advertises only remaining (unfilled) size", () => {
    const book = new Orderbook([], [order({ id: "a1", userId: "maker", side: "SHORT", entryPrice: 100, quantity: 10, filled: 4 })]);

    const depth = book.getMarketDepth();
    expect(depth.asks).toEqual([["100", "6"]]);
  });

  test("getBestOppositePrice returns the price level that covers the quantity", () => {
    const book = new Orderbook(
      [],
      [
        order({ id: "a1", userId: "m1", side: "SHORT", entryPrice: 100, quantity: 2 }),
        order({ id: "a2", userId: "m2", side: "SHORT", entryPrice: 101, quantity: 5 }),
      ],
    );

    expect(book.getBestOppositePrice("LONG", 2)).toBe(100);
    expect(book.getBestOppositePrice("LONG", 5)).toBe(101);
    expect(book.getBestOppositePrice("LONG", 100)).toBe(101);
    expect(new Orderbook([], []).getBestOppositePrice("LONG", 1)).toBeUndefined();
  });

  test("a market order (allowResting=false) never leaves a resting remainder", () => {
    const book = new Orderbook([], [order({ id: "a1", userId: "mk", side: "SHORT", entryPrice: 100, quantity: 4 })]);


    const res = book.addOrder(order({ id: "t1", userId: "tk", side: "LONG", entryPrice: 100, quantity: 10 }), false);

    expect(res.executedQty).toBe(4);
    expect(book.bids).toHaveLength(0);
    expect(book.asks).toHaveLength(0);
  });

  test("cancelOrder removes the resting order for its owner", () => {
    const book = new Orderbook([order({ id: "b1", userId: "u", side: "LONG", entryPrice: 99, quantity: 5 })], []);

    book.cancelOrder("b1", "u");
    expect(book.bids).toHaveLength(0);
  });
});
