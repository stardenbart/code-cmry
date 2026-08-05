// ─────────────────────────────────────────────────────────────────────────────
// Dua job, bukan satu (spec §9, keputusan pemilik 2026-08-04).
//
//   06:15 kumpulkan  tarik data mingguan, simpan, minta analisis AI, validasi
//   08:00 kirim      baca hasil tervalidasi, kirim ke grup, tandai terkirim
//
// Memisahkannya memberi dua jam untuk retry sebelum ada orang yang menunggu
// laporannya. Kalau satu job, kegagalan jam 08:00 berarti tidak ada laporan
// sama sekali pada saat morning meeting.
//
// Digeser ke 06:15 dari 06:00 karena Dashboard Cycle Time dan Repetitive NC
// refresh tepat jam 06:00, dan job yang jalan bersamaan bisa membaca model di
// tengah refresh.
//
// Setiap tahap punya try-catch sendiri (§17). Kegagalan satu domain tidak
// menggagalkan domain lain, dan kegagalan AI tidak menggagalkan pengiriman:
// angka mentah tetap dikirim, karena angka tanpa analisis masih berguna
// sementara analisis tanpa angka tidak.
// ─────────────────────────────────────────────────────────────────────────────

import {
  jendelaLaporan, jendelaMinggu, mingguDalamJangkauan, mingguSudahLewat, tanggalWib,
} from "../utils/dateWindow.util.js";
import { ambilDomain, domainKatalog } from "../services/powerbiSummary.service.js";
import { validasiKatalog } from "../services/kpiCatalog.js";
import {
  simpanSnapshot, simpanSnapshotMingguan, bekukanMingguLewat,
  pembanding, simpanHasil, ambilHasil, tandaiTerkirim, batalkanTerkirim,
} from "../services/historicalStore.service.js";
import { ringkasDenganAI } from "../services/geminiSummary.service.js";
import { pesanCadangan, catatanKaki, validasiKeluaran } from "../services/summaryFormatter.js";
import { sendDailySummary, konfigurasi } from "../services/whatsapp.service.js";
import { kirimAlert, nilaiKegagalan, TINGKAT } from "../services/alerting.service.js";
import { denganKunci } from "./jobLock.js";

export const JOB_KUMPUL = "summary_kumpul";
export const JOB_KIRIM = "summary_kirim";

/** Log bertimestamp dan berdurasi, sesuai §14. */
function pencatat(namaJob) {
  const mulai = Date.now();
  const jejak = [];
  return {
    jejak,
    catat(tahap, ekstra = "") {
      const ms = Date.now() - mulai;
      const baris = `[${new Date().toISOString()}] ${namaJob} ${tahap} +${ms}ms ${ekstra}`.trim();
      jejak.push({ tahap, ms, ekstra });
      console.log(baris);
    },
    totalMs: () => Date.now() - mulai,
  };
}

/**
 * Tahap pengumpulan.
 *
 * Menarik SELURUH minggu yang masih bergerak, bukan hanya hari laporan, karena
 * data 7 hari terakhir masih berubah dan beberapa domain tidak diinput harian.
 * Minggu yang sudah lewat dibekukan sesudahnya.
 */
export async function jalankanPengumpulan({ dryRun = false, tanggal = null } = {}) {
  const log = pencatat("kumpul");
  log.catat("mulai", dryRun ? "DRY RUN" : "");

  // Katalog divalidasi lebih dulu. Entri tanpa flag tanggal terukur akan
  // menghasilkan angka yang salah tanpa error, jadi lebih baik job berhenti di
  // sini dengan pesan jelas.
  const masalahKatalog = validasiKatalog();
  if (masalahKatalog.length) {
    log.catat("katalog tidak sah", masalahKatalog.length + " masalah");
    return { berhasil: false, alasan: `katalog KPI tidak sah: ${masalahKatalog.join("; ")}`, jejak: log.jejak };
  }

  const harian = tanggal ? { tanggal, mulaiUtc: null, selesaiUtc: null } : jendelaLaporan();
  const tanggalLaporan = tanggal || harian.tanggal;
  const mingguBerjalan = jendelaMinggu(tanggalLaporan);
  log.catat("jendela", `harian ${tanggalLaporan}, minggu ${mingguBerjalan.mulaiTanggal}..${mingguBerjalan.selesaiTanggal}`);

  // ── Tarik per minggu yang masih bergerak ──────────────────────────────────
  const mingguDitarik = [];
  for (const minggu of mingguDalamJangkauan(tanggalLaporan, 7)) {
    const domains = [];
    for (const d of domainKatalog()) {
      try {
        domains.push(await ambilDomain(d, minggu));
      } catch (err) {
        // Jaring terakhir; ambilDomain sudah menangkap kegagalan per KPI.
        log.catat("domain gagal", `${d}: ${String(err.message).slice(0, 80)}`);
        domains.push({ domain: d, freshness: "unavailable", cutoffWib: null, kpi: [] });
      }
    }

    let ditolakBeku = 0;
    if (!dryRun) {
      for (const d of domains) {
        const r = await simpanSnapshotMingguan(minggu, d.domain, d.kpi, d.freshness, d.cutoffWib);
        if (!r.disimpan) ditolakBeku += 1;
      }
    }
    mingguDitarik.push({ minggu, domains, ditolakBeku });
    log.catat("minggu ditarik", `${minggu.mulaiTanggal} ${domains.length} domain${ditolakBeku ? `, ${ditolakBeku} ditolak karena beku` : ""}`);
  }

  // Minggu berjalan dipakai untuk analisis: itu yang paling relevan bagi
  // manajemen, dan angkanya paling lengkap dibanding satu hari.
  const utama = mingguDitarik.find((m) => m.minggu.mulaiTanggal === mingguBerjalan.mulaiTanggal)
    || mingguDitarik[mingguDitarik.length - 1];
  const domains = utama?.domains || [];

  // ── Snapshot harian, untuk pembanding vs kemarin ──────────────────────────
  if (!dryRun) {
    const harianDomains = [];
    for (const d of domainKatalog()) {
      try {
        harianDomains.push(await ambilDomain(d, { tanggal: tanggalLaporan }));
      } catch {
        /* domain harian yang gagal tidak menggagalkan snapshot mingguan */
      }
    }
    for (const d of harianDomains) {
      await simpanSnapshot(tanggalLaporan, d.domain, d.kpi, d.freshness, d.cutoffWib);
    }
    log.catat("snapshot harian disimpan", `${harianDomains.length} domain`);
  }

  // ── Bekukan minggu yang sudah lewat ───────────────────────────────────────
  let dibekukan = 0;
  if (!dryRun) {
    const hasil = await bekukanMingguLewat(mingguBerjalan.mulaiTanggal);
    dibekukan = hasil.dibekukan;
    log.catat("pembekuan", `${dibekukan} baris minggu lewat`);
  }

  // ── Pembanding dari store, bukan query ulang ──────────────────────────────
  let banding = new Map();
  try {
    banding = await pembanding(tanggalLaporan);
  } catch (err) {
    log.catat("pembanding gagal", String(err.message).slice(0, 80));
  }

  // ── Analisis AI ───────────────────────────────────────────────────────────
  const ai = await ringkasDenganAI({ jendela: mingguBerjalan, domains, banding });
  log.catat("gemini", ai.berhasil ? `ok ${ai.modelVersion}, ${ai.teks.length} char` : `gagal: ${ai.alasan}`);

  const adaAkumulatif = domains.some((d) => (d.kpi || []).some((k) => k.dateFilterApplied !== true));

  const pesan = ai.berhasil
    ? ai.teks + catatanKaki({ modelVersion: ai.modelVersion, jendela: mingguBerjalan, adaAkumulatif })
    : pesanCadangan({ jendela: mingguBerjalan, domains, alasan: ai.alasan });

  if (!dryRun) {
    await simpanHasil(tanggalLaporan, {
      text: pesan,
      modelVersion: ai.modelVersion || null,
      promptVersion: ai.promptVersion,
      validationPassed: ai.berhasil,
      validationNote: ai.berhasil ? null : ai.alasan,
      isFallback: !ai.berhasil,
    });
    log.catat("hasil disimpan", `fallback=${!ai.berhasil}`);
  }

  // ── Alert bila perlu ──────────────────────────────────────────────────────
  const penilaian = nilaiKegagalan({ jendela: mingguBerjalan, domains, ai, kirim: null });
  if (penilaian.perluAlert && !dryRun) {
    const a = await kirimAlert({
      judul: penilaian.judul,
      isi: penilaian.isi,
      tingkat: penilaian.tingkat,
      konteks: { tanggalLaporan, minggu: mingguBerjalan.mulaiTanggal, dibekukan },
    });
    log.catat("alert", a.terkirim ? `terkirim ke ${a.tujuan.length} tujuan` : `tidak terkirim: ${a.alasan}`);
  }

  log.catat("selesai", `${log.totalMs()}ms`);

  return {
    berhasil: true,
    dryRun,
    tanggalLaporan,
    minggu: { mulai: mingguBerjalan.mulaiTanggal, selesai: mingguBerjalan.selesaiTanggal },
    mingguDitarik: mingguDitarik.map((m) => ({
      mulai: m.minggu.mulaiTanggal, domain: m.domains.length, ditolakBeku: m.ditolakBeku,
    })),
    dibekukan,
    ai: {
      berhasil: ai.berhasil,
      modelVersion: ai.modelVersion || null,
      muatanByte: ai.muatanByte,
      alasan: ai.alasan || null,
    },
    isFallback: !ai.berhasil,
    panjangPesan: pesan.length,
    ...(dryRun ? { pesan } : {}),
    tingkat: penilaian.tingkat,
    totalMs: log.totalMs(),
    jejak: log.jejak,
  };
}

/**
 * Tahap pengiriman.
 *
 * Idempoten lewat database: tandaiTerkirim() memakai klausa whatsapp_sent = 0,
 * jadi ia MENANDAI LEBIH DULU lalu mengirim. Dua proses yang berlomba tidak
 * mungkin keduanya mengirim, dan restart server di antara dua job tidak
 * menyebabkan kirim ganda. Kalau pengirimannya gagal, penandaannya dibatalkan
 * supaya percobaan berikutnya masih bisa jalan.
 */
export async function jalankanPengiriman({ dryRun = false, tanggal = null } = {}) {
  const log = pencatat("kirim");
  log.catat("mulai", dryRun ? "DRY RUN" : "");

  const tanggalLaporan = tanggal || jendelaLaporan().tanggal;
  const hasil = await ambilHasil(tanggalLaporan);

  if (!hasil?.text) {
    log.catat("tidak ada hasil", tanggalLaporan);
    if (!dryRun) {
      await kirimAlert({
        judul: `Executive summary ${tanggalLaporan} tidak terkirim`,
        isi: "Tahap pengumpulan belum menghasilkan apa pun untuk tanggal ini.",
        tingkat: TINGKAT.GAGAL,
        konteks: { tanggalLaporan },
      });
    }
    return { berhasil: false, alasan: "belum ada hasil untuk tanggal ini", tanggalLaporan, jejak: log.jejak };
  }

  if (hasil.whatsappSent) {
    log.catat("sudah terkirim", String(hasil.whatsappSentAt));
    return {
      berhasil: true, sudahTerkirim: true, tanggalLaporan,
      terkirimPada: hasil.whatsappSentAt, jejak: log.jejak,
    };
  }

  const cfg = konfigurasi();
  log.catat("provider", `${cfg.provider} ${cfg.targetMode}${cfg.siap ? "" : " TIDAK SIAP"}`);

  if (dryRun) {
    log.catat("selesai dry run", `${hasil.text.length} char tidak dikirim`);
    return {
      berhasil: true, dryRun: true, tanggalLaporan,
      provider: cfg.provider, tujuanSiap: cfg.siap,
      panjangPesan: hasil.text.length, pesan: hasil.text, jejak: log.jejak,
    };
  }

  // Ditandai LEBIH DULU. Lihat catatan di kepala fungsi.
  const bolehKirim = await tandaiTerkirim(tanggalLaporan);
  if (!bolehKirim) {
    log.catat("ditandai proses lain", "tidak mengirim");
    return { berhasil: true, sudahTerkirim: true, tanggalLaporan, jejak: log.jejak };
  }

  const kirim = await sendDailySummary(hasil.text);
  log.catat("pengiriman", kirim.terkirim ? `ok ${kirim.provider}` : `gagal: ${kirim.alasan}`);

  if (!kirim.terkirim) {
    await batalkanTerkirim(tanggalLaporan);
    await kirimAlert({
      judul: `Executive summary ${tanggalLaporan} gagal dikirim`,
      isi: `Pengiriman WhatsApp gagal. Sebab: ${kirim.alasan}`,
      tingkat: TINGKAT.GAGAL,
      konteks: { tanggalLaporan, provider: kirim.provider },
    });
    log.catat("penandaan dibatalkan", "supaya percobaan berikutnya bisa jalan");
  }

  log.catat("selesai", `${log.totalMs()}ms`);
  return {
    berhasil: kirim.terkirim, tanggalLaporan, provider: kirim.provider,
    alasan: kirim.alasan || null, isFallback: hasil.isFallback,
    totalMs: log.totalMs(), jejak: log.jejak,
  };
}

/** Pengumpulan di bawah kunci. Dipakai cron dan manual trigger. */
export function kumpulkanTerkunci(opsi = {}) {
  return denganKunci(JOB_KUMPUL, () => jalankanPengumpulan(opsi), {
    holder: opsi.holder || `pid-${process.pid}`,
    reportDate: opsi.tanggal || tanggalWib(),
    ttlMs: 45 * 60 * 1000,
  });
}

/** Pengiriman di bawah kunci. */
export function kirimTerkunci(opsi = {}) {
  return denganKunci(JOB_KIRIM, () => jalankanPengiriman(opsi), {
    holder: opsi.holder || `pid-${process.pid}`,
    reportDate: opsi.tanggal || tanggalWib(),
    ttlMs: 10 * 60 * 1000,
  });
}

/** Dipakai config/scheduler.js untuk memutuskan catch-up. */
export function mingguSudahSelesai(tanggal) {
  return mingguSudahLewat(jendelaMinggu(tanggal));
}
