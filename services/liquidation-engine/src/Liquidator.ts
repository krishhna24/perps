import { SubscriptionManager } from "@repo/pubsub";
import { liquidationQueue } from "@repo/queue";
import { Decimal } from "@repo/types";
import { computeLiquidationQty, type Position } from "./computeLiquidationQty.js";

const INFLIGHT_TIMEOUT_MS = 30_000;

interface InFlight {
  fingerprint: string;
  at: number;
}

export class Liquidator {
  private latestMarkPrice: Decimal | null = null;
  private userPositions = new Map<string, Position>();
  private inFlight = new Map<string, InFlight>();

  constructor() {
    const sub = SubscriptionManager.getInstance();

    sub.subscribe("markPrice:update", (raw: unknown) => {
      this.latestMarkPrice = new Decimal(raw as string);
      this.checkAllPositions();
    });

    sub.subscribe("position:update", (raw: unknown) => {
      const payload = raw as { data: Position[] };
      this.userPositions.clear();
      for (const position of payload.data) {
        this.userPositions.set(position.userId, position);
      }
      this.checkAllPositions();
    });
  }

  private fingerprint(position: Position): string {
    return `${position.side}:${position.quantity}:${position.margin}:${position.entryPrice}`;
  }

  private reapInFlight(): void {
    const now = Date.now();
    for (const [userId, entry] of this.inFlight.entries()) {
      const position = this.userPositions.get(userId);
      const settled = !position || this.fingerprint(position) !== entry.fingerprint;
      if (settled || now - entry.at > INFLIGHT_TIMEOUT_MS) {
        this.inFlight.delete(userId);
      }
    }
  }

  private checkAllPositions(): void {
    if (this.latestMarkPrice === null) return;
    this.reapInFlight();
    for (const [userId, position] of this.userPositions.entries()) {
      if (position.side === "UNINITIALIZED") continue;
      if (this.inFlight.has(userId)) continue;
      const liquidationQty = computeLiquidationQty(position, this.latestMarkPrice);
      if (liquidationQty !== null && liquidationQty.greaterThan(0)) {
        this.enqueueLiquidation(userId, position, liquidationQty);
      }
    }
  }

  private enqueueLiquidation(userId: string, position: Position, liquidationQty: Decimal): void {
    this.inFlight.set(userId, { fingerprint: this.fingerprint(position), at: Date.now() });

    void liquidationQueue.add(
      "liquidate_order",
      {
        ...position,
        userId,

        liquidationQty: liquidationQty.toFixed(8),
      },
      {
        jobId: userId,
        removeOnComplete: true,

        removeOnFail: true,

        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
      },
    );
  }
}
