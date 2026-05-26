import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

export class RedisManager {
  private static instance: RedisManager;
  private client: RedisClient;

  private constructor() {
    this.client = createClient({ url: process.env["REDIS_URL"] });

    this.client.on("error", (err: unknown) => console.error("Redis publisher error:", err));
    void this.client.connect().catch((err: unknown) => {
      console.error("Redis connection failed (publisher):", err);
      process.exit(1);
    });
  }

  static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  publish(channel: string, message: unknown): void {
    void this.client.publish(channel, JSON.stringify(message));
  }


  publishToChannel(channel: string, message: unknown): void {
    this.publish(channel, message);
  }

  updateHash(key: string, data: Record<string, string>): void {
    void this.client.hSet(key, data);
  }
}
