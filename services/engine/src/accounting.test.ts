import { describe, expect, test, mock } from "bun:test";
import { Decimal } from "@repo/types";
import { Orderbook } from "./domain/Orderbook.js";
import {
  assertSolvent,
  seedUsers,
  totalCollateral,
  type EngineLike,
} from "./test/harness.js";

mock.module("@repo/pubsub", () => ({
  RedisManager: {
    getInstance: () => ({ publish: () => {}, publishToChannel: () => {} }),
  },
}));
mock.module("@repo/queue", () => ({
  eventQueue: { add: () => Promise.resolve() },
  getCompletedCommands: () => Promise.resolve([]),
  Worker: class {},
}));
mock.module("@repo/db", () => ({
  prisma: {
    balance: {
      findUnique: async () => ({
        availableMargin: { toString: () => "0" },
        lockedMargin: { toString: () => "0" },
      }),
    },
  },
}));

process.env["REDIS_HOST"] = "localhost";
process.env["REDIS_PORT"] = "6379";

const { Engine } = await import("./Engine.js");

function freshEngine(): EngineLike {
  (Engine as unknown as { instance: unknown }).instance = null;
  const engine = Engine.getInstance() as unknown as EngineLike;
  engine.orderbook = new Orderbook([], []);
  return engine;
}

describe("locked margin is derived, not accumulated", () => {
  test("a position built at two leverages releases every unit of margin on close", async () => {
    const users = ["taker", "m1", "m2", "m3"];
    const engine = freshEngine();
    seedUsers(engine, users, 100_000);
    const start = totalCollateral(engine);

    await engine.createOrder("a1", "m1", "100", "1", "SHORT", 1);
    await engine.createOrder("b1", "taker", "100", "1", "LONG", 1);
    await engine.createOrder("a2", "m2", "100", "1", "SHORT", 1);
    await engine.createOrder("b2", "taker", "100", "1", "LONG", 10);

    expect(engine.userBalance.get("taker")!.lockedBalance.toFixed(8)).toBe("110.00000000");

    await engine.createOrder("a3", "m3", "100", "2", "LONG", 1);
    await engine.createOrder("b3", "taker", "100", "2", "SHORT", 10);

    const taker = engine.userBalance.get("taker")!;
    expect(taker.lockedBalance.toFixed(8)).toBe("0.00000000");
    expect(taker.availableBalance.toFixed(8)).toBe("100000.00000000");
    expect(totalCollateral(engine).toFixed(8)).toBe(start.toFixed(8));
    assertSolvent(engine, users);
  });

  test("cancelling an order whose position flipped underneath it refunds the lock", async () => {
    const users = ["u", "mk"];
    const engine = freshEngine();
    seedUsers(engine, users, 100_000);

    await engine.createOrder("o1", "u", "100", "1", "LONG", 1);
    expect(engine.userBalance.get("u")!.lockedBalance.toFixed(8)).toBe("100.00000000");

    await engine.createOrder("mk1", "mk", "90", "1", "LONG", 1);
    await engine.createOrder("o2", "u", "90", "1", "SHORT", 1);

    expect(engine.userBalance.get("u")!.lockedBalance.toFixed(8)).toBe("90.00000000");

    await engine.processOrder({
      id: "o1",
      type: "LIMIT-CANCEL",
      userId: "u",
      side: "LONG",
      entryPrice: "100",
      quantity: "1",
      leverage: 1,
      filled: "0",
    });

    expect(engine.userBalance.get("u")!.lockedBalance.toFixed(8)).toBe("90.00000000");
    assertSolvent(engine, users);
  });

  test("a cancel carrying a stale `filled` cannot release a live position's margin", async () => {
    const users = ["u", "mk"];
    const engine = freshEngine();
    seedUsers(engine, users, 100_000);

    await engine.createOrder("o1", "u", "100", "10", "LONG", 1);
    await engine.createOrder("mk1", "mk", "100", "5", "SHORT", 1);
    expect(engine.userBalance.get("u")!.lockedBalance.toFixed(8)).toBe("1000.00000000");

    await engine.processOrder({
      id: "o1",
      type: "LIMIT-CANCEL",
      userId: "u",
      side: "LONG",
      entryPrice: "100",
      quantity: "10",
      leverage: 1,
      filled: "0",
    });

    const u = engine.userBalance.get("u")!;
    expect(u.lockedBalance.toFixed(8)).toBe("500.00000000");
    expect(engine.userPosition.get("u")!.quantity.toFixed(8)).toBe("5.00000000");
    assertSolvent(engine, users);
  });

  test("a cancel for an order that is not resting is a no-op", async () => {
    const users = ["u", "mk"];
    const engine = freshEngine();
    seedUsers(engine, users, 100_000);

    await engine.createOrder("o1", "u", "100", "5", "LONG", 1);
    await engine.createOrder("mk1", "mk", "100", "5", "SHORT", 1);
    const lockedAfterFill = engine.userBalance.get("u")!.lockedBalance.toFixed(8);

    await engine.processOrder({
      id: "o1",
      type: "LIMIT-CANCEL",
      userId: "u",
      side: "LONG",
      entryPrice: "100",
      quantity: "5",
      leverage: 1,
      filled: "0",
    });

    expect(engine.userBalance.get("u")!.lockedBalance.toFixed(8)).toBe(lockedAfterFill);
    assertSolvent(engine, users);
  });

  test("two opposite resting orders cannot both claim the same position offset", async () => {
    const users = ["u", "mk"];
    const engine = freshEngine();
    seedUsers(engine, users, 100_000);

    await engine.createOrder("mk1", "mk", "100", "1", "SHORT", 1);
    await engine.createOrder("u1", "u", "100", "1", "LONG", 1);

    await engine.createOrder("u2", "u", "120", "1", "SHORT", 1);
    await engine.createOrder("u3", "u", "130", "1", "SHORT", 1);

    expect(engine.userBalance.get("u")!.lockedBalance.toFixed(8)).toBe("230.00000000");
    assertSolvent(engine, users);
  });
});

describe("funding is a conservative transfer", () => {
  test("what longs pay is exactly what shorts receive, on available balance", async () => {
    const users = ["maker", "taker"];
    const engine = freshEngine();
    seedUsers(engine, users, 10_000);
    const start = totalCollateral(engine);

    await engine.createOrder("m1", "maker", "100", "1", "SHORT", 1);
    await engine.createOrder("t1", "taker", "100", "1", "LONG", 1);

    engine.applyFunding("0.01", "100", "1");

    expect(engine.userBalance.get("taker")!.availableBalance.toFixed(8)).toBe("9899.00000000");
    expect(engine.userBalance.get("maker")!.availableBalance.toFixed(8)).toBe("9901.00000000");
    expect(totalCollateral(engine).toFixed(8)).toBe(start.toFixed(8));
    assertSolvent(engine, users);
  });

  test("unwinding after funding leaves no negative locked balance", async () => {
    const users = ["maker", "taker"];
    const engine = freshEngine();
    seedUsers(engine, users, 10_000);
    const start = totalCollateral(engine);

    await engine.createOrder("m1", "maker", "100", "1", "SHORT", 1);
    await engine.createOrder("t1", "taker", "100", "1", "LONG", 1);
    engine.applyFunding("0.01", "100", "1");
    await engine.createOrder("m2", "maker", "100", "1", "LONG", 1);
    await engine.createOrder("t2", "taker", "100", "1", "SHORT", 1);

    expect(engine.userBalance.get("taker")!.availableBalance.toFixed(8)).toBe("9999.00000000");
    expect(engine.userBalance.get("maker")!.availableBalance.toFixed(8)).toBe("10001.00000000");
    expect(totalCollateral(engine).toFixed(8)).toBe(start.toFixed(8));
    assertSolvent(engine, users);
  });

  test("a settlement is skipped when its sequence has already been applied", async () => {
    const users = ["maker", "taker"];
    const engine = freshEngine();
    seedUsers(engine, users, 10_000);

    await engine.createOrder("m1", "maker", "100", "1", "SHORT", 1);
    await engine.createOrder("t1", "taker", "100", "1", "LONG", 1);

    engine.applyFunding("0.01", "100", "7");
    const afterFirst = engine.userBalance.get("taker")!.availableBalance.toFixed(8);
    engine.applyFunding("0.01", "100", "7");

    expect(engine.userBalance.get("taker")!.availableBalance.toFixed(8)).toBe(afterFirst);
  });

  test("a payer who cannot cover funding creates bad debt rather than minting it", async () => {
    const users = ["poor", "rich"];
    const engine = freshEngine();
    seedUsers(engine, users, 0);
    engine.userBalance.get("poor")!.availableBalance = new Decimal(100);
    engine.userBalance.get("rich")!.availableBalance = new Decimal(10_000);
    const start = totalCollateral(engine);

    await engine.createOrder("r1", "rich", "100", "1", "SHORT", 1);
    await engine.createOrder("p1", "poor", "100", "1", "LONG", 1);

    expect(engine.userBalance.get("poor")!.availableBalance.toFixed(8)).toBe("0.00000000");
    engine.applyFunding("0.01", "100", "1");

    expect(engine.userBalance.get("rich")!.availableBalance.toFixed(8)).toBe("9900.00000000");
    expect(totalCollateral(engine).toFixed(8)).toBe(start.toFixed(8));
    assertSolvent(engine, users);
  });
});
