import { ok, section } from "./harness.mjs";
import { normalizeQuestion } from "../src/services/aiCache.js";

section("Variasi kata yang sama harus menghasilkan bentuk sama");

const kelompok = [
  ["berapa total downtime", [
    "Berapa total downtime?",
    "berapa total downtime nya",
    "Berapa totalnya downtime?",
    "brp total downtime",
    "Berapa total down time?",
  ]],
  ["mesin mana downtime tertinggi", [
    "Mesin mana downtime tertinggi?",
    "mesin mana yg downtime tertinggi",
    "Mesin mana yang downtime nya tertinggi?",
  ]],
];

for (const [nama, varian] of kelompok) {
  const bentuk = varian.map(normalizeQuestion);
  const unik = new Set(bentuk);
  ok(`"${nama}" menyatu jadi satu bentuk`, unik.size === 1,
    `${unik.size} bentuk: ${[...unik].join(" | ")}`);
}

section("Pertanyaan yang berbeda TIDAK boleh menyatu");

// Bagian ini yang menjaga agar normalisasi tidak kebablasan. Cache yang
// menyatukan "tertinggi" dengan "terendah" akan menyajikan jawaban salah, dan
// itu lebih buruk daripada cache yang jarang kena.
const beda = [
  ["Berapa total downtime?", "Berapa total output?"],
  ["Mesin mana downtime tertinggi?", "Mesin mana downtime terendah?"],
  ["top 3 mesin downtime", "top 5 mesin downtime"],
  ["Berapa total downtime bulan Juli?", "Berapa total downtime bulan Juni?"],
];
for (const [a, b] of beda) {
  ok(`"${a.slice(0, 30)}" tidak sama dengan "${b.slice(0, 30)}"`,
    normalizeQuestion(a) !== normalizeQuestion(b),
    `keduanya jadi "${normalizeQuestion(a)}"`);
}

section("Masukan aneh tidak melempar");

for (const x of [null, undefined, "", 123, "   ", "?????"]) {
  let aman = true;
  try { normalizeQuestion(x); } catch { aman = false; }
  ok(`aman untuk ${JSON.stringify(x)}`, aman);
}
