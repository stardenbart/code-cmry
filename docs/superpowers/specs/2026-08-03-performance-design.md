# CODE Performance — Design

**Tanggal:** 2026-08-03
**Status:** Disetujui
**Cakupan:** Waktu muat awal, waktu buka dashboard Power BI, dan instrumentasi untuk membuktikan keduanya

---

## Masalah

Diukur pada 2026-08-03 terhadap kode di branch `feat/api-authorization`:

| Yang diukur | Nilai sekarang | Catatan |
|---|---|---|
| Bundle JS | 816 KB dalam **satu** chunk | Tidak ada code-splitting. Halaman login mengunduh seluruh SDK Power BI. |
| Hero image | **1,64 MB**, 1920×844 JPEG | Wajarnya 150–250 KB pada dimensi tersebut. |
| Embed token, cache kosong | 1.395 ms | Panggilan Azure AD + Power BI API. |
| Embed token, cache terisi | 3 ms | Cache backend sudah bekerja. |
| `GET /api/dashboards/` | 3 ms, 32 KB | Bukan masalah. Tidak disentuh. |

User mengakses dari LAN kantor dan dari VPN luar kantor. Untuk pengguna VPN, ~2,5 MB unduhan awal adalah biaya yang paling terasa.

**Yang tidak bisa kita perbaiki:** waktu Power BI merender laporannya sendiri terjadi di infrastruktur Microsoft. Rancangan ini tidak berpura-pura bisa mempercepatnya — hanya memastikan tidak ada waktu terbuang *sebelum* render dimulai, dan mengukur berapa besar porsinya supaya usaha berikutnya tidak salah sasaran.

## Bukan bagian dari cakupan ini

- Optimasi query database (sudah 3 ms)
- Server-side rendering atau ganti framework
- Perubahan UI/UX (workstream terpisah)
- Efisiensi CODE AI (workstream terpisah)

---

## Fase 1 — Instrumentasi

Tanpa angka dari sisi user, fase berikutnya cuma tebakan yang kebetulan masuk akal.

### Yang diukur

**Muat awal** — satu kali per sesi, saat React selesai render pertama:
- `ttfb` — waktu respons pertama server
- `domInteractive` — HTML siap
- `appReady` — React render pertama selesai

Diambil dari `performance.getEntriesByType("navigation")[0]`, bukan `performance.timing` yang sudah usang.

**Buka dashboard** — satu kali tiap user membuka dashboard, dipecah jadi:
- `tokenMs` — lama `GET /api/powerbi/embed-config-by-report/:id`
- `renderMs` — dari token diterima sampai event `rendered` dari powerbi-client
- `prefetchHit` — apakah token sudah tersedia dari prefetch hover

Pemisahan `tokenMs` dan `renderMs` adalah inti fase ini. Kalau `renderMs` mendominasi, Fase 4 memang hanya memangkas sedikit dan kita tahu batas atas perbaikan yang mungkin.

### Antarmuka

`frontend/src/utils/perf.js`

```js
export function markAppReady()                      // dipanggil sekali dari App
export function startDashboardTimer(dashboardId)    // -> { tokenDone(), renderDone(prefetchHit) }
```

Modul ini tidak melempar error ke pemanggilnya dalam kondisi apa pun. Telemetri yang menjatuhkan fitur yang diukurnya lebih buruk daripada tidak ada telemetri.

### Penyimpanan

Tabel baru `perf_samples`:

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | INT AUTO_INCREMENT | |
| `user_id` | INT NULL | Diambil dari token, bukan dari body |
| `kind` | ENUM('app_load','dashboard_open') | |
| `dashboard_id` | INT NULL | Hanya untuk `dashboard_open` |
| `metrics` | JSON | `{ttfb, domInteractive, appReady}` atau `{tokenMs, renderMs, prefetchHit}` |
| `created_at` | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | |

Migrasi memakai penjagaan `information_schema` + `PREPARE`/`EXECUTE`, bukan `IF NOT EXISTS` — sintaks itu MariaDB, dan pernah menyebabkan migrasi lain gagal diam-diam di MySQL.

### Endpoint

`POST /api/perf` — klasifikasi `authenticated`.

- `user_id` diambil dari `req.user.id`, tidak pernah dari body. Ini konsisten dengan perbaikan IDOR yang sudah dikerjakan.
- Dibatasi 60 kiriman per user per 5 menit lewat `rateLimiter.js` yang sudah ada. Endpoint yang menulis ke database tanpa batas adalah alat pengisi disk.
- `metrics` divalidasi: hanya kunci yang dikenali, hanya nilai berupa angka berhingga 0–600000 atau boolean. Tanpa ini, kolom JSON menerima apa pun yang dikirim browser.
- Selalu membalas 204, termasuk saat gagal menyimpan. Klien tidak punya tindakan yang berarti atas kegagalan telemetri.

`GET /api/perf/summary` — klasifikasi `adminOnly`. Mengembalikan p50 dan p95 tiap metrik untuk 7 hari terakhir. Rata-rata menyembunyikan ekor lambat yang justru dikeluhkan user; p95 tidak.

Keduanya wajib terdaftar di `ROUTE_CLASSIFICATION`, kalau tidak suite akan gagal — memang itu gunanya.

### Yang dilihat admin

Satu bagian di halaman Manage Users berjudul "Performa", menampilkan p50/p95 muat awal dan buka dashboard, plus 5 dashboard paling lambat. Tanpa grafik. Angka dalam tabel sudah cukup untuk memutuskan.

---

## Fase 2 — Memecah bundle

### Penghalang yang harus dibereskan dulu

`App.jsx` mengimpor `powerbi-client` di level modul dan memakai `models.CommandDisplayOption` di dalam konstanta `EMBED_SETTINGS`. Selama itu ada, bundler wajib menaruh seluruh SDK di chunk utama, dan `React.lazy` pada rute tidak mengubah apa pun.

Maka: pindahkan `PowerBIReportEmbed`, `PowerBITokenEmbed`, dan `EMBED_SETTINGS` dari `App.jsx` ke `frontend/src/components/PowerBIReport.jsx`. Setelah itu `powerbi-client` hanya tercapai lewat file tersebut.

Ini juga memperkecil `App.jsx` yang sekarang 811 baris.

### Pembagian chunk

**Chunk awal** — yang dibutuhkan sebelum login:
`Login`, `Register`, `LandingPage`, `Header`, `Sidebar`, dan kerangka router.

**Dimuat saat dibutuhkan** lewat `React.lazy`:
`PowerBIReport` (membawa powerbi-client), `DataRoomDashboard`, `AskAIPanel`, `CodeAINavigator`, `AISettingsModal`, `ManageUsers`, `AddUserModal`, `DashboardManager`, `LandingPageManager`, `NotificationPage`.

Panel manajemen dipisah karena hanya satu dari 58 akun yang bisa membukanya. Tidak masuk akal 57 orang lain mengunduhnya.

### Suspense

Satu `<Suspense>` membungkus `<Routes>` dengan fallback berupa penanda muat yang memakai warna dan logo yang sudah ada. Modal dan panel yang di-lazy mendapat `<Suspense>` sendiri di titik pemakaian, supaya membuka modal tidak mengosongkan seluruh halaman.

`React.lazy` melempar error saat unduhan chunk gagal — pada jaringan VPN yang putus-putus ini bukan kejadian teoretis. Sebuah error boundary di sekeliling `Suspense` menampilkan pesan "Gagal memuat bagian ini" dengan tombol muat ulang, bukan layar putih.

### Isi 816 KB itu sebenarnya apa

Diukur lewat build percobaan pada 2026-08-03 dengan `manualChunks`:

| Bagian | Ter-minify |
|---|---|
| `powerbi-client` + `powerbi-client-react` | 355,5 KB |
| Kode aplikasi CODE | 164,7 KB |
| `react` + `react-dom` + `react-router-dom` | 151,1 KB |
| `framer-motion` | 115,1 KB |
| `lucide-react` | 27,7 KB |

### Ukuran yang dituju

Yang diukur adalah **byte yang harus diunduh untuk menampilkan halaman login** — layar pertama yang dilihat semua orang — bukan "ukuran chunk awal", yang bisa dibuat terlihat bagus dengan memindahkan berat ke tempat lain tanpa ada yang benar-benar lebih cepat.

Halaman login tidak membutuhkan Power BI, tidak membutuhkan Sidebar, dan tidak membutuhkan panel admin. Yang tersisa adalah `vendor` + ikon seperlunya + kode Login itu sendiri.

**Target: di bawah 250 KB untuk halaman login**, turun dari 816 KB.

`framer-motion` (115 KB) dipakai hanya di `LandingPage.jsx` dan `Sidebar.jsx`. Keduanya di luar jalur login, jadi ia ikut chunk setelah-login dan tidak dihitung dalam target. Menggantinya dengan transisi CSS akan menghemat 115 KB lagi untuk pemakaian sehari-hari — tapi itu keputusan tampilan, bukan performa, dan masuk ke workstream UI/UX, bukan di sini.

Chunk "aplikasi setelah login" diperkirakan ~450 KB dan dimuat setelah user menekan Login, saat perhatiannya sudah teralih ke transisi halaman. Angka sebenarnya dicatat di plan sebagai hasil, bukan sebagai target — memaksakan angka pada bagian ini akan mendorong pemecahan chunk yang mempersulit kode tanpa manfaat yang dirasakan user.

---

## Fase 3 — Gambar

### Hero

`home_banner_1.jpeg` 1,64 MB diproses dengan `sharp` (dev-dependency; tidak ada tooling gambar di mesin ini — `convert` yang ada di PATH adalah utilitas NTFS bawaan Windows, bukan ImageMagick) menjadi:

- `home_banner_1.webp` — 1920×844, kualitas 80
- `home_banner_1.jpg` — JPEG mozjpeg kualitas 78, sebagai fallback

Disajikan lewat `<picture>` dengan `<source type="image/webp">`. Target gabungan di bawah 250 KB.

Berkas hasil ikut di-commit, konversi tidak dijalankan saat build. Menambah langkah build yang bisa gagal demi berkas yang berubah sekali setahun adalah pertukaran yang buruk.

### Perbaikan yang menyertainya

`App.jsx:230` dan `App.jsx:494` memakai `src="../images/home_banner_1.jpeg"`. Path relatif itu diselesaikan terhadap URL halaman, jadi nilainya berubah tergantung rute mana yang sedang dibuka; selama ini berfungsi karena kebetulan. Diganti menjadi path absolut `/images/...`.

`LandingPage.jsx` sudah mengimpornya lewat Vite dengan benar dan hanya perlu diarahkan ke berkas baru.

Semua `<img>` yang diubah mendapat `width` dan `height` eksplisit supaya teks tidak melompat saat gambar selesai dimuat, dan `loading="lazy"` untuk gambar di bawah lipatan layar. Hero tidak diberi `lazy` — justru itu yang ingin muncul lebih dulu.

`DCMS.webp` 244 KB dibiarkan. Sudah WebP, dan bukan gambar pertama yang dilihat orang.

---

## Fase 4 — Prefetch saat hover

### Perilaku

Saat kursor menyentuh kartu dashboard, atau kartu mendapat fokus keyboard, CODE memanggil `GET /api/powerbi/embed-config-by-report/:id` di latar belakang dan menyimpan hasilnya di `Map` dalam memori.

Saat kartu diklik, token diambil dari `Map` jika masih berlaku. Kalau tidak ada, alur berjalan seperti sekarang — prefetch adalah percepatan, bukan prasyarat.

### Aturan

- **Penundaan 150 ms.** Kursor yang melintas saat menuju tempat lain tidak memicu panggilan. Tanpa ini, menggerakkan mouse melintasi daftar 46 dashboard akan menembakkan puluhan permintaan.
- **Satu permintaan per laporan.** Permintaan yang sedang berjalan disimpan dan dipakai ulang, bukan ditumpuk.
- **Masa berlaku dari server.** Entri kedaluwarsa memakai `tokenExpiry` dari respons dikurangi 5 menit, bukan durasi tetap yang ditebak klien.
- **Diam saat gagal.** Prefetch yang gagal tidak menampilkan apa pun dan tidak dicoba ulang. User belum meminta apa-apa.
- **Hanya pointer halus.** Dijaga dengan `matchMedia("(hover: hover)")` sehingga sentuhan di layar sentuh tidak dianggap hover.

### Antarmuka

`frontend/src/utils/embedPrefetch.js`

```js
export function prefetchEmbed(reportId)   // dipanggil saat hover; aman dipanggil berkali-kali
export function takeEmbed(reportId)       // -> config | null; dipakai saat klik
export function cancelPrefetch(reportId)  // dipanggil saat kursor pergi sebelum 150 ms
```

Token disimpan hanya di memori JavaScript, tidak di `localStorage` maupun `sessionStorage`. Embed token adalah kredensial pembawa untuk sebuah laporan; menuliskannya ke penyimpanan yang bertahan berarti ia hidup lebih lama daripada tab yang membutuhkannya.

---

## Urutan pengerjaan

Fase 1 lebih dulu, supaya Fase 2–4 punya garis dasar untuk dibandingkan. Fase 2 dan 3 mandiri satu sama lain. Fase 4 terakhir, dan Fase 1 yang membuktikan apakah ia sepadan.

## Bagaimana kita tahu ini berhasil

| Ukuran | Sebelum | Target |
|---|---|---|
| JS untuk menampilkan halaman login | 816 KB | < 250 KB |
| JS aplikasi setelah login | 816 KB | dicatat apa adanya, ~450 KB |
| Hero image | 1,64 MB | < 250 KB |
| `tokenMs` saat prefetch kena | ~1.395 ms atau 3 ms | ~0 ms |
| Suite backend | 90 lulus | tetap lulus, plus uji baru untuk `/api/perf` |
| `vite build` | bersih | tetap bersih |

Angka `tokenMs` dan `renderMs` dari Fase 1 dikumpulkan sebelum dan sesudah Fase 4, dan hasilnya dilaporkan apa adanya — termasuk bila ternyata perbaikannya kecil.

## Risiko

**Code-splitting menampilkan penanda muat di tempat yang dulu instan.** Pada LAN, mengambil chunk 40 KB memakan puluhan milidetik dan kedipannya justru mengganggu. Mitigasi: penanda muat diberi penundaan tampil 200 ms, sehingga pemuatan cepat tidak menampilkan apa pun.

**Chunk gagal diunduh pada VPN yang tidak stabil.** Ditangani error boundary di Fase 2.

**Prefetch menaikkan panggilan ke Azure.** Cache backend sudah ada, jadi hover atas dashboard yang sama tidak menambah panggilan keluar. Yang bertambah adalah panggilan untuk dashboard yang di-hover tapi tidak pernah dibuka. Penundaan 150 ms membatasinya; `GET /api/perf/summary` memperlihatkan bila ternyata masih berlebihan.

**Telemetri menjadi beban.** Batas 60 kiriman per user per 5 menit dan pembatasan bentuk `metrics` menjaga tabel tetap kecil dan jujur.
