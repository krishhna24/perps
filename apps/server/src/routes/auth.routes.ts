import { Router } from "express";
import { register, login, logout } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router: import("express").Router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", authMiddleware, logout);

export default router;
