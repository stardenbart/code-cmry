import express from "express";
import { AiController } from "../controllers/aiController.js";
import { verifyJWT } from "../middleware/auth.js";
import { requireAdmin, requireCiaAccess } from "../middleware/authorize.js";
import { getUserConversations, getConversation, getTurns, clearConversation } from "../services/unifiedConversationManager.js";

const router = express.Router();

// Every AI endpoint requires a logged-in user
router.use(verifyJWT);

router.get("/status", AiController.status);
router.get("/quota", AiController.quota);
router.put("/key", AiController.saveKey);
router.delete("/key", AiController.deleteKey);

// Universal (shared) key — Digital Transformer only, enforced in the controller
router.get("/provider", AiController.provider);
router.put("/provider", requireAdmin, AiController.saveProvider);
router.put("/universal-key", requireAdmin, AiController.saveUniversalKey);
router.delete("/universal-key", requireAdmin, AiController.deleteUniversalKey);

// Cakupan penjawab lokal. Admin saja: isinya pola pemakaian seluruh user.
router.get("/coverage", requireAdmin, AiController.coverage);
router.put("/model", AiController.saveModel);

// ── Pemakaian CIA ────────────────────────────────────────────────────────────
//
// Semua rute di bawah ini menuntut akses CIA yang dibuka admin per user.
// Penjagaannya di SERVER, bukan hanya menyembunyikan tombol di web: endpoint ini
// tetap bisa dipanggil langsung oleh siapa pun yang punya token.
//
// Rute setelan di atas SENGAJA tidak ikut dijaga. /status justru harus tetap
// bisa dibaca supaya web tahu harus menyembunyikan pintu masuknya, dan pengelola
// kunci sudah punya penjaga adminnya sendiri.
router.post("/ask", requireCiaAccess, AiController.ask);
router.post("/navigate", requireCiaAccess, AiController.navigate);
router.get("/finding", requireCiaAccess, AiController.findings);
router.post("/finding/distill", requireCiaAccess, AiController.distillFindings);

router.get("/history/:dashboardId", requireCiaAccess, AiController.history);
router.delete("/history/:dashboardId", requireCiaAccess, AiController.clearHistory);

// ── Unified Chat (multi-dashboard, single conversation) ─────────────────────
router.post("/unified/ask", requireCiaAccess, AiController.unifiedAsk);

router.get("/unified/conversations", requireCiaAccess, async (req, res) => {
  try {
    const conversations = await getUserConversations(req.user.id, 10);
    return res.json({ conversations });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/unified/conversations/:id/turns", requireCiaAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const conv = await getConversation(id, req.user.id);
    if (!conv) return res.status(403).json({ error: 'Not found' });

    const turns = await getTurns(id, 100);
    return res.json({ turns });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/unified/conversations/:id", requireCiaAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const conv = await getConversation(id, req.user.id);
    if (!conv) return res.status(403).json({ error: 'Not found' });

    await clearConversation(id);
    return res.json({ deleted: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
