# CODE AI Efficiency, Fase A dan B, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menjawab pertanyaan yang jawabannya sudah ada di data snapshot atau di berkas glosarium tanpa memanggil Gemini sama sekali, dan mengukur seberapa sering itu terjadi.

**Architecture:** Sebuah `aiLocalAnswer.js` mengenali maksud pertanyaan lewat pola deterministik, lalu menyusun jawaban dari statistik yang sudah dihitung `tabular.js`. Dipanggil di controller sebelum cache dan sebelum pemilihan tier. Kalau pengenalnya tidak yakin, ia menolak menjawab dan pertanyaan berjalan seperti biasa ke Gemini. Dua kolom baru di `ai_chat_logs` membuat cakupannya bisa dihitung, bukan diperdebatkan.

**Tech Stack:** Node 18+ ESM, Express 4, MySQL via `mysql2`, React 18. Tidak ada dependensi baru.

## Global Constraints

Dari `docs/CODE-AI-EFFICIENCY-V2.md` §2.3, ditetapkan sebagai syarat keamanan fitur ini:

- **Ambang keyakinan.** Kolom ambigu, dua kolom numerik sama-sama cocok, atau entitas tidak ditemukan berarti **jangan dijawab lokal**. Satu jawaban salah lebih mahal daripada satu panggilan API.
- **Kata pemicu analitis membatalkan jalur lokal.** "kenapa", "mengapa", "bandingkan", "vs", "tren", "rekomendasi", "menurutmu", "rca", "root cause", "analisa", "summary", "jelaskan" langsung ke AI walaupun ada angka yang cocok. *"Kenapa total downtime naik?"* mengandung "total" tetapi yang diminta bukan angkanya.
- **Jawaban lokal ditandai jelas di UI.** Badge yang menyebut jawaban berasal dari data dashboard dan tidak memakai kuota. User berhak tahu kapan yang menjawab bukan AI.
- **Selalu sertakan konteks filter**, sama seperti jawaban AI, supaya angkanya tidak salah dibaca.
- **Tombol lanjut ke AI** di bawah jawaban lokal, supaya user bisa naik satu langkah tanpa mengetik ulang.

Batasan proyek yang tetap berlaku:

- **Tidak ada emoji sebagai ikon, tidak ada em dash di teks yang dibaca user.** Dijaga `frontend/tests/text-constraints.test.mjs`; keempat kuotanya nol dan tidak boleh naik.
- **Migrasi dijaga `information_schema` + `PREPARE`/`EXECUTE`.** `IF NOT EXISTS` adalah sintaks MariaDB dan gagal diam-diam di MySQL.
- **Route `/api` baru wajib terdaftar di `ROUTE_CLASSIFICATION`** (`backend/src/routeInventory.js`), kalau tidak `npm test` gagal.
- **Test tidak boleh menyentuh data user nyata.** Akun sekali pakai yang dibuat dan dihapus sendiri, atau id hantu `999999`.
- **`ai_chat_logs.user_id` punya foreign key ke `users(id)`.** Id hantu `999999` TIDAK bisa dipakai di sana: insert-nya gagal dengan `ER_NO_REFERENCED_ROW_2`. Pakai id user yang benar-benar ada, dan hapus barisnya setelah selesai. `dashboard_id` tidak punya kendala itu, jadi `999999` aman untuk kolom tersebut.
- Backend dijalankan ulang manual setelah mengubah `src/` sebelum `npm test`; test menembak server di `http://localhost:5050`.
- Branch kerja: buat `feat/ai-efficiency` dari `feat/uiux`.

## Dua gaya penamaan hidup bersebelahan di kode ini

Bukan kelalaian, dan penting supaya tidak saling tertukar:

| Tempat | Gaya | Contoh |
|---|---|---|
| Body request dan balasan `meta` | camelCase | `dashboardId`, `answeredLocally`, `keySource` |
| Argumen `AiModel.logChat` dan kolom database | snake_case | `dashboard_id`, `answered_locally`, `key_source` |

`logChat` mendestruktur argumennya dengan nama kolom apa adanya. Mengirim
`answeredLocally` ke sana tidak melempar error, hanya diabaikan, dan kolomnya
diam-diam berisi 0. Itu jenis kesalahan yang tidak terlihat sampai
`GET /api/ai/coverage` melaporkan 0 persen dan tidak ada yang tahu kenapa.

## Yang sengaja tidak dikerjakan

- **Fase C (JSON mode selektif).** Dampaknya disebut "kecil" oleh rencananya sendiri.
- **Fase D (precomputed insight).** Rencananya mensyaratkan 2 minggu data pemakaian nyata; `ai_chat_logs` baru 125 baris dan mayoritas dari pengujian.
- **Lapisan data DAX/REST.** Keputusan terbuka §9 butir 1, milik pemilik sistem.

---

### Task 1: Pengenal intent

Bagian yang paling menentukan. Dibangun lebih dulu dan diuji sendiri, tanpa menyentuh controller, supaya salah kenal bisa ditemukan sebelum ia bisa menjawab siapa pun.

**Files:**
- Create: `backend/src/services/aiIntent.js`
- Test: `backend/tests/ai-intent.test.mjs`

**Interfaces:**
- Produces: `classifyIntent(question)` mengembalikan
  `{ intent, arah, n, entitas, kolomDiminta }`
  - `intent`: `"TOTAL" | "MAX" | "MIN" | "TOP_N" | "AVG" | "COUNT" | "VALUE_OF" | "SHARE" | "FILTER_STATE" | "GLOSSARY" | "ANALYTICAL" | "UNKNOWN"`
  - `arah`: `"tertinggi" | "terendah" | null`
  - `n`: angka untuk `TOP_N`, atau `null`
  - `entitas`: string untuk `VALUE_OF` dan `SHARE`, atau `null`
  - `kolomDiminta`: petunjuk nama kolom dari pertanyaan, atau `null`
- `"ANALYTICAL"` berarti pertanyaan wajib ke AI. Ini keputusan, bukan kegagalan.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-intent.test.mjs`. Kasusnya diambil dari `ai_chat_logs` nyata, bukan dikarang:

```js
import { ok, section } from "./harness.mjs";
import { classifyIntent } from "../src/services/aiIntent.js";

// Pertanyaan di bawah ini diambil apa adanya dari ai_chat_logs, termasuk
// salah ketiknya. Pengenal harus bertahan menghadapi tulisan user sebenarnya,
// bukan hanya kalimat rapi.

section("Pertanyaan angka murni dikenali");

const angka = [
  ["Berapa total downtime?", "TOTAL"],
  ["Berapa total downtime-nya?", "TOTAL"],
  ["Berapa total biaya downtime bulan Juli 2026?", "TOTAL"],
  ["Line mana yang downtime-nya paling tinggi?", "MAX"],
  ["Downtime pada mesin mana yang paling tinggi durasinya", "MAX"],
  ["rata-rata OEE berapa?", "AVG"],
  ["ada berapa mesin?", "COUNT"],
  ["filter apa yang aktif sekarang?", "FILTER_STATE"],
];
for (const [q, harap] of angka) {
  const hasil = classifyIntent(q);
  ok(`"${q.slice(0, 44)}" -> ${harap}`, hasil.intent === harap, `dapat ${hasil.intent}`);
}

section("TOP_N membaca jumlah dan arahnya");

const t1 = classifyIntent("top 3 mesin dengan technical downtime tertinggi terjadi pada mesin mana saja?");
ok("top 3 dikenali TOP_N", t1.intent === "TOP_N", `dapat ${t1.intent}`);
ok("n = 3", t1.n === 3, `dapat ${t1.n}`);
ok("arah tertinggi", t1.arah === "tertinggi", `dapat ${t1.arah}`);

const t2 = classifyIntent("Berikan top 3 produk dengan %PO paling rendah pada bulan juli");
ok("paling rendah -> arah terendah", t2.arah === "terendah", `dapat ${t2.arah}`);

section("Kata analitis membatalkan jalur lokal");

// Semua ini MENGANDUNG kata angka, tapi yang diminta bukan angkanya.
const analitis = [
  "Kenapa downtime naik drastis bulan ini?",
  "Kenapa downtime tinggi di beberapa mesin? Beri rekomendasi.",
  "mengapa OEE evergreen sangat rendah, berikan RCA dan rekomendasinya",
  "Coba analisa root cause dari top 3 downtime serac line 2",
  "Berikan top 3 line dengan downtime tertinggi pada Q1 vs Q2",
  "Summary kan informasi terkait dashboard ini",
  "Coba analisa mengapa otir di bulan juli ini terjadi delay ataupun hold",
];
for (const q of analitis) {
  const hasil = classifyIntent(q);
  ok(`analitis: "${q.slice(0, 44)}"`, hasil.intent === "ANALYTICAL", `dapat ${hasil.intent}`);
}

section("Glosarium dikenali");

for (const q of ["Apa itu MTBF?", "MTBF itu artinya apa ya", "Kalo OEE itu apa?", "Apa itu MTBF dan MTTR? Bedanya apa?"]) {
  const hasil = classifyIntent(q);
  ok(`glosarium: "${q}"`, hasil.intent === "GLOSSARY", `dapat ${hasil.intent}`);
}

section("VALUE_OF membawa entitasnya");

const v = classifyIntent("downtime mesin serac 2 bulan juli berapa durasinya ya?");
ok("dikenali VALUE_OF", v.intent === "VALUE_OF", `dapat ${v.intent}`);
ok("entitas terbaca", Boolean(v.entitas) && /serac/i.test(v.entitas), `dapat ${JSON.stringify(v.entitas)}`);

section("Yang tidak dikenali tetap UNKNOWN, bukan dipaksakan");

for (const q of ["", "asdkjhasd", "Gimana cara export data to excel dari visual dashboard Power BI?"]) {
  const hasil = classifyIntent(q);
  ok(`bukan intent angka: "${q.slice(0, 40)}"`,
    !["TOTAL", "MAX", "MIN", "TOP_N", "AVG", "COUNT", "VALUE_OF", "SHARE"].includes(hasil.intent),
    `dapat ${hasil.intent}`);
}
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `cd backend && node tests/ai-intent.test.mjs`
Expected: gagal dengan `Cannot find module` karena `aiIntent.js` belum ada.

- [ ] **Step 3: Tulis pengenalnya**

Buat `backend/src/services/aiIntent.js`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Pengenal maksud pertanyaan, deterministik, tanpa panggilan API.
//
// Urutan pemeriksaan penting: kata analitis diperiksa PALING AWAL. Pertanyaan
// "kenapa total downtime naik?" mengandung kata "total", dan kalau TOTAL
// diperiksa lebih dulu, ia akan dijawab dengan satu angka padahal yang diminta
// penjelasan. Salah menjawab lebih mahal daripada satu panggilan API.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kata yang menandakan user meminta interpretasi, bukan angka.
 *
 * Diambil dari pertanyaan nyata di ai_chat_logs. "vs" masuk karena
 * perbandingan dua periode bukan pekerjaan template.
 */
const KATA_ANALITIS = [
  "kenapa", "mengapa", "kok ", "penyebab", "akar masalah", "root cause", "rca",
  "analisa", "analisis", "bandingkan", "perbandingan", " vs ", " vs.", "versus",
  "tren", "trend", "rekomendasi", "saran", "menurutmu", "menurut kamu",
  "summary", "summarykan", "summary kan", "ringkas", "jelaskan", "jelasin",
  "insight", "evaluasi", "kesimpulan", "prediksi", "forecast",
];

const POLA_GLOSARIUM = [
  /\bapa\s+(?:itu|arti|maksud)\b/i,
  /\bartinya\s+apa\b/i,
  /\bitu\s+apa\b/i,
  /\bkepanjangan\b/i,
  /\bsingkatan\s+dari\b/i,
];

const POLA_FILTER = [
  /\bfilter\s+(?:apa|mana|yang)\b/i,
  /\bfilter\s+aktif\b/i,
  /\bslicer\b/i,
];

/** "3" dari "top 3", "5 besar", "3 teratas". */
function bacaN(t) {
  const m =
    t.match(/\btop\s*(\d{1,2})\b/i) ||
    t.match(/\b(\d{1,2})\s*(?:besar|teratas|terbawah|tertinggi|terendah)\b/i);
  if (m) return Number(m[1]);
  if (/\btop\b/i.test(t)) return 3; // "top mesin downtime" tanpa angka
  return null;
}

function bacaArah(t) {
  if (/\b(?:paling\s+rendah|terendah|terkecil|paling\s+kecil|paling\s+sedikit|minimum|terbawah)\b/i.test(t)) {
    return "terendah";
  }
  if (/\b(?:paling\s+tinggi|tertinggi|terbesar|paling\s+besar|paling\s+banyak|maksimum|teratas|paling\s+lama)\b/i.test(t)) {
    return "tertinggi";
  }
  return null;
}

/**
 * Entitas untuk VALUE_OF: nama mesin, lini, atau produk yang disebut.
 *
 * Diambil dari pola "mesin X", "line X", "lini X". Sengaja sempit: menebak
 * entitas dari kata bebas menghasilkan pencarian baris yang salah, dan lebih
 * baik menyerahkannya ke AI daripada menjawab baris yang bukan diminta.
 */
function bacaEntitas(t) {
  const m = t.match(/\b(?:mesin|line|lini|produk|customer|pelanggan)\s+([\p{L}\p{N}][\p{L}\p{N}\s.-]{0,24})/iu);
  if (!m) return null;
  const nilai = m[1]
    .replace(/\b(?:bulan|tahun|berapa|durasinya|ya|dong|itu|pada|di|yang|paling)\b.*$/i, "")
    .trim();
  return nilai.length >= 2 ? nilai : null;
}

/** Petunjuk nama kolom, dipakai untuk memilih kolom numerik yang tepat. */
function bacaKolom(t) {
  const m = t.match(/\bkolom\s+([\p{L}\p{N}][\p{L}\p{N}\s()%.-]{0,30})/iu);
  return m ? m[1].trim() : null;
}

/**
 * @param {string} question
 * @returns {{intent: string, arah: string|null, n: number|null, entitas: string|null, kolomDiminta: string|null}}
 */
export function classifyIntent(question) {
  const asli = String(question || "");
  const t = ` ${asli.toLowerCase().replace(/\s+/g, " ").trim()} `;

  const kosong = {
    intent: "UNKNOWN", arah: null, n: null, entitas: null, kolomDiminta: null,
  };
  if (!t.trim()) return kosong;

  // PALING AWAL. Lihat komentar di kepala berkas.
  if (KATA_ANALITIS.some((k) => t.includes(k))) {
    return { ...kosong, intent: "ANALYTICAL" };
  }

  if (POLA_GLOSARIUM.some((p) => p.test(asli))) {
    return { ...kosong, intent: "GLOSSARY" };
  }

  if (POLA_FILTER.some((p) => p.test(asli))) {
    return { ...kosong, intent: "FILTER_STATE" };
  }

  const arah = bacaArah(t);
  const n = bacaN(t);
  const entitas = bacaEntitas(t);
  const kolomDiminta = bacaKolom(t);
  const dasar = { arah, n, entitas, kolomDiminta };

  // TOP_N diperiksa sebelum MAX: "top 3 tertinggi" adalah daftar, bukan satu.
  if (n !== null && arah) return { ...dasar, intent: "TOP_N" };

  if (/\b(?:rata-rata|rata rata|average|avg|mean)\b/i.test(t)) {
    return { ...dasar, intent: "AVG" };
  }

  if (/\b(?:ada\s+berapa|berapa\s+(?:banyak|jumlah)|jumlah\s+(?:mesin|line|lini|baris|item)|hitung\s+berapa)\b/i.test(t)) {
    return { ...dasar, intent: "COUNT" };
  }

  if (/\b(?:berapa\s+persen|persentase|kontribusi|menyumbang|share|porsi)\b/i.test(t)) {
    return { ...dasar, intent: "SHARE" };
  }

  // "mesin mana", "line mana" + arah -> satu pemenang.
  if (arah && /\b(?:mana|siapa)\b/i.test(t)) {
    return { ...dasar, intent: arah === "terendah" ? "MIN" : "MAX" };
  }

  // Entitas + "berapa" -> nilai satu baris.
  if (entitas && /\bberapa\b/i.test(t)) {
    return { ...dasar, intent: "VALUE_OF" };
  }

  if (/\b(?:total|jumlah|keseluruhan|akumulasi)\b/i.test(t)) {
    return { ...dasar, intent: "TOTAL" };
  }

  if (arah) return { ...dasar, intent: arah === "terendah" ? "MIN" : "MAX" };

  return kosong;
}
```

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `cd backend && node tests/ai-intent.test.mjs`
Expected: seluruhnya PASS.

Bila ada yang gagal, **perbaiki pengenalnya, jangan melunakkan ujinya**. Kasus uji berasal dari pertanyaan nyata; mengubah harapan agar cocok dengan kode berarti membuang satu-satunya bukti yang kita punya.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/aiIntent.js backend/tests/ai-intent.test.mjs
git commit -m "feat(ai): recognise question intent without calling the model"
```

---

### Task 2: Penjawab lokal

**Files:**
- Create: `backend/src/services/aiLocalAnswer.js`
- Test: `backend/tests/ai-local-answer.test.mjs`

**Interfaces:**
- Consumes: `classifyIntent` dari Task 1; `columnStats`, `detectNumericColumns`, `pickRankColumn`, `pickGroupColumn`, `parseNumber` dari `services/tabular.js`; `getGlossaryRows` dari `services/aiKnowledge.js`
- Produces: `tryAnswerLocally({ question, snapshot, dashboard })` mengembalikan
  `{ answered: true, text, intent, confidence }` atau `{ answered: false, reason, intent }`
  - `confidence`: angka 0 sampai 1. Di bawah `0.7` diperlakukan sebagai tidak terjawab oleh controller.
  - `snapshot` berbentuk `{ visuals: [{ title, columns, rows, rowCount }], filters: [], pagesRead: [] }`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-local-answer.test.mjs`:

```js
import { ok, section } from "./harness.mjs";
import { tryAnswerLocally } from "../src/services/aiLocalAnswer.js";

// Snapshot tiruan yang bentuknya sama dengan yang dikirim frontend.
const snapshot = {
  filters: ["Bulan is Juli 2026"],
  pagesRead: ["OEE & Downtime"],
  visuals: [
    {
      title: "Downtime per Mesin",
      columns: ["Mesin", "Downtime (Jam)"],
      rows: [
        ["ABP Line 2", "12,5"],
        ["Serac 2", "8"],
        ["Filler A", "3,5"],
        ["Capper B", "1"],
      ],
      rowCount: 4,
    },
  ],
};

const dashboard = { id: 1, title: "OEE & Downtime", department: "Plant" };

section("TOTAL dijawab dari statistik");

const total = tryAnswerLocally({ question: "Berapa total downtime?", snapshot, dashboard });
ok("terjawab", total.answered === true, JSON.stringify(total));
ok("intent TOTAL", total.intent === "TOTAL", total.intent);
// 12,5 + 8 + 3,5 + 1 = 25
ok("angkanya benar", /\b25\b/.test(total.text), total.text);
ok("menyertakan konteks filter", /Juli 2026/.test(total.text), total.text);

section("MAX menyebut baris pemenang");

const max = tryAnswerLocally({ question: "Mesin mana yang downtime paling tinggi?", snapshot, dashboard });
ok("terjawab", max.answered === true, JSON.stringify(max));
ok("menyebut ABP Line 2", /ABP Line 2/i.test(max.text), max.text);
ok("menyebut 12,5 atau 12.5", /12[.,]5/.test(max.text), max.text);

section("TOP_N mengembalikan N baris teratas");

const top = tryAnswerLocally({ question: "top 3 mesin downtime tertinggi", snapshot, dashboard });
ok("terjawab", top.answered === true, JSON.stringify(top));
ok("memuat tiga nama teratas",
  /ABP Line 2/i.test(top.text) && /Serac 2/i.test(top.text) && /Filler A/i.test(top.text), top.text);
ok("tidak memuat yang keempat", !/Capper B/i.test(top.text), top.text);

section("AVG dan COUNT");

const avg = tryAnswerLocally({ question: "rata-rata downtime berapa?", snapshot, dashboard });
ok("AVG terjawab", avg.answered === true, JSON.stringify(avg));
ok("rata-rata 6,25", /6[.,]25/.test(avg.text), avg.text);

const count = tryAnswerLocally({ question: "ada berapa mesin?", snapshot, dashboard });
ok("COUNT terjawab", count.answered === true, JSON.stringify(count));
ok("menyebut 4", /\b4\b/.test(count.text), count.text);

section("VALUE_OF mencari barisnya");

const nilai = tryAnswerLocally({ question: "downtime mesin Serac 2 berapa?", snapshot, dashboard });
ok("terjawab", nilai.answered === true, JSON.stringify(nilai));
ok("menyebut 8", /\b8\b/.test(nilai.text), nilai.text);

const tidakAda = tryAnswerLocally({ question: "downtime mesin Tidak Ada Ini berapa?", snapshot, dashboard });
ok("entitas tidak ketemu TIDAK dijawab", tidakAda.answered === false, JSON.stringify(tidakAda));

section("FILTER_STATE menyebut filter aktif");

const filter = tryAnswerLocally({ question: "filter apa yang aktif sekarang?", snapshot, dashboard });
ok("terjawab", filter.answered === true, JSON.stringify(filter));
ok("menyebut filternya", /Juli 2026/.test(filter.text), filter.text);

section("Pertanyaan analitis DITOLAK, bukan dijawab");

for (const q of [
  "Kenapa downtime naik drastis bulan ini?",
  "Coba analisa root cause dari top 3 downtime",
  "Berikan top 3 line dengan downtime tertinggi Q1 vs Q2",
]) {
  const hasil = tryAnswerLocally({ question: q, snapshot, dashboard });
  ok(`ditolak: "${q.slice(0, 42)}"`, hasil.answered === false, JSON.stringify(hasil));
}

section("Snapshot kosong atau tanpa kolom angka ditolak");

ok("snapshot null ditolak",
  tryAnswerLocally({ question: "Berapa total downtime?", snapshot: null, dashboard }).answered === false);
ok("visual tanpa angka ditolak",
  tryAnswerLocally({
    question: "Berapa total downtime?",
    snapshot: { visuals: [{ title: "Catatan", columns: ["Keterangan"], rows: [["halo"]], rowCount: 1 }], filters: [] },
    dashboard,
  }).answered === false);

section("Dua kolom angka yang sama-sama cocok ditolak (ambigu)");

const ambigu = {
  filters: [],
  visuals: [{
    title: "Downtime",
    columns: ["Mesin", "Downtime Rencana", "Downtime Aktual"],
    rows: [["A", "5", "7"], ["B", "3", "9"]],
    rowCount: 2,
  }],
};
const hasilAmbigu = tryAnswerLocally({ question: "Berapa total downtime?", snapshot: ambigu, dashboard });
ok("kolom ambigu ditolak", hasilAmbigu.answered === false, JSON.stringify(hasilAmbigu));

section("Beberapa visual berangka: dipilih lewat kata di pertanyaan");

// Dashboard nyata hampir selalu punya lebih dari satu visual berangka. Menolak
// begitu jumlahnya lebih dari satu akan membuat fitur ini tidak pernah menyala.
const banyakVisual = {
  filters: ["Bulan is Juli 2026"],
  visuals: [
    {
      title: "Downtime per Mesin",
      columns: ["Mesin", "Downtime (Jam)"],
      rows: [["ABP Line 2", "12,5"], ["Serac 2", "8"]],
      rowCount: 2,
    },
    {
      title: "Output per Mesin",
      columns: ["Mesin", "Output (Karton)"],
      rows: [["ABP Line 2", "1000"], ["Serac 2", "2500"]],
      rowCount: 2,
    },
  ],
};

const pilihDowntime = tryAnswerLocally({ question: "Berapa total downtime?", snapshot: banyakVisual, dashboard });
ok("kata downtime memilih visual downtime", pilihDowntime.answered === true, JSON.stringify(pilihDowntime));
ok("angkanya 20,5", /20[.,]5/.test(pilihDowntime.text), pilihDowntime.text);

const pilihOutput = tryAnswerLocally({ question: "Berapa total output?", snapshot: banyakVisual, dashboard });
ok("kata output memilih visual output", pilihOutput.answered === true, JSON.stringify(pilihOutput));
ok("angkanya 3500", /3500/.test(pilihOutput.text), pilihOutput.text);

// Tanpa kata pembeda, tetap harus menolak.
const tanpaPetunjuk = tryAnswerLocally({ question: "Berapa totalnya?", snapshot: banyakVisual, dashboard });
ok("tanpa kata pembeda ditolak", tanpaPetunjuk.answered === false, JSON.stringify(tanpaPetunjuk));
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `cd backend && node tests/ai-local-answer.test.mjs`
Expected: gagal dengan `Cannot find module`.

- [ ] **Step 3: Tulis penjawabnya**

Buat `backend/src/services/aiLocalAnswer.js`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Menjawab pertanyaan langsung dari snapshot, tanpa memanggil Gemini.
//
// Snapshot sudah ada di backend sebagai tabel terstruktur dan statistiknya
// sudah dihitung tabular.js. Pertanyaan yang jawabannya sudah ada di angka itu
// tidak perlu dikirim ke model.
//
// Modul ini lebih sering MENOLAK daripada menjawab, dan itu memang tujuannya.
// Satu jawaban salah merusak kepercayaan pada seluruh fitur; satu panggilan API
// yang sebenarnya bisa dihindari hanya memakan kuota.
// ─────────────────────────────────────────────────────────────────────────────

import { classifyIntent } from "./aiIntent.js";
import {
  columnStats, detectNumericColumns, parseNumber, pickRankColumn,
} from "./tabular.js";
import { getGlossaryRows } from "./aiKnowledge.js";

const AMBANG = 0.7;

const fmt = (n) =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString().replace(".", ",");

function tolak(reason, intent = "UNKNOWN") {
  return { answered: false, reason, intent };
}

/** Kalimat konteks filter, supaya angkanya tidak salah dibaca. */
function konteks(snapshot) {
  const f = (snapshot?.filters || []).filter(Boolean);
  if (!f.length) return "Tanpa filter aktif.";
  return `Filter aktif: ${f.join("; ")}.`;
}

/**
 * Memilih SATU visual dan SATU kolom angka yang jelas.
 *
 * Menolak bila ada lebih dari satu kolom angka yang sama-sama masuk akal dan
 * pertanyaannya tidak menyebut kolom mana. Inilah ambang keyakinan yang
 * dimaksud spec: menebak kolom berarti menjawab pertanyaan yang tidak ditanya.
 */
/** Kata yang tidak membedakan apa pun, jadi tidak dipakai mencocokkan kolom. */
const KATA_UMUM = new Set([
  "berapa", "total", "jumlah", "yang", "mana", "paling", "tertinggi", "terendah",
  "rata", "ratarata", "average", "top", "dari", "pada", "untuk", "dan", "atau",
  "adalah", "itu", "ini", "di", "ke", "nya", "apa", "saja", "bulan", "tahun",
  "mesin", "line", "lini", "data", "dashboard", "visual", "kolom", "tabel",
]);

/** Kata bermakna dari pertanyaan, dipakai mencocokkan nama kolom atau visual. */
function kataKunci(question) {
  return String(question || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !KATA_UMUM.has(w));
}

/**
 * Memilih SATU visual dan SATU kolom angka yang jelas.
 *
 * Dashboard nyata hampir selalu punya beberapa visual berangka, jadi menolak
 * begitu jumlahnya lebih dari satu akan membuat penjawab ini praktis tidak
 * pernah menyala. Yang dilakukan: cocokkan kata bermakna dari pertanyaan ke
 * nama kolom dan judul visual. Kalau tepat SATU yang cocok, itu jawabannya.
 * Kalau nol atau lebih dari satu, barulah menolak.
 *
 * Inilah ambang keyakinan yang dimaksud spec: menebak kolom berarti menjawab
 * pertanyaan yang tidak ditanya.
 */
function pilihTarget(snapshot, kolomDiminta, question) {
  const visuals = (snapshot?.visuals || []).filter(
    (v) => Array.isArray(v?.rows) && v.rows.length > 0 && Array.isArray(v?.columns)
  );
  if (!visuals.length) return { error: "snapshot tidak punya visual berisi baris" };

  // Setiap pasangan (visual, kolom angka) adalah satu kandidat jawaban.
  const kandidat = [];
  for (const visual of visuals) {
    const numericIdx = detectNumericColumns(visual.columns, visual.rows);
    for (const idx of numericIdx) {
      kandidat.push({ visual, valueIdx: idx, numericIdx });
    }
  }
  if (!kandidat.length) return { error: "tidak ada kolom angka" };

  // Satu-satunya kandidat: tidak ada yang bisa salah pilih.
  if (kandidat.length === 1) return lengkapi(kandidat[0]);

  // Petunjuk eksplisit "kolom X" paling kuat.
  if (kolomDiminta) {
    const cari = kolomDiminta.toLowerCase();
    const cocok = kandidat.filter((k) =>
      String(k.visual.columns[k.valueIdx]).toLowerCase().includes(cari)
    );
    if (cocok.length === 1) return lengkapi(cocok[0]);
    return { error: `nama kolom "${kolomDiminta}" cocok ke ${cocok.length} kandidat` };
  }

  // Cocokkan kata bermakna pertanyaan ke nama kolom, lalu ke judul visual.
  const kata = kataKunci(question);
  if (!kata.length) {
    return { error: `${kandidat.length} kandidat dan pertanyaan tidak menyebut metriknya` };
  }

  const cocokKolom = kandidat.filter((k) => {
    const nama = String(k.visual.columns[k.valueIdx]).toLowerCase();
    return kata.some((w) => nama.includes(w));
  });
  if (cocokKolom.length === 1) return lengkapi(cocokKolom[0]);

  if (cocokKolom.length === 0) {
    const cocokVisual = kandidat.filter((k) => {
      const judul = String(k.visual.title || "").toLowerCase();
      return kata.some((w) => judul.includes(w));
    });
    // Judul visual cocok DAN visual itu hanya punya satu kolom angka.
    if (cocokVisual.length === 1) return lengkapi(cocokVisual[0]);
    return { error: "tidak ada kolom atau visual yang cocok dengan pertanyaan" };
  }

  return { error: `pertanyaan cocok ke ${cocokKolom.length} kolom angka sekaligus` };
}

/** Melengkapi kandidat dengan kolom label untuk menyebut nama barisnya. */
function lengkapi({ visual, valueIdx, numericIdx }) {
  const labelIdx = visual.columns.findIndex((_, i) => !numericIdx.includes(i));
  return { visual, valueIdx, labelIdx: labelIdx === -1 ? null : labelIdx };
}

function barisTerurut(visual, valueIdx, arah) {
  const isi = visual.rows
    .map((r) => ({ row: r, n: parseNumber(r?.[valueIdx]) }))
    .filter((x) => Number.isFinite(x.n));
  isi.sort((a, b) => (arah === "terendah" ? a.n - b.n : b.n - a.n));
  return isi;
}

/**
 * @param {{question: string, snapshot: object, dashboard: object}} arg
 * @returns {{answered: true, text: string, intent: string, confidence: number}
 *          |{answered: false, reason: string, intent: string}}
 */
export function tryAnswerLocally({ question, snapshot, dashboard }) {
  const { intent, arah, n, entitas, kolomDiminta } = classifyIntent(question);

  if (intent === "ANALYTICAL") return tolak("pertanyaan meminta interpretasi", intent);
  if (intent === "UNKNOWN") return tolak("maksud pertanyaan tidak dikenali", intent);

  // ── Glosarium: jawabannya ada di berkas pengetahuan, bukan di snapshot ────
  if (intent === "GLOSSARY") {
    const istilah = (String(question).match(/\b[A-Z]{2,6}\b/g) || []).map((s) => s.toUpperCase());
    if (!istilah.length) return tolak("tidak ada singkatan yang bisa dicari", intent);

    const baris = getGlossaryRows(200);
    const ketemu = [];
    for (const t of istilah) {
      const cocok = baris.filter((b) => new RegExp(`\\b${t}\\b`, "i").test(String(b)));
      if (cocok.length) ketemu.push(cocok[0]);
    }
    if (!ketemu.length) return tolak("istilah tidak ada di glosarium", intent);

    return {
      answered: true,
      intent,
      confidence: 0.9,
      text: ketemu.join("\n"),
    };
  }

  // ── FILTER_STATE: tidak butuh kolom angka ────────────────────────────────
  if (intent === "FILTER_STATE") {
    const f = (snapshot?.filters || []).filter(Boolean);
    const halaman = (snapshot?.pagesRead || []).filter(Boolean);
    if (!f.length && !halaman.length) return tolak("snapshot tidak membawa filter", intent);
    const bagian = [];
    if (f.length) bagian.push(`Filter aktif: ${f.join("; ")}.`);
    else bagian.push("Tidak ada filter aktif.");
    if (halaman.length) bagian.push(`Halaman yang dibaca: ${halaman.join(", ")}.`);
    return { answered: true, intent, confidence: 0.95, text: bagian.join(" ") };
  }

  const target = pilihTarget(snapshot, kolomDiminta, question);
  if (target.error) return tolak(target.error, intent);

  const { visual, valueIdx, labelIdx } = target;
  const namaKolom = String(visual.columns[valueIdx]);
  const stats = columnStats(visual.rows, valueIdx);
  if (!stats) return tolak("kolom angka tidak punya nilai terbaca", intent);

  const ekor = konteks(snapshot);
  const sumber = `Dihitung dari ${stats.count} baris pada visual "${visual.title || "tanpa judul"}".`;

  if (intent === "TOTAL") {
    return {
      answered: true, intent, confidence: 0.9,
      text: `Total ${namaKolom} adalah ${fmt(stats.total)}. ${sumber} ${ekor}`,
    };
  }

  if (intent === "AVG") {
    return {
      answered: true, intent, confidence: 0.9,
      text: `Rata-rata ${namaKolom} adalah ${fmt(stats.mean)}, dengan median ${fmt(stats.median)}. ${sumber} ${ekor}`,
    };
  }

  if (intent === "COUNT") {
    return {
      answered: true, intent, confidence: 0.85,
      text: `Ada ${visual.rows.length} baris pada visual "${visual.title || "tanpa judul"}". ${ekor}`,
    };
  }

  if (intent === "MAX" || intent === "MIN") {
    if (labelIdx === null) return tolak("tidak ada kolom label untuk menyebut pemenangnya", intent);
    const urut = barisTerurut(visual, valueIdx, intent === "MIN" ? "terendah" : "tertinggi");
    if (!urut.length) return tolak("tidak ada baris dengan angka", intent);
    const juara = urut[0];
    const kata = intent === "MIN" ? "terendah" : "tertinggi";
    return {
      answered: true, intent, confidence: 0.85,
      text: `${namaKolom} ${kata} ada pada ${String(juara.row[labelIdx])}, yaitu ${fmt(juara.n)}. ${sumber} ${ekor}`,
    };
  }

  if (intent === "TOP_N") {
    if (labelIdx === null) return tolak("tidak ada kolom label untuk didaftar", intent);
    const jumlah = Math.min(n || 3, 10);
    const urut = barisTerurut(visual, valueIdx, arah === "terendah" ? "terendah" : "tertinggi");
    if (urut.length < 2) return tolak("baris terlalu sedikit untuk sebuah daftar", intent);
    const dipakai = urut.slice(0, jumlah);
    const daftar = dipakai
      .map((x, i) => `${i + 1}. ${String(x.row[labelIdx])}: ${fmt(x.n)}`)
      .join("\n");
    const kata = arah === "terendah" ? "terendah" : "tertinggi";
    return {
      answered: true, intent, confidence: 0.85,
      text: `${jumlah} ${namaKolom} ${kata}:\n${daftar}\n${sumber} ${ekor}`,
    };
  }

  if (intent === "VALUE_OF") {
    if (labelIdx === null || !entitas) return tolak("entitas atau kolom label tidak ada", intent);
    const cari = entitas.toLowerCase();
    const cocok = visual.rows.filter((r) => String(r?.[labelIdx] ?? "").toLowerCase().includes(cari));
    if (cocok.length === 0) return tolak(`entitas "${entitas}" tidak ada di data`, intent);
    if (cocok.length > 1) return tolak(`entitas "${entitas}" cocok ke ${cocok.length} baris`, intent);
    const nilai = parseNumber(cocok[0][valueIdx]);
    if (!Number.isFinite(nilai)) return tolak("nilai baris tidak terbaca sebagai angka", intent);
    return {
      answered: true, intent, confidence: 0.85,
      text: `${namaKolom} untuk ${String(cocok[0][labelIdx])} adalah ${fmt(nilai)}. ${ekor}`,
    };
  }

  if (intent === "SHARE") {
    if (labelIdx === null || !entitas) return tolak("entitas atau kolom label tidak ada", intent);
    const cari = entitas.toLowerCase();
    const cocok = visual.rows.filter((r) => String(r?.[labelIdx] ?? "").toLowerCase().includes(cari));
    if (cocok.length !== 1) return tolak("entitas tidak cocok tepat satu baris", intent);
    const nilai = parseNumber(cocok[0][valueIdx]);
    if (!Number.isFinite(nilai) || !stats.total) return tolak("tidak bisa menghitung porsi", intent);
    const persen = (nilai / stats.total) * 100;
    return {
      answered: true, intent, confidence: 0.8,
      text: `${String(cocok[0][labelIdx])} menyumbang ${fmt(persen)} persen dari total ${namaKolom} (${fmt(nilai)} dari ${fmt(stats.total)}). ${ekor}`,
    };
  }

  return tolak("intent dikenali tapi belum ada perendernya", intent);
}

export { AMBANG as AMBANG_KEYAKINAN };
```

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `cd backend && node tests/ai-local-answer.test.mjs`
Expected: seluruhnya PASS.

- [ ] **Step 5: Buktikan ia menolak lebih sering daripada memaksa**

Uji ini yang menjaga sifat terpenting modul. Tambahkan ke akhir berkas uji:

```js
section("Sifat: lebih baik menolak daripada salah");

// Snapshot dengan label yang mirip satu sama lain: "Line 1" juga cocok ke
// "Line 10", sehingga pencarian entitas jadi ambigu.
const mirip = {
  filters: [],
  visuals: [{
    title: "Downtime per Line",
    columns: ["Line", "Jam"],
    rows: [["Line 1", "4"], ["Line 10", "9"], ["Line 11", "2"]],
    rowCount: 3,
  }],
};
const hasilMirip = tryAnswerLocally({ question: "downtime line 1 berapa?", snapshot: mirip, dashboard });
ok("label ambigu ditolak", hasilMirip.answered === false, JSON.stringify(hasilMirip));
```

Run: `cd backend && node tests/ai-local-answer.test.mjs`
Expected: PASS. Bila gagal, `VALUE_OF` memakai pencocokan yang terlalu longgar dan harus diperketat.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/aiLocalAnswer.js backend/tests/ai-local-answer.test.mjs
git commit -m "feat(ai): answer numeric and glossary questions from the snapshot"
```

---

### Task 3: Kolom instrumentasi di ai_chat_logs

**Files:**
- Create: `backend/migrations/add_ai_intent_columns.sql`
- Modify: `backend/src/models/aiModel.js`

**Interfaces:**
- Produces: kolom `intent VARCHAR(20) NULL` dan `answered_locally TINYINT(1) NOT NULL DEFAULT 0` pada `ai_chat_logs`; `AiModel.logChat` menerima dua field tambahan bernama `intent` dan `answered_locally`.

**Penting soal penamaan:** `logChat` memakai **snake_case** untuk seluruh
field-nya (`user_id`, `dashboard_id`, `from_cache`), bukan camelCase. Mengirim
`answeredLocally` akan diabaikan tanpa error, dan kolomnya diam-diam berisi 0.
Ikuti gaya yang sudah ada.

- [ ] **Step 1: Tulis migrasi**

Buat `backend/migrations/add_ai_intent_columns.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: kolom intent dan answered_locally di ai_chat_logs.
-- Jalankan SETELAH add_ai_usage_tracking.sql. Aman diulang.
--
-- "ADD COLUMN IF NOT EXISTS" adalah sintaks MariaDB dan gagal diam-diam di
-- MySQL, jadi penjagaan lewat information_schema.
--
-- Tanpa dua kolom ini, cakupan penjawab lokal hanya bisa ditebak. Target
-- 35-50% di rencana harus diukur, bukan diasumsikan.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs'
      AND column_name = 'intent') = 0,
  "ALTER TABLE ai_chat_logs ADD COLUMN intent VARCHAR(20) NULL",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs'
      AND column_name = 'answered_locally') = 0,
  "ALTER TABLE ai_chat_logs ADD COLUMN answered_locally TINYINT(1) NOT NULL DEFAULT 0",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
```

- [ ] **Step 2: Jalankan migrasi dan verifikasi**

Run:

```bash
cd backend && node --input-type=module -e '
import "dotenv/config"; import mysql from "mysql2/promise"; import fs from "fs";
const c = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
await c.query(fs.readFileSync("migrations/add_ai_intent_columns.sql", "utf8"));
const [cols] = await c.query("SHOW COLUMNS FROM ai_chat_logs LIKE ?", ["%intent%"]);
const [cols2] = await c.query("SHOW COLUMNS FROM ai_chat_logs LIKE ?", ["answered_locally"]);
console.log([...cols, ...cols2].map(x => x.Field + " " + x.Type).join(" | "));
await c.end();'
```

Expected: `intent varchar(20) | answered_locally tinyint(1)`

Jalankan sekali lagi perintah yang sama untuk memastikan aman diulang. Expected: keluaran sama, tanpa error.

- [ ] **Step 3: Terima dua field baru di logChat**

Di `backend/src/models/aiModel.js`, ganti isi `logChat` menjadi:

```js
  async logChat(entry) {
    const {
      user_id,
      dashboard_id = null,
      dashboard_title = null,
      question,
      answer = null,
      model = null,
      key_source = null,
      visuals_used = null,
      rows_used = null,
      prompt_chars = null,
      error = null,
      tier = null,
      prompt_tokens = null,
      output_tokens = null,
      total_tokens = null,
      from_cache = 0,
      // Fase A: dipakai menghitung berapa sering jawaban tidak memanggil model.
      intent = null,
      answered_locally = 0,
    } = entry;

    const [res] = await sql.query(
      `INSERT INTO ai_chat_logs
         (user_id, dashboard_id, dashboard_title, question, answer, model,
          key_source, visuals_used, rows_used, prompt_chars, error,
          tier, prompt_tokens, output_tokens, total_tokens, from_cache,
          intent, answered_locally)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id, dashboard_id, dashboard_title, question, answer, model,
        key_source, visuals_used, rows_used, prompt_chars, error,
        tier, prompt_tokens, output_tokens, total_tokens, from_cache,
        intent, answered_locally ? 1 : 0,
      ]
    );
    return res.insertId;

- [ ] **Step 4: Verifikasi tulis dan baca**

Run:

```bash
cd backend && node --input-type=module -e '
import "dotenv/config";
import { AiModel } from "./src/models/aiModel.js";
import db from "./src/config/db.js";
await AiModel.logChat({
  user_id: 999999, dashboard_id: 999999, dashboard_title: "__uji_intent",
  question: "Berapa total downtime?", answer: "Total 25.", model: "local",
  key_source: "server", visuals_used: 1, rows_used: 4, prompt_chars: 0,
  tier: "lokal", from_cache: 0, intent: "TOTAL", answered_locally: 1,
});
const [rows] = await db.promise().query(
  "SELECT intent, answered_locally FROM ai_chat_logs WHERE dashboard_title = ? ORDER BY id DESC LIMIT 1",
  ["__uji_intent"]);
console.log("tersimpan:", JSON.stringify(rows[0]));
await db.promise().query("DELETE FROM ai_chat_logs WHERE dashboard_title = ?", ["__uji_intent"]);
console.log("baris uji dihapus");
process.exit(0);'
```

Expected: `tersimpan: {"intent":"TOTAL","answered_locally":1}` lalu `baris uji dihapus`.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/add_ai_intent_columns.sql backend/src/models/aiModel.js
git commit -m "feat(ai): record intent and whether the answer skipped the model"
```

---

### Task 4: Pasang penjawab lokal di controller

**Files:**
- Modify: `backend/src/controllers/aiController.js`
- Test: `backend/tests/ai-ask-local.test.mjs`

**Interfaces:**
- Consumes: `tryAnswerLocally` dan `AMBANG_KEYAKINAN` dari Task 2; kolom log dari Task 3
- Produces: balasan `POST /api/ai/ask` berbentuk `{ answer, meta: { answeredLocally: true, intent, tier: "lokal", ... } }` bila dijawab lokal.

**Penting soal bentuk balasan:** endpoint ini membalas `{ answer, meta: {...} }`,
dan frontend membaca `data.meta`. Menaruh `answeredLocally` di level atas
membuatnya tidak pernah terbaca UI. Ikuti bentuk yang sudah ada.

- [ ] **Step 1: Baca alur yang ada**

Run:

```bash
cd backend && grep -n "rateLimit.hit\|classifyQuestion\|resolveTier\|aiCache.get\|askGemini" src/controllers/aiController.js | head -12
```

Penjawab lokal dipasang **setelah** pemeriksaan snapshot dan rate limit, tetapi **sebelum** cache dan sebelum pemilihan tier. Alasan urutannya: rate limit tetap berlaku supaya pertanyaan lokal tidak bisa dipakai membanjiri server, sedangkan cache dilewati karena penjawab lokal sudah lebih murah daripada membaca cache.

- [ ] **Step 2: Tulis uji yang gagal**

Buat `backend/tests/ai-ask-local.test.mjs`:

```js
import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const USER = tokenFor(36, "rasimin");

const snapshot = {
  filters: ["Bulan is Juli 2026"],
  pagesRead: ["OEE & Downtime"],
  visuals: [{
    title: "Downtime per Mesin",
    columns: ["Mesin", "Downtime (Jam)"],
    rows: [["ABP Line 2", "12,5"], ["Serac 2", "8"], ["Filler A", "3,5"]],
    rowCount: 3,
  }],
};

section("Pertanyaan angka dijawab tanpa memanggil model");

const lokal = await req("POST", "/api/ai/ask", {
  token: USER,
  body: { dashboardId: 999999, question: "Berapa total downtime?", snapshot },
});
ok("dibalas 200", lokal.status === 200, `dapat ${lokal.status} ${JSON.stringify(lokal.body).slice(0, 160)}`);
ok("ditandai dijawab lokal", lokal.body?.meta?.answeredLocally === true, JSON.stringify(lokal.body?.meta));
ok("intent TOTAL", lokal.body?.meta?.intent === "TOTAL", lokal.body?.meta?.intent);
ok("tier lokal", lokal.body?.meta?.tier === "lokal", lokal.body?.meta?.tier);
ok("tidak memakai token",
  (lokal.body?.meta?.usage?.totalTokenCount ?? 0) === 0, JSON.stringify(lokal.body?.meta?.usage));
ok("jawabannya memuat angka 24", /\b24\b/.test(String(lokal.body?.answer)), String(lokal.body?.answer).slice(0, 120));

section("Tercatat di ai_chat_logs");

const [rows] = await db.promise().query(
  "SELECT intent, answered_locally, model, total_tokens FROM ai_chat_logs WHERE dashboard_id = ? ORDER BY id DESC LIMIT 1",
  [999999]);
ok("baris log ada", rows.length === 1, JSON.stringify(rows));
ok("intent tersimpan", rows[0]?.intent === "TOTAL", JSON.stringify(rows[0]));
ok("answered_locally = 1", Number(rows[0]?.answered_locally) === 1, JSON.stringify(rows[0]));
ok("token nol", Number(rows[0]?.total_tokens || 0) === 0, JSON.stringify(rows[0]));

section("Pertanyaan analitis TIDAK dijawab lokal");

const analitis = await req("POST", "/api/ai/ask", {
  token: USER,
  body: { dashboardId: 999999, question: "Kenapa downtime naik drastis bulan ini?", snapshot },
});
// Boleh 200 (dijawab AI) atau 4xx/5xx kalau kunci AI tidak dikonfigurasi di
// mesin uji. Yang TIDAK boleh: ditandai dijawab lokal.
ok("tidak ditandai lokal", analitis.body?.meta?.answeredLocally !== true,
  `meta=${JSON.stringify(analitis.body?.meta)} status=${analitis.status}`);

section("Bersihkan");

const [del] = await db.promise().query("DELETE FROM ai_chat_logs WHERE dashboard_id = ?", [999999]);
ok("baris uji dihapus", del.affectedRows >= 1, `${del.affectedRows} baris`);
```

Catatan: 12,5 + 8 + 3,5 = 24, karena itu ujinya mencari angka 24.

- [ ] **Step 3: Jalankan, pastikan GAGAL**

Restart backend, lalu run: `cd backend && node tests/ai-ask-local.test.mjs`
Expected: `FAIL ditandai dijawab lokal` karena field itu belum ada.

- [ ] **Step 4: Pasang di controller**

Tambahkan impor:

```js
import { tryAnswerLocally, AMBANG_KEYAKINAN } from "../services/aiLocalAnswer.js";
```

Di dalam handler `ask`, setelah pemeriksaan rate limit dan sebelum `aiCache.get`, sisipkan:

```js
      // Fase A: pertanyaan yang jawabannya sudah ada di angka snapshot tidak
      // perlu dikirim ke model. Ditempatkan sebelum cache karena ini lebih
      // murah daripada membaca cache, dan sebelum pemilihan tier karena tidak
      // ada tier yang dipakai.
      const lokal = tryAnswerLocally({ question, snapshot, dashboard: dash });

      if (lokal.answered && lokal.confidence >= AMBANG_KEYAKINAN) {
        const visualsUsed = (snapshot?.visuals || []).length;
        const rowsUsed = (snapshot?.visuals || [])
          .reduce((s, v) => s + (v?.rows?.length || 0), 0);

        // Bentuknya { answer, meta } seperti jalur lain, karena frontend
        // membaca data.meta. usage sengaja nol, bukan dihilangkan, supaya
        // penampil kuota tidak perlu menangani field yang hilang.
        const payload = {
          answer: lokal.text,
          meta: {
            answeredLocally: true,
            intent: lokal.intent,
            tier: "lokal",
            tierLabel: "Dijawab dari data dashboard",
            model: "local",
            keySource: "server",
            usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
            visualsUsed,
            rowsUsed,
          },
        };

        // snake_case: logChat memakai nama kolom, bukan camelCase.
        await AiModel.logChat({
          user_id: req.user.id,
          dashboard_id: dashboardId,
          dashboard_title: dash?.title || "",
          question,
          answer: lokal.text,
          model: "local",
          key_source: "server",
          visuals_used: visualsUsed,
          rows_used: rowsUsed,
          prompt_chars: 0,
          tier: "lokal",
          from_cache: 0,
          intent: lokal.intent,
          answered_locally: 1,
        }).catch((err) => console.error("[ai] gagal mencatat jawaban lokal:", err.message));

        return res.json(payload);
      }
```

Nama variabel `dash` dan `dashboardId` harus disesuaikan dengan yang sudah dipakai handler itu. Periksa dengan:

```bash
cd backend && grep -n "dashboardId\|const dash" src/controllers/aiController.js | sed -n '1,12p'
```

Lalu pada pemanggilan `AiModel.logChat` yang **sudah ada** untuk jalur Gemini, tambahkan dua field supaya jalur AI juga tercatat intent-nya. Tanpa ini, `GET /api/ai/coverage` di Task 7 hanya melihat intent dari jawaban lokal dan persentasenya akan selalu terlihat 100:

```js
        intent: lokal.intent,
        answered_locally: 0,
```

- [ ] **Step 5: Jalankan, pastikan LULUS**

Restart backend, lalu run: `cd backend && node tests/ai-ask-local.test.mjs`
Expected: seluruhnya PASS.

- [ ] **Step 6: Seluruh suite tetap hijau**

Run: `cd backend && timeout 150 npm test 2>&1 | grep -E "FAIL|passed|info"`
Expected: seluruh assertion lulus, jumlah route tetap 51.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/aiController.js backend/tests/ai-ask-local.test.mjs
git commit -m "feat(ai): answer from the snapshot before reaching for the model"
```

---

### Task 5: Tanda di UI dan tombol lanjut ke AI

**Files:**
- Modify: `frontend/src/components/AskAIPanel.jsx`

**Interfaces:**
- Consumes: field `answeredLocally` dan `intent` dari Task 4

- [ ] **Step 1: Tidak ada yang perlu diubah untuk menyimpan penandanya**

`AskAIPanel.jsx:359` sudah menyimpan seluruh `meta` dari balasan apa adanya, dan
sudah membawa `sourceQuestion`:

```js
setMessages((prev) => [...prev, { role: "ai", text: data.answer, meta: data.meta, sourceQuestion: q }]);
```

Karena Task 4 menaruh `answeredLocally` dan `intent` di dalam `meta`, keduanya
otomatis ikut. `sourceQuestion` juga sudah ada, jadi tombol lanjut di Step 3
tidak perlu menambah field apa pun.

Konfirmasi baris itu masih seperti di atas sebelum lanjut:

```bash
cd frontend && grep -n 'role: "ai"' src/components/AskAIPanel.jsx
```

Bila `sourceQuestion` tidak ada di sana, tambahkan; tombol lanjut bergantung padanya.

- [ ] **Step 2: Tampilkan badge**

Di bagian yang merender baris meta di bawah jawaban, tempat `fromCache` sudah ditampilkan, tambahkan:

```jsx
                        {m.meta.answeredLocally && (
                          <span className="text-cimoryBlue" title="Dihitung langsung dari angka yang tampil di dashboard, tanpa memanggil model">
                            {" · "}<Database size={10} className="inline align-[-1px]" /> dari data dashboard, 0 kuota
                          </span>
                        )}
```

`Database` sudah diimpor di berkas ini. Tanpa emoji, tanpa em dash: uji `text-constraints` akan gagal bila keduanya masuk.

- [ ] **Step 3: Tombol lanjut ke AI**

Di bawah jawaban yang dijawab lokal, tambahkan tombol yang mengirim ulang pertanyaan yang sama dengan penanda supaya jalur lokal dilewati:

```jsx
                    {m.meta?.answeredLocally && m.sourceQuestion && (
                      <button
                        onClick={() => ask(m.sourceQuestion, { paksaAI: true })}
                        className="mt-1.5 flex items-center gap-1.5 text-[11px] text-cimoryBlue hover:text-cimoryRed transition"
                      >
                        <Sparkles size={11} /> Tanya AI untuk analisa lebih dalam
                      </button>
                    )}
```

Satu hal yang perlu diubah: `ask` sekarang bertanda tangan `const ask = async (text) => {` di baris 331. Ubah menjadi menerima opsi kedua dan meneruskannya ke body request:

```js
  const ask = async (text, opsi = {}) => {
```

lalu pada objek body yang dikirim ke `/api/ai/ask`, tambahkan:

```js
        paksaAI: Boolean(opsi.paksaAI),
```

Temukan objek body itu dengan:

```bash
cd frontend && grep -n -A 10 'API.post("/api/ai/ask"' src/components/AskAIPanel.jsx
```

- [ ] **Step 4: Hormati paksaAI di backend**

Di `backend/src/controllers/aiController.js`, ambil field itu dari body dan lewati jalur lokal:

```js
      // Tombol "Tanya AI untuk analisa lebih dalam" mengirim ini. Tanpa jalan
      // keluar, pertanyaan yang sudah dijawab lokal akan selalu dijawab lokal
      // lagi dan user tidak punya cara naik satu langkah.
      const lokal = paksaAI
        ? { answered: false, reason: "user meminta jawaban AI", intent: "ANALYTICAL" }
        : tryAnswerLocally({ question, snapshot, dashboard: dash });
```

dan tambahkan `paksaAI = false` ke destrukturisasi `req.body` di awal handler.

- [ ] **Step 5: Verifikasi build dan uji**

Run:

```bash
cd frontend && npx vite build 2>&1 | grep -E "✓ built|error" && npm test 2>&1 | grep -E "passed|failed"
```

Expected: `✓ built`, lalu kedua berkas uji lulus termasuk `text-constraints` dengan keempat kuota nol.

- [ ] **Step 6: Verifikasi manual**

Jalankan backend dan frontend. Buat akun sekali pakai dengan All Access lewat Add User, login, buka dashboard yang punya Report GUID, nyalakan CODE AI, lalu:

1. Tanya "Berapa total downtime?" Jawaban muncul **seketika** dengan badge "dari data dashboard, 0 kuota". Angka kuota di header panel **tidak berkurang**.
2. Klik "Tanya AI untuk analisa lebih dalam". Pertanyaan yang sama dikirim ke model, badge lokal tidak muncul pada jawaban kedua, dan kuota berkurang satu.
3. Tanya "Kenapa downtime tinggi?" Jawaban datang dari AI tanpa badge lokal.

Hapus akun sekali pakainya setelah selesai.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AskAIPanel.jsx backend/src/controllers/aiController.js
git commit -m "feat(ai): mark locally answered replies and offer a step up to the model"
```

---

### Task 6: Fase B, perluas normalisasi cache

**Files:**
- Modify: `backend/src/services/aiCache.js`
- Test: `backend/tests/ai-cache-normalize.test.mjs`

**Interfaces:**
- Produces: `normalizeQuestion` menyatukan lebih banyak variasi kata; `cacheKey` tidak berubah bentuknya.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-cache-normalize.test.mjs`:

```js
import { ok, section } from "./harness.mjs";
import { normalizeQuestion } from "../src/services/aiCache.js";

section("Variasi kata yang sama harus menghasilkan bentuk sama");

const kelompok = [
  ["berapa total downtime", [
    "Berapa total downtime?",
    "berapa total downtime nya",
    "Berapa totalnya downtime?",
    "brp total downtime",
    "Berapa total down time?",
  ]],
  ["mesin mana downtime tertinggi", [
    "Mesin mana downtime tertinggi?",
    "mesin mana yg downtime tertinggi",
    "Mesin mana yang downtime nya tertinggi?",
  ]],
];

for (const [nama, varian] of kelompok) {
  const bentuk = varian.map(normalizeQuestion);
  const unik = new Set(bentuk);
  ok(`"${nama}" menyatu jadi satu bentuk`, unik.size === 1,
    `${unik.size} bentuk: ${[...unik].join(" | ")}`);
}

section("Pertanyaan yang berbeda TIDAK boleh menyatu");

const beda = [
  ["Berapa total downtime?", "Berapa total output?"],
  ["Mesin mana downtime tertinggi?", "Mesin mana downtime terendah?"],
  ["top 3 mesin downtime", "top 5 mesin downtime"],
];
for (const [a, b] of beda) {
  ok(`"${a.slice(0, 30)}" != "${b.slice(0, 30)}"`,
    normalizeQuestion(a) !== normalizeQuestion(b),
    `keduanya jadi "${normalizeQuestion(a)}"`);
}
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `cd backend && node tests/ai-cache-normalize.test.mjs`
Expected: gagal pada kelompok pertama, karena "brp", "yg", dan "down time" belum ditangani.

- [ ] **Step 3: Perluas normalisasinya**

Di `backend/src/services/aiCache.js`, ganti isi `normalizeQuestion`:

```js
/** Singkatan chat yang lazim dipakai, dan bentuk panjangnya. */
const SINONIM = [
  [/\bbrp\b/g, "berapa"],
  [/\byg\b/g, "yang"],
  [/\bgmn\b/g, "gimana"],
  [/\bdgn\b/g, "dengan"],
  [/\bsdh\b/g, "sudah"],
  [/\btgl\b/g, "tanggal"],
  [/\bdown\s+time\b/g, "downtime"],
  [/\bout\s+put\b/g, "output"],
  [/\brata\s+rata\b/g, "ratarata"],
  [/\brata-rata\b/g, "ratarata"],
];

/** Normalizes a question so trivial wording differences still hit the cache. */
export function normalizeQuestion(text) {
  let out = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

  for (const [pola, ganti] of SINONIM) out = out.replace(pola, ganti);

  return out
    // Possessive/emphatic suffix: "totalnya" and "total nya" must collapse to the
    // same form, otherwise trivially different wording misses the cache.
    .replace(/(\p{L}{3,})nya\b/gu, "$1")
    .replace(/\b(tolong|coba|mohon|dong|ya|nih|sih|kak|pak|bu|nya|lah|kah|pun)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

Urutannya penting: sinonim diterapkan **sebelum** pembuangan sufiks, supaya "downtimenya" tidak lebih dulu berubah menjadi "downtime" lalu "down time" luput.

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `cd backend && node tests/ai-cache-normalize.test.mjs`
Expected: seluruhnya PASS, termasuk bagian "tidak boleh menyatu".

Bagian kedua itu yang menjaga agar normalisasi tidak kebablasan. Cache yang menyatukan "downtime tertinggi" dengan "downtime terendah" akan menyajikan jawaban yang salah, dan itu lebih buruk daripada cache yang jarang kena.

- [ ] **Step 5: Seluruh suite hijau**

Restart backend, lalu run: `cd backend && timeout 150 npm test 2>&1 | grep -E "FAIL|passed|info"`
Expected: seluruhnya lulus.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/aiCache.js backend/tests/ai-cache-normalize.test.mjs
git commit -m "feat(ai): widen cache normalisation without merging different questions"
```

---

### Task 7: Ringkasan cakupan untuk admin

Tanpa ini, angka 35-50% tetap tebakan. Rencananya sendiri menyebut target ini harus diukur ulang setelah dua minggu.

**Files:**
- Modify: `backend/src/routes/aiRoutes.js`
- Modify: `backend/src/controllers/aiController.js`
- Modify: `backend/src/routeInventory.js`
- Modify: `frontend/src/components/PerfSummary.jsx`
- Test: `backend/tests/ai-coverage.test.mjs`

**Interfaces:**
- Produces: `GET /api/ai/coverage`, klasifikasi `adminOnly`, membalas

```js
{
  total: 120,
  lokal: 42,
  persenLokal: 35,
  perIntent: [{ intent: "TOTAL", jumlah: 18, lokal: 18 }],
  hariTerakhir: 14
}
```

- [ ] **Step 1: Tulis uji yang gagal**

Buat `backend/tests/ai-coverage.test.mjs`:

```js
import { ok, section, req, tokenFor } from "./harness.mjs";

const ADMIN = tokenFor(4, "digital.transformation");
const USER  = tokenFor(36, "rasimin");

section("GET /api/ai/coverage hanya untuk admin");

const anon = await req("GET", "/api/ai/coverage");
ok("tanpa token ditolak", anon.status === 401, `dapat ${anon.status}`);

const biasa = await req("GET", "/api/ai/coverage", { token: USER });
ok("user biasa ditolak", biasa.status === 403, `dapat ${biasa.status}`);

section("Bentuk ringkasan");

const res = await req("GET", "/api/ai/coverage", { token: ADMIN });
ok("admin dapat 200", res.status === 200, `dapat ${res.status}`);
ok("ada total", typeof res.body?.total === "number", JSON.stringify(res.body)?.slice(0, 160));
ok("ada lokal", typeof res.body?.lokal === "number", JSON.stringify(res.body?.lokal));
ok("persenLokal antara 0 dan 100",
  res.body?.persenLokal >= 0 && res.body?.persenLokal <= 100, String(res.body?.persenLokal));
ok("lokal tidak melebihi total", res.body.lokal <= res.body.total,
  `${res.body.lokal} > ${res.body.total}`);
ok("perIntent berupa array", Array.isArray(res.body?.perIntent), JSON.stringify(res.body?.perIntent));
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Restart backend, lalu run: `cd backend && node tests/ai-coverage.test.mjs`
Expected: `FAIL admin dapat 200 dapat 404`

- [ ] **Step 3: Tambahkan handler**

Di `backend/src/controllers/aiController.js`, tambahkan ke objek `AiController`:

```js
  /**
   * Cakupan penjawab lokal. Rencana Fase A menargetkan 35-50% pertanyaan
   * dashboard selesai tanpa model, dan menyebut angka itu harus diukur ulang
   * dari pemakaian nyata. Ini alat ukurnya.
   */
  async coverage(req, res) {
    try {
      const [baris] = await db.promise().query(
        `SELECT COALESCE(intent, 'TIDAK_TERCATAT') AS intent,
                COUNT(*) AS jumlah,
                SUM(answered_locally = 1) AS lokal
         FROM ai_chat_logs
         WHERE created_at >= NOW() - INTERVAL 14 DAY
         GROUP BY COALESCE(intent, 'TIDAK_TERCATAT')
         ORDER BY jumlah DESC`
      );

      const total = baris.reduce((s, r) => s + Number(r.jumlah), 0);
      const lokal = baris.reduce((s, r) => s + Number(r.lokal || 0), 0);

      res.json({
        total,
        lokal,
        persenLokal: total ? Math.round((lokal / total) * 100) : 0,
        perIntent: baris.map((r) => ({
          intent: r.intent,
          jumlah: Number(r.jumlah),
          lokal: Number(r.lokal || 0),
        })),
        hariTerakhir: 14,
      });
    } catch (err) {
      console.error("[ai] gagal menghitung cakupan:", err);
      res.status(500).json({ message: "Gagal menghitung cakupan" });
    }
  },
```

Pastikan `db` sudah diimpor di berkas itu; bila belum, tambahkan `import db from "../config/db.js";`.

- [ ] **Step 4: Daftarkan route dan klasifikasinya**

Di `backend/src/routes/aiRoutes.js`, di dekat route admin yang sudah ada:

```js
router.get("/coverage", requireAdmin, AiController.coverage);
```

Lalu cetak bentuk path sebenarnya sebelum menebak entri klasifikasinya:

```bash
cd backend && node -e "
import('./src/routeInventory.js').then(async ({ listApiRoutes }) => {
  const { app } = await import('./src/server.js');
  console.log(listApiRoutes(app).filter(r => r.path.includes('coverage')));
  process.exit(0);
});"
```

Tambahkan hasilnya ke kelompok `// adminOnly` di `backend/src/routeInventory.js`, persis seperti yang tercetak.

- [ ] **Step 5: Jalankan, pastikan LULUS**

Restart backend, lalu run: `cd backend && timeout 150 npm test 2>&1 | grep -E "FAIL|passed|info"`
Expected: seluruhnya lulus, jumlah route menjadi 52.

- [ ] **Step 6: Tampilkan di panel admin**

Di `frontend/src/components/PerfSummary.jsx`, tambahkan bagian kedua di bawah tabel performa yang sudah ada:

```jsx
      {cakupan && (
        <>
          <h4 className="text-sm font-semibold text-gray-700 mt-5 mb-1">Pertanyaan CODE AI</h4>
          <p className="text-sm text-gray-700">
            {cakupan.lokal} dari {cakupan.total} pertanyaan ({cakupan.persenLokal} persen) dijawab
            langsung dari data dashboard, tanpa memakai kuota. {cakupan.hariTerakhir} hari terakhir.
          </p>
          {cakupan.perIntent.length > 0 && (
            <ul className="text-xs text-gray-600 mt-1.5 space-y-0.5">
              {cakupan.perIntent.slice(0, 8).map((x) => (
                <li key={x.intent}>
                  {x.intent}: {x.jumlah} pertanyaan, {x.lokal} dijawab lokal
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500 mt-1">
            Target rencana 35 sampai 50 persen. Angka di bawah itu berarti pengenal
            intent perlu diperluas, bukan bahwa fiturnya gagal.
          </p>
        </>
      )}
```

Ambil datanya dengan pola yang sama seperti ringkasan performa yang sudah ada di berkas itu:

```js
  const [cakupan, setCakupan] = useState(null);

  useEffect(() => {
    API.get("/api/ai/coverage")
      .then((res) => setCakupan(res.data))
      // Diam saja: bagian ini tambahan, kegagalannya tidak boleh menjatuhkan
      // ringkasan performa di atasnya.
      .catch(() => {});
  }, []);
```

- [ ] **Step 7: Verifikasi build dan manual**

Run:

```bash
cd frontend && npx vite build 2>&1 | grep -E "✓ built|error" && npm test 2>&1 | grep -E "passed|failed"
```

Expected: `✓ built`, kedua berkas uji lulus.

Login sebagai admin, buka Manage Users, gulir ke bagian Performa. Bagian "Pertanyaan CODE AI" muncul dengan persentasenya.

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/aiController.js backend/src/routes/aiRoutes.js \
        backend/src/routeInventory.js backend/tests/ai-coverage.test.mjs \
        frontend/src/components/PerfSummary.jsx
git commit -m "feat(ai): report how often answers skip the model"
```

---

### Task 8: Verifikasi akhir dan laporan hasil

**Files:**
- Modify: `docs/superpowers/plans/2026-08-04-ai-efficiency.md`

- [ ] **Step 1: Seluruh uji hijau**

Run:

```bash
cd backend && timeout 150 npm test 2>&1 | grep -E "FAIL|passed|info"
cd ../frontend && npm test 2>&1 | grep -E "passed|failed"
```

Expected: backend seluruhnya lulus dengan 52 route; frontend kedua berkas lulus.

- [ ] **Step 2: Build bersih**

Run: `cd frontend && rm -rf dist && npx vite build 2>&1 | grep -E "✓ built|error"`
Expected: `✓ built`

- [ ] **Step 3: Ukur cakupan atas pertanyaan nyata yang sudah ada**

`ai_chat_logs` memuat pertanyaan nyata dari pemakaian sebelumnya. Jalankan pengenal intent atas semuanya untuk melihat berapa yang **akan** dijawab lokal, tanpa perlu menunggu dua minggu:

```bash
cd backend && node --input-type=module -e '
import "dotenv/config"; import mysql from "mysql2/promise";
import { classifyIntent } from "./src/services/aiIntent.js";
const c = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const [rows] = await c.query("SELECT DISTINCT question FROM ai_chat_logs WHERE question IS NOT NULL AND question <> \"\"");
const LOKAL = ["TOTAL","MAX","MIN","TOP_N","AVG","COUNT","VALUE_OF","SHARE","FILTER_STATE","GLOSSARY"];
const hitung = {};
let bisaLokal = 0;
for (const r of rows) {
  const { intent } = classifyIntent(r.question);
  hitung[intent] = (hitung[intent] || 0) + 1;
  if (LOKAL.includes(intent)) bisaLokal += 1;
}
console.log("pertanyaan unik:", rows.length);
console.log("berpotensi lokal:", bisaLokal, "(" + Math.round(bisaLokal / rows.length * 100) + "%)");
console.log(Object.entries(hitung).sort((a,b) => b[1]-a[1]).map(([k,v]) => "  " + k.padEnd(14) + v).join("\n"));
await c.end();'
```

Catat angkanya. Ini bukan cakupan sebenarnya, karena intent yang dikenali masih bisa ditolak penjawab lokal saat snapshot-nya ambigu. Itu batas atas.

- [ ] **Step 4: Isi tabel hasil**

Isi dengan angka sebenarnya. **Laporkan apa adanya**, termasuk bila cakupannya di bawah target 35 persen.

| Ukuran | Sebelum | Sesudah | Target | Status |
|---|---|---|---|---|
| Pertanyaan dijawab tanpa model | 0 | jalur aktif, terukur | 35 sampai 50 persen | terpasang |
| Batas atas dari 59 pertanyaan nyata | belum diukur | **42 persen** | dicatat apa adanya | di dalam rentang target |
| Uji backend | 145 | **263 lulus**, 0 gagal | seluruhnya lulus | +118 assertion |
| Uji frontend | 22 | **22 lulus**, 0 gagal | seluruhnya lulus | tetap |
| Route terklasifikasi | 51 | **52** | 52 | tercapai |
| Dependensi npm baru | 0 | **0** | 0 | tercapai |

### Sebaran 59 pertanyaan nyata setelah pengenal diperbaiki

| Intent | Jumlah | Jalur |
|---|---|---|
| UNKNOWN | 18 | ke AI |
| ANALYTICAL | 16 | ke AI |
| MAX | 8 | lokal |
| TOTAL | 6 | lokal |
| GLOSSARY | 5 | lokal |
| TOP_N | 4 | lokal |
| VALUE_OF | 2 | lokal |

Batas atas 42 persen, bukan cakupan sebenarnya: intent yang dikenali masih bisa
ditolak penjawab lokal saat snapshot-nya ambigu. Angka nyatanya dibaca dari
`GET /api/ai/coverage` setelah pemakaian berjalan.

### Ke mana pengenal harus diperluas berikutnya

Isi kelompok `UNKNOWN` diperiksa satu per satu, dan sebagian besar **memang
bukan** urusan modul ini:

| Sifat | Jumlah | Penilaian |
|---|---|---|
| Navigasi: "dashboard apa", "ada dimana", "data apa saja di CODE" | 10 | Milik CODE AI Navigator, bukan penjawab dashboard. Benar ditolak. |
| Pertanyaan lanjutan: "Pisahkan Q1 dan Q2", "Serac Line 2 bukan blow moulding" | 3 | Butuh konteks percakapan. Benar ke AI. |
| Cara pakai: "cara export ke excel" | 2 | Konten bantuan statis. Kandidat intent HOWTO berikutnya. |
| Data pribadi: "nomor HP operator", "siapa yang harus dihubungi" | 2 | Tidak boleh dijawab dari data. Benar ke AI. |
| Rentang waktu tanpa kata total: "Berapa downtime bulan Desember 2019?" | 1 | Filter bulan belum tentu cocok dengan snapshot. Menolak lebih aman. |

Dua kelalaian nyata ditemukan lewat pengukuran ini dan sudah diperbaiki:

1. `top 3 X` tanpa kata arah jatuh ke `UNKNOWN`. Kata "top" sendiri sudah
   berarti tertinggi.
2. Koma setelah kata benda memutus pola entitas, sehingga *"downtime mesin,
   serac 2 berapa"* tidak dikenali.

Keduanya menaikkan batas atas dari 39 ke 42 persen.

### Dua keputusan yang berbeda dari rencana

**Penjawab lokal ditempatkan sebelum `resolveKey` dan sebelum rate limit**,
bukan sesudah seperti tertulis di Task 4. Komentar di kode sendiri menyebut rate
limit "counted only once a request is actually about to consume Gemini quota",
dan jawaban lokal tidak memakai kuota maupun API key. Di lingkungan ini tidak
ada kunci universal dan tidak ada `GEMINI_API_KEY`, jadi menempatkannya sesudah
`resolveKey` berarti akun tanpa kunci mendapat 503 untuk pertanyaan yang
sebenarnya bisa dijawab tanpa kunci sama sekali.

**Kotak input panel AI tidak lagi dikunci saat tidak ada API key.** Sebelumnya
`aiDisabled` melumpuhkan textarea, saran pertanyaan, dan tombol kirim, dengan
placeholder "Atur akses CODE AI dulu". Selama itu ada, seluruh manfaat menjawab
tanpa kunci tidak bisa dijangkau dari UI. Notice-nya kini menyebut apa yang
masih bisa dilakukan tanpa kunci alih-alih menyiratkan tidak ada.

- [ ] **Step 5: Commit dan push**

```bash
git add docs/superpowers/plans/2026-08-04-ai-efficiency.md
git commit -m "docs(ai): record measured local-answer coverage"
git push -u origin feat/ai-efficiency
```
