#!/usr/bin/env bash
# Deploy backend + frontend CODE ke produksi, dengan backup versi berjalan
# terlebih dahulu.
#
# Urutan langkahnya bukan selera. Tiap langkah menutup satu cara deploy bisa
# gagal separuh jalan:
#
#   Backup dulu, sebelum apa pun disentuh. Backup yang diambil SESUDAH `git pull`
#   tidak bisa dipakai untuk mundur, karena isinya sudah versi baru.
#
#   Build frontend SEBELUM backend direstart. Build gagal itu hal biasa dan
#   memakan puluhan detik; kalau backend sudah direstart lebih dulu, kegagalan
#   build meninggalkan produksi dengan frontend lama dan backend baru, yaitu
#   pasangan yang belum pernah diuji siapa pun.
#
#   Migrasi database TIDAK dijalankan otomatis di sini. Migrasi yang salah tidak
#   bisa dibatalkan dengan menyalin berkas, dan skrip ini tidak bisa mengetahui
#   mana migrasi yang aman diulang. Skrip berhenti dan memberi tahu bila ada
#   migrasi baru yang belum dijalankan.
#
# Pemakaian:
#   ./scripts/deploy.sh              deploy dari origin/main
#   ./scripts/deploy.sh --dry-run    tunjukkan yang akan dikerjakan, tanpa ubah
#   ./scripts/deploy.sh --rollback   kembalikan backup terakhir
set -euo pipefail

AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$AKAR"

APP="${COD_PM2_APP:-cod-backend}"
DIR_BACKUP="${COD_BACKUP_DIR:-$AKAR/../cod-backups}"
URL_HEALTH="${COD_HEALTH_URL:-http://127.0.0.1:5050/health}"
CABANG="${COD_DEPLOY_BRANCH:-main}"
SIMPAN_BACKUP="${COD_KEEP_BACKUPS:-5}"

DRY_RUN=0
ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) echo "Argumen tidak dikenal: $arg"; exit 2 ;;
  esac
done

info()  { echo "==> $*"; }
gagal() { echo "GAGAL: $*" >&2; exit 1; }
jalan() { if [ "$DRY_RUN" = 1 ]; then echo "    [dry-run] $*"; else eval "$@"; fi; }

sehat() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL_HEALTH" 2>/dev/null)" = "200" ]
}

# ── Mundur ke backup terakhir ────────────────────────────────────────────────
if [ "$ROLLBACK" = 1 ]; then
  TERAKHIR=$(ls -1d "$DIR_BACKUP"/*/ 2>/dev/null | sort | tail -1 || true)
  [ -n "$TERAKHIR" ] || gagal "tidak ada backup di $DIR_BACKUP"
  info "mengembalikan dari $TERAKHIR"
  [ -f "$TERAKHIR/commit.txt" ] && info "commit backup: $(cat "$TERAKHIR/commit.txt")"

  jalan "git -C '$AKAR' checkout -- ."
  jalan "git -C '$AKAR' checkout \$(cat '$TERAKHIR/commit.txt')"
  [ -d "$TERAKHIR/dist" ] && jalan "rm -rf '$AKAR/frontend/dist' && cp -r '$TERAKHIR/dist' '$AKAR/frontend/dist'"
  [ -f "$TERAKHIR/backend.env" ] && jalan "cp '$TERAKHIR/backend.env' '$AKAR/backend/.env'"
  jalan "cd '$AKAR/backend' && npm ci --omit=dev"
  jalan "pm2 restart '$APP' --update-env"

  sleep 10
  if sehat; then info "rollback selesai, denyut nadi menjawab"; else gagal "rollback selesai TAPI denyut nadi diam. Periksa: pm2 logs $APP"; fi
  exit 0
fi

# ── Pemeriksaan sebelum menyentuh apa pun ────────────────────────────────────
info "memeriksa prasyarat"
command -v pm2  >/dev/null || gagal "pm2 tidak ada di PATH"
command -v node >/dev/null || gagal "node tidak ada di PATH"
[ -f backend/.env ] || gagal "backend/.env tidak ada. Deploy tanpa itu akan menyalakan backend tanpa kredensial."

# Perubahan lokal yang belum di-commit akan hilang saat `git reset --hard`.
# Berhenti di sini, jangan menghapusnya diam-diam.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  gagal "ada perubahan yang belum di-commit di server. Commit atau simpan dulu: git stash"
fi

KOMIT_LAMA=$(git rev-parse HEAD)
info "commit berjalan: $KOMIT_LAMA"

# ── 1. Backup versi berjalan ─────────────────────────────────────────────────
CAP="$(date '+%Y%m%d-%H%M%S')"
TUJUAN="$DIR_BACKUP/$CAP"
info "membuat backup di $TUJUAN"
jalan "mkdir -p '$TUJUAN'"

# Commit-nya, bukan salinan seluruh kode. Kodenya sudah ada di git; yang benar
# benar perlu dicatat adalah TITIK MANA yang sedang berjalan, supaya rollback
# tahu harus kembali ke mana.
jalan "echo '$KOMIT_LAMA' > '$TUJUAN/commit.txt'"

# dist frontend TIDAK ada di git (hasil build), jadi ini satu-satunya salinannya.
[ -d frontend/dist ] && jalan "cp -r frontend/dist '$TUJUAN/dist'"

# .env juga tidak ada di git, dan berisi kredensial. Disalin dengan izin ketat.
jalan "cp backend/.env '$TUJUAN/backend.env' && chmod 600 '$TUJUAN/backend.env'"

# Dump database. Ini yang paling penting dan paling sering dilupakan: kode bisa
# dikembalikan kapan saja dari git, data tidak bisa.
if command -v mysqldump >/dev/null; then
  info "membuat dump database"
  # Kredensial dibaca dari .env, tidak diketik di baris perintah, karena argumen
  # perintah terlihat oleh setiap user di server lewat `ps aux`.
  set +u
  DB_USER=$(grep -E '^DB_USER=' backend/.env | cut -d= -f2- | tr -d '"'"'"'')
  DB_PASS=$(grep -E '^DB_PASSWORD=' backend/.env | cut -d= -f2- | tr -d '"'"'"'')
  DB_NAME=$(grep -E '^DB_NAME=' backend/.env | cut -d= -f2- | tr -d '"'"'"'')
  DB_HOST=$(grep -E '^DB_HOST=' backend/.env | cut -d= -f2- | tr -d '"'"'"'')
  set -u
  if [ -n "${DB_NAME:-}" ]; then
    jalan "MYSQL_PWD='$DB_PASS' mysqldump -h '${DB_HOST:-localhost}' -u '$DB_USER' --single-transaction --quick '$DB_NAME' | gzip > '$TUJUAN/db.sql.gz'"
    jalan "chmod 600 '$TUJUAN/db.sql.gz'"
  else
    echo "    PERINGATAN: DB_NAME tidak terbaca dari .env, dump database dilewati"
  fi
else
  echo "    PERINGATAN: mysqldump tidak ada, dump database dilewati"
fi

# ── 2. Ambil versi baru ──────────────────────────────────────────────────────
info "mengambil $CABANG dari origin"
jalan "git fetch origin '$CABANG'"
KOMIT_BARU=$(git rev-parse "origin/$CABANG")
if [ "$KOMIT_LAMA" = "$KOMIT_BARU" ] && [ "$DRY_RUN" = 0 ]; then
  info "sudah versi terbaru, tidak ada yang perlu di-deploy"
  exit 0
fi
info "akan naik ke: $KOMIT_BARU"

# Migrasi baru diperiksa SEBELUM kodenya dipasang, supaya bila ada, prosesnya
# berhenti dengan produksi masih utuh di versi lama.
MIGRASI_BARU=$(git diff --name-only "$KOMIT_LAMA" "$KOMIT_BARU" -- backend/migrations/ | grep -v schema || true)
if [ -n "$MIGRASI_BARU" ]; then
  echo ""
  echo "BERHENTI: ada migrasi database baru yang harus dijalankan manual lebih dulu."
  echo "$MIGRASI_BARU" | sed 's/^/    /'
  echo ""
  echo "Jalankan tiap berkas itu ke database produksi, lalu ulangi deploy ini."
  echo "Backup database sudah tersimpan di $TUJUAN/db.sql.gz"
  exit 3
fi

jalan "git reset --hard 'origin/$CABANG'"

# ── 3. Dependency dan build, SEBELUM backend disentuh ────────────────────────
info "memasang dependency backend"
jalan "cd '$AKAR/backend' && npm ci --omit=dev"

info "membangun frontend"
jalan "cd '$AKAR/frontend' && npm ci && npm run build"

# ── 4. Restart backend ───────────────────────────────────────────────────────
info "merestart $APP"
# --update-env supaya .env yang berubah ikut terbaca. Tanpa itu, pm2 memakai
# environment dari saat proses pertama kali dijalankan.
jalan "pm2 restart '$APP' --update-env || pm2 start '$AKAR/ecosystem.config.cjs'"

# Daftar proses disimpan supaya bertahan melewati boot ulang server.
jalan "pm2 save"

# ── 5. Verifikasi ────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = 1 ]; then
  info "dry-run selesai, tidak ada yang diubah"
  exit 0
fi

info "menunggu denyut nadi"
for i in $(seq 1 12); do
  if sehat; then
    info "backend menjawab"
    curl -s --max-time 10 "$URL_HEALTH" | sed 's/^/    /'
    echo ""
    info "deploy selesai: $KOMIT_LAMA -> $KOMIT_BARU"
    info "kalau ada yang salah: ./scripts/deploy.sh --rollback"

    # Backup lama dibuang, yang terbaru disimpan. Tanpa ini disk server penuh
    # tanpa peringatan, dan disk penuh membuat MySQL berhenti menulis.
    ls -1d "$DIR_BACKUP"/*/ 2>/dev/null | sort | head -n -"$SIMPAN_BACKUP" | xargs -r rm -rf
    exit 0
  fi
  sleep 5
done

echo ""
echo "GAGAL: backend tidak menjawab sesudah 60 detik."
echo "Log:      pm2 logs $APP --lines 50"
echo "Mundur:   ./scripts/deploy.sh --rollback"
exit 1
