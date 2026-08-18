#!/usr/bin/env bash
# Pengawas untuk hal yang tidak bisa dilihat pm2: proses yang HIDUP tapi tidak
# lagi melayani.
#
# pm2 memantau apakah prosesnya keluar. Proses Node yang menggantung — event loop
# terkunci, atau kehabisan file descriptor — tidak keluar, jadi pm2 melaporkannya
# "online" selamanya sementara setiap permintaan menggantung. Itulah keadaan yang
# selama ini diperbaiki dengan `pm2 restart cod-backend` manual. Skrip ini
# memeriksanya lewat HTTP, satu-satunya cara mengetahui prosesnya masih melayani.
#
# Dijalankan cron tiap menit. Lihat docs/DEPLOYMENT.md.
set -uo pipefail

URL="${COD_HEALTH_URL:-http://127.0.0.1:5050/health}"
APP="${COD_PM2_APP:-cod-backend}"
LOG="${COD_WATCHDOG_LOG:-/var/log/cod-watchdog.log}"

# Dua percobaan gagal, bukan satu, sebelum merestart. Satu permintaan yang gagal
# bisa berarti prosesnya sedang sibuk atau sedang direstart oleh orang lain, dan
# merestart backend yang sehat memutus koneksi setiap user yang sedang memakainya.
PERCOBAAN="${COD_WATCHDOG_RETRIES:-2}"

# Batas waktu per permintaan. Justru INI penangkap keadaan yang dicari: proses
# yang menggantung membiarkan koneksi terbuka tanpa pernah menjawab, jadi tanpa
# batas waktu, curl ikut menggantung dan pengawasnya tidak pernah menyimpulkan
# apa pun.
TIMEOUT="${COD_WATCHDOG_TIMEOUT:-10}"

catat() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG" 2>/dev/null || true; }

sehat() {
  local kode
  kode=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$URL" 2>/dev/null)
  [ "$kode" = "200" ]
}

for ((i = 1; i <= PERCOBAAN; i++)); do
  if sehat; then
    exit 0
  fi
  catat "denyut nadi gagal ($i/$PERCOBAAN) di $URL"
  [ "$i" -lt "$PERCOBAAN" ] && sleep 5
done

# Jangan merestart proses yang pm2 sendiri sudah menandai "errored": pm2 berhenti
# di situ karena sudah mencoba max_restarts kali dan selalu gagal. Merestartnya
# dari luar hanya memulai ulang lingkaran yang sama tanpa memperbaiki sebabnya,
# dan menghapus penanda yang seharusnya dilihat orang di `pm2 list`.
#
# Diurai dengan node, bukan grep, karena "status" berada di dalam objek
# "pm2_env" yang bersarang, sementara "name" ada di tingkat luar. Pola grep apa
# pun yang mencocokkan keduanya sekaligus harus menebak isi di antaranya, dan
# tebakan itu meleset: percobaan pertama membaca status sebagai "tidak
# diketahui" untuk proses yang jelas online. Node sudah pasti ada di server ini.
STATUS=$(pm2 jlist 2>/dev/null | node -e '
  let t = "";
  process.stdin.on("data", (d) => (t += d));
  process.stdin.on("end", () => {
    try {
      const app = JSON.parse(t).find((p) => p.name === process.argv[1]);
      process.stdout.write(app?.pm2_env?.status || app?.status || "");
    } catch { /* keluaran bukan JSON: biarkan kosong, ditangani di bawah */ }
  });
' "$APP" 2>/dev/null)
if [ "$STATUS" = "errored" ]; then
  catat "TIDAK merestart: pm2 menandai $APP 'errored', perlu diperiksa manusia"
  exit 1
fi

catat "merestart $APP karena denyut nadinya tidak menjawab (status pm2: ${STATUS:-tidak diketahui})"
pm2 restart "$APP" --update-env >> "$LOG" 2>&1

# Beri waktu prosesnya menyala, lalu catat hasilnya. Tanpa pemeriksaan ini, log
# hanya berisi "merestart" berulang tanpa keterangan apakah restartnya menolong.
sleep 15
if sehat; then
  catat "restart berhasil, denyut nadi menjawab lagi"
  exit 0
fi

# Keluar bukan-nol supaya cron mengirim surat kegagalannya. Restart yang tidak
# menolong berarti sebabnya di luar jangkauan skrip ini (MySQL mati, disk penuh,
# port dipakai proses lain), dan itu perlu dilihat orang. Keluar 0 di sini akan
# membuat kegagalan hanya tercatat di berkas log yang tidak dibaca siapa pun.
catat "restart TIDAK menolong, denyut nadi masih diam. Periksa: pm2 logs $APP"
exit 1
