// ─────────────────────────────────────────────────────────────────────────────
// Katalog KPI untuk executive summary harian.
//
// Deklaratif, bukan satu fungsi per domain. Spec §8 dan §10 meminta
// getYesterdayProduction(), getYesterdayQuality(), dan seterusnya; ditulis
// sebagai fungsi terpisah, 30-an KPI lintas 13 model akan melahirkan DAX
// berulang yang dilarang §17. Pembungkus per domain tetap ada di bawah.
//
// ATURAN YANG TIDAK BISA DILANGGAR
//
// 1. Setiap measure di sini WAJIB terbukti dirender di visual dashboard.
//    Dari 1666 nama measure di 25 model, hanya 337 (20,2%) yang benar-benar
//    tampil di visual. Empat dari lima measure tidak pernah dipakai, banyak di
//    antaranya sisa percobaan DAX. Uji kpi-catalog menegakkan aturan ini
//    terhadap tabel visual_field_usage, jadi nama yang tidak terbukti akan
//    menggagalkan suite, bukan diam-diam menghasilkan angka.
//
// 2. `dateLogic` WAJIB ada. Tidak ada nilai bawaan, karena logika filter
//    tanggal berbeda antar model dan menyeragamkannya akan menghasilkan angka
//    salah tanpa error (spec §2 risiko nomor 4).
//
// 3. KPI dengan beberapa varian bersaing menyimpan SEMUANYA di `measures`.
//    Tidak ada satu varian yang dipilih diam-diam. Pemilik dan timnya yang
//    menilai mana yang kanonik, dan itu baru mungkin kalau angka tiap varian
//    terlihat berdampingan di data nyata.
//
// CATATAN NAMA YANG TERLIHAT ANEH TAPI MEMANG BENAR
//
// Beberapa nama di bawah jelas salah tulis atau menandai dirinya salah:
// "Avg Cycle time total slh" (slh = salah), "(SUM) Downtimw", dan
// "Org DT (%) last month bner" (bner = benar). Nama-nama itulah yang dirender
// di visual. Memilih varian yang namanya lebih rapi berarti memilih measure
// yang TIDAK dipakai dashboard, dan angkanya akan berbeda dari yang dilihat
// orang di layar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {"confirmed"|"needs_confirmation"|"blocked"} StatusKpi
 *
 * confirmed          arti dan formulanya jelas, aman dipakai
 * needs_confirmation arti masuk akal tapi formulanya belum disahkan pemilik
 * blocked            beberapa varian bersaing, belum ada yang kanonik
 */

/**
 * @typedef {object} EntriKpi
 * @property {string}     domain     production | quality | maintenance | energy | cost | inventory | planning
 * @property {string}     kpi        Nama yang dibaca manusia di laporan.
 * @property {string}     modelName  Nama semantic model. Diresolusi ke GUID saat runtime.
 * @property {string[]}   measures   Nama measure sebenarnya. Lebih dari satu berarti varian bersaing.
 * @property {string}     unit
 * @property {StatusKpi}  status
 * @property {string}     dateLogic  Asumsi filter tanggal. WAJIB.
 * @property {string} [notes]
 */

/** @type {EntriKpi[]} */
export const KATALOG_KPI = [
  // ── Production ────────────────────────────────────────────────────────────
  {
    domain: "production",
    kpi: "OEE",
    modelName: "Dashboard Daily Meeting untuk OEE",
    measures: ["OEE (%)", "1-Final OEE (%)"],
    unit: "%",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, hasil harian 0,697.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal lewat tabel tanggal yang ditandai model, cutoff harian biasa",
    notes:
      "Dua varian, KEDUANYA dirender di visual. Registry mencatat blok OEE di model ini " +
      "disalin ke Dashboard PPIC dan Data Room Service Level, bukan berbagi sumber, jadi " +
      "angkanya bisa berbeda antar dashboard untuk hari yang sama. Formula " +
      "Availability x Performance x Quality tidak terlihat dari struktur.",
  },
  {
    domain: "production",
    kpi: "Downtime menurut kategori sebab",
    modelName: "Dashboard Daily Meeting untuk OEE",
    measures: [
      "Technical DT (%)", "Operasional DT (%)", "Org DT (%)", "Planned Stoppages DT (%)",
      "1-Final technical dt (%)", "1-Final Operasional/routine DT (%)", "1-Final Org DT (%)",
    ],
    unit: "%",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, hasil harian tersedia.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tabel tanggal model, cutoff harian biasa",
    notes:
      "Dua set lengkap dirender berdampingan, biasa dan berawalan 1-Final. Definisi " +
      "kategori Organizational versus Operational tidak terlihat dari struktur.",
  },
  {
    domain: "production",
    kpi: "Jumlah kejadian dan durasi downtime",
    modelName: "Dashboard Daily Meeting untuk OEE",
    measures: ["Jumlah Kejadian DT", "Total DT Hours", "Avg DT Duration (min)"],
    unit: "kejadian, jam, menit",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // MENGABAIKAN filter tanggal: nilainya 665.686 dengan maupun tanpa filter, jadi tidak bisa jadi angka harian.
    filterTanggal: false,
    harian: false,
    dateLogic: "measure membawa jendela waktunya sendiri",
    notes:
      "Angka AKUMULATIF sepanjang data, bukan harian: measure ini mengabaikan " +
      "filter tanggal, nilainya 665.686 kejadian dengan maupun tanpa filter. " +
      "Dipakai sebagai konteks skala, dan laporan wajib menyebutnya akumulatif " +
      "supaya tidak terbaca sebagai kejadian semalam. ",
  },
  {
    domain: "production",
    kpi: "Output dan input produksi",
    modelName: "Dashboard Efis & Losses",
    measures: ["(sum) Output", "(sum) Input"],
    unit: "pcs",
    status: "confirmed",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Model Efis & Losses tidak punya tabel tanggal, angkanya akumulatif.
    filterTanggal: false,
    harian: false,
    dateLogic: "TIDAK bisa difilter tanggal: model ini tidak punya tabel tanggal, angkanya akumulatif",
    notes:
      "Registry menyebut KPI ini Total Output/Total Input, tetapi nama yang dirender di " +
      "visual adalah (sum) Output dan (sum) Input. Measure bernama Total Input tidak " +
      "pernah tampil di visual mana pun.",
  },
  {
    domain: "production",
    kpi: "Efisiensi material",
    modelName: "Dashboard Efis & Losses",
    measures: ["% Efis", "Target Efis"],
    unit: "%",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Model Efis & Losses tidak punya tabel tanggal.
    filterTanggal: false,
    harian: false,
    dateLogic: "TIDAK bisa difilter tanggal: model ini tidak punya tabel tanggal, angkanya akumulatif",
    notes: "Formula belum jelas: output dibagi input, atau output dibagi standar.",
  },

  // ── Quality ───────────────────────────────────────────────────────────────
  {
    domain: "quality",
    kpi: "Jumlah NC",
    modelName: "Dashboard NC dan Deviasi",
    measures: ["Jumlah NC", "Jumlah NC (ALL)", "Jumlah NC CMD 1", "Jumlah NC CMD 2"],
    unit: "kejadian",
    status: "confirmed",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal; null berarti tidak ada NC pada hari itu, bukan kegagalan.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian NC, cutoff harian biasa",
    notes:
      "Varian ALL dan per-CMD dipertahankan semuanya: laporan harian butuh total, " +
      "dan pemisahan per plant yang menunjukkan sumber kenaikannya.",
  },
  {
    domain: "quality",
    kpi: "Jumlah Deviasi",
    modelName: "Dashboard NC dan Deviasi",
    measures: ["Jumlah deviasi", "Jumlah Deviasi (ALL)", "Jumlah Deviasi RMPM", "Jumlah Deviasi PM"],
    unit: "kejadian",
    status: "confirmed",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, hasil harian 9.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian deviasi, cutoff harian biasa",
  },
  {
    domain: "quality",
    kpi: "NC berulang",
    modelName: "Repetitive NC",
    measures: ["Jumlah NC CMD 1", "Jumlah NC CMD 2", "Jumlah NC CMD 3", "% FU PA Monthly"],
    unit: "kejadian, %",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tapi semantiknya bulanan, dipakai sebagai konteks recurring.
    filterTanggal: true,
    harian: false,
    dateLogic: "model berorientasi bulanan, bukan harian. Angka harian bisa tidak berarti",
    notes:
      "% FU PA Monthly bersatuan bulanan. Dipakai sebagai konteks recurring problem " +
      "(spec §6), bukan sebagai angka harian.",
  },

  // ── Maintenance ───────────────────────────────────────────────────────────
  {
    domain: "maintenance",
    kpi: "MTBF",
    modelName: "Maintenance Downtime",
    measures: ["MTBF", "MTBF U"],
    unit: "jam",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, harian 3,63 versus akumulatif 1,40.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian downtime, cutoff harian biasa",
    notes: "Dua varian, keduanya dirender. Arti akhiran U belum jelas.",
  },
  {
    domain: "maintenance",
    kpi: "Total downtime dan rasionya",
    modelName: "Maintenance Downtime",
    measures: ["Total Downtime", "Persentase Downtime (%)", "(SUM) Downtimw", "Total Used Time UT"],
    unit: "jam, %",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, harian 11,4 jam versus akumulatif 28.529.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian downtime, cutoff harian biasa",
    notes:
      "(SUM) Downtimw memang salah tulis dan memang dirender di visual. Penyebut " +
      "Persentase Downtime, waktu kalender atau planned run time, belum jelas.",
  },
  {
    domain: "maintenance",
    kpi: "Frekuensi kejadian",
    modelName: "Maintenance Downtime",
    measures: ["Jumlah Kejadian", "Kejadian"],
    unit: "kejadian",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, harian 97 versus akumulatif 310.522.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian downtime, cutoff harian biasa",
    notes: "Dua measure berbeda dengan arti yang tampak sama, keduanya dirender.",
  },

  // ── Cost ──────────────────────────────────────────────────────────────────
  {
    domain: "cost",
    kpi: "Losses RM dan nilainya",
    modelName: "Dashboard Efis & Losses",
    measures: ["Losses RM (IDR)", "Avg RM Losses", "IDR Losses (Mio)", "Total IDR (Mio)"],
    unit: "IDR",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Model Efis & Losses tidak punya tabel tanggal, angkanya akumulatif.
    filterTanggal: false,
    harian: false,
    dateLogic: "TIDAK bisa difilter tanggal: model ini tidak punya tabel tanggal, angkanya akumulatif",
    notes: "Skala Mio diasumsikan juta IDR; tidak ada di metadata model.",
  },
  {
    domain: "cost",
    kpi: "Rasio losses",
    modelName: "Dashboard Efis & Losses",
    measures: ["% Losses Packing", "% Losses Process", "Losses % of Usage", "%Losses", "(M) % Losses"],
    unit: "%",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Model Efis & Losses tidak punya tabel tanggal.
    filterTanggal: false,
    harian: false,
    dateLogic: "TIDAK bisa difilter tanggal: model ini tidak punya tabel tanggal, angkanya akumulatif",
    notes:
      "LIMA rasio berbeda, semuanya dirender di visual, dan penyebutnya berbeda " +
      "sehingga tidak bisa saling menggantikan. Ini contoh paling jelas kenapa varian " +
      "disajikan berdampingan alih-alih dipilih satu.",
  },
  {
    domain: "cost",
    kpi: "Biaya lembur",
    modelName: "Dashboard Lembur Plant",
    // DUA measure disengaja disandingkan, BUKAN dipilih satu. Diukur langsung
    // 2026-08-12: keduanya menghitung hal yang konsep sama dari tabel yang
    // berbeda dan bisa berbeda angka.
    //   - "Biaya Yang dibayar (cost)" hidup di HRGA_Gform(True) Gabungan All,
    //     yaitu tabel FORM ISIAN MENTAH sebelum diverifikasi HRGA. Ini estimasi.
    //   - "(all) biaya yang dibayar (akhir)" hidup di HRGA_Hslakhir, tabel HASIL
    //     AKHIR setelah proses verifikasi. Ini yang final.
    // Menyandingkan keduanya, bukan menimpa satu ke yang lain, karena selisihnya
    // sendiri adalah informasi: kalau jauh berbeda, ada form yang belum
    // diverifikasi atau ditolak, dan itu layak diketahui manajemen.
    measures: ["Biaya Yang dibayar (cost)", "(all) biaya yang dibayar (akhir)"],
    unit: "IDR",
    status: "confirmed",
    // Perilaku tanggal DIUKUR 2026-08-04 dan 2026-08-12: model tidak punya SATU
    // tabel tanggal yang ditandai jelas untuk auto-deteksi (temukanKolomTanggal
    // sengaja tidak menebak kolom tanggal yang menempel di tabel fakta), walau
    // kedua tabel fakta di atas SEBENARNYA punya kolom tanggal sendiri
    // ("Tanggal Lembur (Bulan/Tanggal/Tahun)" di Gform, "Tanggal" di Hslakhir).
    // Sampai ada override tanggal eksplisit per entri (belum ada di kode),
    // angka ini tetap dilaporkan sebagai akumulatif, BUKAN karena datanya
    // memang tidak bisa difilter harian.
    filterTanggal: false,
    harian: false,
    dateLogic:
      "belum difilter tanggal: detektor otomatis tidak menandai satu tabel tanggal, " +
      "walau kolom tanggalnya ada di kedua tabel fakta. Butuh override eksplisit " +
      "untuk jadi harian, lihat catatan di atas.",
    notes:
      "PENTING untuk pembacaan laporan: model ini refresh pagi pertamanya 08:30, jadi " +
      "pada job 06:15 datanya hanya sampai 17:30 hari sebelumnya. Jam lembur justru " +
      "bertambah malam, sehingga angka ini sistematis lebih rendah dari kenyataan dan " +
      "WAJIB disertai jam batasnya. Sebut measure pertama sebagai ESTIMASI (form " +
      "mentah, belum diverifikasi) dan measure kedua sebagai HASIL AKHIR " +
      "(terverifikasi HRGA) — jangan menyebut salah satunya sebagai satu-satunya angka benar.",
  },
  {
    domain: "cost",
    kpi: "Jam lembur",
    // Lembur dihitung per periode cut-off, 13 bulan sebelumnya sampai 12 bulan
    // berjalan, dan capaiannya AKUMULASI sejak awal cut-off bukan angka satu
    // minggu. Aturan pemilik 2026-08-06.
    jendelaKhusus: "lembur",
    modelName: "Dashboard Overtime",
    measures: ["Total Jam Lembur"],
    unit: "jam",
    status: "confirmed",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal lembur, cutoff harian biasa",
    notes: "Refresh 07:00, 13:00, 17:00. Sama seperti biaya lembur, cakupannya sampai 17:00.",
  },

  // ── Energy ────────────────────────────────────────────────────────────────
  {
    domain: "energy",
    kpi: "Pemakaian air",
    modelName: "Dashboard Utility (Energy)",
    measures: ["Usage W total (m3)", "Usage W CMD 1 (m3)", "Usage W CMD 2 (m3)", "Usage W CMD 3 (m3)"],
    unit: "m3",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal pencatatan meter, cutoff harian biasa",
    notes:
      "Set duplikat berawalan Nw (New) juga dirender, misalnya Nw Usage W CMD 3 (m3). " +
      "Mana yang berlaku belum disahkan pemilik.",
  },
  {
    domain: "energy",
    kpi: "Pemakaian air versi Nw",
    modelName: "Dashboard Utility (Energy)",
    measures: ["Nw Usage Utility 1 (m3)", "Nw Usage W CMD 3 (m3)", "Nw Ratio W CMD 3 (liter)"],
    unit: "m3, liter",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal pencatatan meter, cutoff harian biasa",
    notes: "Disajikan terpisah supaya selisihnya terhadap set non-Nw terlihat.",
  },
  {
    domain: "energy",
    kpi: "Rasio standar utilitas",
    modelName: "Dashboard Utility (Energy)",
    measures: ["Rasio standar Listrik", "Rasio Standar Air", "Rasio standar gas", "Nw Standar Water"],
    unit: "rasio",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Nilai standar, bukan pengukuran harian.
    filterTanggal: false,
    harian: false,
    dateLogic: "nilai standar, tidak difilter tanggal",
    notes:
      "Nilai STANDAR yang ditetapkan, bukan pengukuran harian. Dipakai sebagai " +
      "pembanding terhadap pemakaian nyata, bukan sebagai angka yang naik " +
      "turun tiap hari. ",
  },
  {
    domain: "energy",
    kpi: "Steam",
    modelName: "Dashboard Utility (Energy)",
    measures: ["Out Steam (ton)", "Pemakaian Steam per jam (ton/jam)"],
    unit: "ton, ton/jam",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal pencatatan meter, cutoff harian biasa",
  },

  // ── Planning ──────────────────────────────────────────────────────────────
  {
    domain: "planning",
    kpi: "Akurasi PO dan Forecast",
    modelName: "Dashboard PPIC",
    measures: ["Persentase akurasi PO", "Persentase akurasi FC"],
    unit: "%",
    status: "confirmed",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, harian 0,211 versus akumulatif 14,0.
    filterTanggal: true,
    harian: true,
    dateLogic: "model berorientasi periode perencanaan, bukan harian",
    notes: "Toleransi bandnya masih perlu pengesahan pemilik.",
  },
  {
    domain: "planning",
    kpi: "OTIR dan OTR",
    modelName: "Dashboard PPIC",
    measures: ["(M) % OTIR Total Only (ctn)", "(M) % OTR Total Only (ctn)"],
    unit: "%",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, tapi logika flag kategorikal §2.4 belum diverifikasi.
    filterTanggal: true,
    harian: true,
    dateLogic:
      "TIDAK memakai cutoff tanggal biasa. Spec §2.4 menyebut OTIR memakai flag " +
      "transaksi kategorikal. Belum diverifikasi ke struktur model, jadi angka harian " +
      "OTIR belum boleh dipakai sebelum logikanya dipastikan",
    notes: "Perbedaan OTIR versus OTR belum jelas secara struktural.",
  },
  {
    domain: "planning",
    kpi: "Cycle time truk",
    modelName: "Dashboard Cycle Time",
    measures: [
      "Avg Cycle time total slh", "Avg Unloading Time",
      "Avg Waiting GR Time", "Avg Waiting Truck Out Time", "Total Kedatangan",
    ],
    unit: "menit, kedatangan",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Merespons filter tanggal, harian 0,63.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kedatangan truk, cutoff harian biasa",
    notes:
      "Avg Cycle time total slh adalah satu-satunya measure cycle time total yang " +
      "dirender di visual, dan slh berarti salah. Angkanya sama dengan yang dilihat " +
      "orang di dashboard, tapi namanya sendiri menyatakan measure ini keliru. Harus " +
      "diputuskan pemilik sebelum masuk laporan eksekutif.",
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  {
    domain: "inventory",
    kpi: "Klasifikasi kesehatan stok, versi realtime",
    modelName: "Dashboard Inventory Control",
    measures: [
      "(RT) IC_OK_Percentage", "(RT) IC_Overstock_Percentage",
      "(RT) IC_Shortage_Percentage", "(RT) IC_OutOfStock_Percentage",
      "(RT) IC_DeadStock_Percentage",
    ],
    unit: "%",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Snapshot realtime, mengabaikan filter tanggal.
    filterTanggal: false,
    harian: false,
    dateLogic: "measure realtime, tidak difilter tanggal",
    notes: "Set HIST dengan arti setara juga dirender. Lihat entri berikutnya.",
  },
  {
    domain: "inventory",
    kpi: "Klasifikasi kesehatan stok, versi historis",
    modelName: "Dashboard Inventory Control",
    measures: [
      "(HIST) IC_OK_Percentage NEW", "(HIST) IC_Overstock_Percentage NEW",
      "(HIST) IC_Shortage_Percentage NEW", "(HIST) IC_OutofStock_Percentage NEW",
      "(HIST) IC_Dead Stock_Percentage NEW",
    ],
    unit: "%",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // MENGABAIKAN filter tanggal walau bernama HIST, nilainya sama dengan dan tanpa filter.
    filterTanggal: false,
    harian: false,
    dateLogic: "MENGABAIKAN filter tanggal walau bernama HIST, terukur sama dengan dan tanpa filter",
    notes:
      "Dua set, RT dan HIST, keduanya dirender di dashboard yang sama. Menyajikan " +
      "keduanya membuat selisihnya terlihat, dan itu yang dibutuhkan untuk memilih.",
  },
  {
    domain: "inventory",
    kpi: "Nilai stok bermasalah",
    modelName: "Dashboard Inventory Control",
    measures: ["IC_Shortage_Value NEW", "IC_Overstock_Value NEW", "IC_OutofStock_Value NEW"],
    unit: "IDR",
    status: "needs_confirmation",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Mengabaikan filter tanggal, nilainya snapshot.
    filterTanggal: false,
    harian: false,
    dateLogic: "mengabaikan filter tanggal, nilainya snapshot saat model terakhir refresh",
    notes:
      "Nilai SNAPSHOT saat model terakhir refresh, bukan perubahan harian. " +
      "Measure ini mengabaikan filter tanggal, nilainya sama dengan dan " +
      "tanpa filter. ",
  },
  {
    domain: "inventory",
    kpi: "Coverage stok",
    modelName: "Dashboard Inventory Control",
    measures: ["Coverage V2", "(Hist) Coverage V2"],
    unit: "hari",
    status: "blocked",
    // Perilaku tanggal DIUKUR 2026-08-04, bukan ditebak dari prosa registry:
    // Mengabaikan filter tanggal, dan nilainya null di kedua cara.
    filterTanggal: false,
    harian: false,
    dateLogic: "mengabaikan filter tanggal, dan nilainya null di kedua cara",
    notes:
      "Kamus KPI menyebut IC_DOI OHS punya 4 varian, tetapi tidak satu pun dirender " +
      "di visual. Yang dirender adalah Coverage V2, jadi itulah yang dipakai.",
  },
  // ── Quality per CMD ───────────────────────────────────────────────────────
  //
  // Pemisahan per CMD di sini TIDAK butuh query berdimensi: modelnya sudah
  // menyediakan measure terpisah per CMD, dan semuanya terbukti dirender di page
  // Non Conformance CMD1 sampai CMD3 serta Deviasi RMPM CMD1 sampai CMD3.
  //
  // Perlu dicatat sebagai keterbatasan nyata, bukan kelalaian: untuk hitungan NC
  // dan Deviasi, hanya CMD 1 dan CMD 2 yang punya measure yang dirender. CMD 3
  // hanya tersedia dalam bentuk total per kategori, jadi dipisah ke entri
  // sendiri di bawah alih-alih dipaksa masuk satu baris.
  {
    domain: "quality",
    kpi: "Jumlah NC per CMD",
    modelName: "Dashboard NC dan Deviasi",
    measures: ["Jumlah NC CMD 1", "Jumlah NC CMD 2"],
    unit: "kejadian",
    status: "confirmed",
    // Perilaku tanggal DIUKUR 2026-08-04: model ini merespons filter tanggal.
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian NC, cutoff harian biasa",
    notes:
      "Hanya CMD 1 dan CMD 2 yang punya measure hitungan NC yang dirender di " +
      "visual. CMD 3 lihat entri NC per kategori per CMD.",
  },
  {
    domain: "quality",
    kpi: "Jumlah Deviasi per CMD",
    modelName: "Dashboard NC dan Deviasi",
    measures: ["Jumlah deviasi CMD 1", "Jumlah deviasi CMD 2"],
    unit: "kejadian",
    status: "confirmed",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian deviasi, cutoff harian biasa",
    notes:
      "Hanya CMD 1 dan CMD 2 yang punya measure hitungan deviasi yang dirender. " +
      "Deviasi RMPM per CMD ada di entri terpisah.",
  },
  {
    domain: "quality",
    kpi: "Deviasi RMPM per CMD",
    modelName: "Dashboard NC dan Deviasi",
    measures: ["Jumlah Deviasi RMPM CMD 1", "Jumlah Deviasi RMPM CMD 2"],
    unit: "kejadian",
    status: "confirmed",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian deviasi RMPM, cutoff harian biasa",
    notes: "RMPM berarti Raw Material dan Packaging Material, bukan Preventive Maintenance.",
  },
  {
    domain: "quality",
    kpi: "NC per kategori per CMD",
    modelName: "Dashboard NC dan Deviasi",
    measures: [
      "NC CMD 1 total per kategori", "NC CMD 2 total per kategori",
      "NC CMD 3 total per kategori",
    ],
    unit: "kejadian",
    status: "needs_confirmation",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian NC, cutoff harian biasa",
    notes:
      "Satu-satunya jalur yang mencakup CMD 3. Arti total per kategori belum " +
      "disahkan pemilik: bisa jumlah kategori berbeda, bisa total kejadian yang " +
      "sudah berkategori.",
  },
  {
    domain: "quality",
    kpi: "Deviasi FG per kategori per CMD",
    modelName: "Dashboard NC dan Deviasi",
    measures: [
      "Deviasi FG CMD 1 total per kategori", "Deviasi FG CMD 2 total per kategori",
      "Deviasi FG CMD 3 total per kategori",
    ],
    unit: "kejadian",
    status: "needs_confirmation",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian deviasi, cutoff harian biasa",
    notes: "FG berarti Finished Good. Mencakup ketiga CMD, satu-satunya untuk deviasi FG.",
  },
  // DIBUANG 2026-08-12: "Deviasi terhadap standar per CMD".
  //
  // Measure-nya bukan hitungan kejadian, melainkan PENGURANGAN, dan katalog ini
  // salah menyatakan satuannya "kejadian". Diukur langsung lewat Execute
  // Queries: [Jumlah Deviasi - Standar Deviasi CMD 3] bernilai -2156, sementara
  // [Standar CMD 3 (265)] bernilai 265 dan [Jumlah deviasi] bernilai 2421.
  // 265 dikurangi 2421 tepat sama dengan -2156, jadi rumusnya adalah ambang
  // dikurangi jumlah deviasi, dan pengurangnya memakai angka SELURUH CMD
  // walaupun namanya menyebut CMD 3.
  //
  // Akibatnya nyata di laporan yang terkirim 2026-08-11: angka 49, 200, dan 262
  // dibaca manajemen sebagai jumlah kejadian deviasi, padahal itu 51 dikurangi
  // 2, 200 dikurangi 0, dan 265 dikurangi 3, yaitu SISA JATAH sebelum menyentuh
  // ambang. Yang terdengar paling parah, "200 di CMD 2", justru berarti NOL
  // deviasi di CMD 2.
  //
  // Ambang 51, 200, dan 265 juga ditanam di dalam NAMA measure-nya, dan
  // checklist anti-mengarang di data-dictionary sudah menyebut "Standar CMD 1
  // (51)" sebagai contoh ambang hardcoded yang tidak boleh dinyatakan sebagai
  // fakta terkini.
  //
  // Penggantinya bukan measure lain: jumlah kejadian sudah tersedia di KPI
  // "Jumlah Deviasi per CMD". Ambangnya sendiri boleh dipakai kelak sebagai
  // pembanding, tapi harus disebut sebagai ambang, bukan sebagai kejadian.
  {
    domain: "quality",
    kpi: "NC berulang per CMD",
    modelName: "Repetitive NC",
    measures: ["Jumlah NC CMD 1", "Jumlah NC CMD 2", "Jumlah NC CMD 3"],
    unit: "kejadian",
    status: "needs_confirmation",
    filterTanggal: true,
    harian: false,
    dateLogic: "merespons filter tanggal tapi semantiknya bulanan",
    notes:
      "Angka BULANAN, bukan capaian periode ini. Dipakai sebagai konteks masalah " +
      "berulang sesuai spec §6, bukan sebagai hitungan kejadian minggu ini.",
  },

  // ── Breakdown downtime, dengan penyebab dan tindakannya ───────────────────
  //
  // Model Dashboard DT ORS. Kolom Issue dan Action di Dim_DBCatatan adalah
  // remarks penyebab dan tindakan koreksi, yang membuat downtime bisa dipakai
  // MENJELASKAN angka OEE alih-alih cuma dilaporkan sebagai persentase.
  //
  // Nama measure di model ini BERBEDA dari nama tampilannya di visual, dan itu
  // bukan kelalaian: `(M) DT Tech in Hour` dirender sebagai "Duration (Min)",
  // `(M) Downtime Freq` sebagai "Frequency", `nama_mesin` sebagai "Machine".
  // Karena itu setiap entri di bawah membawa `terlihatSebagai`, yaitu nama
  // tampilan yang MEMBUKTIKAN measure ini benar-benar dirender. Tanpa field itu,
  // penjaga katalog akan menolak measure yang sebenarnya dipakai dashboard.
  {
    domain: "production",
    jenis: "breakdown",
    kpi: "Mesin dengan OEE terendah",
    modelName: "Dashboard Daily Meeting untuk OEE",
    dimensi: "nama_mesin",
    // Disebut eksplisit: nama_mesin ada di beberapa tabel pada model ini.
    dimensiTabel: "Dim_ORS",
    // Dibatasi ke section packaging saja, atas permintaan pemilik proyek
    // 2026-08-12. Tanpa batas ini, peringkat OEE terendah terisi mesin proses
    // seperti Pasteurizer Mixing Line 1, yang standarnya belum ditetapkan
    // sehingga "rendah" tidak berarti apa-apa untuknya.
    //
    // Nilainya dienumerasi eksplisit, bukan dicocokkan lewat awalan: section
    // baru akan tersaring keluar sampai ada yang sengaja menambahkannya.
    //
    // Diukur 2026-08-12, ada 9 section. Yang SENGAJA di luar daftar:
    // Mixing-Processing Sentul 1, 2, dan 3 karena bukan packaging. "Packing
    // Sentul 3" sempat ditanyakan karena namanya tanpa awalan Filling, lalu
    // dikonfirmasi pemilik 2026-08-12 bahwa itu termasuk.
    saring: {
      tabel: "Dim_ORS",
      kolom: "nama_section",
      nilai: [
        "Filling-Packing Sentul 1",
        "Filling-Packing Sentul 2",
        "Filling-Packing Sentul 3",
        "Bottle Making Sentul 1",
        "Pouch Making Sentul 3",
        "Packing Sentul 3",
      ],
    },
    // Measure PERTAMA menentukan peringkat, sisanya ikut di baris yang sama.
    //
    // Keempat kategori inilah yang menentukan OEE tiap mesin, dikonfirmasi
    // pemilik proyek 2026-08-12. Menyebut OEE rendah tanpa penyumbangnya tidak
    // bisa ditindaklanjuti siapa pun: yang menentukan langkah berikutnya adalah
    // kategori mana yang paling besar.
    //
    // Standard OEE ikut supaya "rendah" punya pembanding. Diukur 2026-08-12,
    // TIDAK semua mesin punya standar: UHT 5000 mengembalikan kosong, jadi
    // "di bawah standar" tidak boleh dinyatakan tanpa memeriksa ada tidaknya.
    measures: [
      "OEE (%)",
      "Technical DT (%)",
      "Operasional DT (%)",
      "Org DT (%)",
      "Planned Stoppages DT (%)",
      "Standard OEE",
    ],
    arah: "terendah",
    n: 3,
    unit: "%",
    status: "confirmed",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal produksi, cutoff harian biasa",
    notes:
      "Arah penelusuran sesudah penyumbang terbesarnya diketahui, dikonfirmasi " +
      "pemilik: Organizational tertinggi berarti periksa Dashboard Utility Failure, " +
      "Technical tertinggi berarti periksa Maintenance Downtime dan Dashboard DT ORS " +
      "untuk issue serta tindakannya. Sebut nama kategorinya, jangan kode " +
      "group_downtime seperti en, rout, log, atau pno.",
  },
  {
    domain: "production",
    jenis: "breakdown",
    kpi: "Gedung dengan OEE terendah",
    modelName: "Dashboard Daily Meeting untuk OEE",
    dimensi: "Gedung",
    dimensiTabel: "Dim_Gedung",
    measures: [
      "OEE (%)",
      "Technical DT (%)",
      "Operasional DT (%)",
      "Org DT (%)",
      "Planned Stoppages DT (%)",
    ],
    arah: "terendah",
    n: 3,
    unit: "%",
    status: "confirmed",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal produksi, cutoff harian biasa",
    notes:
      "Gedung di model ini bernilai CMD1, CMD2, CMD3, BTMK, dan PM. Perhatikan " +
      "ini GEDUNG, bukan plant: plant bernilai CMDPSR, CMDSMG, dan CMDSTL, dan " +
      "keduanya berawalan sama.",
  },
  // ── Kategori deviasi tertinggi ─────────────────────────────────────────────
  //
  // HANYA Deviasi PM CMD 3. Kategori NC per gedung SENGAJA tidak dipakai di
  // laporan harian, dan alasannya diukur 2026-08-12, bukan diasumsikan:
  //
  //   NC CMD 1 dan NC CMD 2  : tidak punya kolom tanggal sama sekali. Yang ada
  //                            hanya `Hari` bertipe TEKS berisi nama hari
  //                            ("Jumat", "Friday"), jadi tidak bisa difilter
  //                            per tanggal dengan cara apa pun.
  //   NC CMD 3               : tanggal terakhir 2026-07-09, 121 baris.
  //   NC CMD ALL (Append)    : tanggal terakhir 2026-07-09, 198 baris.
  //   NC External  CMD 3     : tanggal terakhir 2025-09-17.
  //   Deviasi PM CMD 3       : tanggal terakhir 2026-08-12, 792 baris. SEGAR.
  //
  // Memasang KPI di atas sumber yang berhenti sebulan lalu berarti laporan
  // harian membawa section yang SELALU kosong, dan kosong yang tidak dijelaskan
  // terbaca sebagai "tidak ada masalah kualitas kemarin".
  //
  // Dua jalur lain juga sudah dicoba dan gagal, dicatat supaya tidak diulang:
  //   - `Kategori_NC CMD 1[KATEGORI ISSUE ]` tabel TERPUTUS tanpa relasi ke
  //     fakta. Mengelompokkan dengannya mengembalikan angka SAMA untuk setiap
  //     kategori, yaitu 74, dan itu terlihat seperti hasil sungguhan.
  //   - `NC External  CMD 1[KATEGORI  DEVIASI]` kosong seluruhnya: 33 baris
  //     dengan kategori null.
  {
    domain: "quality",
    jenis: "breakdown",
    kpi: "Kategori deviasi PM tertinggi CMD 3",
    modelName: "Dashboard NC dan Deviasi",
    dimensi: "Issue Category",
    dimensiTabel: "Deviasi PM CMD 3",
    // Tabelnya disebut eksplisit: nama Cause ada di 2 tabel dan ACTION di 4,
    // dan temukanKolom menolak menebak saat ambigu.
    kolomTeks: [
      { tabel: "Deviasi PM CMD 3", kolom: "Cause" },
      { tabel: "Deviasi PM CMD 3", kolom: "ACTION" },
    ],
    measures: ["Jumlah Deviasi PM"],
    arah: "tertinggi",
    n: 3,
    unit: "kejadian",
    status: "confirmed",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian, cutoff harian biasa",
    notes:
      "Cause dan ACTION ikut dikelompokkan supaya penyebab dan tindakannya " +
      "terbaca bersama angkanya. Diukur 2026-08-12 untuk rentang 1 sampai 12 " +
      "Agustus: Channel Leakage 4 dan Design Correction 1.",
  },
  {
    domain: "maintenance",
    jenis: "breakdown",
    kpi: "Top mesin downtime tertinggi",
    modelName: "Dashboard DT ORS",
    dimensi: "nama_mesin",
    // Disebut eksplisit: nama_mesin ada di 2 tabel pada model ini.
    dimensiTabel: "Dim_DBCatatan",
    kolomTeks: ["Issue", "Action"],
    measures: ["(M) DT Tech in Hour"],
    terlihatSebagai: ["Duration (Min)"],
    arah: "tertinggi",
    n: 3,
    // SATUANNYA BELUM PASTI, dan itu ditulis apa adanya. Nama measure berbunyi
    // "in Hour" tetapi visual merendernya sebagai "Duration (Min)". Angka 480
    // untuk satu mesin dalam seminggu mustahil bila jam, karena seminggu hanya
    // 168 jam; bila menit, 480 berarti 8 jam dan itu masuk akal. Menuliskan
    // "jam" tanpa dasar akan membuat laporan melaporkan angka 60 kali lipat.
    unit: "menit atau jam, satuannya belum dipastikan pemilik",
    status: "needs_confirmation",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian downtime, cutoff harian biasa",
    notes:
      "Issue dan Action berasal dari entri operator, jadi WAJIB lewat sanitasiTeks " +
      "sebelum masuk prompt. Inilah yang menjawab kenapa OEE turun, bukan cuma " +
      "berapa persen turunnya. Karena dikelompokkan bersama Issue dan Action, satu " +
      "mesin bisa muncul beberapa kali dengan penyebab berbeda, dan itu memang " +
      "yang dicari: bukan cuma mesin mana, tapi kenapa.",
  },
  {
    domain: "maintenance",
    jenis: "breakdown",
    kpi: "Top mesin downtime terendah",
    modelName: "Dashboard DT ORS",
    dimensi: "nama_mesin",
    dimensiTabel: "Dim_DBCatatan",
    measures: ["(M) DT Tech in Hour"],
    terlihatSebagai: ["Duration (Min)"],
    arah: "terendah",
    n: 3,
    unit: "menit atau jam, satuannya belum dipastikan pemilik",
    status: "needs_confirmation",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian downtime, cutoff harian biasa",
    notes: "Pembanding sisi lain: mesin yang paling sehat pada periode yang sama.",
  },
  {
    domain: "maintenance",
    jenis: "breakdown",
    kpi: "Downtime per gedung",
    modelName: "Dashboard DT ORS",
    dimensi: "gedung",
    measures: ["(M) DT Tech in Hour"],
    terlihatSebagai: ["Duration (Min)"],
    arah: "tertinggi",
    n: 5,
    unit: "menit atau jam, satuannya belum dipastikan pemilik",
    status: "needs_confirmation",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian downtime, cutoff harian biasa",
    notes:
      "gedung di Dim_Plant adalah pecahan per CMD yang diminta: visual merendernya " +
      "sebagai CMD, dan isinya memang CMD1, CMD2, CMD3. n dibuat 5, bukan 3, supaya " +
      "seluruh gedung terlihat alih-alih terpotong sewenang-wenang. Entri serupa atas " +
      "kolom departemen sudah DIBUANG karena terukur menghasilkan angka yang identik: " +
      "dua baris laporan yang sama hanya menambah panjang tanpa menambah informasi.",
  },
  {
    domain: "maintenance",
    jenis: "breakdown",
    kpi: "Downtime per section",
    modelName: "Dashboard DT ORS",
    dimensi: "SectionDowntime",
    kolomTeks: ["Issue"],
    measures: ["(M) Downtime Freq"],
    terlihatSebagai: ["Frequency"],
    arah: "tertinggi",
    n: 3,
    unit: "kejadian",
    status: "needs_confirmation",
    filterTanggal: true,
    harian: true,
    dateLogic: "difilter tanggal kejadian downtime, cutoff harian biasa",
    notes: "Frekuensi, bukan durasi: section yang paling sering berhenti belum tentu yang terlama.",
  },

];

/** Domain yang dikenali. Dipakai uji untuk menolak salah tulis. */
export const DOMAIN_SAH = [
  "production", "quality", "maintenance", "cost", "energy", "planning", "inventory",
];

export const STATUS_SAH = ["confirmed", "needs_confirmation", "blocked"];

/**
 * Memvalidasi bentuk katalog. Dipanggil saat startup job, bukan hanya di uji.
 *
 * Entri tanpa dateLogic ditolak di sini. Tanpa penolakan itu, KPI baru bisa
 * masuk dengan asumsi tanggal yang tidak pernah ditulis siapa pun, dan angkanya
 * salah tanpa satu pun error muncul.
 *
 * @returns {string[]} daftar masalah, kosong berarti sah
 */
export function validasiKatalog(katalog = KATALOG_KPI) {
  const masalah = [];
  const terlihat = new Set();

  katalog.forEach((e, i) => {
    const label = `[${i}] ${e.kpi || "(tanpa kpi)"}`;
    if (!e.kpi) masalah.push(`${label}: kpi wajib diisi`);
    if (!DOMAIN_SAH.includes(e.domain)) masalah.push(`${label}: domain "${e.domain}" tidak dikenal`);
    if (!STATUS_SAH.includes(e.status)) masalah.push(`${label}: status "${e.status}" tidak dikenal`);
    if (!e.modelName) masalah.push(`${label}: modelName wajib diisi`);
    if (!Array.isArray(e.measures) || e.measures.length === 0) {
      masalah.push(`${label}: measures wajib berisi minimal satu nama`);
    }
    if (!e.unit) masalah.push(`${label}: unit wajib diisi`);
    // Inti aturan 2.
    if (!e.dateLogic || String(e.dateLogic).trim().length < 10) {
      masalah.push(`${label}: dateLogic wajib dijelaskan, tidak ada nilai bawaan`);
    }
    // Aturan 4. Keduanya WAJIB boolean eksplisit, bukan undefined.
    //
    // Tanpa ini, KPI baru bisa masuk tanpa perilaku tanggalnya pernah diukur,
    // dan perluFilterTanggal() akan membacanya sebagai false. Untuk measure yang
    // sebenarnya merespons filter, hasilnya angka sepanjang masa yang tampil
    // sebagai angka harian: persis cacat yang ditemukan pada OEE dan Downtime
    // kategori sebelum flag ini ada.
    if (typeof e.filterTanggal !== "boolean") {
      masalah.push(`${label}: filterTanggal wajib boolean, tetapkan dengan mengukur, bukan menebak`);
    }
    if (typeof e.harian !== "boolean") {
      masalah.push(`${label}: harian wajib boolean, sebutkan apakah angkanya benar-benar harian`);
    }
    // Angka yang tidak harian TIDAK boleh masuk tanpa penjelasan, karena
    // pembaca laporan akan menganggap semua angka di laporan harian itu harian.
    if (e.harian === false && (!e.notes || e.notes.length < 20)) {
      masalah.push(`${label}: harian false wajib disertai notes yang menjelaskan angkanya mewakili apa`);
    }
    const kunci = `${e.domain}|${e.kpi}`;
    if (terlihat.has(kunci)) masalah.push(`${label}: duplikat domain dan kpi`);
    terlihat.add(kunci);
  });

  return masalah;
}

/** Entri katalog untuk satu domain. Dasar pembungkus getYesterdayX(). */
export function kpiDomain(domain) {
  return KATALOG_KPI.filter((e) => e.domain === domain);
}

/** Semua nama model yang dipakai katalog, unik. */
export function modelDipakai() {
  return [...new Set(KATALOG_KPI.map((e) => e.modelName))];
}

/** Semua pasangan model dan measure, diratakan. */
export function pasanganMeasure() {
  return KATALOG_KPI.flatMap((e) =>
    e.measures.map((m) => ({ modelName: e.modelName, measure: m, kpi: e.kpi, status: e.status }))
  );
}
