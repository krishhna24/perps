import { Router } from "express";
import authRoutes from "./auth.routes.js";
import balanceRoutes from "./balance.routes.js";
import depthRoutes from "./depth.routes.js";
import marketsRoutes from "./markets.routes.js";
import ordersRoutes from "./orders.routes.js";
import positionsRoutes from "./positions.routes.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getWsTicket } from "../controllers/wsTicket.controller.js";

const router: import("express").Router = Router();

router.post("/ws-ticket", authMiddleware, getWsTicket);

router.use("/auth", authRoutes);
router.use("/balance", balanceRoutes);
router.use("/depth", depthRoutes);
router.use("/markets", marketsRoutes);
router.use("/orders", ordersRoutes);
router.use("/positions", positionsRoutes);

export default router;
