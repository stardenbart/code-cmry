// Detak jantung kunci job.
//
// Masalah nyata yang memicunya: permintaan ringkasan lewat WhatsApp dijawab
// "belum bisa dijalankan" padahal tidak ada yang sedang berjalan, karena sebuah
// proses pernah mati sambil memegang kunci dan kuncinya baru kedaluwarsa 45
// menit kemudian.
//
// Menurunkan TTL memperbaiki kasus itu tapi merusak kasus sebaliknya: job yang
// memang masih berjalan kehilangan kuncinya di tengah jalan, dan proses lain
// boleh merebutnya sehingga ada dua pengumpulan berjalan bersamaan.
//
// Detak jantung menghapus pertukaran itu. Yang diuji di sini persis dua sisinya.
import { ok, section } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  denganKunci,
  ambilKunci,
  lepasKunci,
  perpanjangKunci,
  statusKunci,
} from "../src/scheduler/jobLock.js";

const sql = db.promise();

const JOB = "__uji_detak__";

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

// Sisa run sebelumnya dibersihkan supaya uji tidak bergantung urutan.
await lepasKunci(JOB);

try {
  section("Perpanjangan hanya untuk pemilik kuncinya");

  await ambilKunci(JOB, { holder: "pemilik", ttlMs: 60_000 });

  ok(
    "pemilik bisa memperpanjang",
    (await perpanjangKunci(JOB, "pemilik", 60_000)) === true,
    "gagal"
  );
  ok(
    "holder lain TIDAK bisa memperpanjang",
    (await perpanjangKunci(JOB, "penyusup", 60_000)) === false,
    "penyusup berhasil memperpanjang kunci milik orang lain"
  );

  await lepasKunci(JOB);

  section("Job yang MASIH jalan tidak kehilangan kuncinya");

  // TTL sengaja sangat pendek dan pekerjaannya sengaja lebih lama dari TTL itu.
  // Tanpa detak jantung, kuncinya kedaluwarsa di tengah pekerjaan dan langkah
  // berikutnya akan berhasil merebutnya.
  const TTL = 6_000;
  let statusSaatJalan = null;

  const hasil = await denganKunci(
    JOB,
    async () => {
      // Lebih lama dari TTL, jadi kuncinya HARUS sudah diperpanjang minimal
      // sekali sebelum baris di bawah dijalankan.
      await tidur(TTL + 2_000);
      statusSaatJalan = await statusKunci(JOB);
      return "selesai";
    },
    { holder: "pekerja-lama", ttlMs: TTL }
  );

  ok("pekerjaannya selesai", hasil.dijalankan === true && hasil.hasil === "selesai", JSON.stringify(hasil));
  ok(
    "kunci masih dipegang pemiliknya saat pekerjaan berjalan",
    statusSaatJalan?.holder === "pekerja-lama",
    JSON.stringify(statusSaatJalan?.holder)
  );
  ok(
    "kunci BELUM kedaluwarsa walau umur pekerjaan melewati TTL",
    Number(statusSaatJalan?.kedaluwarsa) === 0,
    `kedaluwarsa ${statusSaatJalan?.kedaluwarsa}`
  );

  section("Kunci dilepas sesudah pekerjaan selesai");

  // statusKunci mengembalikan objek bertanda { ada: false }, bukan null.
  const sesudah = await statusKunci(JOB);
  ok("tidak ada kunci tersisa", sesudah?.ada === false, JSON.stringify(sesudah));

  section("Kunci basi tetap bisa direbut, itu gunanya TTL");

  // Meniru proses yang mati sambil memegang kunci: barisnya ada, tapi tidak ada
  // yang memperpanjangnya. Ini kasus yang dulu membuat permintaan manual dijawab
  // "belum bisa dijalankan" padahal tidak ada yang berjalan.
  await sql.query(
    `INSERT INTO daily_summary_lock (job_name, locked_at, expires_at, holder, report_date)
     VALUES (?, NOW(), DATE_SUB(NOW(), INTERVAL 1 SECOND), 'proses-mati', NULL)`,
    [JOB]
  );

  const direbut = await ambilKunci(JOB, { holder: "pengganti", ttlMs: 60_000 });
  ok("kunci basi berhasil direbut", direbut.didapat === true, JSON.stringify(direbut));

  const setelahDirebut = await statusKunci(JOB);
  ok("pemiliknya berganti", setelahDirebut?.holder === "pengganti", String(setelahDirebut?.holder));

  section("Kunci yang MASIH hidup tidak bisa direbut");

  const gagal = await ambilKunci(JOB, { holder: "penyusup", ttlMs: 60_000 });
  ok("perebutan ditolak", gagal.didapat === false, JSON.stringify(gagal));
  ok("alasannya disebut", Boolean(gagal.alasan), JSON.stringify(gagal.alasan));
} finally {
  // Di blok finally supaya barisnya tetap bersih walau ada asersi yang gagal.
  await lepasKunci(JOB);
  const sisa = await statusKunci(JOB);
  ok("kunci uji dibersihkan", sisa?.ada === false, JSON.stringify(sisa));
}
