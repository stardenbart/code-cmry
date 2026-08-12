// ─────────────────────────────────────────────────────────────────────────────
// Jendela tanggal laporan, dalam WIB.
//
// Server bisa berjalan di zona apa pun, dan node di Windows mengikuti zona
// mesin. Menghitung "kemarin" dengan getDate() lokal berarti hasilnya berubah
// kalau server dipindah atau zona mesin diubah, tanpa satu pun error muncul.
// Karena itu seluruh perhitungan di sini eksplisit terhadap offset WIB.
//
// WIB adalah UTC+7 tanpa daylight saving, jadi offsetnya tetap. Ini bukan
// penyederhanaan yang bisa gagal seperti pada zona Eropa atau Amerika.
// ─────────────────────────────────────────────────────────────────────────────

/** Selisih WIB terhadap UTC dalam milidetik. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * @typedef {object} JendelaLaporan
 * @property {string} tanggal        Tanggal laporan, format YYYY-MM-DD, WIB.
 * @property {Date}   mulaiUtc       Awal hari laporan (00:00 WIB) dalam UTC.
 * @property {Date}   selesaiUtc     Akhir hari laporan (24:00 WIB) dalam UTC.
 */

/**
 * Mengubah instant menjadi komponen tanggal seperti terlihat di WIB.
 *
 * Caranya menggeser instant lalu membaca komponen UTC-nya. Membaca komponen
 * lokal akan menggandakan penyesuaian zona pada server yang tidak di UTC.
 */
export function komponenWib(instant) {
  const geser = new Date(instant.getTime() + WIB_OFFSET_MS);
  return {
    tahun: geser.getUTCFullYear(),
    bulan: geser.getUTCMonth() + 1,
    hari: geser.getUTCDate(),
    jam: geser.getUTCHours(),
    menit: geser.getUTCMinutes(),
  };
}

const pad = (n) => String(n).padStart(2, "0");

/** Tanggal YYYY-MM-DD sebagaimana terlihat di WIB pada instant tersebut. */
export function tanggalWib(instant = new Date()) {
  const k = komponenWib(instant);
  return `${k.tahun}-${pad(k.bulan)}-${pad(k.hari)}`;
}

/** Jam HH:mm sebagaimana terlihat di WIB pada instant tersebut. */
export function jamWib(instant) {
  const k = komponenWib(instant);
  return `${pad(k.jam)}:${pad(k.menit)}`;
}

/** Awal hari (00:00 WIB) untuk tanggal YYYY-MM-DD, sebagai instant UTC. */
export function awalHariWibUtc(tanggal) {
  const [y, m, d] = String(tanggal).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - WIB_OFFSET_MS);
}

/**
 * Jendela hari laporan, yaitu hari SEBELUM hari berjalan menurut WIB.
 *
 * Job berjalan 06:15 WIB dan melaporkan hari sebelumnya. Batas akhirnya dipakai
 * untuk menentukan apakah sebuah dataset sudah pernah refresh setelah hari itu
 * berakhir, yang menentukan cakupan datanya penuh atau sebagian.
 */
export function jendelaLaporan(sekarang = new Date()) {
  const hariIni = tanggalWib(sekarang);
  const mulaiHariIniUtc = awalHariWibUtc(hariIni);
  const selesaiUtc = mulaiHariIniUtc;
  const mulaiUtc = new Date(mulaiHariIniUtc.getTime() - 24 * 60 * 60 * 1000);
  return { tanggal: tanggalWib(mulaiUtc), mulaiUtc, selesaiUtc };
}

// ── Jendela mingguan ────────────────────────────────────────────────────────
//
// Kenapa mingguan, dan bukan cuma harian:
//
// Data 7 hari terakhir masih bergerak. Entri operator masuk terlambat, dan
// beberapa domain tidak diinput harian sama sekali; Energy misalnya, keempat KPI
// hariannya keluar kosong pada 2026-08-04 karena meterannya belum diinput.
// Menyimpan satu angka harian sekali lalu menganggapnya final akan mengabadikan
// angka yang belum lengkap.
//
// Karena itu tiap penarikan MENYEGARKAN seluruh minggu yang masih berjalan, dan
// minggu yang sudah lewat DIBEKUKAN. Pembekuannya eksplisit di database, bukan
// disimpulkan dari tanggal, supaya terlihat kapan sebuah angka berhenti berubah
// dan kenapa.

/** Hari mulai minggu. 1 = Senin. Bisa diubah lewat env bila plant memakai lain. */
export function hariMulaiMinggu() {
  const n = Number(process.env.SUMMARY_WEEK_START_DAY);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1;
}

/**
 * @typedef {object} JendelaMinggu
 * @property {string} kunci          Penanda minggu, sama dengan mulaiTanggal.
 * @property {string} mulaiTanggal   YYYY-MM-DD, hari pertama minggu (WIB).
 * @property {string} selesaiTanggal YYYY-MM-DD, hari terakhir minggu (WIB), inklusif.
 * @property {Date}   mulaiUtc
 * @property {Date}   selesaiUtc     Eksklusif: 00:00 WIB hari setelah selesaiTanggal.
 */

/** Jendela minggu yang memuat tanggal tersebut. */
export function jendelaMinggu(tanggal, mulaiHari = hariMulaiMinggu()) {
  const awal = awalHariWibUtc(tanggal);
  // getUTCDay() pada instant yang sudah digeser ke WIB memberi hari menurut WIB.
  const hariWib = new Date(awal.getTime() + WIB_OFFSET_MS).getUTCDay();
  const geser = (hariWib - mulaiHari + 7) % 7;

  const mulaiUtc = new Date(awal.getTime() - geser * 86_400_000);
  const mulaiTanggal = tanggalWib(mulaiUtc);
  const selesaiUtc = new Date(mulaiUtc.getTime() + 7 * 86_400_000);
  const selesaiTanggal = tanggalWib(new Date(selesaiUtc.getTime() - 86_400_000));

  return { kunci: mulaiTanggal, mulaiTanggal, selesaiTanggal, mulaiUtc, selesaiUtc };
}

/**
 * Apakah minggu ini sudah lewat sepenuhnya pada saat penarikan.
 *
 * Minggu yang sudah lewat boleh dibekukan; minggu yang masih berjalan wajib
 * disegarkan tiap penarikan karena angkanya masih bisa berubah.
 */
export function mingguSudahLewat(minggu, sekarang = new Date()) {
  return sekarang.getTime() >= minggu.selesaiUtc.getTime();
}

/**
 * Minggu-minggu yang bersinggungan dengan jangkauan hari ke belakang.
 *
 * Bawaannya 7 hari, jadi biasanya mengembalikan dua minggu: minggu berjalan dan
 * sisa minggu sebelumnya. Keduanya perlu disegarkan, karena hari-hari di ujung
 * minggu sebelumnya juga masih dalam rentang data yang bergerak.
 *
 * @returns {JendelaMinggu[]} terurut dari paling lama ke paling baru
 */
export function mingguDalamJangkauan(tanggal, hariKeBelakang = 7, mulaiHari = hariMulaiMinggu()) {
  const akhir = awalHariWibUtc(tanggal);
  const awal = new Date(akhir.getTime() - (hariKeBelakang - 1) * 86_400_000);

  const hasil = [];
  let kursor = jendelaMinggu(tanggalWib(awal), mulaiHari);
  while (kursor.mulaiUtc.getTime() <= akhir.getTime()) {
    hasil.push(kursor);
    kursor = jendelaMinggu(tanggalWib(new Date(kursor.selesaiUtc.getTime())), mulaiHari);
  }
  return hasil;
}

/**
 * Menilai cakupan data sebuah dataset terhadap hari laporan.
 *
 * Spec §10 meminta "fresh" | "stale" | "unavailable" tanpa mendefinisikan
 * batasnya. Ukuran seberapa baru tidak menjawab pertanyaan yang sebenarnya
 * penting, yaitu apakah datanya sudah mencakup seluruh hari yang dilaporkan.
 *
 * Contoh nyata yang terukur: Dashboard Lembur Plant refresh pagi pertamanya
 * 08:30, sehingga pada job 06:15 refresh terakhirnya adalah 17:30 hari
 * sebelumnya. Datanya BUKAN basi, tapi hanya mencakup sampai 17:30, dan jam
 * lembur justru bertambah di malam hari. Menyebutnya "fresh" akan membuat
 * angka lembur terbaca sebagai angka sehari penuh.
 *
 * @param {Date|null} refreshTerakhirSelesai  endTime refresh sukses terakhir.
 * @param {JendelaLaporan} jendela
 * @returns {{freshness: "full"|"partial"|"unavailable", cutoffWib: string|null}}
 */
export function nilaiCakupan(refreshTerakhirSelesai, jendela) {
  if (!refreshTerakhirSelesai) return { freshness: "unavailable", cutoffWib: null };

  const akhir = new Date(refreshTerakhirSelesai);
  if (Number.isNaN(akhir.getTime())) return { freshness: "unavailable", cutoffWib: null };

  // Refresh yang selesai pada atau setelah batas akhir hari laporan sudah
  // memuat seluruh hari itu.
  if (akhir.getTime() >= jendela.selesaiUtc.getTime()) {
    return { freshness: "full", cutoffWib: null };
  }

  // Refresh terakhir masih di dalam hari laporan: cakupannya sampai jam itu.
  if (akhir.getTime() >= jendela.mulaiUtc.getTime()) {
    return { freshness: "partial", cutoffWib: jamWib(akhir) };
  }

  // Refresh terakhir bahkan mendahului hari laporan: tidak ada data hari itu.
  return { freshness: "unavailable", cutoffWib: null };
}

// ── Periode cut-off lembur ──────────────────────────────────────────────────
//
// Lembur TIDAK dihitung per bulan kalender. Periodenya tanggal 13 bulan
// sebelumnya sampai tanggal 12 bulan berjalan: 13 Juni sampai 12 Juli adalah
// lembur bulan JUNI.
//
// Aturan ini datang dari pemilik 2026-08-06 dan wajib ada di kode, bukan di
// ingatan orang. Memakai bulan kalender akan menggeser hampir separuh
// kejadian ke bulan yang salah, dan angkanya tetap keluar tanpa error apa pun.

/** Tanggal cut-off. Bisa diubah lewat env bila kebijakan payroll berubah. */
export function tanggalCutoffLembur() {
  const n = Number(process.env.OVERTIME_CUTOFF_DAY);
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : 13;
}

/**
 * Periode lembur untuk sebuah bulan.
 *
 * @param {number} tahun
 * @param {number} bulan  1 sampai 12, bulan yang DILAPORKAN
 * @returns {{label: string, mulaiTanggal: string, selesaiTanggal: string}}
 */
export function periodeLembur(tahun, bulan, hariCutoff = tanggalCutoffLembur()) {
  const pad = (n) => String(n).padStart(2, "0");

  // Mulai: tanggal cut-off di bulan yang dilaporkan.
  const mulai = `${tahun}-${pad(bulan)}-${pad(hariCutoff)}`;

  // Selesai: sehari sebelum cut-off di bulan berikutnya.
  const b2 = bulan === 12 ? 1 : bulan + 1;
  const t2 = bulan === 12 ? tahun + 1 : tahun;
  const selesai = `${t2}-${pad(b2)}-${pad(hariCutoff - 1)}`;

  const namaBulan = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ][bulan - 1];

  return { label: `${namaBulan} ${tahun}`, mulaiTanggal: mulai, selesaiTanggal: selesai };
}

/**
 * Periode lembur yang MEMUAT sebuah tanggal.
 *
 * Dipakai menjawab "lembur bulan ini berapa": tanggal 5 Agustus masih masuk
 * periode Juli, karena periode Juli berjalan 13 Juli sampai 12 Agustus.
 */
export function periodeLemburUntukTanggal(tanggal, hariCutoff = tanggalCutoffLembur()) {
  const [y, m, d] = String(tanggal).split("-").map(Number);
  // Sebelum tanggal cut-off berarti masih periode bulan sebelumnya.
  return d >= hariCutoff ? periodeLembur(y, m, hariCutoff) : periodeLembur(
    m === 1 ? y - 1 : y,
    m === 1 ? 12 : m - 1,
    hariCutoff
  );
}
