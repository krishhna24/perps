import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getPositions, closePosition } from "../controllers/positions.controller.js";

const router: import("express").Router = Router();

router.use(authMiddleware);

router.get("/", getPositions);
router.delete("/:positionId", closePosition);

export default router;
