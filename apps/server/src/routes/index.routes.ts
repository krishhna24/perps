import { Router } from "express";
import authRoutes from "./auth.routes.js";
import balanceRoutes from "./balance.routes.js";
import depthRoutes from "./depth.routes.js";
import ordersRoutes from "./orders.routes.js";
import positionsRoutes from "./positions.routes.js";

const router: import("express").Router = Router();

router.use("/auth", authRoutes);
router.use("/balance", balanceRoutes);
router.use("/depth", depthRoutes);
router.use("/orders", ordersRoutes);
router.use("/positions", positionsRoutes);

export default router;
