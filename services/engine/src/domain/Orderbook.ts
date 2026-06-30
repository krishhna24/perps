import { v4 as uuidv4 } from "uuid";
import { Decimal } from "@repo/types";
import { logger } from "@repo/logger";
import type {
  DepthLevel,
  Fill,
  MarketDepth,
  MatchResult,
  Order,
  OrderSide,
  OrderbookSnapshot,
} from "./types.js";

const d = (v: string): Decimal => new Decimal(v);

export class Orderbook {
  constructor(
    public bids: Order[] = [],
    public asks: Order[] = [],
    public market: string = "BTCUSDT",
  ) {
    this.bids = bids;
    this.asks = asks;
    this.market = market;

    this.sortOrders();
  }

  getSnapshot(): OrderbookSnapshot {
    return {
      bids: this.bids,
      asks: this.asks,
      market: this.market,
    };
  }

  private sortOrders() {
    this.bids.sort((a, b) => d(b.entryPrice).comparedTo(d(a.entryPrice)));
    this.asks.sort((a, b) => d(a.entryPrice).comparedTo(d(b.entryPrice)));
  }

  addOrder(order: Order, allowResting = true): MatchResult {
    if (order.side === "LONG") {
      const { executedQty, fills, updatedOrders } = this.matchBid(order);
      if (allowResting && executedQty.lessThan(order.quantity)) {
        this.bids.push({ ...order, filled: executedQty.toString() });
        this.sortOrders();
      }
      return { executedQty, fills, updatedOrders };
    } else {
      const { executedQty, fills, updatedOrders } = this.matchAsk(order);
      if (allowResting && executedQty.lessThan(order.quantity)) {
        this.asks.push({ ...order, filled: executedQty.toString() });
        this.sortOrders();
      }
      return { executedQty, fills, updatedOrders };
    }
  }

  matchAsk(order: Order): MatchResult {
    let executedQty = new Decimal(0);
    const fills: Fill[] = [];
    const updatedOrders: Order[] = [];
    const orderQty = d(order.quantity);
    const orderPrice = d(order.entryPrice);

    for (const bid of this.bids) {
      if (executedQty.greaterThanOrEqualTo(orderQty)) break;
      if (orderPrice.greaterThan(d(bid.entryPrice))) break;
      if (order.userId === bid.userId) continue;

      const remaining = d(bid.quantity).minus(bid.filled);
      if (remaining.lessThanOrEqualTo(0)) continue;
      const traded = Decimal.min(remaining, orderQty.minus(executedQty));
      executedQty = executedQty.plus(traded);
      bid.filled = d(bid.filled).plus(traded).toString();
      updatedOrders.push(bid);

      fills.push({
        fillId: uuidv4(),
        orderId: order.id!,
        userId: order.userId,
        otherUserId: bid.userId,
        otherOrderId: bid.id!,
        price: bid.entryPrice,
        quantity: traded.toString(),
        otherLeverage: bid.leverage,
      });
    }
    this.bids = this.bids.filter((bid) => d(bid.filled).lessThan(bid.quantity));
    return { executedQty, fills, updatedOrders };
  }

  matchBid(order: Order): MatchResult {
    let executedQty = new Decimal(0);
    const fills: Fill[] = [];
    const updatedOrders: Order[] = [];
    const orderQty = d(order.quantity);
    const orderPrice = d(order.entryPrice);

    for (const ask of this.asks) {
      if (executedQty.greaterThanOrEqualTo(orderQty)) break;
      if (orderPrice.lessThan(d(ask.entryPrice))) break;
      if (order.userId === ask.userId) continue;

      const remaining = d(ask.quantity).minus(ask.filled);
      if (remaining.lessThanOrEqualTo(0)) continue;
      const traded = Decimal.min(remaining, orderQty.minus(executedQty));
      executedQty = executedQty.plus(traded);
      ask.filled = d(ask.filled).plus(traded).toString();
      updatedOrders.push(ask);

      fills.push({
        fillId: uuidv4(),
        orderId: order.id!,
        userId: order.userId,
        otherUserId: ask.userId,
        otherOrderId: ask.id!,
        price: ask.entryPrice,
        quantity: traded.toString(),
        otherLeverage: ask.leverage,
      });
    }
    this.asks = this.asks.filter((ask) => d(ask.filled).lessThan(ask.quantity));
    return { executedQty, fills, updatedOrders };
  }

  getMarketDepth(): MarketDepth {
    return {
      asks: this.aggregateByPrice(this.asks, false),
      bids: this.aggregateByPrice(this.bids, true),
    };
  }

  private aggregateByPrice(orders: Order[], descending = true): DepthLevel[] {
    const priceMap = new Map<string, Decimal>();

    orders.forEach((order) => {
      const remaining = d(order.quantity).minus(order.filled);
      if (remaining.greaterThan(0)) {
        priceMap.set(order.entryPrice, (priceMap.get(order.entryPrice) ?? new Decimal(0)).plus(remaining));
      }
    });

    const entries: DepthLevel[] = Array.from(priceMap.entries()).map(([price, quantity]) => [
      price,
      quantity.toString(),
    ]);

    return descending
      ? entries.sort((a, b) => new Decimal(b[0]).comparedTo(a[0]))
      : entries.sort((a, b) => new Decimal(a[0]).comparedTo(b[0]));
  }

  getOpenOrders(userId: string): Order[] {
    const userBids = this.bids.filter((bid) => bid.userId === userId);
    const userAsks = this.asks.filter((ask) => ask.userId === userId);

    return [...userAsks, ...userBids];
  }

  cancelOrder(orderId: string, userId: string): Order | null {
    const bidIndex = this.bids.findIndex((bid) => bid.userId === userId && bid.id === orderId);
    if (bidIndex !== -1) {
      const [removed] = this.bids.splice(bidIndex, 1);
      logger.debug("order cancelled");
      return removed ?? null;
    }
    const askIndex = this.asks.findIndex((ask) => ask.userId === userId && ask.id === orderId);
    if (askIndex !== -1) {
      const [removed] = this.asks.splice(askIndex, 1);
      logger.debug("order cancelled");
      return removed ?? null;
    }
    return null;
  }

  getBestOppositePrice(side: OrderSide, quantity: string): string | undefined {
    const levels = side === "LONG" ? this.asks : this.bids;
    const target = d(quantity);
    let bestPrice: string | undefined;
    let fillQuantity = new Decimal(0);
    for (const level of levels) {
      const remaining = d(level.quantity).minus(level.filled);
      if (remaining.lessThanOrEqualTo(0)) continue;
      bestPrice = level.entryPrice;
      fillQuantity = fillQuantity.plus(remaining);
      if (fillQuantity.greaterThanOrEqualTo(target)) break;
    }
    return bestPrice;
  }
}
