import { ok, section } from "./harness.mjs";
import { sendDailySummary, konfigurasi, PROVIDER_SAH } from "../src/services/whatsapp.service.js";
import { nilaiKegagalan, kirimAlert, tujuanAlert, TINGKAT } from "../src/services/alerting.service.js";

// Env dipulihkan di akhir supaya uji lain dan server yang sedang jalan tidak
// terpengaruh oleh setelan yang diubah di sini.
const asli = {
  provider: process.env.WHATSAPP_PROVIDER,
  target: process.env.WHATSAPP_TARGET_MODE,
  group: process.env.WHATSAPP_GROUP_ID,
  daftar: process.env.WHATSAPP_RECIPIENT_LIST,
  alert: process.env.ADMIN_ALERT_CHANNEL,
};
const pulihkan = () => {
  for (const [k, v] of [
    ["WHATSAPP_PROVIDER", asli.provider], ["WHATSAPP_TARGET_MODE", asli.target],
    ["WHATSAPP_GROUP_ID", asli.group], ["WHATSAPP_RECIPIENT_LIST", asli.daftar],
    ["ADMIN_ALERT_CHANNEL", asli.alert],
  ]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

section("Bawaan providernya dryrun, bukan mengirim");

delete process.env.WHATSAPP_PROVIDER;
delete process.env.WHATSAPP_TARGET_MODE;
// Job yang salah konfigurasi harus DIAM. Pesan yang salah kirim ke grup
// manajemen tidak bisa ditarik kembali.
ok("provider bawaan dryrun", konfigurasi().provider === "dryrun", konfigurasi().provider);
ok("dryrun tidak menuntut group id", konfigurasi().siap === true, JSON.stringify(konfigurasi().masalah));

const dry = await sendDailySummary("*RINGKASAN* isi pesan uji");
ok("dryrun melaporkan terkirim", dry.terkirim === true, JSON.stringify(dry));
ok("ditandai dryRun", dry.dryRun === true);
ok("membawa cuplikan pesan", dry.cuplikan.includes("RINGKASAN"));
ok("panjang pesan dilaporkan", dry.panjangPesan > 0);

section("Pesan kosong ditolak sebelum menyentuh provider");

for (const [label, p] of [["kosong", ""], ["spasi", "   "], ["null", null], ["undefined", undefined]]) {
  const r = await sendDailySummary(p);
  ok(`${label} ditolak`, r.terkirim === false, JSON.stringify(r));
}

section("Konfigurasi tidak sah ditolak, tidak dipaksakan jalan");

const KASUS = [
  ["provider tidak dikenal", { WHATSAPP_PROVIDER: "telegram" }, /tidak dikenal/],
  ["target tidak dikenal", { WHATSAPP_PROVIDER: "baileys", WHATSAPP_TARGET_MODE: "broadcast" }, /tidak dikenal/],
  ["group tanpa group id", { WHATSAPP_PROVIDER: "baileys", WHATSAPP_TARGET_MODE: "group", WHATSAPP_GROUP_ID: "" }, /WHATSAPP_GROUP_ID wajib/],
  ["group id tanpa @g.us", { WHATSAPP_PROVIDER: "baileys", WHATSAPP_TARGET_MODE: "group", WHATSAPP_GROUP_ID: "628123456789" }, /@g\.us/],
  ["individual tanpa daftar", { WHATSAPP_PROVIDER: "baileys", WHATSAPP_TARGET_MODE: "individual", WHATSAPP_RECIPIENT_LIST: "" }, /RECIPIENT_LIST wajib/],
  // Cloud API resmi tidak mendukung Group. Dibiarkan lolos, job akan gagal tiap
  // hari dengan pesan dari Meta yang sulit dibaca alih-alih ditolak sekali.
  ["cloud_api ke group", { WHATSAPP_PROVIDER: "cloud_api", WHATSAPP_TARGET_MODE: "group", WHATSAPP_GROUP_ID: "123@g.us" }, /tidak mendukung target group/],
];

for (const [label, env, pola] of KASUS) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const cfg = konfigurasi();
  ok(`${label} ditandai tidak siap`, cfg.siap === false, JSON.stringify(cfg.masalah));
  ok(`${label} alasannya jelas`, cfg.masalah.some((m) => pola.test(m)), cfg.masalah.join("; "));

  const r = await sendDailySummary("pesan uji");
  ok(`${label} tidak dikirim`, r.terkirim === false, JSON.stringify(r));
  pulihkan();
}

section("Baileys tanpa paket terpasang gagal dengan pesan yang bisa ditindak");

process.env.WHATSAPP_PROVIDER = "baileys";
process.env.WHATSAPP_TARGET_MODE = "group";
process.env.WHATSAPP_GROUP_ID = "1234567890-123456@g.us";

const wa = await sendDailySummary("pesan uji ke grup");
ok("konfigurasinya sah", konfigurasi().siap === true, JSON.stringify(konfigurasi().masalah));
// Paketnya sengaja tidak dipasang sebagai bawaan. Yang penting: kegagalannya
// menyebut perintah yang harus dijalankan, bukan melempar stack trace.
ok("gagal tanpa melempar", wa.terkirim === false, JSON.stringify(wa));
ok("menyebut cara memasangnya", /npm install @whiskeysockets\/baileys/.test(wa.alasan || ""), wa.alasan);
pulihkan();

ok("daftar provider memuat dryrun dan baileys",
  PROVIDER_SAH.includes("dryrun") && PROVIDER_SAH.includes("baileys"));

section("Penilaian kegagalan membedakan yang perlu di-alert");

const jendela = { mulaiTanggal: "2026-07-27", selesaiTanggal: "2026-08-02" };
const domainSehat = [
  { domain: "production", freshness: "full", kpi: [{ kpi: "OEE", values: [{ measure: "OEE (%)", value: 0.7 }] }] },
  { domain: "quality", freshness: "full", kpi: [{ kpi: "NC", values: [{ measure: "Jumlah NC", value: 3 }] }] },
];

const sehat = nilaiKegagalan({ jendela, domains: domainSehat, ai: { berhasil: true }, kirim: { terkirim: true } });
ok("job sehat tidak memicu alert", sehat.perluAlert === false, JSON.stringify(sehat));
ok("tingkatnya info", sehat.tingkat === TINGKAT.INFO, sehat.tingkat);

// §14: satu domain gagal BUKAN alasan alert. Alert yang terlalu sering diabaikan,
// dan keadaan ini sudah ditandai di laporannya.
const satuKosong = nilaiKegagalan({
  jendela,
  domains: [domainSehat[0], { domain: "energy", freshness: "full", kpi: [{ kpi: "Air", values: [{ measure: "x", value: null }] }] }],
  ai: { berhasil: true }, kirim: { terkirim: true },
});
ok("satu domain kosong tidak memicu alert", satuKosong.perluAlert === false, JSON.stringify(satuKosong));
ok("tapi tetap dicatat sebagai peringatan", satuKosong.tingkat === TINGKAT.PERINGATAN, satuKosong.tingkat);
ok("domain yang kosong disebut namanya", /energy/.test(satuKosong.isi), satuKosong.isi);

const semuaKosong = nilaiKegagalan({
  jendela,
  domains: [{ domain: "production", freshness: "full", kpi: [{ kpi: "OEE", values: [{ measure: "x", value: null }] }] }],
  ai: { berhasil: true }, kirim: { terkirim: true },
});
ok("semua domain kosong memicu alert", semuaKosong.perluAlert === true, JSON.stringify(semuaKosong));

const aiGagal = nilaiKegagalan({ jendela, domains: domainSehat, ai: { berhasil: false, alasan: "kuota habis" }, kirim: { terkirim: true } });
ok("AI gagal memicu alert", aiGagal.perluAlert === true);
ok("sebab AI disebut", /kuota habis/.test(aiGagal.isi), aiGagal.isi);

const kirimGagal = nilaiKegagalan({ jendela, domains: domainSehat, ai: { berhasil: true }, kirim: { terkirim: false, alasan: "sesi terputus" } });
ok("pengiriman gagal memicu alert", kirimGagal.perluAlert === true);
ok("sebab pengiriman disebut", /sesi terputus/.test(kirimGagal.isi), kirimGagal.isi);

ok("judul menyebut periodenya", aiGagal.judul.includes("2026-07-27"), aiGagal.judul);

section("Alert tanpa tujuan gagal dengan tenang, tidak melempar");

delete process.env.ADMIN_ALERT_CHANNEL;
ok("tujuan kosong", tujuanAlert().length === 0);
const tanpaTujuan = await kirimAlert({ judul: "uji", isi: "uji" });
// Alerting yang melempar bisa menggagalkan job yang sudah berhasil, atau
// menutupi kegagalan aslinya dengan kegagalan pengiriman alert.
ok("tidak melempar", tanpaTujuan.terkirim === false, JSON.stringify(tanpaTujuan));
ok("alasannya menyebut ADMIN_ALERT_CHANNEL", /ADMIN_ALERT_CHANNEL/.test(tanpaTujuan.alasan || ""));

process.env.ADMIN_ALERT_CHANNEL = "a@contoh.com, b@contoh.com ,";
ok("tujuan dipisah koma dan dirapikan", tujuanAlert().length === 2, JSON.stringify(tujuanAlert()));
ok("spasi ikut dibersihkan", tujuanAlert()[1] === "b@contoh.com", tujuanAlert()[1]);

pulihkan();
ok("env dipulihkan", process.env.WHATSAPP_PROVIDER === asli.provider);
