import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

export class SubscriptionManager {
  private static instance: SubscriptionManager;
  private client: RedisClient;

  private constructor() {
    this.client = createClient({ url: process.env["REDIS_URL"] });



    this.client.on("error", (err: unknown) => console.error("Redis subscriber error:", err));
    void this.client.connect().catch((err: unknown) => {
      console.error("Redis connection failed (subscriber):", err);
      process.exit(1);
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
