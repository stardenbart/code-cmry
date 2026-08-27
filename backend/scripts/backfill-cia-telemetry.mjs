// Backfill telemetry CIA dari log lama (ai_chat_logs + ai_unified_turns).
//
// IDEMPOTEN: unique key (legacy_source, legacy_id) di cia_requests memastikan
// satu baris legacy hanya dipetakan satu kali. ON DUPLICATE KEY UPDATE (no-op)
// membuat run kedua tidak menambah apa pun. `insertId` membedakan insert baru
// dari duplicate karena connection ini memakai semantics FOUND_ROWS.
//
// Log lama TIDAK diubah. Tabel ai_chat_logs/ai_unified_turns hanya dibaca.
// Backfill tidak membuat baris event: detail per-stage tidak tersedia untuk log
// lama, dan compatibility reader menangani request tanpa event.
//
// Pemakaian:
//   node scripts/backfill-cia-telemetry.mjs --dry-run   (default) hitung kandidat
//   node scripts/backfill-cia-telemetry.mjs --apply     tulis cia_requests
import "dotenv/config";
import crypto from "crypto";
import { pathToFileURL } from "url";
import db from "../src/config/db.js";
import { previewQuestion, fingerprintQuestion } from "../src/services/ciaTelemetry.service.js";

const sql = db.promise();
const BATCH = 500;

// Memetakan berbagai bentuk tokens_used unified ke input/output/total.
export function mapUnifiedTokens(json) {
  const t = json && typeof json === "object" ? json : {};
  if (t.promptTokenCount != null || t.candidatesTokenCount != null || t.totalTokenCount != null) {
    const input = Number(t.promptTokenCount) || 0;
    const output = Number(t.candidatesTokenCount) || 0;
    return { input, output, total: Number(t.totalTokenCount) || input + output };
  }
  if (t.input != null || t.output != null || t.total != null) {
    const input = Number(t.input) || 0;
    const output = Number(t.output) || 0;
    return { input, output, total: Number(t.total) || input + output };
  }
  // Bentuk lama {classifier, gemini} (atau apa pun): jumlahkan angka yang ada.
  const total = Object.values(t).reduce((s, v) => s + (Number(v) || 0), 0);
  return { input: 0, output: 0, total };
}

async function insertLegacyRequest(x) {
  const [res] = await sql.query(
    `INSERT INTO cia_requests
       (request_uuid, user_id, actor_name, department, surface, conversation_ref,
        question_preview, question_fingerprint, status, retrieval_method,
        input_tokens, output_tokens, total_tokens, latency_ms, retrieval_rounds,
        started_at, finished_at, legacy_source, legacy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE request_uuid = request_uuid`,
    [
      crypto.randomUUID(), x.userId ?? null, x.actorName ?? null, x.department ?? null,
      x.surface, x.conversationRef ?? null,
      previewQuestion(x.question), fingerprintQuestion(x.question || ""),
      x.status, x.retrievalMethod,
      x.input || 0, x.output || 0, x.total || 0, null, 0,
      x.startedAt, x.startedAt, x.legacySource, x.legacyId,
    ]
  );
  // Connection ini memakai semantics FOUND_ROWS, jadi duplicate no-op dapat
  // tetap melaporkan affectedRows=1. Hanya insert baru yang membawa insertId.
  return Number(res.insertId) > 0 ? 1 : 0;
}

function restrictClause(restrictIds, col) {
  if (!Array.isArray(restrictIds) || restrictIds.length === 0) return { extra: "", params: [] };
  return { extra: ` AND ${col} IN (${restrictIds.map(() => "?").join(",")})`, params: restrictIds };
}

export async function backfillChatLogs(apply, { restrictIds } = {}) {
  const r = restrictClause(restrictIds, "c.id");
  let lastId = 0, inserted = 0, candidates = 0;
  for (;;) {
    const [rows] = await sql.query(
      `SELECT c.id, c.user_id, c.dashboard_id, c.dashboard_title, c.question,
              c.error, c.prompt_tokens, c.output_tokens, c.total_tokens,
              c.answered_locally, c.created_at,
              u.id AS resolved_user_id, u.nama AS actor_name, u.departemen AS department
         FROM ai_chat_logs c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id > ?${r.extra}
        ORDER BY c.id ASC LIMIT ?`,
      [lastId, ...r.params, BATCH]
    );
    if (!rows.length) break;
    candidates += rows.length;
    lastId = rows[rows.length - 1].id;
    if (!apply) continue;
    for (const row of rows) {
      inserted += await insertLegacyRequest({
        legacySource: "ai_chat_logs",
        legacyId: String(row.id),
        userId: row.resolved_user_id, // null bila user sudah dihapus (hindari FK gagal)
        actorName: row.actor_name,
        department: row.department,
        surface: "dashboard",
        question: row.question,
        status: row.error ? "error" : "success",
        retrievalMethod: "snapshot",
        input: row.prompt_tokens || 0,
        output: row.output_tokens || 0,
        total: row.total_tokens || 0,
        startedAt: row.created_at,
      });
    }
  }
  return { candidates, inserted };
}

export async function backfillUnifiedTurns(apply, { restrictIds } = {}) {
  const r = restrictClause(restrictIds, "t.id");
  let lastId = 0, inserted = 0, candidates = 0;
  for (;;) {
    const [rows] = await sql.query(
      `SELECT t.id, t.conversation_id, t.question, t.tokens_used, t.created_at,
              conv.user_id AS conv_user,
              u.id AS resolved_user_id, u.nama AS actor_name, u.departemen AS department
         FROM ai_unified_turns t
         JOIN ai_unified_conversations conv ON conv.id = t.conversation_id
         LEFT JOIN users u ON u.id = conv.user_id
        WHERE t.id > ?${r.extra}
        ORDER BY t.id ASC LIMIT ?`,
      [lastId, ...r.params, BATCH]
    );
    if (!rows.length) break;
    candidates += rows.length;
    lastId = rows[rows.length - 1].id;
    if (!apply) continue;
    for (const row of rows) {
      const tok = mapUnifiedTokens(row.tokens_used);
      inserted += await insertLegacyRequest({
        legacySource: "ai_unified_turns",
        legacyId: String(row.id),
        userId: row.resolved_user_id,
        actorName: row.actor_name,
        department: row.department,
        surface: "multi_chat",
        conversationRef: String(row.conversation_id),
        question: row.question,
        status: "success",
        retrievalMethod: "snapshot",
        input: tok.input,
        output: tok.output,
        total: tok.total,
        startedAt: row.created_at,
      });
    }
  }
  return { candidates, inserted };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "apply" : "dry-run";
  const chat = await backfillChatLogs(apply);
  const unified = await backfillUnifiedTurns(apply);
  console.log(`[cia:backfill] mode=${mode}`);
  console.log(`  ai_chat_logs      : kandidat=${chat.candidates} inserted=${chat.inserted}`);
  console.log(`  ai_unified_turns  : kandidat=${unified.candidates} inserted=${unified.inserted}`);
  if (!apply) console.log("  (dry-run: tidak ada baris yang ditulis)");
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
