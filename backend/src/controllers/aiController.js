import db from "../config/db.js";
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
import { callAI, nextTier, TIER_LABELS, TIERS } from "../services/aiProvider.js";
import { classify, resolveTier, shouldEscalate } from "../services/aiRouter.js";
import * as aiQuota from "../services/aiQuota.js";
import * as aiCache from "../services/aiCache.js";
import {
  buildCatalog, buildNavigatorPrompt, parseNavigatorReply, resolveDashboardRefs,
} from "../services/aiNavigator.js";
import * as aiSettings from "../services/aiSettings.js";
import { buildKnowledgeBlock, isUnmappedModel, getGlossaryRows } from "../services/aiKnowledge.js";
import { tryAnswerLocally, AMBANG_KEYAKINAN } from "../services/aiLocalAnswer.js";
import * as rateLimit from "../services/rateLimiter.js";
import { getSanitizer, SANITIZER_CONFIG } from "../services/aiSanitizer.js";

const sql = db.promise();

const RATE_WINDOW_SECONDS = Number(process.env.AI_RATE_WINDOW_SECONDS ?? 60);
const RATE_MAX_REQUESTS = Number(process.env.AI_RATE_MAX_REQUESTS ?? 10);
const MAX_QUESTION_CHARS = 1000;
const HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS ?? 6);
const ESCALATION_ENABLED = !/^(0|false|off|no)$/i.test(process.env.AI_ESCALATION || "");

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getUser(userId) {
  const [rows] = await sql.query(
    "SELECT id, nama, departemen, tipe_akses, approved FROM users WHERE id = ?",
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

export const AiController = {
  /** GET /api/ai/status — what the frontend needs to render the AI entry point. */
  status: async (req, res) => {
    try {
      const row = await AiModel.getUserKeyRow(req.user.id);
      const userKey = row ? await AiModel.getUserKey(req.user.id) : null;
      const user = await getUser(req.user.id);
      const universalMeta = await aiSettings.getUniversalKeyMeta();
      const hasUniversal = Boolean((await aiSettings.getUniversalKey()) || hasServerKey());

      res.json({
        enabled: Boolean(userKey?.apiKey || hasUniversal),
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
      // silently break CODE AI for every user without a personal key.
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
          message: "CODE AI belum aktif: belum ada kunci akses. Simpan kunci pribadi di menu Pengaturan CODE AI.",
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
          `[CODE AI] Navigator terpotong (MAX_TOKENS) untuk pertanyaan: "${q.slice(0, 60)}". ` +
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
        dashboard_title: "(CODE AI Navigator)",
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
        message: err instanceof GeminiError ? err.message : "Gagal menghubungi CODE AI Navigator",
      });
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
  ask: async (req, res) => {
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

      // ── Fase A: jawab dari snapshot, tanpa model ─────────────────────────
      //
      // Ditempatkan SEBELUM resolveKey dan sebelum rate limit, bukan sesudah.
      // Jawaban ini tidak memanggil Gemini, jadi tidak butuh API key dan tidak
      // memakai kuota. Kalau ditaruh setelah resolveKey, user yang belum
      // mengisi API key mendapat 503 untuk pertanyaan yang sebenarnya bisa
      // dijawab tanpa key sama sekali. Rate limit pun memang dimaksudkan
      // menjaga kuota Gemini, seperti tertulis di komentarnya sendiri di bawah.
      const lokal = paksaAI
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

      const classified = classify({
        question: q,
        snapshot,
        historyTurns: pastTurns.length,
      });
      const routing = resolveTier({ requested: tier, classified, quota });

      // ── Cache lookup (Fase 5) — before spending any quota ────────────────────
      const key = aiCache.cacheKey({
        dashboardId: dashboard.id,
        question: q,
        snapshot,
        tier: routing.tier,
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

      const systemInstruction = buildSystemPrompt({
        userName: user.nama,
        userDept: user.departemen,
        dashboardTitle: dashboard.title,
        knowledge: knowledge.text,
        sanitized: sanitizer.enabled,
      });
      const userMessage = buildUserMessage({ dataContext, question: safeQuestion });

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
          systemInstruction,
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
  },
};
