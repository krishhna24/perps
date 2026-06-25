import { createClient } from "redis";
import { redisSocket } from "./connection.js";

type RedisClient = ReturnType<typeof createClient>;

export class RedisManager {
  private static instance: RedisManager;
  private client: RedisClient;

  private constructor() {
    this.client = createClient({ socket: redisSocket() });

    this.client.on("error", (err: unknown) => console.error("Redis publisher error:", err));
    void this.client.connect().catch((err: unknown) => {
      console.error("Redis connection failed (publisher), retrying:", err);
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
}
