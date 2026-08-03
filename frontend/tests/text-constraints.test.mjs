// Menjaga batasan teks yang ditetapkan pemilik sistem: tidak ada emoji sebagai
// ikon, tidak ada em dash di teks yang dibaca user, dan tidak ada dialog
// bawaan browser.
//
// Pola ratchet: SISA_PELANGGARAN berisi yang sudah ada saat batasan ini
// ditetapkan. Angkanya hanya boleh turun. Uji ini gagal bila ada pelanggaran
// BARU, dan juga gagal bila angkanya lebih kecil dari kenyataan (berarti
// daftarnya basi dan harus diturunkan).
import fs from "fs";
import path from "path";

const SRC = "src";

// Diturunkan tiap task. Nol saat Task 10 selesai.
//
// Angka awal ini jauh lebih besar daripada perkiraan di spesifikasi (2 emoji
// dan 6 em dash). Perkiraan itu berasal dari grep yang hanya melihat string
// literal, sementara uji ini juga memeriksa teks JSX, yang justru tempat
// sebagian besar pelanggarannya berada.
const SISA_PELANGGARAN = {
  emojiUi: 8,
  emDashUi: 21,
  alert: 0,
  confirm: 0,
};

// Rentang emoji yang lazim dipakai orang sebagai ikon.
//
// Panah biasa (U+2190 sampai U+21FF) SENGAJA tidak diikutkan: "→" di tengah
// kalimat adalah tipografi, bukan emoji yang menggantikan ikon. Batasannya
// tentang emoji sebagai ikon, dan melebarkannya ke panah berarti menuntut
// lebih dari yang diminta. Panah versi emoji seperti "➡️" tetap tertangkap
// lewat rentang 2600-27BF dan U+FE0F.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function berkasJsx(dir, keluar = []) {
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    if (fs.statSync(p).isDirectory()) berkasJsx(p, keluar);
    else if (/\.(jsx?|mjs)$/.test(nama)) keluar.push(p);
  }
  return keluar;
}

/**
 * Baris yang tampil ke user: string literal dan teks JSX. Komentar dan
 * console.* dikecualikan, keduanya untuk pengembang bukan antarmuka.
 */
function barisAntarmuka(isi) {
  const hasil = [];
  const baris = isi.split(/\r?\n/);
  let dalamBlokKomentar = false;

  for (let i = 0; i < baris.length; i += 1) {
    let b = baris[i];

    if (dalamBlokKomentar) {
      if (b.includes("*/")) { dalamBlokKomentar = false; b = b.slice(b.indexOf("*/") + 2); }
      else continue;
    }
    if (b.includes("/*") && !b.includes("*/")) { dalamBlokKomentar = true; b = b.slice(0, b.indexOf("/*")); }

    b = b.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (/console\.(log|warn|error|info|debug)/.test(b)) continue;
    if (!b.trim()) continue;

    hasil.push({ nomor: i + 1, teks: b });
  }
  return hasil;
}

const temuan = { emojiUi: [], emDashUi: [], alert: [], confirm: [] };

for (const berkas of berkasJsx(SRC)) {
  const isi = fs.readFileSync(berkas, "utf8");

  for (const { nomor, teks } of barisAntarmuka(isi)) {
    if (EMOJI.test(teks)) temuan.emojiUi.push(`${berkas}:${nomor}`);
    if (teks.includes("—")) temuan.emDashUi.push(`${berkas}:${nomor}`);
    if (/\balert\(/.test(teks)) temuan.alert.push(`${berkas}:${nomor}`);
    if (/window\.confirm\(/.test(teks)) temuan.confirm.push(`${berkas}:${nomor}`);
  }
}

let lulus = 0;
let gagal = 0;

function periksa(kunci, judul) {
  const ada = temuan[kunci].length;
  const batas = SISA_PELANGGARAN[kunci];

  if (ada > batas) {
    gagal += 1;
    console.log(`  FAIL  ${judul}: ${ada} ditemukan, batas ${batas}`);
    for (const lokasi of temuan[kunci]) console.log(`          ${lokasi}`);
    return;
  }
  if (ada < batas) {
    gagal += 1;
    console.log(`  FAIL  ${judul}: tinggal ${ada}, tapi batas masih ${batas}. Turunkan SISA_PELANGGARAN.${kunci} menjadi ${ada}.`);
    return;
  }
  lulus += 1;
  console.log(`  PASS  ${judul}: ${ada} (sesuai batas)`);
}

periksa("emojiUi", "emoji di teks antarmuka");
periksa("emDashUi", "em dash di teks antarmuka");
periksa("alert", "pemanggilan alert()");
periksa("confirm", "pemanggilan window.confirm()");

console.log(`\n──────── ${lulus} passed, ${gagal} failed ────────\n`);
process.exit(gagal === 0 ? 0 : 1);
