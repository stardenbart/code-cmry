# CODE AI: memori lintas dashboard, pengalihan terarah, dan bahasa yang lebih santai

Tanggal: 2026-08-06. Branch: `feat/daily-summary`.
Status: desain disetujui pemilik, siap masuk rencana implementasi.

## 1. Masalah yang diselesaikan

Riwayat chat CODE AI web terkunci per dashboard. `getHistory(userId, dashboardId)`
hanya mengambil enam putaran dari dashboard yang sedang dibuka, jadi analisa di
satu dashboard tidak pernah sampai ke dashboard berikutnya.

Akibatnya nyata untuk pekerjaan yang memang lintas domain. User melihat losses
naik di dashboard Losses, pindah ke Downtime untuk mencari sebabnya, dan harus
menceritakan ulang seluruh temuannya dari awal. CODE AI tidak tahu apa pun soal
percakapan sebelumnya, jadi tidak bisa mengorelasikan apa pun.

Tiga hal yang dikerjakan:

1. Memori temuan lintas dashboard, supaya analisa bisa dilanjutkan dan
   dikorelasikan.
2. Pengalihan terarah ke dashboard yang tepat ketika pertanyaan tidak bisa
   dijawab dari dashboard yang sedang dibuka.
3. Bahasa respons WhatsApp yang lebih santai, dan balasan yang lebih berguna
   ketika pertanyaan di luar data.

## 2. Keputusan yang sudah diambil pemilik

| Pertanyaan | Keputusan | Alasan yang menentukan |
|---|---|---|
| Apa yang dibawa antar dashboard | Ringkasan temuan, bukan riwayat mentah | Riwayat mentah dari enam dashboard sudah melewati batas 10KB, dan obrolan tak relevan ikut melebarkan analisa |
| Sampai kapan dibawa | Jendela 12 jam | Investigasi terjadi dalam satu shift, dan banyak dashboard refresh beberapa kali sehari sehingga temuan kemarin bisa merujuk angka yang sudah berubah |
| Kapan disaring | Saat user pindah dashboard | Satu panggilan per perpindahan, bukan per pertanyaan. Bertahan di satu dashboard berarti nol biaya tambahan |
| Milik siapa | Per user, tertutup | Akses dashboard diatur per user; temuan yang dibagi bisa membocorkan angka dari dashboard yang tidak boleh dibuka, dan kebocorannya berbentuk kalimat analisa sehingga tidak terlihat |
| Pengalihan dashboard | Arahkan, plus tawarkan menjawab langsung | User tetap tahu jawabannya dari mana, dan tiga panggilan agen DAX hanya terpakai bila diminta |

## 3. Yang sudah ada dan dipakai ulang

Bukan dibangun dari nol. Tiga bagian yang sudah terbukti jalan:

- **`aiNavigator.js`** sudah tahu katalog 44 dashboard beserta judul, departemen,
  deskripsi, PIC, dan **apakah user berhak membukanya**. Kontrol akses untuk
  pengalihan sudah tertangani di sini.
- **`daxAgent.service.js`** bisa memilih model, menyusun DAX, menjalankan, dan
  menganalisis. Dipakai saat user menerima tawaran dijawab langsung.
- **`ai_chat_logs`** sudah menyimpan pertanyaan, jawaban, dan `dashboard_id`.
  Penyaringan membaca dari sini, tidak perlu menyimpan ulang percakapan.

## 4. Model data

Satu tabel baru, `ai_finding`:

```
id              INT AUTO_INCREMENT
user_id         INT NOT NULL      pemilik, satu-satunya penyaring akses
dashboard_id    INT NOT NULL      sumber temuan
ringkasan       VARCHAR(400)      inti percakapan
angka_json      JSON              angka kunci beserta nama measure-nya
belum_terjawab  VARCHAR(300)      pertanyaan yang menggantung
turn_terakhir   INT               id ai_chat_logs terakhir yang tersaring
dibuat_pada     DATETIME
disegarkan_pada DATETIME ON UPDATE CURRENT_TIMESTAMP

UNIQUE KEY (user_id, dashboard_id)
```

`angka_json` adalah bagian yang membuat korelasinya bisa dipertanggungjawabkan.
Tanpa angka dan nama measure-nya tersimpan, ringkasan berupa prosa akan membuat
AI di dashboard berikutnya mengarang ulang angka dari ingatan. Dengan tersimpan,
dashboard berikutnya menyebut angka yang persis sama, dan ketidakcocokan
terlihat.

`turn_terakhir` mencegah penyaringan berulang atas percakapan yang sama:
penyaringan hanya memproses putaran yang lebih baru dari itu.

Kunci unik `(user_id, dashboard_id)` membuat satu temuan per dashboard yang
disegarkan, bukan menumpuk. Sepuluh kali bolak-balik ke dashboard yang sama
tidak boleh menghasilkan sepuluh catatan yang isinya mirip.

Temuan lama TIDAK dihapus. Jendela 12 jam menyaring saat membaca, bukan saat
menulis, sehingga riwayat temuan tetap bisa dilihat bila nanti dibutuhkan.

## 5. Daur hidup

```
user chat di dashboard Losses
       ↓
user membuka dashboard Downtime
       ↓
satu panggilan model menyaring chat Losses menjadi ai_finding
       ↓
chat di Downtime membawa temuan Losses sebagai konteks berlabel
```

Penyaringan dipicu oleh pembukaan dashboard lain, bukan oleh setiap pertanyaan.

### Apa yang memicunya, secara tepat

Frontend memanggil `POST /api/ai/finding/distill` ketika panel CODE AI dibuka
untuk sebuah dashboard. Backend memeriksa apakah user punya percakapan di
dashboard LAIN yang belum tersaring, lalu menyaringnya.

Dipilih endpoint terpisah, bukan disisipkan ke `POST /api/ai/ask`, karena dua
alasan:

- **Latensi disembunyikan.** Penyaringan berjalan saat panel dibuka, sebelum user
  selesai mengetik. Disisipkan ke `/ask`, pertanyaan pertama di setiap dashboard
  baru akan terasa lambat tanpa sebab yang terlihat.
- **Bisa dipanggil tanpa efek samping.** Endpoint yang idempoten dan aman
  dipanggil berkali-kali lebih mudah diuji daripada perilaku yang tersembunyi di
  dalam jalur menjawab.

Bila user tidak pernah membuka panel di dashboard baru, penyaringan tidak
terjadi, dan itu benar: tidak ada yang perlu dikorelasikan.

Endpoint yang ditambahkan:

| Endpoint | Klasifikasi | Guna |
|---|---|---|
| `POST /api/ai/finding/distill` | authenticated | menyaring percakapan dashboard lain yang belum tersaring |
| `GET /api/ai/finding` | authenticated | temuan aktif user dalam jendela 12 jam, dipakai UI menampilkan apa yang diingat |

Keduanya `authenticated`, bukan `selfOrAdmin`: identitas diambil dari token dan
TIDAK pernah dari parameter, jadi tidak ada id user yang bisa dipalsukan. Pola
yang sama sudah dipakai `POST /api/ai/ask`.

`GET /api/ai/finding` ada karena memori yang tidak terlihat tidak bisa dipercaya.
User harus bisa melihat apa yang diingat CODE AI tentang analisanya, dan
mengoreksinya bila salah.

### Penyaringan tidak boleh memblokir chat

Bila panggilan penyaring gagal, karena kuota atau apa pun, chat di dashboard baru
tetap berjalan tanpa memori. Memori adalah tambahan; menjawab pertanyaan adalah
tugas utamanya. Kegagalannya dicatat di log, tidak ditampilkan sebagai error ke
user, karena user tidak meminta penyaringan itu.

## 6. Bagaimana temuan masuk ke prompt

Blok terpisah dengan label tegas, BUKAN dicampur ke riwayat percakapan:

```
TEMUAN DARI DASHBOARD LAIN, bukan dari dashboard yang sedang dibuka:
- Losses Report (2 jam lalu): % Losses Packing 0,1%, Losses RM 24.677 IDR.
  Temuan: losses PM naik di CMD 2. Belum terjawab: penyebabnya.
```

Labelnya bukan hiasan. Tanpa pemisahan tegas, model akan menyebut angka Losses
seolah berasal dari dashboard yang sedang dibuka, dan pembacanya tidak punya cara
mengetahuinya.

Aturan yang ditambahkan ke instruksi: **setiap angka yang berasal dari dashboard
lain WAJIB disebut sumbernya.**

Batasnya empat dashboard terakhir dan total 1.200 karakter. Bila melebihi, yang
paling lama dibuang dan pemangkasannya DISEBUT di konteks, supaya model tidak
menganalisis data yang lebih sempit sambil menganggapnya lengkap.

## 7. Pengalihan dashboard

Dipicu ketika snapshot dashboard yang sedang dibuka tidak memuat jawabannya.

```
user tanya di dashboard Losses: "ini downtime-nya karena apa?"
       ↓
snapshot Losses tidak punya jawabannya
       ↓
navigator mencari dashboard yang punya DAN yang user berhak buka
       ↓
balasan menyebut dashboard, alasan, contoh pertanyaan, plus tawaran
```

Bentuk balasannya:

> Pertanyaan itu tidak ada di dashboard ini. Yang punya datanya Technical
> Downtime ORS. Di sana coba tanya: kenapa CMD 2 downtime-nya tinggi minggu ini?
> Mau saya jawab sekarang dari dashboard itu?

Dua penjagaan:

- **Dashboard yang tidak boleh dibuka user tidak disebut.** Menyebut nama
  dashboard beserta isinya sudah membocorkan informasi, jadi penyaringan hak
  akses navigator dipakai apa adanya.
- **Contoh pertanyaannya menyebut nama nyata**, bukan kategori umum. Dari
  perilaku sistem ini sendiri, pertanyaan umum ditolak sebagai ambigu sementara
  yang menyebut nama spesifik langsung terjawab. Saran yang tidak bisa dijawab
  membuat user menyimpulkan fiturnya tidak berguna.

Bila user menerima tawaran, `daxAgent.service.js` yang sudah ada menarik dan
menganalisis. Jawabannya wajib menyebut dashboard sumbernya.

## 8. Bahasa WhatsApp lebih santai

Yang diubah bukan sekadar pilihan kata, tapi pola kaku yang membuat pesannya
terbaca seperti surat dinas: "berdasarkan data yang tersedia", "adapun",
"sebagaimana tercatat", "dapat disimpulkan bahwa". Diganti dengan langsung ke
intinya.

Batasnya tetap: pembacanya manajemen di grup kerja, jadi santai tetapi bukan
slang. Larangan emoji dan tanda pisah panjang TETAP berlaku, dan penjaga uji
yang sudah ada tetap menegakkannya.

## 9. Balasan untuk pertanyaan di luar data

Balasan sekarang generik dan tidak menolong karena user tidak tahu harus
menyebut apa. Gantinya, menyebut kemampuan beserta contoh nyata:

```
Itu di luar data yang saya punya. Yang bisa saya jawab:
- Ringkasan operasional: tag saya dengan kata update atau rekap
- Downtime per mesin: misalnya Tetra Pak Line 3 atau Hassia S600 Line 2
- Angka per CMD: NC dan Deviasi CMD 1 sampai CMD 3
- Lembur per periode cut-off, sekarang periode Juli
```

Nama mesin diambil dari `daftarMesin()` yang sudah ada, dan periode lembur dari
`periodeLemburUntukTanggal()`, bukan ditulis tangan. Contoh yang ditulis tangan
akan basi begitu daftar mesin berubah, dan tidak ada yang tahu.

## 10. Penjagaan dan pengujian

Empat hal diuji, dan tiga di antaranya menjaga cacat yang sudah pernah terjadi
di proyek ini:

| Yang dijaga | Cacat yang pernah terjadi |
|---|---|
| Ringkasan tidak melewati batas karakter | Pemangkas yang menambah penanda setelah memotong sudah dua kali melewati batasnya sendiri: teks 311 dari 300, muatan 10.258 dari 10.240 |
| Jendela 12 jam dihitung di WIB | Kolom DATE dari mysql2 sudah dua kali menggeser tanggal sehari lewat toISOString |
| Temuan user lain tidak pernah terbawa | Kebocorannya berbentuk kalimat analisa, bukan tabel, jadi tidak akan terlihat saat ditinjau |
| Angka lintas dashboard selalu bersumber | Tanpa itu angka Losses terbaca sebagai angka Downtime |

Selain itu:

- Penyaringan yang gagal menghasilkan chat tanpa memori, bukan chat yang gagal.
- Navigator yang gagal menghasilkan jawaban tanpa saran pengalihan, bukan error.
- Uji TIDAK memanggil Gemini. Penyaring dan navigator diuji lewat fungsi murni
  penyusun prompt dan pembaca hasilnya, karena uji yang memanggil model bergantung
  pada kuota dan hasilnya berubah setiap kali dijalankan.

## 11. Yang sengaja tidak dikerjakan

- **Berbagi temuan antar user.** Ditolak karena penyaringan hak akses per
  kalimat analisa hampir tidak mungkin diandalkan. Struktur `user_id` sudah
  memungkinkan penambahan nanti tanpa migrasi besar.
- **Memori lintas hari.** Jendela 12 jam disengaja. Temuan yang lebih lama
  merujuk angka yang kemungkinan sudah berubah.
- **Penyaringan otomatis tanpa perpindahan dashboard.** Menyaring setiap
  pertanyaan menggandakan pemakaian kuota, dan agen DAX sudah memakai tiga
  panggilan per pertanyaan.
