import { Router } from "express";
import { getMarket, listMarkets } from "../controllers/markets.controller.js";

const router: import("express").Router = Router();

router.get("/", listMarkets);
router.get("/:marketId", getMarket);

export default router;
