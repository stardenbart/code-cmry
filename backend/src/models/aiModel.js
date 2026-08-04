import db from "../config/db.js";
import { encryptSecret, decryptSecret } from "../config/secretBox.js";

const sql = db.promise();

export const AiModel = {
  // ── Per-user Gemini API key ────────────────────────────────────────────────
  async getUserKeyRow(userId) {
    const [rows] = await sql.query(
      "SELECT user_id, api_key_enc, model, updated_at FROM ai_user_keys WHERE user_id = ?",
      [userId]
    );
    return rows[0] || null;
  },

  /** Returns the decrypted key, or null when the user has not saved one. */
  async getUserKey(userId) {
    const row = await AiModel.getUserKeyRow(userId);
    if (!row) return null;
    return { apiKey: decryptSecret(row.api_key_enc), model: row.model || null };
  },

  async saveUserKey(userId, apiKey, model) {
    await sql.query(
      `INSERT INTO ai_user_keys (user_id, api_key_enc, model)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE api_key_enc = VALUES(api_key_enc), model = VALUES(model)`,
      [userId, encryptSecret(apiKey), model || null]
    );
  },

  async saveUserModel(userId, model) {
    await sql.query("UPDATE ai_user_keys SET model = ? WHERE user_id = ?", [model || null, userId]);
  },

  async deleteUserKey(userId) {
    await sql.query("DELETE FROM ai_user_keys WHERE user_id = ?", [userId]);
  },

  // ── Chat log / audit trail ─────────────────────────────────────────────────
  async logChat(entry) {
    const {
      user_id,
      dashboard_id = null,
      dashboard_title = null,
      question,
      answer = null,
      model = null,
      key_source = null,
      visuals_used = null,
      rows_used = null,
      prompt_chars = null,
      error = null,
      tier = null,
      prompt_tokens = null,
      output_tokens = null,
      total_tokens = null,
      from_cache = 0,
      // Fase A: dipakai menghitung berapa sering jawaban tidak memanggil model.
      intent = null,
      answered_locally = 0,
    } = entry;

    const [res] = await sql.query(
      `INSERT INTO ai_chat_logs
         (user_id, dashboard_id, dashboard_title, question, answer, model,
          key_source, visuals_used, rows_used, prompt_chars, error,
          tier, prompt_tokens, output_tokens, total_tokens, from_cache,
          intent, answered_locally)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id, dashboard_id, dashboard_title, question, answer, model,
        key_source, visuals_used, rows_used, prompt_chars, error,
        tier, prompt_tokens, output_tokens, total_tokens, from_cache,
        intent, answered_locally ? 1 : 0,
      ]
    );
    return res.insertId;
  },

  /** Oldest-first recent turns for one user + dashboard (used as chat memory). */
  async getHistory(userId, dashboardId, limit = 10) {
    const [rows] = await sql.query(
      `SELECT id, question, answer, model, created_at
         FROM ai_chat_logs
        WHERE user_id = ?
          AND dashboard_id = ?
          AND answer IS NOT NULL
          AND error IS NULL
        ORDER BY id DESC
        LIMIT ?`,
      [userId, dashboardId, Number(limit)]
    );
    return rows.reverse();
  },

  async clearHistory(userId, dashboardId) {
    await sql.query("DELETE FROM ai_chat_logs WHERE user_id = ? AND dashboard_id = ?", [
      userId,
      dashboardId,
    ]);
  },
};
