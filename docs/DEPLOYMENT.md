# Deployment CODE ke produksi

Dokumen ini menjawab dua hal: cara men-deploy versi baru tanpa kehilangan versi
yang sedang berjalan, dan cara membuat backend menyala sendiri saat mati supaya
tidak ada lagi `pm2 restart cod-backend` manual.

Berkas yang dipakai:

| Berkas | Gunanya |
| --- | --- |
| `ecosystem.config.cjs` | Aturan pm2: backoff, batas restart, batas memori, log |
| `scripts/deploy.sh` | Backup, ambil versi baru, build, restart, verifikasi |
| `scripts/watchdog.sh` | Restart backend yang hidup tapi tidak menjawab |
| `GET /health` | Denyut nadi tanpa token, dibaca deploy dan watchdog |

## Bagian 1: Pemasangan sekali saja

Empat langkah berikut dijalankan satu kali di server produksi. Sesudahnya,
deploy sehari-hari cuma satu perintah.

### Langkah 1. Pindahkan backend ke ecosystem.config.cjs

Kalau `cod-backend` sekarang dijalankan lewat `pm2 start src/server.js`,
pengaturannya tidak berisi backoff maupun batas memori. Ganti sekali:

    cd /path/ke/cod-project
    mkdir -p logs
    pm2 delete cod-backend
    pm2 start ecosystem.config.cjs
    pm2 save

`pm2 save` itu bukan pelengkap. Tanpanya, daftar proses hilang saat server
boot ulang.

### Langkah 2. Nyalakan pm2 saat server boot

Ini yang membuat backend hidup kembali sesudah server mati lampu atau di-reboot:

    pm2 startup

Perintah itu mencetak SATU perintah lain yang harus dijalankan dengan `sudo`.
Jalankan perintah yang dicetak itu, lalu:

    pm2 save

Pastikan berhasil:

    systemctl is-enabled pm2-$USER

Keluaran `enabled` berarti pm2 akan menyala sendiri saat boot.

### Langkah 3. Pasang watchdog di cron

pm2 sudah merestart proses yang KELUAR. Yang tidak bisa dilihatnya adalah proses
yang MENGGANTUNG: event loop terkunci, prosesnya tetap "online" di `pm2 list`,
tapi setiap permintaan menggantung. Keadaan itulah yang selama ini diperbaiki
dengan restart manual, dan hanya bisa dideteksi lewat HTTP.

    chmod +x scripts/watchdog.sh scripts/deploy.sh
    sudo touch /var/log/cod-watchdog.log
    sudo chown $USER /var/log/cod-watchdog.log
    crontab -e

Tambahkan satu baris. `PATH` perlu ditulis karena cron berjalan dengan PATH
yang sangat sempit dan tidak akan menemukan `pm2`:

    PATH=/usr/local/bin:/usr/bin:/bin:/home/USER/.nvm/versions/node/vXX/bin
    * * * * * /path/ke/cod-project/scripts/watchdog.sh

Ganti `USER` dan `vXX` sesuai server. Cek PATH node yang benar dengan
`dirname $(which pm2)`.

Uji tanpa menunggu backend mati: arahkan ke port yang tidak ada dan pastikan
watchdog menyimpulkan tidak sehat, lalu periksa lognya.

    COD_HEALTH_URL=http://127.0.0.1:9999/health scripts/watchdog.sh
    tail /var/log/cod-watchdog.log

### Langkah 4. Siapkan direktori backup

    mkdir -p ../cod-backups
    chmod 700 ../cod-backups

Izin `700` bukan pilihan gaya: backup berisi `.env` dan dump database, yaitu
kredensial dan seluruh data produksi.

## Bagian 2: Deploy sehari-hari

    cd /path/ke/cod-project
    ./scripts/deploy.sh --dry-run   # lihat rencananya dulu
    ./scripts/deploy.sh

Yang dikerjakannya, berurutan:

1. **Prasyarat.** pm2 ada, node ada, `backend/.env` ada, tidak ada perubahan
   yang belum di-commit. Berhenti kalau ada yang kurang, sebelum menyentuh apa
   pun.
2. **Backup.** Commit yang sedang berjalan, `frontend/dist`, `backend/.env`, dan
   dump database ter-gzip, semuanya ke `../cod-backups/<cap-waktu>/`.
3. **Ambil versi baru.** `git fetch` lalu `reset --hard origin/main`. Berhenti
   dengan kode 3 kalau ada migrasi database baru (lihat bawah).
4. **Dependency dan build.** `npm ci` backend, lalu build frontend. Keduanya
   sebelum backend disentuh, supaya build yang gagal tidak meninggalkan produksi
   dengan frontend lama dan backend baru.
5. **Restart.** `pm2 restart --update-env`, lalu `pm2 save`.
6. **Verifikasi.** Menunggu `/health` sampai 60 detik. Kalau diam, deploy
   dilaporkan gagal dan perintah rollback dicetak. Backup lama di luar 5 yang
   terbaru dibuang.

### Kalau ada migrasi database baru

Skrip berhenti dengan kode keluar 3 dan menyebut berkasnya. Ini disengaja:
migrasi yang salah tidak bisa dibatalkan dengan menyalin berkas, dan skrip tidak
bisa tahu mana yang aman diulang. Kerjakan urut:

1. Backup database sudah ada di `../cod-backups/<cap-waktu>/db.sql.gz`. Pastikan
   berkasnya benar-benar ada dan ukurannya wajar sebelum lanjut.
2. Baca berkas migrasinya. Kalau ada `DROP` atau `ALTER` yang menghapus kolom,
   pastikan dulu tidak ada data yang hilang.
3. Jalankan ke database produksi:

       mysql -u USER -p NAMA_DB < backend/migrations/nama_migrasi.sql

4. Ulangi `./scripts/deploy.sh`.

### Rollback

    ./scripts/deploy.sh --rollback

Mengembalikan commit, `frontend/dist`, dan `.env` dari backup terbaru, lalu
restart dan verifikasi.

**Database TIDAK ikut dikembalikan otomatis.** Rollback data adalah keputusan
yang harus diambil sadar: pemulihan dump akan MENGHAPUS seluruh data yang masuk
sejak backup diambil. Kalau memang perlu, dan hanya kalau perlu:

    gunzip < ../cod-backups/<cap-waktu>/db.sql.gz | mysql -u USER -p NAMA_DB

Pastikan dulu apa yang akan hilang. Jam berapa backupnya, dan transaksi apa saja
yang masuk sesudah itu.

## Bagian 3: Kalau backend tetap mati berulang

Urutan pemeriksaan, dari yang paling sering:

    pm2 list                          # status: online / errored / stopped?
    pm2 logs cod-backend --lines 100  # galat sebelum matinya
    tail -50 /var/log/cod-watchdog.log
    curl -s localhost:5050/health

`/health` selalu 200 selama prosesnya masih melayani HTTP, TERMASUK saat
database mati. Bedanya ada di badannya:

    {"status":"ok","database":"ok","uptime_detik":3600}
    {"status":"ok","database":"gagal: ETIMEDOUT","uptime_detik":12}

Ini disengaja. Restart memperbaiki proses yang menggantung, bukan MySQL yang
mati, jadi membalas 503 saat database mati hanya membuat watchdog merestart
backend berulang tanpa hasil. `database: gagal` berarti perbaiki MySQL, bukan
restart backend.

`uptime_detik` yang selalu kecil berarti prosesnya mati dan lahir terus. Bacanya
di `pm2 logs`, dan penyebab yang paling sering adalah `.env` rusak atau port
sudah dipakai proses lain.

Status `errored` di `pm2 list` berarti pm2 sudah menyerah sesudah 15 kali gagal.
Watchdog sengaja TIDAK merestart yang berstatus itu: sebabnya bukan gangguan
sesaat, dan merestartnya hanya menghapus penanda yang perlu dilihat orang.
