// -----------------------------------------------------------------------------
// Pengalihan ke dashboard yang tepat.
//
// Dipakai ketika pertanyaan user tidak bisa dijawab dari snapshot dashboard yang
// sedang dibuka. Katalognya HANYA memuat dashboard yang user berhak buka:
// menyebut nama dashboard beserta isinya sudah membocorkan informasi.
// -----------------------------------------------------------------------------

const RINGKAS_MAKS = 140;

const buangHtml = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Katalog ringkas untuk pengalihan.
 *
 * Hak akses disaring di sini, bukan di prompt. Menyerahkan penyaringan hak
 * akses ke model berarti satu instruksi yang terlewat sudah cukup untuk
 * membocorkan nama dashboard yang tidak boleh dilihat.
 *
 * `getCatalogForUser` (sumber di produksi) menandai hak akses lewat
 * `hasAccess`, sementara pemanggil lain (dan uji ini) memakai `canOpen`.
 * Keduanya diperiksa, tapi dengan default menolak: dashboard hanya lolos bila
 * ADA properti akses yang bernilai eksplisit `true`. Default menolak dipilih
 * karena kode ini satu-satunya penjaga sebelum nama dashboard terlarang
 * disebut ke user. Kalau bentuk objeknya berubah lagi di kemudian hari
 * seperti yang sudah terjadi pada `canOpen`, default menolak membuat
 * dashboard baru itu tersaring sampai properti aksesnya dikenali, bukan
 * diam-diam meloloskan semua dashboard tanpa terdeteksi.
 */
export function ringkasKatalogUntukPengalihan(dashboards, { maks = 40 } = {}) {
  return (dashboards || [])
    .filter((d) => d && (d.canOpen === true || d.hasAccess === true))
    .slice(0, maks)
    .map((d) => ({
      id: d.id,
      title: String(d.title || "").trim(),
      department: String(d.department || "").trim(),
      ringkas: buangHtml(d.description).slice(0, RINGKAS_MAKS),
    }));
}

/**
 * Aturan pengalihan untuk instruksi sistem.
 *
 * Contoh pertanyaannya WAJIB menyebut nama nyata. Dari perilaku sistem ini
 * sendiri, pertanyaan umum seperti "kenapa line 3 tinggi" ditolak sebagai
 * ambigu sementara yang menyebut nama spesifik langsung terjawab. Saran yang
 * tidak bisa dijawab membuat user menyimpulkan fiturnya tidak berguna.
 */
export function aturanPengalihanUntukInstruksi(katalogRingkas) {
  const daftar = (katalogRingkas || [])
    .map((d) => `- ${d.title}${d.department ? ` (${d.department})` : ""}: ${d.ringkas}`)
    .join("\n");

  return [
    "BILA PERTANYAANNYA TIDAK BISA DIJAWAB DARI SNAPSHOT DASHBOARD INI:",
    "Jangan menjawab dengan tebakan, dan jangan hanya bilang tidak tahu.",
    "Arahkan user ke dashboard yang punya datanya, dengan tiga bagian:",
    "1. Sebut bahwa datanya tidak ada di dashboard ini.",
    "2. Sebut dashboard yang punya, PERSIS seperti namanya di daftar bawah.",
    "3. Beri satu contoh pertanyaan yang bisa ditanyakan di sana, dan contohnya",
    "   WAJIB menyebut nama nyata seperti nama mesin atau CMD yang muncul di",
    "   percakapan ini. Pertanyaan umum akan ditolak sebagai ambigu.",
    "Lalu tawarkan: mau saya jawab sekarang dari dashboard itu.",
    "",
    "Sebut HANYA dashboard yang ada di daftar ini. Jangan menyebut dashboard di",
    "luar daftar, walau kamu menduga ada, karena user mungkin tidak berhak",
    "membukanya.",
    "",
    "DASHBOARD YANG TERSEDIA UNTUK USER INI:",
    daftar || "(tidak ada)",
  ].join("\n");
}
