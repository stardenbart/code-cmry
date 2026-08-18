#!/usr/bin/env bash
# Jalankan SELURUH migrasi backend/migrations/ sekali jalan.
#
# Tidak ada tabel pencatat migrasi di proyek ini, dan itu tidak diperlukan:
# keenam belas berkasnya sudah aman diulang sendiri — sebagian lewat
# `CREATE TABLE IF NOT EXISTS`, sebagian lewat penjagaan information_schema
# (`ADD COLUMN IF NOT EXISTS` adalah sintaks MariaDB dan gagal di MySQL), dan
# satu lewat `INSERT IGNORE`. Menjalankan skrip ini dua kali tidak mengubah apa
# pun pada kali kedua.
#
# Urutan abjad memang urutan yang benar, bukan kebetulan yang dibiarkan:
# add_sent_confirmed.sql mensyaratkan add_daily_summary.sql lebih dulu, dan
# "daily" < "sent". Sasaran foreign key lainnya hanya users dan dashboards, yang
# dibuat cod_db.schema.sql sebelum ini dijalankan.
#
# Pemakaian:
#   ./scripts/migrate.sh              jalankan semuanya
#   ./scripts/migrate.sh --dry-run    tunjukkan urutannya saja
set -euo pipefail

AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

ENV="$AKAR/backend/.env"
[ -f "$ENV" ] || { echo "GAGAL: $ENV tidak ada" >&2; exit 1; }

# Kredensial dibaca dari .env, tidak diketik di baris perintah: argumen perintah
# terlihat oleh setiap user di server lewat `ps aux`.
baca() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"''; }
DB_USER=$(baca DB_USER); DB_PASS=$(baca DB_PASSWORD)
DB_NAME=$(baca DB_NAME);  DB_HOST=$(baca DB_HOST)
[ -n "$DB_NAME" ] || { echo "GAGAL: DB_NAME tidak terbaca dari .env" >&2; exit 1; }

# Array dari glob, bukan `for f in $(ls ...)`. Path proyek ini memuat spasi
# ("OneDrive - PT. Cisarua ..."), dan keluaran ls yang tidak dikutip dipecah
# bash per kata, sehingga tiap potongan nama direktori dibaca sebagai berkas
# migrasi tersendiri. Glob bash memperluas jadi elemen array yang utuh.
BERKAS=("$AKAR"/backend/migrations/add_*.sql)
[ -e "${BERKAS[0]}" ] || { echo "GAGAL: tidak ada migrasi di $AKAR/backend/migrations" >&2; exit 1; }
echo "==> ${#BERKAS[@]} migrasi ke $DB_NAME@${DB_HOST:-localhost}"

for f in "${BERKAS[@]}"; do
  NAMA=$(basename "$f")
  if [ "$DRY_RUN" = 1 ]; then echo "    [dry-run] $NAMA"; continue; fi
  printf '    %-34s' "$NAMA"
  # Berhenti di berkas pertama yang gagal, dan sebut namanya. Melanjutkan setelah
  # satu migrasi gagal berarti migrasi berikutnya berjalan di atas skema yang
  # tidak diketahui bentuknya.
  #
  # stdout dibuang, stderr disimpan. Sebagian migrasi memakai `SELECT 1` sebagai
  # perintah kosong ketika kolomnya sudah ada, dan hasilnya tercetak sebagai
  # angka yang mengacaukan laporan per baris. Galat tetap terbaca karena mysql
  # menulisnya ke stderr.
  if MYSQL_PWD="$DB_PASS" mysql -h "${DB_HOST:-localhost}" -u "$DB_USER" "$DB_NAME" \
       < "$f" >/dev/null 2>/tmp/cod-migrate-err; then
    echo "ok"
  else
    echo "GAGAL"
    sed 's/^/        /' /tmp/cod-migrate-err >&2
    echo "" >&2
    echo "Berhenti di $NAMA. Migrasi sebelumnya sudah masuk dan aman diulang," >&2
    echo "jadi sesudah galat ini diperbaiki, jalankan ulang skrip yang sama." >&2
    exit 1
  fi
done

[ "$DRY_RUN" = 1 ] && exit 0
echo "==> selesai, semua migrasi terpasang"
