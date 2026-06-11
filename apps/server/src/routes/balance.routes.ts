import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getBalance, deposit, withdraw } from "../controllers/balance.controller.js";

const router: import("express").Router = Router();

router.use(authMiddleware);

router.get("/", getBalance);
router.post("/deposit", deposit);
router.post("/withdraw", withdraw);

export default router;
