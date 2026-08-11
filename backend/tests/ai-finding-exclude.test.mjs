import { ok, section } from "./harness.mjs";
import db from "../src/config/db.js";
import { simpanTemuan, temuanAktif, MAKS_DASHBOARD } from "../src/models/findingModel.js";

// Perbaikan Important #5: pemangkasan senyap. Dashboard yang sedang dibuka
// dikecualikan DI SQL (di WHERE), bukan dibuang sesudahnya di JavaScript
// setelah LIMIT sudah memotong. Dibuang di JavaScript bisa menyisakan LEBIH
// SEDIKIT dari MAKS_DASHBOARD temuan walau masih ada temuan lain yang segar.

const sql = db.promise();
const [[u]] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const USER = u.id;

// Dashboard id besar dan unik supaya tidak beririsan dengan data uji lain.
const DASH_DIBUKA = 900001;
const DASHBOARD_LAIN = [900002, 900003, 900004, 900005]; // 4 dashboard lain, sama dengan MAKS_DASHBOARD

async function bersihkan() {
  await sql.query(
    "DELETE FROM ai_finding WHERE user_id = ? AND dashboard_id IN (?, ?, ?, ?, ?)",
    [USER, DASH_DIBUKA, ...DASHBOARD_LAIN]
  );
}

await bersihkan();

section("Lima temuan segar, satu dashboard dikecualikan -> tetap MAKS_DASHBOARD dari yang lain");

// Simpan berurutan dengan jeda logis lewat turnTerakhir menaik, supaya
// ORDER BY disegarkan_pada DESC + dashboard_id DESC punya urutan yang jelas.
await simpanTemuan({
  userId: USER, dashboardId: DASH_DIBUKA,
  ringkasan: "temuan dashboard yang sedang dibuka", angka: [], belumTerjawab: null, turnTerakhir: 1,
});
for (const [i, dashboardId] of DASHBOARD_LAIN.entries()) {
  await simpanTemuan({
    userId: USER, dashboardId,
    ringkasan: `temuan dashboard lain ${dashboardId}`, angka: [], belumTerjawab: null, turnTerakhir: i + 1,
  });
}

const hasil = await temuanAktif(USER, { kecualikanDashboardId: DASH_DIBUKA });
ok(`mengembalikan ${MAKS_DASHBOARD} temuan (dapat ${hasil.length})`,
  hasil.length === MAKS_DASHBOARD, JSON.stringify(hasil.map((t) => t.dashboardId)));
ok("dashboard yang dibuka tidak ikut",
  !hasil.some((t) => Number(t.dashboardId) === DASH_DIBUKA), JSON.stringify(hasil.map((t) => t.dashboardId)));
ok("semua hasil dari dashboard lain yang terdaftar",
  hasil.every((t) => DASHBOARD_LAIN.includes(Number(t.dashboardId))),
  JSON.stringify(hasil.map((t) => t.dashboardId)));

section("Tanpa pengecualian, GET /api/ai/finding tetap berperilaku seperti sebelumnya");

// Dataset terpisah dan KECIL (di bawah MAKS_DASHBOARD) supaya kelulusan tidak
// tercampur dengan efek LIMIT memangkas berdasar recency — ini murni menguji
// parameter opsionalnya, bukan interaksi dengan pemangkasan.
const DASH_KECIL_A = 900010;
const DASH_KECIL_B = 900011;
await sql.query("DELETE FROM ai_finding WHERE user_id = ? AND dashboard_id IN (?, ?)", [USER, DASH_KECIL_A, DASH_KECIL_B]);
await simpanTemuan({ userId: USER, dashboardId: DASH_KECIL_A, ringkasan: "a", angka: [], belumTerjawab: null, turnTerakhir: 1 });
await simpanTemuan({ userId: USER, dashboardId: DASH_KECIL_B, ringkasan: "b", angka: [], belumTerjawab: null, turnTerakhir: 1 });

// maksDashboard dilonggarkan supaya temuan lain yang mungkin tertinggal dari
// berkas uji lain tidak mendesak dashboard A/B keluar dari LIMIT.
const tanpaKecuali = await temuanAktif(USER, { maksDashboard: 100 });
const idTanpaKecuali = tanpaKecuali.map((t) => Number(t.dashboardId));
ok("dashboard A tetap ikut ketika tidak dikecualikan",
  idTanpaKecuali.includes(DASH_KECIL_A), JSON.stringify(idTanpaKecuali));
ok("dashboard B tetap ikut ketika tidak dikecualikan",
  idTanpaKecuali.includes(DASH_KECIL_B), JSON.stringify(idTanpaKecuali));

await sql.query("DELETE FROM ai_finding WHERE user_id = ? AND dashboard_id IN (?, ?)", [USER, DASH_KECIL_A, DASH_KECIL_B]);

section("Data uji dibersihkan");

await bersihkan();
const [[sisa]] = await sql.query(
  "SELECT COUNT(*) n FROM ai_finding WHERE user_id = ? AND dashboard_id IN (?, ?, ?, ?, ?)",
  [USER, DASH_DIBUKA, ...DASHBOARD_LAIN]
);
ok("tidak ada sisa", Number(sisa.n) === 0, `sisa ${sisa.n}`);
