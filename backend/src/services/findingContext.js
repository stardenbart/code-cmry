// ─────────────────────────────────────────────────────────────────────────────
// Menyusun blok TEMUAN DARI DASHBOARD LAIN untuk prompt.
//
// Blok TERPISAH, bukan dicampur ke riwayat percakapan. Riwayat dibaca model
// sebagai percakapan di dashboard yang sedang dibuka, sehingga angka dari
// dashboard lain akan terbaca sebagai angka dashboard ini, dan pembacanya tidak
// punya cara mengetahuinya.
// ─────────────────────────────────────────────────────────────────────────────

import { formatNumber } from "./tabular.js";

/** Batas total blok temuan. Muatan prompt sudah padat oleh snapshot dashboard. */
export const BATAS_KONTEKS_TEMUAN = Number(process.env.AI_FINDING_CONTEXT_CHARS) || 1200;

// Dulu ada fmt lokal dengan aturan pembulatan sendiri, berbeda dari formatter
// kanonik di tabular.js untuk rentang 10 sampai 1000 — angka yang sama bisa
// disebut berbeda antara blok temuan dan dashboard sumbernya, padahal seluruh
// alasan fitur ini ada supaya angka yang sama disebut sama. Dipakai formatter
// kanonik langsung, bukan menduplikasi aturannya.
const fmt = (v) => (typeof v === "number" && Number.isFinite(v) ? formatNumber(v) : String(v));

/** Satu temuan menjadi beberapa baris teks. */
function satuTemuan(t) {
  const angka = (t.angka || [])
    .map((a) => `${a.measure} ${fmt(a.nilai)}`)
    .join(", ");

  const baris = [`- ${t.dashboardTitle} (${t.umurJam} jam lalu): ${t.ringkasan}`];
  if (angka) baris.push(`  Angka: ${angka}`);
  if (t.belumTerjawab) baris.push(`  Belum terjawab: ${t.belumTerjawab}`);
  return baris.join("\n");
}

/**
 * Blok konteks temuan, atau string kosong bila tidak ada.
 *
 * String kosong, BUKAN blok berlabel tanpa isi: blok kosong membuat model
 * menyebut "tidak ada temuan sebelumnya" padahal user tidak menanyakannya.
 */
export function susunKonteksTemuan(temuan) {
  const daftar = Array.isArray(temuan) ? temuan.filter((t) => t && t.ringkasan) : [];
  if (!daftar.length) return "";

  const kepala = [
    "=== TEMUAN DARI DASHBOARD LAIN ===",
    "Ini hasil analisa user di dashboard lain, BUKAN dari dashboard yang sedang dibuka.",
    "",
  ].join("\n");

  const PENANDA = "\n(Sebagian temuan lama dipangkas karena batas ruang, jadi tidak semua terbawa.)";
  const ruang = BATAS_KONTEKS_TEMUAN - kepala.length - PENANDA.length;

  const dipakai = [];
  let panjang = 0;
  let dipangkas = false;

  for (const t of daftar) {
    const teks = satuTemuan(t);
    if (panjang + teks.length + 1 > ruang) {
      dipangkas = true;
      break;
    }
    dipakai.push(teks);
    panjang += teks.length + 1;
  }

  // Bila bahkan satu temuan tidak muat, ringkasan pertama dipotong keras: lebih
  // baik satu temuan terpotong daripada tidak ada konteks sama sekali.
  if (!dipakai.length && daftar.length) {
    dipakai.push(satuTemuan(daftar[0]).slice(0, Math.max(40, ruang)));
    dipangkas = true;
  }

  return kepala + dipakai.join("\n") + (dipangkas ? PENANDA : "");
}

/** Aturan yang ditambahkan ke instruksi sistem ketika ada temuan. */
export function aturanTemuanUntukInstruksi() {
  return [
    "TENTANG TEMUAN DARI DASHBOARD LAIN:",
    "- Setiap angka yang berasal dari blok itu WAJIB disebut dashboard sumbernya.",
    "- Jangan mencampurnya dengan angka dashboard yang sedang dibuka, dan jangan",
    "  menyajikannya seolah berasal dari sini.",
    "- Pakai temuan itu untuk mengorelasikan dan mencari akar masalah, bukan",
    "  sekadar diulang.",
    "- Bila temuan itu bertentangan dengan data dashboard sekarang, sebutkan",
    "  pertentangannya alih-alih memilih salah satu tanpa alasan.",
  ].join("\n");
}
