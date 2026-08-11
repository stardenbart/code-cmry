import { ok, section } from "./harness.mjs";
import { aturanGayaSantai, susunBalasanDiLuarKonteks } from "../src/services/gayaBahasa.js";

section("Aturan gaya melarang pola kaku, bukan sekadar minta santai");

const g = aturanGayaSantai();
// Meminta "santai" saja tidak mengubah apa pun. Yang membuat pesan terbaca
// seperti surat dinas adalah pola tertentu, jadi polanya yang dilarang.
for (const pola of ["berdasarkan data", "adapun", "sebagaimana", "dapat disimpulkan"]) {
  ok(`melarang pola "${pola}"`, g.toLowerCase().includes(pola), g);
}
ok("tetap melarang emoji", /emoji/i.test(g), g);
ok("tetap melarang tanda pisah panjang", /tanda pisah panjang/i.test(g), g);
// Pembacanya manajemen di grup kerja, jadi santai bukan berarti slang.
ok("melarang slang", /slang|bahasa gaul/i.test(g), g);

section("Balasan di luar konteks menyebut contoh NYATA");

const balasan = susunBalasanDiLuarKonteks({
  contohMesin: ["Tetra Pak Line 3 250ml", "Hassia S600 Line 2"],
  labelPeriodeLembur: "Juli 2026",
});
ok("menyebut mesin nyata", balasan.includes("Tetra Pak Line 3 250ml"), balasan);
ok("menyebut periode lembur nyata", balasan.includes("Juli 2026"), balasan);
ok("menyebut cara minta ringkasan", /update|rekap/i.test(balasan), balasan);
ok("menyebut CMD", /CMD/.test(balasan), balasan);

section("Balasan tetap berguna walau daftar mesin gagal dibaca");

// Daftar mesin datang dari Power BI dan bisa gagal. Balasan tanpa contoh masih
// lebih berguna daripada error.
const tanpaMesin = susunBalasanDiLuarKonteks({ contohMesin: [], labelPeriodeLembur: null });
ok("tetap menghasilkan teks", tanpaMesin.length > 40, tanpaMesin);
ok("tetap menyebut ringkasan", /update|rekap/i.test(tanpaMesin), tanpaMesin);
ok("tidak memuat placeholder kosong", !/undefined|null/.test(tanpaMesin), tanpaMesin);

section("Tidak ada emoji dan tanda pisah panjang di teks yang dibaca user");

for (const [label, teks] of [["aturan gaya", g], ["balasan", balasan], ["balasan tanpa mesin", tanpaMesin]]) {
  ok(`${label} tanpa emoji`, !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(teks));
  ok(`${label} tanpa tanda pisah panjang`, !teks.includes("—"));
}
