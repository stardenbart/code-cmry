// ─────────────────────────────────────────────────────────────────────────────
// CODE AI quota estimation.
//
// HONEST LIMITATION: the Gemini API returns no remaining-quota header. Every
// percentage here is computed from OUR OWN counters compared against limits an
// admin configured by hand from Google AI Studio. If those limits are wrong, the
// indicator is wrong — which is why §6.5 of the plan calls for calibration: when a
// real 429 arrives while we still believe there is headroom, the effective limit
// is lowered automatically and the discrepancy logged.
//
// Quota is per API key, and CODE uses one key per user, so counting is per user.
// Google resets daily counters at midnight PACIFIC time (≈15:00 WIB), not local
// midnight — getting this wrong would shift the indicator by ~15 hours.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";
import { TIERS, tierModel } from "./aiProvider.js";

const sql = db.promise();

export const QUOTA_RESET_TZ = process.env.AI_QUOTA_RESET_TZ || "America/Los_Angeles";

/**
 * Free-tier limits READ FROM Google AI Studio on 2026-08-02.
 *
 *   gemini-3.6-flash        5 RPM / 250K TPM /  20 RPD
 *   gemini-3.5-flash        5 RPM / 250K TPM /  20 RPD
 *   gemini-3.5-flash-lite  15 RPM / 250K TPM / 500 RPD
 *   gemini-3.1-flash-lite  15 RPM / 250K TPM / 500 RPD
 *
 * Note there is no tokens-per-DAY limit on this tier — the token constraint is
 * per minute (TPM), which a single user cannot realistically hit. The binding
 * constraint is RPD, and for the deep tier it is brutally small: 20 per day.
 */
const DEFAULT_LIMITS = {
  cepat:    { rpd: Number(process.env.AI_RPD_CEPAT    ?? 500), rpm: Number(process.env.AI_RPM_CEPAT    ?? 15) },
  standar:  { rpd: Number(process.env.AI_RPD_STANDAR  ?? 500), rpm: Number(process.env.AI_RPM_STANDAR  ?? 15) },
  mendalam: { rpd: Number(process.env.AI_RPD_MENDALAM ?? 20),  rpm: Number(process.env.AI_RPM_MENDALAM ?? 5) },
};

/** Tokens per MINUTE, shared by every model on the free tier. */
export const TOKENS_PER_MINUTE = Number(process.env.AI_TPM ?? 250_000);
export const LIMITS_VERIFIED = /^(1|true|yes)$/i.test(process.env.AI_LIMITS_VERIFIED || "");

// Runtime downgrades learned from real 429s (per model, resets with the process)
const observedCeiling = new Map();

/** Start of the current Google quota day, as a UTC Date. */
export function quotaDayStart(now = new Date()) {
  // Offset of the reset timezone relative to UTC, in minutes
  const local = new Date(now.toLocaleString("en-US", { timeZone: QUOTA_RESET_TZ }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = local.getTime() - utc.getTime();

  const shifted = new Date(now.getTime() + offsetMs);
  shifted.setHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMs);
}

export function quotaResetAt(now = new Date()) {
  return new Date(quotaDayStart(now).getTime() + 24 * 60 * 60 * 1000);
}

function limitFor(tier) {
  const base = DEFAULT_LIMITS[tier] || DEFAULT_LIMITS.standar;
  const observed = observedCeiling.get(tierModel(tier));
  return {
    rpd: observed ? Math.min(base.rpd, observed) : base.rpd,
    rpm: base.rpm,
    adjusted: Boolean(observed),
  };
}

/**
 * Usage since the last Google reset, scoped to the KEY that will be charged.
 *
 * This distinction matters: free-tier quota belongs to the API key, not the
 * person. A user with their own key gets a private allowance, but everyone
 * sharing the universal server key draws from ONE pool — counting those
 * per-user would tell fifty people they each have 500 requests left when the
 * key only has 500 in total.
 *
 * Cache hits are excluded — they cost no quota.
 */
async function usageSince(userId, since, keySource) {
  const shared = keySource === "server";

  const [rows] = await sql.query(
    `SELECT model,
            COUNT(*)                       AS requests,
            COALESCE(SUM(total_tokens), 0) AS tokens
       FROM ai_chat_logs
      WHERE created_at >= ?
        AND error IS NULL
        AND (from_cache IS NULL OR from_cache = 0)
        AND key_source ${shared ? "= 'server'" : "= 'user' AND user_id = ?"}
      GROUP BY model`,
    shared ? [since] : [since, userId]
  );
  return rows;
}

/** Requests in the trailing 60 seconds — the RPM constraint. */
async function usageLastMinute(userId, keySource) {
  const shared = keySource === "server";

  const [rows] = await sql.query(
    `SELECT model, COUNT(*) AS requests
       FROM ai_chat_logs
      WHERE created_at >= (NOW() - INTERVAL 60 SECOND)
        AND error IS NULL
        AND (from_cache IS NULL OR from_cache = 0)
        AND key_source ${shared ? "= 'server'" : "= 'user' AND user_id = ?"}
      GROUP BY model`,
    shared ? [] : [userId]
  );
  return new Map(rows.map((r) => [r.model, Number(r.requests || 0)]));
}

/** Average tokens per non-cached question over the last 7 days. */
async function avgTokens(userId, keySource) {
  const shared = keySource === "server";
  const [rows] = await sql.query(
    `SELECT AVG(total_tokens) AS avg_tokens
       FROM ai_chat_logs
      WHERE total_tokens IS NOT NULL
        AND created_at >= (NOW() - INTERVAL 7 DAY)
        AND (from_cache IS NULL OR from_cache = 0)
        ${shared ? "" : "AND user_id = ?"}`,
    shared ? [] : [userId]
  );
  const v = Number(rows[0]?.avg_tokens);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : Number(process.env.AI_AVG_TOKENS_FALLBACK ?? 6000);
}

/**
 * Full quota picture for one user.
 *
 * @param {number} userId
 * @param {"user"|"server"} keySource  which key will be charged
 */
export async function summary(userId, keySource = "user") {
  const since = quotaDayStart();
  const [rows, avg, perMinute] = await Promise.all([
    usageSince(userId, since, keySource),
    avgTokens(userId, keySource),
    usageLastMinute(userId, keySource),
  ]);

  const byModel = new Map(rows.map((r) => [r.model, r]));

  // Totals cover every model used today, including ones no longer mapped to a
  // tier (e.g. after a model rename) — they still consumed the same key's quota.
  const usedRequests = rows.reduce((s, r) => s + Number(r.requests || 0), 0);
  const usedTokens = rows.reduce((s, r) => s + Number(r.tokens || 0), 0);

  let limitRequests = 0;
  const perTier = TIERS.map((tier) => {
    const model = tierModel(tier);
    const limit = limitFor(tier);
    const row = byModel.get(model);
    const used = Number(row?.requests || 0);
    const usedMinute = perMinute.get(model) || 0;
    limitRequests += limit.rpd;

    return {
      tier,
      model,
      used,
      tokens: Number(row?.tokens || 0),
      limit: limit.rpd,
      limitAdjusted: limit.adjusted,
      remainingPct: Math.max(0, Math.round(((limit.rpd - used) / limit.rpd) * 100)),
      rpm: { used: usedMinute, limit: limit.rpm, exhausted: usedMinute >= limit.rpm },
    };
  });

  const remainingPct = Math.max(0, Math.round(((limitRequests - usedRequests) / limitRequests) * 100));
  const questionsLeft = Math.max(0, limitRequests - usedRequests);

  // The overall bar is dominated by the two 500/day tiers, which would hide a
  // deep tier that is already spent. Surfaced separately so the UI can warn.
  const mostConstrained = [...perTier].sort((a, b) => a.remainingPct - b.remainingPct)[0];

  return {
    resetAt: quotaResetAt().toISOString(),
    resetTz: QUOTA_RESET_TZ,
    keySource,
    shared: keySource === "server",
    overall: {
      remainingPct,
      usedRequests,
      usedTokens,
      limitRequests,
      questionsLeft,
      tokensPerMinuteLimit: TOKENS_PER_MINUTE,
    },
    perTier,
    mostConstrained: mostConstrained
      ? { tier: mostConstrained.tier, remainingPct: mostConstrained.remainingPct, used: mostConstrained.used, limit: mostConstrained.limit }
      : null,
    avgTokensPerQuestion: avg,
    estimated: true,
    limitsVerified: LIMITS_VERIFIED,
  };
}

/**
 * Records a real 429 and tightens the effective limit for that model, so the
 * indicator stops promising headroom that does not exist.
 */
export async function recordRateLimitHit({ userId, model, tier }) {
  try {
    const since = quotaDayStart();
    const rows = await usageSince(userId, since);
    const row = rows.find((r) => r.model === model);
    const requestsToday = Number(row?.requests || 0);
    const tokensToday = Number(row?.tokens || 0);
    const configured = limitFor(tier || "standar").rpd;

    // We hit the wall at this count — treat it as the real ceiling
    if (requestsToday > 0 && requestsToday < configured) {
      observedCeiling.set(model, requestsToday);
      console.warn(
        `[CODE AI] 429 pada ${model} setelah ${requestsToday} request, padahal limit dikonfigurasi ${configured}. ` +
        `Limit efektif diturunkan ke ${requestsToday}. Perbarui AI_RPD_* di .env (Fase 0.1).`
      );
    }

    await sql.query(
      `INSERT INTO ai_quota_events (user_id, model, tier, requests_today, tokens_today, configured_limit)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, model, tier || null, requestsToday, tokensToday, configured]
    );
  } catch (err) {
    console.error("[CODE AI] gagal mencatat quota event:", err.message);
  }
}

/** Circuit-breaker state derived from the quota summary. */
export function breakerState(quota) {
  const pct = quota?.overall?.remainingPct ?? 100;
  if (pct < 5) return { level: "open", message: "Kuota CODE AI hari ini habis. Jawaban baru dihentikan sampai kuota reset; pertanyaan yang pernah dijawab masih bisa diambil dari cache." };
  if (pct < 15) return { level: "restricted", message: "Kuota menipis — semua pertanyaan dialihkan ke tier hemat." };
  if (pct < 40) return { level: "watch", message: null };
  return { level: "ok", message: null };
}
