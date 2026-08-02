// ─────────────────────────────────────────────────────────────────────────────
// Reads the REAL data that is currently rendered inside an embedded Power BI
// report (respecting every active slicer/filter) and packages it for the AI.
//
// Requires the report to be embedded with an embed token and the exportData
// command enabled — i.e. the same "Export Mode" path already used by CODE.
// ─────────────────────────────────────────────────────────────────────────────

import { models } from "powerbi-client";

// Visual types that carry no analytical data
const SKIP_TYPES = new Set([
  "shape",
  "image",
  "textbox",
  "actionButton",
  "basicShape",
  "bookmarkNavigator",
  "pageNavigator",
  "esriMap", // export not supported
]);

const CONCURRENCY = 3;

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the Power BI report GUID from a dashboard's report_id, or null when the
 * value cannot be used for token embedding (e.g. someone pasted a `view?r=...`
 * share link, whose token is a share key rather than the report ID).
 *
 * Must stay in sync with extractReportGuid() in backend/src/config/powerbi.js.
 */
export function extractReportGuid(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (GUID_RE.test(raw)) return raw;

  const match = raw.match(/[?&]reportId=([0-9a-f-]{36})/i);
  return match && GUID_RE.test(match[1]) ? match[1] : null;
}

/** Minimal RFC-4180 CSV parser (handles quotes, escaped quotes, CRLF, BOM). */
export function parseCSV(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty trailing rows
  while (rows.length && rows[rows.length - 1].every((v) => v === "")) rows.pop();

  if (!rows.length) return { columns: [], rows: [] };
  return { columns: rows[0].map((c) => c.trim()), rows: rows.slice(1) };
}

/** Human-readable description of a Power BI filter object. */
export function describeFilter(f) {
  if (!f) return null;

  const target = f.target || {};
  const targetName = Array.isArray(target)
    ? target.map((t) => `${t.table}.${t.column || t.measure || t.hierarchy || ""}`).join(", ")
    : `${target.table || ""}.${target.column || target.measure || target.hierarchy || ""}`.replace(/^\.|\.$/g, "");

  const label = targetName || "(unknown field)";

  // Basic filter
  if (Array.isArray(f.values) && f.values.length) {
    const op = f.operator === "NotIn" ? "bukan" : "=";
    const vals = f.values.slice(0, 25).map(formatFilterValue).join(", ");
    const more = f.values.length > 25 ? ` (+${f.values.length - 25} lainnya)` : "";
    return `${label} ${op} ${vals}${more}`;
  }

  // Advanced filter
  if (Array.isArray(f.conditions) && f.conditions.length) {
    const joiner = f.logicalOperator === "Or" ? " ATAU " : " DAN ";
    const parts = f.conditions.map(
      (c) => `${c.operator} ${formatFilterValue(c.value)}`
    );
    return `${label} ${parts.join(joiner)}`;
  }

  // Relative date / relative time filter
  if (f.operator && (f.timeUnitsCount !== undefined || f.timeUnitType !== undefined)) {
    return `${label} ${f.operator} ${f.timeUnitsCount ?? ""} ${f.timeUnitType ?? ""}`.trim();
  }

  if (f.filterType !== undefined) return `${label} (filter aktif)`;
  return null;
}

function formatFilterValue(v) {
  if (v === null || v === undefined) return "(blank)";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}

async function safe(fn, fallback = null) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Runs async jobs with a small concurrency cap. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

/** Waits for the report's next "rendered" event, or resolves on timeout. */
function waitForRender(report, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { report.off("rendered", finish); } catch { /* ignore */ }
      resolve();
    };
    try {
      report.on("rendered", finish);
    } catch {
      return resolve();
    }
    setTimeout(finish, timeoutMs);
  });
}

/** Exports one visual, normalising both success and failure into a row-set. */
async function exportVisual(visual, pageName, maxRows, tagPage) {
  const base = {
    title: visual.title || visual.name,
    type: visual.type,
    pageName: tagPage ? pageName : undefined,
  };

  try {
    const result = await visual.exportData(models.ExportDataType.Summarized, maxRows);
    const { columns, rows } = parseCSV(result?.data);
    if (!columns.length) return { ...base, columns: [], rows: [], rowCount: 0 };

    return {
      ...base,
      columns,
      rows,
      rowCount: rows.length,
      truncated: rows.length >= maxRows,
    };
  } catch (err) {
    return {
      ...base,
      columns: [],
      rows: [],
      rowCount: 0,
      error: err?.message || err?.detailedMessage || "export tidak didukung",
    };
  }
}

/** Splits a page's visuals into slicer descriptions and exportable visuals. */
async function readPage(page) {
  const pageName = page.displayName || page.name;
  const filters = ((await safe(() => page.getFilters(), [])) || [])
    .map(describeFilter)
    .filter(Boolean);

  const all = (await safe(() => page.getVisuals(), [])) || [];
  const slicers = [];
  const exportable = [];

  for (const visual of all) {
    if (visual.type === "slicer") {
      const state = await safe(() => visual.getSlicerState(), null);
      const described = (state?.filters || []).map(describeFilter).filter(Boolean);
      if (described.length) slicers.push(`${visual.title || "Slicer"} (${pageName}): ${described.join("; ")}`);
      else if (visual.title) slicers.push(`${visual.title} (${pageName}): (semua nilai)`);
      continue;
    }
    if (SKIP_TYPES.has(visual.type)) continue;
    exportable.push(visual);
  }

  return { page, pageName, filters, slicers, exportable };
}

/**
 * Capture the data currently displayed by the embedded report.
 *
 * Pages other than the active one are exported too when requested. Power BI can
 * refuse exportData for a page it has never rendered — when a whole page comes
 * back empty/failed, that page is briefly activated, re-exported, and the user's
 * original page is restored afterwards.
 *
 * @param {object}   report                    powerbi-client Report instance
 * @param {object}   [opts]
 * @param {number}   [opts.maxRowsPerVisual=500]
 * @param {boolean}  [opts.allPages=false]     include every page
 * @param {string[]} [opts.pageNames]          include only these pages (by displayName/name)
 * @param {boolean}  [opts.activateIfNeeded=true] allow the activate-and-restore retry
 * @param {(msg: string) => void} [opts.onProgress]
 * @returns {Promise<object>} snapshot payload consumed by POST /api/ai/ask
 */
export async function captureReportSnapshot(report, opts = {}) {
  const {
    maxRowsPerVisual = 500,
    allPages = false,
    pageNames = null,
    activateIfNeeded = true,
    onProgress,
  } = opts;

  if (!report) throw new Error("Report belum siap.");

  const pages = (await safe(() => report.getPages(), [])) || [];
  if (!pages.length) throw new Error("Tidak bisa membaca halaman report.");

  const activePage = pages.find((p) => p.isActive) || pages[0];
  const nameOf = (p) => p.displayName || p.name;

  let targetPages;
  if (allPages) targetPages = pages;
  else if (pageNames?.length) {
    targetPages = pages.filter((p) => pageNames.includes(nameOf(p)) || pageNames.includes(p.name));
    if (!targetPages.length) targetPages = [activePage];
  } else targetPages = [activePage];

  const tagPage = targetPages.length > 1;
  const filters = ((await safe(() => report.getFilters(), [])) || [])
    .map(describeFilter)
    .filter(Boolean);
  const slicers = [];
  const visuals = [];
  const pageNotes = [];

  let switchedAway = false;

  for (const target of targetPages) {
    const info = await readPage(target);
    info.filters.forEach((f) => filters.push(f));
    info.slicers.forEach((s) => slicers.push(s));

    if (!info.exportable.length) {
      pageNotes.push(`${info.pageName}: tidak ada visual berisi data`);
      continue;
    }

    onProgress?.(`Membaca halaman "${info.pageName}"…`);

    let results = await mapLimit(info.exportable, CONCURRENCY, (v) =>
      exportVisual(v, info.pageName, maxRowsPerVisual, tagPage)
    );

    // Power BI would not export anything for this page — most likely because it
    // has never been rendered. Activate it, let it paint, then try once more.
    const gotNothing = results.every((r) => !r.rows.length);
    const isActive = target === activePage || target.isActive;

    if (gotNothing && activateIfNeeded && !isActive) {
      onProgress?.(`Mengaktifkan halaman "${info.pageName}" untuk membaca datanya…`);
      const activated = await safe(async () => {
        await target.setActive();
        await waitForRender(report);
        return true;
      }, false);

      if (activated) {
        switchedAway = true;
        // Descriptors must be re-fetched after activation
        const refreshed = await readPage(target);
        const retry = await mapLimit(refreshed.exportable, CONCURRENCY, (v) =>
          exportVisual(v, info.pageName, maxRowsPerVisual, tagPage)
        );
        if (retry.some((r) => r.rows.length)) results = retry;
      }
    }

    visuals.push(...results);
  }

  // Put the user back where they were
  if (switchedAway) {
    onProgress?.("Mengembalikan halaman semula…");
    await safe(async () => {
      await activePage.setActive();
      await waitForRender(report, 2500);
    });
  }

  onProgress?.(null);

  return {
    pageName: nameOf(activePage),
    pages: pages.map(nameOf),
    pagesRead: targetPages.map(nameOf),
    capturedAt: new Date().toISOString(),
    filters: [...new Set(filters)],
    slicers: [...new Set(slicers)],
    pageNotes,
    visuals,
  };
}

/** Page list for the UI picker. */
export async function listReportPages(report) {
  const pages = (await safe(() => report?.getPages?.(), [])) || [];
  return pages.map((p) => ({
    name: p.displayName || p.name,
    isActive: Boolean(p.isActive),
  }));
}

/** Quick stats for the UI badge ("12 visual • 430 baris"). */
export function summarizeSnapshot(snapshot) {
  const visuals = snapshot?.visuals || [];
  const withData = visuals.filter((v) => v.rows?.length);
  return {
    visualCount: withData.length,
    visualTotal: visuals.length,
    rowCount: withData.reduce((sum, v) => sum + v.rows.length, 0),
    failed: visuals.filter((v) => v.error).length,
    truncated: visuals.some((v) => v.truncated),
    pageName: snapshot?.pageName || null,
    pagesRead: snapshot?.pagesRead || (snapshot?.pageName ? [snapshot.pageName] : []),
    filters: [...(snapshot?.filters || []), ...(snapshot?.slicers || [])],
  };
}
