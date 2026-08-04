// ─────────────────────────────────────────────────────────────────────────────
// Alerting untuk tim teknis (spec §14).
//
// Terpisah dari penerima laporan, dan itu inti dari bagian ini. Kegagalan job
// yang hanya masuk log adalah kegagalan yang tidak diketahui siapa pun: log
// harian tidak dibaca sampai ada yang mengeluh, dan yang mengeluh justru
// manajemen yang tidak menerima laporannya.
//
// Kanalnya memakai nodemailer yang SUDAH terkonfigurasi di config/email.js, jadi
// nol dependensi baru. Transportnya dibuat di sini dengan kredensial yang sama
// alih-alih mengekspor transporter dari email.js, supaya berkas email.js yang
// menangani alur persetujuan user tidak perlu diubah sama sekali.
// ─────────────────────────────────────────────────────────────────────────────

import nodemailer from "nodemailer";

/** Tingkat keparahan. Hanya `gagal` yang memicu alert; sisanya untuk log. */
export const TINGKAT = { INFO: "info", PERINGATAN: "peringatan", GAGAL: "gagal" };

let transporter = null;

function ambilTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_FROM || !process.env.EMAIL_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_FROM, pass: process.env.EMAIL_PASSWORD },
  });
  return transporter;
}

/**
 * Tujuan alert, dari env, dipisah koma.
 *
 * Sengaja TIDAK jatuh ke daftar penerima laporan bila kosong. Kalau jatuh ke
 * sana, kegagalan teknis akan dikirim ke manajemen dalam bahasa yang tidak
 * mereka butuhkan, dan itu justru mengurangi kepercayaan pada laporannya.
 */
export function tujuanAlert() {
  return String(process.env.ADMIN_ALERT_CHANNEL || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Mengirim alert.
 *
 * TIDAK PERNAH melempar. Alerting yang melempar bisa menggagalkan job yang
 * sebenarnya sudah berhasil, atau menutupi kegagalan aslinya dengan kegagalan
 * pengiriman alert. Hasilnya dikembalikan sebagai objek supaya pemanggil tetap
 * bisa mencatatnya.
 *
 * @returns {Promise<{terkirim: boolean, alasan?: string, tujuan: string[]}>}
 */
export async function kirimAlert({ judul, isi, tingkat = TINGKAT.GAGAL, konteks = {} }) {
  const tujuan = tujuanAlert();

  if (!tujuan.length) {
    return { terkirim: false, alasan: "ADMIN_ALERT_CHANNEL belum diatur", tujuan: [] };
  }

  const t = ambilTransporter();
  if (!t) {
    return { terkirim: false, alasan: "kredensial email belum diatur", tujuan };
  }

  const barisKonteks = Object.entries(konteks)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");

  const teks = [
    isi,
    "",
    barisKonteks,
    "",
    "Pesan ini dikirim ke kanal teknis, bukan ke penerima laporan.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM,
      to: tujuan.join(","),
      subject: `[CODE ${tingkat.toUpperCase()}] ${judul}`,
      text: teks,
    });
    return { terkirim: true, tujuan };
  } catch (err) {
    return { terkirim: false, alasan: String(err.message).slice(0, 160), tujuan };
  }
}

/**
 * Menyusun ringkasan kegagalan job dari hasil tiap tahap.
 *
 * Menentukan APAKAH sesuatu perlu di-alert, bukan cuma menceritakannya. Batasnya
 * mengikuti §14: semua domain gagal, Gemini gagal, validasi gagal, atau WhatsApp
 * gagal. Satu domain gagal TIDAK memicu alert, karena itu keadaan normal yang
 * sudah ditandai di laporan dan alert yang terlalu sering akan diabaikan.
 *
 * @returns {{perluAlert: boolean, judul: string, isi: string, tingkat: string}}
 */
export function nilaiKegagalan({ jendela, domains = [], ai = null, kirim = null }) {
  const alasan = [];
  let tingkat = TINGKAT.INFO;

  const totalKpi = domains.reduce((n, d) => n + (d.kpi?.length || 0), 0);
  const kpiBerisi = domains.reduce(
    (n, d) => n + (d.kpi || []).filter((k) => (k.values || []).some((v) => v.value !== null)).length,
    0
  );

  if (!domains.length || kpiBerisi === 0) {
    alasan.push(`Tidak ada satu pun KPI berisi angka dari ${totalKpi} KPI yang ditarik.`);
    tingkat = TINGKAT.GAGAL;
  } else {
    const domainKosong = domains.filter(
      (d) => !(d.kpi || []).some((k) => (k.values || []).some((v) => v.value !== null))
    );
    if (domainKosong.length) {
      alasan.push(`Domain tanpa angka sama sekali: ${domainKosong.map((d) => d.domain).join(", ")}.`);
      tingkat = TINGKAT.PERINGATAN;
    }
    const takSegar = domains.filter((d) => d.freshness === "unavailable");
    if (takSegar.length) {
      alasan.push(`Domain yang riwayat refreshnya tidak terbaca: ${takSegar.map((d) => d.domain).join(", ")}.`);
      tingkat = tingkat === TINGKAT.GAGAL ? tingkat : TINGKAT.PERINGATAN;
    }
  }

  if (ai && ai.berhasil === false) {
    alasan.push(`Analisis AI tidak terpakai. Sebab: ${ai.alasan}.`);
    tingkat = TINGKAT.GAGAL;
  }

  if (kirim && kirim.terkirim === false) {
    alasan.push(`Pengiriman WhatsApp gagal. Sebab: ${kirim.alasan}.`);
    tingkat = TINGKAT.GAGAL;
  }

  const periode = jendela?.mulaiTanggal
    ? `${jendela.mulaiTanggal} sampai ${jendela.selesaiTanggal}`
    : jendela?.tanggal || "(periode tidak diketahui)";

  return {
    perluAlert: tingkat === TINGKAT.GAGAL,
    tingkat,
    judul: `Executive summary ${periode}`,
    isi: alasan.length ? alasan.join("\n") : "Job selesai tanpa masalah.",
  };
}
