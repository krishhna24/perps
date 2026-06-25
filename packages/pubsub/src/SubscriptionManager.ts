import { createClient } from "redis";
import { redisSocket } from "./connection.js";

type RedisClient = ReturnType<typeof createClient>;

export class SubscriptionManager {
  private static instance: SubscriptionManager;
  private client: RedisClient;

  private constructor() {
    this.client = createClient({ socket: redisSocket() });

    this.client.on("error", (err: unknown) => console.error("Redis subscriber error:", err));
    void this.client.connect().catch((err: unknown) => {
      console.error("Redis connection failed (subscriber), retrying:", err);
    });
  }

  static getInstance(): SubscriptionManager {
    if (!SubscriptionManager.instance) {
      SubscriptionManager.instance = new SubscriptionManager();
    }
    return SubscriptionManager.instance;
  }

  subscribe(channel: string, handler: (data: unknown) => void): void {
    void this.client.subscribe(channel, (message) => {
      try {
        handler(JSON.parse(message) as unknown);
      } catch {
        handler(message);
      }
    });
  }

  unsubscribe(channel: string): void {
    void this.client.unsubscribe(channel);
  }
}
