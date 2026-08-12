// Penentu jatuh tempo laporan terjadwal.
//
// Seluruh fungsi di berkas ini MURNI: waktu masuk sebagai argumen, tidak pernah
// dibaca dari jam sistem di dalam. Itu yang membuat "apakah jam 8 pagi Senin
// sudah waktunya" bisa diuji dalam milidetik alih-alih menunggu Senin.
//
// Kenapa keputusannya ada di sini dan bukan di ekspresi cron: ekspresi cron
// didaftarkan sekali saat proses menyala. Setelan yang diubah admin lewat
// website baru berlaku setelah restart, dan itu persis yang diminta TIDAK
// terjadi. Jadi cron hanya berdetak, dan berkas ini yang memutuskan.

import { komponenWib } from "../utils/dateWindow.util.js";

export const FREKUENSI_SAH = ["hourly", "daily", "weekly"];

/** Toleransi keterlambatan detik. Lihat alasannya di apakahJatuhTempo. */
export const TOLERANSI_MENIT = 5;

/**
 * Membersihkan setelan mentah dari database atau dari form.
 *
 * Menolak nilai mustahil alih-alih menyimpannya: jam 25 atau hari 9 akan membuat
 * jadwal tidak pernah jatuh tempo, dan itu kegagalan diam yang paling sulit
 * dilacak karena tidak ada error, laporannya saja tidak pernah datang.
 *
 * @param {object} mentah
 * @returns {{sah: boolean, alasan: string, nilai: object}}
 */
export function bersihkanSetelan(mentah = {}) {
  const frekuensi = String(mentah.frekuensi || "daily").trim().toLowerCase();
  if (!FREKUENSI_SAH.includes(frekuensi)) {
    return { sah: false, alasan: `frekuensi harus salah satu dari: ${FREKUENSI_SAH.join(", ")}`, nilai: null };
  }

  const angka = (v, bawaan) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : bawaan);

  const jam = angka(mentah.jam, 8);
  if (jam < 0 || jam > 23) return { sah: false, alasan: "jam harus 0 sampai 23", nilai: null };

  const menit = angka(mentah.menit, 0);
  if (menit < 0 || menit > 59) return { sah: false, alasan: "menit harus 0 sampai 59", nilai: null };

  const hari = angka(mentah.hari, 1);
  if (hari < 0 || hari > 6) return { sah: false, alasan: "hari harus 0 Minggu sampai 6 Sabtu", nilai: null };

  const provider = String(mentah.provider || "gemini").trim().toLowerCase();
  if (!["gemini", "glm"].includes(provider)) {
    return { sah: false, alasan: "provider harus gemini atau glm", nilai: null };
  }

  // JID grup divalidasi bentuknya. Grup WhatsApp SELALU berakhiran @g.us, dan
  // nomor perorangan berakhiran @s.whatsapp.net. Menerima nomor perorangan di
  // sini berarti laporan operasional terkirim ke japri seseorang tanpa disadari.
  const grupMentah = String(mentah.grupJid || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const salah = grupMentah.filter((g) => !g.endsWith("@g.us"));
  if (salah.length) {
    return { sah: false, alasan: `JID grup harus berakhiran @g.us: ${salah.join(", ")}`, nilai: null };
  }

  return {
    sah: true,
    alasan: "",
    nilai: {
      aktif: Boolean(mentah.aktif),
      frekuensi,
      jam,
      menit,
      hari,
      provider,
      grupJid: grupMentah.join(","),
    },
  };
}

/**
 * Apakah jadwal sudah jatuh tempo pada sebuah waktu.
 *
 * @param {object} arg
 * @param {object} arg.setelan hasil bersihkanSetelan().nilai
 * @param {Date} arg.sekarang
 * @param {Date|null} [arg.terakhirJalan] kapan terakhir benar-benar dijalankan
 * @returns {{jatuhTempo: boolean, alasan: string}}
 */
export function apakahJatuhTempo({ setelan, sekarang, terakhirJalan = null }) {
  if (!setelan) return { jatuhTempo: false, alasan: "setelan kosong" };
  if (!setelan.aktif) return { jatuhTempo: false, alasan: "penjadwalan dimatikan" };

  const k = komponenWib(sekarang);

  // Menit yang cocok, sesuai frekuensi.
  if (setelan.frekuensi === "weekly") {
    // komponenWib tidak memberi hari dalam pekan, jadi dihitung dari tanggal WIB
    // yang sama supaya tidak ada dua sumber kebenaran soal zona waktu.
    const hariIni = new Date(Date.UTC(k.tahun, k.bulan - 1, k.hari)).getUTCDay();
    if (hariIni !== setelan.hari) {
      return { jatuhTempo: false, alasan: `bukan harinya, sekarang hari ${hariIni}` };
    }
  }

  if (setelan.frekuensi !== "hourly" && k.jam !== setelan.jam) {
    return { jatuhTempo: false, alasan: `bukan jamnya, sekarang ${k.jam}` };
  }

  // Toleransi keterlambatan, bukan kecocokan menit persis.
  //
  // Cron berdetak tiap menit, tapi satu detak bisa terlewat karena proses sedang
  // sibuk, baru restart, atau menitnya tergeser. Menuntut menit persis berarti
  // satu detak yang terlewat membuang seluruh jadwal hari itu tanpa jejak.
  const selisih = k.menit - setelan.menit;
  if (selisih < 0 || selisih > TOLERANSI_MENIT) {
    return { jatuhTempo: false, alasan: `belum menitnya, sekarang menit ${k.menit}` };
  }

  // Penjaga jalan ganda. Tanpa ini, seluruh menit dalam rentang toleransi ikut
  // jatuh tempo dan laporan terkirim berkali-kali.
  if (terakhirJalan) {
    const jarakMenit = Math.floor((sekarang.getTime() - terakhirJalan.getTime()) / 60000);
    const jarakMinimum = setelan.frekuensi === "hourly" ? 50 : 20 * 60;
    if (jarakMenit < jarakMinimum) {
      return { jatuhTempo: false, alasan: `baru dijalankan ${jarakMenit} menit lalu` };
    }
  }

  return { jatuhTempo: true, alasan: "" };
}

/**
 * Ringkasan jadwal dalam bahasa manusia, untuk ditampilkan di UI dan di log.
 *
 * Dipakai supaya admin bisa memeriksa maksudnya tanpa menerjemahkan angka
 * sendiri. Salah membaca jadwal adalah kesalahan yang baru ketahuan sehari
 * kemudian, saat laporannya tidak datang.
 *
 * @param {object} setelan
 * @returns {string}
 */
export function ringkasJadwal(setelan) {
  if (!setelan) return "belum diatur";
  if (!setelan.aktif) return "penjadwalan dimatikan";

  const jj = String(setelan.jam).padStart(2, "0");
  const mm = String(setelan.menit).padStart(2, "0");
  const namaHari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

  if (setelan.frekuensi === "hourly") return `setiap jam pada menit ke-${setelan.menit} WIB`;
  if (setelan.frekuensi === "weekly") return `setiap ${namaHari[setelan.hari]} jam ${jj}:${mm} WIB`;
  return `setiap hari jam ${jj}:${mm} WIB`;
}
