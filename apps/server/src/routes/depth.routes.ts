import { Router } from "express";
import { getDepth } from "../controllers/depth.controller.js";

const router: import("express").Router = Router();

router.get("/:marketId", getDepth);

export default router;
