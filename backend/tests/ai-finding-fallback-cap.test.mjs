import { ok, section } from "./harness.mjs";

// Perbaikan Minor #6: cabang fallback "satu temuan pun tidak muat" memakai
// Math.max(40, ruang), memaksa panjang minimum 40 karakter walau ruang lebih
// kecil. Kalau AI_FINDING_CONTEXT_CHARS disetel di bawah sekitar 250, hasil
// akhirnya melewati batasnya sendiri.
//
// BATAS_KONTEKS_TEMUAN dibaca dari env SEKALI saat modul dimuat, jadi env
// harus disetel SEBELUM modulnya dimuat. Query string cache-busting memaksa
// Node mengevaluasi modul itu ulang dengan env yang baru, terlepas dari
// modul yang sudah di-cache oleh berkas uji lain yang mengimpornya dengan
// env bawaan.

const asli = process.env.AI_FINDING_CONTEXT_CHARS;

// kepala (118 char) + PENANDA (79 char) = 197. BATAS 207 -> ruang = 10, jauh
// di bawah 40 — persis kondisi yang memicu bug Math.max(40, ruang) lama.
process.env.AI_FINDING_CONTEXT_CHARS = "207";
const { susunKonteksTemuan: susunRuangKecil, BATAS_KONTEKS_TEMUAN: batasKecil } =
  await import(`../src/services/findingContext.js?fallbackcap=${Date.now()}`);
process.env.AI_FINDING_CONTEXT_CHARS = asli;

section("Ruang lebih kecil dari 40 karakter -> keluaran tidak pernah melebihi batas");

const temuanBesar = [{
  dashboardId: 1, dashboardTitle: "Dashboard Panjang", umurJam: 1,
  ringkasan: "x".repeat(500),
  angka: [], belumTerjawab: null,
}];

const hasil = susunRuangKecil(temuanBesar);
ok(`batas efektif ${batasKecil}`, batasKecil === 207, String(batasKecil));
ok(`panjang ${hasil.length} tidak melebihi batas ${batasKecil}`,
  hasil.length <= batasKecil, String(hasil.length));

section("Ruang tidak positif -> tidak ada potongan sama sekali ditambahkan");

// BATAS di bawah ini (150) lebih kecil dari overhead kepala+PENANDA (197),
// jadi ruang-nya negatif. Bagian yang diuji di sini murni cabang fallback:
// tidak ada isi temuan yang ditambahkan sama sekali ketika ruang tidak
// positif — bukan klaim bahwa header tetap ikut memangkas dirinya sendiri,
// itu di luar cakupan perbaikan ini.
process.env.AI_FINDING_CONTEXT_CHARS = "150";
const { susunKonteksTemuan: susunRuangNegatif, BATAS_KONTEKS_TEMUAN: batasNegatif } =
  await import(`../src/services/findingContext.js?fallbackcap=${Date.now()}`);
process.env.AI_FINDING_CONTEXT_CHARS = asli;

const hasilNegatif = susunRuangNegatif(temuanBesar);
ok(`batas efektif ${batasNegatif}`, batasNegatif === 150, String(batasNegatif));
ok("tidak melempar dan tetap mengembalikan string", typeof hasilNegatif === "string");
ok("tidak ada karakter 'x' dari isi temuan yang ikut ditambahkan",
  !hasilNegatif.includes("x"), hasilNegatif);
