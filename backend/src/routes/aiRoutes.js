import express from "express";
import { AiController } from "../controllers/aiController.js";
import { verifyJWT } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/authorize.js";

const router = express.Router();

// Every AI endpoint requires a logged-in user
router.use(verifyJWT);

router.get("/status", AiController.status);
router.get("/quota", AiController.quota);
router.put("/key", AiController.saveKey);
router.delete("/key", AiController.deleteKey);

// Universal (shared) key — Digital Transformer only, enforced in the controller
router.put("/universal-key", requireAdmin, AiController.saveUniversalKey);
router.delete("/universal-key", requireAdmin, AiController.deleteUniversalKey);

// Cakupan penjawab lokal. Admin saja: isinya pola pemakaian seluruh user.
router.get("/coverage", requireAdmin, AiController.coverage);
router.put("/model", AiController.saveModel);

router.post("/ask", AiController.ask);
router.post("/navigate", AiController.navigate);
router.get("/finding", AiController.findings);
router.post("/finding/distill", AiController.distillFindings);

router.get("/history/:dashboardId", AiController.history);
router.delete("/history/:dashboardId", AiController.clearHistory);

export default router;
