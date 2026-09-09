// Reconcile binding KPI dari inventory Power BI aktual.
//
// Sumber: model_measure (measure -> model/table) dan visual_field_usage
// (dashboard/report/page/visual -> field). Reconcile mengikat KPI yang sudah
// ada (dari import) ke tempat measure-nya benar-benar dirender, MENGISI
// dashboard_id/report_id/page/visual sehingga ACL web bisa memfilter binding.
//
// ATURAN:
//  - Binding yang tidak lagi terlihat TIDAK dihapus — verification_status-nya
//    menjadi 'missing' (kecuali sudah 'confirmed'/'rejected' oleh Admin).
//  - Binding yang muncul kembali dihidupkan lagi (upsertBinding menormalkan
//    missing_since=NULL dan discovered).
//  - Reconcile hanya menyentuh binding teknis + kehadiran; ia TIDAK PERNAH
//    mengubah nama/definisi/sinonim KPI (itu wewenang Admin).
//  - Error per-dashboard disanitasi dan tidak menghentikan dashboard lain;
//    status akhir 'partial' bila ada error.
//
// Inventory dapat diinjeksi (uji) — default membaca DB.
import crypto from "crypto";
import db from "../config/db.js";
import { computeBindingKey, upsertBinding } from "../models/ciaKpiModel.js";
import { safeError } from "./ciaTelemetry.service.js";
import { clearKpiLibraryCache } from "./ciaKpiLibrary.service.js";

const pool = db.promise();

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    const s = String(v ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ── Default inventory (DB) ──────────────────────────────────────────────────
async function defaultListDashboards() {
  // DISTINCT hanya pada dashboard_id: sebuah dashboard bisa punya beberapa
  // report_id di visual_field_usage, dan report_id per baris visual sudah
  // dibawa listVisualFields. Tanpa dedupe ini, dashboard multi-report discan
  // berkali-kali dan statistiknya menggembung.
  const [rows] = await pool.query(
    `SELECT DISTINCT dashboard_id AS id
       FROM visual_field_usage WHERE dashboard_id IS NOT NULL`);
  return rows;
}
async function defaultListVisualFields(dashboardId) {
  const [rows] = await pool.query(
    `SELECT report_id, page_name, visual_title, field_name
       FROM visual_field_usage WHERE dashboard_id = ?`, [dashboardId]);
  return rows;
}
async function defaultMeasureIndex() {
  const [rows] = await pool.query(
    "SELECT measure_name, model_name, table_name FROM model_measure");
  const map = new Map();
  for (const r of rows) {
    const k = String(r.measure_name || "").trim().toLowerCase();
    if (k && !map.has(k)) map.set(k, { modelName: r.model_name, tableName: r.table_name });
  }
  return map;
}

// Resolver measure(lower) -> { kpiId, semanticModel }. Diutamakan dari binding
// import (punya semantic_model), lalu fallback ke sinonim KPI.
async function buildKpiResolver() {
  const map = new Map();
  const add = (raw, value) => {
    const k = String(raw || "").trim().toLowerCase();
    if (!k) return;
    const values = map.get(k) || [];
    const identity = `${value.kpiId}|${value.measureName}|${value.semanticModel}`;
    if (!values.some((item) => `${item.kpiId}|${item.measureName}|${item.semanticModel}` === identity)) {
      values.push(value);
    }
    map.set(k, values);
  };
  const [bindings] = await pool.query(
    `SELECT kpi_id, measure_name, semantic_model, display_caption, source,
            dimensions_json, date_table, date_column, date_logic
       FROM cia_kpi_bindings
      WHERE measure_name IS NOT NULL AND verification_status IN ('discovered','confirmed')
      ORDER BY (source = 'catalog_import') DESC, id DESC`);
  for (const b of bindings) {
    const resolved = {
      kpiId: b.kpi_id,
      semanticModel: b.semantic_model,
      measureName: b.measure_name,
      dimensions: b.dimensions_json || [],
      dateTable: b.date_table,
      dateColumn: b.date_column,
      dateLogic: b.date_logic,
    };
    const aliases = b.source === "catalog_import"
      ? [b.measure_name, b.display_caption] : [b.measure_name];
    for (const raw of aliases) {
      add(raw, resolved);
    }
  }
  const [kpis] = await pool.query("SELECT id, synonyms_json FROM cia_kpis");
  for (const kp of kpis) {
    for (const syn of (kp.synonyms_json || [])) {
      const k = String(syn).trim().toLowerCase();
      if (k && !map.has(k)) add(k, { kpiId: kp.id, semanticModel: null, measureName: syn });
    }
  }
  return map;
}

export async function createSyncRun(actorId = null) {
  const runUuid = crypto.randomUUID();
  const [runIns] = await pool.query(
    "INSERT INTO cia_kpi_sync_runs (run_uuid, status, actor_id) VALUES (?, 'running', ?)",
    [runUuid, actorId]);
  return { runDbId: runIns.insertId, runUuid };
}

const STALE_RUN_MINUTES = 15;

// Tandai run yang MACET (proses mati sebelum UPDATE penutup runSync) sebagai
// 'error' supaya getSyncRun melaporkan status terminal dan run baru tidak
// terhalang selamanya. Ambang jauh di atas durasi sync normal.
export async function reconcileStaleRuns(thresholdMinutes = STALE_RUN_MINUTES) {
  const [res] = await pool.query(
    `UPDATE cia_kpi_sync_runs
        SET status = 'error', finished_at = NOW(), errors_json = ?
      WHERE status = 'running' AND started_at < (NOW() - INTERVAL ? MINUTE)`,
    [JSON.stringify([{ error: { code: "STALE_RUN", message: "Run tidak selesai (proses berhenti)" } }]),
     thresholdMinutes]
  );
  return res.affectedRows || 0;
}

// Ada sync yang benar-benar berjalan? Membersihkan run macet dulu, lalu memblokir
// bila MASIH ada run 'running' — tanpa jendela waktu, sehingga sync yang
// legit-lama pun tetap mencegah run kedua yang concurrent (fix double-run).
export async function hasActiveSyncRun() {
  await reconcileStaleRuns();
  const [rows] = await pool.query(
    "SELECT id FROM cia_kpi_sync_runs WHERE status = 'running' LIMIT 1");
  return rows.length > 0;
}

// Dipakai route sebagai jaring pengaman: bila runSync rejeksi tak terduga,
// tandai run tsb 'error' agar tidak menggantung di 'running'.
export async function markSyncRunError(runUuid) {
  await pool.query(
    `UPDATE cia_kpi_sync_runs SET status = 'error', finished_at = NOW()
      WHERE run_uuid = ? AND status = 'running'`, [runUuid]);
}

// Jalankan reconcile untuk run yang SUDAH dibuat. Dipisah dari createSyncRun
// supaya route bisa membalas 202 { runId } lalu membiarkan pekerjaan berjalan di
// background.
export async function runSync(runDbId, runUuid, { dashboardIds = null, inventory = null } = {}) {
  const inv = inventory || {
    listDashboards: defaultListDashboards,
    listVisualFields: defaultListVisualFields,
    measureIndex: defaultMeasureIndex,
  };

  const result = {
    runId: runUuid, startedAt: new Date(), finishedAt: null, status: "running",
    dashboardsScanned: 0, measuresSeen: 0, visualsSeen: 0,
    bindingsCreated: 0, bindingsRefreshed: 0, bindingsMissing: 0, errors: [],
  };

  try {
    const measureIdx = await inv.measureIndex();
    const resolver = await buildKpiResolver();
    let dashboards = await inv.listDashboards();
    if (Array.isArray(dashboardIds) && dashboardIds.length) {
      const set = new Set(dashboardIds.map(Number));
      dashboards = dashboards.filter((d) => set.has(Number(d.id)));
    }

    const seenKeys = new Set();
    const scannedDashboardIds = [];

    for (const dash of dashboards) {
      try {
        const rows = await inv.listVisualFields(dash.id);
        // Alias manusia hanya aman bila dashboard membawa setidaknya satu
        // nama measure asli yang meng-anchor semantic model-nya. Tanpa anchor,
        // caption umum seperti "Duration (Min)" bisa berasal dari model lain.
        const dashboardModels = new Set(rows.flatMap((r) => {
          const meta = measureIdx.get(String(r.field_name || "").trim().toLowerCase());
          return meta?.modelName ? [meta.modelName] : [];
        }));
        scannedDashboardIds.push(Number(dash.id));
        result.dashboardsScanned += 1;

        // Kelompokkan field per visual.
        const visuals = new Map();
        for (const r of rows) {
          const vk = `${r.report_id}|${r.page_name}|${r.visual_title}`;
          if (!visuals.has(vk)) {
            visuals.set(vk, {
              reportId: r.report_id, pageName: r.page_name,
              visualTitle: r.visual_title, fields: [],
            });
          }
          visuals.get(vk).fields.push(r.field_name);
        }

        for (const v of visuals.values()) {
          result.visualsSeen += 1;
          const measures = [];
          const dims = [];
          for (const f of v.fields) {
            const fieldKey = String(f || "").trim().toLowerCase();
            const resolved = resolver.get(fieldKey) || [];
            const matches = resolved.filter((item) => {
              const meta = measureIdx.get(String(item.measureName || "").trim().toLowerCase());
              return meta && item.semanticModel === meta.modelName
                && dashboardModels.has(item.semanticModel);
            });
            if (matches.length) {
              measures.push(...matches.map((item) => ({ measureName: item.measureName, resolved: item })));
            } else dims.push(f);
          }
          result.measuresSeen += measures.length;

          for (const item of measures) {
            const measure = item.measureName;
            const mkey = String(measure).trim().toLowerCase();
            const resolved = item.resolved || resolver.get(mkey)?.[0];
            if (!resolved) continue; // measure di luar library -> tidak buat binding yatim
            const meta = measureIdx.get(mkey) || {};
            const binding = {
              kpiId: resolved.kpiId,
              dashboardId: Number(dash.id),
              reportId: v.reportId,
              pageName: v.pageName,
              visualTitle: v.visualTitle,
              semanticModel: resolved.semanticModel || meta.modelName || null,
              tableName: meta.tableName || null,
              measureName: measure,
              displayCaption: v.visualTitle || null,
              dimensions: Array.isArray(resolved.dimensions) && resolved.dimensions.length
                ? resolved.dimensions : uniqueStrings(dims),
              dateTable: resolved.dateTable || null,
              dateColumn: resolved.dateColumn || null,
              dateLogic: resolved.dateLogic || null,
              source: "visual_sync",
            };
            const key = computeBindingKey(binding);
            const { created } = await upsertBinding({ ...binding, bindingKey: key });
            seenKeys.add(key);
            if (created) result.bindingsCreated += 1;
            else result.bindingsRefreshed += 1;
          }
        }
      } catch (err) {
        result.errors.push({ dashboardId: dash.id, error: safeError(err) });
      }
    }

    // Format key sebelum 2026-08-28 tidak menyertakan kpiId. Setelah binding
    // replacement dibuat, pensiunkan key lama meski pernah confirmed; kalau
    // dibiarkan aktif ia tetap ikut routing bersama replacement.
    if (scannedDashboardIds.length) {
      const ph = scannedDashboardIds.map(() => "?").join(",");
      const [legacyCandidates] = await pool.query(
        `SELECT id,binding_key,kpi_id,dashboard_id,semantic_model,table_name,
                measure_name,page_name,visual_title
           FROM cia_kpi_bindings
          WHERE source='visual_sync' AND dashboard_id IN (${ph})
            AND verification_status IN ('discovered','confirmed')`,
        scannedDashboardIds
      );
      const legacyIds = legacyCandidates.filter((row) => row.binding_key !== computeBindingKey({
        kpiId: row.kpi_id,
        dashboardId: row.dashboard_id,
        semanticModel: row.semantic_model,
        tableName: row.table_name,
        measureName: row.measure_name,
        pageName: row.page_name,
        visualTitle: row.visual_title,
      })).map((row) => row.id);
      if (legacyIds.length) {
        const [retired] = await pool.query(
          `UPDATE cia_kpi_bindings SET verification_status='missing', missing_since=COALESCE(missing_since,NOW())
            WHERE id IN (${legacyIds.map(() => "?").join(",")})`, legacyIds);
        result.bindingsMissing += retired.affectedRows || 0;
      }
    }

    // Tandai missing: binding visual_sync pada dashboard yang discan tetapi tidak
    // terlihat ronde ini. confirmed/rejected/missing tidak diubah.
    if (scannedDashboardIds.length) {
      const dashPh = scannedDashboardIds.map(() => "?").join(",");
      let sqlText =
        `UPDATE cia_kpi_bindings SET verification_status='missing', missing_since=NOW()
          WHERE source='visual_sync' AND dashboard_id IN (${dashPh})
            AND verification_status NOT IN ('confirmed','rejected','missing')`;
      const params = [...scannedDashboardIds];
      const seenArr = [...seenKeys];
      if (seenArr.length) {
        sqlText += ` AND binding_key NOT IN (${seenArr.map(() => "?").join(",")})`;
        params.push(...seenArr);
      }
      const [upd] = await pool.query(sqlText, params);
      result.bindingsMissing += upd.affectedRows || 0;
    }

    result.status = result.errors.length ? "partial" : "success";
  } catch (err) {
    result.status = "error";
    result.errors.push({ error: safeError(err) });
  }

  result.finishedAt = new Date();
  await pool.query(
    `UPDATE cia_kpi_sync_runs
        SET status=?, dashboards_scanned=?, measures_seen=?, visuals_seen=?,
            bindings_created=?, bindings_refreshed=?, bindings_missing=?,
            errors_json=?, finished_at=NOW()
      WHERE id=?`,
    [result.status, result.dashboardsScanned, result.measuresSeen, result.visualsSeen,
     result.bindingsCreated, result.bindingsRefreshed, result.bindingsMissing,
     result.errors.length ? JSON.stringify(result.errors) : null, runDbId]
  );
  // Binding baru/refresh/missing dari sync bisa mengubah candidate pool router;
  // jangan biarkan pertanyaan berikutnya menunggu sampai TTL 60s kadaluarsa.
  clearKpiLibraryCache();
  return result;
}

// Bungkus lengkap: buat run lalu jalankan. Dipakai uji & pemanggilan sinkron.
export async function syncKpiBindings(opts = {}) {
  const { runDbId, runUuid } = await createSyncRun(opts.actorId ?? null);
  return runSync(runDbId, runUuid, opts);
}

export async function getSyncRun(runUuid) {
  const [rows] = await pool.query(
    "SELECT * FROM cia_kpi_sync_runs WHERE run_uuid = ? LIMIT 1", [runUuid]);
  const r = rows[0];
  if (!r) return null;
  return {
    runId: r.run_uuid,
    status: r.status,
    dashboardsScanned: Number(r.dashboards_scanned) || 0,
    measuresSeen: Number(r.measures_seen) || 0,
    visualsSeen: Number(r.visuals_seen) || 0,
    bindingsCreated: Number(r.bindings_created) || 0,
    bindingsRefreshed: Number(r.bindings_refreshed) || 0,
    bindingsMissing: Number(r.bindings_missing) || 0,
    errors: r.errors_json || [],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}
