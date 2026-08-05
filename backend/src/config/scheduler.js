// ─────────────────────────────────────────────────────────────────────────────
// Pendaftaran cron (spec §9, §16).
//
// Bawaannya MATI. SCHEDULER_ENABLED harus diisi eksplisit.
//
// Alasannya bukan kehati-hatian berlebihan: setiap developer yang menjalankan
// backend di laptopnya akan menjalankan job ini juga, dan dengan provider
// baileys yang sudah dipasangkan, itu berarti pesan sungguhan terkirim ke grup
// manajemen dari mesin siapa pun yang kebetulan menyala jam 08:00.
//
// Kebijakan catch-up ditulis di env, bukan perilaku implisit. Bawaannya `skip`:
// laporan yang datang setelah morning meeting tidak berguna dan justru
// membingungkan, karena pembacanya tidak tahu itu laporan hari ini atau kemarin.
// Manual trigger tetap tersedia untuk menjalankannya kapan saja.
// ─────────────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import { kumpulkanTerkunci, kirimTerkunci } from "../scheduler/dailySummaryJob.js";

/** Zona waktu cron. WIB, sama seperti seluruh perhitungan tanggal di modul ini. */
const ZONA = process.env.SCHEDULER_TIMEZONE || "Asia/Jakarta";

/**
 * 06:15, bukan 06:00. Dashboard Cycle Time dan Repetitive NC refresh tepat jam
 * 06:00, dan job yang jalan bersamaan bisa membaca model di tengah refresh.
 */
const CRON_KUMPUL = process.env.SCHEDULER_CRON_COLLECT || "15 6 * * *";
const CRON_KIRIM = process.env.SCHEDULER_CRON_SEND || "0 8 * * *";

/**
 * Percobaan ulang pengumpulan bila yang jam 06:15 gagal.
 *
 * Dua jam antara pengumpulan dan pengiriman memang untuk ini. Jalur ini tidak
 * mengulang bila hasilnya sudah ada: kumpulkanTerkunci akan menimpa hasil yang
 * sudah tervalidasi, jadi pengulangan hanya dilakukan bila belum ada hasil.
 */
const CRON_ULANG = process.env.SCHEDULER_CRON_RETRY || "45 7 * * *";

function aktif() {
  return /^(1|true|on|yes)$/i.test(String(process.env.SCHEDULER_ENABLED || ""));
}

const tugas = [];

/**
 * Mendaftarkan cron. Aman dipanggil dua kali: pendaftaran kedua diabaikan.
 * @returns {{aktif: boolean, terdaftar: string[], zona: string, alasan?: string}}
 */
export function daftarkanScheduler() {
  if (tugas.length) {
    return { aktif: true, terdaftar: tugas.map((t) => t.nama), zona: ZONA, alasan: "sudah terdaftar" };
  }

  if (!aktif()) {
    return {
      aktif: false, terdaftar: [], zona: ZONA,
      alasan: "SCHEDULER_ENABLED belum diisi, jadi cron tidak didaftarkan",
    };
  }

  for (const [nama, ekspresi, fn] of [
    ["kumpul", CRON_KUMPUL, async () => {
      const r = await kumpulkanTerkunci({ holder: "cron-kumpul" });
      if (!r.dijalankan) console.log(`[cron] kumpul dilewati: ${r.alasan}`);
    }],
    ["ulang", CRON_ULANG, async () => {
      // Hanya jalan bila hasilnya belum ada. Impor di dalam fungsi supaya modul
      // ini tidak menarik lapisan database saat hanya dibaca untuk status.
      const { ambilHasil } = await import("../services/historicalStore.service.js");
      const { jendelaLaporan } = await import("../utils/dateWindow.util.js");
      const tgl = jendelaLaporan().tanggal;
      const ada = await ambilHasil(tgl);
      if (ada?.text) {
        console.log(`[cron] ulang dilewati: hasil ${tgl} sudah ada`);
        return;
      }
      const r = await kumpulkanTerkunci({ holder: "cron-ulang" });
      if (!r.dijalankan) console.log(`[cron] ulang dilewati: ${r.alasan}`);
    }],
    ["kirim", CRON_KIRIM, async () => {
      const r = await kirimTerkunci({ holder: "cron-kirim" });
      if (!r.dijalankan) console.log(`[cron] kirim dilewati: ${r.alasan}`);
    }],
  ]) {
    if (!cron.validate(ekspresi)) {
      console.error(`[cron] ekspresi ${nama} tidak sah: "${ekspresi}", tidak didaftarkan`);
      continue;
    }
    const t = cron.schedule(ekspresi, async () => {
      try {
        await fn();
      } catch (err) {
        // Cron tidak punya pemanggil yang bisa menangkap. Tanpa try-catch di
        // sini, satu kegagalan menjadi unhandled rejection yang bisa
        // menjatuhkan proses, dan itu mematikan seluruh backend, bukan cuma job.
        console.error(`[cron] ${nama} melempar: ${err?.message || err}`);
      }
    }, { timezone: ZONA });
    tugas.push({ nama, ekspresi, tugas: t });
    console.log(`[cron] ${nama} terdaftar: "${ekspresi}" zona ${ZONA}`);
  }

  return { aktif: true, terdaftar: tugas.map((t) => `${t.nama} ${t.ekspresi}`), zona: ZONA };
}

/** Keadaan scheduler, untuk endpoint status. */
export function statusScheduler() {
  return {
    enabled: aktif(),
    zona: ZONA,
    catchupPolicy: process.env.SCHEDULER_CATCHUP_POLICY || "skip",
    jadwal: {
      kumpul: CRON_KUMPUL,
      ulang: CRON_ULANG,
      kirim: CRON_KIRIM,
    },
    terdaftar: tugas.map((t) => ({ nama: t.nama, ekspresi: t.ekspresi })),
  };
}

/** Menghentikan semua cron. Dipakai saat shutdown. */
export function hentikanScheduler() {
  for (const t of tugas) {
    try {
      t.tugas.stop();
    } catch {
      /* menghentikan tugas yang sudah mati bukan kegagalan */
    }
  }
  tugas.length = 0;
}
