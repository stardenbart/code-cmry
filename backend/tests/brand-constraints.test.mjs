// Menjaga supaya merek lama "CODE AI" tidak merangkak balik sesudah rebrand
// ke CIA (Cimory Intelligence Assistant). Rebrand-nya sudah selesai; berkas
// ini menjaga supaya tetap begitu.
//
// Merek lama paling sering kembali lewat KOMENTAR yang tersalin dari kode
// lama, bukan lewat string yang tampil ke user, dan komentar itu yang lalu
// dibaca pengembang berikutnya sebagai nama yang benar. Karena itu pemindai
// ini memeriksa SELURUH baris, termasuk komentar, tidak hanya string literal.
//
// Pola ratchet, sama seperti frontend/tests/text-constraints.test.mjs:
// SISA_PELANGGARAN berisi jumlah yang tersisa saat batasan ini ditetapkan
// (sekarang nol karena rebrand sudah tuntas). Uji gagal bila angkanya NAIK
// (merek lama kembali) maupun bila lebih KECIL dari kenyataan (daftar basi,
// dan itu juga kegagalan diam yang harus ketahuan).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ok, section } from "./harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/ ada di backend/tests, jadi akar repo dua tingkat di atasnya.
const ROOT = path.resolve(__dirname, "..", "..");

// Pola merek lama: longgar terhadap huruf besar/kecil dan jumlah spasi, jadi
// "CODE AI", "Code AI", "code ai", "CODE  AI" semua tertangkap. \b di kedua
// ujung mencegah tertangkapnya kata yang cuma mengandung substring, misalnya
// "encode ai-generated".
const POLA_MEREK_LAMA = /\bcode\s+ai\b/i;

// CODE_AI_UNIVERSAL_KEY dan variabel env sejenis SENGAJA TIDAK diganti nama.
// Mengubahnya bisa mematikan akses AI di server mana pun yang berkas .env-nya
// belum ikut diubah. Ini bukan sisa rebrand yang terlewat, jadi setiap
// kemunculan pola ini dibuang dari baris SEBELUM dicocokkan ke pola merek
// lama, supaya "CODE_AI_UNIVERSAL_KEY" (dipisah underscore, bukan spasi)
// tidak pernah dihitung sebagai pelanggaran meskipun pola di atas berubah.
const POLA_ENV_DIKECUALIKAN = /CODE_AI_[A-Z_]+/g;

// Direktori yang sengaja tidak disentuh: catatan pekerjaan lama yang memang
// tidak diganti namanya.
const DIKECUALIKAN = [path.join(ROOT, "docs", "superpowers")];

// Ekstensi berkas teks yang relevan diperiksa. Berkas biner (gambar, font,
// dll) tidak mungkin memuat teks merek dan hanya akan memperlambat pemindaian.
const EKSTENSI_DIPINDAI = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".css", ".md", ".json", ".html", ".sql",
]);

function terkecualikan(p) {
  return DIKECUALIKAN.some((dir) => p === dir || p.startsWith(dir + path.sep));
}

function kumpulkanBerkas(target, keluar = []) {
  if (!fs.existsSync(target)) return keluar;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    if (terkecualikan(target)) return keluar;
    for (const nama of fs.readdirSync(target)) {
      kumpulkanBerkas(path.join(target, nama), keluar);
    }
    return keluar;
  }
  if (terkecualikan(target)) return keluar;
  if (EKSTENSI_DIPINDAI.has(path.extname(target))) keluar.push(target);
  return keluar;
}

const TARGET = [
  path.join(ROOT, "backend", "src"),
  path.join(ROOT, "frontend", "src"),
  path.join(ROOT, "README.md"),
];

const berkas = [];
for (const t of TARGET) kumpulkanBerkas(t, berkas);

section("Pemindai benar-benar menemukan berkas untuk diperiksa");

// Kegagalan diam yang paling berbahaya di uji semacam ini: path salah, tidak
// ada berkas yang cocok, dan uji "lulus" tanpa memeriksa apa pun. Batas 50
// jauh di bawah jumlah nyata (lebih dari 90 pada saat berkas ini ditulis),
// jadi ambang ini hanya menangkap kasus pemindai benar-benar tidak jalan.
ok(`menemukan lebih dari 50 berkas (dapat ${berkas.length})`, berkas.length > 50, `dapat ${berkas.length}`);

section("Tidak ada kemunculan merek lama \"CODE AI\" di baris manapun");

const temuan = [];
for (const p of berkas) {
  const isi = fs.readFileSync(p, "utf8");
  const baris = isi.split(/\r?\n/);
  for (let i = 0; i < baris.length; i += 1) {
    const bersih = baris[i].replace(POLA_ENV_DIKECUALIKAN, "");
    if (POLA_MEREK_LAMA.test(bersih)) {
      temuan.push({ file: path.relative(ROOT, p), line: i + 1, teks: baris[i].trim() });
    }
  }
}

for (const t of temuan) {
  console.log(`          ${t.file}:${t.line}  ${t.teks}`);
}

// Sekarang nol. Naik berarti merek lama kembali; lebih kecil dari kenyataan
// berarti daftar ini basi dan harus diturunkan ke jumlah sebenarnya.
const SISA_PELANGGARAN = 0;
ok(`jumlah pelanggaran sesuai batas ratchet (batas ${SISA_PELANGGARAN}, dapat ${temuan.length})`,
  temuan.length === SISA_PELANGGARAN,
  temuan.length > SISA_PELANGGARAN
    ? "merek lama ditemukan, lihat lokasi di atas"
    : `dapat ${temuan.length}, turunkan SISA_PELANGGARAN menjadi ${temuan.length}`);
