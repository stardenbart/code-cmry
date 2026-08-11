// Pool koneksi MySQL, BUKAN koneksi tunggal.
//
// Sebelumnya berkas ini memakai mysql.createConnection, yaitu satu koneksi untuk
// seluruh aplikasi, tanpa pool dan tanpa penyambungan ulang. Akibatnya nyata dan
// sudah terjadi: kalau MySQL sempat tidak terjangkau saat proses boot, atau
// koneksinya diputus di tengah jalan oleh server maupun firewall, proses itu
// melayani 500 untuk SETIAP rute yang menyentuh database, selamanya, sampai
// seseorang merestartnya. Satu-satunya jejaknya cuma sebaris
// "Database connection failed" di awal log, lalu ratusan
// "Can't add new command when connection is in closed state" sesudahnya.
//
// Pool memperbaiki itu karena koneksi dibuat per permintaan dan koneksi yang
// rusak dibuang lalu diganti. Satu gangguan sesaat tidak lagi melumpuhkan proses
// sampai direstart.
import mysql from "mysql2";
import { DB_CONFIG } from "./config.js";

const db = mysql.createPool({
  ...DB_CONFIG,
  waitForConnections: true,
  // Query yang datang saat semua koneksi sedang sibuk menunggu, bukan ditolak.
  // Ditolak berarti error yang sampai ke user padahal databasenya sehat.
  queueLimit: 0,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  // Koneksi yang diam lama sering diputus sepihak oleh server atau perangkat di
  // tengah tanpa memberi tahu klien. Keepalive membuat pemutusan itu terdeteksi
  // dan koneksinya diganti, bukan dipakai lagi lalu gagal.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

// Pemeriksaan awal ini hanya untuk memberi kabar cepat saat menyalakan backend.
// SENGAJA tidak fatal dan tidak menghentikan proses: pool akan mencoba menyambung
// lagi pada query berikutnya, jadi gagal di sini bukan berarti aplikasinya
// lumpuh. Inilah bedanya dengan perilaku lama.
db.promise()
  .query("SELECT 1")
  .then(() => console.log("✅ MySQL pool siap (Central of Digitalization)"))
  .catch((err) =>
    console.error(
      `❌ MySQL belum terjangkau saat boot: ${err?.code || err?.message}. ` +
        "Pool akan mencoba lagi pada query berikutnya."
    )
  );

export default db;
