import { prisma } from "@repo/db";
import { Decimal } from "@repo/types";

type PositionSide = "LONG" | "SHORT" | "UNINITIALIZED";

interface OrderUpdateData {
  id?: string;
  quantity: string;
  filled: string;
}

interface CancelOrderData {
  orderId: string;
}

interface RejectOrderData {
  orderId: string;
  reason: string;
}

interface DepthUpdateData {
  bids: [string, string][];
  asks: [string, string][];
}

interface BalanceUpdateData {
  userId: string;
  availableBalance: string;
  lockedBalance: string;
}

interface LedgerUpdateData {
  ledgerId: string;
  status: "APPLIED" | "REJECTED";
}

interface FillUpdateData {
  fillId: string;
  orderId: string;
  userId: string;
  otherUserId: string;
  otherOrderId: string;
  price: string;
  quantity: string;
  otherLeverage: number;
}

interface PositionUpdateData {
  userId: string;
  side: PositionSide;

  quantity: string;
  entryPrice: string;
  margin: string;
  unrealizedPnl: string;
  liquidatedPrice: string;
  leverage?: number;
}

const MARKET_SYMBOL = "BTCUSDT";

let marketIdPromise: Promise<string> | null = null;

function getMarketId(): Promise<string> {
  if (!marketIdPromise) {
    marketIdPromise = prisma.market
      .findUniqueOrThrow({ where: { symbol: MARKET_SYMBOL } })
      .then((market) => market.id)
      .catch((error: unknown) => {
        marketIdPromise = null;
        throw error;
      });
  }
  return marketIdPromise;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function persistOrderUpdate(data: OrderUpdateData): Promise<void> {
  if (!data.id) return;
  const quantity = new Decimal(data.quantity);
  const filled = new Decimal(data.filled);
  const status = filled.greaterThanOrEqualTo(quantity)
    ? "FILLED"
    : filled.greaterThan(0)
      ? "PARTIALLY_FILLED"
      : "PENDING";
  await prisma.order.update({
    where: { id: data.id },
    data: { filledQuantity: data.filled, status },
  });
}

async function persistCancelOrder(data: CancelOrderData): Promise<void> {
  await prisma.order.updateMany({
    where: { id: data.orderId, status: { in: ["PENDING", "PARTIALLY_FILLED"] } },
    data: { status: "CANCELLED" },
  });
}

async function persistRejectOrder(data: RejectOrderData): Promise<void> {
  await prisma.order.updateMany({
    where: { id: data.orderId, status: { in: ["PENDING", "PARTIALLY_FILLED"] } },
    data: { status: "REJECTED" },
  });
}

async function persistBalanceUpdate(data: BalanceUpdateData): Promise<void> {

  await prisma.balance.update({
    where: { userId: data.userId },
    data: {
      availableMargin: data.availableBalance,
      lockedMargin: data.lockedBalance,
    },
  });
}

async function persistLedgerUpdate(data: LedgerUpdateData): Promise<void> {

  await prisma.ledgerEntry.update({
    where: { id: data.ledgerId },
    data: { status: data.status },
  });
}

async function persistFillUpdate(data: FillUpdateData): Promise<void> {
  const marketId = await getMarketId();
  try {
    await prisma.fill.create({
      data: {

        id: data.fillId,
        marketId,
        makerOrderId: data.otherOrderId,
        makerUserId: data.otherUserId,
        takerOrderId: data.orderId,
        takerUserId: data.userId,
        quantity: data.quantity,
        price: data.price,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) {
      throw error;
    }
  }
}

async function persistPositionUpdate(data: PositionUpdateData): Promise<void> {
  const marketId = await getMarketId();

  const size =
    data.side === "LONG" ? data.quantity : data.side === "SHORT" ? `-${data.quantity}` : "0";
  const status = data.side === "UNINITIALIZED" ? "CLOSED" : "OPEN";

  await prisma.position.upsert({
    where: { userId_marketId: { userId: data.userId, marketId } },
    create: {
      userId: data.userId,
      marketId,
      size,
      entryPrice: data.entryPrice,
      liquidationPrice: data.liquidatedPrice,
      leverage: data.leverage ?? 1,
      margin: data.margin,
      unrealizedPnl: data.unrealizedPnl,
      status,
    },
    update: {
      size,
      entryPrice: data.entryPrice,
      liquidationPrice: data.liquidatedPrice,
      leverage: data.leverage ?? 1,
      margin: data.margin,
      unrealizedPnl: data.unrealizedPnl,
      status,
    },
  });
}

async function persistDepthUpdate(data: DepthUpdateData): Promise<void> {

  const marketId = await getMarketId();
  await prisma.depth.upsert({
    where: { id: marketId },
    create: { id: marketId, bids: data.bids, asks: data.asks },
    update: { bids: data.bids, asks: data.asks },
  });
}

export async function persistEvent(type: string, data: unknown): Promise<void> {
  switch (type) {
    case "BALANCE_UPDATE":
      await persistBalanceUpdate(data as BalanceUpdateData);
      break;
    case "LEDGER_UPDATE":
      await persistLedgerUpdate(data as LedgerUpdateData);
      break;
    case "ORDER_UPDATE":
      await persistOrderUpdate(data as OrderUpdateData);
      break;
    case "CANCEL_ORDER":
      await persistCancelOrder(data as CancelOrderData);
      break;
    case "ORDER_REJECTED":
      await persistRejectOrder(data as RejectOrderData);
      break;
    case "FILL_UPDATE":
      await persistFillUpdate(data as FillUpdateData);
      break;
    case "POSITION_UPDATE":
      await persistPositionUpdate(data as PositionUpdateData);
      break;
    case "DEPTH_UPDATE":
      await persistDepthUpdate(data as DepthUpdateData);
      break;
    default:
      break;
  }
}
