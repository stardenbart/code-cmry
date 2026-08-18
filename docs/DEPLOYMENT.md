# Deployment CODE ke produksi

Dokumen ini menjawab dua hal: cara men-deploy versi baru tanpa kehilangan versi
yang sedang berjalan, dan cara membuat backend menyala sendiri saat mati supaya
tidak ada lagi `pm2 restart cod-backend` manual.

Berkas yang dipakai:

| Berkas | Gunanya |
| --- | --- |
| `ecosystem.config.cjs` | Aturan pm2: backoff, batas restart, batas memori, log |
| `scripts/deploy.sh` | Backup, ambil versi baru, build, restart, verifikasi |
| `scripts/migrate.sh` | Jalankan seluruh migrasi database sekali jalan |
| `scripts/watchdog.sh` | Restart backend yang hidup tapi tidak menjawab |
| `GET /health` | Denyut nadi tanpa token, dibaca deploy dan watchdog |

Kodenya ada di GitHub: `stardenbart/code-cmry`, cabang `main`. Server produksi
menariknya dari sana, dan `deploy.sh` mengerjakan `git fetch` sendiri, jadi tidak
ada berkas yang perlu disalin manual ke server.

**Repo ini PUBLIK.** Artinya `.env` tidak boleh pernah masuk ke git, dan itu
sebabnya `.gitignore` memuat `.env`, `.env.*`, dan `*_export_*.sql`. Dump database
berisi nama, email, NIK, dan hash password karyawan; yang di-commit hanya
strukturnya (`backend/migrations/cod_db.schema.sql`).

## Bagian 1: Pemasangan sekali saja

Enam langkah berikut dijalankan satu kali di server produksi. Sesudahnya, deploy
sehari-hari cuma satu perintah.

### Langkah 1. Pasang deploy key SSH di server

Deploy key adalah kunci SSH yang berlaku untuk SATU repo dan dicentang
hanya-baca. Bedanya dengan menyalin kunci pribadi Anda ke server itu penting:
kalau server disusupi, deploy key hanya bisa membaca repo ini, sedangkan kunci
pribadi Anda bisa menulis ke SELURUH repo akun Anda.

Di server, sebagai user yang menjalankan pm2:

    ssh-keygen -t ed25519 -C "cod-deploy@$(hostname)" -f ~/.ssh/cod_deploy -N ""
    cat ~/.ssh/cod_deploy.pub

Salin keluarannya, lalu di GitHub: repo `code-cmry` > Settings > Deploy keys >
Add deploy key. Beri judul yang menyebut nama servernya, tempel kuncinya, dan
**JANGAN** centang "Allow write access". Hanya-baca sudah cukup untuk pull, dan
akses tulis berarti server bisa mengubah kode sumber.

Beri tahu ssh kunci mana yang dipakai untuk host ini:

    cat >> ~/.ssh/config <<'EOF'
    Host github-cod
      HostName github.com
      User git
      IdentityFile ~/.ssh/cod_deploy
      IdentitiesOnly yes
    EOF
    chmod 600 ~/.ssh/config

`IdentitiesOnly yes` bukan pelengkap: tanpa itu ssh menawarkan semua kunci yang
dipegangnya satu per satu, dan GitHub menerima yang pertama cocok, sehingga repo
bisa tertarik lewat kunci yang bukan deploy key ini.

Uji. Keluaran yang benar menyebut nama repo, bukan nama user Anda:

    ssh -T git@github-cod

    # benar:  Hi stardenbart/code-cmry! You've successfully authenticated,
    #         but GitHub does not provide shell access.

### Langkah 2. Klon repo

    cd /path/induk        # misalnya /var/www atau /home/USER
    git clone git@github-cod:stardenbart/code-cmry.git cod-project
    cd cod-project

Kalau `cod-project` di server SUDAH ada dan berisi kode yang dikirim manual
(scp, rsync, atau unggah zip), jangan diklon ulang di atasnya. Sambungkan yang
ada ke GitHub:

    cd /path/ke/cod-project
    git remote -v                      # lihat dulu, jangan asal set

    # Kalau belum ada remote sama sekali:
    git init 2>/dev/null; git remote add origin git@github-cod:stardenbart/code-cmry.git

    # Kalau remote-nya sudah ada tapi masih https:
    git remote set-url origin git@github-cod:stardenbart/code-cmry.git

    git fetch origin main

Lalu periksa apa yang akan hilang SEBELUM menimpanya, karena langkah berikutnya
menghapus setiap perubahan lokal di server:

    git status --short                 # berkas yang belum di-commit
    git log --oneline HEAD..origin/main | wc -l   # berapa commit ketinggalan

Kalau `git status` menampilkan sesuatu, itu perbaikan yang pernah dikerjakan
langsung di server dan belum pernah masuk git. Simpan dulu (`git stash` atau
salin keluar), jangan ditimpa. Sesudah bersih:

    git reset --hard origin/main

### Langkah 3. Siapkan .env dan dependency

`.env` TIDAK ada di git, jadi hasil klon tidak memuatnya. Ini yang paling sering
membuat deploy pertama gagal.

    cp backend/.env.example backend/.env
    chmod 600 backend/.env
    nano backend/.env

Yang wajib terisi: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`,
`JWT_SECRET`.

`JWT_SECRET` harus diisi nilai acak panjang, dan ini bukan formalitas. Kodenya
punya nilai cadangan `"jwt_secret_key"` yang dipakai kalau variabelnya kosong,
nilai itu terlihat publik di repo ini, dan siapa pun yang mengetahuinya bisa
membuat token untuk akun mana pun. Bangkitkan yang benar:

    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

Kalau ini server yang benar-benar baru, jalankan skema dan seluruh migrasinya
lebih dulu. Skema sekali dengan mysql, migrasinya lewat skrip:

    mysql -u USER -p NAMA_DB < backend/migrations/cod_db.schema.sql
    ./scripts/migrate.sh --dry-run
    ./scripts/migrate.sh

`migrate.sh` menjalankan keenam belas berkas `add_*.sql` urut abjad. Lihat
bagian "Migrasi database" di bawah untuk alasan urutan itu benar dan mengapa
skrip ini aman dijalankan berulang.

Lalu dependency dan build pertama:

    mkdir -p logs
    cd backend  && npm ci --omit=dev && cd ..
    cd frontend && npm ci && npm run build && cd ..

### Langkah 4. Pindahkan backend ke ecosystem.config.cjs

Kalau `cod-backend` sekarang dijalankan lewat `pm2 start src/server.js`,
pengaturannya tidak berisi backoff maupun batas memori. Ganti sekali:

    cd /path/ke/cod-project
    mkdir -p logs
    pm2 delete cod-backend
    pm2 start ecosystem.config.cjs
    pm2 save

`pm2 save` itu bukan pelengkap. Tanpanya, daftar proses hilang saat server
boot ulang.

### Langkah 5. Nyalakan pm2 saat server boot

Ini yang membuat backend hidup kembali sesudah server mati lampu atau di-reboot:

    pm2 startup

Perintah itu mencetak SATU perintah lain yang harus dijalankan dengan `sudo`.
Jalankan perintah yang dicetak itu, lalu:

    pm2 save

Pastikan berhasil:

    systemctl is-enabled pm2-$USER

Keluaran `enabled` berarti pm2 akan menyala sendiri saat boot.

### Langkah 6. Pasang watchdog di cron

pm2 sudah merestart proses yang KELUAR. Yang tidak bisa dilihatnya adalah proses
yang MENGGANTUNG: event loop terkunci, prosesnya tetap "online" di `pm2 list`,
tapi setiap permintaan menggantung. Keadaan itulah yang selama ini diperbaiki
dengan restart manual, dan hanya bisa dideteksi lewat HTTP.

    # Bit executable-nya sudah tersimpan di git (mode 100755), jadi hasil klon
    # sudah bisa dijalankan. Baris ini hanya jaring pengaman untuk kasus kode
    # dikirim ke server lewat zip atau scp, yang tidak membawa izin berkas.
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

### Langkah 7. Siapkan direktori backup

    mkdir -p ../cod-backups
    chmod 700 ../cod-backups

Izin `700` bukan pilihan gaya: backup berisi `.env` dan dump database, yaitu
kredensial dan seluruh data produksi.

## Bagian 2: Deploy sehari-hari

Alurnya: Anda push dari laptop, server menariknya.

Di laptop:

    git push origin main

Di server:

    cd /path/ke/cod-project
    ./scripts/deploy.sh --dry-run   # lihat rencananya dulu
    ./scripts/deploy.sh

`deploy.sh` yang mengerjakan `git fetch origin main` lalu
`git reset --hard origin/main`, jadi tidak perlu `git pull` manual lebih dulu.

`reset --hard`, bukan `pull`, memang disengaja: `pull` bisa berhenti di tengah
karena konflik penggabungan dan meninggalkan server dengan berkas separuh
tergabung. `reset --hard` selalu menghasilkan salinan yang sama persis dengan
GitHub. Konsekuensinya, perubahan yang belum di-commit di server akan hilang, dan
itu sebabnya skrip menolak jalan kalau `git status` tidak bersih.

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

### Migrasi database

Migrasinya terpisah satu berkas per perubahan, dan tidak perlu dijalankan satu
per satu. Satu perintah memasang semuanya:

    ./scripts/migrate.sh --dry-run   # urutan yang akan dijalankan
    ./scripts/migrate.sh

**Skrip ini aman dijalankan berulang.** Bukan karena ada tabel pencatat migrasi
(proyek ini tidak punya), melainkan karena setiap berkasnya menjaga dirinya
sendiri: sebagian dengan `CREATE TABLE IF NOT EXISTS`, sebagian dengan
memeriksa `information_schema` lebih dulu, satu dengan `INSERT IGNORE`. Sudah
diuji: 22 tabel sebelum, 22 tabel sesudah dijalankan dua kali.

Penjagaan `information_schema` itu bukan gaya penulisan yang berbeda-beda tanpa
alasan. `ADD COLUMN IF NOT EXISTS` adalah sintaks MariaDB dan **gagal di MySQL**;
itu pernah terjadi di repo ini dan membuat dua tabel tidak pernah terbentuk.

Urutan abjad memang urutan yang benar: `add_sent_confirmed.sql` mensyaratkan
`add_daily_summary.sql` lebih dulu, dan "daily" lebih dulu dari "sent" secara
abjad. Sasaran foreign key selebihnya hanya `users` dan `dashboards`, yang sudah
dibuat oleh `cod_db.schema.sql`.

Kalau ada satu berkas yang gagal, skrip berhenti di situ, mencetak galat MySQL
apa adanya, dan keluar bukan-nol. Migrasi sebelumnya sudah masuk dan aman
diulang, jadi sesudah sebab galatnya diperbaiki, jalankan skrip yang sama lagi.

#### Kalau deploy.sh berhenti karena ada migrasi baru

`deploy.sh` sengaja TIDAK menjalankan migrasi sendiri. Ia berhenti dengan kode
keluar 3 dan menyebut berkasnya, karena migrasi yang salah tidak bisa dibatalkan
dengan menyalin berkas. Kerjakan urut:

1. Backup database sudah ada di `../cod-backups/<cap-waktu>/db.sql.gz`. Pastikan
   berkasnya benar-benar ada dan ukurannya wajar sebelum lanjut.
2. Baca berkas migrasi yang disebut. Kalau ada `DROP` atau `ALTER` yang
   menghapus kolom, pastikan dulu tidak ada data yang hilang.
3. `./scripts/migrate.sh`
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

### Kalau git-nya yang gagal

**`Permission denied (publickey)`** saat fetch. Deploy key tidak terpakai. Uji
sambungannya langsung, dan periksa remote-nya memakai host alias `github-cod`
yang dipasang di langkah 1, bukan `github.com` biasa:

    ssh -T git@github-cod
    git remote -v      # harus: git@github-cod:stardenbart/code-cmry.git

**`Repository not found`** padahal kuncinya diterima. Deploy key terdaftar di repo
lain, atau kunci di `~/.ssh/config` menunjuk ke berkas yang salah.

**`ada perubahan yang belum di-commit di server`** dan skrip berhenti. Lihat dulu
apa isinya, jangan langsung dibuang:

    git status --short
    git diff

Kalau itu perbaikan darurat yang pernah dikerjakan di server, simpan sebelum
apa pun: `git stash`, atau salin berkasnya keluar. Deploy berikutnya akan
menimpanya. Sesudah dipastikan tidak ada yang berharga: `git checkout -- .`

**`sudah versi terbaru`** padahal Anda baru push. Push-nya belum sampai, atau
masuk ke cabang lain. Cek dari server:

    git fetch origin main && git log --oneline -1 origin/main

Bandingkan dengan commit terakhir di laptop Anda. Kalau berbeda, `git push` di
laptop belum berhasil.

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
