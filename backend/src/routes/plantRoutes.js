// Route Plant/Department. GET hanya butuh login (dipakai dropdown & sidebar);
// mutasi wajib requireAdmin.
import express from "express";
import { requireAdmin } from "../middleware/authorize.js";
import {
  listPlantsWithDepartments, createPlant, updatePlant, deletePlant,
  createDepartment, updateDepartment, deleteDepartment,
} from "../models/plantModel.js";

const router = express.Router();

function fail(res, err) {
  if (err && err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ message: "Nama/kode sudah dipakai" });
  }
  console.error("❌ plant route error:", err?.code || err?.message);
  return res.status(500).json({ message: "Gagal memproses plant/department" });
}

router.get("/", async (_req, res) => {
  try { res.json(await listPlantsWithDepartments()); }
  catch (err) { fail(res, err); }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    const { name, code } = req.body || {};
    if (!name || !String(name).trim() || !code || !String(code).trim()) {
      return res.status(400).json({ message: "name dan code wajib diisi" });
    }
    const id = await createPlant({ name, code });
    res.status(201).json({ id });
  } catch (err) { fail(res, err); }
});

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { name, code, active = true } = req.body || {};
    if (!name || !code) return res.status(400).json({ message: "name dan code wajib diisi" });
    const okUpd = await updatePlant(Number(req.params.id), { name, code, active });
    if (!okUpd) return res.status(404).json({ message: "Plant tidak ditemukan" });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const okDel = await deletePlant(Number(req.params.id));
    if (!okDel) return res.status(404).json({ message: "Plant tidak ditemukan" });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// ── Departments ──────────────────────────────────────────────────────────────
router.post("/:plantId/departments", requireAdmin, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ message: "name wajib diisi" });
    const id = await createDepartment({ plantId: Number(req.params.plantId), name });
    res.status(201).json({ id });
  } catch (err) { fail(res, err); }
});

router.put("/departments/:id", requireAdmin, async (req, res) => {
  try {
    const { name, active = true } = req.body || {};
    if (!name) return res.status(400).json({ message: "name wajib diisi" });
    const okUpd = await updateDepartment(Number(req.params.id), { name, active });
    if (!okUpd) return res.status(404).json({ message: "Department tidak ditemukan" });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.delete("/departments/:id", requireAdmin, async (req, res) => {
  try {
    const okDel = await deleteDepartment(Number(req.params.id));
    if (!okDel) return res.status(404).json({ message: "Department tidak ditemukan" });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

export default router;
