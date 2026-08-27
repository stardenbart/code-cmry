// Model lifecycle telemetry CIA: satu baris cia_requests per pertanyaan, baris
// berurutan cia_request_events per tahap, lalu satu UPDATE penutup.
//
// Semua query memakai placeholder mysql2. Model ini SENGAJA tidak menangkap
// error sendiri: pemanggilnya (ciaTelemetry.service.js) yang membungkus tiap
// operasi dengan try/catch best-effort supaya kegagalan analytics tidak pernah
// mengubah status jawaban CIA. Memisahkan tanggung jawab begitu membuat model
// tetap bisa diuji lurus (error query benar-benar melempar) sekaligus aman di
// jalur produksi.
import db from "../config/db.js";

const sql = db.promise();

export async function insertRequest({
  requestId, userId = null, actorName = null, department = null,
  surface, conversationRef = null, questionPreview = null, questionFingerprint = null,
  startedAt = new Date(), legacySource = null, legacyId = null,
}) {
  const [res] = await sql.query(
    `INSERT INTO cia_requests
       (request_uuid, user_id, actor_name, department, surface, conversation_ref,
        question_preview, question_fingerprint, status, started_at,
        legacy_source, legacy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, ?)`,
    [requestId, userId, actorName, department, surface, conversationRef,
     questionPreview, questionFingerprint, startedAt, legacySource, legacyId]
  );
  return { id: res.insertId, requestId };
}

export async function insertEvent(requestDbId, {
  sequenceNo, stage, dashboardId = null, dashboardName = null,
  semanticModel = null, provider = null, aiModel = null,
  inputTokens = 0, outputTokens = 0, totalTokens = 0,
  latencyMs = null, rowsReturned = null, status = "success",
  errorCode = null, errorMessage = null, metadata = null,
}) {
  const [res] = await sql.query(
    `INSERT INTO cia_request_events
       (request_id, sequence_no, stage, dashboard_id, dashboard_name, semantic_model,
        provider, ai_model, input_tokens, output_tokens, total_tokens,
        latency_ms, rows_returned, status, error_code, error_message, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [requestDbId, sequenceNo, stage, dashboardId, dashboardName, semanticModel,
     provider, aiModel, inputTokens, outputTokens, totalTokens,
     latencyMs, rowsReturned, status, errorCode, errorMessage,
     metadata == null ? null : JSON.stringify(metadata)]
  );
  return res.insertId;
}

export async function finishRequest(requestDbId, {
  status, retrievalMethod = null,
  inputTokens = 0, outputTokens = 0, totalTokens = 0,
  latencyMs = null, retrievalRounds = 0, finishedAt = new Date(),
}) {
  await sql.query(
    `UPDATE cia_requests
        SET status = ?, retrieval_method = ?, input_tokens = ?, output_tokens = ?,
            total_tokens = ?, latency_ms = ?, retrieval_rounds = ?, finished_at = ?
      WHERE id = ?`,
    [status, retrievalMethod, inputTokens, outputTokens, totalTokens,
     latencyMs, retrievalRounds, finishedAt, requestDbId]
  );
}

export async function findRequestTrace(requestUuid) {
  const [reqs] = await sql.query(
    `SELECT * FROM cia_requests WHERE request_uuid = ? LIMIT 1`,
    [requestUuid]
  );
  if (!reqs.length) return null;
  const request = reqs[0];
  const [events] = await sql.query(
    `SELECT * FROM cia_request_events WHERE request_id = ? ORDER BY sequence_no ASC`,
    [request.id]
  );
  return { request, events };
}
