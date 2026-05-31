import { RedisManager } from "@repo/pubsub";
import { eventQueue, getCompletedCommands, Worker } from "@repo/queue";
import { prisma } from "@repo/db";
import { Decimal } from "@repo/types";
import { logger } from "@repo/logger";
import dotenv from "dotenv";
import { Orderbook } from "./domain/Orderbook.js";
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


const ENGINE_KEY = process.env["ENGINE_KEY"] ?? "production-snapshot.json";

const SNAPSHOT_INTERVAL_MS = 3000;

const SNAPSHOT_WRITE_THRESHOLD = 200;






export class Engine {
  public static instance: Engine | null = null;
  private orderbook: Orderbook | null;
  private userPosition = new Map<string, UserPosition>();
  private userBalance = new Map<string, UserBalance>();

  private lastSeq = 0n;

  private lastBalanceSeq = 0n;

  private lastFundingSeq = 0n;

  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotInFlight = false;

  private writesSinceSnapshot = 0;

  private replaying = false;

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


  loadSnapshot(snapshot: EngineSnapshot) {
    this.orderbook = new Orderbook(
      snapshot.orderbook.bids,
      snapshot.orderbook.asks,
      snapshot.orderbook.market,
    );
    this.userBalance = deserializeBalances(snapshot.userBalance);
    this.userPosition = deserializePositions(snapshot.userPosition);
    this.lastSeq = snapshot.lastSeq ? BigInt(snapshot.lastSeq) : 0n;
    this.lastBalanceSeq = snapshot.lastBalanceSeq ? BigInt(snapshot.lastBalanceSeq) : 0n;
    this.lastFundingSeq = snapshot.lastFundingSeq ? BigInt(snapshot.lastFundingSeq) : 0n;
  }


  async replayTail(): Promise<void> {
    const commands = await getCompletedCommands();
    if (commands.length === 0) return;

    const watermark = this.lastSeq;
    this.replaying = true;
    try {
      for (const command of commands) {
        await this.dispatchCommand(command as Order | BalanceCommand);
      }
    } finally {
      this.replaying = false;
    }




    const orderSeqs = commands
      .filter((c) => {
        const t = (c as { type?: string }).type;
        return t !== "BALANCE-DEPOSIT" && t !== "BALANCE-WITHDRAW";
      })
      .map((c) => (c as { seq?: string }).seq)
      .filter((s): s is string => s !== undefined)
      .map((s) => BigInt(s));
    const minOrderSeq = orderSeqs.length > 0 ? orderSeqs.reduce((a, b) => (a < b ? a : b)) : null;
    if (minOrderSeq !== null && minOrderSeq > watermark + 1n) {
      logger.warn(
        `replay: oldest retained order seq ${minOrderSeq} > snapshot watermark ${watermark} + 1 — ` +
          `commands in that gap may have been evicted (raise ORDER_QUEUE removeOnComplete or snapshot more often)`,
      );
    }
    logger.info(
      `engine replayed ${commands.length} completed command(s); lastSeq ${watermark} → ${this.lastSeq}, ` +
        `lastBalanceSeq=${this.lastBalanceSeq}`,
    );
  }


  private startSnapshotLoop() {
    this.snapshotTimer = setInterval(() => {
      void this.saveSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
  }


  async saveSnapshot(): Promise<void> {
    if (this.snapshotInFlight || !this.orderbook) return;
    this.snapshotInFlight = true;
    try {
      const snapshot = serializeSnapshot(
        this.orderbook.getSnapshot(),
        this.userBalance,
        this.userPosition,
        this.lastSeq,
        this.lastBalanceSeq,
        this.lastFundingSeq,
      );
      await uploadSnapshot(snapshot, ENGINE_KEY);


      this.writesSinceSnapshot = 0;
    } catch (error) {
      logger.error("snapshot save failed:", error);
    } finally {
      this.snapshotInFlight = false;
    }
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
    await this.saveSnapshot();
  }

  startWorker() {
    if (!process.env["REDIS_HOST"] || !process.env["REDIS_PORT"]) {
      throw new Error("Missing REDIS_HOST or REDIS_PORT in env");
    }
    new Worker(
      "FUNDING_QUEUE",
      (job) => {
        if (job.data.fundingRate && job.data.markPrice) {
          this.applyFunding(job.data.fundingRate, job.data.markPrice, job.data.settlementSeq);
        }
        return Promise.resolve();
      },
      {
        connection: {
          host: process.env["REDIS_HOST"],
          port: Number(process.env["REDIS_PORT"]),
        },
      },
    );
  }


  async dispatchCommand(data: Order | BalanceCommand): Promise<void> {
    const type = (data as { type?: string }).type;
    if (type === "BALANCE-DEPOSIT" || type === "BALANCE-WITHDRAW") {
      await this.processBalanceCommand(data as BalanceCommand);
    } else {
      await this.processOrder(data as Order);
    }
  }

  async processOrder(order: Order): Promise<void> {
    logger.debug("engine processing order: ", order);




    const seq = order.seq !== undefined ? BigInt(order.seq) : null;
    if (seq !== null && seq <= this.lastSeq) {
      logger.debug(`skipping already-applied order seq=${seq} (lastSeq=${this.lastSeq})`);
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
        this.orderbook?.cancelOrder(order.id!, order.userId);

        const remainingQuantity = order.quantity - order.filled;
        const userBalance = this.userBalance.get(order.userId);
        const userPosition = this.userPosition.get(order.userId);

        logger.debug("remaining quantity", remainingQuantity);
        logger.debug("user balance", userBalance);

        if (userBalance) {
          const refund = this.computeMarginRequirement(
            userPosition,
            order.entryPrice,
            remainingQuantity,
            order.leverage,
            order.side,
          );
          userBalance.availableBalance = userBalance.availableBalance.plus(refund);
          userBalance.lockedBalance = userBalance.lockedBalance.minus(refund);
        }
        logger.debug("cancelling order", order);

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
    if (seq !== null && seq <= this.lastBalanceSeq) {
      logger.debug(
        `skipping already-applied balance command seq=${seq} (lastBalanceSeq=${this.lastBalanceSeq})`,
      );
      return;
    }

    await this.ensureUser(command.userId);
    const balance = this.userBalance.get(command.userId)!;
    const amount = new Decimal(command.amount);

    if (command.type === "BALANCE-WITHDRAW") {
      if (balance.availableBalance.lessThan(amount)) {
        this.publishBalanceRejected(command, "Insufficient Balance");
        this.updateRedisLedger(command.id, "REJECTED");
        if (seq !== null && seq > this.lastBalanceSeq) this.lastBalanceSeq = seq;
        return;
      }
      balance.availableBalance = balance.availableBalance.minus(amount);
    } else {
      balance.availableBalance = balance.availableBalance.plus(amount);
    }

    this.publishUserBalance(command.userId);
    this.updateRedisBalance(command.userId);
    this.updateRedisLedger(command.id, "APPLIED");

    if (seq !== null && seq > this.lastBalanceSeq) this.lastBalanceSeq = seq;
    this.noteWrite();
  }

  async createOrder(
    id: string,
    userId: string,
    entryPrice: number,
    quantity: number,
    side: OrderSide,
    leverage: number,
  ) {
    logger.debug("create order entered");
    await this.ensureUser(userId);
    this.checkAndLockBalance(userId, entryPrice, quantity, leverage, side);

    const order: Order = {
      id,
      userId,
      side,
      entryPrice,
      quantity,
      leverage,
      filled: 0,
    };
    const { executedQty, fills, updatedOrders } = this.orderbook?.addOrder(order) ?? {
      executedQty: 0,
      fills: [],
      updatedOrders: [],
    };

    this.updateUserPnl(fills, executedQty, order);
    this.updateUserPosition(fills, executedQty, order);
    this.publishAndPersistBalances(order.userId, fills);
    this.publishLastTrade(fills);
    this.publishDepth();
    this.updateRedisDepth();
    this.updateRedisOrder({ ...order, filled: executedQty });
    for (const makerOrder of updatedOrders) {
      this.updateRedisOrder(makerOrder);
    }
    this.updateRedisFills(fills, order);
    this.updateRedisPosition(fills, order);
    logger.debug(executedQty, fills);
  }

  async createMarketOrder(id: string, userId: string, quantity: number, side: OrderSide, leverage: number) {
    logger.debug("create order entered");
    await this.ensureUser(userId);

    const referencePrice = this.orderbook?.getBestOppositePrice(side, quantity);
    if (!referencePrice) {


      throw new Error("No reference price found");
    }



    const prePos = this.userPosition.get(userId);
    const preSnapshot: UserPosition | undefined = prePos
      ? { ...prePos, side: prePos.side, quantity: prePos.quantity }
      : undefined;
    this.checkAndLockBalance(userId, referencePrice, quantity, leverage, side);

    const order: Order = {
      id,
      userId,
      side,
      entryPrice: referencePrice,
      quantity,
      leverage,
      filled: 0,
    };


    const { executedQty, fills, updatedOrders } = this.orderbook?.addOrder(order, false) ?? {
      executedQty: 0,
      fills: [],
      updatedOrders: [],
    };





    if (executedQty < quantity) {
      const lockedFull = this.computeMarginRequirement(preSnapshot, referencePrice, quantity, leverage, side);
      const lockedFilled = this.computeMarginRequirement(preSnapshot, referencePrice, executedQty, leverage, side);
      const refund = lockedFull.minus(lockedFilled);
      const balance = this.userBalance.get(userId);
      if (balance && refund.greaterThan(0)) {
        balance.availableBalance = balance.availableBalance.plus(refund);
        balance.lockedBalance = balance.lockedBalance.minus(refund);
      }
    }

    this.updateUserPnl(fills, executedQty, order);
    this.updateUserPosition(fills, executedQty, order);
    this.publishAndPersistBalances(order.userId, fills);
    this.publishLastTrade(fills);
    this.publishDepth();
    this.updateRedisDepth();
    this.updateRedisOrder({ ...order, filled: executedQty });
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
        liquidatedPrice: new Decimal(0),
        market: "BTCUSDT",
        leverage: 1,
      });
    }
  }


  computeMarginRequirement(
    userPosition: UserPosition | undefined,
    price: number,
    quantity: number,
    leverage: number,
    side: OrderSide,
  ): Decimal {
    const isOpposite =
      (side === "LONG" && userPosition?.side === "SHORT") ||
      (side === "SHORT" && userPosition?.side === "LONG");

    if (isOpposite && userPosition) {
      if (userPosition.quantity.gte(quantity)) return new Decimal(0);
      const excess = new Decimal(quantity).minus(userPosition.quantity);
      return new Decimal(price).times(excess).div(leverage);
    }

    return new Decimal(price).times(quantity).div(leverage);
  }

  checkAndLockBalance(
    userId: string,
    price: number,
    quantity: number,
    leverage: number,
    side: OrderSide,
  ) {
    const userPosition = this.userPosition.get(userId);
    const balance = this.userBalance.get(userId)!;

    const marginRequired = this.computeMarginRequirement(userPosition, price, quantity, leverage, side);
    if (marginRequired.isZero()) return;

    if (balance.availableBalance.lessThan(marginRequired)) {
      throw new Error("Insufficient Balance");
    }
    balance.availableBalance = balance.availableBalance.minus(marginRequired);
    balance.lockedBalance = balance.lockedBalance.plus(marginRequired);
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


  private refundFillImprovement(order: Order, openQty: Decimal, openNotional: Decimal): void {
    if (openQty.lessThanOrEqualTo(0)) return;
    const lockedNotional = new Decimal(order.entryPrice).times(openQty);
    const refund = lockedNotional.minus(openNotional).div(order.leverage);
    if (refund.isZero()) return;
    const balance = this.userBalance.get(order.userId);
    if (!balance) return;
    balance.availableBalance = balance.availableBalance.plus(refund);
    balance.lockedBalance = balance.lockedBalance.minus(refund);
  }

  updateUserPnl(fills: Fill[], executedQty: number, order: Order) {
    const userPosition = this.userPosition.get(order.userId);
    const userBalance = this.userBalance.get(order.userId)!;
    if (fills.length === 0 || !userPosition) return;

    const userSide = userPosition.side;
    const orderSide = order.side;



    const closingQty = Decimal.min(userPosition.quantity, executedQty);


    const positionLeverage = userPosition.leverage ?? order.leverage;
    const releasedMargin = userPosition.entryPrice.div(positionLeverage).times(closingQty);

    if (userSide === "LONG" && orderSide === "SHORT") {
      const pnl = this.realizedPnl(fills, userPosition.entryPrice, closingQty, "LONG");
      userBalance.availableBalance = userBalance.availableBalance.plus(releasedMargin).plus(pnl);
      userBalance.lockedBalance = userBalance.lockedBalance.minus(releasedMargin);
    }

    if (userSide === "SHORT" && orderSide === "LONG") {
      const pnl = this.realizedPnl(fills, userPosition.entryPrice, closingQty, "SHORT");
      userBalance.availableBalance = userBalance.availableBalance.plus(releasedMargin).plus(pnl);
      userBalance.lockedBalance = userBalance.lockedBalance.minus(releasedMargin);
    }
  }

  updateUserPosition(fills: Fill[], executedQty: number, order: Order) {
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
          this.refundFillImprovement(order, exec, newNotional);
        } else {




          if (userPosition.quantity.lessThan(exec)) {




            const remainingQty = exec.minus(userPosition.quantity);
            const openNotional = this.openingNotional(fills, userPosition.quantity);
            userPosition.side = "LONG";
            userPosition.quantity = remainingQty;
            userPosition.margin = openNotional.div(order.leverage);
            userPosition.entryPrice = openNotional.div(remainingQty);
            userPosition.leverage = order.leverage;
            this.refundFillImprovement(order, remainingQty, openNotional);
          } else if (userPosition.quantity.greaterThan(exec)) {


            userPosition.quantity = userPosition.quantity.minus(exec);



            const newMargin = userPosition.entryPrice.times(exec).div(userPosition.leverage ?? order.leverage);
            userPosition.margin = userPosition.margin.minus(newMargin);
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
          this.refundFillImprovement(order, exec, newNotional);
        } else {


          if (userPosition.quantity.lessThan(exec)) {



            const remainingQty = exec.minus(userPosition.quantity);
            const openNotional = this.openingNotional(fills, userPosition.quantity);
            userPosition.side = "SHORT";
            userPosition.quantity = remainingQty;
            userPosition.margin = openNotional.div(order.leverage);
            userPosition.entryPrice = openNotional.div(remainingQty);
            userPosition.leverage = order.leverage;
            this.refundFillImprovement(order, remainingQty, openNotional);
          } else if (userPosition.quantity.greaterThan(exec)) {


            userPosition.quantity = userPosition.quantity.minus(exec);



            const newMargin = userPosition.entryPrice.times(exec).div(userPosition.leverage ?? order.leverage);
            userPosition.margin = userPosition.margin.minus(newMargin);
          } else {
            userPosition.side = "UNINITIALIZED";
            userPosition.quantity = new Decimal(0);
            userPosition.margin = new Decimal(0);
            userPosition.entryPrice = new Decimal(0);
          }
        }
        break;
      default:
        if (executedQty && userPosition) {

          const openNotional = this.openingNotional(fills, new Decimal(0));
          userPosition.side = order.side;
          userPosition.entryPrice = openNotional.div(exec);
          userPosition.quantity = exec;


          userPosition.margin = openNotional.div(order.leverage);
          userPosition.leverage = order.leverage;
          this.refundFillImprovement(order, exec, openNotional);
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


              const newMargin = makerPosition.entryPrice
                .times(fillQty)
                .div(makerPosition.leverage ?? fill.otherLeverage);
              const pnl = fillPrice.minus(makerPosition.entryPrice).times(fillQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(newMargin).plus(pnl);
                makerBalance.lockedBalance = makerBalance.lockedBalance.minus(newMargin);
              }
              makerPosition.quantity = makerPosition.quantity.minus(fillQty);
              makerPosition.margin = makerPosition.margin.minus(newMargin);
            } else if (makerPosition.quantity.equals(fillQty)) {
              const pnl = fillPrice.minus(makerPosition.entryPrice).times(fillQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(makerPosition.margin).plus(pnl);
                makerBalance.lockedBalance = makerBalance.lockedBalance.minus(makerPosition.margin);
              }
              makerPosition.side = "UNINITIALIZED";
              makerPosition.quantity = new Decimal(0);
              makerPosition.margin = new Decimal(0);
              makerPosition.entryPrice = new Decimal(0);
            } else {



              const closedQty = makerPosition.quantity;
              const pnl = fillPrice.minus(makerPosition.entryPrice).times(closedQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(makerPosition.margin).plus(pnl);
                makerBalance.lockedBalance = makerBalance.lockedBalance.minus(makerPosition.margin);
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


              const newMargin = makerPosition.entryPrice
                .times(fillQty)
                .div(makerPosition.leverage ?? fill.otherLeverage);
              const pnl = makerPosition.entryPrice.minus(fillPrice).times(fillQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(newMargin).plus(pnl);
                makerBalance.lockedBalance = makerBalance.lockedBalance.minus(newMargin);
              }
              makerPosition.quantity = makerPosition.quantity.minus(fillQty);
              makerPosition.margin = makerPosition.margin.minus(newMargin);
            } else if (makerPosition.quantity.equals(fillQty)) {
              const pnl = makerPosition.entryPrice.minus(fillPrice).times(fillQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(makerPosition.margin).plus(pnl);
                makerBalance.lockedBalance = makerBalance.lockedBalance.minus(makerPosition.margin);
              }
              makerPosition.side = "UNINITIALIZED";
              makerPosition.quantity = new Decimal(0);
              makerPosition.margin = new Decimal(0);
              makerPosition.entryPrice = new Decimal(0);
            } else {



              const closedQty = makerPosition.quantity;
              const pnl = makerPosition.entryPrice.minus(fillPrice).times(closedQty);
              if (makerBalance) {
                makerBalance.availableBalance = makerBalance.availableBalance.plus(makerPosition.margin).plus(pnl);
                makerBalance.lockedBalance = makerBalance.lockedBalance.minus(makerPosition.margin);
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
      liquidatedPrice: p.liquidatedPrice.toFixed(8),
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
    this.publish(`trade:update`, {
      data: {
        p: lastFill?.price,
        q: lastFill?.quantity,
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
    const affected: string[] = [];
    for (const [userId, position] of this.userPosition.entries()) {
      const side = position.side;
      if (side === "UNINITIALIZED") continue;
      const fundingPayment = mark.times(position.quantity).times(rate);







      if (side === "LONG") {
        const next = position.margin.minus(fundingPayment);
        if (next.isNegative()) {
          logger.warn(
            `funding shortfall for ${userId}: payment ${fundingPayment.toFixed(8)} exceeds margin ${position.margin.toFixed(8)} (bad debt ${next.negated().toFixed(8)})`,
          );
          position.margin = new Decimal(0);
        } else {
          position.margin = next;
        }
      } else {
        position.margin = position.margin.plus(fundingPayment);
      }
      affected.push(userId);
    }

    if (seq !== null) this.lastFundingSeq = seq;




    for (const userId of affected) {
      const position = this.userPosition.get(userId);
      if (position) {
        this.emitEvent("update_position", {
          type: "POSITION_UPDATE",
          data: this.serializePosition(userId, position),
        });
      }
    }
    if (affected.length > 0) {
      this.positionUpdateForLiquidation();
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


    this.publish(`order:rejected@${order.userId}`, {
      data: {
        userId: order.userId,
        orderId: order.id,
        reason: error instanceof Error ? error.message : String(error),
      },
    });
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
