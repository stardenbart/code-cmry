# Gambar sumber — tidak disajikan ke user

Berkas di sini adalah **aslinya**, dipakai untuk menghasilkan versi terkompresi
di `public/images/`. Direktori ini tidak disajikan sebagai berkas statis dan
tidak boleh diimpor dari `src/`.

Jangan menambah berkas yang perlu dimuat browser ke sini — taruh di
`public/images/` dan rujuk dengan path runtime (`src="/images/nama.webp"`).

Dulu direktori ini berisi salinan identik dari setiap berkas di
`public/images/`, dan satu di antaranya (`Logo_Cimory.png`) diimpor sebagai
modul di satu tempat sementara tempat lain memakai path runtime — sehingga user
mengunduh logo yang sama dua kali dengan URL berbeda. Salinannya sudah dihapus.

## Isi

| Berkas | Dipakai untuk |
|---|---|
| `home_banner_1.jpeg` | Sumber `node scripts/optimize-hero.mjs` → `public/images/home_banner_1.{webp,jpg}` |
