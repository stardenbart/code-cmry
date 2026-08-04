import { ok, section } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  KATALOG_KPI, validasiKatalog, kpiDomain, modelDipakai, pasanganMeasure, DOMAIN_SAH,
} from "../src/services/kpiCatalog.js";

const sql = db.promise();

section("Bentuk katalog sah");

const masalah = validasiKatalog();
ok("tidak ada masalah bentuk", masalah.length === 0, masalah.join(" ; "));
ok("katalog tidak kosong", KATALOG_KPI.length > 0);

// Penjaga aturan 2: dateLogic tidak boleh punya nilai bawaan.
const tanpaTanggal = KATALOG_KPI.filter((e) => !e.dateLogic || e.dateLogic.trim().length < 10);
ok("setiap entri menjelaskan dateLogic", tanpaTanggal.length === 0,
  tanpaTanggal.map((e) => e.kpi).join(", "));

// Entri yang menyalin dateLogic dari entri lain masih sah, tapi entri yang
// menyalin catatan kosong tidak.
ok("setiap entri punya unit", KATALOG_KPI.every((e) => Boolean(e.unit)));

section("Perilaku tanggal ditetapkan dengan mengukur, bukan menebak");

// Cacat yang ditemukan 2026-08-04 dan alasan flag ini ada.
//
// Versi pertama menentukan perlu tidaknya filter tanggal dengan mencocokkan kata
// di prosa dateLogic. Prosa itu berasal dari registry, bukan dari pengukuran, dan
// salah untuk OEE serta Downtime kategori: keduanya ditandai "membawa jendela
// waktunya sendiri" padahal terukur MERESPONS filter tanggal. Akibatnya laporan
// menampilkan angka sepanjang masa sebagai angka harian, tanpa satu pun error.
const tanpaFlag = KATALOG_KPI.filter(
  (e) => typeof e.filterTanggal !== "boolean" || typeof e.harian !== "boolean"
);
ok("setiap entri punya flag filterTanggal dan harian", tanpaFlag.length === 0,
  tanpaFlag.map((e) => e.kpi).join(", "));

// Prosa dan flag tidak boleh saling membantah: pembaca kode akan mempercayai
// prosanya, sementara program mempercayai flagnya.
const bentrok = KATALOG_KPI.filter(
  (e) =>
    (e.filterTanggal &&
      /membawa jendela waktunya sendiri|mengabaikan filter|tidak bisa difilter/i.test(e.dateLogic)) ||
    (!e.filterTanggal && /^difilter/i.test(e.dateLogic))
);
ok("prosa dateLogic tidak bertentangan dengan flagnya", bentrok.length === 0,
  bentrok.map((e) => e.kpi).join(", "));

// Angka yang bukan harian WAJIB dijelaskan, karena pembaca laporan harian
// menganggap semua angka di dalamnya harian.
const bukanHarianTanpaCatatan = KATALOG_KPI.filter(
  (e) => e.harian === false && (!e.notes || e.notes.length < 20)
);
ok("KPI bukan harian selalu menjelaskan angkanya mewakili apa",
  bukanHarianTanpaCatatan.length === 0,
  bukanHarianTanpaCatatan.map((e) => e.kpi).join(", "));

// Tidak masuk akal meminta filter tanggal untuk angka yang bukan harian.
const janggal = KATALOG_KPI.filter((e) => e.filterTanggal === true && e.harian === false);
ok("filterTanggal true selalu berpasangan dengan harian true, kecuali disengaja",
  janggal.every((e) => /bulanan|konteks/i.test(e.dateLogic + (e.notes || ""))),
  janggal.map((e) => e.kpi).join(", "));

section("Setiap measure di katalog benar-benar ada di modelnya");

const pasangan = pasanganMeasure();
ok("ada pasangan measure untuk diperiksa", pasangan.length > 0, `dapat ${pasangan.length}`);

const [barisModel] = await sql.query("SELECT model_name, measure_name FROM model_measure");
const adaDiModel = new Set(
  barisModel.map((r) => `${r.model_name.trim().toLowerCase()}|${r.measure_name.trim().toLowerCase()}`)
);

const hilangDiModel = pasangan.filter(
  (p) => !adaDiModel.has(`${p.modelName.trim().toLowerCase()}|${p.measure.trim().toLowerCase()}`)
);
ok(
  `${pasangan.length} measure semuanya ada di model_measure`,
  hilangDiModel.length === 0,
  hilangDiModel.map((p) => `${p.modelName} :: ${p.measure}`).join(" ; ")
);

section("Setiap measure di katalog terbukti dirender di visual");

// Inti aturan 1, dan alasan panen inventaris visual dibangun.
//
// Dari 1666 nama measure di 25 model, hanya 337 yang benar-benar tampil di
// visual. Tanpa penjagaan ini, katalog bisa memuat measure yang tidak pernah
// dirender, termasuk sisa percobaan DAX, dan angkanya keluar tanpa error
// sehingga analisa AI-nya menyesatkan.
const [barisVisual] = await sql.query("SELECT DISTINCT field_name FROM visual_field_usage");
const adaDiVisual = new Set(barisVisual.map((r) => r.field_name.trim().toLowerCase()));

ok("inventaris visual sudah dipanen", adaDiVisual.size > 0,
  "visual_field_usage kosong, jalankan panen dulu lewat Manage Users");

const tidakDirender = pasangan.filter((p) => !adaDiVisual.has(p.measure.trim().toLowerCase()));
ok(
  `${pasangan.length} measure semuanya terbukti dirender di visual`,
  tidakDirender.length === 0,
  tidakDirender.map((p) => `${p.kpi} :: ${p.measure}`).join(" ; ")
);

section("Varian bersaing tidak dipilih diam-diam");

// Entri berstatus blocked HARUS membawa lebih dari satu varian. Kalau hanya
// satu, berarti seseorang sudah memilih tanpa dasar, dan justru itu yang
// dilarang: pemilik dan timnya yang menilai mana yang kanonik.
const blockedSatuVarian = KATALOG_KPI.filter((e) => e.status === "blocked" && e.measures.length < 2);
ok(
  "entri blocked membawa minimal dua varian",
  blockedSatuVarian.length === 0,
  blockedSatuVarian.map((e) => e.kpi).join(", ")
);

// Entri blocked wajib menjelaskan kenapa, kalau tidak pembaca laporan tidak
// tahu apa yang harus dinilai.
const blockedTanpaCatatan = KATALOG_KPI.filter(
  (e) => e.status === "blocked" && (!e.notes || e.notes.length < 20)
);
ok(
  "entri blocked menjelaskan alasannya",
  blockedTanpaCatatan.length === 0,
  blockedTanpaCatatan.map((e) => e.kpi).join(", ")
);

section("Pembungkus per domain menutup seluruh katalog");

let jumlahLewatDomain = 0;
for (const d of DOMAIN_SAH) jumlahLewatDomain += kpiDomain(d).length;
ok(
  "setiap entri terjangkau lewat kpiDomain()",
  jumlahLewatDomain === KATALOG_KPI.length,
  `${jumlahLewatDomain} vs ${KATALOG_KPI.length}`
);

ok("domain tidak dikenal tidak mengembalikan apa pun", kpiDomain("tidak_ada").length === 0);

section("Model yang dipakai katalog sudah terpanen measurenya");

const model = modelDipakai();
const [modelTerpanen] = await sql.query("SELECT DISTINCT model_name FROM model_measure");
const setModel = new Set(modelTerpanen.map((r) => r.model_name.trim().toLowerCase()));
const belumPanen = model.filter((m) => !setModel.has(m.trim().toLowerCase()));
ok(
  `${model.length} model yang dipakai sudah ada di model_measure`,
  belumPanen.length === 0,
  belumPanen.join(", ")
);

section("Sebaran status dilaporkan, bukan disembunyikan");

const hitung = { confirmed: 0, needs_confirmation: 0, blocked: 0 };
for (const e of KATALOG_KPI) hitung[e.status] += 1;
console.log(
  `  INFO  ${KATALOG_KPI.length} KPI: ${hitung.confirmed} confirmed, ` +
  `${hitung.needs_confirmation} needs_confirmation, ${hitung.blocked} blocked ` +
  `(${pasangan.length} measure total)`
);
ok("ada minimal satu KPI confirmed", hitung.confirmed > 0, "tidak ada yang confirmed");
