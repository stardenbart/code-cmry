// ─────────────────────────────────────────────────────────────────────────────
// Mendengarkan tag di grup WhatsApp dan menjalankan ringkasan atas permintaan.
//
// Ini membuat nomor pengirim BERTINDAK atas pesan orang lain, jadi penjagaannya
// bukan hiasan. Empat hal yang wajib ada, masing-masing menutup kegagalan yang
// nyata:
//
// 1. PESAN SENDIRI DIABAIKAN. Bot membalas ke grup, dan balasannya masuk lagi
//    sebagai pesan baru. Tanpa penjagaan ini, satu tag memicu lingkaran tak
//    berujung yang membanjiri grup dan menghabiskan kuota Gemini.
//
// 2. HANYA MERESPONS TAG. Tanpa syarat mention, setiap percakapan biasa yang
//    memuat kata "update" akan menjalankan pipeline 140 detik.
//
// 3. JEDA ANTAR PERMINTAAN. Siapa pun di grup bisa menekan pipeline berulang
//    kali. Satu jalan per jendela jeda, sisanya dijawab dengan sopan.
//
// 4. HANYA JALAN BILA DIIZINKAN. WHATSAPP_LISTENER_ENABLED harus diisi, dengan
//    alasan yang sama seperti SCHEDULER_ENABLED: laptop developer mana pun yang
//    menjalankan backend akan ikut mendengarkan grup manajemen.
// ─────────────────────────────────────────────────────────────────────────────

import { jendelaLaporan } from "../utils/dateWindow.util.js";

/** Jeda minimum antar permintaan per grup. */
const JEDA_MS = Number(process.env.WHATSAPP_LISTENER_COOLDOWN_MS) || 10 * 60 * 1000;

/** Kapan permintaan terakhir dilayani, per grup. */
const terakhirDilayani = new Map();

/** Sedang mengerjakan permintaan, per grup. */
const sedangJalan = new Set();

export function listenerAktif() {
  return /^(1|true|on|yes)$/i.test(String(process.env.WHATSAPP_LISTENER_ENABLED || ""));
}

/**
 * Kata yang berarti "kirim ringkasan terbaru".
 *
 * Deterministik, tidak memanggil model. Menanyakan maksud ke Gemini untuk
 * memutuskan apakah akan memanggil Gemini adalah pemborosan yang juga menambah
 * satu titik kegagalan.
 */
const POLA_MINTA_UPDATE = [
  /\bupdate\b/i,
  /\bterbaru\b/i,
  /\brekap\b/i,
  /\bringkas(?:an|kan)?\b/i,
  /\bsummary\b/i,
  /\blaporan\b/i,
  /\bkondisi\s+(?:plant|produksi|hari)/i,
  /\bgimana\s+(?:plant|produksi|kondisi)/i,
  /\binfo(?:rmasi)?\s+(?:terbaru|terkini|hari)/i,
];

/** Kata yang menandakan permintaan BUKAN untuk ringkasan. */
const POLA_BUKAN = [
  /\bjangan\b/i,
  /\bstop\b/i,
  /\bbatal/i,
  /\bterima kasih\b/i,
  /\bmakasih\b/i,
];

/**
 * Apakah teks meminta ringkasan terbaru.
 * @returns {{minta: boolean, alasan: string}}
 */
export function kenaliPermintaan(teks) {
  const t = String(teks || "").trim();
  if (!t) return { minta: false, alasan: "pesan kosong" };
  if (POLA_BUKAN.some((p) => p.test(t))) return { minta: false, alasan: "pesan menolak atau berterima kasih" };
  const cocok = POLA_MINTA_UPDATE.find((p) => p.test(t));
  return cocok
    ? { minta: true, alasan: `cocok pola ${cocok}` }
    : { minta: false, alasan: "tidak ada kata yang menandakan permintaan ringkasan" };
}

/**
 * Kata yang menandakan pertanyaan, bukan permintaan ringkasan.
 *
 * Diperiksa SEBELUM pola ringkasan, karena "jelasin kenapa Tetra Line 3
 * downtime-nya tinggi" memuat kata yang mirip permintaan laporan, tapi yang
 * diminta penjelasan satu mesin bukan ringkasan seluruh plant.
 */
const POLA_TANYA = [
  // Ditulis dengan batas kata. Versi sebelumnya rusak: skrip suntingan
  // menerjemahkan escape-nya menjadi karakter BACKSPACE 0x08 sungguhan, jadi
  // setiap pola menuntut karakter backspace di sekitar katanya dan tidak
  // pernah cocok dengan teks manusia. Regexnya lolos parse, jadi tidak ada
  // error, hanya pengenal yang diam-diam selalu menjawab tidak.
  /\bkenapa\b/i,
  /\bmengapa\b/i,
  /\bjelas(?:in|kan)\b/i,
  /\bdetail\b/i,
  /\bpenyebab\b/i,
  /\bdurasi\b/i,
  /\brincian\b/i,
  /\bbreakdown\b/i,
  /\bissue\s*nya\b/i,
  /\bapa\s+saja\b/i,
];

/**
 * Apakah pesan menanyakan detail sebuah mesin.
 *
 * Mengembalikan nama mesin hanya bila BENAR-BENAR cocok ke daftar mesin di
 * model. Pertanyaan yang menyebut mesin secara ambigu ditolak oleh
 * cocokkanMesin(), dan di sini itu berarti botnya minta diperjelas alih-alih
 * menjawab tentang mesin yang belum tentu dimaksud.
 */
export async function kenaliPertanyaanMesin(teks) {
  const t = String(teks || "").trim();
  if (!t) return { tanya: false, mesin: null };

  const adaKataTanya = POLA_TANYA.some((p) => p.test(t));
  const { cocokkanMesin } = await import("./powerbiSummary.service.js");
  const mesin = await cocokkanMesin(t);

  // Mesin dikenali sudah cukup walau tanpa kata tanya: "downtime hongju 2
  // gimana" tidak memuat kata di POLA_TANYA tapi jelas menanyakan mesin itu.
  if (mesin) return { tanya: true, mesin };
  return { tanya: adaKataTanya, mesin: null };
}

/** Teks dari berbagai bentuk pesan WhatsApp. */
function bacaTeks(msg) {
  const m = msg?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  );
}

/**
 * Apakah nomor bot disebut di pesan ini.
 *
 * Dua hal yang membuat versi pertama bisa gagal total, dan keduanya senyap:
 * botnya sekadar tidak pernah menjawab, tanpa error apa pun.
 *
 * 1. contextInfo TIDAK hanya ada di extendedTextMessage. Tag yang menyertai
 *    gambar atau video membawa contextInfo di imageMessage atau videoMessage,
 *    jadi membaca satu jenis saja melewatkan tag yang sah.
 *
 * 2. WhatsApp memakai LID di samping nomor telepon. mentionedJid bisa berisi
 *    LID (@lid), sementara sock.user.id berisi nomor (@s.whatsapp.net), dan
 *    membandingkan keduanya mentah akan selalu tidak cocok. Baileys v7
 *    menyediakan isLidUser justru karena ini nyata.
 */
function daftarMention(msg) {
  const m = msg?.message || {};
  const semua = [
    m.extendedTextMessage?.contextInfo,
    m.imageMessage?.contextInfo,
    m.videoMessage?.contextInfo,
    m.documentMessage?.contextInfo,
    m.audioMessage?.contextInfo,
    msg?.message?.contextInfo,
  ];
  const keluar = [];
  for (const ctx of semua) {
    for (const j of ctx?.mentionedJid || []) keluar.push(j);
  }
  return keluar;
}

function disebut(msg, user) {
  const daftar = daftarMention(msg);
  if (!daftar.length) return false;

  // Bagian setelah titik dua adalah penanda perangkat, misalnya
  // 628xx:12@s.whatsapp.net, dan harus dibuang sebelum dibandingkan.
  const bersih = (j) => String(j || "").split(":")[0].split("@")[0];

  // Identitas sendiri dikumpulkan dari SEMUA bentuk yang mungkin: id nomor, lid,
  // dan jid. Satu saja yang cocok sudah cukup.
  const akuSemua = new Set(
    [user?.id, user?.lid, user?.jid].filter(Boolean).map(bersih)
  );
  if (!akuSemua.size) return false;

  return daftar.some((j) => akuSemua.has(bersih(j)));
}

/**
 * Memasang listener pada socket Baileys.
 *
 * Dipanggil dari whatsapp.service.js setelah sesi terbuka. Aman dipanggil dua
 * kali pada socket yang sama karena Baileys menyimpan handler per socket dan
 * socket baru selalu memasang ulang.
 */
export function pasangListener(sock) {
  if (!listenerAktif()) {
    console.log("[WA] listener tidak aktif (WHATSAPP_LISTENER_ENABLED belum diisi)");
    return { aktif: false };
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages || []) {
      try {
        // Penjagaan 1. Lihat catatan di kepala berkas: tanpa ini, balasan bot
        // memicu dirinya sendiri.
        if (msg.key?.fromMe) continue;

        const jid = msg.key?.remoteJid || "";
        if (!jid.endsWith("@g.us")) continue; // hanya grup

        // Penjagaan 2.
        if (!disebut(msg, sock.user)) continue;

        const teks = bacaTeks(msg);

        // Pertanyaan detail diperiksa LEBIH DULU. Kalimat seperti "jelasin
        // kenapa Tetra Line 3 downtime-nya tinggi" memuat kata yang menyerupai
        // permintaan laporan, dan tanpa urutan ini ia akan dijawab dengan
        // ringkasan seluruh plant yang tidak menjawab apa pun.
        const pertanyaan = await kenaliPertanyaanMesin(teks);
        if (pertanyaan.mesin) {
          if (sedangJalan.has(jid)) {
            await balas(sock, jid, msg, "Masih mengerjakan permintaan sebelumnya. Mohon tunggu.");
            continue;
          }
          sedangJalan.add(jid);
          try {
            await jawabPertanyaanMesin(sock, jid, msg, pertanyaan.mesin);
          } finally {
            sedangJalan.delete(jid);
          }
          continue;
        }
        // Pertanyaan yang tidak menunjuk mesin tertentu dijawab dari snapshot
        // tersimpan lewat AI. Sebelumnya jalur ini hanya membalas "sebutkan nama
        // mesinnya", padahal banyak pertanyaan yang sah memang bukan tentang satu
        // mesin: berapa OEE minggu ini, gedung mana paling banyak downtime,
        // deviasi CMD 2 berapa.
        if (pertanyaan.tanya) {
          if (sedangJalan.has(jid)) {
            await balas(sock, jid, msg, "Masih mengerjakan permintaan sebelumnya. Mohon tunggu.");
            continue;
          }
          sedangJalan.add(jid);
          try {
            await jawabPertanyaanUmum(sock, jid, msg, teks);
          } finally {
            sedangJalan.delete(jid);
          }
          continue;
        }

        const { minta, alasan } = kenaliPermintaan(teks);

        if (!minta) {
          await balas(sock, jid, msg,
            "Saya bisa dua hal. Pertama, mengirim ringkasan operasional terbaru: " +
            "tag saya dengan kata seperti update, rekap, atau ringkasan. Kedua, " +
            "menjelaskan detail downtime satu mesin: sebutkan nama mesinnya, " +
            "misalnya kenapa Tetra Pak Line 3 downtime-nya tinggi.");
          console.log(`[WA] tag diabaikan: ${alasan}`);
          continue;
        }

        // Penjagaan 3.
        if (sedangJalan.has(jid)) {
          await balas(sock, jid, msg, "Ringkasannya sedang saya siapkan. Mohon tunggu sebentar.");
          continue;
        }
        const lalu = terakhirDilayani.get(jid) || 0;
        const sisa = JEDA_MS - (Date.now() - lalu);
        if (sisa > 0) {
          await balas(sock, jid, msg,
            `Ringkasan terakhir baru saja dikirim. Bisa diminta lagi dalam ${Math.ceil(sisa / 60000)} menit.`);
          continue;
        }

        sedangJalan.add(jid);
        try {
          await layaniPermintaan(sock, jid, msg);
        } finally {
          sedangJalan.delete(jid);
          terakhirDilayani.set(jid, Date.now());
        }
      } catch (err) {
        console.error("[WA] listener gagal memproses pesan:", err?.message || err);
      }
    }
  });

  console.log(`[WA] listener aktif, jeda ${Math.round(JEDA_MS / 60000)} menit per grup`);
  return { aktif: true, jedaMs: JEDA_MS };
}

/** Membalas dengan mengutip pesan penanya, supaya jelas menjawab siapa. */
async function balas(sock, jid, msg, teks) {
  try {
    await sock.sendMessage(jid, { text: teks }, { quoted: msg });
  } catch (err) {
    console.error("[WA] gagal membalas:", err?.message || err);
  }
}

/**
 * Menjalankan pipeline sambil melaporkan kemajuan ke grup.
 *
 * Kemajuan dilaporkan karena pipeline butuh sekitar dua sampai tiga menit. Tanpa
 * kabar apa pun, penanya menyangka botnya mati lalu menge-tag berulang kali.
 *
 * Pesan kemajuan dibatasi pada tahap yang berarti bagi manusia, bukan setiap
 * baris log: banjir pemberitahuan sama tidak berguna dengan sunyi.
 */
async function layaniPermintaan(sock, jid, msg) {
  const { kumpulkanTerkunci, kirimTerkunci } = await import("../scheduler/dailySummaryJob.js");
  const { batalkanTerkirim } = await import("./historicalStore.service.js");

  const tgl = jendelaLaporan().tanggal;
  await balas(sock, jid, msg, "Siap, saya tarik datanya dulu. Biasanya sekitar dua sampai tiga menit.");

  const sudahDikabari = new Set();
  const onProgress = ({ tahap, ekstra }) => {
    const kabar = {
      "minggu ditarik": "Data mingguan dari Power BI sudah masuk. Lanjut menyusun analisis.",
      gemini: ekstra?.startsWith("ok")
        ? "Analisis selesai disusun. Sedang saya kirim."
        : "Analisis AI tidak tersedia kali ini, jadi saya kirim angkanya apa adanya.",
    }[tahap];
    if (!kabar || sudahDikabari.has(tahap)) return;
    sudahDikabari.add(tahap);
    // Tidak di-await: menunggu pengiriman kabar akan memperlambat job yang
    // sedang ditunggu orang, dan kabar yang gagal bukan alasan job berhenti.
    balas(sock, jid, msg, kabar).catch(() => {});
  };

  const kumpul = await kumpulkanTerkunci({ dryRun: false, onProgress, holder: "wa-listener" });
  if (!kumpul.dijalankan) {
    await balas(sock, jid, msg, `Belum bisa dijalankan sekarang: ${kumpul.alasan}`);
    return;
  }

  // Dipaksa kirim ulang: laporan hari ini mungkin sudah terkirim otomatis, dan
  // penanya justru meminta yang terbaru. Tanpa ini ia akan mendapat jawaban
  // "sudah terkirim" untuk permintaan yang baru saja ia ajukan.
  await batalkanTerkirim(tgl);

  const kirim = await kirimTerkunci({ dryRun: false, holder: "wa-listener" });
  if (!kirim.dijalankan) {
    await balas(sock, jid, msg, `Pengiriman terhalang: ${kirim.alasan}`);
    return;
  }
  if (!kirim.hasil?.berhasil) {
    await balas(sock, jid, msg, `Maaf, pengirimannya gagal: ${kirim.hasil?.alasan || "sebab tidak diketahui"}`);
  }
}

/**
 * Menjawab pertanyaan detail satu mesin.
 *
 * Jauh lebih ringan daripada pipeline ringkasan: satu query DAX, tanpa Gemini,
 * tanpa menyentuh historical store. Karena itu ia TIDAK dibatasi jeda sepuluh
 * menit seperti permintaan ringkasan; membatasinya sama beratnya akan membuat
 * tanya jawab tidak berguna.
 */
async function jawabPertanyaanMesin(sock, jid, msg, mesin) {
  const { detailDowntimeMesin } = await import("./powerbiSummary.service.js");
  const { jendelaMinggu, jendelaLaporan } = await import("../utils/dateWindow.util.js");
  const { sanitasiTeks } = await import("../utils/sanitizeText.util.js");

  await balas(sock, jid, msg, `Sebentar, saya cek detail downtime ${mesin}.`);

  const minggu = jendelaMinggu(jendelaLaporan().tanggal);
  const r = await detailDowntimeMesin({ namaMesin: mesin, jendela: minggu, n: 6 });

  if (!r.berhasil) {
    await balas(sock, jid, msg, `Maaf, gagal mengambil datanya: ${r.alasan}`);
    return;
  }
  if (!r.baris.length) {
    await balas(sock, jid, msg,
      `Tidak ada catatan downtime untuk ${mesin} pada periode ${minggu.mulaiTanggal} sampai ${minggu.selesaiTanggal}.`);
    return;
  }

  const total = r.baris.reduce((n, b) => n + b.durasi, 0);
  const baris = [
    `*DETAIL DOWNTIME ${mesin.toUpperCase()}*`,
    `Periode ${minggu.mulaiTanggal} sampai ${minggu.selesaiTanggal}`,
    `Total ${total.toLocaleString("id-ID", { maximumFractionDigits: 0 })} dari ${r.baris.length} sebab teratas`,
    "",
  ];

  for (const b of r.baris) {
    // Teks Issue dan Action berasal dari entri operator, jadi disanitasi.
    const section = sanitasiTeks(b.section, 40) || "(tanpa section)";
    const issue = sanitasiTeks(b.issue, 120);
    const action = sanitasiTeks(b.action, 120);
    baris.push(
      `- ${section}: ${b.durasi.toLocaleString("id-ID", { maximumFractionDigits: 0 })}` +
      ` (${b.kejadian} kejadian)`
    );
    if (issue) baris.push(`  Issue: ${issue}`);
    if (action) baris.push(`  Action: ${action}`);
  }

  // Satuannya belum dipastikan pemilik, jadi disebut apa adanya alih-alih
  // menulis jam atau menit yang bisa salah 60 kali lipat.
  baris.push("", `_Satuan durasi ${r.satuanDurasi}. Diambil langsung dari Dashboard DT ORS._`);

  // String.fromCharCode(10) alih-alih menulis escape baris baru langsung: berkas
  // ini pernah rusak sintaksnya karena skrip suntingan menerjemahkan escape-nya
  // menjadi baris baru sungguhan di tengah string.
  await balas(sock, jid, msg, baris.join(String.fromCharCode(10)));
}

/**
 * Menjawab pertanyaan bebas dari snapshot tersimpan.
 *
 * Tidak menarik ulang dari Power BI: penarikan penuh butuh dua sampai tiga menit
 * dan orang yang bertanya di grup menunggu jawaban, bukan laporan. Snapshot
 * disegarkan tiap penarikan, jadi datanya sama dengan laporan terakhir.
 */
async function jawabPertanyaanUmum(sock, jid, msg, teks) {
  const { jawabDariSnapshot } = await import("./whatsappQA.service.js");

  await balas(sock, jid, msg, "Sebentar, saya cek datanya.");

  const r = await jawabDariSnapshot({ pertanyaan: teks });

  if (!r.berhasil) {
    await balas(sock, jid, msg,
      `Maaf, belum bisa saya jawab: ${r.alasan}. ` +
      "Untuk laporan lengkap, tag saya dengan kata update atau ringkasan.");
    return;
  }

  // Periode DISEBUT di setiap jawaban. Tanpa itu, angka minggu lalu bisa terbaca
  // sebagai angka minggu ini, dan pembacanya tidak punya cara mengetahuinya.
  await balas(sock, jid, msg, `${r.teks}

_Berdasarkan data periode ${r.periode}._`);
}

/** Keadaan listener, untuk endpoint status. */
export function statusListener() {
  return {
    aktif: listenerAktif(),
    jedaMenit: Math.round(JEDA_MS / 60000),
    grupSedangJalan: [...sedangJalan].length,
    grupPernahDilayani: terakhirDilayani.size,
  };
}
