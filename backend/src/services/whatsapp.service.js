// ─────────────────────────────────────────────────────────────────────────────
// Pengiriman pesan WhatsApp (spec §13).
//
// PERINGATAN YANG HARUS DIBACA SEBELUM MENGAKTIFKAN
//
// Provider `baileys` adalah klien WhatsApp TIDAK RESMI. Memakainya melanggar
// Terms of Service WhatsApp. Risiko nyata, bukan teoretis:
//
//   - Nomor pengirim bisa dibatasi atau diblokir permanen oleh WhatsApp
//   - Sesi bisa terputus sewaktu-waktu, dan job akan gagal tanpa sebab yang
//     jelas dari sisi kode
//   - Tidak ada dukungan resmi bila terjadi masalah
//
// Keputusan memakainya diambil pemilik pada 2026-08-04 dengan kesadaran penuh,
// karena Cloud API resmi tidak mendukung kirim ke Group tanpa use case yang
// di-approve Meta. Gunakan nomor khusus, BUKAN nomor pribadi siapa pun.
//
// Baileys dipilih daripada whatsapp-web.js karena yang kedua menjalankan
// Chromium lewat Puppeteer, sekitar 300 MB dan satu proses browser penuh di
// server, hanya untuk mengirim satu pesan sehari.
//
// Paketnya dimuat lewat import dinamis dan TIDAK terpasang secara bawaan, supaya
// seluruh modul ini bisa dimuat, diuji, dan dijalankan dalam mode dry-run tanpa
// dependensi berat. Untuk mengaktifkan:
//
//   npm install @whiskeysockets/baileys
//   WHATSAPP_PROVIDER=baileys
//   WHATSAPP_TARGET_MODE=group
//   WHATSAPP_GROUP_ID=1234567890-123456@g.us
//
// Pairing perlu sekali pemindaian QR di konsol server, dan sesinya disimpan ke
// direktori WHATSAPP_SESSION_DIR supaya restart tidak menuntut pemindaian ulang.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDER_SAH = ["dryrun", "baileys", "whatsapp_web_js", "cloud_api"];
export const TARGET_SAH = ["group", "individual"];

/**
 * Konfigurasi dari env, beserta hasil pemeriksaannya.
 *
 * Provider bawaannya `dryrun`, bukan baileys. Sebuah job yang salah konfigurasi
 * harus DIAM, bukan mengirim ke grup yang salah: pesan yang salah kirim ke grup
 * manajemen tidak bisa ditarik kembali.
 */
export function konfigurasi() {
  const provider = String(process.env.WHATSAPP_PROVIDER || "dryrun").trim();
  const targetMode = String(process.env.WHATSAPP_TARGET_MODE || "group").trim();
  const groupId = String(process.env.WHATSAPP_GROUP_ID || "").trim();
  const daftarNomor = String(process.env.WHATSAPP_RECIPIENT_LIST || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const masalah = [];
  if (!PROVIDER_SAH.includes(provider)) masalah.push(`WHATSAPP_PROVIDER "${provider}" tidak dikenal`);
  if (!TARGET_SAH.includes(targetMode)) masalah.push(`WHATSAPP_TARGET_MODE "${targetMode}" tidak dikenal`);

  if (provider !== "dryrun") {
    if (targetMode === "group" && !groupId) masalah.push("WHATSAPP_GROUP_ID wajib diisi untuk target group");
    if (targetMode === "individual" && !daftarNomor.length) {
      masalah.push("WHATSAPP_RECIPIENT_LIST wajib diisi untuk target individual");
    }
    // Cloud API resmi tidak mendukung kirim ke Group. Membiarkan kombinasi ini
    // lolos berarti job gagal tiap hari dengan pesan dari Meta yang sulit
    // dibaca, alih-alih ditolak sekali saat startup.
    if (provider === "cloud_api" && targetMode === "group") {
      masalah.push("cloud_api tidak mendukung target group, pakai individual atau ganti provider");
    }
    if (targetMode === "group" && !/@g\.us$/.test(groupId)) {
      masalah.push("WHATSAPP_GROUP_ID harus berakhiran @g.us");
    }
  }

  return { provider, targetMode, groupId, daftarNomor, masalah, siap: masalah.length === 0 };
}

/** Tujuan pengiriman menurut konfigurasi. */
function daftarTujuan(cfg) {
  return cfg.targetMode === "group" ? [cfg.groupId] : cfg.daftarNomor.map((n) => `${n.replace(/\D/g, "")}@s.whatsapp.net`);
}

// ── Provider: dryrun ────────────────────────────────────────────────────────

/**
 * Tidak mengirim apa pun, hanya melaporkan apa yang AKAN dikirim.
 *
 * Ini yang dituntut §15 sebelum go-live, dan sekaligus bawaan yang aman.
 */
async function kirimDryrun(pesan, cfg) {
  return {
    terkirim: true,
    dryRun: true,
    provider: "dryrun",
    tujuan: daftarTujuan(cfg),
    panjangPesan: pesan.length,
    cuplikan: pesan.slice(0, 300),
  };
}

// ── Provider: baileys ───────────────────────────────────────────────────────

let sesiBaileys = null;

/**
 * Membuka sesi Baileys, memakai sesi tersimpan bila ada.
 *
 * Impor dinamis, bukan impor statis di kepala berkas: dengan impor statis,
 * seluruh berkas ini gagal dimuat bila paketnya belum dipasang, dan itu akan
 * menjatuhkan mode dry-run yang justru harus jalan tanpa paket apa pun.
 */
async function sesi() {
  if (sesiBaileys) return sesiBaileys;

  let baileys;
  try {
    baileys = await import("@whiskeysockets/baileys");
  } catch {
    throw new Error(
      "paket @whiskeysockets/baileys belum dipasang. Jalankan: npm install @whiskeysockets/baileys"
    );
  }

  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason } = baileys;

  const dir = process.env.WHATSAPP_SESSION_DIR || "./.wa-session";
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const sock = makeWASocket({
    auth: state,
    // QR dicetak ke konsol: pairing perlu sekali pemindaian oleh manusia, dan
    // tidak ada cara mengotomatiskannya.
    printQRInTerminal: true,
    // Riwayat tidak disinkronkan. Job ini hanya mengirim, dan sinkronisasi
    // riwayat grup besar memakan memori serta waktu tanpa guna apa pun di sini.
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (u) => {
    if (u.connection === "close") {
      const alasan = u.lastDisconnect?.error?.output?.statusCode;
      // Sesi dilupakan supaya panggilan berikutnya membuka koneksi baru. Tanpa
      // ini, socket mati tetap dipakai dan tiap pengiriman gagal dengan pesan
      // yang menyesatkan.
      sesiBaileys = null;
      console.warn(`[WA] koneksi tertutup, kode ${alasan ?? "tidak diketahui"}`);
      if (alasan === DisconnectReason?.loggedOut) {
        console.warn("[WA] sesi sudah logout, hapus WHATSAPP_SESSION_DIR dan pindai QR lagi");
      }
    }
  });

  // Menunggu sambungan terbuka. Tanpa penantian ini, pengiriman pertama sesudah
  // restart akan gagal karena socketnya belum siap.
  await new Promise((resolve, reject) => {
    const batas = setTimeout(
      () => reject(new Error("sambungan WhatsApp tidak terbuka dalam 60 detik, mungkin perlu pindai QR")),
      60_000
    );
    sock.ev.on("connection.update", (u) => {
      if (u.connection === "open") {
        clearTimeout(batas);
        resolve();
      }
    });
  });

  sesiBaileys = sock;
  return sock;
}

async function kirimBaileys(pesan, cfg) {
  const sock = await sesi();
  const tujuan = daftarTujuan(cfg);
  const gagal = [];

  for (const jid of tujuan) {
    try {
      await sock.sendMessage(jid, { text: pesan });
    } catch (err) {
      gagal.push(`${jid}: ${String(err.message).slice(0, 80)}`);
    }
  }

  if (gagal.length === tujuan.length) {
    return { terkirim: false, provider: "baileys", tujuan, alasan: gagal.join("; ") };
  }
  return {
    terkirim: true,
    provider: "baileys",
    tujuan,
    ...(gagal.length ? { sebagianGagal: gagal } : {}),
  };
}

// ── Antarmuka publik ────────────────────────────────────────────────────────

/**
 * Mengirim ringkasan harian.
 *
 * Tidak melempar: pemanggilnya job terjadwal, dan kegagalan pengiriman harus
 * bisa dibedakan dari kegagalan pembuatan laporan supaya alert-nya tepat.
 *
 * @param {string} pesan
 * @returns {Promise<{terkirim: boolean, provider: string, tujuan?: string[], alasan?: string, dryRun?: boolean}>}
 */
export async function sendDailySummary(pesan) {
  const teks = String(pesan || "").trim();
  if (!teks) return { terkirim: false, provider: "-", alasan: "pesan kosong" };

  const cfg = konfigurasi();
  if (!cfg.siap) {
    return { terkirim: false, provider: cfg.provider, alasan: `konfigurasi tidak sah: ${cfg.masalah.join("; ")}` };
  }

  try {
    if (cfg.provider === "dryrun") return await kirimDryrun(teks, cfg);
    if (cfg.provider === "baileys") return await kirimBaileys(teks, cfg);
    return {
      terkirim: false,
      provider: cfg.provider,
      alasan: `provider ${cfg.provider} belum diimplementasikan; pakai dryrun atau baileys`,
    };
  } catch (err) {
    return { terkirim: false, provider: cfg.provider, alasan: String(err.message).slice(0, 200) };
  }
}

/** Menutup sesi. Dipakai saat shutdown supaya proses tidak tertahan. */
export async function tutupSesi() {
  if (!sesiBaileys) return;
  try {
    await sesiBaileys.end?.();
  } catch {
    /* menutup sesi yang sudah mati bukan kegagalan */
  }
  sesiBaileys = null;
}
