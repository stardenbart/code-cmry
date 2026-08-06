// ─────────────────────────────────────────────────────────────────────────────
// Platform-wide CODE AI settings, editable by an admin from the UI.
//
// The universal key used to be env-only, which meant rotating it required SSH +
// a restart. Storing it here (encrypted, same scheme as personal keys) lets an
// admin manage it from Pengaturan CODE AI. The env var still works as a fallback
// so existing deployments keep running.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";
import { encryptSecret, decryptSecret } from "../config/secretBox.js";

const sql = db.promise();

export const UNIVERSAL_KEY = "universal_api_key";

// Short cache: this is read on every AI request, but an admin change must take
// effect without a restart.
const TTL_MS = Number(process.env.AI_SETTINGS_CACHE_MS ?? 15_000);
let cache = { value: undefined, meta: null, at: 0 };

export function invalidate() {
  cache = { value: undefined, meta: null, at: 0 };
}

async function loadUniversal() {
  if (cache.value !== undefined && Date.now() - cache.at < TTL_MS) return cache;

  let value = null;
  let meta = null;
  try {
    const [rows] = await sql.query(
      `SELECT s.svalue, s.updated_at, u.nama AS updated_by_name
         FROM ai_settings s
         LEFT JOIN users u ON u.id = s.updated_by
        WHERE s.skey = ?`,
      [UNIVERSAL_KEY]
    );
    if (rows[0]?.svalue) {
      value = decryptSecret(rows[0].svalue);
      meta = { source: "database", updatedAt: rows[0].updated_at, updatedBy: rows[0].updated_by_name || null };
    }
  } catch (err) {
    // Missing table (migration not run yet) must not break the AI feature
    if (err?.code !== "ER_NO_SUCH_TABLE") console.error("[CODE AI] gagal baca ai_settings:", err.message);
  }

  if (!value) {
    const envKey = (process.env.CODE_AI_UNIVERSAL_KEY || process.env.GEMINI_API_KEY || "").trim();
    if (envKey) {
      value = envKey;
      meta = { source: "env", updatedAt: null, updatedBy: null };
    }
  }

  cache = { value: value || null, meta, at: Date.now() };
  return cache;
}

/** The universal key, from the database first and the env var as fallback. */
export async function getUniversalKey() {
  return (await loadUniversal()).value;
}

/** Where the key came from — shown to admins so they know what they are editing. */
export async function getUniversalKeyMeta() {
  const { value, meta } = await loadUniversal();
  return value ? meta : null;
}

export async function setUniversalKey(apiKey, userId) {
  await sql.query(
    `INSERT INTO ai_settings (skey, svalue, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE svalue = VALUES(svalue), updated_by = VALUES(updated_by)`,
    [UNIVERSAL_KEY, encryptSecret(apiKey), userId || null]
  );
  invalidate();
}

export async function clearUniversalKey() {
  await sql.query("DELETE FROM ai_settings WHERE skey = ?", [UNIVERSAL_KEY]);
  invalidate();
}

/**
 * Same admin rule the frontend uses. Kept deliberately identical so a user who
 * sees the admin controls is the one the server accepts.
 */
export function isAdminUser(user) {
  return user?.role === "admin";
}

/**
 * Kunci untuk JOB dan AGEN, terpisah dari kunci chat user.
 *
 * Urutannya sengaja env lebih dulu, kebalikan dari jalur chat:
 *
 *   1. GEMINI_JOB_API_KEY   kunci khusus job, biasanya berbayar
 *   2. kunci universal      dari ai_settings, dipakai bersama chat
 *   3. kunci env lama       CODE_AI_UNIVERSAL_KEY atau GEMINI_API_KEY
 *
 * Alasannya kapasitas, bukan preferensi. Agen DAX memakai TIGA panggilan model
 * per pertanyaan, ditambah job harian dan chat 57 user. Satu kunci free-tier
 * tidak akan cukup, dan terbukti: kuota habis berkali-kali saat pengujian.
 *
 * Memisahkannya juga berarti kegagalan satu sisi tidak menjatuhkan sisi lain.
 * Chat yang menghabiskan kuota tidak lagi membuat laporan pagi gagal.
 *
 * Perlu diketahui: kunci PRIBADI user di ai_user_keys TIDAK dipakai di sini.
 * Job berjalan tanpa konteks user, jadi tidak ada pemilik yang kuotanya wajar
 * dipakai.
 */
export async function kunciUntukJob() {
  const dariEnvJob = (process.env.GEMINI_JOB_API_KEY || "").trim();
  if (dariEnvJob) return { apiKey: dariEnvJob, sumber: "env job" };

  const universal = await getUniversalKey();
  if (universal) return { apiKey: universal, sumber: "universal database" };

  const lama = (process.env.CODE_AI_UNIVERSAL_KEY || process.env.GEMINI_API_KEY || "").trim();
  if (lama) return { apiKey: lama, sumber: "env lama" };

  return null;
}
