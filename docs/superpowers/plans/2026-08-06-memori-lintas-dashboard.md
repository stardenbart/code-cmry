# Memori Lintas Dashboard CODE AI: Rencana Implementasi

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development (disarankan) atau superpowers:executing-plans untuk mengerjakan rencana ini tugas per tugas. Langkahnya memakai checkbox (`- [ ]`) untuk penanda.

**Goal:** CODE AI web mengingat temuan dari dashboard yang sudah dianalisis user, mengorelasikannya di dashboard berikutnya, dan mengarahkan user ke dashboard yang tepat ketika pertanyaannya di luar dashboard yang sedang dibuka.

**Architecture:** Satu tabel `ai_finding` menyimpan ringkasan temuan per (user, dashboard). Penyaringan dipicu endpoint terpisah saat panel CODE AI dibuka, sehingga latensinya tidak terasa di jalur menjawab. Temuan disuntikkan ke prompt sebagai blok berlabel tegas, bukan dicampur riwayat. Pengalihan dashboard memakai ulang `getCatalogForUser()` yang sudah menyaring hak akses.

**Tech Stack:** Node.js ESM + JSDoc (BUKAN TypeScript), Express 4, MySQL lewat mysql2, Gemini lewat `config/gemini.js`, React 18 di frontend.

## Global Constraints

- **Tidak ada TypeScript.** Backend JavaScript ESM murni tanpa langkah build. Kontrak data lewat JSDoc typedef plus validasi runtime.
- **Tidak ada emoji sebagai ikon, tidak ada tanda pisah panjang** di teks yang dibaca user. Penjaga `frontend/tests/text-constraints.test.mjs` menegakkannya dengan batas nol.
- **Setiap route baru WAJIB masuk `backend/src/routeInventory.js`.** Uji `authz-inventory.test.mjs` gagal bila ada route tanpa klasifikasi.
- **Uji TIDAK memanggil Gemini.** Penyaring dan navigator diuji lewat fungsi murni penyusun prompt dan pembaca hasil. Uji yang memanggil model bergantung kuota dan hasilnya berubah setiap dijalankan.
- **Migrasi aman diulang.** `CREATE TABLE IF NOT EXISTS` untuk tabel; penambahan kolom dijaga `information_schema` karena `ADD COLUMN IF NOT EXISTS` adalah sintaks MariaDB dan gagal diam-diam di MySQL.
- **Kolom DATE dan DATETIME dari mysql2 JANGAN dibaca dengan `toISOString()`.** Driver membangunnya di tengah malam waktu lokal, dan di server WIB itu menggeser tanggal mundur sehari. Pakai `DATE_FORMAT` di SQL atau komponen lokal.
- **Jalankan uji lewat `node tests/run-all.mjs`**, bukan berkas tunggal: berkas tunggal menggantung karena connection pool menahan event loop. Server uji jangan di **port 5060**, karena port itu diblokir spesifikasi fetch (port SIP) sehingga semua uji gagal dengan "bad port".
- Bahasa komentar dan pesan: Indonesia, mengikuti berkas sekitarnya.

---

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `backend/migrations/add_ai_finding.sql` | tabel `ai_finding` |
| `backend/src/models/findingModel.js` | akses data temuan: upsert, baca jendela, hapus |
| `backend/src/services/findingDistiller.js` | penyusun prompt penyaring dan pembaca hasilnya, fungsi murni |
| `backend/src/services/findingContext.js` | menyusun blok TEMUAN DARI DASHBOARD LAIN untuk prompt |
| `backend/src/services/dashboardRedirect.js` | memilih dashboard pengalihan dari katalog ber-hak-akses |
| `backend/src/controllers/aiController.js` | dua handler baru, plus penyuntikan temuan di `ask` |
| `backend/src/routes/aiRoutes.js` | dua route baru |
| `backend/src/routeInventory.js` | klasifikasi dua route baru |
| `backend/src/services/whatsappListener.service.js` | balasan di luar konteks memakai contoh nyata |
| `backend/src/services/whatsappQA.service.js` | instruksi bahasa lebih santai |
| `backend/src/services/daxAgent.service.js` | instruksi bahasa lebih santai |
| `frontend/src/components/AskAIPanel.jsx` | memanggil distill saat panel dibuka, menampilkan yang diingat |

Model data dipisah dari layanan karena `findingModel.js` hanya bicara SQL sementara `findingDistiller.js` hanya bicara prompt. Keduanya bisa diuji sendiri tanpa menyentuh yang lain.

---

### Task 1: Tabel dan model data temuan

**Files:**
- Create: `backend/migrations/add_ai_finding.sql`
- Create: `backend/src/models/findingModel.js`
- Test: `backend/tests/ai-finding-model.test.mjs`

**Interfaces:**
- Consumes: `backend/src/config/db.js` default export (pool callback, dibungkus `db.promise()`)
- Produces:
  - `simpanTemuan({ userId, dashboardId, ringkasan, angka, belumTerjawab, turnTerakhir }) => Promise<{disimpan: boolean}>`
  - `temuanAktif(userId, { jamKebelakang = 12, maksDashboard = 4 }) => Promise<Array<{dashboardId, dashboardTitle, ringkasan, angka, belumTerjawab, umurJam}>>`
  - `turnTerakhirTersaring(userId, dashboardId) => Promise<number>`
  - `hapusTemuan(userId, dashboardId) => Promise<number>`

- [ ] **Step 1: Tulis migrasinya**

Buat `backend/migrations/add_ai_finding.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: tabel ai_finding, memori temuan lintas dashboard.
-- Aman diulang.
--
-- Riwayat chat CODE AI terkunci per dashboard, jadi analisa di satu dashboard
-- tidak pernah sampai ke dashboard berikutnya. Tabel ini menyimpan RINGKASAN
-- temuan, bukan riwayat mentah: riwayat mentah dari enam dashboard sudah
-- melewati batas muatan 10KB dan obrolan tak relevan ikut melebarkan analisa.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_finding (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT          NOT NULL,
  dashboard_id    INT          NOT NULL,
  ringkasan       VARCHAR(400) NOT NULL,

  -- Angka kunci beserta NAMA MEASURE-nya. Inilah yang membuat korelasinya bisa
  -- dipertanggungjawabkan: tanpa angka tersimpan, AI di dashboard berikutnya
  -- mengarang ulang angka dari ingatan. Dengan tersimpan, dashboard berikutnya
  -- menyebut angka yang persis sama dan ketidakcocokan terlihat.
  angka_json      JSON         NULL,

  belum_terjawab  VARCHAR(300) NULL,

  -- id ai_chat_logs terakhir yang sudah tersaring. Mencegah penyaringan berulang
  -- atas percakapan yang sama.
  turn_terakhir   INT          NOT NULL DEFAULT 0,

  dibuat_pada     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disegarkan_pada DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,

  -- Satu temuan per dashboard yang DISEGARKAN, bukan menumpuk. Sepuluh kali
  -- bolak-balik ke dashboard yang sama tidak boleh menghasilkan sepuluh catatan
  -- yang isinya mirip.
  UNIQUE KEY uq_finding (user_id, dashboard_id),
  KEY idx_finding_segar (user_id, disegarkan_pada),

  CONSTRAINT fk_finding_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Jalankan migrasinya dua kali**

```bash
cd backend
cat > run-mig.cjs <<'EOF'
require("dotenv").config();
const fs = require("fs");
const mysql = require("mysql2/promise");
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, port: process.env.DB_PORT || 3306, multipleStatements: true,
  });
  const sql = fs.readFileSync("migrations/add_ai_finding.sql", "utf8");
  await c.query(sql);
  await c.query(sql);
  const [r] = await c.query("SELECT COUNT(*) n FROM ai_finding");
  console.log("ai_finding ada,", r[0].n, "baris, aman diulang");
  await c.end();
})().catch((e) => { console.error("GAGAL:", e.message); process.exit(1); });
EOF
node run-mig.cjs; rm -f run-mig.cjs
```

Expected: `ai_finding ada, 0 baris, aman diulang`

- [ ] **Step 3: Tulis uji yang gagal**

Buat `backend/tests/ai-finding-model.test.mjs`:

```javascript
import { ok, section } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  simpanTemuan, temuanAktif, turnTerakhirTersaring, hapusTemuan,
} from "../src/models/findingModel.js";

const sql = db.promise();

// User nyata dari database: user_id punya foreign key ke users(id), jadi id
// hantu akan gagal dengan ER_NO_REFERENCED_ROW_2.
const [[u]] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const [[u2]] = await sql.query("SELECT id FROM users ORDER BY id DESC LIMIT 1");
const USER = u.id;
const USER_LAIN = u2.id;
const DASH_A = 44;
const DASH_B = 45;

await sql.query("DELETE FROM ai_finding WHERE user_id IN (?, ?)", [USER, USER_LAIN]);

section("Temuan disimpan dan dibaca kembali");

const s1 = await simpanTemuan({
  userId: USER, dashboardId: DASH_A,
  ringkasan: "Losses PM naik di CMD 2",
  angka: [{ measure: "% Losses Packing", nilai: 0.001 }],
  belumTerjawab: "penyebab kenaikannya",
  turnTerakhir: 10,
});
ok("tersimpan", s1.disimpan === true, JSON.stringify(s1));

const aktif = await temuanAktif(USER);
ok("satu temuan terbaca", aktif.length === 1, `dapat ${aktif.length}`);
ok("ringkasan utuh", aktif[0].ringkasan === "Losses PM naik di CMD 2", aktif[0].ringkasan);
ok("angka terbaca sebagai array", Array.isArray(aktif[0].angka), typeof aktif[0].angka);
ok("nama measure ikut", aktif[0].angka[0].measure === "% Losses Packing");
ok("umur dalam jam ikut", typeof aktif[0].umurJam === "number", typeof aktif[0].umurJam);

section("Menyimpan ulang menyegarkan, tidak menumpuk");

await simpanTemuan({
  userId: USER, dashboardId: DASH_A,
  ringkasan: "Losses PM naik di CMD 2 dan CMD 3",
  angka: [], belumTerjawab: null, turnTerakhir: 12,
});
const aktif2 = await temuanAktif(USER);
ok("tetap satu baris", aktif2.length === 1, `dapat ${aktif2.length}`);
ok("ringkasan tersegarkan", /CMD 3/.test(aktif2[0].ringkasan), aktif2[0].ringkasan);
ok("turn terakhir tersegarkan", (await turnTerakhirTersaring(USER, DASH_A)) === 12);

section("Temuan user lain TIDAK pernah terbawa");

// Kebocorannya berbentuk kalimat analisa, bukan tabel, jadi tidak akan terlihat
// saat ditinjau manusia. Karena itu diuji eksplisit.
await simpanTemuan({
  userId: USER_LAIN, dashboardId: DASH_B,
  ringkasan: "RAHASIA user lain", angka: [], belumTerjawab: null, turnTerakhir: 1,
});
const punyaUser = await temuanAktif(USER);
ok("temuan user lain tidak muncul",
  !punyaUser.some((t) => /RAHASIA/.test(t.ringkasan)),
  JSON.stringify(punyaUser.map((t) => t.ringkasan)));

section("Jendela 12 jam menyaring saat MEMBACA, bukan menghapus");

await sql.query(
  "UPDATE ai_finding SET disegarkan_pada = DATE_SUB(NOW(), INTERVAL 13 HOUR) WHERE user_id = ? AND dashboard_id = ?",
  [USER, DASH_A]
);
ok("temuan tua tidak dibawa", (await temuanAktif(USER)).length === 0);

const [[masih]] = await sql.query(
  "SELECT COUNT(*) n FROM ai_finding WHERE user_id = ? AND dashboard_id = ?", [USER, DASH_A]
);
// Barisnya TETAP ada: jendela menyaring saat membaca supaya riwayat temuan
// masih bisa dilihat bila nanti dibutuhkan.
ok("barisnya tidak dihapus", Number(masih.n) === 1, `sisa ${masih.n}`);
ok("jendela bisa dilebarkan", (await temuanAktif(USER, { jamKebelakang: 24 })).length === 1);

section("Batas jumlah dashboard dihormati");

for (let i = 0; i < 6; i += 1) {
  await simpanTemuan({
    userId: USER, dashboardId: 100 + i,
    ringkasan: `temuan ${i}`, angka: [], belumTerjawab: null, turnTerakhir: i,
  });
}
ok("maksimum 4 dashboard", (await temuanAktif(USER)).length === 4,
  `dapat ${(await temuanAktif(USER)).length}`);

section("Data uji dibersihkan");

const dihapus = await hapusTemuan(USER, DASH_A);
ok("hapus mengembalikan jumlah baris", dihapus >= 0, String(dihapus));
await sql.query("DELETE FROM ai_finding WHERE user_id IN (?, ?)", [USER, USER_LAIN]);
const [[sisa]] = await sql.query(
  "SELECT COUNT(*) n FROM ai_finding WHERE user_id IN (?, ?)", [USER, USER_LAIN]
);
ok("tidak ada sisa", Number(sisa.n) === 0, `sisa ${sisa.n}`);
```

- [ ] **Step 4: Jalankan uji, pastikan GAGAL**

```bash
cd backend && node tests/run-all.mjs 2>&1 | grep -E "ai-finding-model|FAIL" | head -5
```

Expected: `FAIL ai-finding-model.test.mjs melempar sebelum selesai: Cannot find module ... findingModel.js`

- [ ] **Step 5: Tulis modelnya**

Buat `backend/src/models/findingModel.js`:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// Akses data temuan lintas dashboard.
//
// Hanya bicara SQL. Penyusunan prompt ada di findingDistiller.js dan
// findingContext.js, supaya masing-masing bisa diuji tanpa menyentuh yang lain.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";

const sql = db.promise();

/** Jendela bawaan. Bisa diubah lewat env bila kebiasaan kerja berbeda. */
export const JAM_JENDELA = Number(process.env.AI_FINDING_WINDOW_HOURS) || 12;
export const MAKS_DASHBOARD = Number(process.env.AI_FINDING_MAX_DASHBOARDS) || 4;
export const RINGKASAN_MAKS = 400;
export const BELUM_TERJAWAB_MAKS = 300;

/**
 * mysql2 mengembalikan kolom JSON sebagai objek terparse pada versi tertentu dan
 * string pada versi lain. Menganggapnya selalu objek gagal di lingkungan yang
 * berbeda dari mesin pengembang.
 */
function bacaJson(nilai) {
  if (nilai === null || nilai === undefined) return [];
  if (typeof nilai === "object") return nilai;
  try {
    return JSON.parse(nilai);
  } catch {
    return [];
  }
}

/**
 * Menyimpan atau menyegarkan temuan satu dashboard.
 *
 * Teks dipangkas di sini, bukan dibiarkan MySQL memotongnya. MySQL di mode
 * non-strict memotong diam-diam, dan ringkasan yang terpotong di tengah kalimat
 * akan terbaca sebagai temuan yang memang berakhir di situ.
 */
export async function simpanTemuan({
  userId, dashboardId, ringkasan, angka, belumTerjawab, turnTerakhir,
}) {
  const r = String(ringkasan || "").slice(0, RINGKASAN_MAKS);
  if (!r.trim()) return { disimpan: false };

  await sql.query(
    `INSERT INTO ai_finding
       (user_id, dashboard_id, ringkasan, angka_json, belum_terjawab, turn_terakhir)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)
     ON DUPLICATE KEY UPDATE
       ringkasan = VALUES(ringkasan),
       angka_json = VALUES(angka_json),
       belum_terjawab = VALUES(belum_terjawab),
       turn_terakhir = VALUES(turn_terakhir)`,
    [
      Number(userId), Number(dashboardId), r,
      JSON.stringify(Array.isArray(angka) ? angka : []),
      belumTerjawab ? String(belumTerjawab).slice(0, BELUM_TERJAWAB_MAKS) : null,
      Number(turnTerakhir) || 0,
    ]
  );
  return { disimpan: true };
}

/**
 * Temuan yang masih dalam jendela, terbaru lebih dulu.
 *
 * Umur dihitung di SQL lewat TIMESTAMPDIFF, bukan di JavaScript dari kolom
 * DATETIME. Kolom DATETIME yang dibaca driver lalu dibandingkan dengan waktu
 * proses sudah dua kali menggeser hasil sehari di proyek ini.
 */
export async function temuanAktif(
  userId,
  { jamKebelakang = JAM_JENDELA, maksDashboard = MAKS_DASHBOARD } = {}
) {
  const [rows] = await sql.query(
    `SELECT f.dashboard_id, f.ringkasan, f.angka_json, f.belum_terjawab,
            TIMESTAMPDIFF(MINUTE, f.disegarkan_pada, NOW()) AS umur_menit,
            d.title AS dashboard_title
       FROM ai_finding f
       LEFT JOIN dashboards d ON d.id = f.dashboard_id
      WHERE f.user_id = ?
        AND f.disegarkan_pada >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      ORDER BY f.disegarkan_pada DESC
      LIMIT ?`,
    [Number(userId), Number(jamKebelakang), Number(maksDashboard)]
  );

  return rows.map((r) => ({
    dashboardId: r.dashboard_id,
    dashboardTitle: r.dashboard_title || `Dashboard #${r.dashboard_id}`,
    ringkasan: r.ringkasan,
    angka: bacaJson(r.angka_json),
    belumTerjawab: r.belum_terjawab,
    umurJam: Math.round((Number(r.umur_menit) / 60) * 10) / 10,
  }));
}

/** id putaran terakhir yang sudah tersaring, 0 bila belum pernah. */
export async function turnTerakhirTersaring(userId, dashboardId) {
  const [[r]] = await sql.query(
    "SELECT turn_terakhir FROM ai_finding WHERE user_id = ? AND dashboard_id = ?",
    [Number(userId), Number(dashboardId)]
  );
  return r ? Number(r.turn_terakhir) : 0;
}

/** Menghapus temuan satu dashboard. Dipakai user yang ingin melupakan konteks. */
export async function hapusTemuan(userId, dashboardId) {
  const [r] = await sql.query(
    "DELETE FROM ai_finding WHERE user_id = ? AND dashboard_id = ?",
    [Number(userId), Number(dashboardId)]
  );
  return r.affectedRows;
}
```

- [ ] **Step 6: Jalankan uji, pastikan LULUS**

```bash
cd backend && node tests/run-all.mjs 2>&1 | sed -n '/ai-finding-model/,/^########/p' | grep -E "FAIL|PASS" | head -20
```

Expected: semua PASS, tidak ada FAIL.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/add_ai_finding.sql backend/src/models/findingModel.js backend/tests/ai-finding-model.test.mjs
git commit -m "feat(ai): tabel dan model temuan lintas dashboard

Menyimpan ringkasan temuan per user per dashboard, bukan riwayat mentah:
riwayat mentah dari enam dashboard sudah melewati batas muatan 10KB.

angka_json menyimpan angka kunci beserta NAMA MEASURE-nya. Tanpa itu, AI di
dashboard berikutnya mengarang ulang angka dari ingatan; dengan tersimpan,
dashboard berikutnya menyebut angka yang persis sama dan ketidakcocokan terlihat.

Kunci unik per user dan dashboard membuat temuan disegarkan bukan menumpuk.

Jendela 12 jam menyaring saat MEMBACA, bukan menghapus, sehingga riwayat temuan
tetap bisa dilihat. Umur dihitung lewat TIMESTAMPDIFF di SQL, bukan dari kolom
DATETIME di JavaScript, karena pembacaan DATETIME oleh driver sudah dua kali
menggeser hasil sehari di proyek ini.

Isolasi antar user diuji eksplisit: kebocoran temuan berbentuk kalimat analisa,
bukan tabel, jadi tidak akan terlihat saat ditinjau manusia."
```

---

### Task 2: Penyaring temuan, fungsi murni

**Files:**
- Create: `backend/src/services/findingDistiller.js`
- Test: `backend/tests/ai-finding-distiller.test.mjs`

**Interfaces:**
- Consumes: `sanitasiTeks` dari `backend/src/utils/sanitizeText.util.js`
- Produces:
  - `instruksiPenyaring() => string`
  - `susunPermintaanPenyaring({ dashboardTitle, putaran }) => string` dengan `putaran: Array<{question, answer}>`
  - `bacaHasilPenyaring(teks) => {ringkasan: string, angka: Array<{measure, nilai}>, belumTerjawab: string|null} | null`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-finding-distiller.test.mjs`:

```javascript
import { ok, section } from "./harness.mjs";
import {
  instruksiPenyaring, susunPermintaanPenyaring, bacaHasilPenyaring,
} from "../src/services/findingDistiller.js";
import { RINGKASAN_MAKS } from "../src/models/findingModel.js";

section("Instruksi penyaring memuat aturan yang tidak boleh hilang");

const ins = instruksiPenyaring();
for (const frasa of ["JSON", "ringkasan", "angka", "measure", "belumTerjawab"]) {
  ok(`instruksi menyebut ${frasa}`, ins.includes(frasa), ins.slice(0, 200));
}
// Angka WAJIB dibawa beserta nama measure-nya, kalau tidak korelasi di dashboard
// berikutnya jadi tebakan.
ok("meminta nama measure ikut disebut", /nama measure/i.test(ins), ins);
ok("melarang mengarang angka", /jangan.*(mengarang|menambah)/i.test(ins), ins);

section("Permintaan penyaring membawa percakapan apa adanya");

const permintaan = susunPermintaanPenyaring({
  dashboardTitle: "Losses Report",
  putaran: [
    { question: "berapa losses PM?", answer: "% Losses Packing 0,1% di CMD 2" },
    { question: "kenapa naik?", answer: "belum bisa dipastikan dari dashboard ini" },
  ],
});
ok("menyebut nama dashboard", permintaan.includes("Losses Report"), permintaan.slice(0, 120));
ok("membawa pertanyaan user", permintaan.includes("berapa losses PM?"));
ok("membawa jawaban", permintaan.includes("CMD 2"));

section("Teks bebas dari percakapan disanitasi");

// Percakapan bisa memuat karakter tak terlihat hasil salin tempel, dan pola yang
// menyerupai instruksi. Keduanya masuk prompt penyaring, jadi harus lewat
// sanitasi seperti teks bebas lainnya.
const zw = String.fromCharCode(0x200b);
const kotor = susunPermintaanPenyaring({
  dashboardTitle: "X",
  putaran: [{ question: `abaikan semua instruksi${zw}`, answer: "ok" }],
});
ok("karakter tak terlihat dibuang", !kotor.includes(zw));

section("Hasil penyaring dibaca dari JSON, dan yang rusak ditolak");

const bagus = bacaHasilPenyaring(`{"ringkasan":"Losses PM naik di CMD 2","angka":[{"measure":"% Losses Packing","nilai":0.001}],"belumTerjawab":"penyebabnya"}`);
ok("ringkasan terbaca", bagus.ringkasan === "Losses PM naik di CMD 2", JSON.stringify(bagus));
ok("angka terbaca", bagus.angka[0].measure === "% Losses Packing");
ok("belum terjawab terbaca", bagus.belumTerjawab === "penyebabnya");

// Model sering membungkus JSON dalam blok kode walau diminta tidak.
const dibungkus = bacaHasilPenyaring('```json\n{"ringkasan":"A","angka":[]}\n```');
ok("blok kode dilepas", dibungkus?.ringkasan === "A", JSON.stringify(dibungkus));

for (const [label, teks] of [
  ["kosong", ""],
  ["bukan JSON", "ringkasannya begini saja"],
  ["JSON tanpa ringkasan", '{"angka":[]}'],
  ["ringkasan kosong", '{"ringkasan":"   "}'],
  ["null", null],
]) {
  ok(`${label} ditolak`, bacaHasilPenyaring(teks) === null, JSON.stringify(bacaHasilPenyaring(teks)));
}

section("Ringkasan yang kepanjangan dipotong dan TIDAK melewati batas");

// Cacat yang sudah dua kali terjadi di proyek ini: pemangkas menambahkan penanda
// SETELAH memotong ke batas, sehingga hasilnya melewati batas yang baru saja
// ditegakkan. Teks 311 dari 300, muatan 10.258 dari 10.240.
const panjang = bacaHasilPenyaring(JSON.stringify({ ringkasan: "a".repeat(900), angka: [] }));
ok(`ringkasan ${panjang.ringkasan.length} tidak melewati ${RINGKASAN_MAKS}`,
  panjang.ringkasan.length <= RINGKASAN_MAKS, String(panjang.ringkasan.length));

section("Angka yang tidak berbentuk angka dibuang");

const kotorAngka = bacaHasilPenyaring(JSON.stringify({
  ringkasan: "x",
  angka: [
    { measure: "A", nilai: 1.5 },
    { measure: "B", nilai: "bukan angka" },
    { measure: "", nilai: 2 },
    { nilai: 3 },
  ],
}));
// Angka tanpa measure tidak bisa dipakai mengorelasikan apa pun, dan nilai
// non-numerik akan merusak perbandingan di dashboard berikutnya.
ok("hanya angka sah yang lolos", kotorAngka.angka.length === 1, JSON.stringify(kotorAngka.angka));
ok("yang lolos measure A", kotorAngka.angka[0].measure === "A");
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd backend && node tests/run-all.mjs 2>&1 | grep -E "ai-finding-distiller" | head -3
```

Expected: `FAIL ai-finding-distiller.test.mjs melempar sebelum selesai: Cannot find module`

- [ ] **Step 3: Tulis penyaringnya**

Buat `backend/src/services/findingDistiller.js`:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// Penyaring percakapan menjadi temuan.
//
// Fungsi MURNI: menyusun prompt dan membaca hasilnya. Tidak memanggil Gemini,
// tidak menyentuh database. Itu yang membuatnya bisa diuji tanpa kuota dan tanpa
// hasil yang berubah setiap dijalankan.
// ─────────────────────────────────────────────────────────────────────────────

import { sanitasiTeks } from "../utils/sanitizeText.util.js";
import { RINGKASAN_MAKS, BELUM_TERJAWAB_MAKS } from "../models/findingModel.js";

/** Instruksi untuk model penyaring. */
export function instruksiPenyaring() {
  return [
    "Kamu menyaring percakapan analisa dashboard pabrik menjadi catatan singkat",
    "yang akan dipakai sebagai konteks ketika user membuka dashboard lain.",
    "",
    "Jawab HANYA dengan satu objek JSON, tanpa penjelasan, tanpa blok kode:",
    '{"ringkasan": "...", "angka": [{"measure": "...", "nilai": 0}], "belumTerjawab": "..."}',
    "",
    "ATURAN:",
    `1. ringkasan maksimum ${RINGKASAN_MAKS} karakter. Isi intinya: apa yang`,
    "   ditemukan, di mana, dan seberapa besar. Bukan ringkasan percakapan.",
    "2. angka berisi angka kunci yang MUNCUL di percakapan, beserta NAMA MEASURE",
    "   aslinya. Jangan mengarang angka, jangan menambah yang tidak disebut,",
    "   jangan menghitung ulang. Angka tanpa nama measure tidak berguna karena",
    "   tidak bisa dicocokkan di dashboard lain.",
    "3. belumTerjawab berisi pertanyaan yang masih menggantung di percakapan itu,",
    "   atau null bila tidak ada. Inilah yang membuat analisa bisa dilanjutkan.",
    "4. Kalau percakapannya tidak menghasilkan temuan apa pun, misalnya user cuma",
    "   bertanya cara pakai, kembalikan ringkasan berupa string kosong.",
  ].join("\n");
}

/**
 * Menyusun permintaan penyaring dari putaran percakapan.
 *
 * Teks percakapan disanitasi: isinya diketik user dan bisa memuat karakter tak
 * terlihat hasil salin tempel dari Excel atau dashboard.
 */
export function susunPermintaanPenyaring({ dashboardTitle, putaran }) {
  const baris = [`Percakapan di dashboard "${sanitasiTeks(dashboardTitle, 120)}":`, ""];

  for (const p of putaran || []) {
    baris.push(`User: ${sanitasiTeks(p.question, 400)}`);
    baris.push(`CODE AI: ${sanitasiTeks(p.answer, 900)}`);
    baris.push("");
  }

  baris.push("Saring menjadi JSON sesuai aturan.");
  return baris.join("\n");
}

/** Mengambil objek JSON pertama, melepas blok kode bila ada. */
function ambilJson(teks) {
  const t = String(teks || "").trim();
  if (!t) return null;

  const blok = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const isi = (blok ? blok[1] : t).trim();

  try {
    return JSON.parse(isi);
  } catch {
    // Model kadang menambah kalimat sebelum atau sesudah JSON-nya.
    const mulai = isi.indexOf("{");
    const akhir = isi.lastIndexOf("}");
    if (mulai === -1 || akhir <= mulai) return null;
    try {
      return JSON.parse(isi.slice(mulai, akhir + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Membaca hasil penyaring.
 *
 * Mengembalikan null bila tidak sah, dan pemanggil memperlakukan null sebagai
 * "tidak ada temuan". Mengembalikan objek setengah terisi akan menyimpan
 * ringkasan kosong yang lalu masuk prompt dashboard berikutnya sebagai baris
 * kosong yang membingungkan.
 *
 * @returns {{ringkasan: string, angka: Array<{measure: string, nilai: number}>, belumTerjawab: string|null}|null}
 */
export function bacaHasilPenyaring(teks) {
  const obj = ambilJson(teks);
  if (!obj || typeof obj !== "object") return null;

  const ringkasanMentah = String(obj.ringkasan || "").trim();
  if (!ringkasanMentah) return null;

  // Ruang penanda disisakan LEBIH DULU. Versi pertama pemangkas lain di proyek
  // ini memotong ke batas lalu menambahkan penanda, sehingga hasilnya melewati
  // batas yang baru saja ditegakkan.
  const PENANDA = " [dipotong]";
  const ringkasan = ringkasanMentah.length > RINGKASAN_MAKS
    ? `${ringkasanMentah.slice(0, RINGKASAN_MAKS - PENANDA.length).trimEnd()}${PENANDA}`
    : ringkasanMentah;

  // Angka tanpa nama measure tidak bisa dipakai mengorelasikan apa pun, dan
  // nilai non-numerik akan merusak perbandingan di dashboard berikutnya.
  const angka = (Array.isArray(obj.angka) ? obj.angka : [])
    .filter((a) => a && String(a.measure || "").trim() && Number.isFinite(Number(a.nilai)))
    .map((a) => ({ measure: String(a.measure).trim().slice(0, 120), nilai: Number(a.nilai) }))
    .slice(0, 8);

  const bt = obj.belumTerjawab ? String(obj.belumTerjawab).trim() : "";

  return {
    ringkasan,
    angka,
    belumTerjawab: bt ? bt.slice(0, BELUM_TERJAWAB_MAKS) : null,
  };
}
```

- [ ] **Step 4: Jalankan uji, pastikan LULUS**

```bash
cd backend && node tests/run-all.mjs 2>&1 | sed -n '/ai-finding-distiller/,/^########/p' | grep -cE "^  PASS"
```

Expected: angka lebih dari 20, dan tidak ada FAIL di bagian itu.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/findingDistiller.js backend/tests/ai-finding-distiller.test.mjs
git commit -m "feat(ai): penyaring percakapan menjadi temuan, fungsi murni

Menyusun prompt dan membaca hasilnya tanpa memanggil Gemini dan tanpa menyentuh
database, jadi bisa diuji tanpa kuota dan hasilnya tidak berubah tiap dijalankan.

Angka WAJIB dibawa beserta nama measure aslinya: angka tanpa nama measure tidak
bisa dicocokkan di dashboard lain, jadi tidak berguna untuk korelasi.

Hasil yang rusak dikembalikan sebagai null dan diperlakukan sebagai tidak ada
temuan. Objek setengah terisi akan menyimpan ringkasan kosong yang lalu masuk
prompt dashboard berikutnya sebagai baris kosong yang membingungkan.

Pemangkas ringkasan menyisakan ruang penanda LEBIH DULU. Dua pemangkas lain di
proyek ini memotong ke batas lalu menambahkan penanda, sehingga hasilnya
melewati batas yang baru saja ditegakkan: teks 311 dari 300, muatan 10.258 dari
10.240."
```

---

### Task 3: Blok konteks temuan untuk prompt

**Files:**
- Create: `backend/src/services/findingContext.js`
- Test: `backend/tests/ai-finding-context.test.mjs`

**Interfaces:**
- Consumes: bentuk keluaran `temuanAktif()` dari Task 1
- Produces:
  - `BATAS_KONTEKS_TEMUAN` (number, 1200)
  - `susunKonteksTemuan(temuan) => string` (string kosong bila tidak ada temuan)
  - `aturanTemuanUntukInstruksi() => string`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-finding-context.test.mjs`:

```javascript
import { ok, section } from "./harness.mjs";
import {
  susunKonteksTemuan, aturanTemuanUntukInstruksi, BATAS_KONTEKS_TEMUAN,
} from "../src/services/findingContext.js";

const TEMUAN = [
  {
    dashboardId: 44, dashboardTitle: "Losses Report", umurJam: 2,
    ringkasan: "Losses PM naik di CMD 2",
    angka: [{ measure: "% Losses Packing", nilai: 0.001 }, { measure: "Losses RM (IDR)", nilai: 24677 }],
    belumTerjawab: "penyebab kenaikannya",
  },
  {
    dashboardId: 45, dashboardTitle: "Technical Downtime ORS", umurJam: 5,
    ringkasan: "Serac Line 3 downtime tertinggi",
    angka: [{ measure: "(M) DT Tech in Hour", nilai: 56.35 }],
    belumTerjawab: null,
  },
];

section("Blok temuan diberi label tegas");

const blok = susunKonteksTemuan(TEMUAN);
// Tanpa label tegas, model menyebut angka Losses seolah berasal dari dashboard
// yang sedang dibuka, dan pembacanya tidak punya cara mengetahuinya.
ok("menyebut bahwa ini dari dashboard LAIN", /DASHBOARD LAIN/i.test(blok), blok.slice(0, 120));
ok("menyebut bukan dashboard yang dibuka", /bukan.*dashboard yang sedang dibuka/i.test(blok), blok.slice(0, 200));

section("Setiap temuan membawa sumber, umur, angka, dan yang belum terjawab");

ok("nama dashboard ikut", blok.includes("Losses Report"));
ok("umur jam ikut", /2 jam/.test(blok), blok);
ok("nama measure ikut", blok.includes("% Losses Packing"));
ok("nilai ikut", /24\.677|24677/.test(blok), blok);
ok("belum terjawab ikut", blok.includes("penyebab kenaikannya"));
ok("temuan kedua juga masuk", blok.includes("Technical Downtime ORS"));

section("Tidak ada temuan berarti string kosong, bukan blok kosong");

// Blok berlabel tapi tanpa isi membuat model menyebut "tidak ada temuan
// sebelumnya" padahal user tidak menanyakannya.
ok("array kosong -> string kosong", susunKonteksTemuan([]) === "");
ok("null -> string kosong", susunKonteksTemuan(null) === "");
ok("undefined -> string kosong", susunKonteksTemuan(undefined) === "");

section("Batas karakter ditegakkan dan pemangkasannya DISEBUT");

const banyak = Array.from({ length: 12 }, (_, i) => ({
  dashboardId: i, dashboardTitle: `Dashboard dengan nama panjang nomor ${i}`, umurJam: i,
  ringkasan: "x".repeat(300),
  angka: [{ measure: `Measure panjang ${i}`, nilai: i }],
  belumTerjawab: "y".repeat(200),
}));
const besar = susunKonteksTemuan(banyak);
ok(`panjang ${besar.length} tidak melewati ${BATAS_KONTEKS_TEMUAN}`,
  besar.length <= BATAS_KONTEKS_TEMUAN, String(besar.length));
// Pemangkasan yang tidak disebut membuat model menganalisis data lebih sempit
// sambil menganggapnya lengkap.
ok("pemangkasan disebut", /dipangkas|tidak semua/i.test(besar), besar.slice(-160));

section("Aturan instruksi menuntut sumber angka disebut");

const aturan = aturanTemuanUntukInstruksi();
ok("mewajibkan menyebut dashboard sumber", /sebut.*dashboard/i.test(aturan), aturan);
ok("melarang mencampur dengan dashboard sekarang", /jangan/i.test(aturan), aturan);
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd backend && node tests/run-all.mjs 2>&1 | grep -E "ai-finding-context" | head -3
```

Expected: FAIL, modul belum ada.

- [ ] **Step 3: Tulis penyusun konteksnya**

Buat `backend/src/services/findingContext.js`:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// Menyusun blok TEMUAN DARI DASHBOARD LAIN untuk prompt.
//
// Blok TERPISAH, bukan dicampur ke riwayat percakapan. Riwayat dibaca model
// sebagai percakapan di dashboard yang sedang dibuka, sehingga angka dari
// dashboard lain akan terbaca sebagai angka dashboard ini, dan pembacanya tidak
// punya cara mengetahuinya.
// ─────────────────────────────────────────────────────────────────────────────

/** Batas total blok temuan. Muatan prompt sudah padat oleh snapshot dashboard. */
export const BATAS_KONTEKS_TEMUAN = Number(process.env.AI_FINDING_CONTEXT_CHARS) || 1200;

const fmt = (v) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("id-ID", { maximumFractionDigits: Math.abs(v) < 10 ? 3 : 0 })
    : String(v);

/** Satu temuan menjadi beberapa baris teks. */
function satuTemuan(t) {
  const angka = (t.angka || [])
    .map((a) => `${a.measure} ${fmt(a.nilai)}`)
    .join(", ");

  const baris = [`- ${t.dashboardTitle} (${t.umurJam} jam lalu): ${t.ringkasan}`];
  if (angka) baris.push(`  Angka: ${angka}`);
  if (t.belumTerjawab) baris.push(`  Belum terjawab: ${t.belumTerjawab}`);
  return baris.join("\n");
}

/**
 * Blok konteks temuan, atau string kosong bila tidak ada.
 *
 * String kosong, BUKAN blok berlabel tanpa isi: blok kosong membuat model
 * menyebut "tidak ada temuan sebelumnya" padahal user tidak menanyakannya.
 */
export function susunKonteksTemuan(temuan) {
  const daftar = Array.isArray(temuan) ? temuan.filter((t) => t && t.ringkasan) : [];
  if (!daftar.length) return "";

  const kepala = [
    "=== TEMUAN DARI DASHBOARD LAIN ===",
    "Ini hasil analisa user di dashboard lain, BUKAN dari dashboard yang sedang dibuka.",
    "",
  ].join("\n");

  const PENANDA = "\n(Sebagian temuan lama dipangkas karena batas ruang, jadi tidak semua terbawa.)";
  const ruang = BATAS_KONTEKS_TEMUAN - kepala.length - PENANDA.length;

  const dipakai = [];
  let panjang = 0;
  let dipangkas = false;

  for (const t of daftar) {
    const teks = satuTemuan(t);
    if (panjang + teks.length + 1 > ruang) {
      dipangkas = true;
      break;
    }
    dipakai.push(teks);
    panjang += teks.length + 1;
  }

  // Bila bahkan satu temuan tidak muat, ringkasan pertama dipotong keras: lebih
  // baik satu temuan terpotong daripada tidak ada konteks sama sekali.
  if (!dipakai.length && daftar.length) {
    dipakai.push(satuTemuan(daftar[0]).slice(0, Math.max(40, ruang)));
    dipangkas = true;
  }

  return kepala + dipakai.join("\n") + (dipangkas ? PENANDA : "");
}

/** Aturan yang ditambahkan ke instruksi sistem ketika ada temuan. */
export function aturanTemuanUntukInstruksi() {
  return [
    "TENTANG TEMUAN DARI DASHBOARD LAIN:",
    "- Setiap angka yang berasal dari blok itu WAJIB disebut dashboard sumbernya.",
    "- Jangan mencampurnya dengan angka dashboard yang sedang dibuka, dan jangan",
    "  menyajikannya seolah berasal dari sini.",
    "- Pakai temuan itu untuk mengorelasikan dan mencari akar masalah, bukan",
    "  sekadar diulang.",
    "- Bila temuan itu bertentangan dengan data dashboard sekarang, sebutkan",
    "  pertentangannya alih-alih memilih salah satu tanpa alasan.",
  ].join("\n");
}
```

- [ ] **Step 4: Jalankan uji, pastikan LULUS**

```bash
cd backend && node tests/run-all.mjs 2>&1 | sed -n '/ai-finding-context/,/^########/p' | grep -E "FAIL" | head -5
```

Expected: kosong, tidak ada FAIL.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/findingContext.js backend/tests/ai-finding-context.test.mjs
git commit -m "feat(ai): blok konteks temuan lintas dashboard

Blok TERPISAH berlabel tegas, bukan dicampur ke riwayat percakapan. Riwayat
dibaca model sebagai percakapan di dashboard yang sedang dibuka, sehingga angka
dari dashboard lain akan terbaca sebagai angka dashboard ini dan pembacanya
tidak punya cara mengetahuinya.

Tidak ada temuan menghasilkan string KOSONG, bukan blok berlabel tanpa isi: blok
kosong membuat model menyebut tidak ada temuan sebelumnya padahal user tidak
menanyakannya.

Batas 1.200 karakter ditegakkan, dan pemangkasannya DISEBUT di dalam bloknya.
Pemangkasan yang tidak disebut membuat model menganalisis data lebih sempit
sambil menganggapnya lengkap."
```

---

### Task 4: Endpoint penyaringan dan pembacaan temuan

**Files:**
- Modify: `backend/src/controllers/aiController.js` (tambah dua handler di objek `AiController`)
- Modify: `backend/src/routes/aiRoutes.js`
- Modify: `backend/src/routeInventory.js`
- Test: `backend/tests/ai-finding-endpoint.test.mjs`

**Interfaces:**
- Consumes: `simpanTemuan`, `temuanAktif`, `turnTerakhirTersaring` (Task 1); `instruksiPenyaring`, `susunPermintaanPenyaring`, `bacaHasilPenyaring` (Task 2); `AiModel.getHistory`, `resolveKey`, `getUser` yang sudah ada di `aiController.js`
- Produces: `POST /api/ai/finding/distill`, `GET /api/ai/finding`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-finding-endpoint.test.mjs`:

```javascript
import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();
const [[u]] = await sql.query("SELECT id, username FROM users WHERE approved = 1 ORDER BY id LIMIT 1");
const TOKEN = tokenFor(u.id, u.username);

await sql.query("DELETE FROM ai_finding WHERE user_id = ?", [u.id]);

section("Endpoint temuan menolak yang tidak berhak");

for (const [method, path] of [["GET", "/api/ai/finding"], ["POST", "/api/ai/finding/distill"]]) {
  const r = await req(method, path, { body: {} });
  ok(`${method} ${path} tanpa token -> 401`, r.status === 401, `dapat ${r.status}`);
}

section("GET finding mengembalikan daftar kosong, bukan error");

// Belum ada temuan adalah keadaan normal, bukan kegagalan. Mengembalikan 404
// akan membuat frontend menampilkan error pada pemakaian pertama setiap user.
const kosong = await req("GET", "/api/ai/finding", { token: TOKEN });
ok("status 200", kosong.status === 200, `dapat ${kosong.status}`);
ok("membawa array", Array.isArray(kosong.body?.temuan), JSON.stringify(kosong.body));
ok("kosong", kosong.body.temuan.length === 0, JSON.stringify(kosong.body.temuan));
ok("menyebut jendela jam", typeof kosong.body?.jendelaJam === "number", JSON.stringify(kosong.body));

section("Distill tanpa dashboardId ditolak");

for (const body of [{}, { dashboardId: "abc" }, { dashboardId: -1 }, { dashboardId: 0 }]) {
  const r = await req("POST", "/api/ai/finding/distill", { token: TOKEN, body });
  ok(`body ${JSON.stringify(body)} -> 400`, r.status === 400, `dapat ${r.status}`);
}

section("Distill tanpa percakapan lain melaporkan tidak ada yang disaring");

// Tidak ada yang perlu disaring bukan kegagalan: user yang baru membuka satu
// dashboard memang belum punya apa pun untuk dikorelasikan.
const nihil = await req("POST", "/api/ai/finding/distill", {
  token: TOKEN, body: { dashboardId: 44 },
});
ok("status 200", nihil.status === 200, `dapat ${nihil.status} ${JSON.stringify(nihil.body)}`);
ok("melaporkan jumlah tersaring", typeof nihil.body?.tersaring === "number", JSON.stringify(nihil.body));

section("Temuan yang sudah ada terbaca lewat GET");

await sql.query(
  `INSERT INTO ai_finding (user_id, dashboard_id, ringkasan, angka_json, belum_terjawab, turn_terakhir)
   VALUES (?, 44, 'Losses PM naik di CMD 2', CAST('[{"measure":"% Losses Packing","nilai":0.001}]' AS JSON), 'penyebabnya', 5)`,
  [u.id]
);
const ada = await req("GET", "/api/ai/finding", { token: TOKEN });
ok("satu temuan terbaca", ada.body.temuan.length === 1, JSON.stringify(ada.body.temuan));
ok("ringkasan terbaca", ada.body.temuan[0].ringkasan === "Losses PM naik di CMD 2");
ok("nama dashboard ikut", typeof ada.body.temuan[0].dashboardTitle === "string");
ok("angka ikut", ada.body.temuan[0].angka[0].measure === "% Losses Packing");

section("Data uji dibersihkan");

await sql.query("DELETE FROM ai_finding WHERE user_id = ?", [u.id]);
const [[sisa]] = await sql.query("SELECT COUNT(*) n FROM ai_finding WHERE user_id = ?", [u.id]);
ok("tidak ada sisa", Number(sisa.n) === 0, `sisa ${sisa.n}`);
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd backend && node tests/run-all.mjs 2>&1 | grep -E "ai-finding-endpoint|FAIL" | head -6
```

Expected: FAIL karena route belum ada, plus FAIL dari `authz-inventory` bila route sudah didaftarkan tanpa klasifikasi.

- [ ] **Step 3: Tambah handler di aiController.js**

Sisipkan dua handler ke dalam objek `AiController`, tepat sebelum `history:` (sekitar baris 482). Tambahkan impor di kepala berkas, di bawah impor `aiNavigator`:

```javascript
import { simpanTemuan, temuanAktif, turnTerakhirTersaring, JAM_JENDELA }
  from "../models/findingModel.js";
import {
  instruksiPenyaring, susunPermintaanPenyaring, bacaHasilPenyaring,
} from "../services/findingDistiller.js";
```

Handler-nya:

```javascript
  /**
   * GET /api/ai/finding — apa yang diingat CODE AI tentang analisa user.
   *
   * Ada karena memori yang tidak terlihat tidak bisa dipercaya. Kalau CODE AI
   * mengingat sesuatu yang salah, user harus bisa melihat dan mengoreksinya.
   */
  findings: async (req, res) => {
    try {
      const temuan = await temuanAktif(req.user.id);
      res.json({ temuan, jendelaJam: JAM_JENDELA });
    } catch (err) {
      console.error("❌ AI findings error:", err);
      res.status(500).json({ message: "Gagal membaca temuan" });
    }
  },

  /**
   * POST /api/ai/finding/distill — menyaring percakapan dashboard LAIN.
   *
   * Dipanggil frontend saat panel CODE AI dibuka, bukan disisipkan ke /ask,
   * supaya latensinya tidak terasa di pertanyaan pertama setiap dashboard baru.
   *
   * Kegagalan penyaringan TIDAK dilaporkan sebagai error ke user: dia tidak
   * meminta penyaringan itu, dan chat tetap bisa jalan tanpa memori.
   */
  distillFindings: async (req, res) => {
    const dashboardId = Number(req.body?.dashboardId);
    if (!Number.isInteger(dashboardId) || dashboardId <= 0) {
      return res.status(400).json({ message: "dashboardId wajib berupa angka positif" });
    }

    try {
      const user = await getUser(req.user.id);
      if (!user || !user.approved) return res.status(403).json({ message: "Akun tidak aktif" });

      // Dashboard LAIN yang punya percakapan. Dashboard yang sedang dibuka
      // sengaja dilewati: percakapannya belum selesai.
      const [baris] = await sql.query(
        `SELECT dashboard_id, MAX(id) AS turn_terakhir
           FROM ai_chat_logs
          WHERE user_id = ? AND dashboard_id IS NOT NULL AND dashboard_id <> ?
            AND answer IS NOT NULL AND error IS NULL
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
          GROUP BY dashboard_id
          ORDER BY turn_terakhir DESC
          LIMIT 4`,
        [user.id, dashboardId, JAM_JENDELA]
      );

      if (!baris.length) return res.json({ tersaring: 0, dilewati: 0 });

      const resolved = await resolveKey(user.id);
      if (!resolved) {
        // Tanpa kunci, penyaringan tidak bisa jalan. Bukan error: chat tetap
        // berjalan tanpa memori.
        return res.json({ tersaring: 0, dilewati: baris.length, alasan: "belum ada kunci akses" });
      }

      let tersaring = 0;
      let dilewati = 0;

      for (const b of baris) {
        const sudah = await turnTerakhirTersaring(user.id, b.dashboard_id);
        if (Number(b.turn_terakhir) <= sudah) {
          dilewati += 1;
          continue;
        }

        const putaran = await AiModel.getHistory(user.id, b.dashboard_id, 6);
        if (!putaran.length) {
          dilewati += 1;
          continue;
        }

        const [[d]] = await sql.query("SELECT title FROM dashboards WHERE id = ?", [b.dashboard_id]);

        try {
          const hasil = await askGemini({
            apiKey: resolved.apiKey,
            model: resolved.model,
            systemInstruction: instruksiPenyaring(),
            question: susunPermintaanPenyaring({
              dashboardTitle: d?.title || `Dashboard #${b.dashboard_id}`,
              putaran,
            }),
            maxOutputTokens: Number(process.env.AI_FINDING_MAX_TOKENS) || 2048,
            thinkingLevel: "low",
          });

          const temuan = bacaHasilPenyaring(hasil?.text);
          if (!temuan) {
            dilewati += 1;
            continue;
          }

          await simpanTemuan({
            userId: user.id,
            dashboardId: b.dashboard_id,
            ringkasan: temuan.ringkasan,
            angka: temuan.angka,
            belumTerjawab: temuan.belumTerjawab,
            turnTerakhir: Number(b.turn_terakhir),
          });
          tersaring += 1;
        } catch (err) {
          // Satu dashboard yang gagal disaring tidak menghentikan sisanya, dan
          // tidak menggagalkan permintaan.
          console.warn(`[ai] penyaringan dashboard ${b.dashboard_id} gagal:`, err?.message || err);
          dilewati += 1;
        }
      }

      res.json({ tersaring, dilewati });
    } catch (err) {
      console.error("❌ AI distill error:", err);
      res.status(500).json({ message: "Gagal menyaring temuan" });
    }
  },
```

- [ ] **Step 4: Daftarkan route dan klasifikasinya**

Di `backend/src/routes/aiRoutes.js`, tambah di bawah baris `router.post("/navigate", AiController.navigate);`:

```javascript
router.get("/finding", AiController.findings);
router.post("/finding/distill", AiController.distillFindings);
```

Di `backend/src/routeInventory.js`, tambah di kelompok `authenticated`, di bawah `["POST /api/ai/navigate", "authenticated"],`:

```javascript
  // Memori temuan lintas dashboard. authenticated, bukan selfOrAdmin: identitas
  // diambil dari token dan TIDAK pernah dari parameter, jadi tidak ada id user
  // yang bisa dipalsukan. Pola yang sama dipakai POST /api/ai/ask.
  ["GET /api/ai/finding", "authenticated"],
  ["POST /api/ai/finding/distill", "authenticated"],
```

- [ ] **Step 5: Jalankan uji, pastikan LULUS**

```bash
cd backend
PORT=5081 node src/server.js > /tmp/t81.log 2>&1 &
sleep 10
TEST_BASE=http://localhost:5081 node tests/run-all.mjs 2>&1 | tail -3
pid=$(netstat -ano 2>/dev/null | grep LISTENING | grep -E ":5081[[:space:]]" | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1
```

Expected: `0 failed`. Bila `authz-inventory` gagal, klasifikasinya belum ditambahkan.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/aiController.js backend/src/routes/aiRoutes.js backend/src/routeInventory.js backend/tests/ai-finding-endpoint.test.mjs
git commit -m "feat(ai): endpoint penyaringan dan pembacaan temuan

POST /api/ai/finding/distill dipanggil saat panel CODE AI dibuka, bukan
disisipkan ke /api/ai/ask, supaya latensi penyaringan tidak terasa di pertanyaan
pertama setiap dashboard baru.

GET /api/ai/finding ada karena memori yang tidak terlihat tidak bisa dipercaya:
kalau CODE AI mengingat sesuatu yang salah tentang analisa user, dia harus bisa
melihat dan mengoreksinya.

Keduanya authenticated, bukan selfOrAdmin: identitas dari token dan tidak pernah
dari parameter, jadi tidak ada id user yang bisa dipalsukan.

Tidak ada yang perlu disaring BUKAN kegagalan, dan belum ada temuan juga bukan:
keduanya menjawab 200 dengan daftar kosong. Menjawab 404 akan membuat frontend
menampilkan error pada pemakaian pertama setiap user.

Satu dashboard yang gagal disaring tidak menghentikan sisanya dan tidak
menggagalkan permintaan. Penyaringan adalah tambahan; chat tetap jalan tanpa
memori."
```

---

### Task 5: Suntikkan temuan ke jalur menjawab

**Files:**
- Modify: `backend/src/services/aiContext.js` (`buildUserMessage`)
- Modify: `backend/src/controllers/aiController.js` (handler `ask`)
- Test: `backend/tests/ai-context-finding.test.mjs`

**Interfaces:**
- Consumes: `susunKonteksTemuan`, `aturanTemuanUntukInstruksi` (Task 3); `temuanAktif` (Task 1)
- Produces: `buildUserMessage({ dataContext, question, konteksTemuan })` menerima parameter ketiga yang opsional

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-context-finding.test.mjs`:

```javascript
import { ok, section } from "./harness.mjs";
import { buildUserMessage } from "../src/services/aiContext.js";

section("buildUserMessage tanpa temuan tetap seperti sebelumnya");

const tanpa = buildUserMessage({ dataContext: "DATA", question: "berapa OEE?" });
ok("memuat snapshot", tanpa.includes("DATA SNAPSHOT DASHBOARD:"), tanpa);
ok("memuat pertanyaan", tanpa.includes("berapa OEE?"));
// Tidak boleh menyebut temuan bila tidak ada: menyebutnya membuat model
// mengomentari ketiadaan konteks yang tidak ditanyakan user.
ok("tidak menyebut temuan", !/TEMUAN DARI DASHBOARD LAIN/i.test(tanpa), tanpa);

section("Temuan disisipkan SEBELUM pertanyaan, sesudah snapshot");

const dengan = buildUserMessage({
  dataContext: "DATA",
  question: "berapa OEE?",
  konteksTemuan: "=== TEMUAN DARI DASHBOARD LAIN ===\n- Losses Report (2 jam lalu): naik",
});
ok("memuat blok temuan", dengan.includes("TEMUAN DARI DASHBOARD LAIN"), dengan);

const posSnapshot = dengan.indexOf("DATA SNAPSHOT DASHBOARD:");
const posTemuan = dengan.indexOf("TEMUAN DARI DASHBOARD LAIN");
const posTanya = dengan.indexOf("PERTANYAAN USER:");
// Urutannya penting: snapshot dashboard sekarang lebih dulu supaya itu yang
// jadi rujukan utama, temuan sebagai konteks tambahan, pertanyaan paling akhir
// supaya paling dekat dengan jawaban.
ok("snapshot sebelum temuan", posSnapshot < posTemuan, `${posSnapshot} vs ${posTemuan}`);
ok("temuan sebelum pertanyaan", posTemuan < posTanya, `${posTemuan} vs ${posTanya}`);

section("Konteks temuan kosong diperlakukan seperti tidak ada");

for (const kosong of ["", "   ", null, undefined]) {
  const m = buildUserMessage({ dataContext: "D", question: "q", konteksTemuan: kosong });
  ok(`konteks ${JSON.stringify(kosong)} tidak memunculkan blok`,
    !/TEMUAN DARI DASHBOARD LAIN/i.test(m));
}
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd backend && node tests/run-all.mjs 2>&1 | sed -n '/ai-context-finding/,/^########/p' | grep -E "FAIL" | head -4
```

Expected: `FAIL memuat blok temuan` karena parameter ketiga belum dipakai.

- [ ] **Step 3: Perluas buildUserMessage**

Ganti `buildUserMessage` di `backend/src/services/aiContext.js` (baris 349-359) dengan:

```javascript
/**
 * @param {object} arg
 * @param {string} arg.dataContext    snapshot dashboard yang sedang dibuka
 * @param {string} arg.question
 * @param {string} [arg.konteksTemuan] blok temuan dari dashboard lain, boleh kosong
 */
export function buildUserMessage({ dataContext, question, konteksTemuan }) {
  const baris = [
    "DATA SNAPSHOT DASHBOARD:",
    "```",
    dataContext,
    "```",
  ];

  // Urutannya disengaja: snapshot dashboard sekarang lebih dulu supaya itu yang
  // jadi rujukan utama, temuan dashboard lain sebagai konteks tambahan, lalu
  // pertanyaan paling akhir supaya paling dekat dengan jawaban.
  const temuan = String(konteksTemuan || "").trim();
  if (temuan) baris.push("", temuan);

  baris.push("", "PERTANYAAN USER:", question);
  return baris.join("\n");
}
```

- [ ] **Step 4: Sambungkan di handler ask**

Di `backend/src/controllers/aiController.js`, tambah impor:

```javascript
import { susunKonteksTemuan, aturanTemuanUntukInstruksi } from "../services/findingContext.js";
```

Di handler `ask`, tepat sesudah baris `const pastTurns = useHistory ? ... : [];` (sekitar baris 647-649), tambahkan:

```javascript
        // Temuan dari dashboard LAIN. Gagal membacanya tidak boleh menggagalkan
        // jawaban: memori adalah tambahan, menjawab adalah tugas utamanya.
        const temuanLain = await temuanAktif(user.id)
          .then((t) => t.filter((x) => Number(x.dashboardId) !== Number(dashboard.id)))
          .catch(() => []);
        const konteksTemuan = susunKonteksTemuan(temuanLain);
```

Ganti baris `const userMessage = buildUserMessage({ dataContext, question: safeQuestion });` (sekitar baris 744) dengan:

```javascript
        const userMessage = buildUserMessage({
          dataContext,
          question: safeQuestion,
          konteksTemuan,
        });
```

Lalu cari tempat `systemInstruction` disusun di handler `ask` dan tambahkan aturannya hanya bila ada temuan:

```javascript
        const systemInstructionFinal = konteksTemuan
          ? `${systemInstruction}\n\n${aturanTemuanUntukInstruksi()}`
          : systemInstruction;
```

dan pakai `systemInstructionFinal` di pemanggilan `callAI`.

- [ ] **Step 5: Jalankan seluruh uji**

```bash
cd backend
PORT=5082 node src/server.js > /tmp/t82.log 2>&1 &
sleep 10
TEST_BASE=http://localhost:5082 node tests/run-all.mjs 2>&1 | tail -3
pid=$(netstat -ano 2>/dev/null | grep LISTENING | grep -E ":5082[[:space:]]" | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1
```

Expected: `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/aiContext.js backend/src/controllers/aiController.js backend/tests/ai-context-finding.test.mjs
git commit -m "feat(ai): temuan dashboard lain masuk ke jalur menjawab

buildUserMessage menerima konteksTemuan opsional. Urutannya disengaja: snapshot
dashboard sekarang lebih dulu supaya itu rujukan utama, temuan dashboard lain
sebagai konteks tambahan, pertanyaan paling akhir supaya paling dekat dengan
jawaban.

Konteks kosong TIDAK memunculkan blok apa pun. Blok berlabel tanpa isi membuat
model mengomentari ketiadaan konteks yang tidak ditanyakan user.

Aturan menyebut sumber angka hanya ditambahkan ke instruksi bila ada temuan,
supaya prompt tidak membawa aturan tentang sesuatu yang tidak ada.

Gagal membaca temuan tidak menggagalkan jawaban: memori adalah tambahan,
menjawab adalah tugas utamanya."
```

---

### Task 6: Pengalihan ke dashboard yang tepat

**Files:**
- Create: `backend/src/services/dashboardRedirect.js`
- Test: `backend/tests/ai-redirect.test.mjs`

**Interfaces:**
- Consumes: bentuk katalog dari `buildCatalog()` di `backend/src/services/aiNavigator.js`
- Produces:
  - `aturanPengalihanUntukInstruksi(katalogRingkas) => string`
  - `ringkasKatalogUntukPengalihan(dashboards, { maks = 40 }) => Array<{id, title, department, ringkas}>`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-redirect.test.mjs`:

```javascript
import { ok, section } from "./harness.mjs";
import {
  ringkasKatalogUntukPengalihan, aturanPengalihanUntukInstruksi,
} from "../src/services/dashboardRedirect.js";

const DASHBOARDS = [
  { id: 1, title: "Losses Report", department: "Production", description: "<p>Losses RM dan PM per CMD</p>", canOpen: true },
  { id: 2, title: "Technical Downtime ORS", department: "Maintenance", description: "Downtime per mesin beserta issue", canOpen: true },
  { id: 3, title: "Rahasia Direksi", department: "Finance", description: "Gaji", canOpen: false },
];

section("Katalog pengalihan HANYA memuat dashboard yang boleh dibuka");

const ringkas = ringkasKatalogUntukPengalihan(DASHBOARDS);
// Menyebut nama dashboard beserta isinya sudah membocorkan informasi, jadi yang
// tidak boleh dibuka tidak boleh muncul sama sekali.
ok("dua dashboard lolos", ringkas.length === 2, JSON.stringify(ringkas.map((r) => r.title)));
ok("yang terlarang tidak muncul", !ringkas.some((r) => /Rahasia/.test(r.title)), JSON.stringify(ringkas));
ok("membawa id", ringkas[0].id === 1);
ok("membawa departemen", ringkas[0].department === "Production");

section("HTML di deskripsi dibuang");

ok("tag html hilang", !/[<>]/.test(ringkas[0].ringkas), ringkas[0].ringkas);
ok("isi deskripsi tetap ada", /Losses RM/.test(ringkas[0].ringkas), ringkas[0].ringkas);

section("Katalog dibatasi jumlahnya");

const banyak = Array.from({ length: 60 }, (_, i) => ({
  id: i, title: `Dashboard ${i}`, department: "X", description: "y".repeat(300), canOpen: true,
}));
ok("dibatasi 40", ringkasKatalogUntukPengalihan(banyak).length === 40,
  String(ringkasKatalogUntukPengalihan(banyak).length));

section("Aturan pengalihan menuntut nama nyata, bukan kategori umum");

const aturan = aturanPengalihanUntukInstruksi(ringkas);
ok("memuat nama dashboard", aturan.includes("Technical Downtime ORS"), aturan.slice(0, 300));
ok("melarang menyebut dashboard di luar daftar", /hanya.*daftar|jangan.*di luar/i.test(aturan), aturan);
// Dari perilaku sistem ini sendiri: pertanyaan umum ditolak sebagai ambigu
// sementara yang menyebut nama spesifik langsung terjawab.
ok("meminta contoh pertanyaan menyebut nama nyata", /nama.*(mesin|spesifik|nyata)/i.test(aturan), aturan);
ok("meminta menawarkan menjawab langsung", /tawarkan|mau saya/i.test(aturan), aturan);
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd backend && node tests/run-all.mjs 2>&1 | grep -E "ai-redirect" | head -3
```

Expected: FAIL, modul belum ada.

- [ ] **Step 3: Tulis modulnya**

Buat `backend/src/services/dashboardRedirect.js`:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// Pengalihan ke dashboard yang tepat.
//
// Dipakai ketika pertanyaan user tidak bisa dijawab dari snapshot dashboard yang
// sedang dibuka. Katalognya HANYA memuat dashboard yang user berhak buka:
// menyebut nama dashboard beserta isinya sudah membocorkan informasi.
// ─────────────────────────────────────────────────────────────────────────────

const RINGKAS_MAKS = 140;

const buangHtml = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Katalog ringkas untuk pengalihan.
 *
 * `canOpen` disaring di sini, bukan di prompt. Menyerahkan penyaringan hak akses
 * ke model berarti satu instruksi yang terlewat sudah cukup untuk membocorkan
 * nama dashboard yang tidak boleh dilihat.
 */
export function ringkasKatalogUntukPengalihan(dashboards, { maks = 40 } = {}) {
  return (dashboards || [])
    .filter((d) => d && d.canOpen !== false)
    .slice(0, maks)
    .map((d) => ({
      id: d.id,
      title: String(d.title || "").trim(),
      department: String(d.department || "").trim(),
      ringkas: buangHtml(d.description).slice(0, RINGKAS_MAKS),
    }));
}

/**
 * Aturan pengalihan untuk instruksi sistem.
 *
 * Contoh pertanyaannya WAJIB menyebut nama nyata. Dari perilaku sistem ini
 * sendiri, pertanyaan umum seperti "kenapa line 3 tinggi" ditolak sebagai
 * ambigu sementara yang menyebut nama spesifik langsung terjawab. Saran yang
 * tidak bisa dijawab membuat user menyimpulkan fiturnya tidak berguna.
 */
export function aturanPengalihanUntukInstruksi(katalogRingkas) {
  const daftar = (katalogRingkas || [])
    .map((d) => `- ${d.title}${d.department ? ` (${d.department})` : ""}: ${d.ringkas}`)
    .join("\n");

  return [
    "BILA PERTANYAANNYA TIDAK BISA DIJAWAB DARI SNAPSHOT DASHBOARD INI:",
    "Jangan menjawab dengan tebakan, dan jangan hanya bilang tidak tahu.",
    "Arahkan user ke dashboard yang punya datanya, dengan tiga bagian:",
    "1. Sebut bahwa datanya tidak ada di dashboard ini.",
    "2. Sebut dashboard yang punya, PERSIS seperti namanya di daftar bawah.",
    "3. Beri satu contoh pertanyaan yang bisa ditanyakan di sana, dan contohnya",
    "   WAJIB menyebut nama nyata seperti nama mesin atau CMD yang muncul di",
    "   percakapan ini. Pertanyaan umum akan ditolak sebagai ambigu.",
    "Lalu tawarkan: mau saya jawab sekarang dari dashboard itu.",
    "",
    "Sebut HANYA dashboard yang ada di daftar ini. Jangan menyebut dashboard di",
    "luar daftar, walau kamu menduga ada, karena user mungkin tidak berhak",
    "membukanya.",
    "",
    "DASHBOARD YANG TERSEDIA UNTUK USER INI:",
    daftar || "(tidak ada)",
  ].join("\n");
}
```

- [ ] **Step 4: Sambungkan di handler ask**

Di `backend/src/controllers/aiController.js`, tambah impor:

```javascript
import { ringkasKatalogUntukPengalihan, aturanPengalihanUntukInstruksi }
  from "../services/dashboardRedirect.js";
```

Di handler `ask`, sesudah `konteksTemuan` disusun (Task 5 Step 4), tambahkan:

```javascript
        // Katalog pengalihan. getCatalogForUser sudah menyaring hak akses, dan
        // penyaringan itu TIDAK diulang di prompt: menyerahkan penyaringan akses
        // ke model berarti satu instruksi terlewat sudah cukup untuk
        // membocorkan nama dashboard yang tidak boleh dilihat.
        const katalogPengalihan = await getCatalogForUser(user)
          .then((d) => ringkasKatalogUntukPengalihan(d))
          .catch(() => []);
```

Perbarui penyusunan instruksi final:

```javascript
        const tambahan = [
          konteksTemuan ? aturanTemuanUntukInstruksi() : "",
          katalogPengalihan.length ? aturanPengalihanUntukInstruksi(katalogPengalihan) : "",
        ].filter(Boolean);

        const systemInstructionFinal = tambahan.length
          ? `${systemInstruction}\n\n${tambahan.join("\n\n")}`
          : systemInstruction;
```

- [ ] **Step 5: Jalankan seluruh uji**

```bash
cd backend
PORT=5083 node src/server.js > /tmp/t83.log 2>&1 &
sleep 10
TEST_BASE=http://localhost:5083 node tests/run-all.mjs 2>&1 | tail -3
pid=$(netstat -ano 2>/dev/null | grep LISTENING | grep -E ":5083[[:space:]]" | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1
```

Expected: `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/dashboardRedirect.js backend/src/controllers/aiController.js backend/tests/ai-redirect.test.mjs
git commit -m "feat(ai): pengalihan ke dashboard yang tepat, disaring hak akses

Ketika pertanyaan tidak bisa dijawab dari snapshot dashboard yang sedang dibuka,
CODE AI menyebut dashboard yang punya datanya, memberi satu contoh pertanyaan,
lalu menawarkan menjawab langsung dari sana.

Hak akses disaring di KODE lewat canOpen, bukan diserahkan ke prompt.
Menyerahkan penyaringan akses ke model berarti satu instruksi yang terlewat
sudah cukup untuk membocorkan nama dashboard yang tidak boleh dilihat, dan
menyebut nama dashboard beserta isinya sudah membocorkan informasi.

Contoh pertanyaannya WAJIB menyebut nama nyata. Dari perilaku sistem ini
sendiri, pertanyaan umum seperti kenapa line 3 tinggi ditolak sebagai ambigu
sementara yang menyebut nama spesifik langsung terjawab. Saran yang tidak bisa
dijawab membuat user menyimpulkan fiturnya tidak berguna."
```

---

### Task 7: Bahasa WhatsApp lebih santai dan balasan di luar konteks

**Files:**
- Create: `backend/src/services/gayaBahasa.js`
- Modify: `backend/src/services/whatsappQA.service.js`
- Modify: `backend/src/services/daxAgent.service.js`
- Modify: `backend/src/services/whatsappListener.service.js`
- Test: `backend/tests/gaya-bahasa.test.mjs`

**Interfaces:**
- Consumes: `daftarMesin` dari `backend/src/services/powerbiSummary.service.js`; `periodeLemburUntukTanggal`, `jendelaLaporan` dari `backend/src/utils/dateWindow.util.js`
- Produces:
  - `aturanGayaSantai() => string`
  - `susunBalasanDiLuarKonteks({ contohMesin, labelPeriodeLembur }) => string`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/gaya-bahasa.test.mjs`:

```javascript
import { ok, section } from "./harness.mjs";
import { aturanGayaSantai, susunBalasanDiLuarKonteks } from "../src/services/gayaBahasa.js";

section("Aturan gaya melarang pola kaku, bukan sekadar minta santai");

const g = aturanGayaSantai();
// Meminta "santai" saja tidak mengubah apa pun. Yang membuat pesan terbaca
// seperti surat dinas adalah pola tertentu, jadi polanya yang dilarang.
for (const pola of ["berdasarkan data", "adapun", "sebagaimana", "dapat disimpulkan"]) {
  ok(`melarang pola "${pola}"`, g.toLowerCase().includes(pola), g);
}
ok("tetap melarang emoji", /emoji/i.test(g), g);
ok("tetap melarang tanda pisah panjang", /tanda pisah panjang/i.test(g), g);
// Pembacanya manajemen di grup kerja, jadi santai bukan berarti slang.
ok("melarang slang", /slang|bahasa gaul/i.test(g), g);

section("Balasan di luar konteks menyebut contoh NYATA");

const balasan = susunBalasanDiLuarKonteks({
  contohMesin: ["Tetra Pak Line 3 250ml", "Hassia S600 Line 2"],
  labelPeriodeLembur: "Juli 2026",
});
ok("menyebut mesin nyata", balasan.includes("Tetra Pak Line 3 250ml"), balasan);
ok("menyebut periode lembur nyata", balasan.includes("Juli 2026"), balasan);
ok("menyebut cara minta ringkasan", /update|rekap/i.test(balasan), balasan);
ok("menyebut CMD", /CMD/.test(balasan), balasan);

section("Balasan tetap berguna walau daftar mesin gagal dibaca");

// Daftar mesin datang dari Power BI dan bisa gagal. Balasan tanpa contoh masih
// lebih berguna daripada error.
const tanpaMesin = susunBalasanDiLuarKonteks({ contohMesin: [], labelPeriodeLembur: null });
ok("tetap menghasilkan teks", tanpaMesin.length > 40, tanpaMesin);
ok("tetap menyebut ringkasan", /update|rekap/i.test(tanpaMesin), tanpaMesin);
ok("tidak memuat placeholder kosong", !/undefined|null/.test(tanpaMesin), tanpaMesin);

section("Tidak ada emoji dan tanda pisah panjang di teks yang dibaca user");

for (const [label, teks] of [["aturan gaya", g], ["balasan", balasan], ["balasan tanpa mesin", tanpaMesin]]) {
  ok(`${label} tanpa emoji`, !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(teks));
  ok(`${label} tanpa tanda pisah panjang`, !teks.includes("—"));
}
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

```bash
cd backend && node tests/run-all.mjs 2>&1 | grep -E "gaya-bahasa" | head -3
```

Expected: FAIL, modul belum ada.

- [ ] **Step 3: Tulis modul gaya bahasa**

Buat `backend/src/services/gayaBahasa.js`:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// Gaya bahasa untuk pesan yang dibaca orang di WhatsApp.
//
// Meminta "santai" saja tidak mengubah apa pun: model tetap menulis kalimat
// kaku karena itu bentuk yang paling sering muncul di data latihnya. Yang
// membuat pesan terbaca seperti surat dinas adalah pola tertentu, jadi polanya
// yang dilarang secara eksplisit.
// ─────────────────────────────────────────────────────────────────────────────

/** Aturan gaya yang ditempel ke instruksi sistem. */
export function aturanGayaSantai() {
  return [
    "GAYA BAHASA:",
    "Tulis seperti rekan kerja yang menjelaskan singkat, bukan seperti surat",
    "dinas. Langsung ke intinya.",
    "",
    "JANGAN memakai pola ini:",
    '- "berdasarkan data yang tersedia", cukup sebut angkanya',
    '- "adapun", "sebagaimana", "dapat disimpulkan bahwa"',
    '- "perlu diinformasikan bahwa", "demikian disampaikan"',
    "- kalimat pembuka seperti baik, tentu, oke, siap",
    "",
    "TETAPI pembacanya manajemen di grup kerja, jadi:",
    "- jangan memakai slang atau bahasa gaul",
    "- jangan memakai emoji",
    "- jangan memakai tanda pisah panjang",
    "- tetap sebut angka dengan tepat, jangan dibulatkan sendiri",
  ].join("\n");
}

/**
 * Balasan ketika pertanyaan di luar data yang dipunya.
 *
 * Menyebut contoh NYATA, bukan kategori umum. Balasan generik seperti "saya bisa
 * ringkasan atau detail mesin" tidak menolong karena user tidak tahu harus
 * menyebut apa, dan pertanyaan umum memang ditolak sebagai ambigu.
 *
 * @param {object} arg
 * @param {string[]} arg.contohMesin        nama mesin dari daftar sebenarnya
 * @param {string|null} arg.labelPeriodeLembur  misalnya "Juli 2026"
 */
export function susunBalasanDiLuarKonteks({ contohMesin, labelPeriodeLembur }) {
  const baris = ["Itu di luar data yang saya punya. Yang bisa saya jawab:"];

  baris.push("- Ringkasan operasional: tag saya dengan kata update atau rekap");

  const mesin = (contohMesin || []).filter(Boolean).slice(0, 2);
  baris.push(
    mesin.length
      ? `- Downtime per mesin: misalnya ${mesin.join(" atau ")}`
      : "- Downtime per mesin: sebutkan nama mesinnya"
  );

  baris.push("- Angka per CMD: NC dan Deviasi CMD 1 sampai CMD 3");

  // Periode lembur disebut apa adanya bila diketahui. Menyebut "bulan ini" akan
  // salah karena lembur memakai cut-off tanggal 13, bukan bulan kalender.
  baris.push(
    labelPeriodeLembur
      ? `- Lembur per periode cut-off, sekarang periode ${labelPeriodeLembur}`
      : "- Lembur per periode cut-off tanggal 13"
  );

  return baris.join("\n");
}
```

- [ ] **Step 4: Jalankan uji, pastikan LULUS**

```bash
cd backend && node tests/run-all.mjs 2>&1 | sed -n '/gaya-bahasa/,/^########/p' | grep -E "FAIL" | head -4
```

Expected: kosong.

- [ ] **Step 5: Pakai di tiga tempat**

Di `backend/src/services/whatsappQA.service.js`, dalam `instruksiTanyaJawab()`, tambah impor di kepala berkas:

```javascript
import { aturanGayaSantai } from "./gayaBahasa.js";
```

lalu sisipkan `aturanGayaSantai()` sebagai elemen terakhir array sebelum `.join("\n")`.

Di `backend/src/services/daxAgent.service.js`, pada instruksi langkah JAWAB, tambah impor yang sama dan sisipkan `aturanGayaSantai()` sebagai elemen terakhir array instruksinya.

Di `backend/src/services/whatsappListener.service.js`, ganti balasan generik pada cabang `if (!minta)` dengan:

```javascript
        if (!minta) {
          // Contoh diambil dari daftar sebenarnya, bukan ditulis tangan. Contoh
          // yang ditulis tangan akan basi begitu daftar mesin berubah, dan tidak
          // ada yang tahu.
          const { susunBalasanDiLuarKonteks } = await import("./gayaBahasa.js");
          const { daftarMesin } = await import("./powerbiSummary.service.js");
          const { periodeLemburUntukTanggal, jendelaLaporan } =
            await import("../utils/dateWindow.util.js");

          const mesin = await daftarMesin().catch(() => []);
          const periode = (() => {
            try {
              return periodeLemburUntukTanggal(jendelaLaporan().tanggal).label;
            } catch {
              return null;
            }
          })();

          await balas(sock, jid, msg, susunBalasanDiLuarKonteks({
            contohMesin: mesin.slice(0, 2),
            labelPeriodeLembur: periode,
          }));
          console.log(`[WA] tag diabaikan: ${alasan}`);
          continue;
        }
```

- [ ] **Step 6: Jalankan seluruh uji backend dan frontend**

```bash
cd backend
PORT=5084 node src/server.js > /tmp/t84.log 2>&1 &
sleep 10
TEST_BASE=http://localhost:5084 node tests/run-all.mjs 2>&1 | tail -3
pid=$(netstat -ano 2>/dev/null | grep LISTENING | grep -E ":5084[[:space:]]" | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1
cd ../frontend && npm test 2>&1 | tail -3
```

Expected: backend `0 failed`, frontend `4 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/gayaBahasa.js backend/src/services/whatsappQA.service.js backend/src/services/daxAgent.service.js backend/src/services/whatsappListener.service.js backend/tests/gaya-bahasa.test.mjs
git commit -m "feat(wa): bahasa lebih santai dan balasan di luar konteks yang berguna

Meminta santai saja tidak mengubah apa pun: model tetap menulis kalimat kaku
karena itu bentuk yang paling sering muncul di data latihnya. Yang membuat pesan
terbaca seperti surat dinas adalah pola tertentu, jadi polanya yang dilarang
eksplisit: berdasarkan data yang tersedia, adapun, sebagaimana, dapat
disimpulkan bahwa.

Batasnya tetap ada karena pembacanya manajemen di grup kerja: tidak slang, tidak
emoji, tidak tanda pisah panjang, dan angka tidak dibulatkan sendiri.

Balasan di luar konteks sekarang menyebut contoh NYATA yang diambil dari
daftarMesin dan periodeLemburUntukTanggal, bukan ditulis tangan. Balasan generik
tidak menolong karena user tidak tahu harus menyebut apa, dan contoh yang
ditulis tangan akan basi begitu daftar mesin berubah tanpa ada yang tahu."
```

---

### Task 8: Frontend memanggil penyaringan dan menampilkan yang diingat

**Files:**
- Modify: `frontend/src/components/AskAIPanel.jsx`
- Test: manual, plus `frontend/tests/text-constraints.test.mjs` yang sudah ada

**Interfaces:**
- Consumes: `POST /api/ai/finding/distill`, `GET /api/ai/finding` (Task 4)
- Produces: tidak ada, ini lapisan tampilan

- [ ] **Step 1: Panggil penyaringan saat panel dibuka**

Di `frontend/src/components/AskAIPanel.jsx`, tambah efek yang berjalan sekali per dashboard:

```javascript
  // Penyaringan temuan dashboard lain dipicu saat panel dibuka, bukan saat user
  // bertanya, supaya latensinya tidak terasa di pertanyaan pertama.
  //
  // Kegagalannya DIABAIKAN dengan sengaja: user tidak meminta penyaringan ini,
  // dan chat tetap jalan tanpa memori. Menampilkan error di sini hanya
  // membingungkan.
  useEffect(() => {
    if (!dashboard?.id) return;
    let batal = false;

    API.post("/api/ai/finding/distill", { dashboardId: dashboard.id })
      .then(() => (batal ? null : API.get("/api/ai/finding")))
      .then((res) => {
        if (batal || !res) return;
        setTemuanLain(
          (res.data?.temuan || []).filter((t) => Number(t.dashboardId) !== Number(dashboard.id))
        );
      })
      .catch(() => {});

    return () => {
      batal = true;
    };
  }, [dashboard?.id]);
```

Tambah state-nya di dekat state lain:

```javascript
  const [temuanLain, setTemuanLain] = useState([]);
```

- [ ] **Step 2: Tampilkan apa yang diingat**

Sisipkan di atas daftar pesan, hanya bila ada temuan:

```jsx
        {temuanLain.length > 0 && (
          <div className="mb-3 rounded-lg border border-cimoryBlue/20 bg-cimoryBlue/5 p-2">
            <p className="text-[11px] font-medium text-cimoryBlue">
              Yang saya ingat dari dashboard lain
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-gray-600">
              {temuanLain.map((t) => (
                <li key={t.dashboardId}>
                  <span className="font-medium">{t.dashboardTitle}</span> ({t.umurJam} jam lalu):{" "}
                  {t.ringkasan}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-gray-500">
              Ini dipakai untuk mengaitkan analisa antar dashboard. Kalau ada yang keliru,
              sebutkan saja di pertanyaan berikutnya.
            </p>
          </div>
        )}
```

- [ ] **Step 3: Build dan jalankan penjaga teks**

```bash
cd frontend && npx vite build 2>&1 | tail -2 && npm test 2>&1 | tail -3
```

Expected: build sukses, `4 passed, 0 failed`. Bila penjaga emoji atau tanda pisah panjang gagal, teks yang baru ditambahkan memuat yang dilarang.

- [ ] **Step 4: Periksa manual di browser**

1. Login, buka satu dashboard, tanya sesuatu ke CODE AI sampai dijawab.
2. Buka dashboard LAIN, buka panel CODE AI.
3. Blok "Yang saya ingat dari dashboard lain" harus muncul dengan ringkasan dashboard pertama.
4. Tanyakan sesuatu yang berkaitan; jawabannya harus menyebut dashboard sumber ketika memakai angka dari dashboard pertama.
5. Tanyakan sesuatu yang datanya tidak ada di dashboard itu; jawabannya harus menyebut dashboard yang tepat plus tawaran menjawab langsung.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AskAIPanel.jsx
git commit -m "feat(ai): panel CODE AI memanggil penyaringan dan menampilkan yang diingat

Penyaringan dipicu saat panel dibuka, bukan saat user bertanya, supaya
latensinya tidak terasa di pertanyaan pertama setiap dashboard baru.

Kegagalan penyaringan diabaikan dengan sengaja: user tidak meminta penyaringan
ini dan chat tetap jalan tanpa memori, jadi menampilkan error hanya
membingungkan.

Blok yang saya ingat ditampilkan karena memori yang tidak terlihat tidak bisa
dipercaya. User harus bisa melihat apa yang diingat CODE AI tentang analisanya,
dan diberi tahu cara mengoreksinya."
```

---

## Self-Review

**1. Cakupan spec.** Setiap bagian spec punya tugasnya:

| Bagian spec | Tugas |
|---|---|
| §4 Model data | Task 1 |
| §5 Daur hidup dan pemicu | Task 4 |
| §6 Blok konteks temuan | Task 3, disambung Task 5 |
| §7 Pengalihan dashboard | Task 6 |
| §8 Bahasa lebih santai | Task 7 |
| §9 Balasan di luar data | Task 7 |
| §10 Penjagaan dan pengujian | tersebar: batas karakter Task 2 dan 3, jendela WIB Task 1, isolasi user Task 1, sumber angka Task 3 |
| Endpoint `GET /api/ai/finding` | Task 4, ditampilkan Task 8 |

**2. Placeholder.** Tidak ada TBD, TODO, atau "serupa Task N". Semua kode ditulis penuh.

**3. Konsistensi tipe.** Nama yang dipakai lintas tugas: `simpanTemuan`, `temuanAktif`, `turnTerakhirTersaring`, `hapusTemuan` (Task 1); `instruksiPenyaring`, `susunPermintaanPenyaring`, `bacaHasilPenyaring` (Task 2); `susunKonteksTemuan`, `aturanTemuanUntukInstruksi`, `BATAS_KONTEKS_TEMUAN` (Task 3); `ringkasKatalogUntukPengalihan`, `aturanPengalihanUntukInstruksi` (Task 6); `aturanGayaSantai`, `susunBalasanDiLuarKonteks` (Task 7). Bentuk keluaran `temuanAktif` dipakai apa adanya oleh Task 3 dan Task 8: `{dashboardId, dashboardTitle, ringkasan, angka, belumTerjawab, umurJam}`.

**4. Catatan untuk pelaksana.** Task 4 memakai `sql`, `askGemini`, `AiModel`, `resolveKey`, `getUser`, dan `getCatalogForUser` yang SUDAH ada di `aiController.js`. Jangan mengimpornya ulang; periksa kepala berkas lebih dulu.
