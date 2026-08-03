# CODE UI/UX Design

**Tanggal:** 2026-08-03
**Status:** Disetujui
**Cakupan:** Kualitas interaksi: umpan balik, status kosong dan memuat, badge notifikasi, dan penghapusan framer-motion

---

## Batasan yang mengikat seluruh pekerjaan ini

Ditetapkan pemilik sistem. Tidak boleh dilanggar tanpa persetujuan baru.

1. **Palet warna dan logo tetap.** `cimoryBlue`, `cimoryRed`, logo Cimory. Tidak ada palet baru.
2. **Tata letak dan posisi tetap.** Sidebar kiri, header atas, kartu dashboard bertumpuk vertikal, tombol CODE AI di pojok kanan bawah. Orang sudah hafal letaknya.
3. **Jumlah klik tidak bertambah.** Alur request access, approve user, buka fullscreen, dan export tetap sama panjangnya. Boleh lebih jelas, tidak boleh lebih panjang.
4. **Tidak ada emoji sebagai ikon.** Proyek sudah memakai `lucide-react`; setiap kebutuhan punya ikon sungguhan. Emoji dirender berbeda antar sistem operasi dan font, sehingga tampil tidak konsisten dan terkesan belum selesai di samping merek Cimory.
5. **Tidak ada em dash di teks yang dibaca user.** Ganti dengan koma, titik dua, atau kalimat terpisah. Untuk nilai yang tidak ada, tulis teks biasa ("Belum ada", "Tidak diatur") atau tanda hubung, bukan em dash.

Batasan 4 dan 5 berlaku untuk teks antarmuka. Pesan `console.*` yang sudah memuat emoji dibiarkan: itu untuk pengembang, dan mengubahnya hanya menghasilkan riak tanpa manfaat. Kode baru tetap mengikuti batasan ini.

## Kondisi sekarang

Diukur pada 2026-08-03:

| Temuan | Jumlah |
|---|---|
| `alert()` bawaan browser | 27 |
| `window.confirm()` bawaan browser | 6 |
| Komponen toast | tidak ada |
| Badge jumlah notifikasi di sidebar | tidak ada, padahal endpoint-nya sudah tersedia |
| `framer-motion` | 114,5 KB, dipakai di 2 berkas |

Pelanggaran batasan 4 dan 5 yang sudah ada di antarmuka:

| Lokasi | Masalah |
|---|---|
| `DashboardManager.jsx:315` | `"✅"` sebagai ikon status tabel, dan em dash sebagai penanda kosong |
| `PerfSummary.jsx:4` | em dash sebagai penanda angka tidak tersedia |
| `DashboardManager.jsx:70` | "Kosong — Export Mode & CODE AI tidak aktif untuk dashboard ini." |
| `DashboardManager.jsx:71` | "Report GUID valid — Export Mode & CODE AI aktif." |
| `AISettingsModal.jsx:140` | "Kamu memakai kunci universal — kuotanya dibagi dengan semua user." |
| `AISettingsModal.jsx:151` | " — kosongkan bila tidak diubah" |
| `ManageUsers.jsx:56` | `alert("❌ Error removing user")` |

Enam pelanggaran em dash, lima di dalam string literal dan satu sebagai teks JSX
(`DashboardManager.jsx:315`). Yang terakhir itu tidak tertangkap pencarian string,
jadi uji penjaga di bagian akhir harus memeriksa teks JSX juga, bukan hanya
string.

Em dash pada tabel di atas adalah kutipan dari string yang bermasalah itu
sendiri, ditulis apa adanya supaya bisa dicari dan dicocokkan. Mengutip
pelanggaran bukan berarti melakukannya.

## Bukan bagian dari cakupan ini

- Menerjemahkan seluruh antarmuka ke satu bahasa. Teks yang memang ditulis ulang dalam pekerjaan ini dirapikan; sisanya keputusan pemilik sistem.
- Perubahan palet, tata letak, atau alur.
- Efisiensi CODE AI (workstream terpisah).
- Em dash di dalam komentar kode yang sudah ada.

---

## Bagian 1: Umpan balik yang tidak memblokir

### Mengapa dibuat sendiri

Tidak memakai library toast. Bundle baru saja diturunkan dari 816 KB ke 242 KB untuk halaman login, dan menambah dependensi demi komponen sesederhana ini adalah langkah mundur. Buatan sendiri juga memakai warna Cimory langsung, tanpa menimpa gaya bawaan library.

### Antarmuka

`frontend/src/components/ToastProvider.jsx`

```js
export function ToastProvider({ children })   // dipasang sekali di akar
export function useToast()                     // -> { success, error, warning, info }
```

Setiap fungsi menerima `(pesan: string, opsi?: { durasiMs?: number })`.

`frontend/src/components/ConfirmProvider.jsx`

```js
export function ConfirmProvider({ children })
export function useConfirm()  // -> (opsi) => Promise<boolean>
```

`opsi` berbentuk `{ judul, pesan, labelKonfirmasi, destruktif }`. Mengembalikan promise agar pemanggil tetap sesederhana bentuk aslinya:

```js
if (!(await confirm({ judul: "Hapus dashboard", pesan: `"${d.title}" akan dihapus permanen.`, destruktif: true }))) return;
```

### Perilaku

- Toast muncul di kanan atas, di bawah header, dan **tidak memblokir halaman**. Itu perbedaan utamanya dari `alert()`.
- Hilang sendiri setelah 4 detik; toast `error` bertahan 7 detik karena isinya perlu dibaca. Keduanya bisa ditutup manual.
- Bisa menumpuk, maksimal 4 terlihat sekaligus. Yang lebih tua digeser keluar agar layar tidak tertutup.
- `aria-live="polite"` untuk sukses dan info, `aria-live="assertive"` untuk error, sehingga pembaca layar ikut mengumumkannya.
- Modal konfirmasi memerangkap fokus, ditutup dengan `Esc`, dan tombol destruktifnya `cimoryRed`. Tombol aman yang mendapat fokus awal, bukan tombol hapusnya.
- Modal menyebut **objek yang akan dihapus**, bukan "Delete this dashboard?". Orang harus tahu apa yang sedang ia hapus.

### Penggantian

27 `alert()` menjadi toast dengan varian sesuai maksudnya: gagal menjadi `error`, validasi menjadi `warning`, berhasil menjadi `success`. 6 `window.confirm()` menjadi `useConfirm()`.

Teks yang ditulis ulang mengikuti batasan 4 dan 5.

---

## Bagian 2: Halaman Notifications

- **Status kosong yang jujur**, bukan tabel kosong: "Belum ada permintaan akses" beserta satu baris penjelasan kapan isinya muncul.
- **Skeleton saat memuat**, bukan layar kosong lalu isi yang melompat masuk.
- **Pemisahan jelas** antara permintaan akun baru dan permintaan akses dashboard. Sekarang keduanya bercampur dalam satu daftar.
- **Tombol approve dan decline mendapat status memproses** dan dinonaktifkan selama permintaan berjalan. Tanpa itu, satu klik ganda mengirim dua keputusan.
- Setelah keputusan diambil, baris yang bersangkutan hilang dan sebuah toast menyebut nama orangnya.

---

## Bagian 3: Sidebar

- **Badge jumlah** di tombol Notifications, memakai `GET /api/notifications/count/:userId` yang sudah ada tapi belum dipakai di sidebar. Angka di atas 9 ditulis "9+" agar lebarnya tidak melompat.
- Badge memakai `cimoryRed` dengan teks putih, dan punya `aria-label` yang menyebut jumlahnya dalam kata.
- **`Esc` menutup sidebar** di tampilan mobile. Sekarang hanya bisa lewat tombol X.
- **Fokus keyboard terlihat** pada setiap tombol departemen, dan akordeon memakai `aria-expanded` supaya pembaca layar tahu keadaannya.
- Saat sidebar mobile terbuka, fokus berpindah ke dalamnya dan kembali ke tombol pemicu saat ditutup.

---

## Bagian 4: framer-motion dihapus

| Sekarang | Menjadi |
|---|---|
| `whileHover={{ scale: 1.02 }}` | `hover:scale-[1.02]` |
| `whileTap={{ scale: 0.98 }}` | `active:scale-[0.98]` |
| `AnimatePresence` + `height: 0 → auto` | `grid-template-rows: 0fr → 1fr` |
| `motion.div` fade overlay | `transition-opacity` |

Akordeon adalah satu-satunya bagian yang tidak sepele: CSS tidak bisa mentransisikan `height` ke `auto`. Trik `grid-template-rows` dari `0fr` ke `1fr` menyelesaikannya tanpa mengukur tinggi lewat JavaScript, dan didukung semua browser yang dipakai di kantor.

`framer-motion` dihapus dari `package.json` setelah pemakaian terakhirnya hilang. Verifikasinya bukan "sudah dihapus" melainkan `grep` yang tidak menemukan sisa impor, dan chunk `proxy-*.js` 114,5 KB yang tidak lagi terbentuk.

---

## Bagaimana kita tahu ini berhasil

| Ukuran | Sebelum | Target |
|---|---|---|
| `alert()` dan `window.confirm()` di `src/` | 33 | 0 |
| `framer-motion` di `package.json` | ada | tidak ada |
| Chunk framer-motion | 114,5 KB | tidak terbentuk |
| JS untuk halaman login | 242,8 KB | turun, dicatat apa adanya |
| Emoji sebagai ikon di antarmuka | 2 | 0 |
| Em dash di teks antarmuka | 6 | 0 |
| Uji frontend | 18 lulus | tetap lulus, plus uji batasan teks |
| Uji backend | 136 lulus | tetap lulus |

### Uji yang menjaga batasan

Sebuah uji memeriksa `src/` dan gagal bila menemukan emoji atau em dash di dalam string literal, atau pemanggilan `alert(`/`window.confirm(`. Tanpa itu, batasan ini bertahan hanya selama orang mengingatnya. Pengecualian yang sah didaftarkan secara eksplisit di dalam uji, bukan dengan melemahkan polanya.

## Risiko

**Toast terlewat karena tidak memblokir.** `alert()` memaksa dibaca; toast bisa terlewat. Karena itu toast `error` bertahan lebih lama, dan kesalahan validasi formulir tetap ditampilkan menempel pada field-nya, bukan hanya sebagai toast.

**Akordeon `grid-template-rows` berbeda perilaku.** Perlu pemeriksaan mata di sidebar mobile dan desktop setelah penggantian, bukan hanya "build lolos".

**Penghapusan framer-motion menyentuh LandingPage.** Berkas itu memakai 11 animasi termasuk carousel. Bila ada satu yang tidak punya padanan CSS yang layak, animasi itu disederhanakan dan dicatat, bukan dipaksakan dengan JavaScript baru.
