import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { internalAuthMiddleware } from "../middlewares/internalAuth.middleware.js";
import { getOrders, createOrder, cancelOrder } from "../controllers/orders.controller.js";

const router: import("express").Router = Router();



router.post("/internal/liquidate", internalAuthMiddleware, createOrder);

router.use(authMiddleware);

router.get("/", getOrders);
router.post("/", createOrder);
router.delete("/:orderId", cancelOrder);

export default router;
