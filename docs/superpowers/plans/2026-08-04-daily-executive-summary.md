# Automated Daily Executive Summary

Status: rencana disetujui, implementasi dimulai 2026-08-04.
Branch: `feat/daily-summary`, bercabang dari `feat/ai-efficiency`.

## 1. Empat prasyarat, dan bagaimana masing-masing terjawab

Spec menuntut keempatnya jelas sebelum coding. Dua terjawab dengan pengukuran,
dua dengan keputusan pemilik.

### 1.1 Capacity tier: Execute Queries BISA

Spec memperkirakan API ini hanya jalan di PPU/Premium/Fabric. Diuji langsung
2026-08-04 ke empat semantic model dengan kredensial yang sudah dipakai
aplikasi:

```
Dashboard PPIC-DS          BISA -> {"[uji]":1}
Dashboard Lembur Plant     BISA -> {"[uji]":1}
Dashboard PPIC             BISA -> {"[uji]":1}
Dashboard Utility (Energy)  BISA -> {"[uji]":1}
```

Tidak ada penghalang capacity. Diuji 4 dari 89 model; panggilan info workspace
sendiri menjawab 401 sehingga label tier-nya tidak terbaca, tapi yang relevan
adalah fungsinya dan fungsinya jalan.

Autentikasi memakai **ROPC** (`grant_type: password`) dengan akun master, bukan
service principal. Konsekuensi yang harus diketahui: kredensial satu orang jadi
titik tunggal kegagalan. Kalau password akun master berubah atau MFA
diberlakukan ke akun itu, seluruh job mati. Ini bukan sesuatu yang bisa
diperbaiki dari dalam modul ini, jadi dicatat sebagai risiko operasional.

### 1.2 Jam refresh: jam 08:00 di spec asli salah

Jadwal terukur, semua zona SE Asia Standard Time (WIB):

| Model | Slot refresh |
|---|---|
| Efis & Losses | 07:00 sampai 21:00, tiap 30 menit, 25 slot |
| NC dan Deviasi | 00:00 07:00 09:00 10:00 12:00 14:00 16:00 18:00 |
| Cycle Time | 03:00 **06:00** 08:00 09:00 10:00 13:00 14:00 16:00 |
| Repetitive NC | **06:00** 10:00 12:00 14:00 16:00 22:00 |
| Overtime | 07:00 13:00 17:00 |
| PPIC | 08:00 08:30 09:00 10:00 13:00 15:00 16:00 17:00 |
| Data Room Quality | 08:00 12:00 16:00 |
| Data Room Service Level | 08:00 12:00 16:00 |
| Kalibrasi Instrument | 08:00 10:00 12:00 14:00 16:00 |
| Lembur Plant | 08:30 10:00 14:00 17:30 |
| Emission CMD | tanpa jadwal, teramati harian sekitar 00:05 |

Keputusan pemilik: **kumpulkan data 06:00, kirim pesan 08:00.** Digeser ke
**06:15** karena Cycle Time dan Repetitive NC refresh tepat jam 06:00 dan job
bisa membaca model di tengah refresh.

Konsekuensi yang tidak bisa dihilangkan dengan kode: model yang refresh pagi
pertamanya jam 08:00 atau lebih hanya punya data sampai sore kemarin pada saat
job jalan. Yang paling terpengaruh adalah **Lembur Plant (17:30)** dan
**Overtime (17:00)**, justru KPI yang nilainya bertambah di malam hari. Angka
biaya lembur akan sistematis lebih rendah dari kenyataan. Laporan wajib
menyebut batas waktunya, bukan menyajikan angkanya tanpa keterangan.

### 1.3 Provider WhatsApp: Baileys, kirim ke Group

Keputusan pemilik: kirim ke Group, dengan kesadaran penuh ini unofficial.
Dipilih **Baileys**, bukan `whatsapp-web.js`, karena yang kedua menjalankan
Chromium lewat Puppeteer, sekitar 300 MB dan satu proses browser penuh di
server, hanya untuk satu pesan sehari. Risiko ToS keduanya sama.

Risiko yang wajib ditulis di README: melanggar ToS WhatsApp, nomor pengirim
bisa dibatasi atau diblokir, dan sesi bisa putus sewaktu-waktu sehingga job
gagal tanpa sebab yang jelas dari sisi kode.

### 1.4 Logika filter tanggal per model

Tidak diasumsikan seragam. Setiap KPI di katalog membawa field `dateLogic`
eksplisit, dan nilai default tidak disediakan: KPI tanpa `dateLogic` gagal
divalidasi saat startup, bukan diam-diam memakai cutoff tanggal biasa.

## 2. Cakupan KPI: penuh, dengan provenance

Keputusan pemilik: masukkan semua, termasuk `[Needs confirmation]` dan
`[Blocked]`, karena pemilik dan timnya yang akan menilai benar atau salahnya.

Risiko yang sudah disampaikan dan diterima: angka yang belum terverifikasi akan
tampil di laporan yang dibaca management.

Cara memasukkannya dibuat supaya penilaian itu mungkin:

1. **KPI `[Blocked]` mengeluarkan semua varian berdampingan**, masing-masing
   dengan nama measure aslinya. Tidak ada satu varian yang dipilih diam-diam.
   Selama ini yang menghalangi keputusan kanonik adalah tidak ada yang pernah
   melihat angka varian-varian itu bersebelahan di data nyata.
2. **Status ikut sampai ke pesan akhir.** Angka `[Needs confirmation]` dan
   `[Blocked]` masuk bagian terpisah, bukan bercampur dengan angka yang sudah
   pasti.
3. **Prompt Gemini menerima status per KPI**, supaya analisis root cause tidak
   dibangun di atas angka provisional. Guardrail §6 diperkuat: klaim yang
   bersandar pada KPI non-Confirmed wajib menyebutnya.
4. **Historical store menyimpan nama measure yang dipakai** per KPI per hari,
   jadi kalau nanti varian kanonik dipilih, angka lama masih bisa ditelusuri
   asalnya.

## 3. Arsitektur: katalog deklaratif, bukan fungsi per domain

Spec §8 dan §10 meminta `getYesterdayProduction()`, `getYesterdayQuality()`,
dan seterusnya. Ditulis sebagai fungsi terpisah per domain, 32 baris KPI
lintas 25 model akan melahirkan duplikasi DAX yang dilarang §17.

Karena itu inti modul ini adalah satu **katalog KPI deklaratif**. Setiap entri:

```js
{
  domain: "production",
  kpi: "Total Output",
  modelName: "Dashboard Efis & Losses",   // diresolusi ke GUID saat runtime
  measures: ["Total Output"],              // >1 berarti varian bersaing
  unit: "pcs",
  status: "confirmed",                     // confirmed | needs_confirmation | blocked
  dateLogic: "...",                        // WAJIB, tidak ada default
  notes: "...",
}
```

`getYesterdayProduction()` dan kawan-kawannya tetap ada sebagai pembungkus tipis
yang memfilter katalog per domain, jadi kontrak §10 terpenuhi tanpa DAX
berulang. Menambah atau memperbaiki KPI berarti mengubah data, bukan menulis
fungsi baru.

Ini juga yang membuat §5 terpenuhi lebih baik daripada aslinya: asumsi filter
tanggal jadi field yang bisa divalidasi program, bukan komentar di kode yang
tidak ada yang memeriksa.

## 4. Nama model diresolusi lewat GUID, bukan nama

API mengembalikan `Dashboard Warehouse Utilization ` dengan spasi di ujung.
Registry mencatat model ini sebagai gagal ditemukan justru karena itu, salah
satu dari 9 model yang dianggap hilang. Pencocokan nama memakai `trim()` plus
lowercase, hasilnya di-cache sebagai GUID, dan seluruh query memakai GUID.

## 5. Nama measure diverifikasi, tidak diasumsikan

`EVALUATE INFO.MEASURES()` dijawab 400 oleh Execute Queries, jadi nama measure
tidak bisa ditemukan otomatis. Registry menulis nama KPI, yang tidak selalu
sama dengan nama measure.

Langkah pertama implementasi adalah skrip verifikasi: untuk setiap measure di
katalog, jalankan `EVALUATE ROW("v", [Nama Measure])`. Yang gagal ditandai dan
diperbaiki sebelum satu baris pipeline pun dibangun. Katalog dengan nama
measure yang salah menghasilkan KPI yang hilang tanpa error yang jelas.

## 6. dataFreshness didefinisikan ulang

Spec §10 meminta `"fresh" | "stale" | "unavailable"` tanpa mendefinisikan
batasnya. Ukuran "seberapa baru" tidak menjawab pertanyaan yang sebenarnya
penting, yaitu apakah datanya sudah mencakup seluruh hari yang dilaporkan.

Definisi yang dipakai:

- `full` — ada refresh selesai **setelah** hari laporan berakhir, jadi datanya
  mencakup hari itu penuh
- `partial` — refresh terakhir sebelum itu, disertai `cutoffWib` supaya pesannya
  bisa menyebut "data sampai 17:30"
- `unavailable` — query gagal total setelah retry

## 7. Kunci Gemini untuk job tanpa user

Job cron tidak punya konteks user, jadi kunci pribadi tidak berlaku. Job
memakai **kunci universal** dari tabel `ai_settings` yang terenkripsi. Kalau
kunci universal belum diatur, job berhenti di tahap AI dengan alert, dan tetap
mengirim fallback berisi angka KPI mentah, karena angka tanpa analisis masih
berguna sementara analisis tanpa angka tidak.

Versi model di-pin lewat env, bukan alias latest, dan dicatat di setiap baris
hasil sesuai §12.3.

## 8. Stack: JavaScript ESM plus JSDoc

Spec §8 menulis `.ts`, §17 meminta ikut struktur existing, dan keduanya
bertentangan. Keputusan pemilik: ikut yang existing.

Backend ini JS ESM murni tanpa langkah build, 294 uji dijalankan langsung oleh
node. Kontrak data KPI dijaga lewat JSDoc typedef plus **validasi runtime di
batas data**, yang justru menangkap bentuk tak terduga dari Power BI, hal yang
tipe compile-time tidak bisa lakukan karena respons API tidak diperiksa
compiler.

Historical store memakai **MySQL**, bukan SQLite atau Postgres. `mysql2` sudah
dipakai seluruh aplikasi; `pg` dan `knex` ada di dependencies tapi tidak
terpakai, dan menambah database kedua untuk satu modul tidak dibenarkan.

Alerting memakai `nodemailer` yang sudah terkonfigurasi. Nol dependensi baru
untuk §14.

## 9. Dua job, bukan satu

Keputusan 06:00 kumpulkan dan 08:00 kirim memisahkan pembuatan dari pengiriman,
dan itu lebih baik daripada satu job di spec asli:

```
06:15  kumpulkan
       lock -> cek refresh -> DAX per KPI -> simpan snapshot
       -> ambil pembanding dari store -> Gemini -> validasi -> simpan hasil
       gagal? retry terjadwal sampai 07:45, masih ada waktu

08:00  kirim
       baca hasil tervalidasi hari ini -> kirim ke Group -> tandai terkirim
       belum ada hasil? kirim fallback angka mentah + alert
```

Idempotensi berlaku di kedua job dan bersandar pada kolom di
`daily_summary_result`, bukan pada state di memori, supaya restart server tidak
menyebabkan kirim ganda.

## 10. Urutan pengerjaan

1. Skrip verifikasi nama measure, katalog KPI awal
2. `dateWindow.util.js`, `sanitizeText.util.js` plus ujinya
3. Skema MySQL historical store, `historicalStore.service.js`
4. `jobLock.js` plus uji simulasi tumpang tindih
5. `powerbiSummary.service.js`: resolusi GUID, cek refresh, DAX, retry backoff
6. `geminiSummary.service.js`, `summaryFormatter.js`, validasi output §7.1
7. `alerting.service.js` lewat nodemailer
8. `whatsapp.service.js` dengan Baileys, plus README risiko
9. Cron dua jadwal, `adminTrigger.controller.js` dengan dry-run
10. Uji regresi: Chat AI dan Power BI harus tetap 294 lulus tanpa perubahan

## 11. Yang tidak dikerjakan dan sebabnya

- **Azure Key Vault**: §16 sendiri menyebutnya improvement lanjutan, bukan
  blocker MVP
- **Catch-up policy** ditulis di env sebagai `skip` secara default. Job jam
  06:15 yang terlewat karena server mati tidak dijalankan otomatis jam 09:00,
  karena laporan yang datang setelah morning meeting tidak berguna dan justru
  membingungkan. Manual trigger tetap tersedia.
