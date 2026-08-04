import { ok, section } from "./harness.mjs";
import { classifyIntent } from "../src/services/aiIntent.js";

// Pertanyaan di bawah ini diambil apa adanya dari ai_chat_logs, termasuk salah
// ketiknya. Pengenal harus bertahan menghadapi tulisan user sebenarnya, bukan
// hanya kalimat rapi.

section("Pertanyaan angka murni dikenali");

const angka = [
  ["Berapa total downtime?", "TOTAL"],
  ["Berapa total downtime-nya?", "TOTAL"],
  ["Berapa total biaya downtime bulan Juli 2026?", "TOTAL"],
  ["Line mana yang downtime-nya paling tinggi?", "MAX"],
  ["Downtime pada mesin mana yang paling tinggi durasinya", "MAX"],
  ["rata-rata OEE berapa?", "AVG"],
  ["ada berapa mesin?", "COUNT"],
  ["filter apa yang aktif sekarang?", "FILTER_STATE"],
];
for (const [q, harap] of angka) {
  const hasil = classifyIntent(q);
  ok(`"${q.slice(0, 44)}" -> ${harap}`, hasil.intent === harap, `dapat ${hasil.intent}`);
}

section("TOP_N membaca jumlah dan arahnya");

const t1 = classifyIntent("top 3 mesin dengan technical downtime tertinggi terjadi pada mesin mana saja?");
ok("top 3 dikenali TOP_N", t1.intent === "TOP_N", `dapat ${t1.intent}`);
ok("n = 3", t1.n === 3, `dapat ${t1.n}`);
ok("arah tertinggi", t1.arah === "tertinggi", `dapat ${t1.arah}`);

const t2 = classifyIntent("Berikan top 3 produk dengan %PO paling rendah pada bulan juli");
ok("paling rendah -> arah terendah", t2.arah === "terendah", `dapat ${t2.arah}`);

section("Kata analitis membatalkan jalur lokal");

// Semua ini MENGANDUNG kata angka, tapi yang diminta bukan angkanya.
const analitis = [
  "Kenapa downtime naik drastis bulan ini?",
  "Kenapa downtime tinggi di beberapa mesin? Beri rekomendasi.",
  "mengapa OEE evergreen sangat rendah, berikan RCA dan rekomendasinya",
  "Coba analisa root cause dari top 3 downtime serac line 2",
  "Berikan top 3 line dengan downtime tertinggi pada Q1 vs Q2",
  "Summary kan informasi terkait dashboard ini",
  "Coba analisa mengapa otir di bulan juli ini terjadi delay ataupun hold",
];
for (const q of analitis) {
  const hasil = classifyIntent(q);
  ok(`analitis: "${q.slice(0, 44)}"`, hasil.intent === "ANALYTICAL", `dapat ${hasil.intent}`);
}

section("Glosarium dikenali");

for (const q of ["Apa itu MTBF?", "MTBF itu artinya apa ya", "Kalo OEE itu apa?", "Apa itu MTBF dan MTTR? Bedanya apa?"]) {
  const hasil = classifyIntent(q);
  ok(`glosarium: "${q}"`, hasil.intent === "GLOSSARY", `dapat ${hasil.intent}`);
}

section("VALUE_OF membawa entitasnya");

const v = classifyIntent("downtime mesin serac 2 bulan juli berapa durasinya ya?");
ok("dikenali VALUE_OF", v.intent === "VALUE_OF", `dapat ${v.intent}`);
ok("entitas terbaca", Boolean(v.entitas) && /serac/i.test(v.entitas), `dapat ${JSON.stringify(v.entitas)}`);

section("Kelalaian yang ditemukan saat mengukur log nyata");

// "top" sendiri sudah berarti tertinggi. Versi pertama menuntut kata arah
// eksplisit, sehingga pertanyaan ini jatuh ke UNKNOWN.
const t3 = classifyIntent("Berikan top 3 downtime pada line dan mesin yang ada");
ok("top tanpa kata arah tetap TOP_N", t3.intent === "TOP_N", `dapat ${t3.intent}`);
ok("arah default tertinggi", t3.arah === "tertinggi", `dapat ${t3.arah}`);

// Koma setelah "mesin" memutus pola entitas di versi pertama.
const v2 = classifyIntent("gua mau liat downtime mesin, serac 2 bulan juli berapa durasinya ya?");
ok("entitas terbaca walau ada koma", v2.intent === "VALUE_OF", `dapat ${v2.intent}`);
ok("entitasnya serac 2", /serac/i.test(String(v2.entitas)), `dapat ${JSON.stringify(v2.entitas)}`);

section("Yang tidak dikenali tetap UNKNOWN, bukan dipaksakan");

for (const q of ["", "asdkjhasd", "Gimana cara export data to excel dari visual dashboard Power BI?"]) {
  const hasil = classifyIntent(q);
  ok(`bukan intent angka: "${q.slice(0, 40)}"`,
    !["TOTAL", "MAX", "MIN", "TOP_N", "AVG", "COUNT", "VALUE_OF", "SHARE"].includes(hasil.intent),
    `dapat ${hasil.intent}`);
}
