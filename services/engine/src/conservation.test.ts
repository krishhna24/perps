import { describe, expect, test, mock } from "bun:test";
import { Orderbook } from "./domain/Orderbook.js";
import { Decimal } from "@repo/types";
import {
  assertSolvent,
  engineDigest,
  makeRng,
  openInterest,
  randomLimitCommands,
  seedUsers,
  totalCollateral,
  totalEquity,
  type EngineLike,
} from "./test/harness.js";

function assertBooksBalance(engine: EngineLike, users: string[], start: Decimal): void {
  const { long, short } = openInterest(engine);
  expect(long.toFixed(8)).toBe(short.toFixed(8));

  expect(totalEquity(engine, new Decimal(100)).toFixed(8)).toBe(start.toFixed(8));
  expect(totalEquity(engine, new Decimal(137)).toFixed(8)).toBe(start.toFixed(8));

  assertSolvent(engine, users);
}

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

describe("determinism — identical command logs converge to identical state", () => {
  test("two fresh engines fed the same random LIMIT log produce the same digest", async () => {
    const users = ["u1", "u2", "u3", "u4"];
    const log = randomLimitCommands(makeRng(1234), { users, count: 120 });

    const a = freshEngine();
    seedUsers(a, users, 1_000_000);
    for (const cmd of log) await a.processOrder({ ...cmd });
    const digestA = engineDigest(a);

    const b = freshEngine();
    seedUsers(b, users, 1_000_000);
    for (const cmd of log) await b.processOrder({ ...cmd });
    const digestB = engineDigest(b);

    expect(digestB).toBe(digestA);
  });
});

describe("conservation — trading alone neither mints nor burns collateral", () => {
  test("a symmetric open-then-fully-close between two users conserves collateral", async () => {
    const engine = freshEngine();
    seedUsers(engine, ["maker", "taker"], 1000);
    const start = totalCollateral(engine); // 2000

    await engine.createOrder("m1", "maker", "100", "5", "SHORT", 1);
    await engine.createOrder("t1", "taker", "105", "5", "LONG", 1);
    await engine.createOrder("m2", "maker", "110", "5", "LONG", 1);
    await engine.createOrder("t2", "taker", "110", "5", "SHORT", 1);

    expect(totalCollateral(engine).toFixed(8)).toBe(start.toFixed(8));
  });

  describe("[gate] random LIMIT logs conserve collateral exactly", () => {
    for (const seed of [1, 7, 42, 99, 2024]) {
      test(`equity is conserved and books balance (seed ${seed})`, async () => {
        const users = ["a", "b", "c", "d"];
        const engine = freshEngine();
        seedUsers(engine, users, 1_000_000);

        const start = totalEquity(engine, new Decimal(100));
        const log = randomLimitCommands(makeRng(seed), { users, count: 150 });
        for (const cmd of log) await engine.processOrder({ ...cmd });

        assertBooksBalance(engine, users, start);
      });
    }

    for (const seed of [3, 11, 57]) {
      test(`equity is conserved at mixed leverage (seed ${seed})`, async () => {
        const users = ["a", "b", "c", "d"];
        const engine = freshEngine();
        seedUsers(engine, users, 1_000_000);

        const start = totalEquity(engine, new Decimal(100));
        const log = randomLimitCommands(makeRng(seed), {
          users,
          count: 150,
          leverages: [1, 2, 5, 10],
        });
        for (const cmd of log) await engine.processOrder({ ...cmd });

        assertBooksBalance(engine, users, start);
      });
    }

    for (const seed of [5, 23, 77]) {
      test(`interleaved cancels conserve collateral (seed ${seed})`, async () => {
        const users = ["a", "b", "c", "d"];
        const engine = freshEngine();
        seedUsers(engine, users, 1_000_000);

        const start = totalEquity(engine, new Decimal(100));
        const log = randomLimitCommands(makeRng(seed), {
          users,
          count: 150,
          leverages: [1, 3, 10],
          cancelRate: 0.3,
        });
        for (const cmd of log) await engine.processOrder({ ...cmd });

        assertBooksBalance(engine, users, start);
      });
    }
  });
});
