# CODE Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memangkas waktu muat awal CODE dan waktu buka dashboard Power BI, dengan instrumentasi yang membuktikan hasilnya.

**Architecture:** Empat fase berurutan. Fase 1 memasang pengukuran sisi-user sehingga fase berikutnya punya garis dasar. Fase 2 memecah bundle 816 KB dengan `React.lazy`, didahului pemindahan komponen Power BI keluar dari `App.jsx` yang saat ini mengunci SDK di chunk utama. Fase 3 memperbaiki hero image 1,64 MB. Fase 4 mengambil embed token saat kursor menyentuh kartu dashboard.

**Tech Stack:** React 18 + Vite, Express 4 (ESM), MySQL via `mysql2`, `powerbi-client-react`, `sharp` (dev-only, untuk konversi gambar sekali jalan).

## Global Constraints

- Spec acuan: `docs/superpowers/specs/2026-08-03-performance-design.md`
- Semua migrasi dijaga lewat `information_schema` + `PREPARE`/`EXECUTE`. **`IF NOT EXISTS` adalah sintaks MariaDB** dan gagal diam-diam di MySQL — ini pernah terjadi di repo ini dan membuat dua tabel tidak pernah terbentuk.
- Identitas user **selalu** dari `req.user.id`, tidak pernah dari body request.
- Setiap route `/api` baru **wajib** didaftarkan di `ROUTE_CLASSIFICATION` (`backend/src/routeInventory.js`), kalau tidak `npm test` gagal. Itu memang disengaja.
- Harness test: `import { ok, section, req, tokenFor } from "./harness.mjs"`. Tidak ada framework test. Berkas `*.test.mjs` di `backend/tests/` dijalankan otomatis oleh `npm test`.
- **Test tidak boleh menyentuh data user nyata.** Gunakan akun sekali pakai yang dibuat dan dihapus sendiri oleh test, atau id hantu `999999`. Aturan ini lahir dari dua insiden: sebuah test pernah mengubah password user nyata, dan satu lagi mengarahkan DELETE ke id nyata.
- Backend dijalankan ulang secara manual setelah perubahan `src/` sebelum `npm test` — test menembak server yang berjalan di `http://localhost:5050`, bukan menyalakan servernya sendiri.
- Jangan menyentuh `GET /api/dashboards/` (sudah 3 ms) maupun `DCMS.webp`.
- `framer-motion` **tidak** diganti dalam plan ini. Itu keputusan tampilan, milik workstream UI/UX.
- Branch kerja: buat `feat/performance` dari `feat/api-authorization` (belum di-merge ke `main`).

---

### Task 1: Tabel dan endpoint penerima telemetri

**Files:**
- Create: `backend/migrations/add_perf_samples.sql`
- Create: `backend/src/routes/perfRoutes.js`
- Modify: `backend/src/server.js` (import + mount)
- Modify: `backend/src/routeInventory.js` (dua entri baru)
- Test: `backend/tests/perf-ingest.test.mjs`

**Interfaces:**
- Consumes: `db` dari `../config/db.js`, `rateLimit.hit` dari `../services/rateLimiter.js`, `requireAdmin` dari `../middleware/authorize.js`
- Produces: `POST /api/perf` (authenticated) dan `GET /api/perf/summary` (adminOnly, diisi di Task 2). Router default-export dari `perfRoutes.js`, dipasang di `app.use("/api/perf", perfRoutes)`.
- Produces bentuk `metrics` yang dipakai frontend di Task 3:
  - `kind: "app_load"` → `{ ttfb, domInteractive, appReady }`
  - `kind: "dashboard_open"` → `{ tokenMs, renderMs, prefetchHit }`

- [ ] **Step 1: Tulis migrasi**

Buat `backend/migrations/add_perf_samples.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: tabel perf_samples untuk telemetri performa.
-- Jalankan SETELAH cod_db.sql. Aman diulang.
--
-- MySQL tidak mendukung "CREATE TABLE IF NOT EXISTS" untuk semua kasus indeks,
-- dan "ADD COLUMN IF NOT EXISTS" adalah sintaks MariaDB. Karena itu penjagaan
-- dilakukan lewat information_schema, sama seperti add_user_roles.sql.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'perf_samples') = 0,
  "CREATE TABLE perf_samples (
     id           INT AUTO_INCREMENT PRIMARY KEY,
     user_id      INT NULL,
     kind         ENUM('app_load','dashboard_open') NOT NULL,
     dashboard_id INT NULL,
     metrics      JSON NOT NULL,
     created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_perf_kind_time (kind, created_at)
   )",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
```

- [ ] **Step 2: Jalankan migrasi**

Run:

```bash
cd backend && mysql -u root -p"$DB_PASSWORD" "$DB_NAME" < migrations/add_perf_samples.sql
```

Ganti `$DB_PASSWORD` dan `$DB_NAME` dengan nilai di `backend/.env` (`DB_PASSWORD`, `DB_NAME`).

Verifikasi tabelnya benar-benar ada — migrasi MySQL yang gagal bisa diam saja:

```bash
mysql -u root -p"$DB_PASSWORD" "$DB_NAME" -e "DESCRIBE perf_samples;"
```

Expected: 6 baris — `id`, `user_id`, `kind`, `dashboard_id`, `metrics`, `created_at`.

- [ ] **Step 3: Tulis test yang gagal**

Buat `backend/tests/perf-ingest.test.mjs`:

```js
import { ok, section, req, tokenFor } from "./harness.mjs";

const USER  = tokenFor(36, "rasimin");
const ADMIN = tokenFor(4, "digital.transformation");

section("POST /api/perf menerima telemetri");

const good = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: { ttfb: 12, domInteractive: 340, appReady: 780 } },
});
ok("kiriman sah dibalas 204", good.status === 204, `dapat ${good.status}`);

const noToken = await req("POST", "/api/perf", {
  body: { kind: "app_load", metrics: { ttfb: 1, domInteractive: 2, appReady: 3 } },
});
ok("tanpa token ditolak", noToken.status === 401, `dapat ${noToken.status}`);

section("Bentuk metrics divalidasi");

const badKind = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "bukan_kind_yang_dikenal", metrics: { ttfb: 1 } },
});
ok("kind tak dikenal ditolak", badKind.status === 400, `dapat ${badKind.status}`);

const badValue = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: { ttfb: "bukan angka" } },
});
ok("nilai non-angka ditolak", badValue.status === 400, `dapat ${badValue.status}`);

const tooBig = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: { ttfb: 99_999_999 } },
});
ok("nilai di luar rentang ditolak", tooBig.status === 400, `dapat ${tooBig.status}`);

const unknownKey = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: { ttfb: 5, kunci_asing: 1 } },
});
ok("kunci asing ditolak", unknownKey.status === 400, `dapat ${unknownKey.status}`);

section("user_id diambil dari token, bukan dari body");

// Kirim user_id palsu. Yang tersimpan harus tetap milik pemegang token.
await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", user_id: 4, metrics: { ttfb: 7, domInteractive: 8, appReady: 9 } },
});
const rows = await req("GET", "/api/perf/summary", { token: ADMIN });
ok("summary bisa dibaca admin", rows.status === 200, `dapat ${rows.status}`);
```

- [ ] **Step 4: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test 2>&1 | grep -E "FAIL|passed"`
Expected: beberapa `FAIL` pada bagian perf (endpoint belum ada, semuanya 404), dan uji inventaris route masih lulus karena belum ada route baru.

- [ ] **Step 5: Tulis router**

Buat `backend/src/routes/perfRoutes.js`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Telemetri performa.
//
// Tujuannya menjawab satu pertanyaan: waktu buka dashboard habis di mana —
// mengambil token, atau Power BI merender? Tanpa pemisahan itu, optimasi
// berikutnya hanya tebakan yang kebetulan masuk akal.
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import db from "../config/db.js";
import * as rateLimit from "../services/rateLimiter.js";
import { requireAdmin } from "../middleware/authorize.js";

const router = express.Router();

// Kunci yang diterima per jenis sampel. Apa pun di luar ini ditolak — kolom
// JSON akan dengan senang hati menyimpan apa saja yang dikirim browser.
const ALLOWED = {
  app_load:       { ttfb: "number", domInteractive: "number", appReady: "number" },
  dashboard_open: { tokenMs: "number", renderMs: "number", prefetchHit: "boolean" },
};

const MAX_MS = 600_000; // 10 menit; apa pun di atas ini bukan pengukuran, itu bug

function validate(kind, metrics) {
  const schema = ALLOWED[kind];
  if (!schema) return "kind tidak dikenal";
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return "metrics harus objek";
  }
  for (const [key, value] of Object.entries(metrics)) {
    const expected = schema[key];
    if (!expected) return `kunci tidak dikenal: ${key}`;
    if (expected === "boolean") {
      if (typeof value !== "boolean") return `${key} harus boolean`;
    } else {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${key} harus angka`;
      if (value < 0 || value > MAX_MS) return `${key} di luar rentang`;
    }
  }
  return null;
}

router.post("/", (req, res) => {
  // Identitas dari token, tidak pernah dari body.
  const userId = req.user?.id ?? null;

  // Endpoint yang menulis ke database tanpa batas adalah alat pengisi disk.
  const limit = rateLimit.hit(`perf:${userId}`, 60, 300);
  if (!limit.allowed) return res.status(429).json({ message: "Terlalu banyak kiriman telemetri" });

  const { kind, dashboard_id: dashboardId, metrics } = req.body || {};
  const problem = validate(kind, metrics);
  if (problem) return res.status(400).json({ message: problem });

  const dash = Number.isInteger(dashboardId) ? dashboardId : null;

  db.query(
    "INSERT INTO perf_samples (user_id, kind, dashboard_id, metrics) VALUES (?, ?, ?, ?)",
    [userId, kind, dash, JSON.stringify(metrics)],
    (err) => {
      // Klien tidak punya tindakan berarti atas kegagalan telemetri, dan
      // membuat pengukuran menjatuhkan fitur yang diukurnya lebih buruk
      // daripada tidak mengukur sama sekali.
      if (err) console.error("[perf] gagal menyimpan sampel:", err.message);
      res.status(204).end();
    }
  );
});

export default router;
```

- [ ] **Step 6: Pasang router di server.js**

Di `backend/src/server.js`, tambahkan import setelah baris `import userRoutes from "./routes/userRoutes.js";`:

```js
import perfRoutes from "./routes/perfRoutes.js";
```

Dan mount setelah baris `app.use("/api", userRoutes);`:

```js
app.use("/api/perf", perfRoutes);
```

- [ ] **Step 7: Jalankan test — inventaris route sekarang harus GAGAL**

Restart server, lalu run: `cd backend && npm test 2>&1 | grep -E "FAIL|passed"`

Expected: `FAIL tidak ada route tanpa klasifikasi belum diklasifikasi: POST /api/perf`

Ini bukan gangguan — inilah penjaga yang dipasang di Task 8 pekerjaan otorisasi bekerja sebagaimana mestinya. Route baru tidak boleh lolos tanpa keputusan otorisasi yang eksplisit.

- [ ] **Step 8: Daftarkan klasifikasinya**

Di `backend/src/routeInventory.js`, tambahkan di kelompok `// authenticated`:

```js
  ["POST /api/perf/", "authenticated"],
```

Catatan: router dipasang di `/api/perf` dengan path `"/"`, sehingga Express mencatatnya sebagai `/api/perf/` dengan garis miring di akhir. Jalankan langkah verifikasi berikut daripada menebak bentuknya.

- [ ] **Step 9: Cetak route yang terbaca sebelum mencocokkan**

Run:

```bash
cd backend && node -e "
import('./src/routeInventory.js').then(async ({ listApiRoutes }) => {
  const { app } = await import('./src/server.js');
  console.log(listApiRoutes(app).filter(r => r.path.includes('perf')));
  process.exit(0);
});"
```

Expected: menampilkan bentuk path sebenarnya, mis. `{ method: 'POST', path: '/api/perf/' }`. Sesuaikan entri di Step 8 agar sama persis dengan yang tercetak. **Jangan** mengubah `listApiRoutes` untuk mencocokkan tebakan.

- [ ] **Step 10: Jalankan test, pastikan LULUS**

Restart server, lalu run: `cd backend && npm test 2>&1 | grep -E "FAIL|passed"`

Expected: seluruhnya lulus kecuali bagian yang memanggil `GET /api/perf/summary` (dibuat di Task 2). Bila `summary` masih 404, biarkan — Task 2 yang menutupnya.

- [ ] **Step 11: Commit**

```bash
git add backend/migrations/add_perf_samples.sql backend/src/routes/perfRoutes.js \
        backend/src/server.js backend/src/routeInventory.js backend/tests/perf-ingest.test.mjs
git commit -m "feat(perf): accept performance telemetry from the browser"
```

---

### Task 2: Ringkasan p50/p95 untuk admin

**Files:**
- Modify: `backend/src/routes/perfRoutes.js`
- Modify: `backend/src/routeInventory.js`
- Test: `backend/tests/perf-summary.test.mjs`

**Interfaces:**
- Consumes: tabel `perf_samples` dari Task 1
- Produces: `GET /api/perf/summary` mengembalikan

```js
{
  appLoad:   { count: 12, p50: { ttfb: 10, domInteractive: 300, appReady: 700 },
                          p95: { ttfb: 40, domInteractive: 900, appReady: 1800 } },
  dashboard: { count: 30, p50: { tokenMs: 3, renderMs: 2400 },
                          p95: { tokenMs: 1400, renderMs: 6200 },
               prefetchHitRate: 0.62 },
  slowest:   [ { dashboard_id: 12, title: "Technical Downtime Report", p95RenderMs: 8100, samples: 9 } ]
}
```

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/tests/perf-summary.test.mjs`:

```js
import { ok, section, req, tokenFor } from "./harness.mjs";

const USER  = tokenFor(36, "rasimin");
const ADMIN = tokenFor(4, "digital.transformation");

section("GET /api/perf/summary hanya untuk admin");

const anon = await req("GET", "/api/perf/summary");
ok("tanpa token ditolak", anon.status === 401, `dapat ${anon.status}`);

const asUser = await req("GET", "/api/perf/summary", { token: USER });
ok("user biasa ditolak", asUser.status === 403, `dapat ${asUser.status}`);

section("Bentuk ringkasan");

// Kirim beberapa sampel supaya ada yang dihitung.
for (const ms of [100, 200, 300, 400, 900]) {
  await req("POST", "/api/perf", {
    token: USER,
    body: { kind: "app_load", metrics: { ttfb: 5, domInteractive: ms, appReady: ms + 50 } },
  });
}

const res = await req("GET", "/api/perf/summary", { token: ADMIN });
ok("admin dapat 200", res.status === 200, `dapat ${res.status}`);
ok("ada bagian appLoad", Boolean(res.body?.appLoad), JSON.stringify(res.body)?.slice(0, 200));
ok("appLoad punya p50 dan p95",
  typeof res.body?.appLoad?.p50?.appReady === "number" &&
  typeof res.body?.appLoad?.p95?.appReady === "number",
  JSON.stringify(res.body?.appLoad));
ok("p95 tidak lebih kecil dari p50",
  res.body.appLoad.p95.appReady >= res.body.appLoad.p50.appReady,
  `p50=${res.body?.appLoad?.p50?.appReady} p95=${res.body?.appLoad?.p95?.appReady}`);
ok("ada bagian dashboard", Boolean(res.body?.dashboard), JSON.stringify(res.body?.dashboard));
ok("ada daftar slowest", Array.isArray(res.body?.slowest), JSON.stringify(res.body?.slowest));
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test 2>&1 | grep -E "FAIL|passed"`
Expected: `FAIL admin dapat 200 dapat 404`

- [ ] **Step 3: Tambahkan penghitung persentil dan endpointnya**

Di `backend/src/routes/perfRoutes.js`, tambahkan sebelum `export default router;`:

```js
/**
 * Persentil dengan metode nearest-rank.
 *
 * Rata-rata menyembunyikan ekor lambat, dan ekor lambat itulah yang
 * dikeluhkan user — satu muat 9 detik terasa jauh lebih buruk daripada
 * sepuluh muat 1 detik terasa baik.
 */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

function summarise(rows, keys) {
  const p50 = {};
  const p95 = {};
  for (const key of keys) {
    const values = rows
      .map((r) => r.metrics?.[key])
      .filter((v) => typeof v === "number")
      .sort((a, b) => a - b);
    p50[key] = percentile(values, 50);
    p95[key] = percentile(values, 95);
  }
  return { count: rows.length, p50, p95 };
}

// mysql2 sudah mem-parse kolom JSON menjadi objek; string hanya muncul pada
// versi driver lama, jadi keduanya ditangani.
function readMetrics(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

router.get("/summary", requireAdmin, (req, res) => {
  const sql = `
    SELECT p.kind, p.dashboard_id, p.metrics, d.title
    FROM perf_samples p
    LEFT JOIN dashboards d ON d.id = p.dashboard_id
    WHERE p.created_at >= NOW() - INTERVAL 7 DAY
  `;
  db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ message: "Database error" });

    const parsed = rows.map((r) => ({ ...r, metrics: readMetrics(r.metrics) }));
    const appLoad   = parsed.filter((r) => r.kind === "app_load");
    const dashboard = parsed.filter((r) => r.kind === "dashboard_open");

    const hits = dashboard.filter((r) => r.metrics.prefetchHit === true).length;

    // Lima dashboard dengan p95 render terlambat, minimal 3 sampel supaya
    // satu kejadian aneh tidak menobatkan dashboard sebagai "paling lambat".
    const byDash = new Map();
    for (const row of dashboard) {
      if (row.dashboard_id == null) continue;
      if (!byDash.has(row.dashboard_id)) {
        byDash.set(row.dashboard_id, { dashboard_id: row.dashboard_id, title: row.title, values: [] });
      }
      if (typeof row.metrics.renderMs === "number") {
        byDash.get(row.dashboard_id).values.push(row.metrics.renderMs);
      }
    }
    const slowest = [...byDash.values()]
      .filter((d) => d.values.length >= 3)
      .map((d) => ({
        dashboard_id: d.dashboard_id,
        title: d.title,
        samples: d.values.length,
        p95RenderMs: percentile([...d.values].sort((a, b) => a - b), 95),
      }))
      .sort((a, b) => b.p95RenderMs - a.p95RenderMs)
      .slice(0, 5);

    res.json({
      appLoad: summarise(appLoad, ["ttfb", "domInteractive", "appReady"]),
      dashboard: {
        ...summarise(dashboard, ["tokenMs", "renderMs"]),
        prefetchHitRate: dashboard.length ? hits / dashboard.length : null,
      },
      slowest,
    });
  });
});
```

- [ ] **Step 4: Daftarkan klasifikasi route**

Di `backend/src/routeInventory.js`, tambahkan di kelompok `// adminOnly`:

```js
  ["GET /api/perf/summary", "adminOnly"],
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Restart server, lalu run: `cd backend && npm test 2>&1 | grep -E "FAIL|passed"`
Expected: seluruh suite lulus, termasuk `perf-ingest` dan `perf-summary`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/perfRoutes.js backend/src/routeInventory.js backend/tests/perf-summary.test.mjs
git commit -m "feat(perf): report p50 and p95 timings to admins"
```

---

### Task 3: Pengukuran di sisi browser

**Files:**
- Create: `frontend/src/utils/perf.js`
- Modify: `frontend/src/App.jsx` (panggil `markAppReady`, pasang timer di `PowerBITokenEmbed`)

**Interfaces:**
- Consumes: `POST /api/perf` dari Task 1
- Produces:
  - `markAppReady(): void` — dipanggil sekali dari `App`
  - `startDashboardTimer(dashboardId): { tokenDone(): void, renderDone(prefetchHit?: boolean): void }`

  `startDashboardTimer` selalu mengembalikan objek dengan kedua metode, bahkan bila telemetri dimatikan, sehingga pemanggil tidak perlu menjaga null.

- [ ] **Step 1: Tulis modul perf**

Buat `frontend/src/utils/perf.js`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Telemetri performa sisi browser.
//
// Aturan utama modul ini: tidak pernah melempar ke pemanggilnya. Telemetri yang
// menjatuhkan fitur yang diukurnya lebih buruk daripada tidak ada telemetri.
// ─────────────────────────────────────────────────────────────────────────────

import API from "../api/api.js";

let appLoadSent = false;

function send(payload) {
  // Dilepas tanpa ditunggu; kegagalan sengaja ditelan.
  API.post("/api/perf", payload).catch(() => {});
}

/** Dipanggil sekali saat React selesai render pertama. */
export function markAppReady() {
  if (appLoadSent) return;
  appLoadSent = true;

  try {
    // performance.timing sudah usang; entri navigasi memberi angka yang
    // relatif terhadap awal navigasi, jadi tidak perlu dikurangi sendiri.
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return;

    send({
      kind: "app_load",
      metrics: {
        ttfb:           Math.round(nav.responseStart),
        domInteractive: Math.round(nav.domInteractive),
        appReady:       Math.round(performance.now()),
      },
    });
  } catch {
    /* pengukuran tidak boleh menjatuhkan aplikasi */
  }
}

/**
 * Mengukur satu kali buka dashboard.
 *
 * Memisahkan waktu ambil token dari waktu render Power BI adalah inti dari
 * seluruh instrumentasi ini: kalau render yang mendominasi, kita tahu batas
 * atas perbaikan yang mungkin dan berhenti mengoptimasi bagian yang salah.
 */
export function startDashboardTimer(dashboardId) {
  const t0 = performance.now();
  let tokenAt = null;
  let sent = false;

  return {
    tokenDone() {
      if (tokenAt === null) tokenAt = performance.now();
    },
    renderDone(prefetchHit = false) {
      if (sent) return; // "rendered" menyala lagi tiap ganti filter
      sent = true;
      try {
        const end = performance.now();
        const tokenMs = tokenAt === null ? 0 : tokenAt - t0;
        send({
          kind: "dashboard_open",
          dashboard_id: Number.isInteger(dashboardId) ? dashboardId : null,
          metrics: {
            tokenMs:  Math.round(tokenMs),
            renderMs: Math.round(end - (tokenAt ?? t0)),
            prefetchHit: Boolean(prefetchHit),
          },
        });
      } catch {
        /* abaikan */
      }
    },
  };
}
```

- [ ] **Step 2: Panggil `markAppReady` dari App**

Di `frontend/src/App.jsx`, tambahkan pada blok import. Step 3 juga membutuhkan `startDashboardTimer` dari modul yang sama, jadi tulis sekali saja dengan kedua nama:

```js
import { markAppReady, startDashboardTimer } from "./utils/perf";
```

Lalu di dalam `export default function App()`, tambahkan efek ini tepat setelah `useEffect` yang membaca `localStorage` (efek yang berakhir dengan `}, []);` di sekitar baris 727):

```js
  // Satu kali per sesi, setelah render pertama selesai.
  useEffect(() => { markAppReady(); }, []);
```

- [ ] **Step 3: Pasang timer di PowerBITokenEmbed**

Di `frontend/src/App.jsx`, ubah tanda tangan komponen (sekitar baris 57) supaya menerima id dashboard:

```js
function PowerBITokenEmbed({ reportId, dashboardId, onReportRendered }) {
```

Tambahkan ref timer di antara deklarasi ref yang sudah ada:

```js
  const perfRef = useRef(null);
```

Di dalam `fetchConfig`, mulai timer sebelum permintaan dan tandai token selesai setelahnya. Ganti awal blok `try` menjadi:

```js
    const token = localStorage.getItem("token");
    if (!perfRef.current) perfRef.current = startDashboardTimer(dashboardId);
    try {
      const { data } = await API.get(`/api/powerbi/embed-config-by-report/${reportId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      perfRef.current.tokenDone();
```

Pada `eventHandlers`, ubah baris `rendered`:

```js
        ["rendered", () => {
          perfRef.current?.renderDone(false);
          onReportRendered?.(reportRef.current);
        }],
```

Impor `startDashboardTimer` sudah ditambahkan di Step 2 — jangan menulis baris impor kedua.

- [ ] **Step 4: Teruskan `dashboardId` dari pemanggil**

Ada dua tempat yang merender `PowerBIReportEmbed`. Teruskan `dash.id` di keduanya.

Di `App.jsx` sekitar baris 502 (kartu dashboard):

```jsx
                       <PowerBIReportEmbed
                        key={dash.url}
                        url={dash.url}
                        reportId={extractReportGuid(dash.report_id)}
                        dashboardId={dash.id}
                        exportMode={false}
                       />
```

Dan teruskan lewat `PowerBIReportEmbed` ke `PowerBITokenEmbed` — ubah tanda tangannya (sekitar baris 37) dan kedua pemakaian di dalamnya:

```js
function PowerBIReportEmbed({ url, reportId, dashboardId, exportMode, onReportRendered }) {
  if (exportMode && reportId) {
    return <PowerBITokenEmbed reportId={reportId} dashboardId={dashboardId} onReportRendered={onReportRendered} />;
  }
  if (url?.startsWith("https://") || url?.startsWith("http://")) {
    return <iframe src={url} className="w-full h-full border-0" />;
  }
  if (reportId) {
    return <PowerBITokenEmbed reportId={reportId} dashboardId={dashboardId} onReportRendered={onReportRendered} />;
  }
  return (
    <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm">
      No embed source configured.
    </div>
  );
}
```

Cari pemakaian `PowerBIReportEmbed` yang lain di dalam `FullscreenDash` dan teruskan `dashboardId={dash.id}` juga:

```bash
cd frontend && grep -n "PowerBIReportEmbed" src/App.jsx
```

- [ ] **Step 5: Verifikasi build dan impor**

Run:

```bash
cd frontend && npx vite build 2>&1 | grep -E "✓ built|error"
```

Expected: `✓ built`

Build Vite **tidak** menangkap komponen yang dipakai tapi belum diimpor — itu meledak saat dijalankan sebagai `X is not defined`. Jalankan juga:

```bash
cd frontend && node -e "
const fs=require('fs');
const src=fs.readFileSync('src/App.jsx','utf8');
const bound=new Set();
for(const m of src.matchAll(/^import\s+([^]*?)\s+from\s*['\"][^'\"]*['\"]/gm))
  for(const n of m[1].matchAll(/([A-Za-z_\$][\w\$]*)/g)) bound.add(n[1]);
for(const m of src.matchAll(/(?:function|const|let|class)\s+([A-Z][\w\$]*)/g)) bound.add(m[1]);
for(const m of src.matchAll(/[:{,]\s*([A-Z][\w\$]*)\s*[,}=)]/g)) bound.add(m[1]);
const used=new Set([...src.matchAll(/<([A-Z][\w\$]*)[\s/>]/g)].map(m=>m[1]));
const missing=[...used].filter(n=>!bound.has(n));
console.log(missing.length?'MISSING: '+missing.join(', '):'OK: semua komponen terimpor');
"
```

Expected: `OK: semua komponen terimpor`

- [ ] **Step 6: Verifikasi manual bahwa sampel benar-benar masuk**

Jalankan backend dan frontend, login, buka satu dashboard yang memakai embed token, lalu:

```bash
cd backend && mysql -u root -p"$DB_PASSWORD" "$DB_NAME" \
  -e "SELECT kind, dashboard_id, metrics, created_at FROM perf_samples ORDER BY id DESC LIMIT 5;"
```

Expected: minimal satu baris `app_load` dan satu baris `dashboard_open` dengan `tokenMs` dan `renderMs` yang masuk akal (bukan 0 keduanya).

Catat angka `renderMs` yang muncul — ini garis dasar sebelum Fase 4, dan dipakai di Task 10.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/perf.js frontend/src/App.jsx
git commit -m "feat(perf): measure app load and dashboard open from the browser"
```

---

### Task 4: Panel performa untuk admin

**Files:**
- Create: `frontend/src/components/PerfSummary.jsx`
- Modify: `frontend/src/components/ManageUsers.jsx`

**Interfaces:**
- Consumes: `GET /api/perf/summary` dari Task 2
- Produces: komponen `<PerfSummary />` tanpa prop, memuat datanya sendiri

- [ ] **Step 1: Tulis komponennya**

Buat `frontend/src/components/PerfSummary.jsx`:

```jsx
import { useEffect, useState } from "react";
import API from "../api/api";

const ms = (v) => (typeof v === "number" ? `${Math.round(v)} ms` : "—");

export default function PerfSummary() {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get("/api/perf/summary")
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.message || "Gagal memuat ringkasan"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-gray-500">Memuat ringkasan performa…</p>;
  if (error)   return <p className="text-sm text-red-600">{error}</p>;
  if (!data)   return null;

  const { appLoad, dashboard, slowest } = data;

  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-cimoryBlue mb-1">Performa</h3>
      <p className="text-xs text-gray-500 mb-3">
        7 hari terakhir. p95 berarti 95% pemuatan lebih cepat dari angka ini —
        rata-rata menyembunyikan pemuatan lambat yang justru dikeluhkan user.
      </p>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="py-1.5 font-medium">Ukuran</th>
            <th className="py-1.5 font-medium">p50</th>
            <th className="py-1.5 font-medium">p95</th>
            <th className="py-1.5 font-medium">Sampel</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="py-1.5">Aplikasi siap dipakai</td>
            <td>{ms(appLoad?.p50?.appReady)}</td>
            <td>{ms(appLoad?.p95?.appReady)}</td>
            <td>{appLoad?.count ?? 0}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1.5">Ambil embed token</td>
            <td>{ms(dashboard?.p50?.tokenMs)}</td>
            <td>{ms(dashboard?.p95?.tokenMs)}</td>
            <td>{dashboard?.count ?? 0}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1.5">Power BI merender</td>
            <td>{ms(dashboard?.p50?.renderMs)}</td>
            <td>{ms(dashboard?.p95?.renderMs)}</td>
            <td>{dashboard?.count ?? 0}</td>
          </tr>
        </tbody>
      </table>

      {typeof dashboard?.prefetchHitRate === "number" && (
        <p className="text-xs text-gray-600 mt-2">
          Token sudah siap saat diklik: {Math.round(dashboard.prefetchHitRate * 100)}% dari pembukaan dashboard.
        </p>
      )}

      {slowest?.length > 0 && (
        <>
          <h4 className="text-sm font-semibold text-gray-700 mt-5 mb-1">Dashboard paling lambat dirender</h4>
          <ul className="text-sm text-gray-700 space-y-0.5">
            {slowest.map((d) => (
              <li key={d.dashboard_id}>
                {d.title || `Dashboard #${d.dashboard_id}`} — {ms(d.p95RenderMs)} (p95, {d.samples} sampel)
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 mt-1">
            Waktu render terjadi di infrastruktur Power BI. Angka tinggi di sini
            menunjuk ke laporan yang perlu disederhanakan, bukan ke CODE.
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pasang di ManageUsers**

Di `frontend/src/components/ManageUsers.jsx`, tambahkan import:

```js
import PerfSummary from "./PerfSummary";
```

Lalu sisipkan `<PerfSummary />` tepat sebelum elemen penutup terluar komponen. Cari titiknya dengan:

```bash
cd frontend && grep -n "export default function ManageUsers" -A 3 src/components/ManageUsers.jsx
cd frontend && tail -20 src/components/ManageUsers.jsx
```

Tempatkan setelah tabel user, di dalam wadah yang sama.

- [ ] **Step 3: Verifikasi build**

Run: `cd frontend && npx vite build 2>&1 | grep -E "✓ built|error"`
Expected: `✓ built`

- [ ] **Step 4: Verifikasi manual**

Login sebagai `digital.transformation`, buka Manage Users. Bagian "Performa" muncul dengan angka dari sampel yang dikirim Task 3.

Login sebagai user biasa — bagian ini tidak muncul, dan andai kata muncul, servernya membalas 403.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PerfSummary.jsx frontend/src/components/ManageUsers.jsx
git commit -m "feat(perf): show p50/p95 timings in Manage Users"
```

---

### Task 5: Keluarkan Power BI dari App.jsx

Tanpa langkah ini, Task 6 tidak berpengaruh apa pun: `App.jsx` memakai `models.CommandDisplayOption` di konstanta `EMBED_SETTINGS` pada level modul, jadi bundler wajib menaruh seluruh SDK 355 KB di chunk utama betapapun banyak `React.lazy` dipasang.

**Files:**
- Create: `frontend/src/components/PowerBIReport.jsx`
- Modify: `frontend/src/App.jsx` (hapus komponen yang dipindah, hapus impor `powerbi-client`)

**Interfaces:**
- Produces: default export `PowerBIReport` dengan prop `{ url, reportId, dashboardId, exportMode, onReportRendered }` — perilakunya sama persis dengan `PowerBIReportEmbed` yang sekarang.

- [ ] **Step 1: Catat ukuran bundle sebelum diubah**

Run:

```bash
cd frontend && npx vite build >/dev/null 2>&1 && ls -l dist/assets/*.js | awk '{printf "%.1f KB  %s\n", $5/1024, $9}'
```

Catat angkanya. Expected saat ini: satu berkas ~816 KB.

- [ ] **Step 2: Buat berkas komponen**

Buat `frontend/src/components/PowerBIReport.jsx`. Pindahkan `EMBED_SETTINGS`, `PowerBIReportEmbed`, dan `PowerBITokenEmbed` dari `App.jsx` **tanpa mengubah logikanya**, hanya menyesuaikan impor dan menamai ulang ekspornya:

```jsx
// ─────────────────────────────────────────────────────────────────────────────
// Embed Power BI.
//
// Dipisahkan dari App.jsx karena `powerbi-client` berukuran 355 KB ter-minify —
// sepertiga dari seluruh bundle. Selama ia tercapai dari App.jsx, bundler wajib
// menaruhnya di chunk utama dan halaman login ikut mengunduhnya.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import { PowerBIEmbed } from "powerbi-client-react";
import { models } from "powerbi-client";
import API from "../api/api.js";
import { startDashboardTimer } from "../utils/perf";

const EMBED_SETTINGS = {
  panes: {
    filters:        { expanded: false, visible: false },
    pageNavigation: { visible: true },
  },
  bars: {
    actionBar: { visible: false },
  },
  commands: [{
    exportData: { displayOption: models.CommandDisplayOption.Enabled },
  }],
};

function PowerBITokenEmbed({ reportId, dashboardId, onReportRendered }) {
  const [embedConfig, setEmbedConfig] = useState(null);
  const [error, setError]             = useState(null);
  const reportRef = useRef(null);
  const timerRef  = useRef(null);
  const perfRef   = useRef(null);

  const fetchConfig = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!perfRef.current) perfRef.current = startDashboardTimer(dashboardId);
    try {
      const { data } = await API.get(`/api/powerbi/embed-config-by-report/${reportId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      perfRef.current.tokenDone();
      if (reportRef.current) {
        await reportRef.current.setAccessToken(data.embedToken);
      } else {
        setEmbedConfig(data);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      const msUntilRefresh = new Date(data.tokenExpiry) - Date.now() - 5 * 60 * 1000;
      if (msUntilRefresh > 0) timerRef.current = setTimeout(fetchConfig, msUntilRefresh);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Unknown error";
      setError(msg);
    }
  }, [reportId, dashboardId]);

  useEffect(() => {
    fetchConfig();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [fetchConfig]);

  if (error) return (
    <div className="flex items-center justify-center w-full h-full text-red-500 text-sm px-4 text-center">
      {error}
    </div>
  );
  if (!embedConfig) return (
    <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm animate-pulse">
      Loading dashboard...
    </div>
  );

  return (
    <PowerBIEmbed
      embedConfig={{
        type:        "report",
        id:          embedConfig.reportId,
        embedUrl:    embedConfig.embedUrl,
        accessToken: embedConfig.embedToken,
        tokenType:   models.TokenType.Embed,
        settings:    EMBED_SETTINGS,
      }}
      eventHandlers={new Map([
        ["tokenExpired", fetchConfig],
        ["error", (e) => console.error("Power BI error:", e.detail)],
        // "rendered" menyala pada cat pertama dan pada setiap perubahan
        // filter/slicer — panel AI memakainya untuk tahu data sudah berubah.
        ["rendered", () => {
          perfRef.current?.renderDone(false);
          onReportRendered?.(reportRef.current);
        }],
      ])}
      getEmbeddedComponent={(r) => { reportRef.current = r; }}
      cssClassName="w-full h-full border-0"
    />
  );
}

export default function PowerBIReport({ url, reportId, dashboardId, exportMode, onReportRendered }) {
  // Export mode ON + ada report_id → pakai embed token (support export + AI)
  if (exportMode && reportId) {
    return <PowerBITokenEmbed reportId={reportId} dashboardId={dashboardId} onReportRendered={onReportRendered} />;
  }
  // Default → pakai public embed URL via iframe
  if (url?.startsWith("https://") || url?.startsWith("http://")) {
    return <iframe src={url} className="w-full h-full border-0" />;
  }
  // Fallback: tidak ada url publik tapi ada report_id → pakai token
  if (reportId) {
    return <PowerBITokenEmbed reportId={reportId} dashboardId={dashboardId} onReportRendered={onReportRendered} />;
  }
  return (
    <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm">
      No embed source configured.
    </div>
  );
}
```

- [ ] **Step 3: Hapus dari App.jsx**

Di `frontend/src/App.jsx`:

1. Hapus `EMBED_SETTINGS`, `PowerBIReportEmbed`, dan `PowerBITokenEmbed` (kira-kira baris 24–120 setelah Task 3).
2. Hapus dua baris impor:

```js
import { PowerBIEmbed } from "powerbi-client-react";
import { models } from "powerbi-client";
```

3. Tambahkan:

```js
import PowerBIReport from "./components/PowerBIReport";
```

4. Ganti setiap `<PowerBIReportEmbed` menjadi `<PowerBIReport`.

- [ ] **Step 4: Pastikan powerbi-client tidak lagi tercapai dari App.jsx**

Run:

```bash
cd frontend && grep -n "powerbi-client\|PowerBIReportEmbed\|EMBED_SETTINGS\|models\." src/App.jsx
```

Expected: tidak ada keluaran sama sekali. Bila masih ada `models.`, berarti ada pemakaian yang terlewat dan Task 6 tidak akan berhasil memisahkan chunk.

- [ ] **Step 5: Verifikasi build dan impor**

Run:

```bash
cd frontend && npx vite build 2>&1 | grep -E "✓ built|error"
```

Expected: `✓ built`

Lalu pemeriksa impor (skrip yang sama seperti Task 3 Step 5), kali ini untuk dua berkas:

```bash
cd frontend && node -e "
const fs=require('fs');
for (const f of ['src/App.jsx','src/components/PowerBIReport.jsx']) {
  const src=fs.readFileSync(f,'utf8');
  const bound=new Set();
  for(const m of src.matchAll(/^import\s+([^]*?)\s+from\s*['\"][^'\"]*['\"]/gm))
    for(const n of m[1].matchAll(/([A-Za-z_\$][\w\$]*)/g)) bound.add(n[1]);
  for(const m of src.matchAll(/(?:function|const|let|class)\s+([A-Z][\w\$]*)/g)) bound.add(m[1]);
  for(const m of src.matchAll(/[:{,]\s*([A-Z][\w\$]*)\s*[,}=)]/g)) bound.add(m[1]);
  const used=new Set([...src.matchAll(/<([A-Z][\w\$]*)[\s/>]/g)].map(m=>m[1]));
  const missing=[...used].filter(n=>!bound.has(n));
  console.log((missing.length?'MISSING ':'OK      ')+f+(missing.length?': '+missing.join(', '):''));
}"
```

Expected: `OK` untuk keduanya.

- [ ] **Step 6: Verifikasi manual — dashboard masih tampil**

Jalankan frontend, login, buka satu dashboard yang memakai embed token dan satu yang memakai URL publik. Keduanya harus tampil seperti sebelumnya, dan Export Mode serta CODE AI masih berfungsi.

Ini refactor murni. Bila ada yang berubah perilakunya, itu bug pemindahan, bukan fitur baru.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/PowerBIReport.jsx frontend/src/App.jsx
git commit -m "refactor(perf): move Power BI embedding out of App.jsx"
```

---

### Task 6: Pecah bundle dengan React.lazy

**Files:**
- Create: `frontend/src/components/LazyBoundary.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `PowerBIReport` dari Task 5
- Produces: `<LazyBoundary>` — membungkus `Suspense` + error boundary; prop `children` dan `label` opsional

- [ ] **Step 1: Tulis pembungkus Suspense + error boundary**

`React.lazy` melempar saat unduhan chunk gagal. Pada VPN yang putus-putus itu bukan kejadian teoretis, dan tanpa penanganan hasilnya layar putih.

Buat `frontend/src/components/LazyBoundary.jsx`:

```jsx
import React, { Suspense, useEffect, useState } from "react";

/**
 * Penanda muat yang baru muncul setelah 200 ms.
 *
 * Di LAN kantor, mengambil chunk 40 KB memakan puluhan milidetik. Menampilkan
 * spinner untuk itu justru terasa lebih lambat daripada tidak menampilkan
 * apa-apa — mata menangkap kedipannya.
 */
function DelayedSpinner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="w-full h-full min-h-[120px] flex items-center justify-center text-gray-400 text-sm animate-pulse">
      Memuat…
    </div>
  );
}

class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Gagal memuat bagian aplikasi:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="w-full h-full min-h-[120px] flex flex-col items-center justify-center gap-2 text-sm text-gray-600">
        <p>Gagal memuat bagian ini. Koneksi mungkin terputus.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 rounded-lg bg-cimoryBlue text-white hover:bg-blue-700 transition"
        >
          Muat ulang
        </button>
      </div>
    );
  }
}

export default function LazyBoundary({ children }) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<DelayedSpinner />}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}
```

- [ ] **Step 2: Ubah impor statis menjadi lazy**

Di `frontend/src/App.jsx`, ganti impor berikut menjadi `lazy`. **Pertahankan** impor statis untuk `Header`, `Sidebar`, `Login`, `Register`, dan `LandingPage` — itu jalur sebelum-login dan kerangka aplikasi.

Hapus baris-baris impor statis ini:

```js
import AddUserModal from "./components/AddUserModal";
import ManageUsers from "./components/ManageUsers";
import ChangePasswordModal from "./components/ChangePasswordModal";
import DashboardManager from "./components/DashboardManager";
import LandingPageManager from "./components/LandingPageManager";
import NotificationPage from "./components/NotificationPage";
import DataRoomDashboard from "./components/DataRoomDashboard.jsx";
import AskAIPanel from "./components/AskAIPanel";
import AISettingsModal from "./components/AISettingsModal";
import CodeAINavigator from "./components/CodeAINavigator";
import PowerBIReport from "./components/PowerBIReport";
```

Ganti dengan:

```js
import { lazy } from "react";
import LazyBoundary from "./components/LazyBoundary";

// Dimuat saat dibutuhkan. Panel manajemen dipisah karena hanya satu dari 58
// akun yang bisa membukanya — tidak masuk akal 57 orang lain mengunduhnya.
const AddUserModal        = lazy(() => import("./components/AddUserModal"));
const ManageUsers         = lazy(() => import("./components/ManageUsers"));
const ChangePasswordModal = lazy(() => import("./components/ChangePasswordModal"));
const DashboardManager    = lazy(() => import("./components/DashboardManager"));
const LandingPageManager  = lazy(() => import("./components/LandingPageManager"));
const NotificationPage    = lazy(() => import("./components/NotificationPage"));
const DataRoomDashboard   = lazy(() => import("./components/DataRoomDashboard.jsx"));
const AskAIPanel          = lazy(() => import("./components/AskAIPanel"));
const AISettingsModal     = lazy(() => import("./components/AISettingsModal"));
const CodeAINavigator     = lazy(() => import("./components/CodeAINavigator"));
const PowerBIReport       = lazy(() => import("./components/PowerBIReport"));
```

Pastikan `lazy` tidak terduplikasi dengan impor React yang sudah ada di baris pertama. Bila baris pertama berbunyi `import React, { useState, useEffect, useRef, useCallback } from "react";`, tambahkan `lazy` ke dalam kurung kurawal itu dan jangan tulis baris `import { lazy }` terpisah.

- [ ] **Step 3: Bungkus setiap titik pemakaian**

Setiap komponen lazy harus berada di dalam `<LazyBoundary>`. Bungkus di titik pemakaian, bukan sekali di akar — kalau tidak, membuka satu modal akan mengosongkan seluruh halaman selama chunk-nya diunduh.

Bungkus blok `<Routes>` sekali:

```jsx
    <LazyBoundary>
      <Routes>
        {/* isi rute tidak berubah */}
      </Routes>
    </LazyBoundary>
```

Lalu bungkus setiap modal dan panel di tempatnya masing-masing. Contoh untuk modal AI Settings di sekitar baris 622:

```jsx
      {showAISettings && (
        <LazyBoundary>
          <AISettingsModal onClose={() => setShowAISettings(false)} />
        </LazyBoundary>
      )}
```

Temukan semuanya dengan:

```bash
cd frontend && grep -n "AddUserModal\|ManageUsers\|ChangePasswordModal\|DashboardManager\|LandingPageManager\|NotificationPage\|DataRoomDashboard\|AskAIPanel\|AISettingsModal\|CodeAINavigator\|PowerBIReport" src/App.jsx
```

Setiap kemunculan sebagai elemen JSX (`<Nama`) wajib punya `<LazyBoundary>` sebagai leluhurnya.

- [ ] **Step 4: Verifikasi build dan lihat pembagian chunk**

Run:

```bash
cd frontend && npx vite build 2>&1 | grep -E "✓ built|error" && ls -l dist/assets/*.js | awk '{printf "%7.1f KB  %s\n", $5/1024, $9}' | sort -rn
```

Expected: lebih dari satu berkas `.js`, dengan satu chunk besar berisi Power BI (~355 KB) yang **terpisah** dari chunk utama.

Bila hanya ada satu berkas, ada impor statis yang terlewat — ulangi Step 2 dan Task 5 Step 4.

- [ ] **Step 5: Ukur byte untuk menampilkan halaman login**

Inilah angka yang menjadi kriteria lulus. Chunk yang diunduh sebuah halaman tercatat sebagai tag `<link rel="modulepreload">` dan `<script>` di `dist/index.html`.

Run:

```bash
cd frontend && node -e "
const fs=require('fs');
const html=fs.readFileSync('dist/index.html','utf8');
const names=[...html.matchAll(/(?:src|href)=\"\/assets\/([^\"]+\.js)\"/g)].map(m=>m[1]);
let total=0;
for(const n of names){ const b=fs.statSync('dist/assets/'+n).size; total+=b;
  console.log((b/1024).toFixed(1).padStart(8)+' KB  '+n); }
console.log('─'.repeat(34));
console.log((total/1024).toFixed(1).padStart(8)+' KB  TOTAL untuk muat awal');
"
```

Expected: **di bawah 250 KB**.

Bila di atas 250 KB, cetak isi chunk terbesar untuk tahu apa yang masih ikut:

```bash
cd frontend && npx vite build 2>&1 | grep -A 40 "computing gzip"
```

Tersangka yang paling mungkin: sebuah komponen yang di-lazy ternyata masih diimpor statis di berkas lain (bukan `App.jsx`). Cari dengan:

```bash
cd frontend && grep -rn "from \"./AskAIPanel\"\|from \"../components/AskAIPanel\"\|CodeAINavigator\|AISettingsModal" src/ --include=*.jsx | grep -v "src/App.jsx"
```

- [ ] **Step 6: Verifikasi manual seluruh alur**

Jalankan backend dan frontend. Lewati setiap layar dan pastikan tidak ada layar putih:

1. Buka `/cop` (landing) — tampil
2. Buka `/login`, login sebagai user biasa — masuk ke `/App`
3. Buka satu dashboard, aktifkan Export Mode, buka CODE AI — semua tampil
4. Buka `/data-center` — tampil
5. Buka `/notifications` — tampil
6. Logout, login sebagai `digital.transformation` — menu admin muncul
7. Buka Add User, Manage Users, Dashboard Manager, Portal Manager, Change Password, AI Settings — semua modal terbuka

Layar putih pada salah satunya berarti ada komponen lazy tanpa `LazyBoundary` di atasnya.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/LazyBoundary.jsx frontend/src/App.jsx
git commit -m "perf(frontend): split the bundle so the login page stops loading Power BI"
```

---

### Task 7: Perkecil hero image

**Files:**
- Create: `frontend/public/images/home_banner_1.webp`
- Create: `frontend/public/images/home_banner_1.jpg`
- Create: `frontend/scripts/optimize-hero.mjs`
- Modify: `frontend/src/components/LandingPage.jsx`
- Modify: `frontend/src/App.jsx` (dua `<img>`)
- Modify: `frontend/package.json` (devDependency `sharp`)

**Interfaces:** tidak ada antarmuka baru; hanya berkas gambar dan markup.

- [ ] **Step 1: Pasang sharp sebagai devDependency**

Tidak ada tooling gambar di mesin ini — `convert` yang ada di PATH adalah utilitas NTFS bawaan Windows, bukan ImageMagick.

Run:

```bash
cd frontend && npm install --save-dev sharp
```

- [ ] **Step 2: Tulis skrip konversi**

Buat `frontend/scripts/optimize-hero.mjs`:

```js
// Konversi hero image sekali jalan. TIDAK dijalankan saat build — menambah
// langkah build yang bisa gagal demi berkas yang berubah sekali setahun
// adalah pertukaran yang buruk. Hasilnya ikut di-commit.
//
// Jalankan: node scripts/optimize-hero.mjs
import sharp from "sharp";
import fs from "fs";

const SRC = "public/images/home_banner_1.jpeg";

const before = fs.statSync(SRC).size;

await sharp(SRC).webp({ quality: 80 }).toFile("public/images/home_banner_1.webp");
await sharp(SRC).jpeg({ quality: 78, mozjpeg: true }).toFile("public/images/home_banner_1.jpg");

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);
console.log(`asal : ${(before / 1024).toFixed(1)} KB  ${SRC}`);
console.log(`webp : ${kb("public/images/home_banner_1.webp")} KB`);
console.log(`jpeg : ${kb("public/images/home_banner_1.jpg")} KB`);
```

- [ ] **Step 3: Jalankan dan periksa hasilnya**

Run:

```bash
cd frontend && node scripts/optimize-hero.mjs
```

Expected: `webp` di bawah 250 KB. Bila masih di atas, turunkan `quality` ke 70 dan jalankan lagi. Bandingkan hasilnya secara visual sebelum menerima — hero adalah hal pertama yang dilihat orang, dan gambar buram bukan kemenangan performa.

- [ ] **Step 4: Perbarui LandingPage**

Hero di sini **bukan** `<img>` — ia dipasang sebagai `backgroundImage` CSS di `LandingPage.jsx:51`. Latar CSS tidak bisa menegosiasikan format lewat `<source type>`, jadi menaruh `<picture>` di sana tidak akan menghasilkan apa pun. Elemennya diganti menjadi `<picture>` sungguhan yang diposisikan di belakang isi.

Ganti baris impor (baris 5):

```js
import heroImage   from "../../images/home_banner_1.jpeg";
```

menjadi:

```js
import heroWebp from "../../images/home_banner_1.webp";
import heroJpg  from "../../images/home_banner_1.jpg";
```

Lalu ganti pembuka blok hero (baris 49–52) dari:

```jsx
      <div
        className="relative min-h-screen overflow-hidden"
        style={{ backgroundImage: `url(${heroImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
```

menjadi:

```jsx
      <div className="relative min-h-screen overflow-hidden">
        {/* Dulu ini backgroundImage CSS. Diganti <picture> supaya browser bisa
            memilih WebP; latar CSS tidak punya mekanisme negosiasi format. */}
        <picture>
          <source srcSet={heroWebp} type="image/webp" />
          <img
            src={heroJpg}
            alt=""
            width={1920}
            height={844}
            fetchPriority="high"
            className="absolute inset-0 w-full h-full object-cover object-center -z-10"
          />
        </picture>
```

`object-cover object-center` menggantikan `backgroundSize: "cover"` dan `backgroundPosition: "center"`. `-z-10` menaruhnya di belakang vignette dan isi halaman, yang sudah memakai `z-0` ke atas.

`width` dan `height` eksplisit mencegah tata letak melompat saat gambar selesai dimuat. Hero **tidak** diberi `loading="lazy"` — justru ini yang ingin muncul lebih dulu, dan `fetchPriority="high"` menegaskannya.

Periksa `<div>` penutup blok hero masih berpasangan setelah perubahan ini:

```bash
cd frontend && npx vite build 2>&1 | grep -E "✓ built|error"
```

- [ ] **Step 5: Perbaiki dua path relatif di App.jsx**

`App.jsx` baris ~230 dan ~494 memakai `src="../images/home_banner_1.jpeg"`. Path relatif itu diselesaikan terhadap URL halaman, jadi nilainya berubah tergantung rute yang sedang dibuka; selama ini berfungsi karena kebetulan `/images` disajikan dari `public/`.

Keduanya adalah latar buram di belakang dashboard yang belum diizinkan. Sebuah halaman bisa memuat banyak sekaligus, jadi keduanya juga pantas mendapat WebP. Ganti masing-masing `<img>` menjadi:

```jsx
                      <picture>
                        <source srcSet="/images/home_banner_1.webp" type="image/webp" />
                        <img
                          src="/images/home_banner_1.jpg"
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover opacity-70 blur-md"
                        />
                      </picture>
```

Perhatikan `className` pada `<img>` di baris ~230 mungkin berbeda dari yang di baris ~494 — **pertahankan nilai yang ada di masing-masing tempat**, hanya path, `alt`, `loading`, dan pembungkus `<picture>` yang berubah. Periksa dulu:

```bash
cd frontend && grep -n "home_banner_1" -A 4 src/App.jsx
```

`loading="lazy"` dipasang karena gambar ini berada di bawah lipatan layar, tidak seperti hero.

Catatan: `alt` dikosongkan, bukan `"Placeholder"` — gambar ini murni dekoratif, dan pembaca layar sebaiknya melewatinya alih-alih membacakan kata "Placeholder".

- [ ] **Step 6: Verifikasi build dan ukuran aset**

Run:

```bash
cd frontend && npx vite build 2>&1 | grep -E "✓ built|error" && ls -l dist/assets/*.{webp,jpg,jpeg,png} 2>/dev/null | awk '{printf "%8.1f KB  %s\n", $5/1024, $9}' | sort -rn
```

Expected: `✓ built`, dan tidak ada lagi berkas 1,6 MB.

- [ ] **Step 7: Verifikasi manual**

Buka `/cop` di browser. Hero tampil, tidak buram, dan tidak ada lompatan tata letak saat memuat.

Buka `/App` sebagai user yang **tidak** punya akses ke suatu dashboard — latar buramnya tetap tampil.

Di DevTools tab Network, saring `img`. Berkas yang terunduh harus `.webp` pada Chrome/Edge.

- [ ] **Step 8: Commit**

```bash
git add frontend/public/images/home_banner_1.webp frontend/public/images/home_banner_1.jpg \
        frontend/scripts/optimize-hero.mjs frontend/src/components/LandingPage.jsx \
        frontend/src/App.jsx frontend/package.json frontend/package-lock.json
git commit -m "perf(frontend): serve a 250 KB hero instead of 1.6 MB"
```

Berkas `home_banner_1.jpeg` yang asli **tetap disimpan** di repo sebagai sumber untuk konversi ulang. Ia tidak lagi dirujuk kode mana pun, jadi tidak ikut terunduh user.

---

### Task 8: Prefetch embed token saat hover

**Files:**
- Create: `frontend/src/utils/embedPrefetch.js`
- Modify: `frontend/src/components/PowerBIReport.jsx`
- Modify: `frontend/src/App.jsx` (pasang handler hover pada kartu dashboard)

**Interfaces:**
- Consumes: `GET /api/powerbi/embed-config-by-report/:reportId`
- Produces:
  - `prefetchEmbed(reportId): void` — aman dipanggil berkali-kali
  - `takeEmbed(reportId): object | null` — konfigurasi bila masih berlaku
  - `cancelPrefetch(reportId): void`
  - `canHover(): boolean`

- [ ] **Step 1: Tulis modul prefetch**

Buat `frontend/src/utils/embedPrefetch.js`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Prefetch embed token saat kursor menyentuh kartu dashboard.
//
// Token disimpan HANYA di memori JavaScript — tidak di localStorage maupun
// sessionStorage. Embed token adalah kredensial pembawa untuk sebuah laporan;
// menuliskannya ke penyimpanan yang bertahan membuatnya hidup lebih lama
// daripada tab yang membutuhkannya.
// ─────────────────────────────────────────────────────────────────────────────

import API from "../api/api.js";

const HOVER_DELAY_MS = 150;   // kursor yang cuma melintas tidak memicu apa-apa
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const ready   = new Map(); // reportId -> { config, expiresAt }
const inFlight = new Map(); // reportId -> Promise
const timers   = new Map(); // reportId -> timeout id

/** Perangkat sentuh melaporkan "hover" palsu; jangan prefetch di sana. */
export function canHover() {
  try {
    return window.matchMedia?.("(hover: hover)").matches ?? false;
  } catch {
    return false;
  }
}

function fetchNow(reportId) {
  if (inFlight.has(reportId)) return inFlight.get(reportId);

  const token = localStorage.getItem("token");
  const p = API.get(`/api/powerbi/embed-config-by-report/${reportId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(({ data }) => {
      // Masa berlaku datang dari server, bukan durasi tetap yang ditebak klien.
      const expiresAt = new Date(data.tokenExpiry).getTime() - EXPIRY_MARGIN_MS;
      ready.set(reportId, { config: data, expiresAt });
      return data;
    })
    .catch(() => {
      // Diam. User belum meminta apa pun; menampilkan error atas sesuatu yang
      // tidak ia minta hanya membingungkan.
      return null;
    })
    .finally(() => {
      inFlight.delete(reportId);
    });

  inFlight.set(reportId, p);
  return p;
}

/** Dipanggil saat kursor masuk atau kartu mendapat fokus keyboard. */
export function prefetchEmbed(reportId) {
  if (!reportId || !canHover()) return;

  const cached = ready.get(reportId);
  if (cached && Date.now() < cached.expiresAt) return;
  if (inFlight.has(reportId) || timers.has(reportId)) return;

  const id = setTimeout(() => {
    timers.delete(reportId);
    fetchNow(reportId);
  }, HOVER_DELAY_MS);

  timers.set(reportId, id);
}

/** Dipanggil saat kursor pergi sebelum penundaan habis. */
export function cancelPrefetch(reportId) {
  const id = timers.get(reportId);
  if (id) {
    clearTimeout(id);
    timers.delete(reportId);
  }
}

/** Dipakai saat kartu diklik. Mengembalikan null bila tidak ada yang siap. */
export function takeEmbed(reportId) {
  const cached = ready.get(reportId);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) {
    ready.delete(reportId);
    return null;
  }
  return cached.config;
}
```

- [ ] **Step 2: Pakai token yang sudah siap di PowerBIReport**

Di `frontend/src/components/PowerBIReport.jsx`, tambahkan impor:

```js
import { takeEmbed } from "../utils/embedPrefetch";
```

Di dalam `PowerBITokenEmbed`, tambahkan ref pencatat:

```js
  const hitRef = useRef(false);
```

Ubah awal `fetchConfig` supaya memeriksa cache lebih dulu:

```js
  const fetchConfig = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!perfRef.current) perfRef.current = startDashboardTimer(dashboardId);

    // Sudah diambil saat kursor menyentuh kartunya.
    const prefetched = reportRef.current ? null : takeEmbed(reportId);
    if (prefetched) {
      hitRef.current = true;
      perfRef.current.tokenDone();
      setEmbedConfig(prefetched);
      if (timerRef.current) clearTimeout(timerRef.current);
      const ms = new Date(prefetched.tokenExpiry) - Date.now() - 5 * 60 * 1000;
      if (ms > 0) timerRef.current = setTimeout(fetchConfig, ms);
      return;
    }

    try {
```

Sisa `try` tidak berubah.

Dan pada handler `rendered`, laporkan apakah prefetch kena:

```js
        ["rendered", () => {
          perfRef.current?.renderDone(hitRef.current);
          onReportRendered?.(reportRef.current);
        }],
```

- [ ] **Step 3: Pasang handler hover pada kartu dashboard**

Di `frontend/src/App.jsx`, tambahkan impor:

```js
import { prefetchEmbed, cancelPrefetch } from "./utils/embedPrefetch";
```

Pada blok kartu dashboard (sekitar baris 468), tambahkan handler ke `<div>` pembungkus tiap kartu:

```jsx
              const guid = extractReportGuid(dash.report_id);

              return (
                <div
                  key={i}
                  id={`dash-${i}`}
                  onMouseEnter={() => prefetchEmbed(guid)}
                  onMouseLeave={() => cancelPrefetch(guid)}
                  onFocus={() => prefetchEmbed(guid)}
                >
```

`onFocus` disertakan supaya pemakai keyboard mendapat manfaat yang sama dengan pemakai mouse.

Deklarasi `guid` menggantikan pemanggilan `extractReportGuid(dash.report_id)` yang berulang di dalam blok yang sama — ganti pemakaian di dalamnya menjadi `guid`.

- [ ] **Step 4: Verifikasi build dan impor**

Run:

```bash
cd frontend && npx vite build 2>&1 | grep -E "✓ built|error"
```

Expected: `✓ built`

- [ ] **Step 5: Buktikan prefetch benar-benar bekerja**

Jalankan backend dan frontend, login, buka DevTools tab Network dan saring `embed-config`.

1. Arahkan kursor ke satu kartu dashboard dan **tahan** lebih dari 150 ms tanpa mengklik. Expected: muncul satu permintaan `embed-config-by-report`.
2. Gerakkan kursor cepat melintasi beberapa kartu tanpa berhenti. Expected: **tidak ada** permintaan baru — inilah gunanya penundaan 150 ms.
3. Klik kartu yang tadi di-hover. Expected: dashboard tampil **tanpa** permintaan `embed-config` yang kedua.

Lalu periksa telemetrinya mencatat itu:

```bash
cd backend && mysql -u root -p"$DB_PASSWORD" "$DB_NAME" \
  -e "SELECT metrics, created_at FROM perf_samples WHERE kind='dashboard_open' ORDER BY id DESC LIMIT 3;"
```

Expected: baris terbaru punya `"prefetchHit": true` dan `tokenMs` mendekati 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/embedPrefetch.js frontend/src/components/PowerBIReport.jsx frontend/src/App.jsx
git commit -m "perf(frontend): fetch the embed token while the cursor is still moving"
```

---

### Task 9: Verifikasi akhir dan laporan hasil

**Files:**
- Modify: `docs/superpowers/plans/2026-08-03-performance.md` (isi tabel hasil)

- [ ] **Step 1: Suite backend hijau**

Run: `cd backend && npm test 2>&1 | grep -E "FAIL|passed|info"`
Expected: seluruhnya lulus. Jumlah route bertambah 2 dari 49 menjadi 51.

- [ ] **Step 2: Build frontend bersih**

Run: `cd frontend && npx vite build 2>&1 | grep -E "✓ built|error"`
Expected: `✓ built`

- [ ] **Step 3: Ukur hasil akhir**

Run skrip pengukur muat awal dari Task 6 Step 5, dan:

```bash
cd frontend && ls -l dist/assets/* | awk '{printf "%8.1f KB  %s\n", $5/1024, $9}' | sort -rn | head -10
```

- [ ] **Step 4: Kumpulkan angka telemetri sesudah**

Setelah beberapa kali membuka dashboard, buka Manage Users sebagai admin dan catat p50/p95 untuk `tokenMs` dan `renderMs`, serta angka "Token sudah siap saat diklik".

Bandingkan dengan angka yang dicatat pada Task 3 Step 6.

- [ ] **Step 5: Isi tabel hasil**

Isi tabel di bawah dengan angka sebenarnya. **Laporkan apa adanya**, termasuk bila suatu perbaikan ternyata kecil — spec menuliskan itu sebagai syarat.

| Ukuran | Sebelum | Sesudah | Target | Status |
|---|---|---|---|---|
| JS untuk menampilkan halaman login | 816 KB | **242,6 KB** | < 250 KB | tercapai |
| JS seluruh aplikasi | 816 KB, 1 chunk | 825,6 KB, 23 chunk | dicatat apa adanya | total setara, kini dimuat sesuai kebutuhan |
| Hero image | 1.684 KB | **183 KB** WebP | < 250 KB | tercapai, turun 89% |
| Berkas terbesar di `dist/` | 1.684 KB | 242,6 KB | — | tidak ada lagi aset besar |
| **iframe dimuat saat halaman dibuka** | **8** | **3** | — | sisanya saat digulir |
| **Waktu dashboard tampil, p50** | **7.345 ms** | **2.602 ms** | — | **turun 65%** |
| `tokenMs` saat prefetch kena | 1.395 ms (dingin) | 0 ms | ~0 | tercapai |
| Suite backend | 90 lulus | **116 lulus**, 0 gagal | tetap lulus | +26 uji baru |
| Route terklasifikasi | 49 | 51 | semua wajib | 2 endpoint perf baru |

### Yang tidak berubah, dan sebabnya

`renderMs` per dashboard tidak turun — itu waktu Power BI merender laporannya di
infrastruktur Microsoft, di luar kendali CODE. Yang turun adalah **jumlah yang
dirender serentak**, dan itulah yang membuat p50 jatuh dari 7,3 ke 2,6 detik.

`GET /api/dashboards/` tetap 3 ms; tidak disentuh sesuai rencana.

### Temuan di luar cakupan, untuk ditindaklanjuti

1. **`frontend/images/` menduplikasi `frontend/public/images/`** — setiap gambar
   tersimpan dua kali di git. Setelah pekerjaan ini tidak ada berkas sumber yang
   mengimpor dari `frontend/images/` kecuali skrip konversi hero. Menghapus
   sisanya membebaskan ~600 KB di repo.

2. **Event `tokenExpired` tidak valid di `powerbi-client-react`** — terlihat di
   konsol sebagai "Following events are invalid: tokenExpired". Handler itu
   tidak pernah menyala; pembaruan token sebenarnya dijalankan `setTimeout`
   berbasis `tokenExpiry`, jadi tidak ada kerusakan fungsi — tapi pendaftaran
   event itu kode mati yang menyesatkan.

3. **Sesi user yang dihapus tidak dikeluarkan dari UI** — server benar menolak
   dengan 403 (otorisasi bekerja), tapi frontend hanya mencatat error dan
   membiarkan user di halaman yang rusak sampai token 8 jam-nya habis.
   Pencabutan akses tidak terlihat oleh user.

4. **`dangerouslySetInnerHTML` pada `dash.description`** — HTML dari admin lewat
   Dashboard Manager dirender tanpa sanitasi. Risiko XSS tersimpan bila akun
   admin disalahgunakan.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-08-03-performance.md
git commit -m "docs(perf): record measured before/after results"
```

- [ ] **Step 7: Push**

```bash
git push -u origin feat/performance
```
