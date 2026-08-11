// Menguji lapisan sanitasi di sekitar penyaringan temuan (distillFindings),
// TANPA memanggil Gemini sungguhan. askGemini sendiri dibungkus di
// aiController.js dan bukan fungsi murni, jadi bagian yang bisa diuji di sini
// adalah persis apa yang controller lakukan SEBELUM dan SESUDAH panggilan itu:
// menyanitasi question/answer sebelum dirangkai jadi permintaan penyaring, dan
// memulihkan teksnya sesudah hasil penyaringan dibaca. Bagian di antaranya
// (panggilan Gemini yang sungguhan) tidak bisa diuji tanpa kuota nyata.
import { ok, section } from "./harness.mjs";
import { createSanitizer } from "../src/services/aiSanitizer.js";
import { susunPermintaanPenyaring, bacaHasilPenyaring } from "../src/services/findingDistiller.js";

section("Question/answer disanitasi sebelum masuk permintaan penyaring");

const sanitizer = createSanitizer({ secret: "test-secret" });

// Mendaftarkan identitas dulu, seperti sanitizeSnapshot melakukannya di jalur
// menjawab: nama operator sudah dikenal sebelum teks bebas diproses.
sanitizer.sanitizeSnapshot({
  visuals: [{ columns: ["Nama Operator", "Downtime"], rows: [["Budi Santoso", 12]]}],
});

const putaranAsli = [
  { question: "kenapa downtime tinggi?", answer: "Budi Santoso lupa reset mesin serac 2" },
];
const putaranAman = putaranAsli.map((p) => ({
  ...p,
  question: sanitizer.sanitizeText(p.question),
  answer: sanitizer.sanitizeText(p.answer),
}));

const permintaan = susunPermintaanPenyaring({ dashboardTitle: "Losses Report", putaran: putaranAman });
ok("nama tidak lolos apa adanya ke permintaan penyaring", !permintaan.includes("Budi Santoso"), permintaan);
ok("token pengganti muncul di permintaan", /ORANG_[0-9a-f]+/.test(permintaan), permintaan);

section("Hasil penyaringan yang masih bertoken dipulihkan sebelum disimpan");

// Simulasi jawaban model penyaring: field ringkasan/belumTerjawab masih
// memuat token karena disusun dari permintaan yang sudah disanitasi.
const tokenOrang = permintaan.match(/ORANG_[0-9a-f]+/)[0];
const balasanModel = JSON.stringify({
  ringkasan: `Downtime naik karena ${tokenOrang} lupa reset mesin`,
  angka: [{ measure: "Downtime (menit)", nilai: 12 }],
  belumTerjawab: `Apakah ${tokenOrang} sudah ditegur?`,
});

const temuan = bacaHasilPenyaring(balasanModel);
ok("bacaHasilPenyaring berhasil mem-parse", !!temuan, JSON.stringify(temuan));
ok("ringkasan masih bertoken sebelum dipulihkan", temuan.ringkasan.includes(tokenOrang), temuan.ringkasan);

// Ini yang dilakukan controller sesudah bacaHasilPenyaring, dengan INSTANCE
// sanitizer yang SAMA (yang tadi mendaftarkan Budi Santoso).
const ringkasanAsli = sanitizer.restore(temuan.ringkasan);
const angkaAsli = temuan.angka.map((a) => ({ ...a, measure: sanitizer.restore(a.measure) }));
const belumTerjawabAsli = sanitizer.restore(temuan.belumTerjawab);

ok("ringkasan yang disimpan berisi nama asli", ringkasanAsli.includes("Budi Santoso"), ringkasanAsli);
ok("belum terjawab yang disimpan berisi nama asli", belumTerjawabAsli.includes("Budi Santoso"), belumTerjawabAsli);
ok("nama measure tidak berubah (tidak ada token di dalamnya)",
  angkaAsli[0].measure === "Downtime (menit)", angkaAsli[0].measure);
ok("nilai angka tidak disentuh sanitasi", angkaAsli[0].nilai === 12, angkaAsli[0].nilai);
ok("token tidak lagi tersisa di ringkasan yang disimpan", !ringkasanAsli.includes(tokenOrang), ringkasanAsli);

section("Instance sanitizer yang berbeda TIDAK bisa memulihkan token orang lain");

// Ini alasan kenapa satu instance harus dipakai konsisten untuk satu putaran
// penyaringan: instance baru tidak punya peta token->asli punya instance lama.
const sanitizerLain = createSanitizer({ secret: "test-secret" });
const gagalPulih = sanitizerLain.restore(temuan.ringkasan);
ok("instance lain gagal memulihkan, token tetap ada", gagalPulih.includes(tokenOrang), gagalPulih);
