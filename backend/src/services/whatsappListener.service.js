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
import { getCiaIdentityText, isCiaIdentityQuestion } from "./ciaIdentity.js";
import { sudahDisapa, tandaiSudahDisapa } from "../models/waGroupIntroModel.js";
import { startCiaTelemetry } from "./ciaTelemetry.service.js";

// ── Topik terakhir per grup ───────────────────────────────────────────────────
//
// Dipakai supaya perintah lanjutan seperti "detailkan" bisa dijawab dengan
// menyebut topik yang baru dibahas, bukan ditolak.
//
// SENGAJA di memori, bukan di database. Konteks percakapan lanjutan memang wajar
// hilang ketika proses restart: user tinggal menyebut ulang subjeknya. Ini beda
// dari penjaga perkenalan grup, yang harus bertahan justru karena bot ini sering
// reconnect. Masa berlakunya pendek karena "detailkan" tiga jam kemudian hampir
// pasti bukan lanjutan dari topik tadi.
const topikGrup = new Map(); // jid -> { topik, waktu }
const percakapanEvidence = new Map(); // jid -> { turns, waktu }
const TOPIK_BERLAKU_MS = Number(process.env.WA_TOPIK_TTL_MS) || 30 * 60 * 1000;

/** Menyimpan topik yang baru dijawab di sebuah grup. */
export function catatTopikGrup(jid, topik) {
  const t = String(topik || "").trim();
  if (!jid || !t) return;
  topikGrup.set(String(jid), { topik: t.slice(0, 120), waktu: Date.now() });
}

/** Topik terakhir di grup itu, atau null bila tidak ada atau sudah kedaluwarsa. */
export function topikTerakhirGrup(jid, sekarang = Date.now()) {
  const entri = topikGrup.get(String(jid || ""));
  if (!entri) return null;
  if (sekarang - entri.waktu > TOPIK_BERLAKU_MS) {
    topikGrup.delete(String(jid));
    return null;
  }
  return entri.topik;
}

/** Membuang ingatan topik. Dipakai uji supaya tidak saling mempengaruhi. */
export function lupakanTopikGrup(jid) {
  if (jid === undefined) {
    topikGrup.clear();
    percakapanEvidence.clear();
  } else {
    topikGrup.delete(String(jid));
    percakapanEvidence.delete(String(jid));
  }
}

function riwayatEvidence(jid, sekarang = Date.now()) {
  const key = String(jid || "");
  const entry = percakapanEvidence.get(key);
  if (!entry) return [];
  if (sekarang - entry.waktu > TOPIK_BERLAKU_MS) {
    percakapanEvidence.delete(key);
    return [];
  }
  return entry.turns;
}

function catatEvidence(jid, question, answer) {
  const turns = [...riwayatEvidence(jid),
    { role: "user", text: String(question || "").trim().slice(0, 1_000) },
    { role: "assistant", text: String(answer?.answer || "").trim().slice(0, 1_000),
      ...(answer?.evidenceContract ? { evidenceContract: answer.evidenceContract } : {}) },
  ].filter((turn) => turn.text).slice(-12);
  percakapanEvidence.set(String(jid), { turns, waktu: Date.now() });
}

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
 * Apakah bot boleh mengirim perkenalan ke grup ini.
 *
 * Fungsi murni, diekstrak dari handler group-participants.update supaya bisa
 * diuji tanpa menyalakan socket WhatsApp. Menolak secara default: JID kosong,
 * JID perorangan (berakhiran @s.whatsapp.net, bukan @g.us), daftar grup yang
 * bukan array, atau grup yang tidak terdaftar semuanya ditolak. Perkenalan ini
 * hanya untuk grup yang eksplisit didaftarkan lewat WHATSAPP_GROUP_ID, supaya
 * bot tidak memperkenalkan diri di grup sembarang yang kebetulan memasukkannya.
 *
 * @param {{jidGrup: string, daftarGrup: string[]}} arg
 * @returns {boolean}
 */
export function bolehDisapa({ jidGrup, daftarGrup } = {}) {
  if (!jidGrup || typeof jidGrup !== "string") return false;
  if (!jidGrup.endsWith("@g.us")) return false; // JID perorangan, bukan grup
  if (!Array.isArray(daftarGrup)) return false;
  return daftarGrup.includes(jidGrup);
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

        // Pertanyaan identitas dijawab PALING AWAL, dari kode, tanpa memanggil
        // model dan tanpa menyentuh Power BI. Nol kuota, nol latensi, dan
        // jawabannya tidak mungkin dikarang karena diambil dari sumber teks yang
        // sama dengan perkenalan saat bot masuk grup.
        //
        // Sebelumnya pemeriksaan ini hanya terpasang di tryAnswerLocally, yaitu
        // jalur web. Di WhatsApp "siapa kamu" tidak pernah sampai ke sana dan
        // jatuh ke cabang di luar konteks, sehingga dijawab "pertanyaan ini
        // belum bisa saya jawab" untuk pertanyaan yang justru paling bisa
        // dijawab sendiri.
        if (isCiaIdentityQuestion(teks)) {
          await balas(sock, jid, msg, getCiaIdentityText());
          console.log("[WA] pertanyaan identitas dijawab lokal");
          continue;
        }

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
            // Dicatat SESUDAH dijawab, supaya "detailkan" berikutnya menyebut
            // topik yang benar-benar sudah dibahas, bukan yang gagal dijawab.
            catatTopikGrup(jid, pertanyaan.mesin);
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
          // Contoh diambil dari daftar sebenarnya, bukan ditulis tangan. Contoh
          // yang ditulis tangan akan basi begitu daftar mesin berubah, dan tidak
          // ada yang tahu.
          const { susunBalasanDiLuarKonteks, susunBalasanTidakLengkap, tanyaTidakLengkap } =
            await import("./gayaBahasa.js");
          const { daftarMesin } = await import("./powerbiSummary.service.js");
          const { periodeLemburUntukTanggal, jendelaLaporan } =
            await import("../utils/dateWindow.util.js");
          const { catatPertanyaan } = await import("../models/ciaPertanyaanModel.js");

          const mesin = await daftarMesin().catch(() => []);

          // Perintah tanpa subjek, misalnya "bandingkan" atau "detailkan",
          // ditangani TERPISAH. Itu pertanyaan lanjutan yang subjeknya ada di
          // pesan sebelumnya, bukan pertanyaan di luar data. Menjawabnya dengan
          // penolakan generik membuat user mengulang lalu ditolak lagi.
          if (tanyaTidakLengkap(teks)) {
            await catatPertanyaan({ groupJid: jid, pertanyaan: teks, jenis: "tidak_lengkap" });
            await balas(sock, jid, msg, susunBalasanTidakLengkap({
              perintah: String(teks || "").replace(/@[\w\s.]{1,24}?(?=\s|$)/g, " ").trim(),
              topikTerakhir: topikTerakhirGrup(jid),
              contohMesin: mesin,
            }));
            console.log(`[WA] perintah tanpa subjek: ${String(teks || "").slice(0, 60)}`);
            continue;
          }

          const periode = (() => {
            try {
              return periodeLemburUntukTanggal(jendelaLaporan().tanggal).label;
            } catch {
              return null;
            }
          })();

          // Janji perbaikan hanya diucapkan bila pencatatannya benar-benar
          // berhasil, supaya bot tidak menjanjikan sesuatu yang tidak terjadi.
          const catat = await catatPertanyaan({ groupJid: jid, pertanyaan: teks });

          await balas(sock, jid, msg, susunBalasanDiLuarKonteks({
            contohMesin: mesin.slice(0, 2),
            labelPeriodeLembur: periode,
            dicatat: catat.dicatat,
          }));
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

  // ── Perkenalan CIA saat bot dimasukkan ke grup ────────────────────────────
  //
  // Langganan baru: group-participants.update. Hanya menyapa sekali per grup
  // (dijaga oleh tabel wa_group_intro), dan hanya di grup yang terdaftar pada
  // WHATSAPP_GROUP_ID supaya bot tidak memperkenalkan diri di grup sembarang.
  sock.ev.on("group-participants.update", async ({ id: grupJid, participants, action }) => {
    try {
      if (action !== "add") return;

      // Apakah yang ditambahkan adalah bot ini sendiri?
      const bersih = (j) => String(j || "").split(":")[0].split("@")[0];
      const akuSemua = new Set(
        [sock.user?.id, sock.user?.lid, sock.user?.jid].filter(Boolean).map(bersih)
      );
      const botDitambahkan = (participants || []).some((p) => akuSemua.has(bersih(p)));
      if (!botDitambahkan) return;

      // Hanya sapa di grup yang terdaftar pada WHATSAPP_GROUP_ID.
      const daftarGrup = (process.env.WHATSAPP_GROUP_ID || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!bolehDisapa({ jidGrup: grupJid, daftarGrup })) {
        console.warn(`[WA] bot ditambahkan ke grup ${grupJid} yang TIDAK terdaftar, tidak menyapa`);
        return;
      }

      // Penjaga persistent: cek apakah sudah pernah disapa.
      if (await sudahDisapa(grupJid)) {
        console.log(`[WA] grup ${grupJid} sudah pernah disapa, lewati`);
        return;
      }

      // Catat lalu kirim perkenalan.
      await tandaiSudahDisapa(grupJid);
      await sock.sendMessage(grupJid, { text: getCiaIdentityText() });
      console.log(`[WA] perkenalan CIA terkirim ke grup ${grupJid}`);
    } catch (err) {
      console.error("[WA] gagal memproses group-participants.update:", err?.message || err);
    }
  });

  console.log(`[WA] listener aktif, jeda ${Math.round(JEDA_MS / 60000)} menit per grup`);
  return { aktif: true, jedaMs: JEDA_MS };
}

/** Membalas dengan mengutip pesan penanya, supaya jelas menjawab siapa. */
async function balas(sock, jid, msg, teks) {
  try {
    await sock.sendMessage(jid, { text: teks }, { quoted: msg });
    return true;
  } catch (err) {
    console.error("[WA] gagal membalas:", err?.message || err);
    return false;
  }
}

function tokenTelemetry(usage = {}) {
  const inputTokens = Number(
    usage.promptTokenCount ?? usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens
  ) || 0;
  const outputTokens = Number(
    usage.candidatesTokenCount ?? usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens
  ) || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(usage.totalTokenCount ?? usage.totalTokens ?? usage.total_tokens) || inputTokens + outputTokens,
  };
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
export async function jawabPertanyaanUmum(sock, jid, msg, teks, overrides = {}) {
  const { jawabDariSnapshot: defaultSnapshot } = await import("./whatsappQA.service.js");
  const { answerWithEvidence: defaultEvidence } = await import("./cia/evidenceOrchestrator.js");
  const jawabDariSnapshot = overrides.jawabDariSnapshot || defaultSnapshot;
  const answerWithEvidence = overrides.answerWithEvidence || defaultEvidence;
  const starter = overrides.startCiaTelemetry || startCiaTelemetry;
  const mulai = Date.now();
  let telemetry = null;
  try {
    telemetry = await starter({
      surface: "whatsapp",
      user: { name: "WhatsApp" },
      question: teks,
      conversationId: String(jid),
    });
    await telemetry?.event("request_received");
  } catch {
    telemetry = null;
  }

  const progressSent = await balas(sock, jid, msg, "Sebentar, saya cek datanya.");
  if (!progressSent) {
    await telemetry?.fail({ code: "WA_DELIVERY_FAILED" }, {
      retrievalMethod: "none", latencyMs: Date.now() - mulai,
    });
    return;
  }

  // Orchestrator yang sama dengan dashboard dan Multi-Chat menjadi jalur utama.
  // Finish/fail ditahan sampai sendMessage berhasil supaya telemetry tidak
  // menyatakan sukses saat jawaban sebenarnya gagal terkirim.
  let deferredFinish = null;
  let deferredFailure = null;
  let deferredResponse = null;
  const daxAttempts = [];
  const evidenceTracker = telemetry ? {
    requestId: telemetry.requestId,
    async event(stage, data = {}) {
      if (stage === "response_sent") deferredResponse = data;
      else {
        if (stage === "dax_attempt") daxAttempts.push(data);
        await telemetry.event(stage, data);
      }
    },
    async finish(data = {}) { deferredFinish = data; },
    async fail(error, data = {}) { deferredFailure = { error, data }; },
  } : null;

  let evidenceAnswer = null;
  try {
    evidenceAnswer = await answerWithEvidence({
      surface: "whatsapp",
      actor: { name: "WhatsApp" },
      question: teks,
      conversationId: String(jid),
      conversation: riwayatEvidence(jid),
      preferredDashboardIds: Array.isArray(overrides.preferredDashboardIds)
        ? overrides.preferredDashboardIds : [],
      reportContext: overrides.reportContext ?? null,
      accessMode: "centralized",
    }, evidenceTracker ? { tracker: evidenceTracker } : {});
  } catch (err) {
    deferredFailure = { error: err, data: { retrievalMethod: "none" } };
  }

  const emitLegacyDax = async (status) => {
    for (const attempt of daxAttempts) {
      await telemetry?.event("execute_dax", {
        semanticModel: attempt.semanticModel || null,
        rowsReturned: attempt.rowsReturned || null,
        status,
        errorCode: status === "success" ? null : "DAX_AGENT_FAILED",
        errorMessage: status === "success" ? null : "Kueri evidence WhatsApp belum menghasilkan jawaban",
      });
    }
  };

  if (evidenceAnswer?.answer?.trim() && evidenceAnswer.retrievalMethod !== "none") {
    await emitLegacyDax("success");
    const sent = await balas(sock, jid, msg, evidenceAnswer.answer);
    if (!sent) {
      await telemetry?.fail({ code: "WA_DELIVERY_FAILED" }, {
        retrievalMethod: evidenceAnswer.retrievalMethod, latencyMs: Date.now() - mulai,
      });
      return;
    }
    catatEvidence(jid, teks, evidenceAnswer);
    await telemetry?.event("response_sent", deferredResponse || {});
    await telemetry?.finish({
      ...(deferredFinish || {}),
      status: deferredFinish?.status || (evidenceAnswer.retrievalMethod === "live_dax" ? "success" : "partial"),
      retrievalMethod: evidenceAnswer.retrievalMethod,
      latencyMs: Date.now() - mulai,
      retrievalRounds: evidenceAnswer.rounds || deferredFinish?.retrievalRounds || 0,
    });
    return;
  }

  await emitLegacyDax("error");
  await telemetry?.event("fallback", {
    status: "error",
    errorCode: evidenceAnswer?.warnings?.[0] || deferredFailure?.error?.code || "EMPTY_RESULT",
    errorMessage: "Evidence live WhatsApp belum tersedia; memakai snapshot",
  });

  let r;
  try {
    r = await jawabDariSnapshot({ pertanyaan: teks });
  } catch (err) {
    await telemetry?.fail(err, { retrievalMethod: "none", latencyMs: Date.now() - mulai });
    await balas(sock, jid, msg, "Maaf, CIA sedang gagal membaca data cadangan. Silakan coba lagi.");
    return;
  }

  if (!r?.berhasil) {
    const sent = await balas(sock, jid, msg,
      `Maaf, belum bisa saya jawab: ${r?.alasan || "data belum tersedia"}. ` +
      "Untuk laporan lengkap, tag saya dengan kata update atau ringkasan.");
    await telemetry?.fail({ code: sent ? "EMPTY_RESULT" : "WA_DELIVERY_FAILED" }, {
      retrievalMethod: "none",
      latencyMs: Date.now() - mulai,
    });
    return;
  }

  // Periode DISEBUT di setiap jawaban. Tanpa itu, angka minggu lalu bisa terbaca
  // sebagai angka minggu ini, dan pembacanya tidak punya cara mengetahuinya.
  await telemetry?.event("ai_synthesis", {
    provider: r.provider || null,
    aiModel: r.modelVersion || null,
    ...tokenTelemetry(r.usage),
  });
  const snapshotAnswer = `${r.teks}

_Berdasarkan data periode ${r.periode}._`;
  const sent = await balas(sock, jid, msg, snapshotAnswer);
  if (!sent) {
    await telemetry?.fail({ code: "WA_DELIVERY_FAILED" }, {
      retrievalMethod: "snapshot", latencyMs: Date.now() - mulai,
    });
    return;
  }
  catatEvidence(jid, teks, { answer: snapshotAnswer });
  await telemetry?.event("snapshot_read");
  await telemetry?.event("response_sent");
  await telemetry?.finish({
    status: "fallback",
    retrievalMethod: "snapshot",
    latencyMs: Date.now() - mulai,
    retrievalRounds: 1,
  });
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
