// ─────────────────────────────────────────────────────────────────────────────
// Menyusun muatan untuk Gemini, memvalidasi keluarannya, dan menyusun pesan
// WhatsApp (spec §7, §12.1).
//
// Tiga prinsip yang menentukan bentuk berkas ini:
//
// 1. Setiap angka membawa STATUS dan SIFATNYA. 12 dari 26 KPI bukan angka
//    harian: sebagian akumulatif karena modelnya tidak punya tabel tanggal,
//    sebagian snapshot. Pembaca laporan harian menganggap semua angka di
//    dalamnya harian, jadi sifatnya harus tertulis, bukan disimpulkan.
//
// 2. Gemini TIDAK boleh menyebut angka yang tidak ada di muatan (§6). Karena itu
//    muatannya berisi angka yang sudah final, bukan data mentah untuk dihitung
//    ulang, dan instruksinya menyebut larangan itu eksplisit.
//
// 3. Kalau AI gagal, angka mentah tetap dikirim. Angka tanpa analisis masih
//    berguna; analisis tanpa angka tidak.
// ─────────────────────────────────────────────────────────────────────────────

import { sanitasiTeks } from "../utils/sanitizeText.util.js";

/** Versi prompt. Dicatat di setiap hasil supaya anomali bisa ditelusuri. */
export const PROMPT_VERSION = "v1";

/** Batas muatan sesuai §12.1. */
export const BATAS_MUATAN_BYTE = 10 * 1024;

/**
 * Batas panjang pesan yang dikirim ke grup.
 *
 * Bukan batas WhatsApp, yang jauh lebih besar, tapi batas keterbacaan. Pesan
 * pertama yang benar-benar terkirim mencapai 7234 karakter dan menjadi dinding
 * teks. Ditegakkan di validasi, bukan cuma disarankan di instruksi, karena model
 * bisa mengabaikan instruksi.
 *
 * Dikalibrasi terhadap keluaran nyata, bukan ditebak. Urutannya: 2800 menolak
 * 2929 karakter, 3800 menolak 4010, 4500 menolak 5194, dan setiap penolakan
 * membuang SELURUH analisis. Menaikkan batas terus-menerus berarti mengejar
 * sasaran yang bergerak, jadi yang diperbaiki adalah sisi lain: geminiSummary
 * meminta model MEMADATKAN ketika kepanjangan, dan itu terukur menurunkan 5194
 * menjadi 4599. Plafon 5000 memberi margin di atas hasil padatan itu.
 *
 * Yang dijaga batas ini adalah keterbacaan, bukan angka tertentu: pesan pertama
 * mencapai 7234 karakter dan menjadi dinding teks yang tidak dibaca habis. Di
 * bawah 4500, laporan berisi breakdown per CMD dengan penyebab dan tindakannya
 * masih terbaca sebagai pesan, bukan sebagai dokumen.
 */
export const BATAS_PESAN_KARAKTER = Number(process.env.SUMMARY_MAX_CHARS) || 5000;

/**
 * Section yang WAJIB ada di keluaran Gemini.
 *
 * Dipakai validasi §7.1. Pesan yang kehilangan section tidak dikirim ke grup:
 * laporan setengah jadi lebih membingungkan daripada tidak ada laporan, karena
 * pembacanya tidak tahu bagian mana yang hilang.
 */
export const SECTION_WAJIB = [
  "INTISARI",
  "PER AREA",
  "PERLU DIKONFIRMASI",
  "REKOMENDASI",
  "RISIKO",
];

const angka = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  // Dibulatkan supaya muatan tidak dipenuhi 12 desimal yang tidak dipakai
  // analisis dan hanya memakan batas 10KB.
  return Math.abs(v) >= 1000 ? Math.round(v) : Number(v.toPrecision(4));
};

/**
 * Menyusun muatan JSON untuk Gemini.
 *
 * @param {object} arg
 * @param {{tanggal?: string, mulaiTanggal?: string, selesaiTanggal?: string}} arg.jendela
 * @param {Array<object>} arg.domains  Hasil ambilDomain() per domain.
 * @param {Map<string, object>} [arg.banding]  Hasil pembanding().
 */
export function susunMuatan({ jendela, domains, banding = new Map() }) {
  const periode = jendela.mulaiTanggal
    ? { jenis: "mingguan", mulai: jendela.mulaiTanggal, selesai: jendela.selesaiTanggal }
    : { jenis: "harian", tanggal: jendela.tanggal };

  const isi = [];
  const catatanData = [];

  for (const d of domains || []) {
    const kpiList = [];

    for (const k of d.kpi || []) {
      // ── Entri berdimensi ──────────────────────────────────────────────────
      //
      // Bentuknya berbeda dari entri skalar: daftar baris berlabel, bukan satu
      // angka. Tanpa cabang ini, breakdown lolos lewat filter `nilai` yang
      // kosong lalu tercatat sebagai "tidak ada angka", padahal datanya ada.
      if (k.jenis === "breakdown") {
        const baris = (k.baris || [])
          .filter((b) => b.value !== null && b.label !== null)
          .slice(0, Math.max(1, Number(k.n) || 3))
          .map((b) => {
            const out = {
              label: sanitasiTeks(b.label, 60),
              v: angka(b.value),
              t: fmtNilai(k.measures?.[0] ?? k.kpi, angka(b.value)),
            };
            // Kolom teks WAJIB disanitasi: isinya entri operator di lapangan,
            // dan itu tepat vektor yang §12.2 lindungi. Sebelum breakdown ada,
            // belum ada satu pun teks bebas yang masuk prompt.
            for (const kolom of k.kolomTeksDipakai || []) {
              const isi = sanitasiTeks(b[kolom], 140);
              if (isi) out[kolom.toLowerCase()] = isi;
            }
            return out;
          });

        if (!baris.length) {
          catatanData.push(`${d.domain}/${k.kpi}: tidak ada baris pada periode ini`);
          continue;
        }

        kpiList.push({
          kpi: sanitasiTeks(k.kpi, 60),
          unit: k.unit,
          status: k.status,
          jenis: "breakdown",
          dikelompokkan: k.dimensi,
          arah: k.arah,
          angkaHarian: k.dateFilterApplied === true,
          sifatAngka: k.dateFilterApplied === true
            ? "periode ini"
            : "akumulatif atau snapshot, BUKAN periode ini",
          baris,
        });
        continue;
      }

      // Setiap angka dikirim DUA KALI: `v` sebagai number supaya model bisa
      // membandingkan, dan `t` sebagai teks yang sudah diformat gaya Indonesia.
      //
      // Tanpa `t`, model menulis angkanya sendiri dari JSON dan hasilnya gaya
      // Inggris: pesan yang benar-benar terkirim 2026-08-05 memuat "0.7571" dan
      // "IDR 16281993351", titik sebagai desimal dan tanpa pemisah ribuan.
      // Menyuruh model memformat lewat instruksi saja tidak bisa diandalkan;
      // memberi bentuk jadinya membuat pekerjaan itu tidak perlu ditebak.
      const nilai = (k.values || [])
        .map((v) => ({ m: v.measure, v: angka(v.value), t: fmtNilai(v.measure, angka(v.value)) }))
        .filter((v) => v.v !== null);

      // KPI tanpa satu pun angka tidak dikirim sebagai baris kosong; ia dicatat
      // sebagai keterbatasan data. Mengirim null memancing model menebak.
      if (!nilai.length) {
        catatanData.push(`${d.domain}/${k.kpi}: tidak ada angka pada periode ini`);
        continue;
      }

      const kunciBanding = `${d.domain}|${k.kpi}|${k.values[0]?.measure}`;
      const b = banding.get(kunciBanding);

      kpiList.push({
        kpi: sanitasiTeks(k.kpi, 60),
        unit: k.unit,
        status: k.status,
        // Inti prinsip 1. Nama fieldnya sengaja gamblang supaya modelnya tidak
        // perlu menafsirkan.
        angkaHarian: k.dateFilterApplied === true,
        sifatAngka: k.dateFilterApplied === true
          ? "periode ini"
          : "akumulatif atau snapshot, BUKAN periode ini",
        nilai,
        ...(b
          ? {
              banding: {
                sebelumnya: angka(b.kemarin),
                rata7: angka(b.avg7),
                hariTersedia: b.hariTersedia,
              },
            }
          : {}),
      });
    }

    isi.push({
      domain: d.domain,
      kesegaran: d.freshness,
      ...(d.cutoffWib ? { dataSampaiJam: d.cutoffWib } : {}),
      kpi: kpiList,
    });
  }

  const muatan = {
    periode,
    plant: "CMD Plant Sentul",
    promptVersion: PROMPT_VERSION,
    domains: isi,
    ...(catatanData.length ? { keterbatasanData: catatanData.slice(0, 20) } : {}),
  };

  return kecilkanSampaiBatas(muatan);
}

/**
 * Memastikan muatan di bawah batas 10KB.
 *
 * Yang dibuang lebih dulu adalah pembanding, lalu varian measure di luar dua
 * pertama, karena keduanya konteks tambahan. Angka utama dan statusnya tidak
 * pernah dibuang: itu justru isi laporannya.
 */
function kecilkanSampaiBatas(muatan) {
  const ukur = (o) => Buffer.byteLength(JSON.stringify(o), "utf8");
  if (ukur(muatan) <= BATAS_MUATAN_BYTE) return muatan;

  const salin = JSON.parse(JSON.stringify(muatan));
  const dibuang = [];

  // Tahap 1: pembanding. Konteks tambahan, bukan isi laporan.
  for (const d of salin.domains) for (const k of d.kpi) delete k.banding;
  if (ukur(salin) <= BATAS_MUATAN_BYTE) return tandaiPemangkasan(salin, ["pembanding vs kemarin dan rata 7 hari"]);

  // Tahap 2: varian measure di luar dua pertama.
  // Entri breakdown TIDAK punya `nilai`, ia punya `baris`. Versi pertama
  // memanggil k.nilai.length tanpa syarat dan melempar TypeError begitu entri
  // berdimensi masuk, sehingga seluruh muatan gagal disusun.
  let adaVarianDibuang = false;
  for (const d of salin.domains) {
    for (const k of d.kpi) {
      if (Array.isArray(k.nilai) && k.nilai.length > 2) {
        adaVarianDibuang = true;
        k.nilai = k.nilai.slice(0, 2);
      }
      // Untuk breakdown, yang dipangkas jumlah barisnya, bukan varian measure.
      if (Array.isArray(k.baris) && k.baris.length > 3) {
        adaVarianDibuang = true;
        k.baris = k.baris.slice(0, 3);
      }
    }
  }
  if (adaVarianDibuang) dibuang.push("varian measure ketiga dan seterusnya");
  if (ukur(salin) <= BATAS_MUATAN_BYTE) return tandaiPemangkasan(salin, dibuang);

  if (salin.keterbatasanData) {
    delete salin.keterbatasanData;
    dibuang.push("daftar keterbatasan data");
    if (ukur(salin) <= BATAS_MUATAN_BYTE) return tandaiPemangkasan(salin, dibuang);
  }

  // Tahap 3: buang KPI dari belakang sampai muat.
  //
  // Versi pertama berhenti di tahap 2 lalu mengembalikan muatannya apa adanya,
  // sehingga batas 10KB yang ditegakkan di kode justru dilewati: uji dengan 60
  // domain menghasilkan 195KB dan tetap lolos keluar. Batas yang tidak ditegakkan
  // sampai akhir bukan batas.
  let jumlahKpiDibuang = 0;
  for (let i = salin.domains.length - 1; i >= 0; i -= 1) {
    const d = salin.domains[i];
    while (d.kpi.length && ukur(salin) > BATAS_MUATAN_BYTE) {
      d.kpi.pop();
      jumlahKpiDibuang += 1;
    }
    // Domain yang habis KPI-nya ikut dibuang, karena domain kosong hanya
    // menambah byte tanpa menambah informasi.
    if (!d.kpi.length) salin.domains.splice(i, 1);
    if (ukur(salin) <= BATAS_MUATAN_BYTE) break;
  }
  if (jumlahKpiDibuang) dibuang.push(`${jumlahKpiDibuang} KPI dari domain terakhir`);

  return tandaiPemangkasan(salin, dibuang);
}

/**
 * Mencatat apa yang dibuang, di dalam muatannya sendiri.
 *
 * Pemangkasan tanpa catatan membuat Gemini menganalisis data yang lebih sempit
 * sambil menganggapnya lengkap, dan kesimpulannya terlihat sama otoritatifnya.
 */
function tandaiPemangkasan(muatan, dibuang) {
  if (!dibuang.length) return muatan;

  muatan.dipangkas = {
    alasan: `muatan melewati batas ${BATAS_MUATAN_BYTE} byte`,
    yangDibuang: dibuang,
  };

  // Penandanya sendiri memakan byte, jadi batasnya diperiksa ULANG sesudah
  // penanda dipasang. Versi pertama memeriksa lalu menambahkan penanda, dan
  // hasilnya 10258 byte pada batas 10240: pola yang sama seperti pemotong teks
  // yang menambahkan "[dipotong]" setelah memotong ke panjang maksimum.
  const ukur = () => Buffer.byteLength(JSON.stringify(muatan), "utf8");
  for (let i = muatan.domains.length - 1; i >= 0 && ukur() > BATAS_MUATAN_BYTE; i -= 1) {
    const d = muatan.domains[i];
    while (d.kpi.length && ukur() > BATAS_MUATAN_BYTE) d.kpi.pop();
    if (!d.kpi.length) muatan.domains.splice(i, 1);
  }

  return muatan;
}

/** Instruksi sistem untuk Gemini. */
export function instruksiSistem() {
  return [
    "Kamu konsultan manufaktur senior untuk CMD Plant Sentul, pabrik dairy.",
    "Kamu menulis ringkasan operasional untuk manajemen plant, dalam bahasa Indonesia.",
    "",
    "ATURAN YANG TIDAK BOLEH DILANGGAR:",
    "1. Hanya sebut angka yang ADA di JSON. Jangan menghitung ulang, jangan",
    "   memperkirakan, jangan menyebut angka dari ingatan.",
    "2. KPI dengan angkaHarian bernilai false BUKAN angka periode ini. Jangan",
    "   pernah menyebutnya sebagai capaian periode ini. Kalau dipakai, sebut",
    "   bahwa angkanya akumulatif atau snapshot.",
    "3. KPI berstatus blocked punya beberapa varian measure yang bersaing dan",
    "   belum ada yang disahkan. Kalau menyebutnya, sebut bahwa angkanya masih",
    "   perlu dikonfirmasi, dan jangan memilih satu varian sebagai yang benar.",
    "4. Kalau banding.hariTersedia kurang dari 5, tulis 'Bukti belum cukup untuk",
    "   [nama metrik]' alih-alih menyimpulkan tren. Sebut metriknya, jangan",
    "   membuat catatan umum di akhir.",
    "5. Kalau kesegaran domain bernilai partial, sebut dataSampaiJam saat",
    "   membahas domain itu.",
    "6. Jangan memakai emoji. Jangan memakai tanda pisah panjang.",
    "7. Tulis angka PERSIS seperti field `t`. Field itu sudah berformat Indonesia",
    "   DAN sudah membawa tanda persen bila memang persentase. Jangan menghitung",
    "   ulang, jangan menambah atau membuang tanda persen. Menulis 0,132 untuk",
    "   sesuatu yang field t sebut 13,2% membuat pembacanya menyimpulkan capaian",
    "   nol koma sesuatu, bukan tiga belas persen.",
    "8. Angka dengan angkaHarian false TIDAK BOLEH muncul di section REKOMENDASI",
    "   maupun RISIKO. Tempatnya hanya di PERLU DIKONFIRMASI. Angka akumulatif",
    "   di section risiko terbaca sebagai kerugian periode ini, dan itu salah.",
    "9. Pakai kata periode yang diberikan di `periode`. Kalau jenisnya mingguan,",
    "   JANGAN menulis harian, semalam, atau hari ini untuk angka mingguan.",
    "10. Padat. Maksimum 2 kalimat per domain di ANALISIS, maksimum 5 butir",
    "    REKOMENDASI, dan seluruh pesan di bawah 3500 karakter. Pesan 7000",
    "    karakter tidak dibaca sampai habis oleh siapa pun di WhatsApp.",
    "11. Untuk KPI berjenis breakdown, sebut nama barisnya beserta angkanya, dan",
    "    kalau ada field issue atau action, pakai keduanya untuk MENJELASKAN",
    "    penyebab dan tindakan yang sudah diambil. Itu inti analisisnya.",
    "",
    "SUSUNAN KELUARAN. Pakai penanda tebal WhatsApp dan urutan ini persis.",
    "Berjenjang, bukan paragraf panjang: pembacanya manajemen yang membaca di",
    "ponsel sambil berjalan ke morning meeting.",
    "",
    "*RINGKASAN OPERASIONAL*  periode dan plant, satu baris.",
    "",
    "*INTISARI*  tiga baris berawalan tanda hubung, satu baris satu hal paling",
    "penting. Ini yang dibaca kalau tidak ada waktu membaca sisanya, jadi tulis",
    "kesimpulan, bukan pengantar.",
    "",
    "*PER AREA*  satu baris per domain, berawalan tanda hubung, berbentuk:",
    "- Nama area (data s.d. jam HH:MM bila ada): angka kunci, lalu sebab singkat.",
    "Lewati area yang tidak punya angka, jangan menulis baris kosong untuknya.",
    "",
    "*MESIN DAN CMD YANG PERLU DILIHAT*  diambil dari KPI berjenis breakdown:",
    "- Nama mesin atau CMD: angka, issue, lalu action bila ada.",
    "Maksimum 5 baris, urut dari terparah. Bagian inilah yang menjawab KENAPA",
    "angka OEE dan downtime seperti itu, jadi issue dan action wajib ikut bila ada.",
    "",
    "*PERLU DIKONFIRMASI*  maksimum 4 baris. Angka berstatus blocked atau",
    "needs_confirmation, dan angka yang angkaHarian bernilai false. Sebut singkat",
    "apa yang perlu dipastikan.",
    "",
    "*REKOMENDASI*  maksimum 4 butir berawalan tanda hubung, masing-masing",
    "tindakan KONKRET yang bisa dikerjakan hari ini, bukan saran umum seperti",
    "tingkatkan pengawasan.",
    "",
    "*RISIKO*  maksimum 3 butir. Risiko operasional hari ini, bukan pengulangan",
    "analisis di atas.",
  ].join("\n");
}

/**
 * Validasi keluaran Gemini sebelum dikirim (§7.1).
 *
 * @returns {{lolos: boolean, catatan: string|null}}
 */
export function validasiKeluaran(teks) {
  const t = String(teks || "").trim();

  if (!t) return { lolos: false, catatan: "keluaran kosong" };
  if (t.length < 200) return { lolos: false, catatan: `keluaran terlalu pendek: ${t.length} karakter` };

  // Dicari sebagai HEADER, bukan substring.
  //
  // Versi pertama mencari `t.toUpperCase().includes("RISIKO")`, dan itu lolos
  // untuk keluaran yang menyebut "risiko berhenti lini" di prosa tapi tidak
  // punya section RISIKO sama sekali. Pesan yang kehilangan section justru lolos
  // validasi, yang membuat validasinya tidak berguna.
  //
  // Header WhatsApp berbentuk *NAMA*, dan diizinkan ada kata tambahan sesudahnya
  // pada baris yang sama.
  const hilang = SECTION_WAJIB.filter(
    (s) => !new RegExp(`(^|\\n)\\s*\\*\\s*${s}\\b[^\\n]*\\*`, "i").test(t)
  );
  if (hilang.length) return { lolos: false, catatan: `section hilang: ${hilang.join(", ")}` };

  // Emoji dan tanda pisah panjang dilarang di seluruh CODE, dan pesan ini juga
  // dibaca manusia. Model bisa mengabaikan instruksi, jadi diperiksa di sini.
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) {
    return { lolos: false, catatan: "keluaran memuat emoji" };
  }

  // Instruksi saja tidak menahan panjang: pesan yang benar-benar terkirim
  // 2026-08-05 mencapai 7234 karakter. Batas ini ditegakkan, bukan disarankan,
  // supaya model yang mengabaikan instruksi tidak lolos ke grup.
  if (t.length > BATAS_PESAN_KARAKTER) {
    return { lolos: false, catatan: `keluaran terlalu panjang: ${t.length} karakter, batas ${BATAS_PESAN_KARAKTER}` };
  }

  // Angka bergaya Inggris menandakan model menulis dari field `v`, bukan `t`.
  //
  // Polanya sengaja SEMPIT: titik diikuti EMPAT digit atau lebih, plus deretan
  // tujuh digit tanpa pemisah. Versi pertama memakai tiga digit atau lebih dan
  // itu salah tuduh pada pemisah ribuan Indonesia, karena 16.281.993.351 memang
  // berbentuk titik diikuti tiga digit. Penjaga yang menolak keluaran yang benar
  // akan membuat setiap laporan jatuh ke pesan cadangan.
  if (/\d\.\d{4,}/.test(t) || /\b\d{7,}\b/.test(t)) {
    return {
      lolos: false,
      catatan: "keluaran memuat angka bergaya Inggris, seharusnya memakai field t",
    };
  }

  return { lolos: true, catatan: null };
}

/**
 * Nomor dengan pemisah ribuan Indonesia, ketelitian menyesuaikan besarnya.
 *
 * Dua desimal tetap akan membulatkan OEE 0,697 menjadi 0,7 dan menghilangkan
 * justru bagian yang dilihat orang: banyak KPI di sini berbentuk rasio antara 0
 * dan 1. Sebaliknya, biaya 16 miliar tidak butuh desimal sama sekali.
 */
const fmt = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const desimal = Math.abs(v) < 10 ? 3 : Math.abs(v) < 1000 ? 2 : 0;
  return v.toLocaleString("id-ID", { maximumFractionDigits: desimal });
};

/**
 * Apakah sebuah measure menyatakan persentase.
 *
 * Ditentukan dari NAMA MEASURE-nya, bukan dari satuan KPI-nya, karena satu KPI
 * bisa mencampur keduanya: entri "Total downtime dan rasionya" memuat
 * `Total Downtime` yang berjam dan `Persentase Downtime (%)` yang berasio.
 * Memakai satuan KPI akan mengubah 11,4 jam menjadi 1.140%.
 */
const measurePersen = (nama) => /%|persen|percentage/i.test(String(nama || ""));

/**
 * Batas aman pengali rasio ke persen.
 *
 * Seluruh measure persen yang terukur mengembalikan RASIO: OEE 0,697, Technical
 * DT 0,032, % Efis 0,164, akurasi PO 0,211, OTIR 0,988, IC_OK 0,17 dan 0,879,
 * % Losses Packing 0,001. Tapi ada juga measure bernama persen yang sudah dalam
 * poin persen, misalnya akurasi PO tanpa filter tanggal mengembalikan 14,015.
 * Mengalikannya akan menghasilkan 1.401,5% dan itu jelas salah.
 *
 * Karena itu pengalian hanya dilakukan bila nilainya di bawah batas ini. Nilai
 * di atasnya dianggap sudah dalam poin persen dan hanya diberi tanda %.
 */
const BATAS_RASIO = 1.5;

/**
 * Teks tampilan sebuah nilai, sadar satuan.
 *
 * Inilah yang memperbaiki keluhan nyata: laporan menulis "akurasi PO 0,132"
 * padahal maksudnya 13,2%. Angka rasio tanpa tanda persen membuat pembaca
 * menyimpulkan capaian nol koma sesuatu, bukan tiga belas persen.
 */
export function fmtNilai(namaMeasure, v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);

  if (measurePersen(namaMeasure)) {
    const persen = Math.abs(v) <= BATAS_RASIO ? v * 100 : v;
    const desimal = Math.abs(persen) < 10 ? 1 : Math.abs(persen) < 100 ? 1 : 0;
    return `${persen.toLocaleString("id-ID", { maximumFractionDigits: desimal })}%`;
  }

  return fmt(v);
}

function judulPeriode(jendela) {
  return jendela.mulaiTanggal
    ? `${jendela.mulaiTanggal} sampai ${jendela.selesaiTanggal}`
    : jendela.tanggal;
}

/**
 * Pesan cadangan: angka mentah tanpa analisis AI.
 *
 * Dipakai ketika Gemini gagal atau keluarannya tidak lolos validasi. Angka tanpa
 * analisis masih berguna; analisis tanpa angka tidak.
 */
export function pesanCadangan({ jendela, domains, alasan }) {
  const baris = [
    "*RINGKASAN OPERASIONAL*",
    `Periode ${judulPeriode(jendela)}, CMD Plant Sentul`,
    "",
    "Analisis AI tidak tersedia kali ini, jadi berikut angkanya apa adanya.",
    `Sebab: ${sanitasiTeks(alasan, 120)}`,
    "",
  ];

  for (const d of domains || []) {
    const isiKpi = (d.kpi || []).filter((k) => (k.values || []).some((v) => v.value !== null));
    if (!isiKpi.length) continue;

    baris.push(`*${d.domain.toUpperCase()}*${d.cutoffWib ? ` (data sampai ${d.cutoffWib})` : ""}`);
    for (const k of isiKpi) {
      const nilai = (k.values || [])
        .filter((v) => v.value !== null)
        .slice(0, 3)
        .map((v) => `${v.measure}: ${fmtNilai(v.measure, v.value)}`)
        .join(", ");
      // Penanda sifat angka ikut, karena tanpanya angka akumulatif akan terbaca
      // sebagai capaian periode ini.
      const tanda = k.dateFilterApplied === true ? "" : " [akumulatif]";
      const st = k.status === "confirmed" ? "" : ` [${k.status}]`;
      baris.push(`${k.kpi}${tanda}${st}: ${nilai} ${k.unit}`);
    }
    baris.push("");
  }

  baris.push("*PERLU DIKONFIRMASI*");
  baris.push("Angka bertanda akumulatif bukan capaian periode ini.");
  baris.push("Angka bertanda blocked punya beberapa versi measure yang belum disahkan.");

  return baris.join("\n");
}

/** Catatan kaki yang ditempel ke pesan hasil AI. */
export function catatanKaki({ modelVersion, jendela, adaAkumulatif }) {
  const b = [
    "",
    `_Dibuat otomatis oleh CODE untuk periode ${judulPeriode(jendela)}._`,
    `_Model ${modelVersion}, prompt ${PROMPT_VERSION}._`,
  ];
  if (adaAkumulatif) {
    b.push("_Sebagian angka bersifat akumulatif atau snapshot, bukan capaian periode ini._");
  }
  return b.join("\n");
}
