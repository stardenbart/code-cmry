// Model KPI Library: editing atomik, versioning, dan revisi immutable.
//
// Setiap mutasi (create/edit/confirm/restore) berjalan dalam satu transaksi:
// UPDATE cia_kpis dan INSERT cia_kpi_revisions harus sukses bersama atau
// dibatalkan bersama. Kalau penulisan revisi gagal, perubahan KPI ikut
// rollback — histori tidak boleh bercabang dari state yang tidak tercatat.
//
// Restore TIDAK memutar versi mundur: ia menerapkan snapshot revisi target
// sebagai versi BARU (current+1) dengan revisi 'restore' sendiri. Histori hanya
// bertambah, tidak pernah dihapus atau ditimpa.
import crypto from "crypto";
import db from "../config/db.js";

const pool = db.promise();

// Field yang boleh diedit manual. Nama teknis binding (measure/table/model)
// TIDAK di sini — itu hanya diubah oleh sync.
const EDITABLE = new Set([
  "humanName", "synonyms", "definition", "businessFunction",
  "answerableQuestions", "domain", "unit", "numberFormat", "status",
]);
const ARRAY_FIELDS = new Set(["synonyms", "answerableQuestions"]);

class KpiError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = "KpiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireReason(reason) {
  if (typeof reason !== "string" || !reason.trim()) {
    throw new KpiError("Alasan (reason) wajib diisi", 400, "REASON_REQUIRED");
  }
  return reason.trim().slice(0, 500);
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const v of value) {
    const s = String(v ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || "kpi";
}

async function ensureUniqueSlug(base) {
  let slug = base;
  let n = 2;
  // Sederhana dan aman untuk laju create manual: cek keberadaan, tambah suffix.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [rows] = await pool.query("SELECT id FROM cia_kpis WHERE slug = ? LIMIT 1", [slug]);
    if (!rows.length) return slug;
    slug = `${base}-${n}`.slice(0, 160);
    n += 1;
  }
}

// ── Serialisasi ─────────────────────────────────────────────────────────────
function rowToKpi(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    humanName: row.human_name,
    synonyms: row.synonyms_json || [],
    definition: row.definition || "",
    businessFunction: row.business_function || "",
    answerableQuestions: row.answerable_questions_json || [],
    domain: row.domain || null,
    unit: row.unit || null,
    numberFormat: row.number_format || null,
    status: row.status,
    version: Number(row.version),
    source: row.source || null,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Snapshot untuk revisi: field editable + identitas + versi.
function snapshotOf(kpi) {
  return {
    slug: kpi.slug,
    humanName: kpi.humanName,
    synonyms: kpi.synonyms,
    definition: kpi.definition,
    businessFunction: kpi.businessFunction,
    answerableQuestions: kpi.answerableQuestions,
    domain: kpi.domain,
    unit: kpi.unit,
    numberFormat: kpi.numberFormat,
    status: kpi.status,
    version: kpi.version,
  };
}

// ── Revision writer (bisa di-override untuk uji atomicity) ────────────────────
async function defaultRevisionWriter(conn, { kpiId, version, before, after, action, reason, actorId }) {
  await conn.query(
    `INSERT INTO cia_kpi_revisions
       (kpi_id, version, before_json, after_json, action, reason, actor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [kpiId, version,
     before == null ? null : JSON.stringify(before),
     after == null ? null : JSON.stringify(after),
     action, reason, actorId ?? null]
  );
}
let _revisionWriter = defaultRevisionWriter;
export function __setRevisionWriterForTests(fn) {
  _revisionWriter = fn || defaultRevisionWriter;
}

async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function loadKpiForUpdate(conn, id) {
  const [rows] = await conn.query("SELECT * FROM cia_kpis WHERE id = ? FOR UPDATE", [id]);
  return rowToKpi(rows[0]);
}

// ── API model ─────────────────────────────────────────────────────────────
export async function getKpi(id) {
  const [rows] = await pool.query("SELECT * FROM cia_kpis WHERE id = ? LIMIT 1", [id]);
  const kpi = rowToKpi(rows[0]);
  if (!kpi) return null;
  const [bindings] = await pool.query(
    `SELECT id, binding_key, dashboard_id, report_id, page_name, visual_title,
            semantic_model, table_name, measure_name, display_caption,
            dimensions_json, date_table, date_column, date_logic, source,
            verification_status, first_seen_at, last_seen_at, missing_since
       FROM cia_kpi_bindings WHERE kpi_id = ? ORDER BY id ASC`, [id]);
  kpi.bindings = bindings.map((b) => ({
    id: b.id,
    bindingKey: b.binding_key,
    dashboardId: b.dashboard_id,
    reportId: b.report_id,
    pageName: b.page_name,
    visualTitle: b.visual_title,
    semanticModel: b.semantic_model,
    tableName: b.table_name,
    measureName: b.measure_name,
    displayCaption: b.display_caption,
    dimensions: b.dimensions_json || [],
    dateTable: b.date_table,
    dateColumn: b.date_column,
    dateLogic: b.date_logic,
    source: b.source,
    verificationStatus: b.verification_status,
    firstSeenAt: b.first_seen_at,
    lastSeenAt: b.last_seen_at,
    missingSince: b.missing_since,
  }));
  return kpi;
}

export async function listKpis(filters = {}) {
  const { q, domain, status, dashboardId } = filters;
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const clauses = [];
  const params = [];
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    clauses.push("(k.human_name LIKE ? OR k.slug LIKE ? OR CAST(k.synonyms_json AS CHAR) LIKE ?)");
    params.push(like, like, like);
  }
  if (domain && String(domain).trim()) { clauses.push("k.domain = ?"); params.push(String(domain).trim()); }
  if (status && String(status).trim()) { clauses.push("k.status = ?"); params.push(String(status).trim()); }
  if (dashboardId != null && String(dashboardId).trim()) {
    clauses.push(`EXISTS (SELECT 1 FROM cia_kpi_bindings b2
                   WHERE b2.kpi_id = k.id AND b2.dashboard_id = ?)`);
    params.push(dashboardId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM cia_kpis k ${where}`, params);
  const [rows] = await pool.query(
    `SELECT k.*,
            (SELECT GROUP_CONCAT(DISTINCT b.measure_name ORDER BY b.measure_name SEPARATOR ' · ')
               FROM cia_kpi_bindings b
              WHERE b.kpi_id = k.id AND b.measure_name IS NOT NULL) AS measure_summary,
            (SELECT COUNT(*) FROM cia_kpi_bindings b WHERE b.kpi_id = k.id) AS binding_count
       FROM cia_kpis k ${where}
      ORDER BY k.human_name ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return {
    total: Number(countRows[0].total) || 0,
    limit,
    offset,
    kpis: rows.map((r) => {
      const kpi = rowToKpi(r);
      kpi.measureSummary = r.measure_summary || null;
      kpi.bindingCount = Number(r.binding_count) || 0;
      return kpi;
    }),
  };
}

export async function createKpi(input = {}, actorId = null, reason = "Dibuat dari import/manual") {
  const humanName = String(input.humanName || "").trim();
  if (!humanName) throw new KpiError("humanName wajib diisi", 400, "HUMAN_NAME_REQUIRED");

  const baseSlug = input.slug ? slugify(input.slug) : slugify(`${input.domain || ""}-${humanName}`);
  const slug = await ensureUniqueSlug(baseSlug);

  const record = {
    slug,
    humanName,
    synonyms: uniqueStrings(input.synonyms),
    definition: String(input.definition || ""),
    businessFunction: String(input.businessFunction || ""),
    answerableQuestions: uniqueStrings(input.answerableQuestions),
    domain: input.domain ? String(input.domain).trim() : null,
    unit: input.unit ? String(input.unit).trim() : null,
    numberFormat: input.numberFormat ? String(input.numberFormat).trim() : null,
    status: input.status && ["draft", "confirmed", "deprecated"].includes(input.status)
      ? input.status : "draft",
    source: input.source ? String(input.source).slice(0, 40) : "manual",
    version: 1,
  };

  const id = await withTx(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO cia_kpis
         (slug, human_name, synonyms_json, definition, business_function,
          answerable_questions_json, domain, unit, number_format, status,
          version, source, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [record.slug, record.humanName, JSON.stringify(record.synonyms), record.definition,
       record.businessFunction, JSON.stringify(record.answerableQuestions), record.domain,
       record.unit, record.numberFormat, record.status, record.source, actorId, actorId]
    );
    const newId = res.insertId;
    await _revisionWriter(conn, {
      kpiId: newId, version: 1, before: null, after: { ...record, id: newId },
      action: "create", reason: reason ? String(reason).slice(0, 500) : "Dibuat", actorId,
    });
    return newId;
  });
  return getKpi(id);
}

async function mutateKpi(id, { action, apply, reason, actorId, expectedVersion }) {
  const safeReason = requireReason(reason);
  return withTx(async (conn) => {
    const current = await loadKpiForUpdate(conn, id);
    if (!current) throw new KpiError("KPI tidak ditemukan", 404, "KPI_NOT_FOUND");
    if (expectedVersion != null && Number(expectedVersion) !== current.version) {
      throw new KpiError("Versi KPI sudah berubah, muat ulang dahulu", 409, "STALE_VERSION");
    }

    const next = apply({ ...current, synonyms: [...current.synonyms], answerableQuestions: [...current.answerableQuestions] });
    next.version = current.version + 1;

    await conn.query(
      `UPDATE cia_kpis
          SET human_name = ?, synonyms_json = ?, definition = ?, business_function = ?,
              answerable_questions_json = ?, domain = ?, unit = ?, number_format = ?,
              status = ?, version = ?, updated_by = ?
        WHERE id = ?`,
      [next.humanName, JSON.stringify(next.synonyms), next.definition, next.businessFunction,
       JSON.stringify(next.answerableQuestions), next.domain, next.unit, next.numberFormat,
       next.status, next.version, actorId ?? null, id]
    );
    await _revisionWriter(conn, {
      kpiId: id, version: next.version,
      before: snapshotOf(current), after: snapshotOf(next),
      action, reason: safeReason, actorId,
    });
    return next.version;
  }).then(() => getKpi(id));
}

export async function updateKpi(id, patch = {}, actorId = null, reason = "", opts = {}) {
  return mutateKpi(id, {
    action: "edit", reason, actorId, expectedVersion: opts.expectedVersion,
    apply(kpi) {
      for (const [key, value] of Object.entries(patch)) {
        if (!EDITABLE.has(key)) continue; // slug/version/id diabaikan
        if (ARRAY_FIELDS.has(key)) kpi[key] = uniqueStrings(value);
        else if (key === "status") {
          if (["draft", "confirmed", "deprecated"].includes(value)) kpi.status = value;
        } else kpi[key] = value == null ? "" : String(value);
      }
      return kpi;
    },
  });
}

export async function confirmKpi(id, actorId = null, reason = "") {
  return mutateKpi(id, {
    action: "confirm", reason, actorId,
    apply(kpi) { kpi.status = "confirmed"; return kpi; },
  });
}

export async function listRevisions(id) {
  const [rows] = await pool.query(
    `SELECT id, kpi_id, version, before_json, after_json, action, reason, actor_id, created_at
       FROM cia_kpi_revisions WHERE kpi_id = ? ORDER BY version DESC, id DESC`, [id]);
  return rows.map((r) => ({
    id: r.id,
    kpiId: r.kpi_id,
    version: Number(r.version),
    before: r.before_json || null,
    after: r.after_json || null,
    action: r.action,
    reason: r.reason,
    actorId: r.actor_id,
    createdAt: r.created_at,
  }));
}

export async function restoreRevision(id, revisionId, actorId = null, reason = "") {
  const safeReason = requireReason(reason);
  // Revisi harus milik KPI ini; kalau tidak -> 404 (bukan bocor ke KPI lain).
  const [rows] = await pool.query(
    "SELECT id, kpi_id, after_json FROM cia_kpi_revisions WHERE id = ? AND kpi_id = ? LIMIT 1",
    [revisionId, id]
  );
  const target = rows[0];
  if (!target) throw new KpiError("Revisi tidak ditemukan untuk KPI ini", 404, "REVISION_NOT_FOUND");
  const after = target.after_json || {};

  return mutateKpi(id, {
    action: "restore", reason: safeReason, actorId,
    apply(kpi) {
      // Terapkan HANYA field yang benar-benar ADA di snapshot target (cek
      // `in`), bukan yang kebetulan null/undefined. Ini mencegah snapshot
      // PARSIAL (mis. revisi 'create' lama dari import yang tidak menyimpan
      // synonyms/definition) menghapus field yang tidak pernah tercatat di
      // snapshot itu. slug tidak pernah diubah.
      const has = (key) => Object.prototype.hasOwnProperty.call(after, key);
      if (has("humanName") && after.humanName != null) kpi.humanName = String(after.humanName);
      if (has("synonyms")) kpi.synonyms = uniqueStrings(after.synonyms);
      if (has("definition")) kpi.definition = after.definition != null ? String(after.definition) : "";
      if (has("businessFunction")) kpi.businessFunction = after.businessFunction != null ? String(after.businessFunction) : "";
      if (has("answerableQuestions")) kpi.answerableQuestions = uniqueStrings(after.answerableQuestions);
      if (has("domain")) kpi.domain = after.domain ?? null;
      if (has("unit")) kpi.unit = after.unit ?? null;
      if (has("numberFormat")) kpi.numberFormat = after.numberFormat ?? null;
      if (has("status") && ["draft", "confirmed", "deprecated"].includes(after.status)) kpi.status = after.status;
      return kpi;
    },
  });
}

// ── Binding helpers (dipakai import & sync) ─────────────────────────────────
//
// binding_key = SHA-256 dari enam bagian identitas binding. Deterministik dan
// unik → dasar idempotensi: import/sync yang mengenai binding sama tidak pernah
// menduplikasi baris.
export function computeBindingKey({
  kpiId = null,
  dashboardId = null, semanticModel = null, tableName = null,
  measureName = null, pageName = null, visualTitle = null,
} = {}) {
  const raw = [kpiId, dashboardId, semanticModel, tableName, measureName, pageName, visualTitle]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .join("|");
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

// Upsert satu binding. Pada duplikat: refresh last_seen_at, hidupkan lagi bila
// sebelumnya missing, isi field teknis yang baru diketahui — TETAPI JANGAN
// menurunkan verification_status yang sudah 'confirmed'/'rejected' oleh Admin.
export async function upsertBinding(binding, conn = pool) {
  const key = binding.bindingKey || computeBindingKey(binding);
  // SELECT dulu untuk penentuan created yang deterministik: affectedRows dari
  // ON DUPLICATE KEY UPDATE ambigu antar versi MySQL (1 untuk insert, 2 untuk
  // update, 0 untuk no-op) sehingga tidak bisa diandalkan untuk menghitung
  // "binding baru vs refresh".
  const [existingRows] = await conn.query(
    "SELECT id FROM cia_kpi_bindings WHERE binding_key = ? LIMIT 1", [key]);
  const created = existingRows.length === 0;
  await conn.query(
    `INSERT INTO cia_kpi_bindings
       (binding_key, kpi_id, dashboard_id, report_id, page_name, visual_title,
        semantic_model, table_name, measure_name, display_caption, dimensions_json,
        date_table, date_column, date_logic, source, verification_status,
        first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       last_seen_at    = NOW(),
       missing_since   = NULL,
       dashboard_id    = COALESCE(VALUES(dashboard_id), dashboard_id),
       report_id       = COALESCE(VALUES(report_id), report_id),
       page_name       = COALESCE(VALUES(page_name), page_name),
       visual_title    = COALESCE(VALUES(visual_title), visual_title),
       table_name      = COALESCE(VALUES(table_name), table_name),
       display_caption = COALESCE(VALUES(display_caption), display_caption),
       dimensions_json = COALESCE(VALUES(dimensions_json), dimensions_json),
       date_table      = COALESCE(VALUES(date_table), date_table),
       date_column     = COALESCE(VALUES(date_column), date_column),
       date_logic      = COALESCE(VALUES(date_logic), date_logic),
       verification_status = IF(verification_status IN ('confirmed','rejected'),
                                verification_status, 'discovered')`,
    [key, binding.kpiId, binding.dashboardId ?? null, binding.reportId ?? null,
     binding.pageName ?? null, binding.visualTitle ?? null, binding.semanticModel ?? null,
     binding.tableName ?? null, binding.measureName ?? null, binding.displayCaption ?? null,
     binding.dimensions ? JSON.stringify(binding.dimensions) : null,
     binding.dateTable ?? null, binding.dateColumn ?? null, binding.dateLogic ?? null,
     binding.source ?? null]
  );
  return { key, created };
}

export { KpiError, slugify };
