// ─────────────────────────────────────────────────────────────────────────────
// Dipisahkan dari powerbiData.js dengan sengaja.
//
// powerbiData.js mengimpor `models` dari powerbi-client di level modul. App.jsx
// hanya membutuhkan extractReportGuid, tapi impor itu cukup untuk menyeret SDK
// 355 KB ke dalam chunk utama — termasuk untuk 44 dashboard yang memakai iframe
// dan tidak pernah menyentuhnya.
//
// Berkas ini harus tetap bebas dependensi.
// ─────────────────────────────────────────────────────────────────────────────

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
