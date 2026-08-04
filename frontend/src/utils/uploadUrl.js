// ─────────────────────────────────────────────────────────────────────────────
// Menormalkan URL gambar unggahan.
//
// Seluruh 12 tautan portal menyimpan URL absolut berisi host dan port yang
// di-hardcode, misalnya http://172.20.240.49:8080/uploads/portal_1781003436499.webp
// Berkasnya sendiri ada di backend/uploads/ dan sudah disajikan di /uploads oleh
// backend yang sama. Akibat URL absolut itu, gambar portal rusak bagi siapa pun
// yang membuka CODE dari segmen jaringan yang tidak bisa menjangkau host
// tersebut, dan halaman portal adalah halaman publik pertama yang orang lihat.
//
// Diperbaiki saat dibaca, bukan dengan mengubah isi database: menulis ulang data
// yang sudah ada adalah keputusan pemilik sistem, sedangkan ini bisa
// dikembalikan hanya dengan menghapus satu berkas.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mengubah URL unggahan absolut menjadi relatif, supaya dilayani oleh host
 * mana pun yang sedang membuka CODE.
 *
 * URL absolut ke luar (misalnya gambar dari internet) dibiarkan apa adanya:
 * hanya path yang menunjuk ke /uploads milik aplikasi ini yang dinormalkan.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalkanUrlUnggahan(url) {
  const nilai = String(url || "").trim();
  if (!nilai) return "";

  const cocok = nilai.match(/^https?:\/\/[^/]+(\/uploads\/.+)$/i);
  return cocok ? cocok[1] : nilai;
}
