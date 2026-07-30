import { describe, expect, mock, test } from "bun:test";
import { Decimal } from "@repo/types";
import { Orderbook } from "./domain/Orderbook.js";
import type { Order, UserBalance, UserPosition } from "./domain/types.js";

const d = (n: number) => new Decimal(n);

const published: { channel: string; message: unknown }[] = [];
const events: { name: string; data: { type?: string; data?: Record<string, unknown> } }[] = [];

mock.module("@repo/pubsub", () => ({
  RedisManager: {
    getInstance: () => ({
      publish: (channel: string, message: unknown) => published.push({ channel, message }),
      publishToChannel: (channel: string, message: unknown) => published.push({ channel, message }),
    }),
  },
}));

interface OutboxRow {
  seq: bigint;
  commandId: string;
  marketId: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
}

let outboxRows: OutboxRow[] = [];

mock.module("@repo/queue", () => ({
  eventQueue: {
    add: (name: string, data: unknown) => {
      events.push({ name, data: data as { type?: string } });
      return Promise.resolve();
    },
  },
  Worker: class {
    constructor() {

    }
  },
}));

mock.module("@repo/db", () => ({
  prisma: {
    balance: {

      findUnique: async () => ({
        availableMargin: { toString: () => "1000" },
        lockedMargin: { toString: () => "0" },
      }),
    },
    commandOutbox: {
      findMany: async (args: { where?: { seq?: { gt?: bigint } } }) => {
        const gt = args.where?.seq?.gt ?? 0n;
        return outboxRows
          .filter((r) => r.seq > gt)
          .sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
      },
    },
  },
}));

process.env["REDIS_HOST"] = "localhost";
process.env["REDIS_PORT"] = "6379";

const { Engine } = await import("./Engine.js");

type TestEngine = {
  orderbook: Orderbook | null;
  userBalance: Map<string, UserBalance>;
  userPosition: Map<string, UserPosition>;
  lastSeq: bigint;
  processOrder: (o: Order) => Promise<void>;
  createOrder: (id: string, userId: string, entryPrice: string, quantity: string, side: Order["side"], leverage: number) => Promise<void>;
  createMarketOrder: (id: string, userId: string, quantity: string, side: Order["side"], leverage: number) => Promise<void>;
  applyFunding: (rate: string, mark: string, settlementSeq?: string) => void;
  dispatchCommand: (data: unknown) => Promise<void>;
  loadSnapshot: (snapshot: unknown) => void;
  replayTail: () => Promise<void>;
};

function freshEngine(): TestEngine {
  published.length = 0;
  events.length = 0;
  outboxRows = [];
  (Engine as unknown as { instance: unknown }).instance = null;
  return Engine.getInstance() as unknown as TestEngine;
}

const restingAsk = (id: string, userId: string, price: string, qty: string): Order => ({
  id,
  userId,
  side: "SHORT",
  entryPrice: price,
  quantity: qty,
  leverage: 1,
  filled: "0",
});

function setPosition(
  engine: TestEngine,
  userId: string,
  side: UserPosition["side"],
  quantity: number,
  entryPrice: number,
  margin: number,
): void {
  engine.userPosition.set(userId, {
    side,
    quantity: d(quantity),
    entryPrice: d(entryPrice),
    margin: d(margin),
    unrealizedPnl: d(0),
    market: "BTCUSDT",
    leverage: 1,
  });
}

const updateBalanceEvents = () => events.filter((e) => e.data.type === "BALANCE_UPDATE");
const positionEvents = () => events.filter((e) => e.data.type === "POSITION_UPDATE");

describe("B1 — maker balances are published and persisted, not just the taker's", () => {
  test("closing a maker's position credits and broadcasts the maker's balance", async () => {
    const engine = freshEngine();

    setPosition(engine, "maker", "LONG", 5, 90, 450);
    engine.userBalance.set("maker", { availableBalance: d(1000), lockedBalance: d(450) });
    engine.userBalance.set("taker", { availableBalance: d(1000), lockedBalance: d(0) });
    engine.orderbook = new Orderbook([], [restingAsk("a1", "maker", "100", "5")]);

    await engine.createOrder("t1", "taker", "100", "5", "LONG", 1);

    const balanceChannels = published.filter((p) => p.channel.startsWith("balance@")).map((p) => p.channel);
    expect(balanceChannels).toContain("balance@taker");
    expect(balanceChannels).toContain("balance@maker");

    const persistedUsers = updateBalanceEvents().map((e) => e.data.data!.userId);
    expect(persistedUsers).toContain("taker");
    expect(persistedUsers).toContain("maker");

    const makerEvent = updateBalanceEvents().find((e) => e.data.data!.userId === "maker");
    expect(makerEvent!.data.data!.availableBalance).toBe("1500.00000000");
    expect(makerEvent!.data.data!.lockedBalance).toBe("0.00000000");
  });
});

describe("B3 — a filled market order is persisted with filled = executedQty", () => {
  test("ORDER_UPDATE carries the executed quantity, not 0", async () => {
    const engine = freshEngine();
    setPosition(engine, "maker", "SHORT", 5, 100, 500);
    engine.userBalance.set("maker", { availableBalance: d(1000), lockedBalance: d(500) });
    engine.userBalance.set("taker", { availableBalance: d(1000), lockedBalance: d(0) });
    engine.orderbook = new Orderbook([], [restingAsk("a1", "maker", "100", "5")]);

    await engine.createMarketOrder("t1", "taker", "5", "LONG", 1);

    const orderUpdate = events.find((e) => e.data.type === "ORDER_UPDATE" && e.data.data!.id === "t1");
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate!.data.data!.filled).toBe("5");
  });
});

describe("B2 — funding is a transfer between longs and shorts", () => {
  test("the long pays and the short receives, settled on available balance", () => {
    const engine = freshEngine();
    setPosition(engine, "long", "LONG", 5, 100, 500);
    setPosition(engine, "short", "SHORT", 5, 100, 500);
    engine.userBalance.set("long", { availableBalance: d(1000), lockedBalance: d(500) });
    engine.userBalance.set("short", { availableBalance: d(1000), lockedBalance: d(500) });

    engine.applyFunding("0.01", "100");

    expect(engine.userBalance.get("long")!.availableBalance.toNumber()).toBe(995);
    expect(engine.userBalance.get("short")!.availableBalance.toNumber()).toBe(1005);

    expect(engine.userPosition.get("long")!.margin.toNumber()).toBe(500);
    expect(engine.userPosition.get("short")!.margin.toNumber()).toBe(500);

    const persistedUsers = updateBalanceEvents().map((e) => e.data.data!.userId);
    expect(persistedUsers).toContain("long");
    expect(persistedUsers).toContain("short");
  });

  test("a negative rate reverses the direction of the transfer", () => {
    const engine = freshEngine();
    setPosition(engine, "long", "LONG", 5, 100, 500);
    setPosition(engine, "short", "SHORT", 5, 100, 500);
    engine.userBalance.set("long", { availableBalance: d(1000), lockedBalance: d(500) });
    engine.userBalance.set("short", { availableBalance: d(1000), lockedBalance: d(500) });

    engine.applyFunding("-0.01", "100");

    expect(engine.userBalance.get("long")!.availableBalance.toNumber()).toBe(1005);
    expect(engine.userBalance.get("short")!.availableBalance.toNumber()).toBe(995);
  });

  test("a redelivered funding settlement (same seq) is not applied twice", () => {
    const engine = freshEngine();
    setPosition(engine, "long", "LONG", 5, 100, 500);
    setPosition(engine, "short", "SHORT", 5, 100, 500);
    engine.userBalance.set("long", { availableBalance: d(1000), lockedBalance: d(500) });
    engine.userBalance.set("short", { availableBalance: d(1000), lockedBalance: d(500) });

    engine.applyFunding("0.01", "100", "1000");
    engine.applyFunding("0.01", "100", "1000");
    expect(engine.userBalance.get("long")!.availableBalance.toNumber()).toBe(995);

    engine.applyFunding("0.01", "100", "1001");
    expect(engine.userBalance.get("long")!.availableBalance.toNumber()).toBe(990);
  });

  test("with no one to receive it, nothing is collected", () => {
    const engine = freshEngine();
    setPosition(engine, "long", "LONG", 5, 100, 500);
    engine.userBalance.set("long", { availableBalance: d(1000), lockedBalance: d(500) });

    engine.applyFunding("0.01", "100", "1");

    expect(engine.userBalance.get("long")!.availableBalance.toNumber()).toBe(1000);
    expect(updateBalanceEvents()).toHaveLength(0);
  });

  test("flat (UNINITIALIZED) positions are skipped", () => {
    const engine = freshEngine();
    setPosition(engine, "flat", "UNINITIALIZED", 0, 0, 0);
    engine.userBalance.set("flat", { availableBalance: d(1000), lockedBalance: d(0) });

    engine.applyFunding("0.01", "100");

    expect(positionEvents()).toHaveLength(0);
    expect(updateBalanceEvents()).toHaveLength(0);
  });
});

describe("F1 — taker entry is the fill VWAP, not the order's limit price", () => {
  test("a price-improved LONG records the maker's fill price and refunds the over-lock", async () => {
    const engine = freshEngine();
    engine.orderbook = new Orderbook([], []);

    await engine.createOrder("m1", "maker", "100", "5", "SHORT", 1);

    await engine.createOrder("t1", "taker", "105", "5", "LONG", 1);

    const takerPos = engine.userPosition.get("taker")!;
    expect(takerPos.entryPrice.toNumber()).toBe(100);
    expect(takerPos.margin.toNumber()).toBe(500);

    const tb = engine.userBalance.get("taker")!;
    expect(tb.availableBalance.toNumber()).toBe(500);
    expect(tb.lockedBalance.toNumber()).toBe(500);

    const mb = engine.userBalance.get("maker")!;
    const total = tb.availableBalance.plus(tb.lockedBalance).plus(mb.availableBalance).plus(mb.lockedBalance);
    expect(total.toNumber()).toBe(2000);
  });

  test("a multi-level market sweep records the VWAP of all fills", async () => {
    const engine = freshEngine();

    engine.orderbook = new Orderbook([], []);
    await engine.createOrder("m1", "m1", "100", "2", "SHORT", 1);
    await engine.createOrder("m2", "m2", "102", "2", "SHORT", 1);

    await engine.createMarketOrder("t1", "taker", "4", "LONG", 1);

    const takerPos = engine.userPosition.get("taker")!;
    expect(takerPos.entryPrice.toNumber()).toBe(101);
  });
});

describe("F2 — close after a price-improved open conserves money (zero-sum)", () => {
  test("two users open and fully close; total collateral is unchanged", async () => {
    const engine = freshEngine();
    engine.orderbook = new Orderbook([], []);

    await engine.createOrder("m1", "maker", "100", "5", "SHORT", 1);
    await engine.createOrder("t1", "taker", "105", "5", "LONG", 1);

    await engine.createOrder("m2", "maker", "110", "5", "LONG", 1);
    await engine.createOrder("t2", "taker", "110", "5", "SHORT", 1);

    const tb = engine.userBalance.get("taker")!;
    const mb = engine.userBalance.get("maker")!;

    expect(tb.availableBalance.toNumber()).toBe(1050);
    expect(mb.availableBalance.toNumber()).toBe(950);
    expect(tb.lockedBalance.toNumber()).toBe(0);
    expect(mb.lockedBalance.toNumber()).toBe(0);

    const total = tb.availableBalance.plus(tb.lockedBalance).plus(mb.availableBalance).plus(mb.lockedBalance);
    expect(total.toNumber()).toBe(2000);
  });
});

describe("F3 — market order fills available depth, never rests, refunds unfilled lock", () => {
  test("a market buy larger than the book closes what it can and leaks no margin", async () => {
    const engine = freshEngine();
    engine.orderbook = new Orderbook([], []);
    engine.userBalance.set("taker", { availableBalance: d(2000), lockedBalance: d(0) });

    await engine.createOrder("m1", "maker", "100", "6", "SHORT", 1);

    await engine.createMarketOrder("t1", "taker", "10", "LONG", 1);

    const pos = engine.userPosition.get("taker")!;
    expect(pos.side).toBe("LONG");
    expect(pos.quantity.toNumber()).toBe(6);
    expect(pos.entryPrice.toNumber()).toBe(100);
    expect(pos.margin.toNumber()).toBe(600);

    const tb = engine.userBalance.get("taker")!;
    expect(tb.lockedBalance.toNumber()).toBe(600);
    expect(tb.availableBalance.toNumber()).toBe(1400);

    expect(engine.orderbook!.asks).toHaveLength(0);
    expect(engine.orderbook!.bids).toHaveLength(0);
  });
});

describe("F4 — boot replay rebuilds the un-snapshotted command tail", () => {
  const cmd = (seq: string, id: string, userId: string, side: "LONG" | "SHORT", price: string, qty: string) => ({
    id,
    type: "LIMIT-CREATE" as const,
    seq,
    userId,
    side,
    entryPrice: price,
    quantity: qty,
    leverage: 1,
    filled: "0",
  });

  const snap = (e: TestEngine) => ({
    positions: [...e.userPosition.entries()]
      .map(([u, p]) => `${u}:${p.side}:${p.quantity.toString()}:${p.entryPrice.toString()}:${p.margin.toString()}`)
      .sort(),
    balances: [...e.userBalance.entries()]
      .map(([u, b]) => `${u}:${b.availableBalance.toString()}:${b.lockedBalance.toString()}`)
      .sort(),
    bids: (e.orderbook?.bids ?? []).map((o) => `${o.id}:${o.filled}/${o.quantity}`).sort(),
    asks: (e.orderbook?.asks ?? []).map((o) => `${o.id}:${o.filled}/${o.quantity}`).sort(),
  });

  const A = () => cmd("1", "a1", "maker", "SHORT", "100", "5");
  const B = () => cmd("2", "b1", "taker", "LONG", "100", "3");
  const C = () => cmd("3", "c1", "taker2", "LONG", "100", "2");

  const outboxRowsFrom = (cmds: ReturnType<typeof cmd>[]): OutboxRow[] =>
    cmds.map((c) => ({
      seq: BigInt(c.seq),
      commandId: `${c.id}__${c.type}`,
      marketId: "BTCUSDT",
      type: c.type,
      payload: c as unknown as Record<string, unknown>,
      status: "PENDING",
    }));

  test("replaying the completed tail reproduces the live state, with no side effects", async () => {

    const ref = freshEngine();
    ref.orderbook = new Orderbook([], []);
    await ref.dispatchCommand(A());
    await ref.dispatchCommand(B());
    await ref.dispatchCommand(C());
    const refState = snap(ref);

    const rec = freshEngine();
    rec.orderbook = new Orderbook([], []);
    await rec.dispatchCommand(A());
    outboxRows = outboxRowsFrom([A(), B(), C()]);

    events.length = 0;
    published.length = 0;
    await rec.replayTail();

    expect(events).toHaveLength(0);
    expect(published).toHaveLength(0);

    expect(snap(rec)).toEqual(refState);
    expect(rec.lastSeq).toBe(3n);
  });

  test("replay is idempotent — a second pass changes nothing", async () => {
    const rec = freshEngine();
    rec.orderbook = new Orderbook([], []);
    await rec.dispatchCommand(A());
    outboxRows = outboxRowsFrom([A(), B(), C()]);

    await rec.replayTail();
    const afterFirst = snap(rec);

    events.length = 0;
    published.length = 0;
    await rec.replayTail();

    expect(snap(rec)).toEqual(afterFirst);
    expect(events).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});

describe("R1 — seq idempotency guards against at-least-once re-delivery", () => {
  test("an order at or below the watermark is skipped with no side effects", async () => {
    const engine = freshEngine();
    engine.lastSeq = 5n;
    engine.orderbook = new Orderbook([], []);

    await engine.processOrder({
      id: "dup",
      type: "LIMIT-CREATE",
      seq: "5",
      userId: "u1",
      side: "LONG",
      entryPrice: "100",
      quantity: "1",
      leverage: 1,
      filled: "0",
    });

    expect(events).toHaveLength(0);
    expect(published).toHaveLength(0);
    expect(engine.lastSeq).toBe(5n);
  });

  test("a fresh seq is processed and advances the watermark", async () => {
    const engine = freshEngine();
    engine.lastSeq = 5n;
    engine.orderbook = new Orderbook([], []);

    await engine.processOrder({
      id: "new",
      type: "LIMIT-CREATE",
      seq: "6",
      userId: "u1",
      side: "LONG",
      entryPrice: "100",
      quantity: "1",
      leverage: 1,
      filled: "0",
    });

    expect(engine.lastSeq).toBe(6n);
    expect(events.length).toBeGreaterThan(0);
  });
});
