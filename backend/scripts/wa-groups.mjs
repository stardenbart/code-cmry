// ─────────────────────────────────────────────────────────────────────────────
// Mencari WHATSAPP_GROUP_ID dengan menanyakannya langsung ke akun WhatsApp.
//
// Jalankan:  node scripts/wa-groups.mjs
//
// Pemakaian pertama akan menampilkan QR di terminal. Pindai dari WhatsApp di
// ponsel nomor pengirim: Setelan, Perangkat tertaut, Tautkan perangkat.
// Sesinya disimpan ke WHATSAPP_SESSION_DIR sehingga pemakaian berikutnya tidak
// perlu memindai lagi.
//
// Kenapa perlu skrip terpisah, bukan cukup melihat WhatsApp Web: id grup di URL
// WhatsApp Web bukan jid yang dipakai Baileys. Yang dibutuhkan berbentuk
// 1234567890-123456@g.us atau angka panjang@g.us, dan satu-satunya sumber yang
// bisa dipercaya adalah akun itu sendiri. Menebaknya berarti pesan terkirim ke
// grup yang salah, dan itu tidak bisa ditarik kembali.
//
// Skrip ini HANYA MEMBACA. Tidak ada pesan yang dikirim.
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";

const DIR = process.env.WHATSAPP_SESSION_DIR || "./.wa-session";

let baileys;
try {
  baileys = await import("@whiskeysockets/baileys");
} catch {
  console.error("Paket @whiskeysockets/baileys belum terpasang.");
  console.error("Jalankan: npm install @whiskeysockets/baileys");
  process.exit(1);
}

const makeWASocket = baileys.default || baileys.makeWASocket;
const { useMultiFileAuthState, DisconnectReason } = baileys;

const { state, saveCreds } = await useMultiFileAuthState(DIR);
const sock = makeWASocket({ auth: state, syncFullHistory: false });

sock.ev.on("creds.update", saveCreds);

let sudahTampilQr = false;

sock.ev.on("connection.update", async (u) => {
  if (u.qr && !sudahTampilQr) {
    sudahTampilQr = true;
    console.log("\nPindai QR di bawah ini dari WhatsApp nomor pengirim.");
    console.log("WhatsApp, Setelan, Perangkat tertaut, Tautkan perangkat.\n");
    try {
      const m = await import("qrcode-terminal");
      (m.default || m).generate(u.qr, { small: true });
    } catch {
      console.log(u.qr);
    }
  }

  if (u.connection === "close") {
    const kode = u.lastDisconnect?.error?.output?.statusCode;
    if (kode === DisconnectReason?.loggedOut) {
      console.error(`\nSesi sudah logout. Hapus direktori ${DIR} lalu jalankan lagi.`);
      process.exit(1);
    }
    console.error(`\nKoneksi tertutup, kode ${kode ?? "tidak diketahui"}. Jalankan lagi.`);
    process.exit(1);
  }

  if (u.connection !== "open") return;

  console.log(`\nTersambung sebagai ${sock.user?.id || "(tidak diketahui)"}\n`);

  try {
    const grup = await sock.groupFetchAllParticipating();
    const daftar = Object.values(grup || {});

    if (!daftar.length) {
      console.log("Nomor ini tidak tergabung di grup mana pun.");
      console.log("Masukkan nomornya ke grup laporan dulu, lalu jalankan skrip ini lagi.");
    } else {
      console.log(`${daftar.length} grup ditemukan.\n`);
      // Diurut berdasarkan nama supaya grup yang dicari mudah ditemukan mata.
      daftar.sort((a, b) => String(a.subject || "").localeCompare(String(b.subject || "")));
      for (const g of daftar) {
        console.log(`  ${g.subject || "(tanpa nama)"}`);
        console.log(`    WHATSAPP_GROUP_ID=${g.id}`);
        console.log(`    anggota: ${g.participants?.length ?? "?"}\n`);
      }
      console.log("Salin satu baris WHATSAPP_GROUP_ID di atas ke backend/.env");
    }
  } catch (err) {
    console.error("Gagal mengambil daftar grup:", err?.message || err);
  }

  // Sesi ditutup eksplisit. Tanpa ini prosesnya menggantung karena socketnya
  // masih terbuka, dan skrip sekali jalan tidak pernah selesai.
  try {
    await sock.end?.();
  } catch {
    /* menutup sesi yang sudah mati bukan kegagalan */
  }
  process.exit(0);
});

// Jaring waktu. Tanpa ini, kegagalan pairing membuat skrip menggantung tanpa
// pesan apa pun dan tidak jelas apakah masih menunggu QR dipindai.
setTimeout(() => {
  console.error("\nTidak tersambung dalam 120 detik. Kalau QR muncul tapi belum dipindai, jalankan lagi.");
  process.exit(1);
}, 120_000);
