// Percobaan ulang panggilan Gemini, dan pesan yang dibaca user saat router gagal.
//
// Latar: user bertanya di chat lintas dashboard, Google membalas 503 "model is
// overloaded" lalu 504, dan CIA menjawab "Belum ada dashboard yang cocok dengan
// pertanyaan ini. Coba sebutkan area atau KPI-nya lebih spesifik". Dua cacat
// bertumpuk di situ: tidak ada percobaan ulang untuk kegagalan sesaat, dan
// daftar kosong karena gagal teknis diperlakukan sama dengan daftar kosong
// karena memang tidak ada yang cocok. Yang kedua lebih buruk: sistem gagal,
// tapi user yang disuruh memperbaiki pertanyaannya.
//
// Gemini TIDAK dipanggil di sini.
import { ok, section } from "./harness.mjs";
import { bisaDiulang } from "../src/config/gemini.js";

section("Kegagalan sesaat diulang, kegagalan permanen tidak");

// Persis bentuk galat axios: status ada di err.response.status.
const galatHttp = (status) => ({ response: { status } });

ok("503 model overloaded -> diulang", bisaDiulang(galatHttp(503)));
ok("504 gateway timeout -> diulang", bisaDiulang(galatHttp(504)));
ok("500 internal -> diulang", bisaDiulang(galatHttp(500)));
ok("502 bad gateway -> diulang", bisaDiulang(galatHttp(502)));
ok("timeout axios (ECONNABORTED) -> diulang", bisaDiulang({ code: "ECONNABORTED" }));
ok("koneksi diputus (ECONNRESET) -> diulang", bisaDiulang({ code: "ECONNRESET" }));

// Mengulang yang ini bukan cuma sia-sia, tapi merugikan: kuota free-tier tidak
// pulih dalam dua detik, jadi setiap pengulangan mempercepat habisnya jatah.
ok("429 kuota habis -> TIDAK diulang", !bisaDiulang(galatHttp(429)));
// Kunci salah tetap salah berapa kali pun dicoba.
ok("400 key tidak valid -> TIDAK diulang", !bisaDiulang(galatHttp(400)));
ok("403 API belum aktif -> TIDAK diulang", !bisaDiulang(galatHttp(403)));
ok("404 model pensiun -> TIDAK diulang", !bisaDiulang(galatHttp(404)));
// Bentuk tak dikenal: jangan diulang. Diam-diam mengulang galat yang tidak
// dipahami menyembunyikan sebab aslinya di balik jeda beberapa detik.
ok("galat tanpa status -> TIDAK diulang", !bisaDiulang({ message: "entah" }));

section("Router gagal teknis TIDAK menyalahkan pertanyaan user");

// Cerminan tabel GAGAL_TEKNIS_ROUTER di aiController. Diuji sebagai kontrak
// perilaku: alasan mana yang boleh memakai kalimat "perjelas pertanyaanmu".
const TIDAK_COCOK = "no_relevant_dashboards";
const GAGAL_TEKNIS = [
  "classifier_error", "parse_error", "no_api_key",
  "no_dashboards_available", "no_accessible_dashboards",
  // Sebab yang tindakan-perbaikannya berbeda satu sama lain. Kuota habis
  // TIDAK boleh memakai kalimat "coba lagi sebentar lagi": jatahnya harian.
  "quota_habis", "layanan_sibuk", "kunci_tidak_valid",
  "kunci_ditolak", "model_pensiun",
];

// Tabelnya tidak diekspor (konstanta modul), jadi yang diuji adalah sumbernya.
// Mengimpor aiController justru MENGGANTUNG uji ini: impornya membuka pool
// database, dan prosesnya tidak pernah keluar sendiri.
const { readFile } = await import("node:fs/promises");
const sumber = await readFile(
  new URL("../src/controllers/aiController.js", import.meta.url), "utf8"
);
const blokTabel = sumber.slice(
  sumber.indexOf("const GAGAL_TEKNIS_ROUTER"),
  sumber.indexOf("};", sumber.indexOf("const GAGAL_TEKNIS_ROUTER"))
);

ok("tabel gagal-teknis ada", blokTabel.length > 0, blokTabel.slice(0, 200));
for (const alasan of GAGAL_TEKNIS) {
  ok(`"${alasan}" punya pesan sendiri`, blokTabel.includes(`${alasan}:`), blokTabel);
}
// Kalau alasan ini ikut masuk tabel, pesan "tidak ada yang cocok" tidak akan
// pernah tampil, dan user kehilangan satu-satunya petunjuk yang benar saat
// pertanyaannya memang di luar cakupan dashboard.
ok(
  `"${TIDAK_COCOK}" TIDAK masuk tabel gagal-teknis`,
  !blokTabel.includes(`${TIDAK_COCOK}:`),
  blokTabel
);

// Tabel dipakai lewat ?? , jadi alasan di luar tabel jatuh ke pesan
// "tidak ada yang cocok". Kalau operatornya berubah jadi || , alasan yang
// pesannya string kosong ikut jatuh ke sana tanpa disadari.
ok(
  "tabel dibaca dengan ?? , bukan ||",
  /GAGAL_TEKNIS_ROUTER\[alasan\] \?\?/.test(sumber),
  sumber.slice(sumber.indexOf("GAGAL_TEKNIS_ROUTER[alasan]") - 100, sumber.indexOf("GAGAL_TEKNIS_ROUTER[alasan]") + 100)
);

// Kuota harian tidak pulih dalam hitungan menit. Kalimat "coba lagi sebentar
// lagi" di sini membuat user menunggu sesuatu yang baru berubah besok.
const pesanKuota = blokTabel.slice(blokTabel.indexOf("quota_habis:"));
ok(
  "pesan kuota habis TIDAK menyuruh menunggu sebentar",
  !/sebentar lagi/.test(pesanKuota.split("\n")[0]),
  pesanKuota.split("\n")[0]
);
ok(
  "pesan kuota habis menunjuk ke API key sendiri",
  /API key sendiri/.test(pesanKuota.split("\n")[0]),
  pesanKuota.split("\n")[0]
);

section("Kode galat Gemini dipetakan ke sebab yang berbeda");

const sumberRouter = await readFile(
  new URL("../src/services/dashboardRelevanceClassifier.js", import.meta.url), "utf8"
);
const KODE_KE_ALASAN = sumberRouter.slice(
  sumberRouter.indexOf("const KODE_KE_ALASAN"),
  sumberRouter.indexOf("};", sumberRouter.indexOf("const KODE_KE_ALASAN"))
);

// Kuota habis dan layanan penuh terlihat mirip di log, tapi tindakan
// perbaikannya berlawanan: yang satu butuh key baru, yang satu cukup ditunggu.
ok("QUOTA -> quota_habis", /QUOTA:\s*'quota_habis'/.test(KODE_KE_ALASAN), KODE_KE_ALASAN);
ok("TIMEOUT -> layanan_sibuk", /TIMEOUT:\s*'layanan_sibuk'/.test(KODE_KE_ALASAN), KODE_KE_ALASAN);
ok("INVALID_KEY -> kunci_tidak_valid", /INVALID_KEY:\s*'kunci_tidak_valid'/.test(KODE_KE_ALASAN), KODE_KE_ALASAN);
ok("FORBIDDEN -> kunci_ditolak", /FORBIDDEN:\s*'kunci_ditolak'/.test(KODE_KE_ALASAN), KODE_KE_ALASAN);
