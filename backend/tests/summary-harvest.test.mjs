import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const ADMIN = tokenFor(4, "digital.transformation");
const USER = tokenFor(36, "rasimin");

section("Endpoint panen hanya untuk admin");

const ADMIN_SAJA = [
  ["GET", "/api/summary/harvest-plan", null],
  ["GET", "/api/summary/harvest-status", null],
  ["POST", "/api/summary/visual-usage", { dashboardId: 1, reportId: "x", visuals: [] }],
];
for (const [method, path, body] of ADMIN_SAJA) {
  const r = await req(method, path, { token: USER, body: body || {} });
  ok(`${method} ${path} sebagai user biasa -> 403`, r.status === 403, `dapat ${r.status}`);
}

section("Rencana panen hanya memuat dashboard yang punya report ID");

const rencana = await req("GET", "/api/summary/harvest-plan", { token: ADMIN });
ok("status 200", rencana.status === 200, `dapat ${rencana.status}`);
ok("membawa array dashboards", Array.isArray(rencana.body?.dashboards), "bukan array");
ok(
  "setiap baris punya reportId tidak kosong",
  (rencana.body?.dashboards || []).every((d) => typeof d.reportId === "string" && d.reportId.length > 0),
  "ada baris tanpa reportId"
);
ok(
  "total cocok dengan panjang array",
  rencana.body?.total === (rencana.body?.dashboards || []).length,
  `total ${rencana.body?.total} vs ${(rencana.body?.dashboards || []).length}`
);

section("Status panen melaporkan perpotongan, bukan cuma jumlah");

const status = await req("GET", "/api/summary/harvest-status", { token: ADMIN });
ok("status 200", status.status === 200, `dapat ${status.status}`);
for (const jalur of [
  ["dashboard.bisaDipanen", status.body?.dashboard?.bisaDipanen],
  ["measure.baris", status.body?.measure?.baris],
  ["measure.namaUnik", status.body?.measure?.namaUnik],
  ["measure.terlihatDiVisual", status.body?.measure?.terlihatDiVisual],
  ["measure.tidakTerlihatDiVisual", status.body?.measure?.tidakTerlihatDiVisual],
  ["field.bukanMeasure", status.body?.field?.bukanMeasure],
]) {
  ok(`${jalur[0]} berupa angka`, typeof jalur[1] === "number", `dapat ${typeof jalur[1]}`);
}

const m = status.body?.measure || {};

// Assertion inti, dan sebelumnya terlalu longgar.
//
// Versi pertama hanya menuntut "terlihat + tidak terlihat <= baris". Karena
// baris (2289) menghitung baris sedangkan kedua angka lain menghitung nama unik
// (1666), assertion itu lolos walau satuannya berbeda, dan panel menampilkan
// dua angka yang tidak sebanding. Pembacanya akan menyimpulkan 2289 dikurangi
// 1666 sama dengan 623 measure sudah terlihat, padahal jawabannya nol.
//
// Kesamaan persis di bawah ini tidak bisa lolos kalau satuannya tercampur lagi.
ok(
  "terlihat + tidak terlihat = namaUnik, persis",
  m.terlihatDiVisual + m.tidakTerlihatDiVisual === m.namaUnik,
  `${m.terlihatDiVisual} + ${m.tidakTerlihatDiVisual} != ${m.namaUnik}`
);
ok(
  "baris tidak kurang dari namaUnik",
  m.baris >= m.namaUnik,
  `baris ${m.baris} < namaUnik ${m.namaUnik}`
);

section("Masukan rusak ditolak sebelum menyentuh database");

const RUSAK = [
  ["tanpa dashboardId", { reportId: "x", visuals: [] }],
  ["dashboardId bukan angka", { dashboardId: "abc", reportId: "x", visuals: [] }],
  ["dashboardId negatif", { dashboardId: -3, reportId: "x", visuals: [] }],
  ["tanpa reportId", { dashboardId: 1, visuals: [] }],
  ["visuals bukan array", { dashboardId: 1, reportId: "x", visuals: "bukan array" }],
];
for (const [label, body] of RUSAK) {
  const r = await req("POST", "/api/summary/visual-usage", { token: ADMIN, body });
  ok(`${label} -> 400`, r.status === 400, `dapat ${r.status}`);
}

section("Siklus simpan inventaris pada dashboard nyata");

const target = (rencana.body?.dashboards || [])[0];
if (!target) {
  ok("tidak ada dashboard ber-reportId, siklus dilewati", true);
} else {
  const sebelum = target.fieldTerpanen;

  // Nama field sengaja diberi awalan agar tidak bertabrakan dengan hasil panen
  // sungguhan, dan mudah dikenali kalau tertinggal.
  const kirim = {
    dashboardId: target.id,
    reportId: target.reportId,
    visuals: [
      {
        pageName: "__uji_halaman__",
        visualTitle: "__uji_visual__",
        visualType: "card",
        fields: ["__uji_field_a__", "__uji_field_b__"],
      },
    ],
  };

  const r1 = await req("POST", "/api/summary/visual-usage", { token: ADMIN, body: kirim });
  ok("simpan pertama -> 200", r1.status === 200, `dapat ${r1.status}`);
  ok("dua field diterima", r1.body?.diterima === 2, `dapat ${r1.body?.diterima}`);

  // Kirim ulang identik: upsert, bukan duplikasi.
  const r2 = await req("POST", "/api/summary/visual-usage", { token: ADMIN, body: kirim });
  ok("simpan ulang -> 200", r2.status === 200, `dapat ${r2.status}`);
  ok(
    "field unik tidak berlipat setelah kirim ulang",
    r2.body?.fieldUnik === r1.body?.fieldUnik,
    `${r1.body?.fieldUnik} lalu ${r2.body?.fieldUnik}`
  );

  // Field kosong dan spasi tidak boleh jadi baris.
  const r3 = await req("POST", "/api/summary/visual-usage", {
    token: ADMIN,
    body: {
      dashboardId: target.id,
      reportId: target.reportId,
      visuals: [{ pageName: "__uji_halaman__", visualTitle: "__uji_visual__", fields: ["", "   ", null] }],
    },
  });
  ok("field kosong diabaikan", r3.body?.diterima === 0, `dapat ${r3.body?.diterima}`);

  ok(
    "inventaris bertambah dari keadaan awal",
    r1.body?.fieldUnik >= sebelum + 2,
    `sebelum ${sebelum}, sesudah ${r1.body?.fieldUnik}`
  );
}

section("Baris uji dibersihkan dari inventaris");

// WAJIB. Inventaris visual adalah dasar perhitungan katalog KPI, dan baris uji
// yang tertinggal akan terhitung sebagai field yang benar-benar dipakai di
// dashboard. Tidak ada endpoint hapus, jadi dibersihkan langsung ke database.
try {
  const sql = db.promise();
  const [hasil] = await sql.query(
    `DELETE FROM visual_field_usage
      WHERE field_name LIKE '\\_\\_uji\\_%'
         OR page_name = '__uji_halaman__'`
  );
  ok("baris uji terhapus", hasil.affectedRows >= 0, `terhapus ${hasil.affectedRows}`);

  const [[sisa]] = await sql.query(
    `SELECT COUNT(*) n FROM visual_field_usage
      WHERE field_name LIKE '\\_\\_uji\\_%' OR page_name = '__uji_halaman__'`
  );
  ok("tidak ada sisa baris uji", Number(sisa.n) === 0, `sisa ${sisa.n}`);
} catch (err) {
  ok("pembersihan baris uji", false, err.message);
}
