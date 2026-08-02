# Spec — Pengamanan Otorisasi API CODE

**Tanggal:** 2026-08-02
**Sub-proyek:** 1 dari 4 (keamanan → performa → UI/UX → efisiensi CODE AI)
**Status:** disetujui, siap masuk rencana implementasi

---

## 1. Masalah

26 endpoint di `backend/src/server.js` berjalan tanpa autentikasi maupun
otorisasi. Terverifikasi langsung, bukan dugaan:

```
GET /api/users      tanpa token → HTTP 200, 58 user terekspos
GET /api/dashboards tanpa token → HTTP 200, 31 KB
```

Field yang bocor: `id, nama, departemen, tipe_akses, nik, email, username,
approved`.

Dampak yang lebih berat dari kebocoran data:

| Endpoint | Dampak |
|---|---|
| `PUT /api/users/:id/password` | Ganti password akun mana pun tanpa tahu password lama → pengambilalihan akun |
| `POST /api/add-user` | Membuat akun `All Access` yang langsung `approved` |
| `POST /api/users/:userId/dashboard-access` | Memberi akses dashboard ke diri sendiri, memutus alur persetujuan |
| `PUT /api/approve-request/:id` | Menyetujui permintaan akses sendiri |
| `DELETE /api/delete-user/:id` | Menghapus user mana pun |
| `POST/PUT/DELETE /api/dashboards` | Mengubah atau menghapus dashboard |

Celah kedua yang terpisah: beberapa endpoint mengambil identitas dari **body**
(`user_id`) alih-alih dari token, sehingga user yang sah tetap bisa bertindak
atas nama orang lain meski nanti token sudah diwajibkan.

Pola pengamanan yang benar sudah ada di codebase — `routes/portalLinkRoutes.js`
memakai `requireAdmin`, dan seluruh `routes/aiRoutes.js` memakai `verifyJWT` —
hanya belum diterapkan ke `server.js`.

**Akar penyebab:** `server.js` menampung 26 handler inline sepanjang 760 baris.
Guard harus diingat satu per satu, dan yang harus diingat pasti terlupa.

## 2. Konteks & batasan

- **Paparan jaringan:** LAN/VPN kantor saja. HTTPS dan security header adalah
  keputusan infrastruktur, di luar cakupan spec ini.
- **24 user** berstatus `tipe_akses = 'All Access'`. Kolom itu mengatur akses
  *dashboard*, **bukan** hak admin — memakainya sebagai penanda admin akan
  memberi hak administratif ke 24 orang.
- `frontend/src/api/api.js` sudah melampirkan token ke **semua** request lewat
  interceptor Axios, sehingga menaikkan endpoint ke tingkat `authenticated`
  tidak memerlukan perubahan frontend.

## 3. Keputusan yang diambil

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Penanda admin | Kolom `users.role ENUM('admin','user')` | Satu sumber kebenaran; bisa menambah admin tanpa ubah kode; tahan terhadap penggantian username |
| Cara menegakkan | Default-deny + daftar-putih | Endpoint baru aman secara default; lupa = 401 yang berisik, bukan celah senyap |
| Ganti password sendiri | Wajib password lama | Melindungi dari sesi yang ditinggal terbuka pada komputer bersama |
| Struktur | Ekstraksi terbatas | Hanya kluster manajemen user yang dipindah; diff tetap bisa direview |

## 4. Rancangan

### 4.1 Tingkat akses

| Tingkat | Arti |
|---|---|
| `public` | Tanpa token |
| `authenticated` | Token valid, user mana pun |
| `selfOrAdmin` | `:userId` di URL harus sama dengan pemilik token, kecuali admin |
| `adminOnly` | `users.role = 'admin'` |

### 4.2 Klasifikasi endpoint

**public**
`POST /api/login`, `POST /api/register`, `GET /api/check-token`,
`GET /api/approve-via-email`, `GET /api/reject-via-email`,
`GET /api/approve-user-via-email`, `GET /api/reject-user-via-email`,
`GET /api/portal-links`, `GET /`

**authenticated**
`GET /api/dashboards`, `POST /api/request-access`, `POST /api/cancel-request`,
`POST /api/refresh-token`, `GET /api/powerbi/embed-config/:key`,
`GET /api/powerbi/embed-config-by-report/:reportId`,
`/api/ai/*` **kecuali** `PUT|DELETE /api/ai/universal-key` (lihat adminOnly)

**selfOrAdmin**
`PUT /api/users/:id/password`, `GET /api/dashboard-access-status/:userId`,
`GET /api/users/:userId/dashboard-access`,
`GET /api/access-requests-log/:userId`, `GET /api/access/:userId`,
`GET /api/notifications/count/:userId`,
`PUT /api/notifications/mark-read/:userId`

**adminOnly**
`GET /api/users`, `POST /api/add-user`, `PUT /api/update-user/:id`,
`DELETE /api/delete-user/:id`, `PUT /api/approve-user/:id`,
`PUT /api/decline-user/:id`, `GET /api/requests`,
`PUT /api/approve-request/:id`, `PUT /api/decline-request/:id`,
`POST /api/users/:userId/dashboard-access`,
`POST|PUT|DELETE /api/dashboards`, `POST|PUT|DELETE /api/portal-links`,
`PUT|DELETE /api/ai/universal-key`

### 4.3 Middleware

`backend/src/middleware/authorize.js` — modul baru:

- `defaultDeny(req, res, next)` — dipasang sebelum semua router. Melewatkan
  path non-`/api`, melewatkan daftar-putih dengan pencocokan **persis**
  (`"POST /api/login"`), selebihnya diteruskan ke `verifyJWT`.
- `requireAdmin(req, res, next)` — membaca `role` user dari database, bukan dari
  isi token, agar pencabutan hak admin langsung berlaku tanpa menunggu token
  kedaluwarsa.
- `requireSelfOrAdmin(paramName)` — membandingkan `Number(req.params[paramName])`
  dengan `Number(req.user.id)`; melewatkan bila admin. Perbandingan **wajib
  numerik**: `req.params` selalu string, sehingga `"9" === 9` bernilai salah dan
  akan menolak pemilik data yang sah.

`POST|PUT|DELETE /api/portal-links` sudah memiliki `requireAdmin` sendiri di
`routes/portalLinkRoutes.js`; guard itu diselaraskan agar memakai kolom `role`
alih-alih perbandingan username, bukan ditulis ulang.

`middleware/auth.js` mendapat helper `isAdmin(user)` yang menggantikan seluruh
perbandingan string `"digital.transformation"` yang tersebar.

### 4.4 Perubahan perilaku

1. **Ganti password** — `PUT /api/users/:id/password`
   - Bila `req.user.id === :id` → wajib `currentPassword`, diverifikasi dengan
     `bcrypt.compare`. Salah → `400`.
   - Bila admin mengubah milik orang lain → tanpa `currentPassword`.
   - Bukan keduanya → `403`.

2. **Identitas tidak lagi dari body** — `POST /api/request-access` dan
   `POST /api/cancel-request` mengambil `user_id` dari `req.user.id`; field
   `user_id` pada body diabaikan.

3. **Registrasi mandiri dipaksa `Department Access Only`** — `tipe_akses` dari
   payload registrasi diabaikan. Peningkatan hanya lewat admin.

4. **Rate-limit login** — memakai `services/rateLimiter.js` yang sudah ada:
   10 percobaan per 5 menit **per username**, bukan per IP. Di jaringan kantor
   banyak orang berbagi IP publik yang sama, sehingga pembatasan per IP akan
   mengunci satu kantor gara-gara satu orang salah ketik. Dimasukkan karena
   biayanya nyaris nol, bukan karena LAN dianggap berbahaya.

### 4.5 Migration

`backend/migrations/add_user_roles.sql`

```sql
-- guard information_schema, MySQL tidak mendukung ADD COLUMN IF NOT EXISTS
ALTER TABLE users ADD COLUMN role ENUM('admin','user') NOT NULL DEFAULT 'user';
UPDATE users SET role = 'admin' WHERE username = 'digital.transformation';
```

Hanya `digital.transformation` yang di-seed. Akun `superuser` yang ada di
database **tidak** otomatis dijadikan admin — itu keputusan pemilik sistem.

### 4.6 Frontend

- `ChangePasswordModal.jsx` — tambah field "Password saat ini".
- `header.jsx`, `NotificationPage.jsx`, `App.jsx`, `AISettingsModal.jsx` —
  pengecekan admin memakai `user.role === "admin"` dari objek user hasil login,
  menggantikan perbandingan nama/username.
- `POST /api/login` mengembalikan `role` di objek user.

## 5. Pengujian

### 5.1 Uji per-endpoint

Untuk setiap endpoint sesuai klasifikasinya:

| Skenario | Harapan |
|---|---|
| Tanpa token ke endpoint non-public | `401` |
| Token user biasa ke `adminOnly` | `403` |
| User A mengakses `:userId` milik user B | `403` |
| Admin ke seluruh endpoint | `200` |
| Endpoint `public` tanpa token | tetap `200` |

### 5.2 Uji inventaris route

Menelusuri stack router Express, memastikan setiap route `/api/*` yang
terdaftar ada di peta klasifikasi. Route baru yang belum diklasifikasi
**menggagalkan test**.

Ini yang mencegah kambuh: default-deny menjamin *authentication*, uji inventaris
memaksa *authorization* ikut dipikirkan setiap ada endpoint baru.

### 5.3 Uji regresi alur

Login → lihat dashboard → request akses → admin menyetujui → user melihat
dashboard. Harus tetap berjalan utuh setelah pengerasan.

## 6. Di luar cakupan

- HTTPS, HSTS, security header — ranah infrastruktur.
- Ekstraksi seluruh router dari `server.js` — hanya kluster manajemen user yang
  dipindah; sisanya menunggu sub-proyek tersendiri.
- Audit log tindakan admin — berguna, tapi bukan penambal celah; diusulkan
  terpisah.
- Rotasi `JWT_SECRET` — perlu diputuskan pemilik sistem karena akan memutus
  seluruh sesi aktif, dan `secretBox.js` menurunkan kunci enkripsi dari nilai
  itu (mengubahnya membuat kunci Gemini tersimpan tidak bisa didekripsi).

## 7. Risiko

| Risiko | Mitigasi |
|---|---|
| Salah daftar-putih mengunci halaman login | Pencocokan persis + uji endpoint `public` tanpa token |
| Frontend memanggil endpoint admin dari layar non-admin | Uji regresi alur; interceptor sudah melampirkan token |
| `superuser` kehilangan kemampuan yang selama ini dipakai | Ditandai eksplisit ke pemilik sistem sebelum rilis |
| Migration dijalankan dua kali | Guard `information_schema`, sama seperti migration sebelumnya |
