// Setelan laporan performa harian.
//
// Rute TERPISAH dari manajemen user, sesuai permintaan pemilik proyek: ini
// setelan operasional, bukan pengelolaan akun, dan menaruhnya di layar yang sama
// membuat dua hal dengan risiko berbeda tampak setara.
import express from "express";
import { verifyJWT } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/authorize.js";
import { ambilSetelan, simpanSetelan } from "../models/reportSettingModel.js";
import { ringkasJadwal, FREKUENSI_SAH } from "../services/reportSchedule.js";
import { hasGlmKey } from "../config/glm.js";

const router = express.Router();

router.use(verifyJWT);

/**
 * GET /api/report-setting
 *
 * Bisa dibaca semua user yang login. Jadwal laporan bukan rahasia, dan orang
 * yang bertanya "kok laporannya belum masuk" seharusnya bisa memeriksa sendiri
 * jadwalnya alih-alih menunggu admin.
 */
router.get("/", async (_req, res) => {
  try {
    const setelan = await ambilSetelan();
    res.json({
      ...setelan,
      ringkasan: ringkasJadwal(setelan),
      frekuensiSah: FREKUENSI_SAH,
      // Tanpa kunci, pilihan GLM tersimpan tapi tidak pernah dipakai. Disebut
      // apa adanya supaya admin tidak mengira setelannya gagal disimpan.
      glmSiap: hasGlmKey(),
    });
  } catch (err) {
    console.error("❌ report-setting get error:", err);
    res.status(500).json({ message: "Gagal membaca setelan laporan" });
  }
});

/** PUT /api/report-setting — admin saja. */
router.put("/", requireAdmin, async (req, res) => {
  try {
    const hasil = await simpanSetelan(req.body || {}, req.user?.id);
    if (!hasil.disimpan) {
      // 400 dengan alasan yang bisa ditindaklanjuti, bukan "gagal menyimpan".
      // Setelan jadwal yang ditolak tanpa alasan membuat admin menebak-nebak
      // kolom mana yang salah.
      return res.status(400).json({ message: hasil.alasan });
    }

    const setelan = await ambilSetelan();
    res.json({
      message: "Setelan laporan diperbarui",
      ...setelan,
      ringkasan: ringkasJadwal(setelan),
      glmSiap: hasGlmKey(),
    });
  } catch (err) {
    console.error("❌ report-setting put error:", err);
    res.status(500).json({ message: "Gagal menyimpan setelan laporan" });
  }
});

export default router;
