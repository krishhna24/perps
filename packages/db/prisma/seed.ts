import { prisma } from "../src/index.js";


const MARKET_ID = process.env.MARKET_ID ?? "cmqgd206q00002bxy0wavuaff";

async function main(): Promise<void> {
  const config = {


    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    tickSize: "0.1",
    lotSize: "0.001",
    minQty: 0n,
    maxLeverage: 125,
    maintenanceMarginRate: 50n,
    takerFeeBps: 0,
    makerFeeBps: 0,
  };



  const market = await prisma.market.upsert({
    where: { id: MARKET_ID },
    update: config,
    create: { id: MARKET_ID, ...config },
  });

  console.log(`seeded market ${market.symbol} (${market.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
