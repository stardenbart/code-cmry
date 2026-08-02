import express from "express";
import { AiController } from "../controllers/aiController.js";
import { verifyJWT } from "../middleware/auth.js";

const router = express.Router();

// Every AI endpoint requires a logged-in user
router.use(verifyJWT);

router.get("/status", AiController.status);
router.get("/quota", AiController.quota);
router.put("/key", AiController.saveKey);
router.delete("/key", AiController.deleteKey);

// Universal (shared) key — Digital Transformer only, enforced in the controller
router.put("/universal-key", AiController.saveUniversalKey);
router.delete("/universal-key", AiController.deleteUniversalKey);
router.put("/model", AiController.saveModel);

router.post("/ask", AiController.ask);
router.post("/navigate", AiController.navigate);

router.get("/history/:dashboardId", AiController.history);
router.delete("/history/:dashboardId", AiController.clearHistory);

export default router;
