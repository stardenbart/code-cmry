# CODE AI — Rencana Efisiensi Tahap 2

**Tanggal:** 2026-08-02
**Konteks:** evaluasi 20 usulan arsitektur hemat-token terhadap implementasi CODE AI yang sudah berjalan
**Dokumen terkait:** `CODE-AI-OPTIMIZATION-PLAN.md` (tahap 1, sudah selesai & terukur)

---

## 0. Ringkasan Eksekutif

Dari 20 usulan, **8 sudah terpasang** di tahap 1, **5 layak dikerjakan**, dan
**7 tidak cocok** dengan arsitektur CODE — bukan karena idenya buruk, tapi karena
mengasumsikan fondasi yang tidak kita punya.

**Ketidakcocokan utama yang harus disepakati dulu:** usulan 1, 2, dan 4 semuanya
berdiri di atas asumsi adanya **REST API di atas database** —
`/api/oee`, `/api/downtime/top-machine`, `SELECT MAX(Downtime)`. CODE tidak
punya itu. Data kita tidak pernah lewat SQL: ia hidup di semantic model Power BI
dan hanya bisa diambil lewat dua jalan — `exportData` di browser (yang kita
pakai) atau DAX `executeQueries` (yang knowledge pack sendiri peringatkan
berisiko: 5 measure "Total Used Time" duplikat, KPI berstatus `[Blocked]`,
tabel terpisah per line CMD).

Kabar baiknya: **manfaat terbesar usulan itu bisa diraih tanpa REST API sama
sekali.** Snapshot yang sudah ada di backend adalah tabel terstruktur, dan
`services/tabular.js` sudah menghitung total/rata-rata/median/max/min dari
seluruh baris. Artinya pertanyaan seperti *"berapa total downtime?"* atau
*"mesin mana tertinggi?"* bisa dijawab **dari snapshot, di JavaScript, dengan nol
token** — tanpa membangun lapisan data baru. Itu inti Fase A di bawah.

---

## 1. Status 20 Usulan

### 1.1 Sudah terpasang (tahap 1)

| # | Usulan | Realisasi di CODE | Bukti |
|---|---|---|---|
| 3 | Semantic layer / ringkasan, bukan raw JSON | Row budget governor: top-N + bottom-N + statistik dari **seluruh** baris | 108.668 → 19.450 char (−82%) |
| 19 | Context compression | Sama dengan #3, plus pembulatan desimal panjang | 20×500 baris: 76.233 → ~13.000 tok |
| 5 | Multi-level cache | Cache jawaban per dashboard + sidik jari data + normalisasi teks | *"berapa total downtime-nya?"* mengenai cache milik *"Berapa total downtime?"* |
| 7 | Conversation memory ring | Riwayat dibatasi 6 turn, snapshot selalu dikirim baru | `AI_HISTORY_TURNS=6` |
| 8 | Structured prompt | Peran + aturan + gaya jawaban eksplisit, bukan "silakan analisa" | `services/aiContext.js` |
| 9 | Limit output | `maxOutputTokens` per tier (1024 / 2048 / 4096) | `services/aiProvider.js` |
| 10 | Temperature rendah | 0.2 | `config/gemini.js` |
| 18 | Dashboard metadata | Knowledge pack: arti KPI, status `[Confirmed]`, tabrakan akronim | `knowledge/powerbi-analyst/` |
| 20 | Model berbeda per kompleksitas | Router skor deterministik → 3 tier | terukur: sederhana 3.419 tok, RCA 4.593 tok |

**Catatan penting soal #5:** usulan menyarankan Redis. CODE berjalan sebagai satu
proses PM2, jadi `Map` in-memory memberi hasil yang sama tanpa menambah
infrastruktur. Redis baru masuk akal kalau nanti backend di-scale horizontal.

### 1.2 Layak dikerjakan

| # | Usulan | Bentuk yang cocok untuk CODE | Prioritas |
|---|---|---|---|
| 1, 2, 14 | Intent classification + rule engine + AI trigger threshold | **Local answerer dari snapshot**, bukan dari REST API | **1 (tertinggi)** |
| 11 | JSON mode | Hanya untuk jawaban terstruktur (RCA), bukan semua | 3 |
| 15, 16 | Precomputed insight / morning summary | Butuh scheduler + bukti pertanyaan berulang | 4 (bersyarat) |
| 5b | Cache paraphrase | Perluas normalisasi, **tanpa embedding** | 2 |

### 1.3 Tidak direkomendasikan

| # | Usulan | Alasan penolakan |
|---|---|---|
| 4 | Smart API (`/api/oee`, bukan `/api/all-dashboard`) | API itu tidak ada. Membangunnya = proyek data layer baru (DAX per KPI + validasi measure `[Blocked]`), bukan optimasi. Manfaatnya sudah 90% tertutup Fase A. |
| 6, 12 | Embedding search atas SOP / manual | CODE tidak menyimpan SOP atau manual sama sekali. Ini fitur baru (ingest dokumen), bukan penghematan token. Kalau memang dibutuhkan, ajukan sebagai proyek terpisah. |
| 13 | Hybrid search | Butuh korpus dokumen yang belum ada. Usulan itu sendiri mencatat "keyword sering sudah cukup" — untuk katalog 44 dashboard, pencocokan kata memang sudah cukup. |
| 17 | Vector cache | Turunan dari 6/12. Tanpa korpus, tidak ada yang di-cache. |
| — | Redis | Satu proses PM2; `Map` sudah setara. Menambah layanan yang harus dijaga tanpa manfaat pada skala ini. |

---

## 2. Fase A — Local Answerer *(dampak terbesar)*

Realisasi usulan 1, 2, dan 14 pada arsitektur yang benar-benar kita punya.

**Prinsipnya:** snapshot sudah ada di backend sebagai tabel terstruktur, dan
statistiknya sudah dihitung. Pertanyaan yang jawabannya **sudah ada di angka
itu** tidak perlu dikirim ke model sama sekali.

### 2.1 Intent yang dijawab lokal (nol token)

| Intent | Contoh pertanyaan | Sumber jawaban |
|---|---|---|
| `TOTAL` | "berapa total downtime?" | `columnStats().total` |
| `MAX` / `MIN` | "mesin mana downtime paling tinggi?" | baris teratas kolom rank |
| `TOP_N` | "top 3 mesin downtime" | N baris teratas |
| `AVG` | "rata-rata OEE berapa?" | `columnStats().mean` |
| `COUNT` | "ada berapa mesin?" | `rows.length` / distinct |
| `VALUE_OF` | "downtime mesin Filler A berapa?" | pencarian baris |
| `SHARE` | "CMD 2 menyumbang berapa persen?" | `groupTotals()` |
| `FILTER_STATE` | "filter apa yang aktif sekarang?" | `snapshot.filters` |

Semua sudah tersedia di `services/tabular.js` — yang perlu dibangun hanyalah
pengenal intent + perender kalimat.

### 2.2 Bentuk implementasi

`services/aiLocalAnswer.js`:

```js
// { answered: true, text, intent, confidence } | { answered: false, reason }
export function tryAnswerLocally({ question, snapshot, dashboard })
```

Dipanggil di controller **sebelum** cache dan sebelum pemilihan tier:

```
pertanyaan masuk
  → local answerer   ← 0 token, ~1 ms
  → cache jawaban    ← 0 token
  → tier routing → Gemini
```

### 2.3 Aturan yang membuat ini aman

Ini bagian yang paling menentukan apakah fitur ini menolong atau merusak
kepercayaan:

1. **Ambang keyakinan.** Kalau pengenal intent tidak yakin (kolom ambigu, dua
   kolom numerik sama-sama cocok, entitas tidak ketemu) → **jangan dijawab
   lokal**, lempar ke AI. Salah menjawab lebih mahal daripada satu panggilan.
2. **Kata pemicu analitis membatalkan jalur lokal.** "kenapa", "bandingkan",
   "tren", "rekomendasi", "menurutmu" → langsung ke AI walaupun ada angka yang
   cocok. Pertanyaan *"kenapa total downtime naik?"* mengandung "total", tapi
   yang diminta bukan angkanya.
3. **Jawaban lokal ditandai jelas di UI** — badge "Dijawab langsung dari data
   dashboard · 0 kuota". User berhak tahu kapan yang menjawab bukan AI.
4. **Selalu sertakan konteks filter**, sama seperti jawaban AI, supaya angkanya
   tidak salah dibaca.
5. **Tombol "Tanya AI untuk analisa lebih dalam"** di bawah jawaban lokal —
   kalau jawaban template terasa kurang, user bisa naik satu langkah tanpa
   mengetik ulang.

### 2.4 Perkiraan cakupan — jujur

Usulan menargetkan **60-70%** pertanyaan selesai tanpa AI. Dari log nyata
`ai_chat_logs` sejauh ini (67 entri, tapi **mayoritas masih dari pengujian saya,
belum sampel user sebenarnya**), bentuk pertanyaannya:

| Jenis | Contoh dari log | Bisa lokal? |
|---|---|---|
| Total / lookup | "Berapa total downtime?" | ✅ |
| Max + total gabungan | "Total kolom Downtime berapa, dan mesin mana tertinggi?" | ✅ |
| Investigatif | "Kenapa downtime naik drastis bulan ini?" | ❌ |
| RCA + rekomendasi | "Summary-kan issue mesin ABP, lakukan RCA, beri rekomendasi" | ❌ |
| Navigasi / glosarium | "Apa itu MTBF?", "data apa saja yang ada?" | sebagian (glosarium ✅) |

Estimasi realistis untuk CODE: **35-50%** pertanyaan dashboard selesai lokal —
bukan 60-70%. Alasannya, CODE dipakai untuk **dashboard yang angkanya sudah
terpampang di layar**. User yang cuma butuh satu angka cenderung membacanya
sendiri; yang membuka CODE AI biasanya justru ingin interpretasi. Angka
60-70% lebih masuk akal untuk chatbot atas database mentah, bukan atas dashboard
yang sudah divisualisasikan.

**Target ini harus diukur ulang setelah 2 minggu pemakaian nyata**, bukan
diasumsikan. Fase A akan mencatat `intent` dan `answered_locally` di
`ai_chat_logs` supaya angkanya bisa dihitung, bukan diperdebatkan.

---

## 3. Fase B — Cache Paraphrase (tanpa embedding)

Usulan #5 ingin *"berapa oee hari ini"*, *"oee hari ini berapa"*, *"today oee"*
mengenai satu cache. Normalisasi sekarang sudah menangani sebagian (imbuhan
-nya, tanda baca, kata basa-basi). Yang perlu ditambah:

1. **Urutan kata tidak relevan** — normalisasi jadi *bag of words* terurut untuk
   pertanyaan pendek (≤8 kata). *"oee hari ini berapa"* = *"berapa hari ini oee"*.
2. **Sinonim domain** — peta kecil buatan tangan: `downtime ↔ dt`,
   `output ↔ produksi ↔ hasil`, `mesin ↔ machine`, `rata-rata ↔ average ↔ avg`.
3. **Bahasa Inggris ↔ Indonesia** untuk istilah yang sering dicampur.

**Kenapa bukan embedding:** embedding butuh panggilan API (biaya token untuk
menghemat token) atau model lokal (dependensi baru). Untuk puluhan pertanyaan
per hari dengan kosakata yang sempit, peta sinonim buatan tangan lebih akurat,
gratis, dan bisa di-debug. Embedding baru layak kalau volume pertanyaan
menembus ratusan per hari dengan kosakata yang benar-benar beragam.

---

## 4. Fase C — JSON Mode Selektif

Usulan #11 benar untuk jawaban **terstruktur**. Tapi menerapkannya ke semua
jawaban akan merusak yang sekarang sudah bagus: jawaban RCA yang mengalir dengan
Ringkasan → Data → Rekomendasi lebih mudah dibaca manajemen daripada tiga kotak
kaku.

Penerapan yang tepat:

- **Navigator** — sudah JSON. Terbukti menghemat dan memungkinkan tombol.
- **RCA terstruktur** — opsional, sebagai mode "ringkas" yang bisa dipilih user.
- **Jawaban biasa** — tetap prosa.

Perkiraan hemat: kecil (output token kita sudah dibatasi per tier). Prioritas
rendah, dikerjakan kalau ada waktu luang.

---

## 5. Fase D — Precomputed Insight *(bersyarat)*

Usulan #15/#16 — insight per jam dan ringkasan pagi. Ini pengulangan Fase 6 di
dokumen tahap 1, yang sengaja ditunda. Syarat yang belum terpenuhi masih sama:

1. Butuh bukti pertanyaan benar-benar berulang antar user (belum ada; log masih
   didominasi pengujian).
2. Butuh scheduler + penarikan data terjadwal dari Power BI, yang **tidak bisa
   memakai `exportData`** — itu hanya jalan di browser. Perlu jalur DAX
   `executeQueries`, dengan semua risiko measure ambigu yang sudah didokumentasikan.
3. Dengan tier Mendalam hanya **20 request/hari**, ringkasan otomatis harian
   memakan jatah yang lebih berguna untuk investigasi ad-hoc.

**Rekomendasi: tunda sampai Fase A berjalan 2 minggu** dan datanya menunjukkan
pertanyaan yang benar-benar berulang.

---

## 6. Target Komposisi — Revisi Berbasis Arsitektur

| Jalur | Target usulan | **Target realistis CODE** | Alasan revisi |
|---|---:|---:|---|
| Tanpa AI (rule/local) | 60-70% | **35-50%** | Tidak ada REST API; user dashboard cenderung bertanya interpretatif |
| Cache | 20-30% | **20-30%** | Sudah terpasang; naik setelah Fase B |
| AI ringan (tier Cepat/Standar) | 5-10% | **20-30%** | Porsi yang tidak bisa dijawab lokal jatuh ke sini |
| AI mendalam (RCA) | <5% | **<5%** | Sesuai; dibatasi keras oleh 20 request/hari |

Artinya panggilan ke Gemini turun dari **100%** pertanyaan menjadi sekitar
**25-35%** — bukan 5-15% seperti target usulan, tapi tetap penghematan besar
**di atas** penghematan −82% per panggilan yang sudah dicapai di tahap 1.

Gabungan keduanya: dibanding implementasi awal "semua pertanyaan → LLM dengan
data mentah", konsumsi token turun sekitar **90-95%**. Target 80-95% dari usulan
**tercapai** — hanya lewat jalan yang berbeda: sebagian besar dari kompresi data
(sudah), sisanya dari menghindari panggilan (Fase A & B).

---

## 7. Urutan Pengerjaan

| # | Fase | Usaha | Dampak | Syarat |
|---|---|---|---|---|
| 1 | **A — Local answerer** | Sedang | Menghilangkan 35-50% panggilan | — |
| 2 | **B — Cache paraphrase** | Ringan | Menaikkan hit rate cache | — |
| 3 | Instrumentasi intent di `ai_chat_logs` | Ringan | Membuat target bisa diukur | dikerjakan bersama A |
| 4 | C — JSON mode selektif | Ringan | Kecil | — |
| 5 | D — Precomputed insight | Berat | Bergantung pola pakai | 2 minggu data nyata |

---

## 8. Cara Mengukurnya (bukan menebaknya)

Fase A menambah dua kolom di `ai_chat_logs`:

```sql
ALTER TABLE ai_chat_logs ADD COLUMN intent VARCHAR(30) NULL;
ALTER TABLE ai_chat_logs ADD COLUMN answered_locally TINYINT(1) DEFAULT 0;
```

Setelah dua minggu, satu query menjawab apakah rencana ini berhasil:

```sql
SELECT
  SUM(answered_locally = 1)                     AS lokal,
  SUM(from_cache = 1)                           AS cache,
  SUM(answered_locally = 0 AND from_cache = 0)  AS ke_gemini,
  ROUND(100 * SUM(answered_locally = 1 OR from_cache = 1) / COUNT(*)) AS persen_tanpa_token
FROM ai_chat_logs
WHERE error IS NULL AND created_at >= (NOW() - INTERVAL 14 DAY);
```

Kalau `persen_tanpa_token` di bawah 30%, asumsi Fase A salah dan intent-nya perlu
diperluas — atau memang pertanyaan user lebih analitis dari dugaan, yang berarti
biaya token itu memang nilai yang dibayar, bukan pemborosan.

---

## 9. Yang Perlu Diputuskan Sebelum Mulai

1. **Apakah membangun lapisan data (DAX/REST) masuk roadmap?** Kalau ya, usulan
   1/2/4 versi penuh jadi mungkin — tapi itu proyek tersendiri dengan risiko
   kebenaran angka yang harus ditangani lewat konfirmasi measure `[Blocked]` ke
   pemilik model. Kalau tidak, Fase A adalah bentuk terbaik yang bisa dicapai.
2. **Apakah ada korpus SOP/manual yang ingin ditanyakan?** Kalau ada, usulan
   6/12/13/17 berubah dari "tidak cocok" menjadi proyek RAG tersendiri yang
   layak dipertimbangkan.
3. **Berapa target user aktif?** Dengan kunci universal, 1.020 request/hari
   dibagi bersama. Di atas ~30 user aktif harian, BYOK atau kunci berbayar
   menjadi keharusan, dan efisiensi token tidak lagi bisa menutupinya.
