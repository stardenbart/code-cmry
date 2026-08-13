// ─────────────────────────────────────────────────────────────────────────────
// Mengambil angka KPI dari Power BI lewat DAX, berdasarkan katalog (spec §10).
//
// Filter tanggal dibangun dari TABEL TANGGAL YANG DITANDAI model itu sendiri,
// bukan dari tebakan nama kolom. Introspeksi INFO.VIEW.TABLES() dan
// INFO.VIEW.COLUMNS() diuji jalan 2026-08-04, sementara INFO.TABLES() dan
// INFO.COLUMNS() tanpa VIEW dijawab 400. Perbedaannya diukur, bukan dibaca.
//
// Model yang TIDAK punya tabel tanggal tunggal yang jelas tidak difilter, dan
// itu dilaporkan lewat `dateFilterApplied: false` beserta alasannya. Menebak
// kolom tanggal akan memfilter baris yang salah, dan angkanya keluar tanpa error
// sehingga tidak ada yang tahu laporannya salah. Lebih baik menyebut apa adanya.
//
// Ketahanan per spec §14: satu KPI gagal tidak menggagalkan KPI lain, dan satu
// domain gagal tidak menggagalkan domain lain.
// ─────────────────────────────────────────────────────────────────────────────

import {
  resolusiDatasetId, jalankanDax, statusKesegaran,
} from "./powerbiMeta.service.js";
import { KATALOG_KPI, kpiDomain } from "./kpiCatalog.js";
import { periodeLemburUntukTanggal } from "../utils/dateWindow.util.js";

/**
 * Nama measure atau kolom di dalam kurung siku DAX.
 * Kurung siku penutup di dalam nama digandakan, kalau tidak querynya rusak dan
 * pesan errornya tidak menyebut measure mana yang bermasalah.
 */
const kurung = (nama) => `[${String(nama).replace(/]/g, "]]")}]`;

/** Nama tabel dalam kutip tunggal DAX. Kutip di dalam nama digandakan. */
const tabel = (nama) => `'${String(nama).replace(/'/g, "''")}'`;

/** DATE(y,m,d) dari string YYYY-MM-DD. */
function daxTanggal(tanggal) {
  const [y, m, d] = String(tanggal).split("-").map(Number);
  return `DATE(${y},${m},${d})`;
}

/** Cache tabel tanggal per dataset. Struktur model tidak berubah tiap hari. */
const cacheTanggal = new Map();

/**
 * Menemukan kolom tanggal yang dipakai model untuk memfilter fakta.
 *
 * Urutan pencarian, dari yang paling bisa dipertanggungjawabkan:
 *
 *   1. Tabel dengan DataCategory "Time", yaitu tabel tanggal yang SENGAJA
 *      ditandai pembuat model. Ini niat pembuatnya, bukan tafsiran.
 *   2. Kalau tidak ada, dan hanya ada SATU tabel bernama seperti tabel tanggal
 *      (Dim_Date, Calendar, dan sejenisnya) yang punya kolom dateTime.
 *
 * Kalau keduanya gagal, mengembalikan null. Model auto-date table bawaan Power BI
 * sengaja dilewati: namanya berawalan LocalDateTable_ dan tiap kolom fakta punya
 * satu, jadi memilih salah satunya berarti memfilter kolom fakta yang salah.
 */
export async function temukanKolomTanggal(datasetId) {
  if (cacheTanggal.has(datasetId)) return cacheTanggal.get(datasetId);

  let hasil = null;
  try {
    const tabelRows = await jalankanDax(datasetId, "EVALUATE INFO.VIEW.TABLES()", { percobaan: 2 });
    const kolomRows = await jalankanDax(datasetId, "EVALUATE INFO.VIEW.COLUMNS()", { percobaan: 2 });

    const bukanOtomatis = (n) => !/^LocalDateTable_|^DateTableTemplate_/i.test(String(n || ""));

    const kolomTanggalDi = (namaTabel) =>
      kolomRows
        .filter(
          (c) =>
            String(c["[Table]"]) === namaTabel &&
            /date|dateTime/i.test(String(c["[DataType]"])) &&
            c["[IsHidden]"] !== true
        )
        .map((c) => String(c["[Name]"]));

    const ditandai = tabelRows
      .filter((t) => String(t["[DataCategory]"] || "") === "Time" && bukanOtomatis(t["[Name]"]))
      .map((t) => String(t["[Name]"]));

    for (const t of ditandai) {
      const kol = kolomTanggalDi(t);
      if (kol.length) {
        hasil = { tabel: t, kolom: kol[0], sumber: "tabel tanggal ditandai model" };
        break;
      }
    }

    if (!hasil) {
      const kandidat = tabelRows
        .map((t) => String(t["[Name]"]))
        .filter((n) => bukanOtomatis(n) && /(^|[^a-z])(dim[_ ]?date|date|calendar|tanggal|kalender)([^a-z]|$)/i.test(n))
        .filter((n) => kolomTanggalDi(n).length > 0);

      // Hanya kalau TUNGGAL. Dua kandidat berarti pilihannya sembarang, dan
      // memfilter tabel yang salah lebih buruk daripada tidak memfilter.
      if (kandidat.length === 1) {
        hasil = {
          tabel: kandidat[0],
          kolom: kolomTanggalDi(kandidat[0])[0],
          sumber: "satu-satunya tabel bernama tanggal",
        };
      } else if (kandidat.length > 1) {
        hasil = { tabel: null, kolom: null, sumber: `ada ${kandidat.length} kandidat tabel tanggal, tidak dipilih` };
      }
    }

    if (!hasil) hasil = { tabel: null, kolom: null, sumber: "tidak ada tabel tanggal yang jelas" };
  } catch (err) {
    hasil = { tabel: null, kolom: null, sumber: `introspeksi gagal: ${String(err.message).slice(0, 60)}` };
  }

  cacheTanggal.set(datasetId, hasil);
  return hasil;
}

/**
 * Apakah entri katalog ini difilter tanggal.
 *
 * Membaca flag TERUKUR, bukan menafsirkan prosa dateLogic. Versi pertama
 * mencocokkan kata di dateLogic, dan itu salah untuk enam KPI: OEE dan Downtime
 * kategori ditandai "membawa jendela waktunya sendiri" berdasarkan prosa
 * registry, padahal pengukuran menunjukkan keduanya MERESPONS filter tanggal.
 * Akibatnya laporan menampilkan angka sepanjang masa sebagai angka harian, dan
 * tidak ada error yang muncul.
 *
 * Flag-nya ditetapkan dengan menjalankan tiap measure dua kali, dengan dan tanpa
 * filter, lalu membandingkan hasilnya. Lihat komentar per entri di kpiCatalog.js.
 */
export function perluFilterTanggal(entri) {
  return entri.filterTanggal === true;
}

/**
 * Jendela yang benar untuk sebuah entri.
 *
 * Sebagian KPI TIDAK mengikuti jendela laporan. Lembur dihitung per periode
 * cut-off, 13 bulan sebelumnya sampai 12 bulan berjalan, dan capaiannya adalah
 * AKUMULASI sejak awal cut-off, bukan angka satu minggu. Memakai jendela
 * mingguan untuk lembur menghasilkan angka yang jauh lebih kecil dari yang
 * dilihat orang di dashboard, dan tidak ada error yang menandainya.
 *
 * Aturan ini datang dari pemilik 2026-08-06.
 */
function jendelaUntukEntri(entri, jendela) {
  if (entri.jendelaKhusus !== "lembur") return jendela;

  // Titik acuannya hari terakhir jendela laporan, supaya periode yang dipilih
  // adalah periode yang sedang berjalan pada laporan itu, bukan hari ini.
  const acuan = jendela.selesaiTanggal || jendela.tanggal;
  const p = periodeLemburUntukTanggal(acuan);

  // Akumulasi SAMPAI hari laporan, bukan sampai akhir periode: periode yang
  // masih berjalan belum punya data setelah hari ini, dan menyertakannya
  // membuat pembacanya mengira angkanya sudah final.
  return {
    mulaiTanggal: p.mulaiTanggal,
    selesaiTanggal: acuan < p.selesaiTanggal ? acuan : p.selesaiTanggal,
    labelPeriode: p.label,
  };
}


/** Membangun DAX untuk satu entri katalog. */
function bangunDax(entri, jendela, kolomTanggal) {
  const jw = jendelaUntukEntri(entri, jendela);
  const daftar = entri.measures
    .map((m, i) => `"m${i}", ${kurung(m)}`)
    .join(", ");
  const row = `ROW(${daftar})`;

  if (!perluFilterTanggal(entri) || !kolomTanggal?.kolom) return `EVALUATE ${row}`;

  const kol = `${tabel(kolomTanggal.tabel)}${kurung(kolomTanggal.kolom)}`;

  // Jendela menerima dua bentuk: harian lewat `tanggal`, dan rentang lewat
  // `mulaiTanggal` dan `selesaiTanggal`. Bentuk rentang dipakai penarikan
  // mingguan, yang menyegarkan seluruh minggu berjalan karena datanya masih
  // bergerak beberapa hari setelah kejadiannya.
  const mulaiTgl = jw.mulaiTanggal || jw.tanggal;
  const selesaiTgl = jw.selesaiTanggal || jw.tanggal;

  // Batas atas eksklusif memakai hari SETELAH hari terakhir, bukan <= hari
  // terakhir: kolom dateTime yang membawa komponen jam akan terpotong oleh
  // perbandingan terhadap tengah malam, sehingga kejadian sore di hari terakhir
  // hilang tanpa jejak.
  const [y, m, d] = String(selesaiTgl).split("-").map(Number);
  const setelah = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

  return `EVALUATE CALCULATETABLE(${row}, ${kol} >= ${daxTanggal(mulaiTgl)}, ${kol} < ${daxTanggal(setelah)})`;
}

// ── Breakdown berdimensi ────────────────────────────────────────────────────
//
// Kenapa perlu jalur terpisah: entri biasa mengevaluasi measure skalar lewat
// ROW() dan menghasilkan satu angka. Pertanyaan seperti "tiga mesin dengan
// downtime tertinggi di CMD 1" menuntut pengelompokan, jadi SUMMARIZECOLUMNS
// dengan TOPN.
//
// Katalog menyebut NAMA KOLOM saja, tidak nama tabelnya. Tabelnya diresolusi
// runtime lewat INFO.VIEW.COLUMNS(), prinsip yang sama seperti nama measure:
// yang ditulis tangan lebih mudah salah daripada yang ditanyakan ke modelnya.

/** Cache kolom per dataset. Struktur model tidak berubah tiap hari. */
const cacheKolom = new Map();

/**
 * Mencari tabel pemilik sebuah nama kolom.
 *
 * Mengembalikan null bila namanya ada di lebih dari satu tabel: memilih
 * sembarang satu berarti mengelompokkan berdasarkan kolom yang salah, dan
 * angkanya keluar tanpa error. Nama seperti "Machine" memang muncul di beberapa
 * tabel pada model yang sama.
 */
export async function temukanKolom(datasetId, namaKolom) {
  if (!cacheKolom.has(datasetId)) {
    try {
      const rows = await jalankanDax(datasetId, "EVALUATE INFO.VIEW.COLUMNS()", { percobaan: 2 });
      cacheKolom.set(datasetId, rows);
    } catch {
      cacheKolom.set(datasetId, []);
    }
  }

  const target = String(namaKolom).trim().toLowerCase();
  const cocok = (cacheKolom.get(datasetId) || []).filter(
    (c) =>
      String(c["[Name]"] || "").trim().toLowerCase() === target &&
      !/^LocalDateTable_|^DateTableTemplate_/i.test(String(c["[Table]"] || ""))
  );

  if (cocok.length === 1) {
    return { tabel: String(cocok[0]["[Table]"]), kolom: String(cocok[0]["[Name]"]) };
  }
  if (cocok.length > 1) {
    return { tabel: null, kolom: null, alasan: `nama kolom ada di ${cocok.length} tabel, tidak dipilih` };
  }
  return { tabel: null, kolom: null, alasan: "kolom tidak ditemukan di model" };
}

/**
 * Peta kunci baris dalam huruf kecil, untuk pencocokan yang abai kapitalisasi.
 *
 * Dipakai karena Execute Queries menormalkan kapitalisasi nama kolom di kunci
 * barisnya, sementara metadata model menyimpan nama aslinya.
 */
function kunciAbaiHuruf(baris) {
  const peta = new Map();
  for (const k of Object.keys(baris || {})) peta.set(k.toLowerCase(), baris[k]);
  return peta;
}

/**
 * Mengambil satu entri breakdown.
 *
 * @param {object} entri  entri katalog berjenis breakdown
 * @param {object} jendela
 */
export async function ambilBreakdown(entri, jendela) {
  const datasetId = await resolusiDatasetId(entri.modelName);
  const dasar = {
    domain: entri.domain, kpi: entri.kpi, unit: entri.unit, status: entri.status,
    modelName: entri.modelName, jenis: "breakdown", dimensi: entri.dimensi,
    arah: entri.arah, n: entri.n, notes: entri.notes || null,
  };

  if (!datasetId) return { ...dasar, baris: [], error: "model tidak ditemukan di workspace" };

  // Tabel boleh disebut eksplisit di katalog. Diperlukan karena nama kolom yang
  // sama sering ada di beberapa tabel: `nama_mesin` dan `departemen` masing-masing
  // ada di 2 tabel pada Dashboard DT ORS, dan penolakan otomatis membuat KPI yang
  // benar tidak bisa dipakai sama sekali. Menyebut tabelnya adalah keputusan yang
  // bisa ditinjau; memilih otomatis tidak.
  const dim = entri.dimensiTabel
    ? { tabel: entri.dimensiTabel, kolom: entri.dimensi }
    : await temukanKolom(datasetId, entri.dimensi);
  if (!dim.kolom) return { ...dasar, baris: [], error: `dimensi tidak terpakai: ${dim.alasan}` };

  // Kolom tanggal boleh disebut EKSPLISIT per entri lewat { tabel, kolom }.
  //
  // Deteksi otomatis memilih satu kolom untuk seluruh model, dan pada model
  // dengan banyak tabel fakta itu sering bukan kolom milik tabel yang sedang
  // dikelompokkan. Akibatnya filter tanggal menempel di tabel lain dan hasilnya
  // kosong tanpa satu pun error, yang terbaca sebagai "tidak ada kejadian".
  const kolomTanggal = entri.kolomTanggal?.kolom
    ? { tabel: entri.kolomTanggal.tabel, kolom: entri.kolomTanggal.kolom, sumber: "disebut di katalog" }
    : await temukanKolomTanggal(datasetId);
  const perluFilter = perluFilterTanggal(entri);
  const terpasang = perluFilter && Boolean(kolomTanggal?.kolom);

  const kolomDim = `${tabel(dim.tabel)}${kurung(dim.kolom)}`;

  // Measure PERTAMA menentukan peringkat, sisanya ikut sebagai kolom pendamping
  // di baris yang sama.
  //
  // Ini yang membuat pertanyaan korelatif bisa dijawab: "OEE terendah" tidak
  // berguna tanpa "penyumbangnya apa". Sebelumnya hanya measures[0] yang
  // dipakai, jadi penyumbang harus ditarik lewat entri terpisah dan pembacanya
  // yang mencocokkan sendiri baris mana milik mesin mana.
  const semuaM = (entri.measures || []).filter(Boolean);

  const m = kurung(semuaM[0]);
  const pendamping = semuaM.slice(1);
  const urut = entri.arah === "terendah" ? "ASC" : "DESC";

  // Kolom teks pendamping, misalnya Issue dan Action pada downtime. Ikut
  // dikelompokkan supaya penyebab dan tindakannya terbaca bersama angkanya,
  // bukan sebagai daftar terpisah yang harus dicocokkan pembacanya sendiri.
  // Tiap entri boleh berupa string, atau objek { tabel, kolom } bila nama
  // kolomnya ada di lebih dari satu tabel.
  //
  // temukanKolom SENGAJA menolak menebak saat namanya ambigu, dan itu perilaku
  // yang benar: menebak berarti mengelompokkan berdasarkan kolom milik tabel
  // lain, dan hasilnya keluar tanpa error. Tapi tanpa cara menyebut tabelnya,
  // kolom seperti Cause dan ACTION yang ada di empat tabel tidak pernah bisa
  // dipakai, dan penyebab beserta tindakannya hilang dari laporan.
  const teks = Array.isArray(entri.kolomTeks) ? entri.kolomTeks : [];
  const dimTeks = [];
  for (const t of teks) {
    const nama = typeof t === "string" ? t : t?.kolom;
    if (!nama) continue;
    const tabelDisebut = typeof t === "object" ? t.tabel : null;
    const k = tabelDisebut
      ? { tabel: tabelDisebut, kolom: nama }
      : await temukanKolom(datasetId, nama);
    if (k.kolom) dimTeks.push({ nama, dax: `${tabel(k.tabel)}${kurung(k.kolom)}` });
  }

  // Penyaring nilai dimensi, misalnya membatasi peringkat OEE ke section
  // packaging saja. Nilainya dienumerasi EKSPLISIT di katalog, bukan dicocokkan
  // lewat awalan: section baru yang muncul kelak akan tersaring keluar sampai
  // ada yang sengaja menambahkannya, dan itu arah yang aman. Awalan yang
  // longgar justru diam-diam memasukkan section yang belum pernah ditinjau.
  const saring = entri.saring;
  let filterSaring = "";
  if (saring?.kolom && Array.isArray(saring.nilai) && saring.nilai.length) {
    const k = saring.tabel
      ? `${tabel(saring.tabel)}${kurung(saring.kolom)}`
      : (await temukanKolom(datasetId, saring.kolom)).kolom
        ? `${tabel((await temukanKolom(datasetId, saring.kolom)).tabel)}${kurung(saring.kolom)}`
        : "";
    if (k) {
      const daftar = saring.nilai.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(", ");
      filterSaring = `, ${k} IN {${daftar}}`;
    }
  }

  const grup = [kolomDim, ...dimTeks.map((x) => x.dax)].join(", ");
  // Nama kolom pendamping dibuat dari indeks, bukan dari nama measure-nya.
  // Nama measure memuat kurung, persen, dan spasi yang harus di-escape di DAX,
  // dan satu yang terlewat membuat seluruh query gagal 400.
  const kolomPendamping = pendamping.map((nm, i) => `, "m${i + 1}", ${kurung(nm)}`).join("");
  let sumber = `SUMMARIZECOLUMNS(${grup}, "v", ${m}${kolomPendamping})`;

  if (terpasang) {
    const kol = `${tabel(kolomTanggal.tabel)}${kurung(kolomTanggal.kolom)}`;
    // Jendela khusus dihormati di sini juga, sama seperti jalur KPI. Lembur
    // dihitung per periode cut-off tanggal 13, bukan per jendela laporan.
    // Tanpa ini, breakdown lembur memakai jendela kemarin dan hasilnya kosong
    // atau jauh lebih kecil dari yang dilihat orang di dashboard.
    const jw = jendelaUntukEntri(entri, jendela);
    const mulaiTgl = jw.mulaiTanggal || jw.tanggal;
    const selesaiTgl = jw.selesaiTanggal || jw.tanggal;
    const [y, mo, d] = String(selesaiTgl).split("-").map(Number);
    const setelah = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
    sumber = `CALCULATETABLE(${sumber}, ${kol} >= ${daxTanggal(mulaiTgl)}, ${kol} < ${daxTanggal(setelah)}${filterSaring})`;
  } else if (filterSaring) {
    // Tanpa filter tanggal, penyaringnya tetap harus terpasang.
    sumber = `CALCULATETABLE(${sumber}${filterSaring})`;
  }

  // Baris tanpa nilai dibuang SEBELUM TOPN. Tanpa itu, TOPN bisa terisi baris
  // kosong dan "tiga tertinggi" berisi dua kosong dan satu angka.
  const dax = `EVALUATE TOPN(${Number(entri.n) || 3}, FILTER(${sumber}, NOT ISBLANK([v])), [v], ${urut})`;

  try {
    const rows = await jalankanDax(datasetId, dax);

    // Kunci baris dari SUMMARIZECOLUMNS berbentuk `Tabel[Kolom]`, BUKAN
    // `[Kolom]`. Versi pertama memakai bentuk kedua dan setiap label terbaca
    // null, sementara angkanya tetap keluar. Hasilnya daftar tiga baris tanpa
    // nama mesin: terlihat berhasil, tidak berguna sama sekali.
    const baris = rows.map((r) => {
      const out = { label: r[`${dim.tabel}[${dim.kolom}]`] ?? null, value: null };
      const v = r["[v]"];
      const n = typeof v === "number" ? v : Number(v);
      out.value = Number.isFinite(n) ? n : null;
      // Pencarian kunci ABAI huruf besar-kecil.
      //
      // Execute Queries menormalkan kapitalisasi nama kolom di kunci barisnya:
      // kolom yang di metadata model bernama "ACTION" kembali sebagai
      // "Deviasi PM CMD 3[Action]". Pencocokan persis meleset, hasilnya kolom
      // teksnya selalu null, dan itu terbaca seperti datanya memang kosong
      // padahal terisi di seluruh 792 baris.
      const kunciBaris = kunciAbaiHuruf(r);
      for (const t of dimTeks) {
        const tepat = t.dax.replace(/'/g, "");
        out[t.nama] = r[tepat] ?? kunciBaris.get(tepat.toLowerCase()) ?? r[t.nama] ?? null;
      }

      // Angka pendamping dibawa dengan NAMA MEASURE-nya sebagai kunci, supaya
      // pemakainya tahu angka itu apa. Kunci "m1" saja tidak menjelaskan apa pun
      // begitu keluar dari fungsi ini.
      if (pendamping.length) {
        out.pendamping = {};
        pendamping.forEach((nm, i) => {
          const raw = r[`[m${i + 1}]`];
          const num = typeof raw === "number" ? raw : Number(raw);
          out.pendamping[nm] = Number.isFinite(num) ? num : null;
        });
      }
      return out;
    });

    // TOPN mengembalikan N baris teratas TAPI tidak menjamin urutannya, dan itu
    // memang perilaku terdokumentasi. Tanpa pengurutan di sini, daftar "tiga
    // tertinggi" keluar acak, misalnya 33,94 lalu 56,35 lalu 49,37, dan pembaca
    // menyimpulkan yang pertama paling parah.
    baris.sort((a, b) =>
      entri.arah === "terendah" ? (a.value ?? Infinity) - (b.value ?? Infinity)
        : (b.value ?? -Infinity) - (a.value ?? -Infinity)
    );

    return {
      ...dasar, baris,
      dateFilterRequested: perluFilter,
      dateFilterApplied: terpasang,
      dimensiDipakai: `${dim.tabel}[${dim.kolom}]`,
      kolomTeksDipakai: dimTeks.map((x) => x.nama),
    };
  } catch (err) {
    return {
      ...dasar, baris: [],
      dateFilterRequested: perluFilter,
      dateFilterApplied: terpasang,
      error: String(err?.response?.data?.error?.code || err.message).slice(0, 120),
    };
  }
}

/** Cache daftar nama mesin. Daftar mesin tidak berubah tiap menit. */
let cacheMesin = null;
let cacheMesinSaat = 0;

/**
 * Daftar nama mesin sebenarnya dari model.
 *
 * Dipakai mencocokkan mesin yang disebut orang di grup. Mengambil daftarnya dari
 * model lebih baik daripada menebak dari pola kata: orang menulis "Tetra Line 3"
 * sementara modelnya menyimpan "Tetra Pak Line 3 250ml", dan hanya daftar
 * sebenarnya yang bisa menjembatani keduanya tanpa mengarang.
 */
export async function daftarMesin() {
  if (cacheMesin && Date.now() - cacheMesinSaat < 6 * 60 * 60 * 1000) return cacheMesin;

  const datasetId = await resolusiDatasetId("Dashboard DT ORS");
  if (!datasetId) return [];

  try {
    const rows = await jalankanDax(
      datasetId,
      "EVALUATE SUMMARIZECOLUMNS('Dim_DBCatatan'[nama_mesin])",
      { percobaan: 2 }
    );
    cacheMesin = rows
      .map((r) => String(r["Dim_DBCatatan[nama_mesin]"] ?? "").trim())
      .filter(Boolean);
    cacheMesinSaat = Date.now();
    return cacheMesin;
  } catch {
    return cacheMesin || [];
  }
}

/**
 * Mencocokkan mesin yang disebut dalam sebuah pertanyaan.
 *
 * Skornya jumlah kata nama mesin yang muncul di pertanyaan, jadi nama terpanjang
 * yang cocok menang. Tanpa itu, "Line 3" akan cocok ke belasan mesin yang sama
 * baiknya dan pilihannya jadi sembarang.
 *
 * Kata yang terlalu umum diabaikan supaya "line" sendiri tidak menjadikan setiap
 * mesin ber-line sebagai kandidat.
 */
export async function cocokkanMesin(teks) {
  const t = String(teks || "").toLowerCase();
  if (!t.trim()) return null;

  const daftar = await daftarMesin();
  if (!daftar.length) return null;

  const potong = (x) => x.toLowerCase().split(/[\s,()\-]+/).filter(Boolean);

  // Arah pencocokan: token dari PERTANYAAN harus ada di nama mesin, bukan
  // sebaliknya.
  //
  // Versi pertama menuntut setiap kata nama mesin muncul di pertanyaan, sehingga
  // "Tetra Line 3" tidak cocok ke "Tetra Pak Line 3 250ml" hanya karena penanya
  // tidak menyebut 250ml. Orang tidak menyebut nama mesin lengkap, dan menuntut
  // itu membuat fitur ini menolak hampir semua pertanyaan yang wajar.
  const kosakata = new Set(daftar.flatMap(potong));
  const UMUM = new Set(["line", "mesin", "ml", "pak", "cmd"]);

  // Hanya token yang memang bagian dari nama mesin mana pun yang dipakai, jadi
  // kata biasa seperti "kenapa" dan "downtime" tidak ikut mempersempit.
  const tokenTanya = [...new Set(potong(t))].filter((k) => kosakata.has(k));
  const pembeda = tokenTanya.filter((k) => !UMUM.has(k));

  // Tanpa satu pun token pembeda, yang tersisa cuma kata umum seperti "line".
  // Itu tidak menunjuk mesin mana pun, jadi lebih baik menolak.
  if (!pembeda.length) return null;

  const punya = (nama, k) => {
    const kt = potong(nama);
    return /^\d+$/.test(k) ? kt.includes(k) : kt.some((x) => x.includes(k));
  };

  const kandidat = daftar.filter((nama) => tokenTanya.every((k) => punya(nama, k)));
  if (!kandidat.length) return null;

  // Skor: jumlah token pembeda yang cocok, lalu nama terpendek menang supaya
  // "Serac" tidak kalah dari "Serac Line 4 CYD 65ml" ketika penanya hanya
  // menyebut "serac".
  const skor = (nama) => pembeda.filter((k) => punya(nama, k)).length;
  const maks = Math.max(...kandidat.map(skor));
  const teratas = kandidat.filter((n) => skor(n) === maks);

  // AMBIGU BERARTI MENOLAK. "kenapa line 3 tinggi" cocok ke beberapa mesin yang
  // sama baiknya, dan memilih salah satunya berarti menjawab tentang mesin yang
  // belum tentu dimaksud. Salah mesin lebih buruk daripada minta diperjelas.
  if (teratas.length > 1) return null;

  return teratas[0];
}

/**
 * Detail downtime satu mesin, dipakai menjawab pertanyaan lanjutan di grup.
 *
 * Pertanyaan seperti "kenapa Tetra Line 3 downtime-nya tinggi, nama downtime-nya
 * apa, issue-nya apa, berapa durasinya" tidak bisa dijawab entri katalog: entri
 * mengelompokkan seluruh mesin, sementara ini menuntut SATU mesin dipecah per
 * sebab.
 *
 * Pencocokan nama mesin memakai CONTAINSSTRING, bukan sama dengan, karena orang
 * menulis "Tetra Line 3" sementara modelnya menyimpan "Tetra Pak Line 3 250ml".
 * Menuntut kecocokan persis akan menjawab "tidak ada data" untuk mesin yang
 * jelas ada, dan itu lebih buruk daripada menjawab mendekati.
 *
 * @param {object} arg
 * @param {string} arg.namaMesin  Potongan nama mesin dari pertanyaan.
 * @param {object} arg.jendela
 * @param {number} [arg.n]        Jumlah baris sebab teratas.
 */
export async function detailDowntimeMesin({ namaMesin, jendela, n = 6 }) {
  const MODEL = "Dashboard DT ORS";
  const datasetId = await resolusiDatasetId(MODEL);
  if (!datasetId) return { berhasil: false, alasan: `model ${MODEL} tidak ditemukan` };

  const cari = String(namaMesin || "").trim();
  if (cari.length < 3) return { berhasil: false, alasan: "nama mesin terlalu pendek untuk dicari" };

  const kolomTanggal = await temukanKolomTanggal(datasetId);
  const T = "'Dim_DBCatatan'";
  const mesin = `${T}[nama_mesin]`;

  // Kutip ganda di dalam nilai digandakan supaya string DAX tidak pecah. Nama
  // mesin berasal dari pesan WhatsApp, jadi ini masukan dari luar.
  const nilai = cari.replace(/"/g, '""');

  let sumber =
    // SectionDowntime, BUKAN "Nama Downtime": kolom terakhir itu milik dashboard
    // OEE, tidak ada di Dim_DBCatatan, dan memakainya membuat query gagal total
    // dengan DatasetExecuteQueriesError tanpa menyebut kolom mana yang salah.
    `SUMMARIZECOLUMNS(${T}[SectionDowntime], ${T}[Issue], ${T}[Action], ` +
    `"durasi", [(M) DT Tech in Hour], "kejadian", [(M) Downtime Freq])`;

  const filterMesin = `CONTAINSSTRING(${mesin}, "${nilai}")`;

  if (kolomTanggal?.kolom) {
    const kol = `${tabel(kolomTanggal.tabel)}${kurung(kolomTanggal.kolom)}`;
    const mulaiTgl = jendela.mulaiTanggal || jendela.tanggal;
    const selesaiTgl = jendela.selesaiTanggal || jendela.tanggal;
    const [y, mo, d] = String(selesaiTgl).split("-").map(Number);
    const setelah = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
    sumber = `CALCULATETABLE(${sumber}, FILTER(ALL(${mesin}), ${filterMesin}), ` +
      `${kol} >= ${daxTanggal(mulaiTgl)}, ${kol} < ${daxTanggal(setelah)})`;
  } else {
    sumber = `CALCULATETABLE(${sumber}, FILTER(ALL(${mesin}), ${filterMesin}))`;
  }

  const dax = `EVALUATE TOPN(${Number(n) || 6}, FILTER(${sumber}, NOT ISBLANK([durasi])), [durasi], DESC)`;

  try {
    const rows = await jalankanDax(datasetId, dax);
    const baris = rows
      .map((r) => ({
        section: r["Dim_DBCatatan[SectionDowntime]"] ?? null,
        issue: r["Dim_DBCatatan[Issue]"] ?? null,
        action: r["Dim_DBCatatan[Action]"] ?? null,
        durasi: Number(r["[durasi]"]),
        kejadian: Number(r["[kejadian]"]),
      }))
      .filter((b) => Number.isFinite(b.durasi))
      .sort((a, b) => b.durasi - a.durasi);

    return {
      berhasil: true,
      model: MODEL,
      mesinDicari: cari,
      dateFilterApplied: Boolean(kolomTanggal?.kolom),
      // Satuannya belum dipastikan pemilik, dan itu ikut dikembalikan supaya
      // penjawabnya tidak mengarang "jam" atau "menit".
      satuanDurasi: "menit atau jam, belum dipastikan",
      baris,
    };
  } catch (err) {
    return {
      berhasil: false,
      alasan: String(err?.response?.data?.error?.code || err.message).slice(0, 140),
    };
  }
}

function bacaAngka(baris, i) {
  const v = baris?.[`[m${i}]`];
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mengambil satu entri katalog.
 *
 * Dicoba sekali sebagai satu ROW berisi semua measure, karena itu satu
 * permintaan HTTP alih-alih beberapa. Kalau gagal, diulang per measure: satu
 * measure yang menolak dievaluasi tidak boleh menghilangkan measure lain di KPI
 * yang sama, dan justru varian yang gagal itu informasi berharga bagi pemilik
 * yang harus memilih varian kanonik.
 */
export async function ambilEntri(entri, jendela) {
  const datasetId = await resolusiDatasetId(entri.modelName);
  const dasar = {
    domain: entri.domain,
    kpi: entri.kpi,
    unit: entri.unit,
    status: entri.status,
    modelName: entri.modelName,
    notes: entri.notes || null,
  };

  if (!datasetId) {
    return { ...dasar, values: [], dateFilterApplied: false, error: "model tidak ditemukan di workspace" };
  }

  const kolomTanggal = await temukanKolomTanggal(datasetId);
  const diminta = perluFilterTanggal(entri);
  const terpasang = diminta && Boolean(kolomTanggal?.kolom);

  const jejakFilter = {
    dateFilterRequested: diminta,
    dateFilterApplied: terpasang,
    // Kalau filter diminta tapi tidak terpasang, angkanya BUKAN angka harian.
    // Ini harus terbaca di laporan, bukan tersembunyi di log.
    dateFilterNote: diminta
      ? terpasang
        ? `difilter ${kolomTanggal.tabel}[${kolomTanggal.kolom}] (${kolomTanggal.sumber})`
        : `TIDAK difilter tanggal: ${kolomTanggal?.sumber}. Angka bukan angka harian.`
      : "measure membawa jendela waktunya sendiri",
  };

  try {
    const rows = await jalankanDax(datasetId, bangunDax(entri, jendela, kolomTanggal));
    const baris = rows[0] || {};
    return {
      ...dasar,
      ...jejakFilter,
      values: entri.measures.map((m, i) => ({ measure: m, value: bacaAngka(baris, i) })),
    };
  } catch {
    // Jatuh ke per-measure.
    const values = [];
    for (let i = 0; i < entri.measures.length; i += 1) {
      const satu = { ...entri, measures: [entri.measures[i]] };
      try {
        const rows = await jalankanDax(datasetId, bangunDax(satu, jendela, kolomTanggal));
        values.push({ measure: entri.measures[i], value: bacaAngka(rows[0] || {}, 0) });
      } catch (err2) {
        values.push({
          measure: entri.measures[i],
          value: null,
          error: String(err2?.response?.data?.error?.code || err2.message).slice(0, 80),
        });
      }
    }
    const gagal = values.filter((v) => v.error).length;
    return {
      ...dasar,
      ...jejakFilter,
      values,
      partialFailure: gagal > 0 ? `${gagal} dari ${values.length} measure gagal dievaluasi` : undefined,
    };
  }
}

/**
 * Mengambil seluruh KPI satu domain.
 *
 * Freshness dinilai per model, bukan per domain: satu domain bisa memakai
 * beberapa model dengan jadwal refresh berbeda. Domain mewarisi keadaan
 * TERBURUK di antara modelnya, karena laporan yang menyebut datanya penuh
 * padahal salah satu modelnya baru sampai jam 17:30 akan menyesatkan.
 */
export async function ambilDomain(domain, jendela) {
  const entri = kpiDomain(domain);
  const hasil = [];
  const freshnessPerModel = new Map();

  for (const e of entri) {
    const datasetId = await resolusiDatasetId(e.modelName);
    if (datasetId && !freshnessPerModel.has(e.modelName)) {
      freshnessPerModel.set(e.modelName, await statusKesegaran(datasetId, jendela));
    }
    try {
      // Entri berdimensi dialihkan ke jalurnya sendiri. Dijalankan lewat
      // ambilEntri, ia akan memakai ROW() dan mengembalikan satu angka total
      // alih-alih daftar per mesin, tanpa error apa pun.
      hasil.push(e.jenis === "breakdown"
        ? await ambilBreakdown(e, jendela)
        : await ambilEntri(e, jendela));
    } catch (err) {
      // Jaring terakhir. ambilEntri sudah menangkap kegagalan DAX, jadi sampai
      // di sini berarti kegagalan tak terduga, dan tetap tidak boleh
      // menghentikan KPI berikutnya.
      hasil.push({
        domain, kpi: e.kpi, unit: e.unit, status: e.status, modelName: e.modelName,
        values: [], error: String(err.message).slice(0, 120),
      });
    }
  }

  const urutan = { full: 0, partial: 1, unavailable: 2 };
  let terburuk = { freshness: "full", cutoffWib: null };
  for (const f of freshnessPerModel.values()) {
    if (urutan[f.freshness] > urutan[terburuk.freshness]) terburuk = f;
  }

  return {
    domain,
    freshness: freshnessPerModel.size ? terburuk.freshness : "unavailable",
    cutoffWib: terburuk.cutoffWib || null,
    perModel: [...freshnessPerModel.entries()].map(([m, f]) => ({
      model: m, freshness: f.freshness, cutoffWib: f.cutoffWib,
    })),
    kpi: hasil,
  };
}

/** Domain unik yang dipakai katalog, dalam urutan kemunculan. */
export function domainKatalog() {
  return [...new Set(KATALOG_KPI.map((e) => e.domain))];
}

/**
 * Pembungkus per domain sesuai kontrak spec §10.
 * Tipis dengan sengaja: logikanya satu, hanya filternya berbeda.
 */
export const getYesterdayProduction = (j) => ambilDomain("production", j);
export const getYesterdayQuality = (j) => ambilDomain("quality", j);
export const getYesterdayMaintenance = (j) => ambilDomain("maintenance", j);
export const getYesterdayCost = (j) => ambilDomain("cost", j);
export const getYesterdayEnergy = (j) => ambilDomain("energy", j);
export const getYesterdayPlanning = (j) => ambilDomain("planning", j);
export const getYesterdayInventory = (j) => ambilDomain("inventory", j);
