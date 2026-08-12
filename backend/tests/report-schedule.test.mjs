// Penentu jatuh tempo laporan terjadwal.
//
// Semua waktu disuntikkan, jadi "apakah Senin jam 8 pagi sudah waktunya" diuji
// dalam milidetik alih-alih menunggu Senin.
//
// Dua hal dijaga paling ketat, keduanya kegagalan diam: jadwal yang tidak pernah
// jatuh tempo sehingga laporan tidak pernah datang tanpa satu pun error, dan
// jadwal yang jatuh tempo berkali-kali sehingga grup dibanjiri laporan sama.
import { ok, section } from "./harness.mjs";
import {
  bersihkanSetelan,
  apakahJatuhTempo,
  ringkasJadwal,
  FREKUENSI_SAH,
  TOLERANSI_MENIT,
} from "../src/services/reportSchedule.js";

/** WIB adalah UTC+7, jadi 08:00 WIB sama dengan 01:00 UTC. */
const wib = (tahun, bulan, tanggal, jam, menit = 0) =>
  new Date(Date.UTC(tahun, bulan - 1, tanggal, jam - 7, menit));

const setelan = (ubah = {}) =>
  bersihkanSetelan({ aktif: 1, frekuensi: "daily", jam: 8, menit: 0, provider: "gemini", ...ubah }).nilai;

section("Validasi menolak nilai mustahil");

ok("frekuensi asing ditolak", bersihkanSetelan({ frekuensi: "tiap purnama" }).sah === false, "diterima");
ok("jam 24 ditolak", bersihkanSetelan({ jam: 24 }).sah === false, "diterima");
ok("jam -1 ditolak", bersihkanSetelan({ jam: -1 }).sah === false, "diterima");
ok("menit 60 ditolak", bersihkanSetelan({ menit: 60 }).sah === false, "diterima");
ok("hari 7 ditolak", bersihkanSetelan({ hari: 7 }).sah === false, "diterima");
ok("provider asing ditolak", bersihkanSetelan({ provider: "openai" }).sah === false, "diterima");
ok("frekuensi sah ada tiga", FREKUENSI_SAH.join(",") === "hourly,daily,weekly", FREKUENSI_SAH.join(","));

section("JID grup harus grup, bukan nomor perorangan");

// Menerima nomor perorangan berarti laporan operasional terkirim ke japri
// seseorang tanpa ada yang menyadarinya.
ok(
  "nomor perorangan ditolak",
  bersihkanSetelan({ grupJid: "628123456789@s.whatsapp.net" }).sah === false,
  "diterima"
);
ok("grup diterima", bersihkanSetelan({ grupJid: "12345-678@g.us" }).sah === true, "ditolak");
ok(
  "beberapa grup diterima",
  bersihkanSetelan({ grupJid: "1@g.us, 2@g.us" }).nilai.grupJid === "1@g.us,2@g.us",
  "pemisahannya salah"
);
ok("kosong diterima", bersihkanSetelan({ grupJid: "" }).sah === true, "ditolak");

section("Harian");

const harian = setelan();
ok("tepat waktunya", apakahJatuhTempo({ setelan: harian, sekarang: wib(2026, 8, 12, 8, 0) }).jatuhTempo === true, "tidak");
ok("terlambat 3 menit tetap jalan", apakahJatuhTempo({ setelan: harian, sekarang: wib(2026, 8, 12, 8, 3) }).jatuhTempo === true, "tidak");
ok(
  `terlambat lebih dari ${TOLERANSI_MENIT} menit tidak jalan`,
  apakahJatuhTempo({ setelan: harian, sekarang: wib(2026, 8, 12, 8, TOLERANSI_MENIT + 1) }).jatuhTempo === false,
  "tetap jalan"
);
ok("sebelum menitnya tidak jalan", apakahJatuhTempo({ setelan: harian, sekarang: wib(2026, 8, 12, 7, 59) }).jatuhTempo === false, "jalan");
ok("jam lain tidak jalan", apakahJatuhTempo({ setelan: harian, sekarang: wib(2026, 8, 12, 20, 0) }).jatuhTempo === false, "jalan");

section("Dimatikan berarti tidak pernah jalan");

ok(
  "aktif false menolak walau tepat waktunya",
  apakahJatuhTempo({ setelan: setelan({ aktif: 0 }), sekarang: wib(2026, 8, 12, 8, 0) }).jatuhTempo === false,
  "tetap jalan"
);
ok("setelan null aman", apakahJatuhTempo({ setelan: null, sekarang: new Date() }).jatuhTempo === false, "jalan");

section("Mingguan");

// 2026-08-12 adalah Rabu, jadi hari 3. Dipilih tanggal nyata supaya salah hitung
// hari ketahuan, bukan disembunyikan angka bulat.
const rabu = wib(2026, 8, 12, 8, 0);
ok("hari cocok", apakahJatuhTempo({ setelan: setelan({ frekuensi: "weekly", hari: 3 }), sekarang: rabu }).jatuhTempo === true, "tidak");
ok("hari lain ditolak", apakahJatuhTempo({ setelan: setelan({ frekuensi: "weekly", hari: 1 }), sekarang: rabu }).jatuhTempo === false, "jalan");

section("Batas hari WIB, bukan UTC");

// 2026-08-13 00:30 WIB masih 2026-08-12 17:30 UTC. Jadwal mingguan yang dihitung
// pakai UTC akan menganggap ini masih Rabu, padahal di Sentul sudah Kamis.
const kamisDiniHari = wib(2026, 8, 13, 0, 30);
ok(
  "dini hari dihitung sebagai hari WIB berikutnya",
  apakahJatuhTempo({ setelan: setelan({ frekuensi: "weekly", hari: 4, jam: 0, menit: 30 }), sekarang: kamisDiniHari }).jatuhTempo === true,
  "dihitung masih hari sebelumnya"
);
ok(
  "hari sebelumnya ditolak pada waktu yang sama",
  apakahJatuhTempo({ setelan: setelan({ frekuensi: "weekly", hari: 3, jam: 0, menit: 30 }), sekarang: kamisDiniHari }).jatuhTempo === false,
  "jalan"
);

section("Tiap jam");

const tiapJam = setelan({ frekuensi: "hourly", menit: 15 });
ok("menit cocok di jam berapa pun", apakahJatuhTempo({ setelan: tiapJam, sekarang: wib(2026, 8, 12, 3, 15) }).jatuhTempo === true, "tidak");
ok("jam lain juga jalan", apakahJatuhTempo({ setelan: tiapJam, sekarang: wib(2026, 8, 12, 21, 16) }).jatuhTempo === true, "tidak");
ok("menit lain tidak jalan", apakahJatuhTempo({ setelan: tiapJam, sekarang: wib(2026, 8, 12, 21, 40) }).jatuhTempo === false, "jalan");

section("Penjaga jalan ganda");

// Cron berdetak tiap menit, jadi tanpa penjaga ini seluruh menit dalam rentang
// toleransi ikut jatuh tempo dan grup menerima laporan yang sama berkali-kali.
const baruSaja = wib(2026, 8, 12, 8, 0);
ok(
  "harian tidak diulang beberapa menit kemudian",
  apakahJatuhTempo({ setelan: harian, sekarang: wib(2026, 8, 12, 8, 2), terakhirJalan: baruSaja }).jatuhTempo === false,
  "diulang"
);
ok(
  "harian jalan lagi besoknya",
  apakahJatuhTempo({ setelan: harian, sekarang: wib(2026, 8, 13, 8, 0), terakhirJalan: baruSaja }).jatuhTempo === true,
  "tidak jalan"
);
ok(
  "tiap jam tidak diulang di menit berikutnya",
  apakahJatuhTempo({ setelan: tiapJam, sekarang: wib(2026, 8, 12, 3, 17), terakhirJalan: wib(2026, 8, 12, 3, 15) }).jatuhTempo === false,
  "diulang"
);
ok(
  "tiap jam jalan lagi jam berikutnya",
  apakahJatuhTempo({ setelan: tiapJam, sekarang: wib(2026, 8, 12, 4, 15), terakhirJalan: wib(2026, 8, 12, 3, 15) }).jatuhTempo === true,
  "tidak jalan"
);

section("Ringkasan jadwal terbaca manusia");

ok("harian", ringkasJadwal(harian) === "setiap hari jam 08:00 WIB", ringkasJadwal(harian));
ok(
  "mingguan menyebut nama hari",
  ringkasJadwal(setelan({ frekuensi: "weekly", hari: 3 })) === "setiap Rabu jam 08:00 WIB",
  ringkasJadwal(setelan({ frekuensi: "weekly", hari: 3 }))
);
ok("tiap jam", /setiap jam/.test(ringkasJadwal(tiapJam)), ringkasJadwal(tiapJam));
ok("dimatikan disebut", ringkasJadwal(setelan({ aktif: 0 })) === "penjadwalan dimatikan", ringkasJadwal(setelan({ aktif: 0 })));
