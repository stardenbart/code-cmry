// Menjaga pembedaan antara perintah tanpa subjek dan pertanyaan di luar data.
//
// Kejadian nyata yang memicu ini: user menulis "@CIA bandingkan" lalu
// "@CIA detailkan", dua kali dijawab penolakan generik yang sama, lalu user
// menulis "ahelah" dan berhenti. Pertanyaannya bukan di luar data, subjeknya saja
// yang ada di pesan sebelumnya.
//
// Risiko terbesar dari perbaikan ini adalah kebalikannya: pengenal yang terlalu
// lebar akan menyahut pertanyaan sah yang kebetulan singkat, dan pertanyaan yang
// seharusnya menarik angka dijawab dengan "yang mana ya". Karena itu daftar
// kasus negatif di bawah lebih panjang daripada kasus positifnya.
import { ok, section } from "./harness.mjs";
import {
  tanyaTidakLengkap,
  susunBalasanTidakLengkap,
  susunBalasanDiLuarKonteks,
} from "../src/services/gayaBahasa.js";
import {
  catatTopikGrup,
  topikTerakhirGrup,
  lupakanTopikGrup,
} from "../src/services/whatsappListener.service.js";

section("Perintah tanpa subjek dikenali");

const TIDAK_LENGKAP = [
  "@CODE AI bandingkan",
  "@CIA detailkan",
  "bandingkan",
  "detailkan",
  "jelaskan",
  "jelasin dong",
  "rinci",
  "lanjut",
  "lanjutkan",
  "gimana",
  "coba detailkan",
  "tolong jelaskan",
];
for (const t of TIDAK_LENGKAP) {
  ok(`dikenali tidak lengkap: ${t}`, tanyaTidakLengkap(t) === true, "tidak dikenali");
}

section("Pertanyaan sah TIDAK ikut tersahut");

const LENGKAP = [
  "bandingkan downtime tetra pak line 3 minggu ini dengan minggu lalu",
  "detailkan penyebab downtime di CMD 3",
  "jelaskan kendala produksi hari ini",
  "kenapa downtime evergreen esl 950ml tinggi",
  "berapa output uht milk 250 ml kemarin",
  "rekap overtime hari sabtu periode cutoff juli",
  "update informasi terbaru dong",
  "output uht milk 250ml week ini berapa totalnya",
  "deviasi apa yang paling tinggi di cmd 3",
];
for (const t of LENGKAP) {
  ok(`bukan tidak lengkap: ${t.slice(0, 42)}`, tanyaTidakLengkap(t) === false, "ikut tersahut");
}

section("Masukan rusak tidak melempar");

ok("kosong", tanyaTidakLengkap("") === false, "true atau melempar");
ok("null", tanyaTidakLengkap(null) === false, "true atau melempar");
ok("angka", tanyaTidakLengkap(123) === false, "true atau melempar");
ok("hanya mention", tanyaTidakLengkap("@CODE AI") === false, "true atau melempar");

section("Balasan untuk perintah tanpa subjek");

const tanpaTopik = susunBalasanTidakLengkap({
  perintah: "bandingkan",
  topikTerakhir: null,
  contohMesin: ["Tetra Pak Line 3 250ml"],
});
ok("menyebut perintahnya", /bandingkan/.test(tanpaTopik), tanpaTopik.slice(0, 60));
ok("tidak bilang di luar data", !/di luar data/i.test(tanpaTopik), "masih menolak generik");
ok("memberi contoh konkret", /Tetra Pak Line 3 250ml/.test(tanpaTopik), "contoh tidak nyata");
ok("tanpa emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(tanpaTopik), "ada emoji");
ok("tanpa em dash", !tanpaTopik.includes(String.fromCharCode(8212)), "ada em dash");

const denganTopik = susunBalasanTidakLengkap({
  perintah: "detailkan",
  topikTerakhir: "Serac Blow Moulding Line 2_SBL18",
  contohMesin: [],
});
ok(
  "menyebut topik terakhir",
  /Serac Blow Moulding Line 2_SBL18/.test(denganTopik),
  denganTopik.slice(0, 80)
);
ok("tidak menyuruh mengulang dari nol", !/yang mana ya/.test(denganTopik), "masih menyuruh mengulang");

section("Balasan di luar konteks: terima kasih dan janji hanya bila dicatat");

const dicatat = susunBalasanDiLuarKonteks({
  contohMesin: ["Tetra Pak Line 3 250ml"],
  labelPeriodeLembur: "Juli 2026",
  dicatat: true,
});
ok("berterima kasih", /Terima kasih/i.test(dicatat), dicatat.slice(0, 60));
ok("menyebut sudah dicatat", /catat/i.test(dicatat), "janji perbaikan hilang");
ok("tetap memberi rekomendasi", /Ringkasan operasional/.test(dicatat), "rekomendasi hilang");
ok("periode lembur disebut apa adanya", /Juli 2026/.test(dicatat), "periode hilang");

const tanpaCatat = susunBalasanDiLuarKonteks({
  contohMesin: [],
  labelPeriodeLembur: null,
  dicatat: false,
});
ok("tetap berterima kasih", /Terima kasih/i.test(tanpaCatat), "tidak berterima kasih");
ok(
  "TIDAK menjanjikan perbaikan bila gagal dicatat",
  !/catat/i.test(tanpaCatat),
  "menjanjikan sesuatu yang tidak terjadi"
);
ok("rekomendasi tetap ada", /Ringkasan operasional/.test(tanpaCatat), "rekomendasi hilang");

section("Ingatan topik per grup");

const GRUP = "000000000000000000-uji@g.us";
lupakanTopikGrup(GRUP);

ok("awalnya kosong", topikTerakhirGrup(GRUP) === null, "ada isinya");

catatTopikGrup(GRUP, "Tetra Pak Line 6 125ml");
ok("tersimpan", topikTerakhirGrup(GRUP) === "Tetra Pak Line 6 125ml", String(topikTerakhirGrup(GRUP)));

// Masa berlaku diuji dengan menyuntikkan waktu, bukan dengan menunggu.
const jauhKeDepan = Date.now() + 31 * 60 * 1000;
ok("kedaluwarsa sesudah masa berlaku", topikTerakhirGrup(GRUP, jauhKeDepan) === null, "masih hidup");

catatTopikGrup(GRUP, "Evergreen ESL 950ml");
ok("grup lain tidak terpengaruh", topikTerakhirGrup("grup-lain@g.us") === null, "bocor antar grup");

lupakanTopikGrup(GRUP);
ok("dibersihkan", topikTerakhirGrup(GRUP) === null, "masih ada sisa");
