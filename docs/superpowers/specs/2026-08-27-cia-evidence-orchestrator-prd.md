# PRD dan Desain CIA Evidence Orchestrator

Tanggal: 2026-08-27  
Status: disetujui pemilik proyek  
Produk: CODE — Cimory Operational Digital Enhancement

## Ringkasan

CIA akan diubah dari tiga jalur analisis yang berbeda menjadi satu mesin bukti
bersama untuk Tanya CIA di dashboard, Multi-Chat Dashboard, WhatsApp, dan
scheduled update. Mesin ini memilih semantic model, menyusun dan menjalankan
DAX, menilai apakah bukti yang tersedia sudah cukup, lalu menarik dashboard
tambahan bila pertanyaannya membutuhkan korelasi lintas sumber.

Snapshot visual tetap dipertahankan sebagai fallback, bukan sebagai sumber data
utama. Jawaban selalu menyebut sumber, periode, kesegaran, metode retrieval, dan
kekuatan kesimpulannya. Nama measure teknis tidak ditampilkan kepada user.

Admin memperoleh halaman khusus untuk pengelolaan CIA, analytics pemakaian,
health retrieval, KPI Library, konfigurasi global, pairing WhatsApp, tujuan
grup/channel, serta multi-schedule dengan message composer.

## Masalah saat ini

### Jalur data terpisah

- Tanya CIA di dashboard membaca snapshot visual yang sedang dirender. User harus
  mengatur filter atau halaman terlebih dahulu untuk memperoleh periode lain.
- Multi-Chat memilih dashboard tetapi tetap menarik snapshot off-screen. Datanya
  terbatas pada visual dan state report yang berhasil dirender.
- DAX agent sudah dapat membaca schema, menyusun DAX, dan menjalankan Execute
  Queries, tetapi hanya dipakai pada WhatsApp.
- Ketika DAX agent gagal, WhatsApp jatuh ke ringkasan snapshot yang lebih sempit.

### Router dapat menghasilkan false negative

Pada 2026-08-27, dua pertanyaan berikut gagal sebelum DAX dibuat:

- breakdown lembur per departemen berdasarkan alasan dan kategori;
- breakdown issue deviasi CMD 3.

Gemini mengembalikan daftar model kosong dan kode memperlakukan hasil itu sebagai
keputusan final. Padahal inventaris aktual memuat `Dashboard Lembur Plant`,
`Dashboard Overtime`, dan `Dashboard NC dan Deviasi`, beserta field kategori,
deskripsi, cause, dan action yang relevan. Fallback lalu mengatakan detail tidak
tersedia karena snapshot ringkas memang tidak memuat field tersebut.

### Pengelolaan CIA tersebar

- CIA access berada di User Management.
- Personal key, universal key, dan provider berada di Pengaturan CIA.
- Visual Harvest dan job summary berada di bagian bawah Manage Users.
- Jadwal laporan adalah satu konfigurasi global, bukan daftar schedule.
- Tidak ada satu tempat untuk melihat frekuensi penggunaan, token input/output,
  DAX success rate, fallback, latency, atau error per tahap.

### KPI knowledge tersebar

Pengetahuan CIA saat ini berasal dari `KATALOG_KPI`, Markdown knowledge pack,
`model_measure`, dan `visual_field_usage`. Admin belum dapat mengedit hubungan
antara nama KPI manusia, measure, dashboard, fungsi, dan pertanyaan yang dapat
dijawab. Perubahan semantic model juga belum direkonsiliasi menjadi draft yang
dapat ditinjau.

## Tujuan produk

1. Menjadikan direct semantic-model query sebagai kemampuan bersama website dan
   WhatsApp.
2. Memungkinkan CIA menarik data historis maupun aktual tanpa bergantung pada
   filter visual user.
3. Memungkinkan pertanyaan dan follow-up memicu retrieval dashboard tambahan.
4. Menghasilkan analisis korelasi lintas dashboard dengan batas kesimpulan yang
   jelas.
5. Menyatukan observability dan analytics CIA pada halaman admin khusus.
6. Membuat KPI Library yang dapat diedit, versioned, dan disinkronkan dengan
   kondisi model serta visual aktual.
7. Mendukung satu nomor WhatsApp aktif yang dapat dipairing ulang, beberapa
   grup/channel, dan beberapa schedule.
8. Mempertahankan fallback yang aman ketika provider AI atau Power BI gagal.

## Bukan tujuan versi ini

- Membuktikan kausalitas hanya dari dua tren yang bergerak bersama.
- Menghapus snapshot capture; snapshot tetap dibutuhkan sebagai fallback dan
  sumber pembanding terhadap tampilan user.
- Menjalankan lebih dari satu nomor WhatsApp secara bersamaan.
- Menyediakan percakapan interaktif di WhatsApp Channel. Channel bersifat
  broadcast; tanya jawab tetap melalui grup.
- Mengirim attachment atau media ke Channel. Composer versi pertama berfokus
  pada pesan teks karena delivery media newsletter Baileys belum stabil.
- Mengizinkan mapping KPI yang diusulkan AI langsung menjadi confirmed tanpa
  persetujuan admin.
- Mengubah dashboard access menjadi data-level security Power BI. Website tetap
  menggunakan permission CODE yang sudah ada.

## Persona dan use case utama

### User website

- Bertanya tentang dashboard yang sedang dibuka tanpa mengatur slicer dulu.
- Meminta data bulan lalu, tahun lalu, hari ini, atau periode khusus.
- Melanjutkan pertanyaan dan membiarkan CIA menarik dashboard lain bila perlu.
- Menggunakan Multi-Chat untuk analisis lintas dashboard tanpa mencentang sumber
  secara manual.

### Anggota grup WhatsApp

- Menandai CIA dan memperoleh jawaban dari seluruh semantic model yang disetujui
  untuk CIA.
- Menerima jawaban parsial yang transparan bila sebagian sumber gagal.

### Penerima broadcast

- Menerima CIA Daily Update atau custom reminder dari grup/channel yang telah
  didaftarkan admin.

### Admin

- Melihat penggunaan, biaya token, health, error, dan fallback.
- Membuka atau menutup akses CIA per user.
- Mengelola universal key, provider, timeout, dan batas retrieval.
- Memelihara KPI Library dan menyetujui hasil discovery.
- Pairing ulang nomor bot, mengelola tujuan, membuat beberapa schedule, dan
  meninjau delivery history.

## Keputusan arsitektur

### Satu Evidence Orchestrator

Semua kanal memanggil satu service orchestration. Controller website dan listener
WhatsApp hanya menerjemahkan identitas, izin, percakapan, dan bentuk respons.
Mereka tidak memiliki algoritma routing atau DAX sendiri.

Alur satu request:

1. Normalisasi pertanyaan dan konteks percakapan.
2. Tentukan scope model yang diizinkan.
3. Jalankan deterministic semantic router dari KPI Library.
4. Gunakan AI planner untuk memperluas atau mengurutkan kandidat yang ambigu.
5. Susun retrieval plan dengan pertanyaan bukti yang terpisah.
6. Ambil schema model terpilih.
7. Susun DAX, validasi, lalu jalankan lewat guard yang ada.
8. Bila DAX gagal, lakukan satu query-repair menggunakan pesan errornya.
9. Nilai kecukupan bukti dan tarik model tambahan bila diperlukan.
10. Normalisasi hasil ke nama KPI manusia.
11. Susun jawaban, sumber, periode, freshness, dan confidence.
12. Bila direct retrieval tidak cukup, gunakan snapshot yang tersedia dan beri
    label fallback.

Orchestrator dibatasi maksimum empat putaran retrieval per request. Satu putaran
dapat membaca beberapa model yang independen secara paralel. Batas ini mencegah
loop, latency tak terkendali, dan pemborosan token.

### Scope akses per kanal

- Tanya CIA dan Multi-Chat website hanya dapat membaca dashboard yang memang
  dapat diakses user. Hubungan dashboard ke semantic model berasal dari KPI
  bindings dan report inventory.
- Dashboard yang sedang dibuka menjadi kandidat awal, bukan satu-satunya sumber.
- WhatsApp menggunakan scope centralized: seluruh semantic model aktif yang
  disetujui untuk CIA boleh dipakai.
- Admin CIA dapat membaca analytics seluruh kanal, tetapi secret dan credential
  tidak pernah dikembalikan.

### Routing hybrid

Deterministic router adalah sumber kandidat minimum. AI router tidak boleh
menghapus kandidat deterministik dan hasil AI kosong tidak boleh menghentikan
retrieval.

Skor deterministic router memakai:

- nama KPI manusia dan sinonim;
- domain/departemen;
- pertanyaan yang dapat dijawab;
- dashboard dan semantic model;
- measure serta caption visual;
- dimensi dan value vocabulary.

Kata generik seperti `breakdown`, `issue`, atau `detail` memiliki bobot rendah.
Kata spesifik seperti `lembur`, `PO`, `deviasi`, `CMD 3`, dan nama produk memiliki
bobot tinggi. Ini mencegah kata `breakdown` mengarahkan pertanyaan lembur ke
maintenance.

### Retrieval lintas dashboard

Planner membentuk evidence tasks. Contoh pertanyaan korelasi lembur dan PO:

1. Tarik jam lembur per departemen dan periode.
2. Tarik kategori serta deskripsi pekerjaan/alasan departemen teratas.
3. Bila bukti menyebut kenaikan produksi atau permintaan, tarik PO dan capaian
   produksi pada periode, plant, dan produk yang sama.
4. Breakdown produk dengan kenaikan PO terbesar.
5. Tarik production output bila diperlukan untuk membedakan rencana dari
   realisasi.
6. Gabungkan bukti berdasarkan periode, plant/CMD, departemen, produk, atau
   mesin yang kompatibel.

Planner dapat menambah dashboard pada follow-up tanpa meminta user memilih atau
memuat ulang dashboard.

### Aturan kesimpulan korelasi

Setiap hubungan lintas sumber diberi salah satu label:

- `terbukti`: detail alasan atau kategori secara eksplisit menyebut faktor yang
  juga didukung dashboard lain;
- `korelasi kuat`: periode, unit organisasi, dan objek analisis cocok, tetapi
  sebab eksplisit tidak tersedia;
- `indikasi`: hanya sebagian join key cocok atau freshness berbeda;
- `belum dapat dibuktikan`: data tidak cukup atau sumber saling bertentangan.

CIA tidak menggunakan kata `karena` untuk korelasi kuat atau indikasi. Jawaban
menyebutkan bukti yang mendukung dan bagian yang masih belum tersedia.

## Perilaku per surface

### Tanya CIA di dashboard

- Direct query berjalan tanpa bergantung pada slicer, halaman, atau refresh user.
- Pertanyaan tanpa periode memakai aturan periode KPI dan tanggal laporan terkini.
- Pertanyaan periode eksplisit memakai tanggal tersebut bila model mendukungnya.
- Snapshot tampilan aktif tetap dapat digunakan untuk pertanyaan seperti “angka
  yang sedang saya lihat” atau sebagai fallback.
- CIA dapat menarik dashboard lain selama masih dalam permission user.

### Multi-Chat Dashboard

- Memakai cakupan retrieval langsung yang sama dengan Tanya CIA dan WhatsApp.
- Checkbox dashboard manual bukan prasyarat. Jika tetap dipertahankan sebagai
  kontrol UI, nilainya hanya menjadi hint/preference bagi planner.
- Setiap turn dapat memakai sumber yang berbeda dari turn sebelumnya.
- Riwayat menyimpan sumber yang benar-benar dibaca, bukan sekadar yang disarankan.

### WhatsApp Q&A

- Pertanyaan grup menggunakan Evidence Orchestrator.
- Semua model CIA yang aktif dapat dipakai.
- Snapshot mingguan menjadi fallback terakhir.
- Jawaban menyebut periode dan status fallback.
- Channel/newsletter tidak menerima pertanyaan interaktif.

### Scheduled message

- CIA Daily Update memakai orchestrator untuk mengumpulkan bukti centralized.
- Custom Reminder menggunakan template tanpa wajib memanggil AI.
- Setiap schedule dan tujuan dieksekusi serta dicatat secara independen.

## Human-readable result contract

Hasil internal mempertahankan nama model, tabel, kolom, measure, dan DAX untuk
audit. Hasil yang dikirim ke user memakai:

1. nama KPI confirmed dari library;
2. caption visual bila mapping KPI belum confirmed;
3. nama field yang sudah dibersihkan dari qualifier teknis sebagai fallback
   terakhir, disertai status label belum diverifikasi.

Nama seperti `Dashboard Lembur Plant[(true) Jam yang dibayar]` tidak boleh muncul
di jawaban. Formatter juga menerapkan unit, gaya angka Indonesia, dan keterangan
estimasi/final dari binding KPI.

## Halaman Admin CIA

Halaman penuh tersedia di `/admin/cia` dan hanya dapat dibuka role admin.

### Overview

- total request;
- active users;
- token input, output, dan total;
- direct-query success rate;
- fallback rate;
- error rate;
- median dan P95 latency;
- tren harian;
- perbandingan Dashboard CIA, Multi-Chat, WhatsApp, Navigator, dan Scheduled.

### Usage Analytics

Filter yang wajib tersedia:

- custom date range dan preset hari/minggu/bulan;
- nama user;
- departemen;
- surface;
- dashboard;
- semantic model;
- provider dan model AI;
- status berhasil, parsial, fallback, atau gagal.

Breakdown wajib:

- request per user, departemen, dashboard, dan surface;
- token input/output seluruh tahap;
- dashboard yang dibaca per request;
- putaran retrieval;
- latency;
- jumlah analisis lintas dashboard;
- key source personal, universal, atau job.

### CIA Access

Hak `Boleh memakai CIA` dipindahkan dari Manage Users ke tab ini. Manage Users
tetap mengelola akun, role, password, dan dashboard access. CIA Access mendukung
pencarian serta filter departemen dan menampilkan status personal key tanpa
pernah memperlihatkan nilainya.

### Retrieval Health

- error per stage;
- false-negative/empty AI router;
- schema dan dataset resolution failure;
- DAX validation, execution, dan repair;
- direct versus snapshot;
- freshness semantic model;
- latency per model;
- provider fallback;
- trace detail berdasarkan request ID.

### Global Settings

- provider default;
- universal key;
- retrieval rounds, timeout, dan fallback policy;
- status job key;
- personal/BYOK tetap self-service pada user dan tidak dapat dibaca admin.

### KPI Library

- browse, search, filter, edit, confirm, block, dan retire KPI;
- jalankan synchronization;
- review draft dan missing bindings;
- bandingkan serta pulihkan revision.

### WhatsApp & Schedule

- status nomor aktif dan pairing;
- destination management;
- multi-schedule;
- composer, preview, test send, dan delivery history.

## Telemetry dan analytics contract

Satu `request_id` mengikat seluruh tahap. Token router, planner, DAX repair, dan
answer synthesis dihitung terpisah lalu dijumlahkan pada request.

### `cia_requests`

Menyimpan satu baris per pertanyaan atau generation run:

- request ID;
- user ID nullable untuk job/WhatsApp;
- nama/departemen snapshot untuk agregasi historis;
- surface;
- conversation/turn reference;
- waktu mulai/selesai;
- status;
- input/output/total tokens;
- total latency;
- jumlah retrieval rounds;
- direct, partial, atau snapshot fallback;
- sanitized question preview dan fingerprint.

### `cia_request_events`

Menyimpan event stage:

- request ID dan urutan;
- stage: route, plan, schema, generate_dax, execute_dax, repair_dax,
  synthesize, fallback;
- dashboard ID dan semantic model nullable;
- provider/model AI nullable;
- token input/output;
- latency;
- jumlah baris;
- status dan normalized error code;
- metadata JSON yang tidak memuat secret.

Analytics menghitung request menggunakan `cia_requests` dan drill-down memakai
events. Event per dashboard membuat filter dashboard dapat menggunakan kolom
biasa, bukan mencari isi JSON.

Log lama pada `ai_chat_logs` dan `ai_unified_turns` tidak dihapus. Migrasi
mengisi request historis yang dapat dipetakan dan compatibility reader menangani
baris yang tidak memiliki detail stage.

## KPI Library

### Data konseptual

`cia_kpis` menyimpan nama manusia, sinonim, definisi, fungsi, pertanyaan yang
dapat dijawab, domain, unit, format, status, versi, dan audit actor.

`cia_kpi_bindings` menyimpan hubungan KPI ke dashboard, report, halaman, visual,
semantic model, tabel, measure, dimensi, kolom tanggal, date logic, source,
first_seen, last_seen, dan verification status.

`cia_kpi_revisions` menyimpan snapshot sebelum/sesudah, actor, waktu, dan alasan
perubahan. Revision dapat dipulihkan tanpa menghapus histori.

### Seed aktual

Versi awal diimpor dari:

- `KATALOG_KPI`;
- `kpi-dictionary.md` dan data dictionary;
- `model_measure`;
- `visual_field_usage`;
- dashboard/report mapping.

Hardcoded catalog tetap menjadi fallback sampai import divalidasi. Setelah itu,
database menjadi sumber utama dan fallback dipertahankan untuk recovery.

### Discovery dan reconciliation

- Schema tracing memperbarui tabel, kolom, measure, dan `last_seen` ketika model
  dipakai atau admin melakukan sync.
- Visual tracing berjalan saat report dirender melalui Power BI SDK atau saat
  admin menjalankan Visual Harvest.
- Binding baru masuk sebagai draft.
- Binding yang tidak ditemukan lagi menjadi missing, bukan dihapus.
- AI boleh mengusulkan nama, sinonim, fungsi, dan pertanyaan, tetapi tidak boleh
  mengubah status menjadi confirmed.
- Mapping confirmed tidak ditimpa discovery otomatis.

## WhatsApp dan destination management

### Satu nomor aktif

`WHATSAPP_BOT_NUMBER` menjadi default instalasi. Database dapat menyimpan nomor
yang diharapkan sebagai override. Nomor aktual selalu dibaca dari sesi Baileys.
Perbedaan keduanya ditampilkan sebagai health warning.

Admin dapat memulai pairing ulang. Tindakan ini:

1. meminta konfirmasi;
2. menghentikan koneksi lama;
3. mencabut sesi lama;
4. membuat sesi baru;
5. menampilkan QR atau pairing code yang hanya dapat dibaca admin;
6. kedaluwarsa otomatis;
7. memverifikasi nomor aktual setelah tersambung.

Credential multi-file Baileys tetap berada di session directory. Credential,
QR, dan cryptographic material tidak disimpan di database atau log.

### Destinations

`cia_notification_destinations` menyimpan nama, type group/channel, JID, aktif,
last delivery status, dan last error. JID group harus berakhiran `@g.us`; channel
harus berakhiran `@newsletter`.

Semua destination menerima konten centralized yang sama. Grup dapat dipilih dari
daftar yang diikuti bot. Channel ditambahkan dengan newsletter JID. Test message
tersedia per destination.

Pengiriman channel versi pertama adalah teks. Status pengiriman dibedakan menjadi
sent, confirmed, partial, failed, dan unknown agar kegagalan ACK tidak terlihat
sebagai sukses.

## Multi-schedule dan composer

### Data konseptual

- `cia_schedules`: nama, jenis, template, frekuensi, hari, jam, menit, zona,
  provider, aktif, last run, next run, dan revision.
- `cia_schedule_destinations`: relasi many-to-many schedule dan destination.
- `cia_schedule_runs`: periode, idempotency key, generation status, dan output.
- `cia_delivery_attempts`: destination, attempt, status, receipt, error, dan
  waktu.

### Jenis schedule

- `cia_daily_update`: menjalankan Evidence Orchestrator lalu mengisi
  `{cia_summary}`.
- `custom_reminder`: merender template tanpa wajib memanggil AI.

### Composer

Composer mendukung teks, preview, test send, duplicate, revision history, dan
variabel:

- `{tanggal}`;
- `{hari}`;
- `{jam}`;
- `{periode_laporan}`;
- `{cia_summary}`.

Variabel yang tidak dikenal ditolak sebelum schedule disimpan. Zona waktu bawaan
adalah `Asia/Jakarta`. Setiap schedule dapat memilih hourly, daily, atau weekly.
Lebih dari satu schedule boleh jatuh tempo pada waktu yang sama.

Schedule lama pada `report_setting` dimigrasikan menjadi `CIA Daily Update`.
Nilai environment menjadi default bila database belum memiliki schedule.

### Eksekusi

- Scheduler berdetak tiap menit dan membaca database tanpa restart.
- Database lock dan idempotency key mencegah run ganda.
- Setiap pasangan schedule-destination dikirim independen.
- Retry hanya untuk timeout, rate limit, dan error server sementara.
- Retry dibatasi dan menggunakan backoff.
- Kegagalan satu tujuan tidak mengubah status tujuan lain.

## Error handling dan reliability

- Timeout dan error provider disimpan dengan stage dan normalized error code.
- DAX yang salah memperoleh satu repair attempt.
- Query kosong dibedakan dari routing kosong, model tidak ditemukan, dataset
  unauthorized, Power BI unavailable, dan filter menghasilkan nol baris.
- HTTP 400 dari DAX tidak diulang sebagai network retry.
- HTTP 429, 503, 504, dan timeout boleh diulang sesuai backoff yang dibatasi.
- Partial answer berisi sumber yang berhasil dan daftar bagian yang tidak dapat
  dijawab.
- Snapshot fallback menyebut periode snapshot serta alasan direct retrieval
  gagal.
- Error detail untuk user tidak memuat DAX mentah, secret, atau response body
  sensitif.
- Admin trace dapat melihat DAX yang sudah disanitasi dan pesan error Power BI
  yang dipangkas aman.

## Keamanan dan authorization

- Seluruh endpoint CIA membutuhkan JWT dan `requireCiaAccess`, kecuali endpoint
  status/personal setting yang memang dibutuhkan sebelum akses aktif.
- Seluruh endpoint Admin CIA membutuhkan `requireAdmin`.
- Website memeriksa dashboard access sebelum setiap retrieval, bukan hanya saat
  router memilih kandidat.
- WhatsApp hanya melayani grup yang aktif pada destination list.
- Scheduled broadcast hanya dikirim ke destination aktif.
- Snapshot, schema, DAX result, history, dan knowledge disanitasi sebelum
  menyeberang ke provider AI.
- Universal dan personal key tetap encrypted at rest.
- Session credential WhatsApp tidak pernah masuk database, response, atau log.
- Pairing code/QR memiliki TTL dan hanya satu pairing flow boleh aktif.
- Rate limit diterapkan per user pada website dan per group pada WhatsApp.

## API contract tingkat produk

Nama endpoint final mengikuti pola route existing dan dikunci pada implementation
plan. Kelompok kemampuan yang wajib tersedia:

- ask/orchestrate dan request trace;
- admin analytics summary, timeseries, dan breakdown;
- CIA access management;
- KPI list, detail, edit, confirm, revision, sync, dan sync status;
- WhatsApp status, pair, disconnect, destinations, dan test send;
- schedules CRUD, preview, run, duplicate, history, dan delivery detail.

Pagination wajib pada daftar request, KPI, user, schedule run, dan delivery
attempt. Filter analytics divalidasi server-side dan query agregasinya memakai
index tanggal, user, surface, dashboard, dan status.

## Backward compatibility dan migrasi

1. Buat tabel telemetry, KPI, destination, schedule, dan delivery baru secara
   idempotent.
2. Seed KPI Library tanpa menonaktifkan hardcoded catalog.
3. Migrasikan `report_setting` menjadi satu schedule dan destination.
4. Pasang compatibility reader untuk log lama.
5. Aktifkan orchestrator pada Multi-Chat dan Tanya CIA dengan feature flag.
6. Aktifkan orchestrator WhatsApp setelah health menunjukkan direct-query path
   stabil.
7. Pindahkan CIA access dari Manage Users setelah halaman Admin CIA tersedia.
8. Pertahankan rute lama selama satu release sebagai adapter ke service baru.

Tidak ada tabel atau riwayat lama yang dihapus pada rollout awal.

## Acceptance criteria

### Retrieval

- Pertanyaan lembur dan deviasi yang menjadi kasus regresi tidak berhenti pada
  hasil AI router kosong.
- Tanya CIA, Multi-Chat, dan WhatsApp menggunakan orchestrator yang sama.
- Multi-Chat dapat menarik data historis/aktual dan menambah model pada turn baru.
- Tanya CIA dapat menjawab periode lain tanpa user mengubah slicer.
- Satu request tidak melewati empat retrieval rounds.
- DAX repair dilakukan paling banyak sekali per model.
- Partial dan fallback answer selalu diberi label.

### Korelasi

- Pertanyaan PO-produksi-lembur menarik sumber yang relevan dan menyebut join
  keys serta periode.
- CIA tidak menyatakan sebab ketika bukti hanya menunjukkan korelasi.
- Sumber yang freshness-nya berbeda disebutkan.

### Human-readable output

- Jawaban user tidak memuat nama measure teknis atau qualified column.
- Unit, status estimasi/final, dan format angka mengikuti KPI binding.
- Sumber dashboard, periode, retrieval method, dan confidence tersedia dalam
  metadata jawaban.

### Admin analytics

- Analytics dapat difilter berdasarkan range tanggal, user, departemen,
  dashboard, surface, model, provider, dan status.
- Input/output tokens seluruh stage terhitung.
- Direct success, fallback, error stage, latency median/P95, dan active users
  terlihat.
- Request trace dapat dibuka tanpa memaparkan secret.

### KPI Library

- Versi aktual dapat diimpor dari empat sumber existing.
- Field baru menjadi draft dan field hilang menjadi missing.
- Sync tidak menimpa mapping confirmed.
- Revision dapat dibandingkan dan dipulihkan.

### WhatsApp dan schedule

- Hanya satu nomor aktif; admin dapat pairing ulang dan melihat nomor aktual.
- Beberapa group/channel dapat aktif bersamaan.
- Lebih dari satu schedule dapat dibuat dan dijalankan.
- CIA Daily Update dan Custom Reminder dapat dipreview dan ditest.
- Kegagalan satu destination tidak menggagalkan destination lain.
- Run ganda dicegah oleh idempotency key dan database lock.

## Strategi pengujian

### Unit

- deterministic router dengan kasus lembur, deviasi, PO, dan kata generik;
- merge kandidat AI tidak dapat menghapus kandidat deterministic;
- retrieval round limit dan query-repair limit;
- evidence confidence dan larangan klaim kausal;
- human-name formatter;
- KPI reconciliation serta revision;
- template parser dan invalid variable;
- due-time serta idempotency schedule;
- destination JID validation;
- token aggregation.

### Integration

- orchestrator dengan fake AI dan fake Power BI client;
- website authorization per dashboard;
- telemetry request dan events;
- partial multi-model result;
- snapshot fallback;
- schedule ke beberapa destination dengan satu kegagalan;
- pairing state machine dengan fake Baileys socket;
- migration dari report setting lama.

### Frontend

- Admin CIA route dan authorization;
- analytics filters serta empty/error/loading states;
- CIA access bulk interaction;
- KPI edit, sync diff, dan revision restore;
- pairing status dan expiring code;
- multi-schedule composer, preview, duplicate, dan delivery history;
- Multi-Chat source metadata dan automatic additional retrieval.

### Production smoke

- read-only query pada satu model prioritas per domain;
- kasus regresi lembur dan deviasi;
- test message ke destination khusus;
- satu custom reminder non-AI;
- verifikasi analytics menerima request dan token tanpa secret.

## Rollout

### Fase 1 — Foundation dan observability

Telemetry, Admin CIA shell, analytics, request trace, dan regression tests.

### Fase 2 — KPI Library

Schema/import, bindings, sync, revision, dan human-readable formatter.

### Fase 3 — Evidence Orchestrator website

Routing hybrid, iterative retrieval, correlation, Tanya CIA, dan Multi-Chat.

### Fase 4 — WhatsApp dan multi-schedule

Orchestrator WhatsApp, pairing admin, destinations, composer, schedule runs, dan
delivery audit.

### Fase 5 — Stabilization

Production smoke, health threshold review, removal of obsolete UI placement,
dan dokumentasi operasional.

Setiap fase menghasilkan software yang dapat diuji dan direview sendiri. Feature
flag memungkinkan rollback ke jalur snapshot tanpa menghapus telemetry atau KPI
Library.

## Risiko dan mitigasi

### AI router atau DAX tidak deterministik

Mitigasi: kandidat minimum deterministic, query validation, satu repair, batas
putaran, regression corpus, dan fallback transparan.

### Semantic model berubah

Mitigasi: schema/visual tracing, `last_seen`, draft/missing reconciliation, dan
confirmed binding yang tidak ditimpa otomatis.

### Korelasi dibaca sebagai sebab

Mitigasi: evidence labels, join-key disclosure, language guard, dan tests untuk
larangan klaim kausal.

### Latency serta token membesar

Mitigasi: retrieval plan kecil, parallel model yang independen, maksimal empat
putaran, row limit, stage telemetry, dan cache schema.

### Power BI limitation atau permission

Mitigasi: health per model, normalized error, partial answer, dan snapshot
fallback. Model dengan RLS/SSO yang tidak dapat diakses direct ditandai pada KPI
binding dan health.

### WhatsApp session conflict atau channel delivery tidak stabil

Mitigasi: satu sesi aktif, conflict state, backoff, confirmation status, test
message, text-only channel, dan delivery audit per destination.

### Data sensitif masuk log

Mitigasi: sanitized preview, no secret fields, no raw credential, admin-only
trace, dan redaction test.

## Definition of done produk

Fitur dianggap selesai ketika seluruh acceptance criteria terpenuhi, automated
tests lulus, migration dapat diulang dengan aman, production smoke berhasil,
Admin CIA dapat menjelaskan setiap fallback berdasarkan request trace, dan tiga
kanal utama menghasilkan jawaban dari Evidence Orchestrator yang sama.
