import { RedisManager } from "@repo/pubsub";
import { eventQueue, Worker } from "@repo/queue";
import { prisma } from "@repo/db";
import { Decimal } from "@repo/types";
import { logger } from "@repo/logger";
import dotenv from "dotenv";
import { Orderbook } from "./domain/Orderbook.js";
import {
  computeLiquidationPrice,
  maintenanceMarginRateFromBps,
  DEFAULT_MAINTENANCE_MARGIN_RATE,
} from "./domain/risk.js";
import { downloadSnapshot, uploadSnapshot } from "./S3Manager.js";
import {
  deserializeBalances,
  deserializePositions,
  serializeSnapshot,
  type EngineSnapshot,
} from "./shell/snapshot.js";
import type {
  BalanceCommand,
  Fill,
  Order,
  OrderSide,
  UserBalance,
  UserPosition,
} from "./domain/types.js";

dotenv.config();

const ENGINE_KEY = process.env["ENGINE_KEY"] ?? "engine-snapshot.dev.json";

const SNAPSHOT_INTERVAL_MS = 3000;

const SNAPSHOT_WRITE_THRESHOLD = 200;

const SNAPSHOT_FAILURE_THRESHOLD = 2;

const MARKET_ID = process.env["MARKET_ID"];

export class Engine {
  public static instance: Engine | null = null;
  private orderbook: Orderbook | null;
  private userPosition = new Map<string, UserPosition>();
  private userBalance = new Map<string, UserBalance>();

  private lastSeq = 0n;

  private lastFundingSeq = 0n;

  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private fundingWorker: Worker | null = null;
  private snapshotInFlight = false;

  private consecutiveSnapshotFailures = 0;

  private writesSinceSnapshot = 0;

  private maintenanceMarginRate = DEFAULT_MAINTENANCE_MARGIN_RATE;

  private replaying = false;

  private writeChain: Promise<unknown> = Promise.resolve();

  private constructor() {
    this.orderbook = null;

  }

  public static getInstance(): Engine {
    if (!this.instance) {
      this.instance = new Engine();
    }
    return this.instance;
  }

  static async create(): Promise<Engine> {
    if (this.instance) return this.instance;

    const engine = new Engine();
    try {
      await engine.loadMarketRiskConfig();

      const snapshot = await downloadSnapshot<EngineSnapshot>(ENGINE_KEY);
      if (snapshot) {
        engine.loadSnapshot(snapshot);
        logger.info(
          `engine recovered from S3 — ${engine.orderbook!.bids.length} bids, ` +
            `${engine.orderbook!.asks.length} asks, ${engine.userPosition.size} positions, ` +
            `${engine.userBalance.size} balances, lastSeq=${engine.lastSeq}`,
        );
      } else {
        engine.orderbook = new Orderbook([], [], "BTCUSDT");
        logger.info("engine cold start — no S3 snapshot found");
      }
      await engine.replayTail();
    } catch (error) {
      logger.error("Engine recovery failed:", error);
      Engine.instance = null;
      throw error;
    }

    engine.startWorker();
    engine.startSnapshotLoop();
    return engine;
  }

  async loadMarketRiskConfig(): Promise<void> {
    if (!MARKET_ID) {
      logger.warn(
        `MARKET_ID is not set — using default maintenance margin rate ` +
          `${this.maintenanceMarginRate.times(100)}%`,
      );
      return;
    }
    try {
      const market = await prisma.market.findUnique({
        where: { id: MARKET_ID },
        select: { symbol: true, maintenanceMarginRate: true },
      });
      if (!market) {
        logger.warn(
          `market ${MARKET_ID} not found — using default maintenance margin rate ` +
            `${this.maintenanceMarginRate.times(100)}%`,
        );
        return;
      }
      this.maintenanceMarginRate = maintenanceMarginRateFromBps(market.maintenanceMarginRate);
      logger.info(
        `engine loaded risk config for ${market.symbol} — ` +
          `maintenance margin ${this.maintenanceMarginRate.times(100)}%`,
      );
    } catch (error) {
      logger.error("failed to load market risk config; keeping default rate:", error);
    }
  }

  loadSnapshot(snapshot: EngineSnapshot) {
    this.orderbook = new Orderbook(
      snapshot.orderbook.bids,
      snapshot.orderbook.asks,
      snapshot.orderbook.market,
    );
    this.userBalance = deserializeBalances(snapshot.userBalance);
    this.userPosition = deserializePositions(snapshot.userPosition);
    this.lastSeq = snapshot.lastSeq ? BigInt(snapshot.lastSeq) : 0n;
    this.lastFundingSeq = snapshot.lastFundingSeq ? BigInt(snapshot.lastFundingSeq) : 0n;
  }

  async replayTail(): Promise<void> {
    const watermark = this.lastSeq;
    const rows = await prisma.commandOutbox.findMany({
      where: { seq: { gt: watermark } },
      orderBy: { seq: "asc" },
    });
    if (rows.length === 0) return;

    this.replaying = true;
    try {
      for (const row of rows) {
        const command = { ...(row.payload as object), seq: row.seq.toString() };
        await this.dispatchCommand(command as Order | BalanceCommand);
      }
    } finally {
      this.replaying = false;
    }

    logger.info(
      `engine replayed ${rows.length} outbox command(s); lastSeq ${watermark} → ${this.lastSeq}`,
    );
  }

  private startSnapshotLoop() {
    this.snapshotTimer = setInterval(() => {
      if (this.writesSinceSnapshot === 0) return;
      void this.saveSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
  }

  async saveSnapshot(): Promise<void> {
    if (this.snapshotInFlight || !this.orderbook) return;
    this.snapshotInFlight = true;
    try {
      const captured = this.writesSinceSnapshot;
      const snapshot = serializeSnapshot(
        this.orderbook.getSnapshot(),
        this.userBalance,
        this.userPosition,
        this.lastSeq,
        this.lastFundingSeq,
      );
      await uploadSnapshot(snapshot, ENGINE_KEY);

      this.writesSinceSnapshot -= captured;
      this.consecutiveSnapshotFailures = 0;
    } catch (error) {
      this.consecutiveSnapshotFailures += 1;
      logger.error(
        `snapshot save failed (${this.consecutiveSnapshotFailures} consecutive):`,
        error,
      );
    } finally {
      this.snapshotInFlight = false;
    }
  }

  snapshotHealthy(): boolean {
    return this.consecutiveSnapshotFailures < SNAPSHOT_FAILURE_THRESHOLD;
  }

  private noteWrite(): void {
    this.writesSinceSnapshot += 1;
    if (this.writesSinceSnapshot >= SNAPSHOT_WRITE_THRESHOLD) {
      void this.saveSnapshot();
    }
  }

  async stop(): Promise<void> {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.fundingWorker) {
      await this.fundingWorker.close();
      this.fundingWorker = null;
    }
    await this.saveSnapshot();
  }

  startWorker() {
    if (!process.env["REDIS_HOST"] || !process.env["REDIS_PORT"]) {
      throw new Error("Missing REDIS_HOST or REDIS_PORT in env");
    }
    this.fundingWorker = new Worker(
      "FUNDING_QUEUE",
      async (job) => {
        if (job.data.fundingRate && job.data.markPrice) {
          await this.serialize(() =>
            this.applyFunding(job.data.fundingRate, job.data.markPrice, job.data.settlementSeq),
          );
        }
      },
      {
        connection: {
          host: process.env["REDIS_HOST"],
          port: Number(process.env["REDIS_PORT"]),
        },
        concurrency: 1,
      },
    );
  }

  serialize<T>(work: () => Promise<T> | T): Promise<T> {
    const run = async (): Promise<T> => work();
    const next = this.writeChain.then(run, run);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async dispatchCommand(data: Order | BalanceCommand): Promise<void> {
    return this.serialize(() => {
      const type = (data as { type?: string }).type;
      if (type === "BALANCE-DEPOSIT" || type === "BALANCE-WITHDRAW") {
        return this.processBalanceCommand(data as BalanceCommand);
      }
      return this.processOrder(data as Order);
    });
  }

  private noteSkippedSeq(kind: string, seq: bigint): void {
    if (seq < this.lastSeq) {
      logger.error(
        `out-of-order ${kind} DROPPED: seq=${seq} arrived after lastSeq=${this.lastSeq} — ` +
          `a committed command has been lost`,
      );
      return;
    }
    logger.debug(`skipping already-applied ${kind} seq=${seq} (lastSeq=${this.lastSeq})`);
  }

  async processOrder(order: Order): Promise<void> {
    logger.debug("engine processing order: ", order);

    const seq = order.seq !== undefined ? BigInt(order.seq) : null;
    if (seq !== null && seq <= this.lastSeq) {
      this.noteSkippedSeq("order", seq);
      return;
    }

    switch (order.type) {
      case "LIMIT-CREATE":
        try {
          await this.createOrder(
            order.id!,
            order.userId,
            order.entryPrice,
            order.quantity,
            order.side,
            order.leverage,
          );
        } catch (error) {
          logger.debug(error);
          this.publishOrderRejected(order, error);
        }
        break;
      case "LIMIT-CANCEL": {
        const removed = this.orderbook?.cancelOrder(order.id!, order.userId) ?? null;
        if (!removed) {
          logger.debug(`cancel ignored — order ${order.id} is not resting in the book`);
          break;
        }
        logger.debug("cancelling order", removed);

        this.reconcileLocked(order.userId);

        this.publishUserBalance(order.userId);
        this.publishOrderCancelled(order.id!);
        this.updateRedisBalance(order.userId);
        this.updateRedisDepth();
        this.cancelRedisOrder(order);
        break;
      }
      case "MARKET-CREATE":
        try {
          await this.createMarketOrder(order.id!, order.userId, order.quantity, order.side, order.leverage);
        } catch (error) {
          logger.debug(error);
          this.publishOrderRejected(order, error);
        }
        break;
      case "MARKET-LIQUIDATE":
        try {
          await this.createMarketOrder(order.id!, order.userId, order.quantity, order.side, order.leverage);
        } catch (error) {
          logger.debug(error);
          this.publishOrderRejected(order, error);
        }
        break;
    }
    logger.debug("order processed, moving to liquidator");
    this.updateTopOfBook();
    this.positionUpdateForLiquidation();

    if (seq !== null && seq > this.lastSeq) this.lastSeq = seq;
    this.noteWrite();
  }

  async processBalanceCommand(command: BalanceCommand): Promise<void> {
    logger.debug("engine processing balance command: ", command);

    const seq = command.seq !== undefined ? BigInt(command.seq) : null;
    if (seq !== null && seq <= this.lastSeq) {
      this.noteSkippedSeq("balance command", seq);
      return;
    }

    await this.ensureUser(command.userId);
    const balance = this.userBalance.get(command.userId)!;
    const amount = new Decimal(command.amount);

    if (command.type === "BALANCE-WITHDRAW") {
      if (balance.availableBalance.lessThan(amount)) {
        this.publishBalanceRejected(command, "Insufficient Balance");
        this.updateRedisLedger(command.id, "REJECTED");
        if (seq !== null && seq > this.lastSeq) this.lastSeq = seq;
        return;
      }
      balance.availableBalance = balance.availableBalance.minus(amount);
    } else {
      balance.availableBalance = balance.availableBalance.plus(amount);
    }

    this.publishUserBalance(command.userId);
    this.updateRedisBalance(command.userId);
    this.updateRedisLedger(command.id, "APPLIED");

    if (seq !== null && seq > this.lastSeq) this.lastSeq = seq;
    this.noteWrite();
  }

  async createOrder(
    id: string,
    userId: string,
    entryPrice: string,
    quantity: string,
    side: OrderSide,
    leverage: number,
  ) {
    logger.debug("create order entered");
    await this.ensureUser(userId);

    const order: Order = {
      id,
      userId,
      side,
      entryPrice,
      quantity,
      leverage,
      filled: "0",
    };
    this.assertCanAfford(userId, order);

    const { executedQty, fills, updatedOrders } = this.orderbook?.addOrder(order) ?? {
      executedQty: new Decimal(0),
      fills: [],
      updatedOrders: [],
    };

    this.updateUserPnl(fills, executedQty, order);
    this.updateUserPosition(fills, executedQty, order);
    this.publishAndPersistBalances(order.userId, fills);
    this.publishLastTrade(fills);
    this.publishDepth();
    this.updateRedisDepth();
    this.updateRedisOrder({ ...order, filled: executedQty.toString() });
    for (const makerOrder of updatedOrders) {
      this.updateRedisOrder(makerOrder);
    }
    this.updateRedisFills(fills, order);
    this.updateRedisPosition(fills, order);
    logger.debug(executedQty, fills);
  }

  async createMarketOrder(id: string, userId: string, quantity: string, side: OrderSide, leverage: number) {
    logger.debug("create order entered");
    await this.ensureUser(userId);

    const referencePrice = this.orderbook?.getBestOppositePrice(side, quantity);
    if (!referencePrice) {

      throw new Error("No reference price found");
    }

    const order: Order = {
      id,
      userId,
      side,
      entryPrice: referencePrice,
      quantity,
      leverage,
      filled: "0",
    };
    this.assertCanAfford(userId, order);

    const { executedQty, fills, updatedOrders } = this.orderbook?.addOrder(order, false) ?? {
      executedQty: new Decimal(0),
      fills: [],
      updatedOrders: [],
    };

    this.updateUserPnl(fills, executedQty, order);
    this.updateUserPosition(fills, executedQty, order);
    this.publishAndPersistBalances(order.userId, fills);
    this.publishLastTrade(fills);
    this.publishDepth();
    this.updateRedisDepth();
    this.updateRedisOrder({ ...order, filled: executedQty.toString() });
    for (const makerOrder of updatedOrders) {
      this.updateRedisOrder(makerOrder);
    }
    this.updateRedisFills(fills, order);
    this.updateRedisPosition(fills, order);
  }

  async ensureUser(userId: string): Promise<void> {
    if (!this.userBalance.has(userId)) {
      const balance = await prisma.balance.findUnique({ where: { userId } });

      this.userBalance.set(userId, {
        availableBalance: balance ? new Decimal(balance.availableMargin.toString()) : new Decimal(0),
        lockedBalance: balance ? new Decimal(balance.lockedMargin.toString()) : new Decimal(0),
      });
    }
    if (!this.userPosition.has(userId)) {
      this.userPosition.set(userId, {
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

  private orderMargin(
    order: Order,
    offsetAvailable: Decimal,
  ): { margin: Decimal; offsetUsed: Decimal } {
    const remaining = new Decimal(order.quantity).minus(order.filled);
    if (remaining.lessThanOrEqualTo(0)) {
      return { margin: new Decimal(0), offsetUsed: new Decimal(0) };
    }
    const offsetUsed = Decimal.min(remaining, offsetAvailable);
    const opening = remaining.minus(offsetUsed);
    return {
      margin: new Decimal(order.entryPrice).times(opening).div(order.leverage),
      offsetUsed,
    };
  }

  requiredLock(userId: string, extraOrder?: Order): Decimal {
    const position = this.userPosition.get(userId);
    let total = position ? position.margin : new Decimal(0);

    let offsetLong = position?.side === "LONG" ? position.quantity : new Decimal(0);
    let offsetShort = position?.side === "SHORT" ? position.quantity : new Decimal(0);

    const resting = this.orderbook?.getOpenOrders(userId) ?? [];
    const orders = extraOrder ? [...resting, extraOrder] : resting;

    for (const order of orders) {
      if (order.side === "LONG") {
        const { margin, offsetUsed } = this.orderMargin(order, offsetShort);
        offsetShort = offsetShort.minus(offsetUsed);
        total = total.plus(margin);
      } else {
        const { margin, offsetUsed } = this.orderMargin(order, offsetLong);
        offsetLong = offsetLong.minus(offsetUsed);
        total = total.plus(margin);
      }
    }
    return total;
  }

  reconcileLocked(userId: string): void {
    const balance = this.userBalance.get(userId);
    if (!balance) return;

    const required = this.requiredLock(userId);
    const delta = balance.lockedBalance.minus(required);
    if (delta.isZero()) return;

    balance.lockedBalance = required;
    balance.availableBalance = balance.availableBalance.plus(delta);

    if (balance.availableBalance.isNegative()) {
      logger.error(
        `margin invariant violated for ${userId}: available ${balance.availableBalance.toFixed(8)} ` +
          `after locking ${required.toFixed(8)} — position or fill exceeded posted collateral`,
      );
    }
  }

  assertCanAfford(userId: string, order: Order): void {
    const balance = this.userBalance.get(userId)!;
    const required = this.requiredLock(userId, order);
    const collateral = balance.availableBalance.plus(balance.lockedBalance);
    if (collateral.lessThan(required)) {
      throw new Error("Insufficient Balance");
    }
  }

  private releaseMargin(position: UserPosition, closingQty: Decimal): Decimal {
    if (position.quantity.lessThanOrEqualTo(0)) return new Decimal(0);
    if (closingQty.greaterThanOrEqualTo(position.quantity)) return position.margin;
    return position.margin.times(closingQty).div(position.quantity);
  }

  private realizedPnl(
    fills: Fill[],
    entryPrice: Decimal,
    closingQty: Decimal,
    side: OrderSide,
  ): Decimal {
    let remaining = closingQty;
    let pnl = new Decimal(0);
    for (const fill of fills) {
      if (remaining.lte(0)) break;
      const q = Decimal.min(fill.quantity, remaining);
      const delta =
        side === "LONG" ? new Decimal(fill.price).minus(entryPrice) : entryPrice.minus(fill.price);
      pnl = pnl.plus(delta.times(q));
      remaining = remaining.minus(q);
    }
    return pnl;
  }

  private openingNotional(fills: Fill[], skipQty: Decimal): Decimal {
    let remaining = skipQty;
    let notional = new Decimal(0);
    for (const fill of fills) {
      let q = new Decimal(fill.quantity);
      if (remaining.greaterThan(0)) {
        const skip = Decimal.min(q, remaining);
        remaining = remaining.minus(skip);
        q = q.minus(skip);
      }
      if (q.greaterThan(0)) notional = notional.plus(q.times(fill.price));
    }
    return notional;
  }

  updateUserPnl(fills: Fill[], executedQty: Decimal, order: Order) {
    const userPosition = this.userPosition.get(order.userId);
    const userBalance = this.userBalance.get(order.userId)!;
    if (fills.length === 0 || !userPosition) return;

    const userSide = userPosition.side;
    const orderSide = order.side;

    const closingQty = Decimal.min(userPosition.quantity, executedQty);
    if (closingQty.lessThanOrEqualTo(0)) return;

    if (userSide === "LONG" && orderSide === "SHORT") {
      const pnl = this.realizedPnl(fills, userPosition.entryPrice, closingQty, "LONG");
      userBalance.availableBalance = userBalance.availableBalance.plus(pnl);
    }

    if (userSide === "SHORT" && orderSide === "LONG") {
      const pnl = this.realizedPnl(fills, userPosition.entryPrice, closingQty, "SHORT");
      userBalance.availableBalance = userBalance.availableBalance.plus(pnl);
    }
  }

  updateUserPosition(fills: Fill[], executedQty: Decimal, order: Order) {
    const userPosition = this.userPosition.get(order.userId);
    const exec = new Decimal(executedQty);
    switch (userPosition?.side) {
      case "SHORT":
        if (order.side === "SHORT") {
          const oldNotional = userPosition.entryPrice.times(userPosition.quantity);

          const newNotional = this.openingNotional(fills, new Decimal(0));
          const totalQuantity = userPosition.quantity.plus(exec);

          userPosition.quantity = totalQuantity;
          userPosition.entryPrice = oldNotional.plus(newNotional).div(totalQuantity);

          userPosition.margin = userPosition.margin.plus(newNotional.div(order.leverage));
          userPosition.leverage = order.leverage;
        } else {

          if (userPosition.quantity.lessThan(exec)) {

            const remainingQty = exec.minus(userPosition.quantity);
            const openNotional = this.openingNotional(fills, userPosition.quantity);
            userPosition.side = "LONG";
            userPosition.quantity = remainingQty;
            userPosition.margin = openNotional.div(order.leverage);
            userPosition.entryPrice = openNotional.div(remainingQty);
            userPosition.leverage = order.leverage;
          } else if (userPosition.quantity.greaterThan(exec)) {
            const released = this.releaseMargin(userPosition, exec);
            userPosition.quantity = userPosition.quantity.minus(exec);
            userPosition.margin = userPosition.margin.minus(released);
          } else {
            userPosition.side = "UNINITIALIZED";
            userPosition.quantity = new Decimal(0);
            userPosition.margin = new Decimal(0);
            userPosition.entryPrice = new Decimal(0);
          }
        }
        break;
      case "LONG":
        if (order.side === "LONG") {
          const oldNotional = userPosition.entryPrice.times(userPosition.quantity);

          const newNotional = this.openingNotional(fills, new Decimal(0));
          const totalQuantity = userPosition.quantity.plus(exec);

          userPosition.quantity = totalQuantity;
          userPosition.entryPrice = oldNotional.plus(newNotional).div(totalQuantity);

          userPosition.margin = userPosition.margin.plus(newNotional.div(order.leverage));
          userPosition.leverage = order.leverage;
        } else {

          if (userPosition.quantity.lessThan(exec)) {

            const remainingQty = exec.minus(userPosition.quantity);
            const openNotional = this.openingNotional(fills, userPosition.quantity);
            userPosition.side = "SHORT";
            userPosition.quantity = remainingQty;
            userPosition.margin = openNotional.div(order.leverage);
            userPosition.entryPrice = openNotional.div(remainingQty);
            userPosition.leverage = order.leverage;
          } else if (userPosition.quantity.greaterThan(exec)) {
            const released = this.releaseMargin(userPosition, exec);
            userPosition.quantity = userPosition.quantity.minus(exec);
            userPosition.margin = userPosition.margin.minus(released);
          } else {
            userPosition.side = "UNINITIALIZED";
            userPosition.quantity = new Decimal(0);
            userPosition.margin = new Decimal(0);
            userPosition.entryPrice = new Decimal(0);
          }
        }
        break;
      default:
        if (executedQty.greaterThan(0) && userPosition) {

          const openNotional = this.openingNotional(fills, new Decimal(0));
          userPosition.side = order.side;
          userPosition.entryPrice = openNotional.div(exec);
          userPosition.quantity = exec;

          userPosition.margin = openNotional.div(order.leverage);
          userPosition.leverage = order.leverage;
        }
        break;
    }

    fills.forEach((fill) => {
      const makerPosition = this.userPosition.get(fill.otherUserId);
      const makerBalance = this.userBalance.get(fill.otherUserId);
      const fillPrice = new Decimal(fill.price);
      const fillQty = new Decimal(fill.quantity);

      switch (makerPosition?.side) {
        case "LONG":
          if (order.side === "SHORT") {
            const oldNotional = makerPosition.entryPrice.times(makerPosition.quantity);
            const newNotional = fillPrice.times(fillQty);
            const totalQuantity = makerPosition.quantity.plus(fillQty);

            makerPosition.entryPrice = oldNotional.plus(newNotional).div(totalQuantity);
            makerPosition.quantity = totalQuantity;

            const newMargin = fillPrice.times(fillQty).div(fill.otherLeverage);
            makerPosition.margin = makerPosition.margin.plus(newMargin);
            makerPosition.leverage = fill.otherLeverage;
          } else {
            if (makerPosition.quantity.greaterThan(fillQty)) {

              const released = this.releaseMargin(makerPosition, fillQty);
              const pnl = fillPrice.minus(makerPosition.entryPrice).times(fillQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(pnl);
              }
              makerPosition.quantity = makerPosition.quantity.minus(fillQty);
              makerPosition.margin = makerPosition.margin.minus(released);
            } else if (makerPosition.quantity.equals(fillQty)) {
              const pnl = fillPrice.minus(makerPosition.entryPrice).times(fillQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(pnl);
              }
              makerPosition.side = "UNINITIALIZED";
              makerPosition.quantity = new Decimal(0);
              makerPosition.margin = new Decimal(0);
              makerPosition.entryPrice = new Decimal(0);
            } else {

              const closedQty = makerPosition.quantity;
              const pnl = fillPrice.minus(makerPosition.entryPrice).times(closedQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(pnl);
              }
              const remainingQty = fillQty.minus(closedQty);
              makerPosition.side = "SHORT";
              makerPosition.quantity = remainingQty;
              makerPosition.entryPrice = fillPrice;
              makerPosition.margin = fillPrice.times(remainingQty).div(fill.otherLeverage);
              makerPosition.leverage = fill.otherLeverage;
            }
          }
          break;
        case "SHORT":
          if (order.side === "LONG") {
            const oldNotional = makerPosition.entryPrice.times(makerPosition.quantity);
            const newNotional = fillPrice.times(fillQty);
            const totalQuantity = makerPosition.quantity.plus(fillQty);

            makerPosition.entryPrice = oldNotional.plus(newNotional).div(totalQuantity);
            makerPosition.quantity = totalQuantity;

            const newMargin = fillPrice.times(fillQty).div(fill.otherLeverage);
            makerPosition.margin = makerPosition.margin.plus(newMargin);
            makerPosition.leverage = fill.otherLeverage;
          } else {
            if (makerPosition.quantity.greaterThan(fillQty)) {

              const released = this.releaseMargin(makerPosition, fillQty);
              const pnl = makerPosition.entryPrice.minus(fillPrice).times(fillQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(pnl);
              }
              makerPosition.quantity = makerPosition.quantity.minus(fillQty);
              makerPosition.margin = makerPosition.margin.minus(released);
            } else if (makerPosition.quantity.equals(fillQty)) {
              const pnl = makerPosition.entryPrice.minus(fillPrice).times(fillQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(pnl);
              }
              makerPosition.side = "UNINITIALIZED";
              makerPosition.quantity = new Decimal(0);
              makerPosition.margin = new Decimal(0);
              makerPosition.entryPrice = new Decimal(0);
            } else {

              const closedQty = makerPosition.quantity;
              const pnl = makerPosition.entryPrice.minus(fillPrice).times(closedQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(pnl);
              }
              const remainingQty = fillQty.minus(closedQty);
              makerPosition.side = "LONG";
              makerPosition.quantity = remainingQty;
              makerPosition.entryPrice = fillPrice;
              makerPosition.margin = fillPrice.times(remainingQty).div(fill.otherLeverage);
              makerPosition.leverage = fill.otherLeverage;
            }
          }
          break;
        default:
          if (makerPosition) {
            makerPosition.side = order.side === "LONG" ? "SHORT" : "LONG";
            makerPosition.entryPrice = fillPrice;
            makerPosition.quantity = fillQty;
            makerPosition.margin = fillPrice.times(fillQty).div(fill.otherLeverage);
            makerPosition.leverage = fill.otherLeverage;
          }
          break;
      }
    });
  }

  private publishAndPersistBalances(takerId: string, fills: Fill[]) {
    const affected = new Set<string>([takerId]);
    for (const fill of fills) affected.add(fill.otherUserId);
    for (const userId of affected) {
      this.reconcileLocked(userId);
      this.publishUserBalance(userId);
      this.updateRedisBalance(userId);
    }
  }

  private serializePosition(userId: string, p: UserPosition) {
    return {
      userId,
      side: p.side,
      quantity: p.quantity.toFixed(8),
      entryPrice: p.entryPrice.toFixed(8),
      margin: p.margin.toFixed(8),
      unrealizedPnl: p.unrealizedPnl.toFixed(8),
      liquidatedPrice: computeLiquidationPrice(p, this.maintenanceMarginRate).toFixed(8),
      maintenanceMarginRate: this.maintenanceMarginRate.toString(),
      market: p.market,
      leverage: p.leverage,
    };
  }

  private publish(channel: string, message: unknown): void {
    if (this.replaying) return;
    RedisManager.getInstance().publishToChannel(channel, message);
  }

  private emitEvent(name: string, data: unknown): void {
    if (this.replaying) return;
    void eventQueue.add(name, data);
  }

  publishUserBalance(userId: string) {
    const userBalance = this.userBalance.get(userId);
    if (userBalance) {
      this.publish(`balance@${userId}`, {
        data: {
          a: userBalance.availableBalance.toFixed(8),
          l: userBalance.lockedBalance.toFixed(8),
        },
      });
    }
  }

  publishLastTrade(fills: Fill[]) {
    const lastFill = fills[fills.length - 1];
    if (!lastFill) return;
    this.publish(`trade:update`, {
      data: {
        p: lastFill.price,
        q: lastFill.quantity,
      },
    });
  }

  publishDepth() {
    logger.debug("publishing depth");
    const { asks, bids } = this.orderbook?.getMarketDepth() ?? { asks: [], bids: [] };
    this.publish(`depth:update`, {
      data: {
        a: asks,
        b: bids,
      },
    });
    logger.debug("depth published");
  }

  updateRedisBalance(userId: string) {
    const balance = this.userBalance.get(userId);
    if (!balance) return;

    this.emitEvent("update_balance", {
      type: "BALANCE_UPDATE",
      data: {
        userId,
        availableBalance: balance.availableBalance.toFixed(8),
        lockedBalance: balance.lockedBalance.toFixed(8),
      },
    });
  }

  updateRedisLedger(ledgerId: string, status: "APPLIED" | "REJECTED") {
    this.emitEvent("update_ledger", {
      type: "LEDGER_UPDATE",
      data: {
        ledgerId,
        status,
      },
    });
  }

  updateRedisDepth() {
    const { asks, bids } = this.orderbook?.getMarketDepth() ?? { asks: [], bids: [] };
    this.emitEvent("update_depth", {
      type: "DEPTH_UPDATE",
      data: {
        asks,
        bids,
      },
    });
  }

  updateRedisOrder(order: Order) {
    this.emitEvent("update_order", {
      type: "ORDER_UPDATE",
      data: order,
    });
  }

  updateRedisFills(fills: Fill[], order: Order) {
    fills.forEach((fill) => {
      this.emitEvent("update_fills", {
        type: "FILL_UPDATE",
        data: {
          ...fill,
          side: order.side,
        },
      });
    });
  }

  updateRedisPosition(fills: Fill[], order: Order) {
    const userPosition = this.userPosition.get(order.userId);
    if (userPosition) {
      this.emitEvent("update_position", {
        type: "POSITION_UPDATE",
        data: this.serializePosition(order.userId, userPosition),
      });
    }

    fills.forEach((fill) => {
      const makerPosition = this.userPosition.get(fill.otherUserId);
      if (makerPosition) {
        this.emitEvent("update_position", {
          type: "POSITION_UPDATE",
          data: this.serializePosition(fill.otherUserId, makerPosition),
        });
      }
    });
  }

  updateTopOfBook() {
    const { asks, bids } = this.orderbook?.getMarketDepth() ?? { asks: [], bids: [] };
    this.publish(`topOfBook:update`, {
      data: {
        a: asks[0] ?? ["0", "0"],
        b: bids[0] ?? ["0", "0"],
      },
    });
  }

  positionUpdateForLiquidation() {
    const payload = Array.from(this.userPosition.entries()).map(([userId, position]) =>
      this.serializePosition(userId, position),
    );
    this.publish("position:update", {
      data: payload,
    });
  }

  applyFunding(fundingRate: string, markPrice: string, settlementSeq?: string) {

    const seq = settlementSeq !== undefined ? BigInt(settlementSeq) : null;
    if (seq !== null && seq <= this.lastFundingSeq) {
      logger.debug(`skipping already-applied funding settlement seq=${seq} (last=${this.lastFundingSeq})`);
      return;
    }

    const rate = new Decimal(fundingRate);
    const mark = new Decimal(markPrice);

    const payers: { userId: string; amount: Decimal }[] = [];
    const receivers: { userId: string; amount: Decimal }[] = [];

    for (const [userId, position] of this.userPosition.entries()) {
      if (position.side === "UNINITIALIZED") continue;
      if (position.quantity.lessThanOrEqualTo(0)) continue;
      if (!this.userBalance.has(userId)) continue;

      const payment = mark.times(position.quantity).times(rate);
      if (payment.isZero()) continue;

      const isLong = position.side === "LONG";
      const pays = payment.isPositive() ? isLong : !isLong;
      (pays ? payers : receivers).push({ userId, amount: payment.abs() });
    }

    const totalClaim = receivers.reduce((sum, r) => sum.plus(r.amount), new Decimal(0));

    if (payers.length === 0 || totalClaim.lessThanOrEqualTo(0)) {
      if (seq !== null) this.lastFundingSeq = seq;
      return;
    }

    const affected = new Set<string>();

    let collected = new Decimal(0);
    for (const { userId, amount } of payers) {
      const balance = this.userBalance.get(userId)!;
      const capacity = Decimal.max(balance.availableBalance, new Decimal(0));
      const payable = Decimal.min(amount, capacity);
      if (payable.lessThan(amount)) {
        logger.warn(
          `funding shortfall for ${userId}: owed ${amount.toFixed(8)}, paid ${payable.toFixed(8)} ` +
            `(bad debt ${amount.minus(payable).toFixed(8)})`,
        );
      }
      if (payable.lessThanOrEqualTo(0)) continue;
      balance.availableBalance = balance.availableBalance.minus(payable);
      collected = collected.plus(payable);
      affected.add(userId);
    }

    if (collected.greaterThan(0)) {
      const ordered = [...receivers].sort((a, b) => b.amount.comparedTo(a.amount));
      let distributed = new Decimal(0);
      ordered.forEach((receiver, index) => {
        const balance = this.userBalance.get(receiver.userId)!;
        const share =
          index === ordered.length - 1
            ? collected.minus(distributed)
            : collected.times(receiver.amount).div(totalClaim);
        if (share.lessThanOrEqualTo(0)) return;
        balance.availableBalance = balance.availableBalance.plus(share);
        distributed = distributed.plus(share);
        affected.add(receiver.userId);
      });
    }

    if (seq !== null) this.lastFundingSeq = seq;

    for (const userId of affected) {
      this.publishUserBalance(userId);
      this.updateRedisBalance(userId);
    }
  }

  cancelRedisOrder(order: Order) {
    this.emitEvent("cancel_order", {
      type: "CANCEL_ORDER",
      data: {
        orderId: order.id,
      },
    });
  }

  publishOrderCancelled(orderId: string) {
    this.publish(`order:cancelled`, {
      data: {
        orderId,
      },
    });
  }

  publishOrderRejected(order: Order, error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    this.publish(`order:rejected@${order.userId}`, {
      data: {
        userId: order.userId,
        orderId: order.id,
        reason,
      },
    });
    if (order.id) {
      this.emitEvent("reject_order", {
        type: "ORDER_REJECTED",
        data: { orderId: order.id, reason },
      });
    }
  }

  publishBalanceRejected(command: BalanceCommand, reason: string) {
    this.publish(`order:rejected@${command.userId}`, {
      data: {
        userId: command.userId,
        ledgerId: command.id,
        reason,
      },
    });
  }
}
