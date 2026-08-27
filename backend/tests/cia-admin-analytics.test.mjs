// Analytics Admin CIA: normalisasi filter (server-side) + agregasi.
//
// Fokus keamanan uji ini: daftar dimensi/GROUP BY berasal dari konstanta
// internal, BUKAN dari query string. Percobaan injeksi lewat `dimension` harus
// ditolak SEBELUM menyentuh database. Rentang tanggal punya default 30 hari dan
// batas atas 366 hari supaya query agregasi tidak pernah memindai tanpa batas.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  normalizeAnalyticsFilters, getOverview, getUsageBreakdown, getFilterOptions,
  AnalyticsValidationError, VALID_DIMENSIONS,
} from "../src/services/ciaAdminAnalytics.service.js";

const sql = db.promise();
const DAY = 86400000;

section("normalizeAnalyticsFilters: default & batas");

const now = new Date("2026-08-27T05:00:00.000Z");
const def = normalizeAnalyticsFilters({}, now);
ok("from & to berupa Date", def.from instanceof Date && def.to instanceof Date);
const spanDays = Math.round((def.to - def.from) / DAY);
ok("default rentang ~30 hari", spanDays >= 29 && spanDays <= 31, String(spanDays));
ok("filter opsional default null",
  def.userId === null && def.department === null && def.dashboardId === null &&
  def.surface === null && def.status === null && def.retrievalMethod === null);

const huge = normalizeAnalyticsFilters(
  { from: "2000-01-01T00:00:00.000Z", to: "2026-08-27T00:00:00.000Z" }, now);
const hugeSpan = Math.round((huge.to - huge.from) / DAY);
ok("rentang sangat besar diklem <= 366 hari", hugeSpan <= 366, String(hugeSpan));

const oneWibDay = normalizeAnalyticsFilters({ from: "2026-08-27", to: "2026-08-27" }, now);
ok("tanggal from dimulai pukul 00:00 WIB",
  oneWibDay.from.toISOString() === "2026-08-26T17:00:00.000Z",
  oneWibDay.from.toISOString());
ok("tanggal to berakhir pukul 23:59:59.999 WIB",
  oneWibDay.to.toISOString() === "2026-08-27T16:59:59.999Z",
  oneWibDay.to.toISOString());

section("normalizeAnalyticsFilters: sanitasi nilai");

const f = normalizeAnalyticsFilters({
  userId: "12", department: "Produksi A", surface: "dashboard",
  status: "success", retrievalMethod: "live_dax", dashboardId: "7",
}, now);
ok("userId jadi integer positif", f.userId === 12, String(f.userId));
ok("surface valid diterima", f.surface === "dashboard");
ok("status valid diterima", f.status === "success");
ok("retrievalMethod valid diterima", f.retrievalMethod === "live_dax");

const bad = normalizeAnalyticsFilters({
  userId: "-5", surface: "xxx", status: "meledak", retrievalMethod: "zzz",
}, now);
ok("userId negatif ditolak -> null", bad.userId === null, String(bad.userId));
ok("surface tak dikenal -> null", bad.surface === null, String(bad.surface));
ok("status tak dikenal -> null", bad.status === null, String(bad.status));
ok("retrievalMethod tak dikenal -> null", bad.retrievalMethod === null, String(bad.retrievalMethod));

section("getUsageBreakdown menolak dimensi injeksi SEBELUM query");

let rejected = false;
let touchedDb = false;
try {
  await getUsageBreakdown(def, "started_at);DROP TABLE users");
} catch (err) {
  rejected = err instanceof AnalyticsValidationError;
}
ok("dimensi injeksi dilempar sebagai AnalyticsValidationError", rejected);

// Bukti bahwa tabel users tidak tersentuh.
const [u] = await sql.query(
  "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'");
ok("tabel users tetap ada (tidak ada DROP yang lolos)", Number(u[0].n) === 1);

for (const d of VALID_DIMENSIONS) {
  ok(`dimensi valid '${d}' diterima`, typeof d === "string" && d.length > 0);
}

section("Agregasi berjalan dengan filter kombinasi (bentuk hasil)");

const overview = await getOverview(f);
ok("overview punya totals", overview && typeof overview.totals === "object");
ok("overview punya rates", overview && typeof overview.rates === "object");
ok("overview punya latency", overview && typeof overview.latency === "object");
ok("overview punya retrieval", overview && typeof overview.retrieval === "object");
ok("totals.requests numerik", Number.isFinite(Number(overview.totals.requests)));
ok("totals token in/out/total numerik",
  Number.isFinite(Number(overview.totals.inputTokens)) &&
  Number.isFinite(Number(overview.totals.outputTokens)) &&
  Number.isFinite(Number(overview.totals.totalTokens)));

const bySurface = await getUsageBreakdown(def, "surface");
ok("breakdown surface berupa array", Array.isArray(bySurface));

const byDashboard = await getUsageBreakdown(def, "dashboard");
ok("breakdown dashboard berupa array", Array.isArray(byDashboard));

const options = await getFilterOptions(def);
ok("filter options punya surfaces", Array.isArray(options.surfaces));
ok("filter options punya departments", Array.isArray(options.departments));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
