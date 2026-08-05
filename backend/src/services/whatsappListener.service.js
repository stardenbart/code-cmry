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

/** Apakah nomor bot disebut di pesan ini. */
function disebut(msg, jidSendiri) {
  const ctx = msg?.message?.extendedTextMessage?.contextInfo;
  const daftar = ctx?.mentionedJid || [];
  // Nomor dibandingkan tanpa bagian setelah tanda titik dua: Baileys kadang
  // menyertakan penanda perangkat, misalnya 628xx:12@s.whatsapp.net, dan
  // perbandingan mentah akan selalu gagal.
  const bersih = (j) => String(j || "").split(":")[0].split("@")[0];
  const aku = bersih(jidSendiri);
  return daftar.some((j) => bersih(j) === aku);
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
        if (!disebut(msg, sock.user?.id)) continue;

        const teks = bacaTeks(msg);
        const { minta, alasan } = kenaliPermintaan(teks);

        if (!minta) {
          await balas(sock, jid, msg,
            "Saya hanya bisa mengirim ringkasan operasional terbaru. " +
            "Tag saya dengan kata seperti update, rekap, atau ringkasan.");
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

/** Keadaan listener, untuk endpoint status. */
export function statusListener() {
  return {
    aktif: listenerAktif(),
    jedaMenit: Math.round(JEDA_MS / 60000),
    grupSedangJalan: [...sedangJalan].length,
    grupPernahDilayani: terakhirDilayani.size,
  };
}
