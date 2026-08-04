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
function komponenWib(instant) {
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
