import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { resolvePeriods } from "../src/services/cia/periodResolver.js";

const WIB = "Asia/Jakarta";
const now = new Date("2026-08-27T18:30:00.000Z"); // 28 Agustus 2026 01:30 WIB

function dates(question, instant = now, defaults) {
  return resolvePeriods(question, instant, WIB, defaults)
    .map(({ from, to, comparisonKey }) => ({ from, to, comparisonKey }));
}

section("Periode eksplisit tidak bergantung filter embedded report");
ok("hari ini memakai tanggal WIB, bukan UTC",
  JSON.stringify(dates("lembur hari ini"))
    === JSON.stringify([{ from: "2026-08-28", to: "2026-08-28", comparisonKey: "today" }]),
  JSON.stringify(dates("lembur hari ini")));
ok("minggu lalu adalah Senin-Minggu penuh",
  JSON.stringify(dates("lembur minggu lalu"))
    === JSON.stringify([{ from: "2026-08-17", to: "2026-08-23", comparisonKey: "previous_week" }]),
  JSON.stringify(dates("lembur minggu lalu")));
ok("rentang tanggal Indonesia dibaca inklusif",
  JSON.stringify(dates("lembur 24-30 Agustus 2026"))
    === JSON.stringify([{ from: "2026-08-24", to: "2026-08-30", comparisonKey: "explicit_range" }]),
  JSON.stringify(dates("lembur 24-30 Agustus 2026")));
ok("rentang tanggal tanpa tahun tidak melebar menjadi satu bulan",
  JSON.stringify(dates("downtime 10-16 Agustus kemarin"))
    === JSON.stringify([{ from: "2026-08-10", to: "2026-08-16", comparisonKey: "explicit_range" }]),
  JSON.stringify(dates("downtime 10-16 Agustus kemarin")));
ok("tanggal tunggal tanpa tahun tidak melebar menjadi satu bulan",
  JSON.stringify(dates("output 10 Agustus kemarin"))
    === JSON.stringify([{ from: "2026-08-10", to: "2026-08-10", comparisonKey: "explicit_date" }]),
  JSON.stringify(dates("output 10 Agustus kemarin")));
ok("bulan lalu adalah bulan kalender penuh",
  JSON.stringify(dates("lembur bulan lalu"))
    === JSON.stringify([{ from: "2026-07-01", to: "2026-07-31", comparisonKey: "previous_month" }]),
  JSON.stringify(dates("lembur bulan lalu")));
ok("bulan bernama dengan kata lalu dibaca sebagai bulan kalender, bukan default dashboard",
  JSON.stringify(dates("jelaskan downtime pada bulan Juli lalu"))
    === JSON.stringify([{ from: "2026-07-01", to: "2026-07-31", comparisonKey: "named_month" }]),
  JSON.stringify(dates("jelaskan downtime pada bulan Juli lalu")));
ok("bulan bernama dengan kata kemarin tidak menghasilkan periode hari kemarin tambahan",
  JSON.stringify(dates("top 3 mesin downtime CMD1 bulan Juni kemarin"))
    === JSON.stringify([{ from: "2026-06-01", to: "2026-06-30", comparisonKey: "named_month" }]),
  JSON.stringify(dates("top 3 mesin downtime CMD1 bulan Juni kemarin")));
ok("bulan bernama dengan tahun eksplisit memakai tahun tersebut",
  JSON.stringify(dates("downtime Juli 2025"))
    === JSON.stringify([{ from: "2025-07-01", to: "2025-07-31", comparisonKey: "named_month" }]),
  JSON.stringify(dates("downtime Juli 2025")));
ok("tahun lalu adalah tahun kalender penuh",
  JSON.stringify(dates("deviasi tahun lalu"))
    === JSON.stringify([{ from: "2025-01-01", to: "2025-12-31", comparisonKey: "previous_year" }]),
  JSON.stringify(dates("deviasi tahun lalu")));
ok("aktual berarti bulan berjalan sampai hari ini",
  JSON.stringify(dates("deviasi aktual"))
    === JSON.stringify([{ from: "2026-08-01", to: "2026-08-28", comparisonKey: "current" }]),
  JSON.stringify(dates("deviasi aktual")));

section("Comparison menghasilkan dua periode yang terpisah");
ok("bulan lalu dibanding bulan ini menghasilkan dua periode",
  JSON.stringify(dates("bandingkan lembur bulan lalu dengan bulan ini")) === JSON.stringify([
    { from: "2026-07-01", to: "2026-07-31", comparisonKey: "previous_month" },
    { from: "2026-08-01", to: "2026-08-28", comparisonKey: "current_month" },
  ]), JSON.stringify(dates("bandingkan lembur bulan lalu dengan bulan ini")));
ok("tahun lalu dibanding aktual menghasilkan dua periode",
  JSON.stringify(dates("deviasi tahun lalu dibanding aktual")) === JSON.stringify([
    { from: "2025-01-01", to: "2025-12-31", comparisonKey: "previous_year" },
    { from: "2026-08-01", to: "2026-08-28", comparisonKey: "current" },
  ]), JSON.stringify(dates("deviasi tahun lalu dibanding aktual")));

section("Boundary kalender");
const leapNow = new Date("2024-03-01T03:00:00.000Z");
ok("bulan lalu pada leap year berakhir 29 Februari",
  dates("bulan lalu", leapNow)[0]?.to === "2024-02-29",
  JSON.stringify(dates("bulan lalu", leapNow)));
const januaryNow = new Date("2026-01-01T18:00:00.000Z"); // 2 Jan WIB
ok("bulan lalu melewati pergantian tahun",
  JSON.stringify(dates("bulan lalu", januaryNow))
    === JSON.stringify([{ from: "2025-12-01", to: "2025-12-31", comparisonKey: "previous_month" }]),
  JSON.stringify(dates("bulan lalu", januaryNow)));

section("Default transparan saat pertanyaan tidak menyebut periode");
const configured = resolvePeriods("berapa lembur", now, WIB, {
  currentPeriod: { label: "Periode payroll", from: "2026-08-13", to: "2026-09-12", grain: "day" },
});
ok("periode KPI/dashboard menjadi fallback pertama",
  configured[0]?.from === "2026-08-13" && configured[0]?.to === "2026-09-12",
  JSON.stringify(configured));
ok("fallback ditandai PERIOD_DEFAULTED",
  configured[0]?.warnings?.includes("PERIOD_DEFAULTED"), JSON.stringify(configured));
const lastResort = resolvePeriods("berapa lembur", now, WIB);
ok("tanpa default memakai bulan aktual sampai hari ini",
  lastResort[0]?.from === "2026-08-01" && lastResort[0]?.to === "2026-08-28",
  JSON.stringify(lastResort));
ok("last resort tetap membawa warning",
  lastResort[0]?.warnings?.includes("PERIOD_DEFAULTED"), JSON.stringify(lastResort));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

