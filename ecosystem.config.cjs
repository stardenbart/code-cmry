// Konfigurasi pm2 untuk backend CODE.
//
// Sebelum ada berkas ini, backend dijalankan lewat `pm2 start src/server.js`
// dengan pengaturan bawaan, dan setiap kali prosesnya mati seseorang harus
// mengetik `pm2 restart cod-backend` sendiri. Yang membuat itu perlu bukan
// ketiadaan restart otomatis (pm2 selalu merestart proses yang keluar), melainkan
// dua hal lain:
//
//   1. Proses yang MENGGANTUNG tidak pernah keluar, jadi pm2 tidak melihat
//      apa pun yang perlu direstart. Ini yang diurus scripts/watchdog.sh, karena
//      pm2 sendiri tidak bisa memeriksa HTTP.
//   2. Server yang di-boot ulang kehilangan seluruh daftar prosesnya kecuali
//      daftar itu sudah disimpan. Ini yang diurus `pm2 startup` + `pm2 save`,
//      dijelaskan di docs/DEPLOYMENT.md.
//
// Berkas ini .cjs, bukan .js, karena package.json memakai "type": "module"
// sementara pm2 membaca konfigurasinya dengan require().
module.exports = {
  apps: [
    {
      name: "cod-backend",
      script: "src/server.js",
      cwd: "./backend",
      instances: 1,
      exec_mode: "fork",

      // Kenaikan jeda tiap kali gagal. Tanpa ini, proses yang mati seketika saat
      // boot (misalnya .env rusak) direstart puluhan kali per detik dan mengisi
      // disk dengan log dalam beberapa menit.
      exp_backoff_restart_delay: 1000,

      // Sengaja dibatasi. Sesudah 15 kegagalan berturut-turut, penyebabnya bukan
      // gangguan sesaat, dan terus merestart hanya menyembunyikan masalahnya.
      // pm2 menandainya "errored" supaya terlihat di `pm2 list`.
      max_restarts: 15,

      // Proses yang bertahan selama ini dianggap berhasil menyala, sehingga
      // hitungan max_restarts direset.
      min_uptime: "30s",

      // Kebocoran memori dipangkas dengan restart, bukan dibiarkan sampai OOM
      // killer memilih korbannya sendiri.
      max_memory_restart: "600M",

      // Kebalikan dari nodemon. Di produksi, restart karena berkas berubah
      // berarti proses mati di tengah `git pull`.
      watch: false,

      env: {
        NODE_ENV: "production",
      },

      // Log dengan cap waktu, terpisah antara keluaran biasa dan galat. Tanpa cap
      // waktu, log pm2 tidak bisa dipakai untuk menghubungkan matinya proses
      // dengan kejadian lain.
      time: true,
      out_file: "./logs/cod-backend-out.log",
      error_file: "./logs/cod-backend-error.log",
      merge_logs: true,
    },
  ],
};
