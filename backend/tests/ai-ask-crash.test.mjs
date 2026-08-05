import { ok, section, req, tokenFor } from "./harness.mjs";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Penjaga untuk satu bug yang menjatuhkan SELURUH backend.
//
// aiController.ask mencatat `intent: lokal?.intent` di blok catch, sementara
// `lokal` dideklarasikan `const` di dalam blok try. Di JavaScript, const di
// dalam try tidak ada di scope catch, jadi setiap error Gemini melempar
// ReferenceError DI DALAM penangan errornya sendiri. Di handler Express async,
// itu menjadi unhandled rejection dan prosesnya mati.
//
// Terjadi sungguhan 2026-08-05: kuota kunci universal habis, jalur error jalan,
// dan backend berhenti. Bukan skenario teoretis.
//
// `lokal?.intent` terlihat aman padahal optional chaining tidak menolong ketika
// identifiernya sendiri yang tidak terdeklarasi, jadi pembacaan kode saja tidak
// menangkapnya.
// ─────────────────────────────────────────────────────────────────────────────

section("Variabel yang dibaca di catch dideklarasikan di luar try");

const berkas = path.resolve("src/controllers/aiController.js");
const kode = fs.readFileSync(berkas, "utf8");

ok("lokal dideklarasikan dengan let di luar try", /\n\s*let lokal = null;/.test(kode),
  "deklarasi `let lokal = null;` tidak ditemukan");
ok("tidak ada lagi const lokal di dalam try", !/const lokal = paksaAI/.test(kode),
  "`const lokal = paksaAI` masih ada, scope catch akan melempar ReferenceError");
ok("catch tetap mencatat intentnya", /intent: lokal\?\.intent \?\? null,/.test(kode),
  "pencatatan intent di jalur error hilang");

// Deklarasinya harus berada SEBELUM try, bukan di fungsi lain. Versi pertama
// perbaikan ini menyisipkannya ke fungsi yang salah karena ada beberapa
// `let resolved = null;` di berkas ini, dan penugasannya justru jadi
// ReferenceError di scope lain.
const posDeklarasi = kode.indexOf("let lokal = null;");
const posPenugasan = kode.indexOf("lokal = paksaAI");
ok("deklarasi mendahului penugasan", posDeklarasi > 0 && posDeklarasi < posPenugasan,
  `deklarasi di ${posDeklarasi}, penugasan di ${posPenugasan}`);
ok("keduanya berdekatan, jadi di fungsi yang sama",
  posPenugasan - posDeklarasi < 2500, `jarak ${posPenugasan - posDeklarasi} karakter`);

section("Backend tetap hidup sesudah jalur error AI dijalankan");

// Pertanyaan dikirim dengan snapshot kosong dan paksaAI, supaya penjawab lokal
// menyerah dan permintaannya benar-benar sampai ke Gemini. Apa pun hasilnya,
// termasuk 429 kuota habis, prosesnya TIDAK BOLEH mati.
const USER = tokenFor(36, "rasimin");
const r = await req("POST", "/api/ai/ask", {
  token: USER,
  body: {
    question: "__uji_jalur_error__ jelaskan tren OEE bulan ini",
    dashboardId: null,
    snapshot: { visuals: [] },
    forceAI: true,
  },
});

ok("ada respons, bukan koneksi terputus", typeof r.status === "number", `dapat ${r.status}`);
ok("bukan 500 akibat ReferenceError",
  r.status !== 500 || !/lokal is not defined/i.test(JSON.stringify(r.body || {})),
  JSON.stringify(r.body || {}).slice(0, 200));

// Inti ujinya: permintaan SETELAHNYA masih dijawab. Kalau prosesnya mati karena
// permintaan sebelumnya, panggilan ini gagal di level koneksi.
const sesudah = await req("GET", "/api/ai/status", { token: USER });
ok("backend masih menjawab sesudah jalur error", sesudah.status === 200,
  `dapat ${sesudah.status}, kemungkinan proses mati`);
