import express     from "express";
import multer      from "multer";
import path        from "path";
import fs          from "fs";
import jwt         from "jsonwebtoken";
import { fileURLToPath } from "url";
import { PortalLinkModel } from "../models/portalLinkModel.js";

const router    = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Multer: save uploaded images to backend/uploads/ ─────────────────────────
const uploadDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `portal_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (/\.(jpe?g|png|webp|gif|svg)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ── Admin-only middleware ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token missing" });
  jwt.verify(token, process.env.JWT_SECRET || "jwt_secret_key", (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired token" });
    if (decoded.username !== "digital.transformation")
      return res.status(403).json({ message: "Admin access required" });
    req.user = decoded;
    next();
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET active links — public, no auth
router.get("/", async (req, res) => {
  try {
    res.json(await PortalLinkModel.getActive());
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

// GET all (including hidden) — admin
router.get("/all", requireAdmin, async (req, res) => {
  try {
    res.json(await PortalLinkModel.getAll());
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

// POST create — admin + optional image upload
router.post("/", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const { title, url, sort_order } = req.body;
    if (!title || !url) return res.status(400).json({ message: "Title and URL are required" });

    const image_url = req.file
      ? `${process.env.BACKEND_URL}/uploads/${req.file.filename}`
      : req.body.image_url || null;

    const result = await PortalLinkModel.create({
      title, url, image_url, sort_order: parseInt(sort_order) || 0,
    });
    res.status(201).json({ id: result.insertId, message: "Link created" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT update — admin + optional image upload
router.put("/:id", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const { title, url, sort_order, active } = req.body;
    const image_url = req.file
      ? `${process.env.BACKEND_URL}/uploads/${req.file.filename}`
      : req.body.image_url ?? null;

    await PortalLinkModel.update(req.params.id, {
      title, url, image_url,
      sort_order: parseInt(sort_order) || 0,
      active:     (active === "false" || active === "0") ? 0 : 1,
    });
    res.json({ message: "Link updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE — admin
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await PortalLinkModel.remove(req.params.id);
    res.json({ message: "Link deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
