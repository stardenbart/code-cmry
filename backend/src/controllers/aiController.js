import crypto from "crypto";
import db from "../config/db.js";
import { startCiaTelemetry } from "../services/ciaTelemetry.service.js";
import { AiModel } from "../models/aiModel.js";
import { maskSecret } from "../config/secretBox.js";
import {
  askGemini,
  validateKey,
  getServerKey,
  hasServerKey,
  normalizeModel,
  DEFAULT_MODEL,
  ALLOWED_MODELS,
  GeminiError,
} from "../config/gemini.js";
import {
  buildDataContext,
  buildSystemPrompt,
  buildUserMessage,
  answerNeedsMoreData,
  TIER_CHAR_BUDGET,
} from "../services/aiContext.js";
import { callAI, nextTier, TIER_LABELS, TIERS, tierModel } from "../services/aiProvider.js";
import { classify, resolveTier, shouldEscalate } from "../services/aiRouter.js";
import * as aiQuota from "../services/aiQuota.js";
import * as aiCache from "../services/aiCache.js";
import {
  buildCatalog, buildNavigatorPrompt, parseNavigatorReply, resolveDashboardRefs,
} from "../services/aiNavigator.js";
import { classifyRelevantDashboards } from "../services/dashboardRelevanceClassifier.js";
import {
  createConversation, addTurn, getTurns, getConversation,
  hitungTurn, ingatanLintasPercakapan, pangkasSampaiMuat,
} from "../services/unifiedConversationManager.js";
import { buildMultiDashboardContext } from "../services/aiContext.js";
import { simpanTemuan, temuanAktif, turnTerakhirTersaring, JAM_JENDELA }
  from "../models/findingModel.js";
import {
  instruksiPenyaring, susunPermintaanPenyaring, bacaHasilPenyaring,
} from "../services/findingDistiller.js";
import { susunKonteksTemuan, aturanTemuanUntukInstruksi } from "../services/findingContext.js";
import { ringkasKatalogUntukPengalihan, aturanPengalihanUntukInstruksi }
  from "../services/dashboardRedirect.js";
import * as aiSettings from "../services/aiSettings.js";
import { buildKnowledgeBlock, isUnmappedModel, getGlossaryRows } from "../services/aiKnowledge.js";
import { providerTerpilih, simpanProvider, PROVIDER_SAH, PROVIDER_DEFAULT } from "../services/modelRouter.js";
import { hasGlmKey } from "../config/glm.js";
import { tryAnswerLocally, AMBANG_KEYAKINAN } from "../services/aiLocalAnswer.js";
import * as rateLimit from "../services/rateLimiter.js";
import { getSanitizer, SANITIZER_CONFIG } from "../services/aiSanitizer.js";

const sql = db.promise();

const RATE_WINDOW_SECONDS = Number(process.env.AI_RATE_WINDOW_SECONDS ?? 60);
const RATE_MAX_REQUESTS = Number(process.env.AI_RATE_MAX_REQUESTS ?? 10);

// Sebab kegagalan router yang BUKAN salah pertanyaan user. Alasan di luar
// tabel ini (no_relevant_dashboards) memang berarti tidak ada yang cocok.
const GAGAL_TEKNIS_ROUTER = {
  classifier_error: "Layanan AI sedang tidak bisa dihubungi, jadi dashboard yang relevan belum bisa ditentukan. Pertanyaanmu sudah benar - coba kirim ulang sebentar lagi, atau pilih sendiri dashboard-nya di panel sebelah.",
  // Kuota harian: menunggu beberapa menit tidak menolong, jatahnya baru pulih
  // besok. Menyuruh user "coba lagi sebentar lagi" di sini membuang waktunya.
  quota_habis: "Kuota harian AI bersama sudah habis. Pasang API key sendiri di AI Assistant Settings agar punya jatah pribadi, atau pilih sendiri dashboard-nya di panel sebelah lalu kirim ulang pertanyaannya.",
  layanan_sibuk: "Layanan AI sedang penuh dan belum sempat menjawab. Pertanyaanmu sudah benar - coba kirim ulang sebentar lagi, atau pilih sendiri dashboard-nya di panel sebelah.",
  kunci_tidak_valid: "API key Gemini yang terpasang tidak valid. Perbarui di AI Assistant Settings, atau hubungi admin kalau memakai key bersama.",
  kunci_ditolak: "API key Gemini ditolak - Generative Language API belum aktif untuk key tersebut. Hubungi admin.",
  model_pensiun: "Model AI yang dipilih sudah tidak tersedia. Buka AI Assistant Settings dan pilih model lain.",
  parse_error: "Layanan AI mengembalikan jawaban yang tidak terbaca. Coba kirim ulang pertanyaannya, atau pilih sendiri dashboard-nya di panel sebelah.",
  no_api_key: "API key Gemini belum terpasang untuk akun ini. Buka AI Assistant Settings untuk memasang key sendiri, atau hubungi admin agar universal key diaktifkan.",
  no_dashboards_available: "Belum ada dashboard yang terdaftar di CODE.",
  no_accessible_dashboards: "Belum ada dashboard yang bisa kamu akses. Hubungi admin untuk membuka aksesnya.",
};
// Penyaringan memanggil Gemini sampai 4 kali per permintaan (satu per dashboard
// lain), jadi batasnya dihitung per PERMINTAAN distill, bukan per panggilan
// model, dan jendelanya lebih longgar karena panel hanya memanggil ini saat
// dibuka, bukan setiap pertanyaan.
const DISTILL_RATE_WINDOW_SECONDS = Number(process.env.AI_DISTILL_RATE_WINDOW_SECONDS ?? 300);
const DISTILL_RATE_MAX_REQUESTS = Number(process.env.AI_DISTILL_RATE_MAX_REQUESTS ?? 4);
const MAX_QUESTION_CHARS = 1000;
const HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS ?? 6);
const ESCALATION_ENABLED = !/^(0|false|off|no)$/i.test(process.env.AI_ESCALATION || "");

// ── Helpers ──────────────────────────────────────────────────────────────────

// role WAJIB ikut. isAdminUser membaca user.role, dan tanpa kolomnya nilainya
// undefined untuk semua orang: canManage selalu false, form kunci universal
// tidak pernah dirender, dan PUT /api/ai/universal-key menjawab 403 bahkan
// untuk admin sungguhan. Kunci universalnya jadi tidak bisa diatur oleh
// siapa pun, tanpa satu pun error yang muncul di mana pun.
async function getUser(userId) {
  const [rows] = await sql.query(
    // cia_access ikut karena /status melaporkannya ke web, dan web memakainya
    // untuk menyembunyikan pintu masuk CIA. Kolom yang tidak diambil bernilai
    // undefined untuk semua orang, dan itu membuat fiturnya hilang bagi semua
    // orang tanpa satu pun error.
    "SELECT id, nama, departemen, tipe_akses, approved, role, cia_access FROM users WHERE id = ?",
    [userId]
  );
  return rows[0] || null;
}

async function getDashboard(dashboardId) {
  const [rows] = await sql.query(
    "SELECT id, title, description, department, report_id, active FROM dashboards WHERE id = ?",
    [dashboardId]
  );
  return rows[0] || null;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Active dashboards plus, per dashboard, whether THIS user may open it.
 * The access flag is computed server-side so the navigator can never point a
 * user at something they cannot see without saying so.
 */
async function getCatalogForUser(user) {
  const [rows] = await sql.query(
    `SELECT d.id, d.title, d.description, d.department, d.report_id, d.pic_emails,
            (u.tipe_akses = 'All Access' OR uda.user_id IS NOT NULL) AS has_access
       FROM dashboards d
       CROSS JOIN users u
       LEFT JOIN user_dashboard_access uda
              ON uda.dashboard_id = d.id AND uda.user_id = u.id
      WHERE d.active = 1 AND u.id = ?
      ORDER BY d.department, d.title`,
    [user.id]
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    department: r.department,
    hasAccess: Boolean(Number(r.has_access)),
    reportGuid: GUID_RE.test(String(r.report_id || "").trim()) ? r.report_id : null,
    // Contact details never enter the prompt — the model only decides WHICH
    // dashboard is relevant, and the backend attaches the PIC to the reply.
    // Same principle as the sanitizer: identities do not leave the network.
    pic: String(r.pic_emails || "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
  }));
}

/** Confirmed KPI meanings, so the navigator can answer "apa itu MTBF?". */
let glossaryCache = null;
function buildGlossary() {
  if (glossaryCache === null) {
    try { glossaryCache = getGlossaryRows(); } catch { glossaryCache = ""; }
  }
  return glossaryCache;
}

/** Mirrors the access rules used by the embed/UI layer. */
async function userCanViewDashboard(user, dashboardId) {
  if (user.tipe_akses === "All Access") return true;
  const [rows] = await sql.query(
    "SELECT 1 FROM user_dashboard_access WHERE user_id = ? AND dashboard_id = ? LIMIT 1",
    [user.id, dashboardId]
  );
  return rows.length > 0;
}

/**
 * Which key pays for this request.
 *
 * BYOK first, universal second — deliberately. A personal key gives that user a
 * private allowance; the universal key is a single shared pool, so every request
 * routed to it reduces what is left for everyone else.
 */
async function resolveKey(userId, requestedModel) {
  const userKey = await AiModel.getUserKey(userId);
  if (userKey?.apiKey) {
    return {
      apiKey: userKey.apiKey,
      model: normalizeModel(requestedModel || userKey.model || DEFAULT_MODEL),
      source: "user",
    };
  }
  // Database first (admin-managed), env var as fallback
  const universal = (await aiSettings.getUniversalKey()) || getServerKey();
  if (universal) {
    return {
      apiKey: universal,
      model: normalizeModel(requestedModel || DEFAULT_MODEL),
      source: "server",
    };
  }
  return null;
}

// ── Controller ───────────────────────────────────────────────────────────────

// Membungkus handler CIA yang sudah ada dengan telemetry best-effort TANPA
// mengubah alurnya. res.json dibungkus sekali: requestId disisipkan ke body,
// lalu status akhir diklasifikasi dari res.statusCode (>= 400 = gagal) sehingga
// jalur sukses maupun jalur error yang membalas via res.status().json() sama-
// sama tercatat benar. Exception yang benar-benar dilempar tetap dilempar ulang
// supaya penanganan error lama tidak berubah. Deklarasi function (bukan const)
// dipakai sengaja: ia ter-hoist sehingga bisa membungkus method di object
// literal AiController di bawahnya.
export function withCiaTelemetry(surface, handler, deps = {}) {
  const starter = deps.startCiaTelemetry || startCiaTelemetry;
  return async (req, res) => {
    const requestId = crypto.randomUUID();
    let telemetry = null;
    try {
      telemetry = await starter({
        requestId,
        surface,
        user: req.dbUser || req.user,
        question: req.body?.question,
        conversationId: req.body?.conversationId || req.body?.conversation_id || null,
      });
    } catch {
      // Memulai telemetry pun best-effort: kegagalannya tidak boleh terasa user.
      telemetry = null;
    }
    req.ciaTelemetry = telemetry;
    if (telemetry) Promise.resolve(telemetry.event("request_received")).catch(() => {});

    const startedAt = Date.now();
    const originalJson = res.json.bind(res);
    let settled = false;

    res.json = (payload) => {
      const isPlainObject =
        payload && typeof payload === "object" && !Array.isArray(payload);
      const body = isPlainObject ? { ...payload, requestId } : payload;

      if (!settled) {
        settled = true;
        if (telemetry) {
          const latencyMs = Date.now() - startedAt;
          if (res.statusCode >= 400) {
            telemetry
              .fail(
                {
                  code: `HTTP_${res.statusCode}`,
                },
                { latencyMs }
              )
              .catch(() => {});
          } else {
            Promise.resolve(telemetry.event("response_sent"))
              .then(() =>
                telemetry.finish({ status: "success", retrievalMethod: "snapshot", latencyMs })
              )
              .catch(() => {});
          }
        }
      }
      return originalJson(body);
    };

    try {
      return await handler(req, res);
    } catch (err) {
      if (!settled) {
        settled = true;
        if (telemetry) telemetry.fail(err, { latencyMs: Date.now() - startedAt }).catch(() => {});
      }
      throw err;
    }
  };
}

export const AiController = {
  /** GET /api/ai/status — what the frontend needs to render the AI entry point. */
  status: async (req, res) => {
    try {
      const row = await AiModel.getUserKeyRow(req.user.id);
      const userKey = row ? await AiModel.getUserKey(req.user.id) : null;
      const user = await getUser(req.user.id);
      const universalMeta = await aiSettings.getUniversalKeyMeta();
      const hasUniversal = Boolean((await aiSettings.getUniversalKey()) || hasServerKey());

      // Hak akses CIA dilaporkan TERPISAH dari enabled. enabled menjawab
      // "apakah ada kunci yang membiayai", ciaAccess menjawab "apakah orang ini
      // boleh memakainya". Menggabungkan keduanya membuat user yang ditolak
      // melihat pesan soal kunci yang tidak ada hubungannya dengan masalahnya.
      const bolehPakaiCia = Boolean(Number(user?.cia_access));

      res.json({
        ciaAccess: bolehPakaiCia,
        enabled: bolehPakaiCia && Boolean(userKey?.apiKey || hasUniversal),
        hasServerKey: hasUniversal,
        universal: {
          configured: hasUniversal,
          source: universalMeta?.source || (hasServerKey() ? "env" : null),
          updatedAt: universalMeta?.updatedAt || null,
          updatedBy: universalMeta?.updatedBy || null,
          // Only an admin may see or change it
          canManage: aiSettings.isAdminUser(user),
        },
        hasUserKey: Boolean(userKey?.apiKey),
        keyPreview: userKey?.apiKey ? maskSecret(userKey.apiKey) : null,
        model: normalizeModel(userKey?.model || DEFAULT_MODEL),
        defaultModel: DEFAULT_MODEL,
        availableModels: ALLOWED_MODELS,
        rateLimit: { windowSeconds: RATE_WINDOW_SECONDS, maxRequests: RATE_MAX_REQUESTS },
        sanitization: {
          enabled: SANITIZER_CONFIG.enabled,
          moneyMode: SANITIZER_CONFIG.moneyMode,
          knowledgeSent: SANITIZER_CONFIG.sendKnowledge,
        },
        updatedAt: row?.updated_at || null,
      });
    } catch (err) {
      console.error("❌ AI status error:", err);
      res.status(500).json({ message: "Failed to read AI status" });
    }
  },

  /** PUT /api/ai/key — save (and verify) the user's own free Gemini API key. */
  saveKey: async (req, res) => {
    const { apiKey, model } = req.body || {};
    const trimmed = String(apiKey || "").trim();

    if (!trimmed) return res.status(400).json({ message: "API key is required" });
    if (trimmed.length < 20 || /\s/.test(trimmed)) {
      return res.status(400).json({ message: "Format API key tidak valid" });
    }

    try {
      await validateKey(trimmed);
    } catch (err) {
      const status = err instanceof GeminiError ? err.status : 400;
      return res.status(status).json({ message: err.message });
    }

    try {
      await AiModel.saveUserKey(req.user.id, trimmed, normalizeModel(model));
      res.json({
        message: "Gemini API key tersimpan",
        keyPreview: maskSecret(trimmed),
        model: normalizeModel(model),
      });
    } catch (err) {
      console.error("❌ AI saveKey error:", err);
      res.status(500).json({ message: "Failed to save API key" });
    }
  },

  /** PUT /api/ai/model — change preferred model without re-entering the key. */
  saveModel: async (req, res) => {
    try {
      const model = normalizeModel(req.body?.model);
      await AiModel.saveUserModel(req.user.id, model);
      res.json({ message: "Model updated", model });
    } catch (err) {
      console.error("❌ AI saveModel error:", err);
      res.status(500).json({ message: "Failed to update model" });
    }
  },

  /**
   * GET /api/ai/provider — provider mana yang sedang dipakai CIA.
   *
   * Terbuka untuk semua user yang login, bukan admin saja: mengetahui jawaban
   * datang dari model mana bukan rahasia, dan menyembunyikannya membuat admin
   * jadi satu-satunya orang yang bisa menjelaskan kenapa gaya jawaban berubah.
   */
  provider: async (req, res) => {
    try {
      const provider = await providerTerpilih();
      res.json({
        provider,
        pilihan: PROVIDER_SAH,
        default: PROVIDER_DEFAULT,
        // Tanpa kunci, GLM dilewati dan CIA memakai Gemini. Ini disebut apa
        // adanya supaya admin tidak mengira setelannya tidak tersimpan.
        glmSiap: hasGlmKey(),
      });
    } catch (err) {
      console.error("❌ AI provider error:", err);
      res.status(500).json({ message: "Gagal membaca setelan provider" });
    }
  },

  /** PUT /api/ai/provider — admin only. Berlaku global untuk semua grup. */
  saveProvider: async (req, res) => {
    try {
      const user = await getUser(req.user.id);
      if (!aiSettings.isAdminUser(user)) {
        return res.status(403).json({ message: "Hanya admin yang boleh mengubah provider" });
      }

      const diminta = String(req.body?.provider || "").trim().toLowerCase();
      if (!PROVIDER_SAH.includes(diminta)) {
        return res.status(400).json({
          message: `provider harus salah satu dari: ${PROVIDER_SAH.join(", ")}`,
        });
      }

      await simpanProvider(diminta, user.id);
      res.json({ message: "Provider diperbarui", provider: diminta, glmSiap: hasGlmKey() });
    } catch (err) {
      console.error("❌ AI saveProvider error:", err);
      res.status(500).json({ message: "Gagal menyimpan provider" });
    }
  },

  /** PUT /api/ai/universal-key — admin only. Shared fallback for all users. */
  saveUniversalKey: async (req, res) => {
    try {
      const user = await getUser(req.user.id);
      if (!aiSettings.isAdminUser(user)) {
        return res.status(403).json({ message: "Hanya admin yang bisa mengatur kunci universal" });
      }

      const trimmed = String(req.body?.apiKey || "").trim();
      if (!trimmed) return res.status(400).json({ message: "Kunci tidak boleh kosong" });
      if (trimmed.length < 20 || /\s/.test(trimmed)) {
        return res.status(400).json({ message: "Format kunci tidak valid" });
      }

      // Verify against Google before storing — a broken universal key would
      // silently break CIA for every user without a personal key.
      try {
        await validateKey(trimmed);
      } catch (err) {
        return res.status(err instanceof GeminiError ? err.status : 400).json({ message: err.message });
      }

      await aiSettings.setUniversalKey(trimmed, user.id);
      res.json({ message: "Kunci universal tersimpan", keyPreview: maskSecret(trimmed) });
    } catch (err) {
      console.error("❌ AI saveUniversalKey error:", err);
      res.status(500).json({ message: "Gagal menyimpan kunci universal" });
    }
  },

  /** DELETE /api/ai/universal-key — admin only. */
  deleteUniversalKey: async (req, res) => {
    try {
      const user = await getUser(req.user.id);
      if (!aiSettings.isAdminUser(user)) {
        return res.status(403).json({ message: "Hanya admin yang bisa mengatur kunci universal" });
      }
      await aiSettings.clearUniversalKey();
      res.json({
        message: "Kunci universal dihapus",
        fallbackToEnv: hasServerKey(),
      });
    } catch (err) {
      console.error("❌ AI deleteUniversalKey error:", err);
      res.status(500).json({ message: "Gagal menghapus kunci universal" });
    }
  },

  /** DELETE /api/ai/key — fall back to the shared server key. */
  deleteKey: async (req, res) => {
    try {
      await AiModel.deleteUserKey(req.user.id);
      res.json({ message: "Gemini API key dihapus", hasServerKey: hasServerKey() });
    } catch (err) {
      console.error("❌ AI deleteKey error:", err);
      res.status(500).json({ message: "Failed to delete API key" });
    }
  },

  /**
   * GET /api/ai/coverage — seberapa sering jawaban tidak memanggil model.
   *
   * Rencana Fase A menargetkan 35 sampai 50 persen pertanyaan dashboard selesai
   * tanpa model, dan menyebut angka itu harus diukur ulang dari pemakaian nyata
   * setelah dua minggu. Ini alat ukurnya, supaya targetnya bisa dihitung, bukan
   * diperdebatkan.
   */
  coverage: async (req, res) => {
    try {
      const [baris] = await sql.query(
        `SELECT COALESCE(intent, 'TIDAK_TERCATAT') AS intent,
                COUNT(*) AS jumlah,
                SUM(answered_locally = 1) AS lokal
         FROM ai_chat_logs
         WHERE created_at >= NOW() - INTERVAL 14 DAY
         GROUP BY COALESCE(intent, 'TIDAK_TERCATAT')
         ORDER BY jumlah DESC`
      );

      const total = baris.reduce((s, r) => s + Number(r.jumlah), 0);
      const lokal = baris.reduce((s, r) => s + Number(r.lokal || 0), 0);

      // Baris tanpa intent mendahului instrumentasi ini. Memasukkannya ke
      // pembagi membuat persentasenya selalu terlihat nyaris nol selama dua
      // minggu pertama, dan itu akan dibaca sebagai "fiturnya gagal" padahal
      // artinya "belum ada data dari jalur baru". Persentase dihitung hanya
      // atas pertanyaan yang benar-benar melewati pengenal intent.
      const belumTercatat = baris
        .filter((r) => r.intent === "TIDAK_TERCATAT")
        .reduce((s, r) => s + Number(r.jumlah), 0);
      const tercatat = total - belumTercatat;

      res.json({
        total,
        tercatat,
        belumTercatat,
        lokal,
        persenLokal: tercatat ? Math.round((lokal / tercatat) * 100) : 0,
        perIntent: baris.map((r) => ({
          intent: r.intent,
          jumlah: Number(r.jumlah),
          lokal: Number(r.lokal || 0),
        })),
        hariTerakhir: 14,
      });
    } catch (err) {
      console.error("❌ AI coverage error:", err);
      res.status(500).json({ message: "Gagal menghitung cakupan" });
    }
  },

  /** GET /api/ai/quota — estimated remaining quota for the logged-in user. */
  quota: async (req, res) => {
    try {
      const resolved = await resolveKey(req.user.id);
      const data = await aiQuota.summary(req.user.id, resolved?.source || "user");
      res.json({
        ...data,
        breaker: aiQuota.breakerState(data),
        cache: aiCache.stats(),
        tiers: TIERS.map((t) => ({ tier: t, label: TIER_LABELS[t] })),
      });
    } catch (err) {
      console.error("❌ AI quota error:", err);
      res.status(500).json({ message: "Failed to read quota" });
    }
  },

  /**
   * POST /api/ai/navigate — the home-screen assistant.
   * Answers "which dashboard should I open?" from the catalogue only; it never
   * sees dashboard data, so it is cheap and always runs on the fast tier.
   */
  navigate: async (req, res) => {
    const q = String(req.body?.question || "").trim();
    if (!q) return res.status(400).json({ message: "Pertanyaan tidak boleh kosong" });
    if (q.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ message: `Pertanyaan maksimal ${MAX_QUESTION_CHARS} karakter` });
    }

    let resolved = null;
    try {
      const user = await getUser(req.user.id);
      if (!user || !user.approved) return res.status(403).json({ message: "Akun tidak aktif" });

      resolved = await resolveKey(user.id);
      if (!resolved) {
        return res.status(503).json({
          message: "CIA belum aktif: belum ada kunci akses. Simpan kunci pribadi di menu Pengaturan CIA.",
        });
      }

      const dashboards = await getCatalogForUser(user);
      if (!dashboards.length) {
        return res.json({ answer: "Belum ada dashboard yang terdaftar di CODE.", dashboards: [], followUp: [] });
      }

      const key = aiCache.cacheKey({
        dashboardId: "nav",
        question: q,
        snapshot: { pagesRead: [String(dashboards.length)], filters: [user.tipe_akses || ""], visuals: [] },
        tier: "cepat",
      });
      const cached = aiCache.get(key);
      if (cached) {
        return res.json({ ...cached.meta.payload, fromCache: true, cacheAgeSeconds: cached.ageSeconds });
      }

      const limit = rateLimit.hit(`nav:${user.id}`, RATE_MAX_REQUESTS, RATE_WINDOW_SECONDS);
      if (!limit.allowed) {
        res.set("Retry-After", String(limit.retryAfterSeconds));
        return res.status(429).json({
          message: `Terlalu banyak pertanyaan — coba lagi dalam ${limit.retryAfterSeconds} detik.`,
        });
      }

      const systemInstruction = buildNavigatorPrompt({
        userName: user.nama,
        userDept: user.departemen,
        catalog: buildCatalog(dashboards),
        glossary: SANITIZER_CONFIG.sendKnowledge ? buildGlossary() : "",
      });

      const result = await callAI({
        tier: "cepat",
        apiKey: resolved.apiKey,
        queueKey: `nav:${user.id}`,
        systemInstruction,
        question: q,
        // JSON envelope + up to 5 dashboard reasons + follow-ups needs more room
        // than a plain prose answer; hitting the limit truncates mid-object and
        // there is no valid JSON left to parse.
        maxOutputTokens: Number(process.env.AI_NAV_OUTPUT_TOKENS ?? 2048),
      });

      const parsed = parseNavigatorReply(result.text);
      if (result.finishReason === "MAX_TOKENS") {
        console.warn(
          `[CIA] Navigator terpotong (MAX_TOKENS) untuk pertanyaan: "${q.slice(0, 60)}". ` +
          `Naikkan AI_NAV_OUTPUT_TOKENS bila sering terjadi.`
        );
      }
      const payload = {
        answer: parsed.answer,
        dashboards: resolveDashboardRefs(parsed.dashboards, dashboards),
        followUp: parsed.followUp,
        meta: {
          tier: "cepat",
          tierLabel: TIER_LABELS.cepat,
          model: result.model,
          keySource: resolved.source,
          usage: result.usage,
          malformed: parsed.malformed || undefined,
        },
      };

      // Never cache a broken reply: a one-off truncation would otherwise be
      // served to everyone for the whole TTL, which is exactly how a transient
      // glitch turns into a permanent one.
      if (!parsed.malformed) {
        aiCache.set(key, { answer: parsed.answer, tier: "cepat", meta: { dashboardId: "nav", payload } });
      }

      await AiModel.logChat({
        user_id: user.id,
        dashboard_title: "(CIA Navigator)",
        question: q,
        answer: parsed.answer,
        model: result.model,
        key_source: resolved.source,
        tier: "cepat",
        prompt_tokens: result.usage?.promptTokenCount ?? null,
        output_tokens: result.usage?.candidatesTokenCount ?? null,
        total_tokens: result.usage?.totalTokenCount ?? null,
      }).catch(() => {});

      res.json(payload);
    } catch (err) {
      const status = err instanceof GeminiError ? err.status : 500;
      if (!(err instanceof GeminiError)) console.error("❌ AI navigate error:", err);
      if (err instanceof GeminiError && (err.code === "QUOTA" || err.status === 429)) {
        aiQuota.recordRateLimitHit({ userId: req.user.id, model: resolved?.model, tier: "cepat" }).catch(() => {});
      }
      res.status(status).json({
        message: err instanceof GeminiError ? err.message : "Gagal menghubungi CIA Navigator",
      });
    }
  },

  /**
   * GET /api/ai/finding — apa yang diingat CIA tentang analisa user.
   *
   * Ada karena memori yang tidak terlihat tidak bisa dipercaya. Kalau CIA
   * mengingat sesuatu yang salah, user harus bisa melihat dan mengoreksinya.
   */
  findings: async (req, res) => {
    try {
      const temuan = await temuanAktif(req.user.id);
      res.json({ temuan, jendelaJam: JAM_JENDELA });
    } catch (err) {
      console.error("❌ AI findings error:", err);
      res.status(500).json({ message: "Gagal membaca temuan" });
    }
  },

  /**
   * POST /api/ai/finding/distill — menyaring percakapan dashboard LAIN.
   *
   * Dipanggil frontend saat panel CIA dibuka, bukan disisipkan ke /ask,
   * supaya latensinya tidak terasa di pertanyaan pertama setiap dashboard baru.
   *
   * Kegagalan penyaringan TIDAK dilaporkan sebagai error ke user: dia tidak
   * meminta penyaringan itu, dan chat tetap bisa jalan tanpa memori.
   */
  distillFindings: async (req, res) => {
    const dashboardId = Number(req.body?.dashboardId);
    if (!Number.isInteger(dashboardId) || dashboardId <= 0) {
      return res.status(400).json({ message: "dashboardId wajib berupa angka positif" });
    }

    try {
      const user = await getUser(req.user.id);
      if (!user || !user.approved) return res.status(403).json({ message: "Akun tidak aktif" });

      // Dashboard LAIN yang punya percakapan. Dashboard yang sedang dibuka
      // sengaja dilewati: percakapannya belum selesai.
      const [baris] = await sql.query(
        `SELECT dashboard_id, MAX(id) AS turn_terakhir
           FROM ai_chat_logs
          WHERE user_id = ? AND dashboard_id IS NOT NULL AND dashboard_id <> ?
            AND answer IS NOT NULL AND error IS NULL
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
          GROUP BY dashboard_id
          ORDER BY turn_terakhir DESC
          LIMIT 4`,
        [user.id, dashboardId, JAM_JENDELA]
      );

      if (!baris.length) return res.json({ tersaring: 0, dilewati: 0 });

      const resolved = await resolveKey(user.id);
      if (!resolved) {
        // Tanpa kunci, penyaringan tidak bisa jalan. Bukan error: chat tetap
        // berjalan tanpa memori.
        return res.json({ tersaring: 0, dilewati: baris.length, alasan: "belum ada kunci akses" });
      }

      // Penyaringan memakai kuota Gemini yang sama seperti /ask, tapi user tidak
      // memintanya secara langsung — dia hanya membuka panel. Kalau batas
      // terlampaui, balas 200 dengan tersaring nol, BUKAN 429: 429 di jalur ini
      // akan terbaca sebagai gangguan atas sesuatu yang tidak diminta user.
      const distillLimit = rateLimit.hit(
        `distill:${user.id}`, DISTILL_RATE_MAX_REQUESTS, DISTILL_RATE_WINDOW_SECONDS
      );
      if (!distillLimit.allowed) {
        return res.json({
          tersaring: 0,
          dilewati: baris.length,
          alasan: `batas penyaringan tercapai, coba lagi dalam ${distillLimit.retryAfterSeconds} detik`,
        });
      }

      let tersaring = 0;
      let dilewati = 0;

      for (const b of baris) {
        const sudah = await turnTerakhirTersaring(user.id, b.dashboard_id);
        if (Number(b.turn_terakhir) <= sudah) {
          dilewati += 1;
          continue;
        }

        const putaran = await AiModel.getHistory(user.id, b.dashboard_id, 6);
        if (!putaran.length) {
          dilewati += 1;
          continue;
        }

        const [[d]] = await sql.query("SELECT title FROM dashboards WHERE id = ?", [b.dashboard_id]);

        // Riwayat disimpan de-tokenized, sama seperti jalur menjawab, jadi
        // wajib disanitasi ulang sebelum menyeberang ke model penyaring. Satu
        // instance dipakai untuk seluruh putaran ini karena hanya instance
        // itu yang bisa memulihkan tokennya sesudah hasil penyaringan pulang.
        const sanitizer = getSanitizer();
        const putaranAman = putaran.map((p) => ({
          ...p,
          question: sanitizer.sanitizeText(p.question),
          answer: sanitizer.sanitizeText(p.answer),
        }));

        try {
          const hasil = await askGemini({
            apiKey: resolved.apiKey,
            model: resolved.model,
            systemInstruction: instruksiPenyaring(),
            question: susunPermintaanPenyaring({
              dashboardTitle: d?.title || `Dashboard #${b.dashboard_id}`,
              putaran: putaranAman,
            }),
            maxOutputTokens: Number(process.env.AI_FINDING_MAX_TOKENS) || 2048,
            thinkingLevel: "low",
          });

          // aiQuota.summary menghitung pemakaian DARI ai_chat_logs. Tanpa baris
          // ini, panggilan model penyaringan tidak pernah terlihat di sana:
          // indikator kuota tetap hijau sementara kuota sungguhan berkurang, dan
          // /ask yang sah bisa dijatah 429 tanpa satu pun angka yang menjelaskan
          // sebabnya. tier ditandai "distill" — bukan salah satu tier routing —
          // supaya jelas dari log mana asal panggilannya, dan itu tidak
          // mengganggu agregasi karena usageSince/usageLastMinute mengelompokkan
          // per model, bukan per tier.
          await AiModel.logChat({
            user_id: user.id,
            dashboard_id: b.dashboard_id,
            dashboard_title: d?.title || null,
            question: `(CIA Distill: ${d?.title || `Dashboard #${b.dashboard_id}`})`,
            answer: hasil?.text || null,
            model: hasil?.model || resolved.model,
            key_source: resolved.source,
            tier: "distill",
            prompt_tokens: hasil?.usage?.promptTokenCount ?? null,
            output_tokens: hasil?.usage?.candidatesTokenCount ?? null,
            total_tokens: hasil?.usage?.totalTokenCount ?? null,
          }).catch((err) => console.error("[ai] gagal mencatat pemakaian penyaringan:", err.message));

          const temuan = bacaHasilPenyaring(hasil?.text);
          if (!temuan) {
            dilewati += 1;
            continue;
          }

          // Penjagaan pola nama di bacaHasilPenyaring menandai, bukan diam-diam
          // membuang. Kalau instruksi sistem sudah melarang nama tapi model
          // masih menuliskannya cukup sering untuk kena pola, itu sinyal bagi
          // ops bahwa instruksinya perlu dipertegas atau modelnya diganti.
          if (temuan.namaTersensor) {
            console.warn(`[ai] pola nama tersensor pada temuan dashboard ${b.dashboard_id}`);
          }

          // Yang tersimpan harus berisi nilai asli, bukan token: temuan ini
          // nanti ditampilkan ke user dan disanitasi ulang saat dipakai lagi.
          // Hanya bagian teksnya yang dipulihkan; nilai angka tidak pernah
          // ditokenisasi jadi tidak perlu dipulihkan.
          await simpanTemuan({
            userId: user.id,
            dashboardId: b.dashboard_id,
            ringkasan: sanitizer.restore(temuan.ringkasan),
            angka: temuan.angka.map((a) => ({ ...a, measure: sanitizer.restore(a.measure) })),
            belumTerjawab: temuan.belumTerjawab ? sanitizer.restore(temuan.belumTerjawab) : null,
            turnTerakhir: Number(b.turn_terakhir),
          });
          tersaring += 1;
        } catch (err) {
          // Satu dashboard yang gagal disaring tidak menghentikan sisanya, dan
          // tidak menggagalkan permintaan.
          console.warn(`[ai] penyaringan dashboard ${b.dashboard_id} gagal:`, err?.message || err);
          dilewati += 1;
        }
      }

      res.json({ tersaring, dilewati });
    } catch (err) {
      console.error("❌ AI distill error:", err);
      res.status(500).json({ message: "Gagal menyaring temuan" });
    }
  },

  /** GET /api/ai/history/:dashboardId */
  history: async (req, res) => {
    try {
      const rows = await AiModel.getHistory(req.user.id, req.params.dashboardId, HISTORY_TURNS * 2);
      res.json(rows);
    } catch (err) {
      console.error("❌ AI history error:", err);
      res.status(500).json({ message: "Failed to load chat history" });
    }
  },

  /** DELETE /api/ai/history/:dashboardId */
  clearHistory: async (req, res) => {
    try {
      await AiModel.clearHistory(req.user.id, req.params.dashboardId);
      res.json({ message: "History cleared" });
    } catch (err) {
      console.error("❌ AI clearHistory error:", err);
      res.status(500).json({ message: "Failed to clear history" });
    }
  },

  /**
   * POST /api/ai/ask
   * body: { dashboardId, question, snapshot, model?, useHistory? }
   * snapshot = data captured client-side from the embedded report's visuals.
   */
  ask: withCiaTelemetry("dashboard", async (req, res) => {
    const {
      dashboardId, question, snapshot, model,
      useHistory = true,
      tier = "auto",            // "auto" | cepat | standar | mendalam
      // Tombol "Tanya AI untuk analisa lebih dalam" mengirim ini. Tanpa jalan
      // keluar, pertanyaan yang sudah dijawab lokal akan selalu dijawab lokal
      // lagi dan user tidak punya cara naik satu langkah.
      paksaAI = false,
    } = req.body || {};

    const q = String(question || "").trim();
    if (!q) return res.status(400).json({ message: "Pertanyaan tidak boleh kosong" });
    if (q.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ message: `Pertanyaan maksimal ${MAX_QUESTION_CHARS} karakter` });
    }
    if (!dashboardId) return res.status(400).json({ message: "dashboardId is required" });

    let dashboard = null;
    let resolved = null;
    // Dideklarasikan DI LUAR try, dan ini perbaikan bug, bukan soal gaya.
    // Blok catch di bawah mencatat `lokal?.intent`, dan `const lokal` di dalam
    // try TIDAK ada di scope catch. Setiap error Gemini, termasuk kuota habis,
    // melempar ReferenceError DI DALAM penangan errornya sendiri, menjadi
    // unhandled rejection, dan menjatuhkan SELURUH backend.
    //
    // `lokal?.intent` terlihat aman padahal optional chaining tidak menolong
    // sama sekali ketika identifiernya sendiri yang tidak terdeklarasi.
    let lokal = null;

    try {
      const user = await getUser(req.user.id);
      if (!user || !user.approved) {
        return res.status(403).json({ message: "Akun tidak aktif" });
      }

      dashboard = await getDashboard(dashboardId);
      if (!dashboard) return res.status(404).json({ message: "Dashboard tidak ditemukan" });

      if (!(await userCanViewDashboard(user, dashboard.id))) {
        return res.status(403).json({ message: "Kamu belum punya akses ke dashboard ini" });
      }

      // Request validity is checked before service availability, so a malformed
      // request always reports the malformed part rather than a config error.
      const hasVisualData =
        Array.isArray(snapshot?.visuals) &&
        snapshot.visuals.some((v) => Array.isArray(v?.rows) && v.rows.length > 0);

      if (!hasVisualData) {
        return res.status(400).json({
          message:
            "Data dashboard belum berhasil dibaca. Tunggu sampai dashboard selesai loading lalu klik Refresh Data.",
        });
      }

      // Best-effort, guarded (?.): tak pernah mengubah alur snapshot/DAX.
      req.ciaTelemetry?.event("snapshot_read", {
        dashboardId: dashboard.id,
        dashboardName: dashboard.title,
        rowsReturned: (snapshot?.visuals || []).reduce((s, v) => s + (v?.rows?.length || 0), 0),
      }).catch?.(() => {});

      // ── Fase A: jawab dari snapshot, tanpa model ─────────────────────────
      //
      // Ditempatkan SEBELUM resolveKey dan sebelum rate limit, bukan sesudah.
      // Jawaban ini tidak memanggil Gemini, jadi tidak butuh API key dan tidak
      // memakai kuota. Kalau ditaruh setelah resolveKey, user yang belum
      // mengisi API key mendapat 503 untuk pertanyaan yang sebenarnya bisa
      // dijawab tanpa key sama sekali. Rate limit pun memang dimaksudkan
      // menjaga kuota Gemini, seperti tertulis di komentarnya sendiri di bawah.
      lokal = paksaAI
        ? { answered: false, reason: "user meminta jawaban AI", intent: "ANALYTICAL" }
        : tryAnswerLocally({ question: q, snapshot, dashboard });

      if (lokal.answered && lokal.confidence >= AMBANG_KEYAKINAN) {
        const visualsUsed = (snapshot?.visuals || []).length;
        const rowsUsed = (snapshot?.visuals || [])
          .reduce((s, v) => s + (v?.rows?.length || 0), 0);

        // Bentuknya { answer, meta } seperti jalur lain, karena frontend
        // membaca data.meta. usage sengaja nol, bukan dihilangkan, supaya
        // penampil kuota tidak perlu menangani field yang hilang.
        const payload = {
          answer: lokal.text,
          meta: {
            answeredLocally: true,
            intent: lokal.intent,
            tier: "lokal",
            tierLabel: "Dijawab dari data dashboard",
            model: "local",
            keySource: "server",
            usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
            dashboardId: dashboard.id,
            visualsUsed,
            rowsUsed,
          },
        };

        // snake_case: logChat memakai nama kolom, bukan camelCase.
        await AiModel.logChat({
          user_id: user.id,
          dashboard_id: dashboard.id,
          dashboard_title: dashboard.title,
          question: q,
          answer: lokal.text,
          model: "local",
          key_source: "server",
          visuals_used: visualsUsed,
          rows_used: rowsUsed,
          prompt_chars: 0,
          total_tokens: 0,
          tier: "lokal",
          from_cache: 0,
          intent: lokal.intent,
          answered_locally: 1,
        }).catch((err) => console.error("[ai] gagal mencatat jawaban lokal:", err.message));

        return res.json(payload);
      }

      resolved = await resolveKey(user.id, model);
      if (!resolved) {
        return res.status(503).json({
          message:
            "Fitur AI belum aktif: belum ada Gemini API key. Simpan API key pribadi di menu AI Assistant Settings, atau minta admin mengisi GEMINI_API_KEY di server.",
        });
      }

      // Rate limit — protects the shared free-tier quota. Counted only once a
      // request is actually about to consume Gemini quota.
      const limit = rateLimit.hit(user.id, RATE_MAX_REQUESTS, RATE_WINDOW_SECONDS);
      if (!limit.allowed) {
        res.set("Retry-After", String(limit.retryAfterSeconds));
        return res.status(429).json({
          message: `Terlalu banyak pertanyaan. Maksimal ${RATE_MAX_REQUESTS} per ${RATE_WINDOW_SECONDS} detik — coba lagi dalam ${limit.retryAfterSeconds} detik.`,
        });
      }

      // ── Tier routing (Fase 2) ───────────────────────────────────────────────
      // Quota is scoped to the key that will actually be charged: a personal key
      // has a private allowance, the universal key is one shared pool.
      const quota = await aiQuota.summary(user.id, resolved.source).catch(() => null);
      const breaker = aiQuota.breakerState(quota);

      const pastTurns = useHistory
        ? await AiModel.getHistory(user.id, dashboard.id, HISTORY_TURNS)
        : [];

      // Temuan dari dashboard LAIN. Dashboard yang sedang dibuka dikecualikan
      // DI SQL (bukan dibuang sesudahnya di sini): pengecualian di JavaScript
      // sesudah SQL menerapkan LIMIT bisa menyisakan lebih sedikit temuan dari
      // yang seharusnya walau masih ada temuan dashboard lain yang segar.
      // Gagal membacanya tidak boleh menggagalkan jawaban: memori adalah
      // tambahan, menjawab adalah tugas utamanya.
      const temuanLain = await temuanAktif(user.id, { kecualikanDashboardId: dashboard.id })
        .catch(() => []);
      const konteksTemuanMentah = susunKonteksTemuan(temuanLain);

      const classified = classify({
        question: q,
        snapshot,
        historyTurns: pastTurns.length,
      });
      const routing = resolveTier({ requested: tier, classified, quota });

      // ── Cache lookup (Fase 5) — before spending any quota ────────────────────
      // userScope WAJIB diisi ketika jawabannya akan memuat konteks temuan: itu
      // analisa PRIBADI user ini atas dashboard lain, dan pemanggil hanya
      // memeriksa akses ke dashboard yang sedang dibuka, bukan ke dashboard asal
      // temuan. Tanpa userScope, user lain yang tidak berhak melihat dashboard
      // sumber temuan bisa menerima isinya lewat cache. Pertanyaan tanpa temuan
      // tetap dibiarkan kosong supaya cache-nya masih bisa dibagi lintas user.
      const key = aiCache.cacheKey({
        dashboardId: dashboard.id,
        question: q,
        snapshot,
        tier: routing.tier,
        userScope: konteksTemuanMentah ? user.id : undefined,
      });
      const cached = aiCache.get(key);
      if (cached) {
        await AiModel.logChat({
          user_id: user.id,
          dashboard_id: dashboard.id,
          dashboard_title: dashboard.title,
          question: q,
          answer: cached.answer,
            intent: lokal.intent,
            answered_locally: 0,
          model: cached.meta?.model || null,
          key_source: null,
          tier: routing.tier,
          from_cache: 1,
        });
        return res.json({
          answer: cached.answer,
          meta: {
            ...cached.meta,
            fromCache: true,
            cacheAgeSeconds: cached.ageSeconds,
            tier: cached.meta?.tier || routing.tier,
            tierLabel: cached.meta?.tierLabel || TIER_LABELS[routing.tier],
            // Keep the shape identical to a live answer so every consumer can
            // read meta.routing without special-casing cache hits.
            routing: cached.meta?.routing || {
              auto: routing.auto, score: routing.score, reasons: routing.reasons, downgraded: null,
            },
            quota,
          },
        });
      }

      // Circuit breaker (Fase 7) — only bites once the cache has been tried
      if (breaker.level === "open") {
        return res.status(429).json({
          message: `${breaker.message} Kuota reset ${new Date(quota.resetAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB.`,
          quota,
        });
      }

      // ── Sanitization boundary ────────────────────────────────────────────────
      // Everything below this line may leave our network. Identities are replaced
      // with stable tokens; contact details are dropped outright. The answer is
      // de-tokenized again before it reaches the user or our own logs.
      const sanitizer = getSanitizer();
      const safeSnapshot = sanitizer.sanitizeSnapshot(snapshot);
      const safeQuestion = sanitizer.sanitizeText(q);

      // Row budget governor (Fase 1): big tables become top/bottom rows plus
      // statistics computed over every row.
      const { text: dataContext, stats } = buildDataContext(
        safeSnapshot,
        dashboard,
        TIER_CHAR_BUDGET[routing.tier]
      );

      // Domain knowledge (Fase 4): trimmed for the fast tier.
      const knowledge = SANITIZER_CONFIG.sendKnowledge
        ? buildKnowledgeBlock({
            dashboardTitle: dashboard.title,
            department: dashboard.department,
            question: q,
            tier: routing.tier,
            dataText: dataContext,
          })
        : { text: "", models: [], rcaTriggered: false };

      // The pack embeds the Azure tenant GUID, named suppliers, and hardcoded
      // product spec bands — scrub those before they cross the boundary.
      knowledge.text = sanitizer.sanitizeKnowledge(knowledge.text);

      // Temuan berasal dari jawaban tersimpan dashboard lain, sama seperti
      // riwayat: disimpan de-tokenized, jadi wajib disanitasi ulang di sini
      // dengan instance sanitizer yang sama supaya tokennya bisa dipulihkan.
      const konteksTemuan = sanitizer.sanitizeText(konteksTemuanMentah);

      // Katalog pengalihan. getCatalogForUser sudah menyaring hak akses, dan
      // penyaringan itu TIDAK diulang di prompt: menyerahkan penyaringan akses
      // ke model berarti satu instruksi terlewat sudah cukup untuk
      // membocorkan nama dashboard yang tidak boleh dilihat.
      const katalogPengalihan = await getCatalogForUser(user)
        .then((d) => ringkasKatalogUntukPengalihan(d))
        .catch(() => []);

      const systemInstruction = buildSystemPrompt({
        userName: user.nama,
        userDept: user.departemen,
        dashboardTitle: dashboard.title,
        knowledge: knowledge.text,
        sanitized: sanitizer.enabled,
      });
      // Aturan menyebut sumber angka dan aturan pengalihan hanya ditambahkan
      // bila relevan, supaya prompt tidak membawa aturan tentang sesuatu yang
      // tidak ada.
      const tambahan = [
        konteksTemuan ? aturanTemuanUntukInstruksi() : "",
        katalogPengalihan.length ? aturanPengalihanUntukInstruksi(katalogPengalihan) : "",
      ].filter(Boolean);

      const systemInstructionFinal = tambahan.length
        ? `${systemInstruction}\n\n${tambahan.join("\n\n")}`
        : systemInstruction;
      const userMessage = buildUserMessage({
        dataContext,
        question: safeQuestion,
        konteksTemuan,
      });

      // Chat memory: previous Q&A only (the snapshot is always re-sent fresh).
      // History is stored de-tokenized, so it must be re-sanitized on the way out.
      const history = pastTurns.flatMap((row) => [
        { role: "user", text: sanitizer.sanitizeText(row.question) },
        { role: "model", text: sanitizer.sanitizeText(row.answer) },
      ]);

      const retries = [];
      const call = (useTier) =>
        callAI({
          tier: useTier,
          apiKey: resolved.apiKey,
          queueKey: user.id,
          systemInstruction: systemInstructionFinal,
          history,
          question: userMessage,
          onRetry: (info) => retries.push(info),
        });

      let result = await call(routing.tier);
      let servedTier = routing.tier;
      let escalatedFrom = null;

      // Single escalation when a cheap tier clearly under-answered (Fase 2.3).
      // Skipped when the next tier is nearly spent — with only 20 deep requests a
      // day, spending one on a retry is worse than returning a decent answer.
      const nextHasRoom = (() => {
        const up = nextTier(servedTier);
        if (!up) return false;
        const t = quota?.perTier?.find((x) => x.tier === up);
        return !t || (t.remainingPct > 25 && !t.rpm?.exhausted);
      })();

      if (
        ESCALATION_ENABLED &&
        routing.auto &&
        nextHasRoom &&
        shouldEscalate({
          answer: result.text,
          tier: servedTier,
          classified,
          snapshotHasData: true,
        })
      ) {
        const up = nextTier(servedTier);
        if (up) {
          escalatedFrom = servedTier;
          servedTier = up;
          result = await call(up);
        }
      }

      // Back inside our trust boundary
      const answer = sanitizer.restore(result.text);

      const usage = result.usage || {};
      await AiModel.logChat({
        user_id: user.id,
        dashboard_id: dashboard.id,
        dashboard_title: dashboard.title,
        question: q,
        answer,
          intent: lokal.intent,
          answered_locally: 0,
        model: result.model,
        key_source: resolved.source,
        visuals_used: stats.visuals,
        rows_used: stats.rows,
        prompt_chars: userMessage.length,
        tier: servedTier,
        prompt_tokens: usage.promptTokenCount ?? null,
        output_tokens: usage.candidatesTokenCount ?? null,
        total_tokens: usage.totalTokenCount ?? null,
      });

      aiCache.set(key, {
        answer,
        tier: servedTier,
        meta: {
          dashboardId: dashboard.id,
          model: result.model,
          tier: servedTier,
          tierLabel: TIER_LABELS[servedTier],
          visualsUsed: stats.visuals,
          rowsUsed: stats.rows,
          summarizedVisuals: stats.summarized,
          routing: {
            auto: routing.auto,
            score: routing.score,
            reasons: routing.reasons,
            downgraded: routing.downgraded,
            escalatedFrom,
          },
        },
      });

      const quotaAfter = await aiQuota.summary(user.id, resolved.source).catch(() => quota);

      req.ciaTelemetry?.event("ai_synthesis", {
        provider: "gemini",
        aiModel: result.model,
        inputTokens: result.usage?.promptTokenCount || 0,
        outputTokens: result.usage?.candidatesTokenCount || 0,
        totalTokens: result.usage?.totalTokenCount || 0,
      }).catch?.(() => {});

      res.json({
        answer,
        meta: {
          model: result.model,
          keySource: resolved.source,
          visualsUsed: stats.visuals,
          rowsUsed: stats.rows,
          summarizedVisuals: stats.summarized,
          truncated: stats.truncated,
          promptChars: userMessage.length,
          usage: result.usage,
          pageName: snapshot?.pageName || null,
          semanticModels: knowledge.models,
          rcaMode: knowledge.rcaTriggered,
          modelUnmapped: isUnmappedModel(dashboard.title),
          fromCache: false,
          tier: servedTier,
          tierLabel: TIER_LABELS[servedTier],
          // Lets the panel offer "adjust filters/pages → Refresh → ask again"
          needsMoreData: answerNeedsMoreData(answer, snapshot),
          routing: {
            auto: routing.auto,
            score: routing.score,
            reasons: routing.reasons,
            downgraded: routing.downgraded,
            escalatedFrom,
          },
          retries: retries.length ? retries : undefined,
          quota: quotaAfter,
          breaker: breaker.level === "ok" ? undefined : breaker,
          sanitization: {
            enabled: sanitizer.enabled,
            moneyMode: sanitizer.moneyMode,
            knowledgeSent: SANITIZER_CONFIG.sendKnowledge,
            entities: sanitizer.stats.uniqueEntities,
            pseudonymized: sanitizer.stats.pseudonymized,
            dropped: sanitizer.stats.dropped,
            moneyColumns: sanitizer.stats.moneyColumns,
          },
        },
      });
    } catch (err) {
      const status = err instanceof GeminiError ? err.status : 500;
      const message =
        err instanceof GeminiError ? err.message : "Gagal memproses pertanyaan ke AI";

      if (!(err instanceof GeminiError)) console.error("❌ AI ask error:", err);

      // A real 429 means our configured limit was optimistic — record it so the
      // quota indicator stops promising headroom that does not exist (Fase 3.5).
      if (err instanceof GeminiError && (err.code === "QUOTA" || err.status === 429)) {
        aiQuota
          .recordRateLimitHit({ userId: req.user.id, model: resolved?.model, tier: resolved?.tier })
          .catch(() => {});
      }

      AiModel.logChat({
        user_id: req.user.id,
        dashboard_id: dashboard?.id ?? null,
            intent: lokal?.intent ?? null,
            answered_locally: 0,
        dashboard_title: dashboard?.title ?? null,
        question: q,
        model: resolved?.model ?? null,
        key_source: resolved?.source ?? null,
        error: `${err.code || status}: ${err.message}`.slice(0, 500),
      }).catch(() => {});

      res.status(status).json({ message });
    }
  }),

  /**
   * Dashboard mana yang relevan untuk sebuah pertanyaan, tanpa menarik datanya.
   *
   * Ini jalur kedua penarikan data: alih-alih user mencentang dashboard sendiri,
   * ia melempar pertanyaannya lebih dulu dan sistem memilihkan. Yang dikembalikan
   * hanya DAFTAR PILIHAN, bukan jawaban. Penarikan snapshot tetap terjadi di
   * browser user setelah pilihannya terlihat, karena embed Power BI hanya ada
   * di sana, dan karena user berhak tahu dashboard mana yang akan dibaca sebelum
   * dibaca.
   */
  unifiedSuggest: async (req, res) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== "string" || !question.trim()) {
        return res.status(400).json({ error: "Pertanyaan wajib diisi." });
      }
      if (question.length > 1000) {
        return res.status(400).json({ error: "Pertanyaan terlalu panjang (maksimal 1000 karakter)." });
      }

      const pembatas = rateLimit.hit(
        `unified_suggest:${req.user.id}`, RATE_MAX_REQUESTS, RATE_WINDOW_SECONDS
      );
      if (!pembatas.allowed) {
        res.set("Retry-After", String(pembatas.retryAfterSeconds));
        return res.status(429).json({
          error: `Terlalu banyak permintaan. Coba lagi dalam ${pembatas.retryAfterSeconds} detik.`,
        });
      }

      const user = await getUser(req.user.id);
      // getCatalogForUser sudah menyaring hak akses per dashboard, dan
      // classifyRelevantDashboards membuang yang hasAccess false. Jadi
      // saran tidak pernah menunjuk dashboard yang tidak boleh dibuka user.
      const katalog = await getCatalogForUser(user);
      const kunci = await resolveKey(req.user.id);
      const { dashboards, routerDecision } = await classifyRelevantDashboards(
        question, katalog, kunci?.apiKey
      );

      // Report GUID ikut supaya frontend tahu mana yang bisa diambil datanya.
      // Tanpa GUID, dashboard tidak bisa di-embed dan snapshot mustahil.
      const diperkaya = dashboards.map((d) => {
        const asli = katalog.find((k) => k.id === d.id);
        return {
          id: d.id,
          title: asli?.title || d.title,
          department: asli?.department || null,
          reason: d.reason || "",
          confidence: d.confidence,
          bisaDibaca: Boolean(asli?.reportGuid),
        };
      });

      return res.json({ dashboards: diperkaya, alasanRouter: routerDecision });
    } catch (error) {
      console.error("unifiedSuggest error:", error);
      return res.status(500).json({ error: "Gagal mencari dashboard yang relevan." });
    }
  },

  /**
   * Chat CIA lintas dashboard.
   *
   * Menerima { question, conversationId, snapshots: [{dashboard_id, snapshot}] }.
   * Snapshot diambil di browser user, bukan oleh server: embed Power BI beserta
   * tokennya hidup di sana.
   */
  unifiedAsk: withCiaTelemetry("multi_chat", async (req, res) => {
    try {
      const { question, conversationId: providedConvId, snapshots = [] } = req.body;
      const userId = req.user.id;
      const MAX_QUESTION_CHARS = 1000;

      // Validate input
      if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: 'Question is required and must be a string' });
      }
      if (question.length > MAX_QUESTION_CHARS) {
        return res.status(400).json({ error: `Question too long (max ${MAX_QUESTION_CHARS} chars)` });
      }
      // Snapshot boleh kosong: itu jalur "belum tahu dashboard mana", yang
      // dijawab dengan saran dashboard alih-alih dengan angka.

      // Rate limit check
      const rateLimitKey = `unified_ask:${userId}`;
      const limiter = rateLimit.hit(rateLimitKey, RATE_MAX_REQUESTS, RATE_WINDOW_SECONDS);
      if (!limiter.allowed) {
        res.set("Retry-After", String(limiter.retryAfterSeconds));
        return res.status(429).json({
          error: `Terlalu banyak pertanyaan. Coba lagi dalam ${limiter.retryAfterSeconds} detik.`,
        });
      }

      // Get or create conversation
      let conversationId = providedConvId;
      let turnNumber = 1;
      if (!conversationId) {
        const conv = await createConversation(userId, question);
        conversationId = conv.id;
      } else {
        const conv = await getConversation(conversationId, userId);
        if (!conv) {
          return res.status(404).json({ error: 'Percakapan tidak ditemukan.' });
        }
        // MAX(turn_number) + 1, bukan jumlah baris + 1. Menghitung baris salah
        // begitu ada satu turn terhapus: nomornya berulang dan tertolak
        // UNIQUE KEY (conversation_id, turn_number).
        turnNumber = (await hitungTurn(conversationId)) + 1;
      }

      // Get user info
      const user = await getUser(userId);

      // Map snapshot dashboard_id to full dashboard data (holes allowed - missing IDs handled gracefully)
      const snapshotResults = [];
      for (const snap of snapshots) {
        const dashboard = await getDashboard(snap.dashboard_id);
        if (dashboard) {
          snapshotResults.push({ dashboard, snapshot: snap.snapshot, dashboard_id: snap.dashboard_id });
        }
      }

      if (snapshotResults.length) {
        req.ciaTelemetry?.event("snapshot_read", {
          rowsReturned: snapshotResults.length,
          metadata: { dashboards: snapshotResults.map((r) => r.dashboard_id) },
        }).catch?.(() => {});
      }

      // Tidak ada snapshot: user bertanya tanpa memilih dashboard. Yang
      // dijawab BUKAN angka, melainkan dashboard mana yang perlu dibaca.
      // Membedakan keduanya penting: jawaban tanpa data yang terdengar seperti
      // jawaban berdata adalah kegagalan diam yang paling mahal di sistem ini.
      if (snapshotResults.length === 0) {
        const catalog = await getCatalogForUser(user);
        const kunciSaran = await resolveKey(userId);
        const { dashboards: relevan, routerDecision: alasan } = await classifyRelevantDashboards(
          question, catalog, kunciSaran?.apiKey
        );

        if (relevan.length === 0) {
          // Daftar kosong punya DUA sebab yang sangat berbeda, dan menyamakan
          // keduanya menyalahkan user atas kegagalan sistem: "tidak ada yang
          // cocok" menyuruh dia memperjelas pertanyaan, padahal yang terjadi
          // adalah Gemini penuh atau kuncinya belum dipasang. Pertanyaannya
          // sudah benar; mengulanginya lebih spesifik tidak akan menolong.
          const jawaban = GAGAL_TEKNIS_ROUTER[alasan] ??
            "Belum ada dashboard yang cocok dengan pertanyaan ini. Coba sebutkan area atau KPI-nya lebih spesifik, misalnya OEE, downtime, lembur, atau NC.";
          await addTurn(conversationId, turnNumber, question, [], jawaban, { classifier: 0 });
          return res.json({
            answer: jawaban,
            dashboards_used: [],
            saran_dashboard: [],
            conversation_id: conversationId,
            turn_id: `${conversationId}-${turnNumber}`,
            tokens: { classifier: 0 },
            tier: 'cepat',
          });
        }

        const saran = relevan.map((d) => {
          const asli = catalog.find((k) => k.id === d.id);
          return {
            id: d.id,
            title: asli?.title || d.title,
            department: asli?.department || null,
            reason: d.reason || "",
            confidence: d.confidence || 0.8,
            bisaDibaca: Boolean(asli?.reportGuid),
          };
        });

        const jawaban = `Pertanyaan ini bisa dijawab dari ${saran.length === 1 ? "dashboard" : `${saran.length} dashboard`} berikut. Pilih yang ingin dibaca datanya, lalu kirim ulang pertanyaannya.`;

        await addTurn(conversationId, turnNumber, question, saran, jawaban, { classifier: 0 });
        return res.json({
          answer: jawaban,
          dashboards_used: [],
          // Dipisah dari dashboards_used dengan sengaja: ini yang DISARANKAN,
          // bukan yang sudah dibaca. Frontend menampilkannya sebagai pilihan
          // yang bisa diklik, bukan sebagai sumber data jawaban.
          saran_dashboard: saran,
          conversation_id: conversationId,
          turn_id: `${conversationId}-${turnNumber}`,
          tokens: { classifier: 0 },
          tier: 'cepat',
        });
      }

      // Classify question tier using first snapshot's data
      const firstSnapshot = snapshotResults[0]?.snapshot;
      const tierClassification = classify({
        question,
        snapshot: firstSnapshot,
        historyTurns: turnNumber - 1,
      });

      // Snapshot WAJIB disanitasi sebelum menyeberang ke model, sama seperti
      // jalur satu dashboard. Snapshot lintas dashboard justru lebih berisiko:
      // user bisa mencentang beberapa dashboard sekaligus, dan sebagian di
      // antaranya memuat NIK, gaji, atau data cedera. Versi sebelumnya
      // mengirimkan snapshot mentah, dan tidak ada satu pun galat yang terbit
      // karena kebocoran data memang tidak menimbulkan error.
      const sanitizer = getSanitizer();

      // Build context from all dashboards
      const snapshotsForContext = snapshotResults.map((r) => sanitizer.sanitizeSnapshot(r.snapshot));
      const dashboardsForContext = snapshotResults.map(r => r.dashboard);
      const charBudget = TIER_CHAR_BUDGET[tierClassification.tier];
      const dataContext = buildMultiDashboardContext(snapshotsForContext, dashboardsForContext, charBudget);

      // Knowledge domain: tanpa ini model tidak tahu istilah, measure, dan KPI
      // plant, jadi ia menolak angka yang sebenarnya ADA di snapshot karena
      // tidak mengenali namanya. Judulnya digabung supaya pencocokan semantic
      // model mengenai semua dashboard yang ikut dibaca, bukan hanya yang pertama.
      const judulGabungan = snapshotResults.map((r) => r.dashboard.title).join(", ");
      const knowledge = SANITIZER_CONFIG.sendKnowledge
        ? buildKnowledgeBlock({
            dashboardTitle: judulGabungan,
            department: snapshotResults[0]?.dashboard?.department,
            question,
            tier: tierClassification.tier,
            dataText: dataContext,
          })
        : { text: "" };
      // Paket knowledge memuat GUID tenant Azure, nama supplier, dan rentang
      // spesifikasi produk. Semuanya digosok sebelum menyeberang.
      const knowledgeText = sanitizer.sanitizeKnowledge(knowledge.text);

      // Riwayat utas ini (6 turn TERAKHIR, bukan 6 pertama).
      const priorTurns = turnNumber > 1 ? await getTurns(conversationId, 6) : [];

      // Ingatan lintas percakapan: apa yang PERNAH dibahas user di utas lain.
      // Yang dikirim hanya judul, pertanyaan terakhir, dan cuplikan jawabannya,
      // supaya model tahu topiknya ada dan bisa merujuknya, tanpa memuat ulang
      // seluruh analisa lama ke dalam muatan.
      const ingatanLain = await ingatanLintasPercakapan(userId, conversationId);
      let konteksIngatan = '';
      if (ingatanLain.length > 0) {
        konteksIngatan = [
          "",
          "=== PERCAKAPAN LAIN USER INI (ingatan, BUKAN data) ===",
          "Ini rangkuman utas lain. Angka di sini SUDAH LAMA dan belum tentu",
          "masih berlaku. Boleh dirujuk untuk menyambungkan konteks, TAPI jangan",
          "dipakai sebagai angka jawaban. Kalau perlu angkanya, katakan dashboard",
          "mana yang harus dibuka lagi.",
          ...ingatanLain.map((i) => `- [${i.judul}] tanya: ${i.pertanyaanTerakhir}\n  jawab: ${i.cuplikanJawaban}`),
        ].join("\n");
        konteksIngatan = sanitizer.sanitizeText(konteksIngatan);
      }

      // Build prompts and call Gemini
      const systemPrompt = buildSystemPrompt({
        userName: user.nama,
        userDept: user.departemen,
        dashboardTitle: judulGabungan,
        knowledge: knowledgeText,
        sanitized: sanitizer.enabled,
      });

      // Riwayat ikut disanitasi: tersimpan de-tokenized di database, jadi
      // mengirimnya mentah membocorkan apa yang sudah digosok di turn sebelumnya.
      const unifiedHistory = priorTurns
        .map((t) => [
          { role: 'user', text: sanitizer.sanitizeText(t.question) },
          { role: 'model', text: sanitizer.sanitizeText(t.answer) },
        ]).flat();

      // Riwayat utas ini TIDAK diulang di sini: sudah dikirim lewat
      // `unifiedHistory` sebagai giliran percakapan sungguhan. Versi sebelumnya
      // menempelkannya lagi sebagai teks, jadi model menerima riwayat yang sama
      // dua kali dan muatannya terbuang percuma.
      const userMessage = [
        `Konteks multi-dashboard:\n${dataContext}`,
        konteksIngatan,
        `Pertanyaan user: ${sanitizer.sanitizeText(question)}`,
        "Jawab berdasarkan data dashboard di atas. Sebutkan dashboard mana yang menjawab bagian mana.",
      ].filter(Boolean).join("\n\n");

      const resolved = await resolveKey(userId, tierModel(tierClassification.tier));

      const result = await callAI({
        tier: tierClassification.tier,
        apiKey: resolved?.apiKey,
        queueKey: user.id,
        systemInstruction: systemPrompt,
        history: unifiedHistory,
        question: userMessage,
        onRetry: undefined,
      });

      // Format answer with dashboard attribution
      const dashboardRefs = snapshotResults.map(r => ({
        id: r.dashboard_id,
        title: r.dashboard.title,
        reason: `data dari ${r.dashboard.title}`,
        confidence: 1,
      }));

      // Token dipulihkan ke nama aslinya SEBELUM jawaban disimpan dan dikirim:
      // yang digosok adalah apa yang menyeberang ke model, bukan apa yang dibaca
      // user. Tanpa restore, user melihat ORANG_1 alih-alih nama sungguhan.
      //
      // Footer "Sumber data" TIDAK ditempelkan ke teks jawaban. UI sudah
      // menampilkan dashboards_used sebagai chip, jadi footer teks membuat user
      // membaca daftar sumber yang sama dua kali dalam satu gelembung.
      const formatted_answer = sanitizer.restore(result.text);

      req.ciaTelemetry?.event("ai_synthesis", {
        provider: "gemini",
        aiModel: result.model || null,
        inputTokens: result.usage?.promptTokenCount || 0,
        outputTokens: result.usage?.candidatesTokenCount || 0,
        totalTokens: result.usage?.totalTokenCount || 0,
      }).catch?.(() => {});

      // Store turn in history
      await addTurn(conversationId, turnNumber, question, dashboardRefs, formatted_answer, {
        classifier: 0,
        gemini: result.usage?.totalTokenCount || 0,
      });

      // ponytail: pemangkasan hanya dipasang di jalur ini, bukan di dua
      // early-return di atas. Turn saran dashboard panjangnya ratusan byte;
      // yang bisa mendekati atap 5GB adalah turn berjawaban penuh seperti ini.
      // Kalau nanti terbukti ada user yang menumpuk turn saran sampai berat,
      // pindahkan panggilannya ke addTurn di manager.
      await pangkasSampaiMuat(userId);

      res.json({
        answer: formatted_answer,
        dashboards_used: dashboardRefs,
        conversation_id: conversationId,
        turn_id: `${conversationId}-${turnNumber}`,
        tokens: result.usage,
        tier: tierClassification.tier,
      });

    } catch (error) {
      console.error('unifiedAsk error:', error);
      return res.status(500).json({
        error: 'Failed to answer question',
        message: error.message,
      });
    }
  }),
};
