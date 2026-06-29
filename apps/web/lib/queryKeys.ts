export const qk = {
  markets: ["markets"] as const,
  balance: ["balance"] as const,
  positions: ["positions"] as const,
  orders: ["orders"] as const,
  depth: (marketId: string) => ["depth", marketId] as const,
};
