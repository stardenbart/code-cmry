# Chat CIA Lintas Dashboard

Satu percakapan untuk bertanya ke beberapa dashboard Power BI sekaligus, tanpa
membuka dashboardnya satu per satu.

Alamatnya `/cia-chat`, sebuah halaman penuh. Pintu masuknya ikon di header,
hanya tampil bagi user yang aksesnya dibuka. Sebelumnya ini modal melayang;
sebagai halaman, percakapan panjang punya ruang, daftar riwayat muat di
sampingnya, dan alamatnya bisa dibuka langsung.

## Dua jalur penarikan data

Keduanya berujung ke endpoint yang sama, `POST /api/ai/unified/ask`. Yang
membedakan hanya ada tidaknya snapshot di badan permintaan.

**Manual.** User mencentang dashboard, browser menarik snapshotnya di latar,
lalu pertanyaan dikirim bersama snapshot itu. Jawabannya berdata.

**Otomatis.** User langsung bertanya tanpa mencentang apa pun. Server
mengklasifikasi pertanyaan terhadap katalog dashboard yang boleh dilihat user
itu, lalu menjawab dengan `saran_dashboard`: daftar dashboard yang relevan,
BUKAN angka. User mengklik salah satunya, snapshotnya ditarik, dan pertanyaan
tadi dikirim ulang otomatis.

Jalur otomatis SENGAJA tidak langsung menarik data begitu saran keluar.
Menebak dashboard yang salah lalu menjawab dengan angkanya adalah kegagalan
diam yang paling mahal di sistem ini: jawaban yang terdengar berdata padahal
sumbernya keliru. Konfirmasi satu klik jauh lebih murah daripada itu.

`saran_dashboard` dan `dashboards_used` dipisah di seluruh lapisan dengan
alasan yang sama. Yang pertama disarankan, yang kedua sumber angka.

## Alur data

```
Pertanyaan user
    |
    +-- tanpa snapshot --> [Server] classifyRelevantDashboards (katalog saja)
    |                          |
    |                      saran_dashboard --> user mengklik --> tarik snapshot
    |                                                                 |
    +-- dengan snapshot <-----------------------------------------------+
                 |
    [Browser] captureReportSnapshot per dashboard (SnapshotCapture, di luar layar)
                 |
    POST /api/ai/unified/ask { question, conversationId, snapshots }
                 |
    [Server] gabung konteks + riwayat utas + ingatan lintas percakapan
                 |
    panggil model sesuai tier
                 |
    simpan ke ai_unified_turns, pangkas kalau lewat atap penyimpanan
                 |
    { answer, dashboards_used, conversation_id, turn_id, tokens, tier }
```

Snapshot ditarik di BROWSER, bukan server. Server tidak pernah menyentuh
Power BI atas nama user.

## Ingatan

Tiga lapis, masing-masing beda perannya.

**Riwayat utas ini.** Enam turn TERAKHIR percakapan yang sedang dibuka,
dikirim sebagai giliran percakapan sungguhan lewat `history`. Bukan enam
pertama: pada percakapan panjang, konteks yang membeku di awal membuat
pertanyaan lanjutan dijawab seolah sepuluh turn terakhir tidak pernah terjadi.

**Ingatan lintas percakapan.** Lima percakapan LAIN milik user yang sama,
masing-masing hanya judul, pertanyaan terakhir, dan 300 karakter jawabannya.
Prinsipnya sama dengan `ai_finding`: yang dikirim topiknya, bukan seluruh
analisa. Model diberi tahu secara eksplisit bahwa angka di sana sudah lama dan
tidak boleh dipakai sebagai angka jawaban; kalau perlu angkanya, model harus
menyebut dashboard mana yang perlu dibuka lagi.

**Yang dibaca user.** Membuka percakapan lama memuat sampai 200 turn. Yang
dibatasi adalah muatan ke model, bukan yang terbaca di layar.

## Penyimpanan

Atapnya 5 GB per user, kira-kira 2,5 juta turn. Angka itu praktis tak
tersentuh, dan memang itu gunanya: batas yang menahan kasus liar, bukan yang
dipakai sehari-hari.

Pemakaian dihitung dari panjang kolom teksnya (`SUM(LENGTH(...))`), bukan
diperkirakan. Kalau lewat atap, percakapan TERTUA dibuang utuh, bukan per
turn: utas yang tinggal separuh terbaca sebagai jawaban yang hilang.
Pemangkasan dipanggil sesudah turn berjawaban penuh tersimpan.

## Endpoint

Semuanya di bawah `/api/ai`, dijaga `verifyJWT` lalu `requireCiaAccess`.

| Metode | Alamat | Guna |
| --- | --- | --- |
| POST | `/unified/ask` | Bertanya. Tanpa `snapshots`, jawabannya berupa saran dashboard. |
| POST | `/unified/suggest` | Dashboard mana yang relevan, tanpa menarik datanya. |
| GET | `/unified/conversations` | Daftar percakapan + pemakaian penyimpanan. |
| GET | `/unified/conversations/:id/turns` | Isi satu percakapan (sampai 200 turn). |
| DELETE | `/unified/conversations/:id` | Buang percakapan berikut seluruh turn-nya. |

`POST /unified/ask` mengembalikan:

```json
{
  "answer": "...",
  "dashboards_used": [
    { "id": 1, "title": "Produksi Harian", "reason": "data dari Produksi Harian", "confidence": 1 }
  ],
  "saran_dashboard": [],
  "conversation_id": 42,
  "turn_id": "42-3",
  "tokens": { "totalTokenCount": 3400 },
  "tier": "standar"
}
```

`GET /unified/conversations`:

```json
{
  "conversations": [
    { "id": 42, "judul": "Berapa OEE line 3?", "jumlah_turn": 6,
      "created_at": "...", "updated_at": "..." }
  ],
  "penyimpanan": { "terpakai": 18422, "batas": 5368709120 }
}
```

DELETE membuang PERCAKAPANNYA, bukan hanya mengosongkan turn-nya. Versi
sebelumnya menyisakan baris percakapan kosong di daftar riwayat, dan user
melihat utas yang tidak bisa dibuka isinya.

## Berkas

| Berkas | Perannya |
| --- | --- |
| `frontend/src/components/UnifiedChatPage.jsx` | Halaman: daftar riwayat, penyimpanan, hapus percakapan. |
| `frontend/src/components/UnifiedChatPanel.jsx` | Percakapannya sendiri, dua jalur penarikan data. |
| `frontend/src/components/ChatMessage.jsx` | Satu gelembung, termasuk saran yang bisa diklik. |
| `frontend/src/components/SnapshotCapture.jsx` | Memuat Power BI di luar layar untuk menarik snapshot. |
| `frontend/src/services/unifiedChatApi.js` | Klien, memakai instance axios bersama. |
| `backend/src/controllers/aiController.js` | `unifiedAsk`, `unifiedSuggest`. |
| `backend/src/services/unifiedConversationManager.js` | Seluruh sentuhan ke database. |
| `backend/migrations/add_unified_chat.sql` | Tabelnya. Aman diulang. |
| `backend/tests/unified-conversation.test.mjs` | Penjaga empat regresi di bawah. |

## Anggaran token per tier

- Cepat: 8.000 karakter (pertanyaan angka tunggal)
- Standar: 18.000 karakter (perbandingan)
- Mendalam: 40.000 karakter (akar masalah)

Dibagi rata antar dashboard yang ikut dibaca.

## Skema

**ai_unified_conversations**: `id`, `user_id` (FK users, ON DELETE CASCADE),
`judul` VARCHAR(200), `created_at`, `updated_at`, `metadata` JSON.

**ai_unified_turns**: `id`, `conversation_id` (FK, ON DELETE CASCADE),
`turn_number`, `question`, `dashboards_queried` JSON, `answer` LONGTEXT,
`tokens_used` JSON, `created_at`, UNIQUE(`conversation_id`, `turn_number`).

Migrasinya `.sql`, sama seperti tujuh belas migrasi lain di repo ini. Versi
pertama ditulis sebagai migrasi JavaScript padahal TIDAK ADA runner JavaScript
yang memanggilnya, jadi tabelnya tidak pernah dibuat dan setiap permintaan
chat mati di `createConversation`.

## Keamanan

- Percakapan terikat `user_id`; `getConversation` menuntut pemiliknya, jadi
  ID orang lain mengembalikan 404, bukan isinya.
- Katalog dashboard disaring server lewat `getCatalogForUser` sebelum
  klasifikasi, jadi saran tidak pernah menyebut dashboard yang tidak boleh
  dilihat user itu.
- Akses fitur dijaga `requireCiaAccess` di SERVER. Menyembunyikan ikon di
  header hanya kenyamanan; rute frontend bukan penjaga keamanan.
- Snapshot ditarik user, bukan server.
- Dibatasi laju per user.

## Jebakan yang sudah pernah menggigit

Empat-empatnya tidak terlihat sebagai kegagalan saat berjalan, dan itu sebabnya
`unified-conversation.test.mjs` ada.

1. **Migrasi tidak pernah jalan.** Ditulis `.js` di repo tanpa runner `.js`.
2. **`JSON.parse` atas kolom JSON.** mysql2 sudah mengembalikannya sebagai
   OBJEK; memanggil `JSON.parse` melempar
   `"[object Object]" is not valid JSON`. Tidak ada `JSON.parse` di
   `unifiedConversationManager.js`, dan tidak boleh ada.
3. **`getTurns` memberi yang pertama, bukan yang terakhir.**
4. **Penomoran turn dari `turns.length`.** Bertabrakan dengan UNIQUE KEY
   begitu satu turn terhapus. Sekarang dari `MAX(turn_number)`.

Satu lagi di sisi frontend: `unifiedChatApi.js` sempat memakai `fetch`
telanjang tanpa header Authorization, jadi setiap panggilan dijawab 401
sebelum menyentuh controller. Sekarang memakai instance axios bersama, yang
juga menangani penyegaran token.
