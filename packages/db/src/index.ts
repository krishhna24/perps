import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };
export type {
  User,
  Balance,
  Market,
  Order,
  Fill,
  Position,
  FundingRate,
  Depth,
  LedgerEntry,
} from "../generated/prisma/client.js";
export type {
  TradeSide,
  OrderType,
  OrderStatus,
  PositionStatus,
  LedgerEntryType,
  LedgerStatus,
} from "../generated/prisma/enums.js";
