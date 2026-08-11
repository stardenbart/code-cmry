# Rebrand CODE AI menjadi CIA, plus perkenalan diri

Tanggal: 2026-08-11
Status: disetujui pemilik proyek

## Tujuan

Mengganti nama produk asisten dari "CODE AI" menjadi "CIA (Cimory Intelligence
Assistant)" di seluruh teks yang dibaca manusia atau dibaca model, dan menambah
kemampuan CIA memperkenalkan dirinya sendiri: sekali saat dimasukkan ke sebuah
grup WhatsApp, dan kapan pun ada yang bertanya dia siapa.

Rebrand ini sengaja dibatasi pada lapisan teks. Tidak ada perubahan perilaku,
tidak ada perubahan skema yang menyentuh data lama, dan tidak ada langkah deploy
khusus di luar merge biasa.

## Bukan tujuan

Hal-hal berikut secara sadar TIDAK dikerjakan di sini, masing-masing dengan
alasannya:

- Mengganti nama berkas `frontend/src/components/CodeAINavigator.jsx`. Nama
  berkas tidak pernah dilihat user. Menggantinya menambah derau di diff dan
  memutus riwayat blame tanpa manfaat yang sepadan.
- Mengganti env var `CODE_AI_UNIVERSAL_KEY`. Ini satu-satunya bagian rebrand
  yang bisa menyebabkan downtime: kalau berkas `.env` di server tidak ikut
  diubah saat deploy, kunci universal terbaca kosong dan setiap user yang tidak
  punya kunci pribadi kehilangan akses AI tanpa pesan error yang jelas.
- Mengganti rute `/api/ai/...` dan kunci pada tabel `ai_settings`. Keduanya
  sudah netral terhadap merek.
- Mengganti nama di `docs/superpowers/plans/` dan `docs/superpowers/specs/`,
  termasuk `docs/CODE-AI-OPTIMIZATION-PLAN.md` dan
  `docs/CODE-AI-EFFICIENCY-V2.md`. Enam puluh dari tujuh puluh tujuh kemunculan
  ada di sana, dan semuanya catatan pekerjaan yang sudah lewat. Mengubahnya
  berarti menulis ulang sejarah sehingga catatan tidak lagi cocok dengan commit
  yang menyertainya.
- Mengubah data yang sudah tersimpan: laporan yang sudah terkirim, riwayat chat,
  dan temuan lintas dashboard. Isinya adalah rekaman apa yang benar-benar
  dikirim saat itu.
- Access control CIA, provider multi-model, dan menu setelan laporan. Ketiganya
  subsistem terpisah dengan siklus spec sendiri.

## Penulisan nama

Bentuk panjang `CIA (Cimory Intelligence Assistant)` dipakai SEKALI di tempat
yang wajar, yaitu header panel AI di web dan halaman setelan AI. Di seluruh
tempat lain cukup `CIA`, termasuk setiap balasan WhatsApp, karena balasan bot
harus pendek dan kepanjangan yang diulang terus terasa kaku.

## Cakupan penggantian

Teks yang dilihat manusia atau dibaca model:

- Frontend: label, judul menu, header, teks tombol, dan teks bantuan pada
  `App.jsx`, `AskAIPanel.jsx`, `CodeAINavigator.jsx`, `AISettingsModal.jsx`,
  `DashboardManager.jsx`, `header.jsx`, `PerfSummary.jsx`,
  `PowerBITokenReport.jsx`, `embedPrefetch.js`, dan `ManageUsers.jsx`.
- Backend: instruksi sistem ke model, pesan balasan bot, footer laporan, dan
  pesan error yang sampai ke user, pada `aiController.js`, `aiContext.js`,
  `aiProvider.js`, `aiQuota.js`, `aiRouter.js`, `aiNavigator.js`,
  `aiSettings.js`, `aiCache.js`, `summaryFormatter.js`,
  `geminiSummary.service.js`, `daxAgent.service.js`, `whatsappQA.service.js`,
  dan `findingDistiller.js`.
- `README.md`.
- Komentar kode pada berkas yang sama. Nol risiko, dan komentar yang masih
  menyebut merek lama adalah jalan masuk paling umum bagi nama lama untuk
  merangkak kembali.
- Uji yang menegaskan teks lama: `backend/tests/summary-formatter.test.mjs` dan
  `backend/tests/user-role.test.mjs`.

## Penjagaan supaya nama lama tidak kembali

Proyek ini sudah punya pola ratchet di
`frontend/tests/text-constraints.test.mjs`: sebuah objek berisi jumlah
pelanggaran yang tersisa, yang angkanya hanya boleh turun. Uji gagal bila ada
pelanggaran baru, dan juga gagal bila angkanya lebih kecil daripada kenyataan,
sehingga daftar yang basi ikut ketahuan.

Rebrand ini menambah penghitung `codeAi: 0` ke ratchet tersebut, dan menambah
uji kembar `backend/tests/brand-constraints.test.mjs` yang memindai
`backend/src` dengan pola dan semantik yang sama. Sesudah rebrand keduanya nol.

Pemindaian bersifat case-insensitive dan mencakup teks JSX, bukan hanya string
literal. Ini penting: saat batasan emoji dan em dash ditetapkan dulu, perkiraan
dari grep atas string literal saja meleset jauh, karena sebagian besar
pelanggaran justru berada di teks JSX.

Pemindaian mengecualikan direktori yang memang tidak diganti namanya, yaitu
`docs/superpowers/`, dan tidak menyentuh nama berkas maupun env var.

## Perkenalan diri CIA

### Satu sumber teks

Modul baru `backend/src/services/ciaIdentity.js` berisi fungsi murni yang
mengembalikan teks identitas CIA. Murni artinya tanpa I/O, tanpa database, dan
tanpa panggilan model, sehingga bisa diuji tanpa WhatsApp dan tanpa kuota.

Teks itu memuat empat hal, dan urutannya disengaja:

1. Siapa dia: CIA (Cimory Intelligence Assistant), asisten analitik untuk CMD
   Plant Sentul.
2. Tugasnya: membaca angka yang sedang tampil di dashboard Power BI dan
   menjelaskannya, termasuk mengaitkan temuan antar dashboard.
3. Batasnya: dia hanya menjawab dari angka yang tersedia, tidak menebak angka
   yang tidak ada, dan tidak menggantikan keputusan orang.
4. Cara memakainya: tag CIA di grup lalu tanya seperti bicara biasa.

Bagian batas adalah bagian terpenting. Perkenalan yang hanya menyebut kemampuan
menumbuhkan harapan bahwa asisten ini tahu segalanya, dan harapan itu yang
membuat orang memercayai jawaban yang sebenarnya di luar jangkauan datanya.

Teks yang sama juga menjadi dasar bagian identitas pada instruksi sistem ke
model, supaya CIA tidak pernah menggambarkan dirinya berbeda dari
perkenalannya sendiri.

### Pintu pertama: saat bot dimasukkan ke grup

Langganan baru pada event Baileys `group-participants.update`. Saat ini hanya
`messages.upsert` yang dilanggani, jadi ini benar-benar langganan baru, bukan
penyesuaian yang sudah ada.

Perkenalan dikirim bila `action` bernilai `add` DAN peserta yang ditambahkan
adalah JID bot itu sendiri.

Penjaganya tabel baru `wa_group_intro` berisi JID grup sebagai kunci utama dan
waktu disapa, satu baris per grup, sekali selamanya. Migrasinya wajib aman
diulang, memakai `CREATE TABLE IF NOT EXISTS`. Penjaga ini wajib berada di
database, bukan di memori
proses: bot ini reconnect cukup sering karena kode 428 dan 440, dan penjaga di
memori akan hilang setiap kali proses hidup kembali sehingga perkenalan
terkirim berulang.

### Batas grup yang boleh disapa

Perkenalan hanya dikirim di grup yang terdaftar pada `WHATSAPP_GROUP_ID`. Bila
bot dimasukkan ke grup di luar daftar, dia diam dan kejadian itu dicatat ke log
server.

Alasannya konkret. Listener saat ini menjawab siapa pun yang menandai bot di
grup mana pun yang dia ikuti, dan whitelist akses per user belum dibangun.
Tanpa batas ini, siapa pun yang bisa menambahkan nomor CIA ke sebuah grup akan
langsung mendapat asisten yang memperkenalkan diri dan siap dipakai. Batas ini
menutup lubang tersebut sekarang, tanpa menunggu pekerjaan access control yang
ditunda.

### Pintu kedua: saat ditanya

Pertanyaan seperti "CIA itu apa", "kamu siapa", "bisa bantu apa aja", atau
"fungsinya apa" dijawab langsung dari kode, tanpa memanggil model sama sekali.
Nol kuota, nol latensi, dan jawabannya tidak mungkin dikarang.

Ini mengikuti pola yang sudah ada di `backend/src/services/aiLocalAnswer.js`,
yaitu menjawab secara lokal pertanyaan yang jawabannya sudah pasti.

Pencocokan pola dibangun dari deretan karakter yang eksplisit di dalam kode
sumber, bukan hasil tempel dari luar. Pola tanya di listener pernah rusak
diam-diam karena karakter escape berubah menjadi backspace saat berpindah lewat
heredoc, dan kerusakan seperti itu tidak terlihat saat kode dibaca.

Jalur ini diperiksa SEBELUM jalur yang memanggil model, karena pertanyaan
identitas tidak perlu data dashboard apa pun.

## Pengujian

- Uji murni untuk fungsi identitas: memastikan teksnya memuat keempat bagian,
  tanpa emoji, tanpa em dash, dan panjangnya wajar untuk satu pesan WhatsApp.
- Uji murni untuk pencocokan pola pertanyaan identitas: yang cocok dijawab
  lokal, dan yang bukan pertanyaan identitas tidak ikut tertangkap. Pertanyaan
  seperti "berapa losses hari ini" tidak boleh masuk jalur ini.
- Uji penjaga perkenalan: grup yang sudah disapa tidak disapa lagi, dan grup di
  luar `WHATSAPP_GROUP_ID` tidak pernah disapa.
- Ratchet frontend dan backend bernilai nol untuk `codeAi`.
- Seluruh suite backend dan frontend tetap lulus.

Catatan lingkungan yang berlaku untuk semua uji di repo ini: uji dijalankan
lewat `node tests/run-all.mjs` dari direktori `backend`, bukan berkas tunggal,
karena berkas tunggal menggantung. Uji memukul backend hidup di
`localhost:5050`, dan backend wajib direstart setiap kali kode servis atau
controller berubah. Endpoint `/api/perf` dibatasi 60 kiriman per 300 detik,
sehingga menjalankan suite berkali-kali dalam waktu berdekatan memunculkan
sekitar dua belas kegagalan berstatus 429 yang bukan regresi.

## Batasan global

- Backend JavaScript ESM murni, tanpa TypeScript, tanpa langkah build. Kontrak
  data lewat JSDoc.
- Tidak ada emoji dan tidak ada em dash di teks yang dibaca manusia.
- Bahasa komentar dan pesan: Indonesia.
- Tidak ada kredensial hardcoded. Semua secret lewat `backend/.env`.
- Tanpa dependensi baru.

## Risiko yang diketahui

Instruksi sistem ke model berubah dari "CODE AI Assistant" menjadi CIA. Ini
mengubah teks prompt, jadi jawaban model bisa sedikit berbeda bentuknya
walaupun isinya sama. Uji formatter yang menegaskan teks lama ikut disesuaikan.

Singkatan CIA punya asosiasi kuat di luar konteks Cimory. Nama ini adalah
keputusan pemilik proyek dan dicatat di sini supaya pilihannya eksplisit, bukan
kebetulan.

## Urutan pengerjaan

Pekerjaan ini dimulai SESUDAH tumpukan branch yang ada digabungkan ke `main`,
sesuai keputusan pemilik proyek. Rebrand menyentuh dua puluh satu berkas yang
sebagian juga disentuh branch yang belum digabung, dan mengerjakannya di atas
tumpukan yang belum ditinjau membuat setiap konflik nanti jauh lebih mahal.
