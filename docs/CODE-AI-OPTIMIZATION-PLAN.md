# CODE AI — Rencana Optimasi Kuota & Kualitas

**Status:** Fase 1–5, 7–9 **selesai & terukur** (2026-08-01). Fase 0 menunggu
verifikasi admin; Fase 6 & 10 sengaja ditunda — lihat §14.
**Tanggal:** 2026-08-01
**Konteks:** fitur Ask AI pada platform CODE (Cimory Operational Digital Enhancement), CMD Plant Sentul

> **Penamaan.** Ke pengguna, fitur ini bernama **CODE AI**. "Gemini" adalah nama
> vendor model di balik layar dan hanya muncul di konfigurasi teknis (`.env`,
> `config/gemini.js`), tidak pernah di antarmuka pengguna. Tier model diberi nama
> **CODE AI Cepat / Standar / Mendalam**, bukan ID model mentah.

---

## 0. Ringkasan Eksekutif

Rencana ini menggantikan draft optimasi sebelumnya. Perbedaan utamanya: draft itu
menebak di mana pemborosan terjadi, dokumen ini **mengukurnya lebih dulu** —
dan hasil pengukuran membalik urutan prioritasnya.

Tiga temuan yang mengubah rencana:

1. **Tidak ada satu bottleneck.** Bottleneck-nya berpindah tergantung jenis
   pertanyaan. Untuk pertanyaan sederhana, 61% token habis di *knowledge pack*.
   Untuk pertanyaan mendalam, 95% habis di *data*. Optimasi tunggal akan salah
   sasaran di separuh kasus.
2. **Deep mode adalah pembunuh kuota.** Satu pertanyaan deep mode = **79.845
   token** — setara ~17 pertanyaan sederhana. Ini satu-satunya angka terbesar di
   seluruh sistem dan harus ditangani lebih dulu daripada apa pun.
3. **Implicit caching tidak aktif.** Diukur langsung:
   `cachedContentTokenCount = 0` pada dua panggilan berturut dengan prefix
   identik. Rencana apa pun yang mengandalkan caching otomatis akan gagal.

Prioritas hasil pengukuran: **kendalikan volume data dulu**, baru knowledge,
baru caching. Function-calling/DAX — yang di draft lama jadi Fase 1 — turun ke
paling akhir, dengan alasan di §2.

---

## 1. Baseline Terukur

Diukur 2026-08-01 via `models/gemini-3.6-flash:countTokens` dengan builder prompt
produksi (`services/aiContext.js`, `services/aiKnowledge.js`, `services/aiSanitizer.js`).

### 1.1 Komponen prompt

| Komponen | Token | Karakter | Sifat |
|---|---:|---:|---|
| Instruksi sistem + aturan sanitasi | 918 | 3.600 | tetap tiap request |
| Knowledge pack — pertanyaan sederhana | 2.877 | 11.764 | tetap per dashboard |
| Knowledge pack — pertanyaan RCA | 2.694 | 11.025 | tetap per dashboard |
| Data: 6 visual × 5 baris | 935 | 2.013 | skala dengan tampilan |
| Data: 6 visual × 50 baris | 6.299 | 9.807 | |
| Data: 12 visual × 100 baris (2 halaman) | 24.914 | 36.900 | |
| Data: 20 visual × 500 baris (deep mode) | **76.233** | 108.668 | |

### 1.2 Total per request

| Skenario | Total token | Sistem | Knowledge | Data |
|---|---:|---:|---:|---:|
| Sederhana, 6×5 | 4.730 | 19% | **61%** | 20% |
| RCA, 6×50 | 9.911 | 9% | 27% | **64%** |
| RCA 2 halaman, 12×100 | 28.526 | 3% | 9% | **87%** |
| Deep mode, 20×500 | **79.845** | 1% | 3% | **95%** |

### 1.3 Perilaku model

| Model | Prompt | Thinking | Output | Latensi |
|---|---:|---:|---:|---:|
| `gemini-3.6-flash` | 6.339 | 487 | 21 | ~2,6 s |
| `gemini-3.5-flash-lite` | 6.339 | 0 | 220 | ~0,9 s |

Catatan penting: selisih **token** antar model kecil. Yang berbeda jauh adalah
**latensi** dan — ini yang menentukan — **kuota free tier dihitung per model**.
Jadi mengarahkan pertanyaan ringan ke model Cepat bukan menghemat token, tapi
**menyelamatkan jatah harian model Mendalam**. Itu alasan sebenarnya rencana
routing di Fase 2, dan alasan itu berbeda dari yang ditulis draft lama.

### 1.4 Caching

| Panggilan | prompt | cached | thoughts | output |
|---|---:|---:|---:|---:|
| ke-1 (prefix 3.612 tok identik) | 6.339 | **0** | 192 | 116 |
| ke-2 (prefix sama persis) | 6.341 | **0** | 229 | 141 |

Implicit caching tidak memberi penghematan apa pun pada pola prompt kita saat ini.

---

## 2. Koreksi Terhadap Draft Sebelumnya

Ditulis eksplisit supaya keputusan ini bisa ditinjau ulang, bukan diterima diam-diam.

| Draft lama | Keputusan | Alasan berbasis data |
|---|---|---|
| Fase 1 = tool-use/function-calling sebagai fondasi, "pengaruh terbesar terhadap penghematan token" | **Diturunkan ke Fase 9 (opsional)** | Untuk pertanyaan sederhana, data hanya 20% dari prompt — mengganti mekanisme pengambilan data tidak menyentuh 80% sisanya. Untuk pertanyaan berat, masalahnya volume baris, yang lebih murah diselesaikan lewat Fase 1 (row budget) tanpa mengubah arsitektur. |
| Gemini "tidak boleh menerima data mentah tabel" | **Tetap kirim data tampilan, tapi dianggarkan** | Justru ini keunggulan arsitektur sekarang: `exportData` mengambil angka yang **persis sedang dilihat user**, ikut slicer/filter mereka. Pendekatan DAX-generated menghadapi risiko yang didokumentasikan sendiri oleh knowledge pack: 5 measure "Total Used Time" duplikat, KPI berstatus `[Blocked]`, dan tabel terpisah per line CMD 1/2/3 yang menuntut UNION. Membiarkan model menulis DAX di atas ambiguitas itu memindahkan risiko dari kuota ke **kebenaran angka**. |
| Q&A cache berbasis pertanyaan ternormalisasi | **Wajib ditambah sidik jari data** | Cache berbasis teks pertanyaan saja akan menyajikan jawaban lama setelah user mengubah slicer — persis kesalahan yang selama ini dicegah oleh indikator "data berubah, klik Refresh". Lihat Fase 5. |
| Context caching sebagai andalan | **Verifikasi dulu, jangan diasumsikan** | Sudah diukur: tidak aktif (§1.4). |
| Pre-agregasi harian via cron sebagai sumber jawaban | **Diadopsi sebagian** | Data kita sudah teragregasi oleh visual Power BI. Nilai cron bukan pada agregasi, tapi pada **jawaban instan untuk pertanyaan rutin** tanpa memanggil model sama sekali. Lihat Fase 6. |

---

## 3. Fase 0 — Verifikasi (wajib, sebelum coding)

| # | Item | Status |
|---|---|---|
| 0.1 | Angka pasti RPM / RPD / TPM per model di Google AI Studio | **SELESAI 2026-08-02** — lihat §3.1 |
| 0.2 | ToS penggunaan data free tier | **Sudah** — free tier boleh dipakai Google untuk pengembangan produk; sanitasi sudah dibangun sebagai mitigasi, bukan penghapus risiko |
| 0.3 | Konfirmasi kapasitas Power BI Embedded ke IT/procurement | **Belum** — tidak berubah dari draft, tetap relevan |
| 0.4 | Daftar 10–15 pertanyaan tersering manajemen | **Belum** — jadi basis Fase 5 & 6 |
| 0.5 | Waktu reset kuota harian | **Belum** — Google mereset RPD tengah malam **Pacific Time**, bukan WIB. Perlu dipastikan agar indikator sisa kuota (Fase 3) tidak salah hitung ~15 jam |

**Yang penting soal 0.1:** angka limit tidak dapat dibaca dari API (tidak ada
header sisa kuota). Karena itu seluruh mekanisme di Fase 3 bekerja dari
**penghitung lokal** yang dibandingkan dengan limit yang dikonfigurasi manual.
Salah isi limit = indikator persentase salah. Ini titik rapuh yang harus
didokumentasikan ke admin, dan divalidasi silang dengan kejadian 429 nyata.

### 3.1 Limit free tier sebenarnya (Google AI Studio, 2026-08-02)

| Model | RPM | TPM | RPD |
|---|---:|---:|---:|
| Gemini 3.6 Flash | 5 | 250K | **20** |
| Gemini 3.5 Flash | 5 | 250K | **20** |
| Gemini 3.5 Flash Lite | 15 | 250K | **500** |
| Gemini 3.1 Flash Lite | 15 | 250K | **500** |

Tiga hal yang mengubah desain, dan dua di antaranya bertentangan dengan asumsi
awal dokumen ini:

1. **Tidak ada batas token harian.** Batas token bersifat per **menit** (250K),
   yang praktis tak tercapai oleh satu user. Yang mengikat adalah **RPD**.
   Perhitungan `sisaTokenPct` di rencana awal karena itu dibuang — mengarang
   pembatas yang tidak ada hanya membuat indikator terlihat lebih presisi
   daripada kenyataannya.
2. **Model kelas Flash hanya 20 request/hari.** Ini 5x lebih ketat dari asumsi
   awal (100). Tier Mendalam jadi barang langka: 20 pertanyaan akar masalah per
   hari untuk satu kunci. Ambang degradasi dinaikkan dari 15% ke **40%** —
   di bawah 8 sisa, hanya pertanyaan berskor sangat tinggi yang masih dilayani.
3. **Kuota dihitung per model, dan itu bisa dimanfaatkan.** Karena tiap model
   punya jatah sendiri, tier Cepat dan Standar sengaja memakai **dua model lite
   yang berbeda** (3.1 dan 3.5 Flash Lite): 500 + 500 = **1000 request/hari**,
   sementara jatah 20/hari milik Flash disimpan utuh untuk tier Mendalam.
   Memakai 3.5 Flash untuk tier Standar — seperti konfigurasi awal — akan
   menghabiskan jatah langka itu untuk perbandingan rutin.

### 3.2 Kuota milik KUNCI, bukan milik orang

Konsekuensi yang wajib disadari saat memakai **universal key**: satu kunci = satu
jatah. Lima puluh user yang berbagi kunci universal berbagi 1000 request/hari,
bukan 1000 masing-masing. Karena itu penghitungan kuota di Fase 3 di-scope ke
kunci yang akan ditagih:

- kunci pribadi (BYOK) → hitung pemakaian user itu saja
- kunci universal → hitung pemakaian **seluruh user** yang memakai kunci itu

Tanpa pembedaan ini, indikator akan memberi tahu lima puluh orang bahwa mereka
masing-masing punya 500 sisa, padahal kunci itu hanya punya 500 total.

**Output fase ini:** satu tabel limit per model di `.env`, plus keputusan
go/no-go untuk dashboard yang angkanya sendiri bersifat rahasia (Pyschem/PQR,
GL/Finance — lihat README §Data sanitization).

---

## 4. Fase 1 — Row Budget Governor  *(dampak terbesar)*

**Masalah terukur:** deep mode = 79.845 token/pertanyaan. Dengan asumsi limit
harian free tier di kisaran ratusan ribu token, satu user deep mode bisa
menghabiskan jatah seluruh pabrik dalam belasan pertanyaan.

**Prinsip:** model tidak butuh 500 baris mentah untuk menjawab "mesin mana yang
paling parah". Ia butuh peringkat teratas + bentuk distribusinya.

### 4.1 Ringkasan cerdas per visual

Untuk visual dengan baris melebihi ambang (default 25):

```
VISUAL: Downtime per Mesin [table] — 487 baris, ditampilkan ringkas
Kolom: Mesin | Line | Downtime (Jam) | Kejadian

TOP 15 (urut Downtime (Jam) desc):
  Filling CMD2 | CMD 2 | 44,55 | 18
  ... 14 baris ...

BOTTOM 5:
  ... 5 baris ...

STATISTIK KOLOM NUMERIK (dihitung dari SELURUH 487 baris):
  Downtime (Jam): total 1.022,63 | rata-rata 2,10 | median 0,84 | maks 44,55 | min 0,01
  Kejadian:       total 1.284    | rata-rata 2,64 | median 2    | maks 18    | min 1

DISTRIBUSI per Line (seluruh baris): CMD 1 = 312,4 (31%) | CMD 2 = 488,1 (48%) | CMD 3 = 222,1 (21%)
```

Kuncinya: **statistik dihitung di backend dari seluruh baris**, jadi total dan
rata-rata tetap benar walau baris mentahnya tidak dikirim. Ini menghilangkan
sumber kesalahan paling umum pada pemotongan data — model menjumlahkan sampel
lalu menyebutnya total.

**Estimasi dampak:** 20 visual × 500 baris → dari 76.233 token menjadi ~6.000
token. **Penghematan ~92%** pada skenario terburuk, dengan kemampuan menjawab
pertanyaan ranking/agregat yang praktis tidak berkurang.

### 4.2 Anggaran token adaptif

Backend menetapkan pagu token per request (default 12.000) lalu membagi jatah:
visual kecil dikirim utuh, visual besar diringkas, dimulai dari yang paling
relevan terhadap kata kunci pertanyaan.

### 4.3 Ubah makna "Deep mode" di UI

Sekarang: "2000 baris/visual". Diubah menjadi **"Analisa mendalam"** — menaikkan
pagu token, tier model, dan jumlah baris top-N; bukan mengirim mentah semuanya.
Label lama menjanjikan hal yang justru merugikan pengguna.

---

## 5. Fase 2 — Pemilihan Model Otomatis  *(diminta)*

**Tujuan:** sistem yang memutuskan, bukan pengguna. Pertanyaan ringan ke model
cepat, pertanyaan berat ke model kuat — sehingga jatah harian model kuat
tersisa untuk yang benar-benar membutuhkannya.

### 5.1 Tier

| Tier (nama ke pengguna) | Model | Dipakai untuk | Latensi |
|---|---|---|---|
| **CODE AI Cepat** | `gemini-3.5-flash-lite` | lookup satu angka, "berapa", "top N", ringkasan pendek | ~0,9 s |
| **CODE AI Standar** | `gemini-3.5-flash` | perbandingan, tren, ranking multi-visual | ~2,2 s |
| **CODE AI Mendalam** | `gemini-3.6-flash` + `thinkingLevel: high` | "kenapa", akar masalah, rekomendasi, multi-halaman, tindak lanjut percakapan | ~2,6 s+ |

### 5.2 Klasifikasi — deterministik, tanpa panggilan API tambahan

Memakai model untuk menilai kompleksitas justru memakan kuota yang mau dihemat.
Klasifikasi dilakukan dengan skor di backend (`services/aiRouter.js`):

| Sinyal | Skor |
|---|---:|
| Kata pemicu RCA (kenapa, mengapa, akar masalah, penyebab, naik, turun, anomali) — sudah ada di `aiKnowledge.js` | +3 |
| Kata rekomendasi/proyeksi (saran, rekomendasi, sebaiknya, prediksi, proyeksi) | +3 |
| Kata perbandingan/tren (bandingkan, tren, dibanding, pola, korelasi) | +2 |
| Snapshot mencakup >1 halaman | +2 |
| Total baris snapshot > 200 | +2 |
| Merujuk turn sebelumnya (kalau begitu, tadi, lanjutkan, jelaskan lebih) | +2 |
| Knowledge pack memuat KPI `[Blocked]` / `[Needs confirmation]` untuk dashboard ini | +1 |
| Pertanyaan > 25 kata | +1 |
| Pertanyaan < 8 kata dan diawali berapa/apa/siapa/kapan/mana | −2 |

Ambang: **≤0 → Cepat**, **1–4 → Standar**, **≥5 → Mendalam**.

### 5.3 Eskalasi otomatis

Jika tier Cepat mengembalikan jawaban yang menandakan kekurangan kapasitas
(mengandung "tidak cukup data" padahal data ada, panjang < 120 karakter untuk
pertanyaan berskor ≥3, atau gagal menyebut satu pun angka dari snapshot), sistem
mengulang **sekali** di tier berikutnya dan menandai jawabannya. Batas satu kali
supaya kegagalan tidak menggandakan konsumsi kuota tanpa batas.

### 5.4 Degradasi karena kuota

Jika sisa kuota tier Mendalam < 15% (Fase 3), routing otomatis diturunkan ke
Standar dan pengguna diberi tahu terus terang — bukan diam-diam.

### 5.5 Kontrol pengguna

Pilihan di panel: **Otomatis** (default) / Cepat / Mendalam. Footer jawaban
menampilkan tier terpilih dan alasannya, contoh:
`CODE AI Mendalam · dipilih karena pertanyaan akar masalah + 2 halaman`.

Transparansi ini penting: tanpa alasan yang terlihat, pengguna akan menyimpulkan
sistem berperilaku acak ketika jawaban terasa berbeda kedalamannya.

---

## 6. Fase 3 — Indikator Sisa Kuota  *(diminta)*

**Kenyataan teknis:** API Gemini tidak mengembalikan sisa kuota. Persentase
apa pun harus dihitung dari penghitung sendiri. Karena itu indikator ini
adalah **estimasi**, dan harus dilabeli demikian di UI — bukan disajikan sebagai
angka resmi dari Google.

### 6.1 Sumber data

`ai_chat_logs` sudah mencatat setiap panggilan beserta `model` dan `created_at`.
Tambahan yang diperlukan (migrasi baru):

```sql
ALTER TABLE ai_chat_logs ADD COLUMN prompt_tokens INT NULL;
ALTER TABLE ai_chat_logs ADD COLUMN output_tokens INT NULL;
ALTER TABLE ai_chat_logs ADD COLUMN total_tokens  INT NULL;
ALTER TABLE ai_chat_logs ADD COLUMN tier VARCHAR(20) NULL;
```

`usageMetadata` dari setiap respons sudah tersedia (sudah diteruskan di
`meta.usage`), tinggal disimpan.

### 6.2 Perhitungan

Kuota free tier bersifat **per API key**. Karena CODE memakai key pribadi per
pengguna, penghitungan dilakukan **per pengguna per model per hari**, dengan
batas hari mengikuti reset Google (**00:00 Pacific Time**, ≈ 15:00 WIB — lihat
Fase 0.5, wajib dikonfirmasi).

```
sisaRequestPct = (limitRPD − terpakaiHariIni) / limitRPD × 100
sisaTokenPct   = (limitTPD − tokenHariIni)   / limitTPD × 100
sisaPct        = min(sisaRequestPct, sisaTokenPct)

perkiraanPertanyaanTersisa = floor(
  min(limitRPD − terpakaiHariIni,
      (limitTPD − tokenHariIni) / rataRataTokenPerPertanyaan7Hari)
)
```

Memakai rata-rata 7 hari **pengguna itu sendiri**, bukan rata-rata global —
pengguna yang terbiasa bertanya mendalam akan melihat estimasi yang lebih kecil,
dan itu memang benar untuk dirinya.

### 6.3 Tampilan

Di panel Ask AI, di bawah bar data:

```
Kuota CODE AI hari ini  ████████████░░░░░░░░  62%  ≈ 31 pertanyaan lagi
Cepat 88% · Standar 71% · Mendalam 34%          reset 15:00 WIB
```

Ambang warna & perilaku:

| Sisa | Warna | Perilaku sistem |
|---|---|---|
| > 40% | hijau | normal |
| 15–40% | kuning | tier Mendalam hanya untuk pertanyaan berskor ≥5 |
| 5–15% | oranye | semua pertanyaan turun ke Cepat/Standar, cache diprioritaskan |
| < 5% | merah | hanya jawaban dari cache; pertanyaan baru ditolak dengan pesan jelas + waktu reset |

### 6.4 Endpoint

`GET /api/ai/quota` →

```json
{
  "resetAt": "2026-08-01T15:00:00+07:00",
  "overall": { "remainingPct": 62, "questionsLeft": 31, "estimated": true },
  "perTier": [
    { "tier": "cepat",    "model": "gemini-3.5-flash-lite", "used": 12, "limit": 100, "remainingPct": 88 },
    { "tier": "standar",  "model": "gemini-3.5-flash",      "used": 29, "limit": 100, "remainingPct": 71 },
    { "tier": "mendalam", "model": "gemini-3.6-flash",      "used": 33, "limit": 50,  "remainingPct": 34 }
  ],
  "avgTokensPerQuestion": 8420
}
```

### 6.5 Kalibrasi terhadap kenyataan

Setiap kali menerima **429**, catat penghitung lokal saat itu. Jika 429 datang
saat indikator masih menunjukkan sisa besar, berarti limit yang dikonfigurasi
salah — sistem menurunkan limit efektif secara otomatis dan mencatat peringatan
untuk admin. Tanpa ini, indikator akan terus berbohong dengan percaya diri.

---

## 7. Fase 4 — Perampingan Knowledge Pack

Untuk pertanyaan sederhana, knowledge pack = **61%** dari prompt (2.877 token).

| Tindakan | Perkiraan hemat |
|---|---|
| Kirim entri registry model yang cocok saja, buang paragraf "Flags" yang bersifat catatan teknis internal | ~600 tok |
| Template jawaban eksekutif hanya untuk tier Standar/Mendalam (pertanyaan lookup tidak butuh struktur Ringkasan/RCA/Rekomendasi) | ~350 tok |
| Legend prefix measure `(M)`/`(alt)`/`Nw` hanya jika nama measure benar-benar muncul di kolom snapshot | ~450 tok |
| Tabel akronim dipangkas ke akronim yang muncul di snapshot/pertanyaan saja | ~300 tok |

**Target:** knowledge untuk tier Cepat turun dari 2.877 → ~1.200 token.
Prompt pertanyaan sederhana turun dari 4.730 → ~3.000 token (**−37%**).

Yang **tidak** boleh dipangkas: aturan anti-halusinasi, status KPI
`[Blocked]`/`[Needs confirmation]`, dan disambiguasi PM/DT. Itu justru penjaga
kualitas jawaban, dan biayanya kecil.

---

## 8. Fase 5 — Cache Berlapis

Urutan pemeriksaan saat pertanyaan masuk:

```
1. Cache jawaban  → cocok? sajikan, 0 panggilan model
2. Snapshot pra-agregasi (Fase 6) → cocok? narasi template, 0 panggilan model
3. Panggil CODE AI sesuai tier (Fase 2)
```

### 8.1 Kunci cache wajib memuat sidik jari data

```
cacheKey = hash(
  dashboardId + normalisasiPertanyaan + snapshotFingerprint + tier
)

snapshotFingerprint = hash(
  daftar halaman terbaca + daftar filter/slicer aktif +
  per visual: judul + jumlah baris + hash isi baris
)
```

Tanpa `snapshotFingerprint`, cache akan menyajikan angka bulan Juli untuk
pertanyaan yang diajukan setelah user mengganti slicer ke Agustus. Ini kesalahan
yang harus dihindari secara desain, bukan lewat kehati-hatian pengguna.

### 8.2 Masa berlaku

| Jenis | TTL | Alasan |
|---|---|---|
| Pertanyaan lookup (tier Cepat) | 6 jam | angka dashboard jarang berubah dalam satu shift |
| Analitis (Standar) | 2 jam | |
| RCA (Mendalam) | 30 menit | konteks investigasi cepat basi |
| Semua | dibatalkan saat fingerprint berubah | |

Cache dibagi **per dashboard**, bukan per pengguna — pertanyaan yang sama dari
manajer berbeda tidak perlu dibayar dua kali. Hak akses tetap diperiksa sebelum
penyajian, jadi berbagi cache tidak membocorkan dashboard yang tidak boleh
diakses.

### 8.3 Context caching eksplisit

Diverifikasi dulu (implicit terbukti tidak aktif). Jika tersedia di free tier dan
ambang minimum tokennya terpenuhi oleh blok sistem+knowledge (3.612 token),
potensi hematnya ~45% untuk pertanyaan sederhana. **Jangan dijadwalkan sebagai
pekerjaan sampai ketersediaannya terbukti.**

---

## 9. Fase 6 — Pra-agregasi Terjadwal

Menjawab pertanyaan rutin tanpa memanggil model sama sekali.

- `node-cron` di dalam backend (bukan tool baru), jalan 06:00 WIB.
- Menarik KPI utama dashboard prioritas → tabel `daily_kpi_snapshot`.
- 10–15 pertanyaan tersering (Fase 0.4) dijawab dari template narasi + angka
  snapshot. Nol token.
- **Wajib**: setiap jawaban jenis ini mencantumkan `data per 06:00 WIB` dan
  tombol "hitung ulang sekarang".
- **Wajib**: status job terakhir dicatat; kegagalan cron memunculkan peringatan
  di panel admin. Snapshot basi yang diam lebih berbahaya daripada job yang
  gagal terang-terangan.

Catatan kejujuran: manfaat fase ini bergantung sepenuhnya pada apakah pertanyaan
manajemen benar-benar berulang. Jika Fase 0.4 menunjukkan pertanyaan sangat
bervariasi, **fase ini sebaiknya dibatalkan**, bukan dipaksakan.

---

## 10. Fase 7 — Antrean, Backoff, Circuit Breaker

- **Antrean per pengguna** di backend; permintaan bersamaan diantre, tidak
  ditembakkan serentak.
- **Retry exponential backoff** saat 429 (1s → 2s → 4s, maksimal 3x), dengan
  pesan jujur: "kuota sedang penuh, mencoba lagi…".
- **Circuit breaker** terhubung ke Fase 3: pada sisa < 5%, hentikan panggilan
  baru dan sajikan cache saja sampai reset.
- **Monitoring**: panel admin berisi pemakaian per pengguna, per tier, per hari,
  plus daftar 429 yang terjadi.

---

## 11. Fase 8 — Rebranding ke "CODE AI"

| Lokasi | Sekarang | Menjadi |
|---|---|---|
| Judul panel | "Ask AI" | "CODE AI" |
| Modal pengaturan | "AI Assistant Settings" / "Gemini API Key" | "CODE AI — Pengaturan" / "Kunci akses CODE AI" |
| Dropdown model | `gemini-3.6-flash` dst. | "Otomatis (disarankan)" / Cepat / Standar / Mendalam |
| Footer jawaban | `gemini-3.6-flash · key pribadi` | `CODE AI Mendalam · kuota pribadi` |
| Pesan error | "Kuota free-tier Gemini habis" | "Kuota CODE AI hari ini habis, reset 15:00 WIB" |
| Ikon header | Sparkles | tetap, dengan tooltip "CODE AI" |

Nama vendor tetap ada di `.env`, `config/gemini.js`, dan README — pengelola sistem
tetap perlu tahu apa yang dipakai di balik layar. Yang dihilangkan hanyalah
kebocoran nama vendor ke antarmuka pengguna akhir.

---

## 12. Fase 9 — Abstraksi Provider (dibangun paralel, bukan di akhir)

Seluruh pemanggilan model sudah terpusat di `config/gemini.js`. Yang perlu
ditambahkan:

```js
// services/aiProvider.js
export async function callAI({ tier, systemInstruction, history, question, signal })
```

Dengan ini, pindah ke tier berbayar atau Vertex AI menjadi perubahan konfigurasi,
bukan penulisan ulang. Ini juga jalur keluar yang dibutuhkan jika keputusan Fase
0.2 menyimpulkan free tier tidak layak untuk data produksi.

---

## 13. Fase 10 — Function Calling *(opsional, paling akhir)*

Hanya jika muncul kebutuhan nyata: pertanyaan tentang data yang **tidak ada di
layar** (periode lain, dimensi yang tidak dipakai visual mana pun).

Jika dikerjakan, syaratnya ketat:

- Tool sempit dan spesifik (`get_downtime_summary(line, periode)`), **bukan**
  `run_dax(query)`.
- Setiap parameter divalidasi whitelist sebelum dieksekusi.
- Hanya memakai measure berstatus `[Confirmed]` di `kpi-dictionary.md`. Measure
  `[Blocked]` (mis. 5 varian "Total Used Time") tidak boleh dipilih otomatis.
- Hasil tool tetap melewati sanitizer sebelum masuk konteks.

Selama pertanyaan pengguna masih seputar yang tampil di dashboard — dan itu
asumsi wajar untuk fitur bernama "tanya dashboard ini" — fase ini tidak
memberikan nilai yang sebanding dengan risikonya.

---

## 14. Prioritas Implementasi

| # | Fase | Dampak terukur | Usaha | Kenapa urutannya di sini |
|---|---|---|---|---|
| 1 | **Fase 1** Row budget governor | −92% pada kasus terburuk | Sedang | Satu-satunya yang menyentuh angka 79.845 token |
| 2 | **Fase 3** Indikator kuota | 0% hemat, tapi mencegah kehabisan mendadak | Sedang | Tanpa ini, optimasi lain tidak terukur berhasil atau tidak |
| 3 | **Fase 2** Routing model otomatis | Menyelamatkan jatah tier Mendalam | Sedang | Bergantung pada Fase 3 untuk mode degradasi |
| 4 | **Fase 7** Antrean & circuit breaker | Mencegah kegagalan beruntun | Ringan | Murah, langsung terasa saat banyak pengguna |
| 5 | **Fase 4** Perampingan knowledge | −37% pertanyaan sederhana | Ringan | |
| 6 | **Fase 5** Cache berlapis | Bergantung tingkat pengulangan | Sedang | Perlu data pemakaian nyata dulu |
| 7 | **Fase 8** Rebranding CODE AI | 0% hemat | Ringan | Bisa jalan paralel kapan saja |
| 8 | **Fase 6** Pra-agregasi | Bergantung Fase 0.4 | Berat | Batalkan jika pertanyaan ternyata bervariasi |
| 9 | **Fase 9** Abstraksi provider | 0% hemat | Ringan | Kerjakan bersamaan Fase 2 |
| 10 | **Fase 10** Function calling | Belum terbukti perlu | Berat | Tunggu kebutuhan nyata |

---

## 15. Checklist QA

- [ ] Statistik agregat (total/rata-rata) dihitung dari **seluruh** baris, bukan
      dari baris yang dikirim — diuji dengan dataset yang sengaja dipotong.
- [ ] Cache tidak pernah menyajikan jawaban lintas-fingerprint — diuji dengan
      mengubah slicer lalu mengulang pertanyaan yang sama persis.
- [ ] Cache lintas-pengguna tetap menghormati hak akses dashboard.
- [ ] Indikator kuota dikalibrasi ulang saat menerima 429 nyata.
- [ ] Reset harian mengikuti zona waktu Google, bukan WIB.
- [ ] Tier terpilih dan alasannya terlihat oleh pengguna.
- [ ] Eskalasi otomatis dibatasi satu kali per pertanyaan.
- [ ] Kegagalan job pra-agregasi memunculkan peringatan, bukan diam.
- [ ] Hasil tool call (jika Fase 10 dikerjakan) tetap melewati sanitizer.
- [ ] Seluruh nama vendor hilang dari antarmuka pengguna, tetap ada di konfigurasi.

---

## 16. Yang Sengaja Tidak Direkomendasikan

| Ide | Alasan penolakan |
|---|---|
| Embedding / vector search untuk cache pertanyaan | Skala kita puluhan pertanyaan per hari. Exact-match + normalisasi teks sudah cukup, dan bebas biaya infrastruktur baru. |
| Memakai model untuk menilai kompleksitas pertanyaan | Memakan kuota yang justru mau dihemat. Skor deterministik cukup dan bisa diaudit. |
| Menaikkan `AI_MAX_ROWS_PER_VISUAL` demi "jawaban lebih akurat" | Terukur: akurasi tidak naik sebanding, tapi token naik linear. Ringkasan + statistik penuh lebih akurat **dan** lebih murah. |
| Menyimpan riwayat percakapan panjang untuk konteks | Sudah dibatasi 6 turn. Menambah panjang menaikkan token setiap request untuk manfaat yang menurun cepat. |
| Mengandalkan implicit caching | Sudah diukur: tidak aktif. |

---

## 17. Hasil Terukur Setelah Implementasi

Diukur 2026-08-01 lewat panggilan API nyata (`usageMetadata.promptTokenCount`),
bukan proyeksi.

| Skenario | Baseline | Proyeksi | **Terukur** | Hemat nyata |
|---|---:|---:|---:|---:|
| Sederhana (dirutekan ke Cepat) | 4.730 | ~3.000 | **3.419** | **−28%** |
| RCA + tabel 500 baris | 28.526* | ~8.000 | **4.593** | **−84%** |
| Deep mode 20 visual × 500 baris | 79.845 | ~7.500 | **~13.000**† | **−84%** |

\* baseline skenario setara (RCA multi-halaman 12×100).
† dari uji unit: 108.668 → 19.450 karakter; belum diverifikasi lewat panggilan API.

**Yang meleset dari proyeksi, dan kenapa:**

- Pertanyaan sederhana hemat 28%, bukan 37%. Perampingan knowledge memang
  memberi −46% pada blok knowledge, tapi instruksi sistem (918 token) dan aturan
  sanitasi tidak bisa dipangkas tanpa mengurangi penjagaan kualitas jawaban.
- Deep mode hemat 84%, bukan 91%. Proyeksi 91% mengasumsikan sampel baris jauh
  lebih kecil; setelah dicoba, memotong lebih dalam mulai menghilangkan contoh
  baris yang dipakai model untuk menjelaskan pola. Batas 150 baris sampel per
  request dipilih sebagai titik henti, bukan angka yang dipaksakan agar cocok
  dengan proyeksi.

**Yang lebih baik dari proyeksi:** RCA atas 500 baris hanya 4.593 token — di
bawah biaya pertanyaan sederhana sebelum optimasi. Penyebabnya statistik agregat
jauh lebih padat daripada baris mentah yang digantikannya.

**Akurasi tidak dikorbankan** — diverifikasi dengan panggilan nyata di atas data
yang diringkas:

> **Q:** "Total kolom Downtime (Jam) di tabel per mesin berapa, dan mesin mana yang tertinggi?"
> **A:** "Total downtime pada tabel per mesin adalah **50.100 Jam**… tertinggi **Mesin 000** di line **CMD 1**."

Total sebenarnya dari 500 baris adalah 50.100 — model membacanya dari blok
STATISTIK, bukan menjumlahkan 15 baris sampel. Inilah alasan blok statistik
dihitung backend dari seluruh baris dan diberi peringatan eksplisit
"JANGAN menjumlahkan sendiri baris yang ditampilkan".

**Cache & routing** (tidak masuk tabel token karena menghemat panggilan, bukan
token per panggilan):

- Pertanyaan berulang dengan data sama: **0 token**, dijawab dari cache.
  Normalisasi teks membuat "berapa total downtime-nya?" mengenai cache milik
  "Berapa total downtime?".
- Perubahan filter/data membatalkan cache — diuji: jawaban ikut angka baru.
- Pertanyaan sederhana kini dilayani tier Cepat (~0,9 detik), menyisakan jatah
  harian tier Mendalam untuk pertanyaan akar masalah.

**Estimasi kapasitas harian efektif:** naik sekitar **4–6 kali lipat**, lebih
rendah dari proyeksi awal 5–8x karena penghematan pertanyaan sederhana tidak
sebesar dugaan. Angka ini tetap estimasi sampai batas kuota nyata diverifikasi
(Fase 0.1) dan pola pemakaian sebenarnya terekam beberapa hari di
`ai_chat_logs`.
