# Desain CIA Hybrid Visual Blueprint dan Live Query

Tanggal: 2026-08-29  
Status: disetujui pemilik proyek (`approved hybrid`)  
Melengkapi: `2026-08-27-cia-evidence-orchestrator-prd.md`

## Ringkasan

CIA mempertahankan ketajaman analisis dari export visual, tetapi tidak lagi
memakai filter visual sebagai batas data. Metadata visual menjadi blueprint
untuk memilih measure, dimensi, label bisnis, dan bentuk breakdown. Nilai untuk
periode, entitas, dan agregasi yang diminta user diambil ulang lewat Live DAX
langsung dari semantic model.

Desain berlaku untuk Tanya CIA di dashboard, Multi-Chat, dan WhatsApp. Ia tidak
di-hardcode untuk downtime atau lembur: routing dan planning menggunakan konsep
KPI, entitas, periode, operasi analitik, serta kontrak evidence yang sama untuk
produksi, PO, deviasi, overtime, cost, quality, inventory, dan domain lain.

## Masalah yang dibuktikan

1. `preferredDashboardIds` sudah masuk ke scope, tetapi tidak memengaruhi skor
   kandidat. Tanya CIA di `Technical Downtime Report` dapat memilih `Technical
   Downtime ORS` meskipun user meminta mesin yang ada pada report aktif.
2. Skor token menjadikan kata generik seperti `top` dan `tertinggi` penentu
   sumber. Pertanyaan lembur kemudian dijawab dengan data downtime.
3. Router hanya membaca pertanyaan terbaru. Planner menerima riwayat chat, tetapi
   tidak dapat memilih KPI sebelumnya jika router tidak memasukkannya sebagai
   kandidat.
4. Jawaban sebelumnya disimpan sebagai teks dan metadata sumber, belum sebagai
   kontrak evidence yang bisa diwarisi follow-up.
5. Inventory visual menyimpan struktur visual yang dulu menghasilkan analisis
   tajam, tetapi pipeline direct-query belum memakainya sebagai blueprint query.
6. Coverage library belum cukup: 44 dashboard aktif, 32 memiliki inventaris
   visual, 12 belum dipanen, 28 belum memiliki binding query-ready, dan ratusan
   binding belum mempunyai mapping tanggal.

## Keputusan desain

### 1. Intent frame domain-agnostic

Sebelum routing, pertanyaan dinormalisasi menjadi intent frame:

- business concepts: downtime, running hours, produksi, PO, deviasi, overtime;
- entities: mesin, produk, CMD, plant, departemen, kategori;
- period: hari ini, kemarin, minggu ini, tanggal/range, bulan, cut-off;
- requested metrics: total, percentage, achievement, cost, count, duration;
- operations: ranking, breakdown, comparison, explanation, correlation;
- source constraint: dashboard/model tertentu bila user menyebutkannya;
- continuity: new topic, refinement, drill-down, comparison, atau calculation.

Daftar konsep berasal dari KPI Library dan vocabulary dashboard, bukan enum
domain tetap di kode. Kata analitik generik tidak menjadi business anchor.

### 2. Contextual rewrite sebelum routing

Follow-up mewarisi evidence contract dari turn terakhir yang relevan:

- dashboard dan semantic model;
- KPI/binding/measure;
- periode dan filter;
- dimensi/grouping;
- entitas hasil utama;
- numerator/denominator;
- pertanyaan yang belum terjawab.

Contoh `berapa persentasenya terhadap used time?` mewarisi mesin, section,
periode, dan downtime dari turn sebelumnya, lalu menambah running/used time
sebagai denominator. Topic switch eksplisit tidak mewarisi filter yang tidak
relevan.

### 3. Routing dengan business-anchor gate

Routing dilakukan dalam urutan berikut:

1. sumber yang disebut eksplisit oleh user;
2. binding dari evidence contract follow-up;
3. dashboard yang sedang dibuka bila konsepnya cocok;
4. kandidat lain dalam ACL user untuk kebutuhan tambahan/korelasi.

Kandidat wajib berbagi setidaknya satu business anchor dengan intent. `top`,
`tertinggi`, `detail`, `analisa`, periode, dan nama dimensi generik tidak cukup
untuk meloloskan kandidat. Preferred dashboard memperoleh prioritas, bukan
eksklusivitas. Dashboard lain dapat ditarik jika KPI yang dibutuhkan memang
tidak tersedia di sumber utama.

Jika tidak ada kandidat anchored yang query-ready, CIA berhenti secara
transparan. CIA tidak boleh mengganti data lembur dengan downtime, report
Maintenance dengan ORS, atau mesin yang diminta dengan mesin lain.

### 4. Visual blueprint, Live DAX values

Untuk setiap visual, blueprint minimum berisi:

- dashboard/report/page/visual;
- semantic model;
- measure yang digunakan;
- dimensi dan hierarchy;
- caption manusia;
- date mapping dan period policy;
- fungsi visual: total, trend, ranking, detail, numerator/denominator;
- nilai filter hanya sebagai konteks tampilan, bukan default query global.

Planner memilih blueprint yang menjawab intent, lalu membangun DAX baru dengan
filter dari pertanyaan. Slicer report aktif hanya diwarisi jika user merujuk
`data yang sedang tampil`, `filter ini`, atau frasa setara. Untuk pertanyaan
periode/entitas eksplisit, filter pertanyaan menang. Untuk `keseluruhan`, filter
tampilan diabaikan.

Export visual tetap dipakai sebagai snapshot fallback dan sebagai blueprint
analisis. Ia bukan sumber utama untuk permintaan historis atau filter baru.

### 5. Evidence plan komposabel

Satu pertanyaan dapat menghasilkan beberapa goal terikat:

- nilai utama dan breakdown;
- numerator serta denominator untuk persentase;
- actual dan target/PO untuk achievement;
- issue, cause, action, serta status untuk diagnosis;
- model tambahan untuk korelasi.

Join lintas sumber hanya dilakukan dengan key kompatibel: periode, plant/CMD,
produk, mesin, departemen, atau identifier confirmed. CIA membedakan bukti sebab,
korelasi, indikasi, dan data yang belum cukup.

### 6. Synthesis berbasis pertanyaan

Synthesis hanya boleh menggunakan evidence yang cocok dengan:

- konsep;
- entitas;
- periode;
- source constraint;
- operasi yang diminta.

Output memakai label manusia dari KPI Library/visual caption. Nama teknis seperti
`nama_mesin`, qualified column, atau measure mentah tidak ditampilkan. Jika
sebagian proses gagal, hanya evidence relevan yang berhasil ditampilkan; data
domain atau entitas lain tidak boleh dijadikan pengganti.

### 7. Coverage dan pembaruan library

Coverage per dashboard memiliki status:

- not harvested;
- inventory ready;
- mapping proposed;
- ambiguous/review required;
- date policy missing;
- query ready;
- contextual ready.

Exact match model + measure + visual dapat dibuat sebagai proposal
`discovered`. Mapping ambigu, label bisnis, denominator, join key, dan aturan
cut-off memerlukan review admin. Binding `confirmed` tidak ditimpa sync.

## Kontrak penyimpanan turn

Metadata turn ditambah `evidence_contract` yang berisi ID dan metadata aman,
bukan row mentah atau DAX lengkap:

```json
{
  "topic": ["technical downtime"],
  "entities": [{ "type": "machine", "value": "Evergreen ESL 950ml" }],
  "periods": [{ "start": "2026-08-10", "end": "2026-08-16" }],
  "sources": [{ "dashboardId": "44", "semanticModel": "Maintenance Downtime" }],
  "goals": [{ "bindingId": "...", "dimensions": ["Mesin", "Masalah"] }],
  "filters": [],
  "openQuestions": []
}
```

## Acceptance corpus

Corpus produksi yang diberikan pemilik proyek menjadi regression suite. Ia
mencakup:

1. downtime dua mesin, konversi jam, dan persentase terhadap running hours;
2. achievement produksi dan fulfillment PO sampai hari Kamis;
3. ranking downtime lintas plant;
4. output produk mingguan dan kemarin;
5. snapshot khusus hari ini;
6. rincian deviasi CMD 3;
7. penyebab operational downtime;
8. issue dan tindakan mesin dengan downtime tertinggi;
9. nilai downtime eksplisit dan rincian penanganan;
10. overtime Sabtu/Minggu serta hari libur pada periode cut-off;
11. biaya estimasi lembur tanggal tertentu dan cost per departemen;
12. kendala produksi hari ini lalu follow-up technical downtime saja;
13. drill-down mesin/filler tertentu;
14. status perbaikan Evergreen;
15. deviasi CMD 3 dengan nilai eksplisit;
16. source constraint hanya dashboard NC dan Deviasi;
17. comparison production output dengan PO;
18. planning dibanding output;
19. routine downtime Evergreen pada range tanggal dan follow-up hari/issue.

Duplikasi/parafrasa pada 27 contoh dipertahankan untuk membuktikan router tidak
bergantung pada satu susunan kata.

Setiap test menilai source/model, periode, entitas, goal/measure class,
dimensions, larangan sumber tidak relevan, dan label manusia. Nilai produksi
aktual diuji melalui smoke test, bukan di-hardcode ke unit test.

## Rollout

1. Contextual intent dan business-anchor routing di belakang feature flag.
2. Evidence contract pada Multi-Chat dan Tanya CIA.
3. Visual blueprint resolver serta query override filter.
4. Composite goals numerator/denominator dan actual/target.
5. Shared adapter WhatsApp.
6. Coverage audit, harvest 12 dashboard tersisa, dan Admin review flow.
7. Jalankan corpus pada staging; aktifkan penuh setelah tidak ada cross-domain
   answer dan smoke query utama lulus.

Rollback mengembalikan orchestrator flag ke versi sebelumnya tanpa menghapus
binding, history, atau telemetry.

## Bantuan data yang mungkin diperlukan

- akses membuka 12 dashboard yang belum mempunyai `visual_field_usage`;
- konfirmasi business owner untuk period policy cut-off;
- konfirmasi pasangan numerator/denominator atau join key yang ambigu;
- kredensial Power BI tetap dikelola melalui konfigurasi existing dan tidak
  ditaruh di dokumen atau log.

## Definition of done

- Pertanyaan tidak pernah dijawab memakai domain/model/entitas yang tidak
  relevan hanya karena kandidat lain mempunyai skor lebih tinggi.
- Filter pertanyaan dapat membaca data di luar slicer aktif tanpa user mengubah
  dashboard.
- Follow-up dapat memperluas atau menghitung ulang evidence turn sebelumnya.
- Pertanyaan dari 27-contoh corpus menghasilkan plan relevan pada seluruh
  surface yang memiliki akses.
- Jawaban menggunakan bahasa bisnis dan menyebut keterbatasan dengan tepat.
- Seluruh unit/integration test dan production smoke yang aman lulus.
