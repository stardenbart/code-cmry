import { ok, section } from "./harness.mjs";
import {
  susunMuatan, validasiKeluaran, pesanCadangan, catatanKaki,
  instruksiSistem, SECTION_WAJIB, BATAS_MUATAN_BYTE, PROMPT_VERSION,
  BATAS_PESAN_KARAKTER,
} from "../src/services/summaryFormatter.js";

// Domain palsu yang menirukan bentuk nyata dari ambilDomain(), termasuk kasus
// yang paling mudah salah: KPI akumulatif, KPI kosong, dan domain partial.
const DOMAINS = [
  {
    domain: "production",
    freshness: "full",
    cutoffWib: null,
    kpi: [
      {
        kpi: "OEE", unit: "%", status: "blocked", dateFilterApplied: true,
        values: [{ measure: "OEE (%)", value: 0.697 }, { measure: "1-Final OEE (%)", value: 0.7 }],
      },
      {
        kpi: "Output dan input produksi", unit: "pcs", status: "confirmed", dateFilterApplied: false,
        values: [{ measure: "(sum) Output", value: 227514969.23 }],
      },
      {
        kpi: "Tidak ada angka", unit: "pcs", status: "confirmed", dateFilterApplied: true,
        values: [{ measure: "Kosong", value: null }],
      },
    ],
  },
  {
    domain: "cost",
    freshness: "partial",
    cutoffWib: "17:30",
    kpi: [
      {
        kpi: "Biaya lembur", unit: "IDR", status: "confirmed", dateFilterApplied: false,
        values: [{ measure: "Biaya Yang dibayar (cost)", value: 16274222498.96 }],
      },
    ],
  },
];

const JENDELA_HARI = { tanggal: "2026-08-04" };
const JENDELA_MINGGU = { mulaiTanggal: "2026-07-27", selesaiTanggal: "2026-08-02" };

section("Muatan membawa sifat angka, bukan cuma angkanya");

const m = susunMuatan({ jendela: JENDELA_HARI, domains: DOMAINS });
ok("periode harian dikenali", m.periode.jenis === "harian", m.periode.jenis);
ok("promptVersion ikut", m.promptVersion === PROMPT_VERSION);

const oee = m.domains[0].kpi.find((k) => k.kpi === "OEE");
const output = m.domains[0].kpi.find((k) => k.kpi === "Output dan input produksi");

ok("KPI harian ditandai angkaHarian true", oee.angkaHarian === true);
// Inti perlindungannya: tanpa penanda ini, 227 juta akan terbaca sebagai output
// semalam padahal itu akumulasi sepanjang data.
ok("KPI akumulatif ditandai angkaHarian false", output.angkaHarian === false);
ok("sifat angka akumulatif tertulis gamblang",
  /BUKAN periode ini/.test(output.sifatAngka), output.sifatAngka);
ok("status blocked terbawa", oee.status === "blocked");
ok("kedua varian blocked terbawa", oee.nilai.length === 2, `dapat ${oee.nilai.length}`);

section("KPI tanpa angka dicatat sebagai keterbatasan, bukan dikirim null");

// Mengirim null memancing model menebak; mencatatnya sebagai keterbatasan
// membuat model menyebut buktinya tidak ada, sesuai §6.
ok("KPI kosong tidak masuk daftar kpi",
  !m.domains[0].kpi.some((k) => k.kpi === "Tidak ada angka"));
ok("keterbatasan data dicatat", Array.isArray(m.keterbatasanData) && m.keterbatasanData.length === 1,
  JSON.stringify(m.keterbatasanData));
ok("catatannya menyebut domain dan KPI-nya",
  /production\/Tidak ada angka/.test(m.keterbatasanData[0]), m.keterbatasanData[0]);

section("Kesegaran partial membawa jam batasnya");

const cost = m.domains.find((d) => d.domain === "cost");
ok("kesegaran partial terbawa", cost.kesegaran === "partial");
ok("dataSampaiJam terbawa", cost.dataSampaiJam === "17:30", cost.dataSampaiJam);

section("Muatan tetap di bawah batas 10KB");

const besar = [];
for (let i = 0; i < 60; i += 1) {
  besar.push({
    domain: `domain${i}`, freshness: "full", cutoffWib: null,
    kpi: Array.from({ length: 12 }, (_, j) => ({
      kpi: `KPI panjang sekali nomor ${i}-${j} dengan nama yang dipanjangkan`,
      unit: "satuan", status: "blocked", dateFilterApplied: true,
      values: Array.from({ length: 8 }, (_, z) => ({
        measure: `Measure dengan nama panjang ${i}-${j}-${z}`, value: 12345.6789,
      })),
    })),
  });
}
const mBesar = susunMuatan({ jendela: JENDELA_MINGGU, domains: besar });
const byte = Buffer.byteLength(JSON.stringify(mBesar), "utf8");
ok(`muatan besar dipangkas ke ${byte} byte, batas ${BATAS_MUATAN_BYTE}`, byte <= BATAS_MUATAN_BYTE);
ok("angka utama tidak ikut hilang saat dipangkas",
  mBesar.domains[0].kpi[0].nilai.length >= 1);

section("Periode mingguan dikenali");

const mm = susunMuatan({ jendela: JENDELA_MINGGU, domains: DOMAINS });
ok("jenis mingguan", mm.periode.jenis === "mingguan");
ok("rentangnya terbawa",
  mm.periode.mulai === "2026-07-27" && mm.periode.selesai === "2026-08-02");

section("Pembanding ikut bila ada, termasuk jumlah hari tersedia");

const banding = new Map([["production|OEE|OEE (%)", { kemarin: 0.68, avg7: 0.7, hariTersedia: 3, tren30: 0.69 }]]);
const mb = susunMuatan({ jendela: JENDELA_HARI, domains: DOMAINS, banding });
const oeeB = mb.domains[0].kpi.find((k) => k.kpi === "OEE");
ok("banding terbawa", Boolean(oeeB.banding), JSON.stringify(oeeB.banding));
// §6: bukti tidak cukup harus bisa dikenali model, jadi jumlah harinya dikirim.
ok("hariTersedia ikut supaya model tahu buktinya cukup atau tidak",
  oeeB.banding.hariTersedia === 3, `dapat ${oeeB.banding.hariTersedia}`);

section("Instruksi sistem memuat aturan yang tidak boleh hilang");

const ins = instruksiSistem();
for (const frasa of ["Hanya sebut angka yang ADA", "angkaHarian bernilai false",
  "blocked", "hariTersedia", "dataSampaiJam", "Jangan memakai emoji"]) {
  ok(`instruksi menyebut "${frasa}"`, ins.includes(frasa));
}
for (const s of SECTION_WAJIB) {
  ok(`instruksi meminta section ${s}`, ins.includes(s));
}

section("Validasi keluaran menolak yang cacat");

const lengkap = [
  "*RINGKASAN OPERASIONAL* periode 2026-08-04",
  "*ANALISIS* OEE turun ke 0,697 dan downtime teknikal naik.",
  "*PERLU DIKONFIRMASI* angka output bersifat akumulatif.",
  "*REKOMENDASI* periksa filler Serac 2 pagi ini.",
  "*RISIKO* risiko berhenti lini bila filler belum diperbaiki.",
  "x".repeat(200),
].join("\n");

ok("keluaran lengkap lolos", validasiKeluaran(lengkap).lolos === true,
  validasiKeluaran(lengkap).catatan);

for (const [label, teks] of [
  ["kosong", ""],
  ["hanya spasi", "    "],
  ["terlalu pendek", "*ANALISIS* *PERLU DIKONFIRMASI* *REKOMENDASI* *RISIKO*"],
  ["null", null],
]) {
  ok(`${label} ditolak`, validasiKeluaran(teks).lolos === false);
}

// Kehilangan satu section pun ditolak: pesan setengah jadi lebih membingungkan
// daripada tidak ada pesan, karena pembacanya tidak tahu bagian mana yang hilang.
for (const s of SECTION_WAJIB) {
  const kurang = lengkap.replace(s, "DIHAPUS");
  const v = validasiKeluaran(kurang);
  ok(`tanpa section ${s} ditolak`, v.lolos === false, JSON.stringify(v));
  ok(`alasannya menyebut ${s}`, (v.catatan || "").includes(s), v.catatan);
}

const beremoji = `${lengkap}\nBagus sekali \u{1F600}`;
ok("keluaran beremoji ditolak", validasiKeluaran(beremoji).lolos === false);
ok("alasan emoji disebut", /emoji/.test(validasiKeluaran(beremoji).catatan || ""));

section("Angka dikirim beserta bentuk tampilannya");

// Cacat pada pesan yang BENAR-BENAR terkirim ke grup 2026-08-05: modelnya
// menulis angka sendiri dari JSON dan hasilnya gaya Inggris, "0.7571" dan
// "IDR 16281993351". Menyuruhnya memformat lewat instruksi saja tidak bisa
// diandalkan, jadi bentuk jadinya ikut dikirim di field `t`.
const mAngka = susunMuatan({
  jendela: JENDELA_HARI,
  domains: [{
    domain: "cost", freshness: "full", cutoffWib: null,
    kpi: [{
      kpi: "Biaya lembur", unit: "IDR", status: "confirmed", dateFilterApplied: false,
      values: [{ measure: "Biaya", value: 16281993351 }, { measure: "Rasio", value: 0.7571 }],
    }],
  }],
});
const nilaiCost = mAngka.domains[0].kpi[0].nilai;
ok("angka besar diformat gaya Indonesia", nilaiCost[0].t === "16.281.993.351", nilaiCost[0].t);
ok("rasio kecil tetap teliti", nilaiCost[1].t === "0,757", nilaiCost[1].t);
ok("nilai numeriknya tetap dikirim", nilaiCost[0].v === 16281993351);

section("Validasi menolak pesan yang terlalu panjang dan angka gaya Inggris");

ok(`batas karakter ${BATAS_PESAN_KARAKTER} lebih kecil dari pesan pertama 7234`,
  BATAS_PESAN_KARAKTER < 7234);
// Harus cukup untuk keluaran nyata berisi breakdown, yang terukur 2929 karakter.
ok("batas cukup untuk keluaran berisi breakdown", BATAS_PESAN_KARAKTER >= 4100,
  `dapat ${BATAS_PESAN_KARAKTER}, keluaran nyata terukur 2929 lalu 4010, keduanya sempat ditolak`);

const panjang = validasiKeluaran(lengkap + "y".repeat(7000));
ok("pesan 7000+ karakter ditolak", panjang.lolos === false, JSON.stringify(panjang));
ok("alasannya menyebut panjang", /terlalu panjang/.test(panjang.catatan || ""), panjang.catatan);

for (const [label, tambahan] of [
  ["desimal titik", " nilainya 0.7571"],
  ["digit panjang tanpa pemisah", " IDR 16281993351"],
]) {
  const v = validasiKeluaran(`${lengkap} ${tambahan}`);
  ok(`${label} ditolak`, v.lolos === false, JSON.stringify(v));
  ok(`${label} alasannya menyebut field t`, /field t/.test(v.catatan || ""), v.catatan);
}

// Yang sah tidak boleh salah tuduh: versi model dan angka berformat Indonesia.
const sah = `${lengkap}\nModel gemini-3.6-flash, OEE 0,757 dan biaya 16.281.993.351 IDR.`;
ok("angka Indonesia dan versi model tidak salah tuduh", validasiKeluaran(sah).lolos === true,
  validasiKeluaran(sah).catatan);

section("Instruksi memuat larangan yang baru ditambahkan");

for (const frasa of [
  "PERSIS seperti field `t`",
  "TIDAK BOLEH muncul di section REKOMENDASI",
  "JANGAN menulis harian",
  "di bawah 3500 karakter",
  "pakai keduanya untuk MENJELASKAN",
]) {
  ok(`instruksi menyebut "${frasa.slice(0, 34)}"`, ins.includes(frasa), "hilang dari instruksi");
}

section("Pesan cadangan tetap membawa angka dan penandanya");

const cadangan = pesanCadangan({
  jendela: JENDELA_HARI, domains: DOMAINS, alasan: "kunci universal belum diatur",
});
ok("menyebut periodenya", cadangan.includes("2026-08-04"));
ok("menyebut sebab kegagalannya", /kunci universal belum diatur/.test(cadangan));
ok("membawa angka OEE", cadangan.includes("0,697") || cadangan.includes("0.697"));
// Tanpa penanda ini, 16 miliar akan terbaca sebagai biaya lembur semalam.
ok("angka akumulatif diberi penanda", /\[akumulatif\]/.test(cadangan));
ok("status non-confirmed diberi penanda", /\[blocked\]/.test(cadangan));
ok("menyebut jam batas data partial", cadangan.includes("17:30"));
ok("punya section PERLU DIKONFIRMASI", cadangan.includes("PERLU DIKONFIRMASI"));
ok("KPI tanpa angka tidak muncul", !cadangan.includes("Tidak ada angka"));

section("Catatan kaki menyebut versi model dan sifat angkanya");

const kaki = catatanKaki({ modelVersion: "gemini-3.6-flash", jendela: JENDELA_MINGGU, adaAkumulatif: true });
ok("menyebut versi model", kaki.includes("gemini-3.6-flash"));
ok("menyebut versi prompt", kaki.includes(PROMPT_VERSION));
ok("menyebut rentang mingguan", kaki.includes("2026-07-27") && kaki.includes("2026-08-02"));
ok("memperingatkan angka akumulatif", /akumulatif/.test(kaki));
ok("tanpa akumulatif tidak memperingatkan",
  !/akumulatif/.test(catatanKaki({ modelVersion: "x", jendela: JENDELA_HARI, adaAkumulatif: false })));

section("Tidak ada emoji dan tanda pisah panjang di teks yang dibaca user");

for (const [label, teks] of [["pesan cadangan", cadangan], ["catatan kaki", kaki], ["instruksi", ins]]) {
  ok(`${label} tanpa emoji`, !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(teks));
  ok(`${label} tanpa tanda pisah panjang`, !teks.includes("—"));
}
