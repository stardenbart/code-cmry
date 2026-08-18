import express from "express";
import { AiController } from "../controllers/aiController.js";
import { verifyJWT } from "../middleware/auth.js";
import { requireAdmin, requireCiaAccess } from "../middleware/authorize.js";
import {
  getUserConversations, getConversation, getTurns, hapusConversation,
  pemakaianByte, BATAS_BYTE_PER_USER,
} from "../services/unifiedConversationManager.js";

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

// ── Chat CIA lintas dashboard ────────────────────────────────────────────────
router.post("/unified/ask", requireCiaAccess, AiController.unifiedAsk);

// Dashboard mana yang relevan untuk pertanyaan ini, tanpa menarik datanya.
// Inilah jalur "dashboard direkomendasikan": user melempar pertanyaan lebih
// dulu, sistem yang memilihkan dashboardnya.
router.post("/unified/suggest", requireCiaAccess, AiController.unifiedSuggest);

router.get("/unified/conversations", requireCiaAccess, async (req, res) => {
  try {
    const conversations = await getUserConversations(req.user.id, 30);
    const terpakai = await pemakaianByte(req.user.id);
    return res.json({
      conversations,
      penyimpanan: { terpakai, batas: BATAS_BYTE_PER_USER },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/unified/conversations/:id/turns", requireCiaAccess, async (req, res) => {
  try {
    const conv = await getConversation(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: "Percakapan tidak ditemukan." });

    // Seluruh isi utas saat dibuka kembali, bukan enam terakhir: yang dibatasi
    // adalah muatan ke model, bukan yang dibaca user di layarnya sendiri.
    const turns = await getTurns(req.params.id, 200);
    return res.json({ conversation: conv, turns });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/unified/conversations/:id", requireCiaAccess, async (req, res) => {
  try {
    const conv = await getConversation(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: "Percakapan tidak ditemukan." });

    // Membuang percakapannya, bukan hanya mengosongkan turn-nya. Versi
    // sebelumnya memanggil clearConversation, jadi baris percakapan kosong
    // tetap tinggal di daftar riwayat dan user melihat utas yang tidak bisa
    // dibuka isinya.
    await hapusConversation(req.params.id);
    return res.json({ deleted: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
