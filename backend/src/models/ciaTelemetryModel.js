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

// ── Agregasi analytics ──────────────────────────────────────────────────────
//
// WHERE dibangun sekali dan dipakai ulang oleh semua query. SELURUH nilai lewat
// placeholder; hanya nama kolom (dari konstanta pemanggil) yang di-interpolasi.
// Filter dashboard memakai EXISTS ke events karena dashboard hanya tercatat di
// level event, bukan request.
function buildRequestWhere(filters, alias = "r") {
  const clauses = [`${alias}.started_at >= ?`, `${alias}.started_at <= ?`];
  const params = [filters.from, filters.to];
  if (filters.userId != null) { clauses.push(`${alias}.user_id = ?`); params.push(filters.userId); }
  if (filters.department) { clauses.push(`${alias}.department = ?`); params.push(filters.department); }
  if (filters.surface) { clauses.push(`${alias}.surface = ?`); params.push(filters.surface); }
  if (filters.status) { clauses.push(`${alias}.status = ?`); params.push(filters.status); }
  if (filters.retrievalMethod) { clauses.push(`${alias}.retrieval_method = ?`); params.push(filters.retrievalMethod); }
  if (filters.dashboardId) {
    clauses.push(`EXISTS (SELECT 1 FROM cia_request_events e2
                   WHERE e2.request_id = ${alias}.id AND e2.dashboard_id = ?)`);
    params.push(filters.dashboardId);
  }
  for (const [filterKey, column] of [
    ["semanticModel", "semantic_model"], ["provider", "provider"], ["aiModel", "ai_model"],
  ]) {
    if (filters[filterKey]) {
      clauses.push(`EXISTS (SELECT 1 FROM cia_request_events ef
                     WHERE ef.request_id = ${alias}.id AND ef.${column} = ?)`);
      params.push(filters[filterKey]);
    }
  }
  return { clause: clauses.join(" AND "), params };
}

export async function aggregateRequests(filters) {
  const { clause, params } = buildRequestWhere(filters);
  const [rows] = await sql.query(
    `SELECT
        COUNT(*)                                         AS requests,
        COUNT(DISTINCT r.user_id)                        AS active_users,
        COALESCE(SUM(r.input_tokens), 0)                 AS input_tokens,
        COALESCE(SUM(r.output_tokens), 0)                AS output_tokens,
        COALESCE(SUM(r.total_tokens), 0)                 AS total_tokens,
        COALESCE(SUM(r.status = 'success'), 0)           AS success_count,
        COALESCE(SUM(r.status = 'partial'), 0)           AS partial_count,
        COALESCE(SUM(r.status = 'error'), 0)             AS error_count,
        COALESCE(SUM(r.retrieval_method = 'live_dax'), 0) AS live_dax_count,
        COALESCE(SUM(r.retrieval_method = 'snapshot' OR r.status = 'fallback'), 0) AS fallback_count,
        AVG(r.latency_ms)                                AS avg_latency,
        AVG(r.retrieval_rounds)                          AS avg_rounds
       FROM cia_requests r
      WHERE ${clause}`,
    params
  );
  return rows[0];
}

export async function p95Latency(filters) {
  const { clause, params } = buildRequestWhere(filters);
  // CUME_DIST() memberi P95 dalam SATU query, bukan menarik tiap baris latency
  // ke aplikasi lalu menghitung di JS.
  const [rows] = await sql.query(
    `SELECT latency_ms FROM (
        SELECT r.latency_ms, CUME_DIST() OVER (ORDER BY r.latency_ms) AS cd
          FROM cia_requests r
         WHERE ${clause} AND r.latency_ms IS NOT NULL
     ) t WHERE t.cd >= 0.95 ORDER BY t.cd ASC LIMIT 1`,
    params
  );
  return rows.length ? Number(rows[0].latency_ms) : null;
}

export async function medianLatency(filters) {
  const { clause, params } = buildRequestWhere(filters);
  const [rows] = await sql.query(
    `WITH ranked AS (
       SELECT r.latency_ms,
              ROW_NUMBER() OVER (ORDER BY r.latency_ms) AS rn,
              COUNT(*) OVER () AS cnt
         FROM cia_requests r
        WHERE ${clause} AND r.latency_ms IS NOT NULL
     )
     SELECT AVG(latency_ms) AS median_latency
       FROM ranked
      WHERE rn IN (FLOOR((cnt + 1) / 2), FLOOR((cnt + 2) / 2))`,
    params
  );
  return rows[0]?.median_latency == null ? null : Number(rows[0].median_latency);
}

export async function aggregateEvents(filters) {
  const { clause, params } = buildRequestWhere(filters);
  const [rows] = await sql.query(
    `SELECT
        COALESCE(SUM(e.stage IN ('execute_dax','repair_dax') AND e.status = 'error'), 0) AS dax_failures,
        COALESCE(SUM(e.error_code = 'ROUTER_NO_MATCH'), 0)                               AS planner_no_match
       FROM cia_request_events e
       JOIN cia_requests r ON r.id = e.request_id
      WHERE ${clause}`,
    params
  );
  return rows[0];
}

export async function requestSeries(filters) {
  const { clause, params } = buildRequestWhere(filters);
  // WIB = UTC+7. started_at disimpan UTC; digeser 7 jam sebelum DATE() supaya
  // bucket harian sesuai zona laporan tanpa bergantung tabel timezone MySQL.
  const [rows] = await sql.query(
    `SELECT DATE(r.started_at + INTERVAL 7 HOUR) AS day,
            COUNT(*)                       AS requests,
            COALESCE(SUM(r.input_tokens),0)  AS input_tokens,
            COALESCE(SUM(r.output_tokens),0) AS output_tokens,
            COALESCE(SUM(r.total_tokens),0)  AS total_tokens
       FROM cia_requests r
      WHERE ${clause}
      GROUP BY day ORDER BY day ASC`,
    params
  );
  return rows;
}

// Peta dimensi -> ekspresi SELECT/GROUP. Kunci-kunci ini adalah SATU-SATUNYA
// nilai yang boleh masuk; pemanggil (service) memvalidasi lebih dulu.
const BREAKDOWN_SPECS = {
  user: { key: "r.user_id", label: "r.actor_name", source: "request" },
  department: { key: "r.department", label: "r.department", source: "request" },
  surface: { key: "r.surface", label: "r.surface", source: "request" },
  status: { key: "r.status", label: "r.status", source: "request" },
  retrieval_method: { key: "r.retrieval_method", label: "r.retrieval_method", source: "request" },
  dashboard: { key: "e.dashboard_id", label: "e.dashboard_name", source: "event" },
  semantic_model: { key: "e.semantic_model", label: "e.semantic_model", source: "event" },
  provider: { key: "e.provider", label: "e.provider", source: "event" },
  ai_model: { key: "e.ai_model", label: "e.ai_model", source: "event" },
};

export async function breakdownBy(filters, dimension) {
  const spec = BREAKDOWN_SPECS[dimension];
  if (!spec) throw new Error(`dimensi tidak dikenal di model: ${dimension}`);
  const { clause, params } = buildRequestWhere(filters);

  if (spec.source === "event") {
    const [rows] = await sql.query(
      `SELECT ${spec.key} AS \`key\`, MAX(${spec.label}) AS label,
              COUNT(DISTINCT r.id)             AS requests,
              COALESCE(SUM(e.total_tokens),0)  AS total_tokens,
              COALESCE(SUM(e.input_tokens),0)  AS input_tokens,
              COALESCE(SUM(e.output_tokens),0) AS output_tokens
         FROM cia_request_events e
         JOIN cia_requests r ON r.id = e.request_id
        WHERE ${clause} AND ${spec.key} IS NOT NULL
        GROUP BY ${spec.key} ORDER BY requests DESC LIMIT 100`,
      params
    );
    return rows;
  }

  const [rows] = await sql.query(
    `SELECT ${spec.key} AS \`key\`, MAX(${spec.label}) AS label,
            COUNT(*)                        AS requests,
            COALESCE(SUM(r.total_tokens),0)  AS total_tokens,
            COALESCE(SUM(r.input_tokens),0)  AS input_tokens,
            COALESCE(SUM(r.output_tokens),0) AS output_tokens,
            AVG(r.latency_ms)                AS avg_latency
       FROM cia_requests r
      WHERE ${clause} AND ${spec.key} IS NOT NULL
      GROUP BY ${spec.key} ORDER BY requests DESC LIMIT 100`,
    params
  );
  return rows;
}

export async function retrievalHealthRows(filters) {
  const { clause, params } = buildRequestWhere(filters);
  const [errorsByCode] = await sql.query(
    `SELECT e.error_code AS code, COUNT(*) AS count
       FROM cia_request_events e JOIN cia_requests r ON r.id = e.request_id
      WHERE ${clause} AND e.status = 'error' AND e.error_code IS NOT NULL
      GROUP BY e.error_code ORDER BY count DESC LIMIT 50`,
    params
  );
  const [stageErrors] = await sql.query(
    `SELECT e.stage AS stage, COUNT(*) AS count
       FROM cia_request_events e JOIN cia_requests r ON r.id = e.request_id
      WHERE ${clause} AND e.status = 'error'
      GROUP BY e.stage ORDER BY count DESC LIMIT 50`,
    params
  );
  const [methodSplit] = await sql.query(
    `SELECT COALESCE(r.retrieval_method,'none') AS method, COUNT(*) AS count
       FROM cia_requests r WHERE ${clause}
      GROUP BY method ORDER BY count DESC`,
    params
  );
  const [latencyByModel] = await sql.query(
    `SELECT e.ai_model AS model, AVG(e.latency_ms) AS avg_latency, COUNT(*) AS count
       FROM cia_request_events e JOIN cia_requests r ON r.id = e.request_id
      WHERE ${clause} AND e.ai_model IS NOT NULL AND e.latency_ms IS NOT NULL
      GROUP BY e.ai_model ORDER BY count DESC LIMIT 50`,
    params
  );
  const [rounds] = await sql.query(
    `SELECT AVG(r.retrieval_rounds) AS avg_rounds, MAX(r.retrieval_rounds) AS max_rounds
       FROM cia_requests r WHERE ${clause}`,
    params
  );
  return { errorsByCode, stageErrors, methodSplit, latencyByModel, rounds: rounds[0] };
}

export async function filterOptionRows(filters) {
  const { clause, params } = buildRequestWhere(filters);
  const [users] = await sql.query(
    `SELECT r.user_id AS id, MAX(r.actor_name) AS name
       FROM cia_requests r WHERE ${clause} AND r.user_id IS NOT NULL
      GROUP BY r.user_id ORDER BY name ASC LIMIT 500`,
    params
  );
  const [departments] = await sql.query(
    `SELECT DISTINCT r.department AS department
       FROM cia_requests r WHERE ${clause} AND r.department IS NOT NULL
      ORDER BY department ASC LIMIT 200`,
    params
  );
  const [surfaces] = await sql.query(
    `SELECT DISTINCT r.surface AS surface
       FROM cia_requests r WHERE ${clause} ORDER BY surface ASC LIMIT 50`,
    params
  );
  const [dashboards] = await sql.query(
    `SELECT e.dashboard_id AS id, MAX(e.dashboard_name) AS name
       FROM cia_request_events e JOIN cia_requests r ON r.id = e.request_id
      WHERE ${clause} AND e.dashboard_id IS NOT NULL
      GROUP BY e.dashboard_id ORDER BY name ASC LIMIT 200`,
    params
  );
  async function distinctEvent(column, maxLength) {
    const allowed = new Set(["semantic_model", "provider", "ai_model"]);
    if (!allowed.has(column)) throw new Error("kolom opsi event tidak valid");
    const [rows] = await sql.query(
      `SELECT DISTINCT e.${column} AS value
         FROM cia_request_events e JOIN cia_requests r ON r.id = e.request_id
        WHERE ${clause} AND e.${column} IS NOT NULL
        ORDER BY value ASC LIMIT ${maxLength}`,
      params
    );
    return rows;
  }
  const [semanticModels, providers, aiModels] = await Promise.all([
    distinctEvent("semantic_model", 500), distinctEvent("provider", 50), distinctEvent("ai_model", 200),
  ]);
  return { users, departments, surfaces, dashboards, semanticModels, providers, aiModels };
}
