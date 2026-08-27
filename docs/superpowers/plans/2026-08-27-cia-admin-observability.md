# CIA Admin & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat halaman khusus Admin CIA dan telemetry kanonis agar frekuensi penggunaan, token input/output, latency, kegagalan retrieval, user, departemen, dashboard, surface, dan rentang tanggal dapat dianalisis secara lengkap.

**Architecture:** Setiap permintaan CIA membuat satu baris `cia_requests`; tahapan AI/retrieval membuat baris berurutan di `cia_request_events`. Writer dibuat best-effort agar kegagalan analytics tidak mematahkan jawaban user. API Admin membaca agregasi terparameterisasi dari dua tabel ini dan mempertahankan endpoint user lama sebagai compatibility adapter. UI baru `/admin/cia` menjadi control plane dengan tab Overview, Usage, Retrieval Health, Access, dan Settings.

**Tech Stack:** Node.js ESM, Express, MySQL 8/mysql2, React 18, React Router, native SVG/CSS charts, Tailwind, Node test harness.

## Global Constraints

- Ikuti PRD dan roadmap tanggal 2026-08-27.
- `request_uuid` dibuat di application layer dengan `crypto.randomUUID()`.
- Telemetry tidak menyimpan pertanyaan utuh. Simpan maksimal 300 karakter dan fingerprint SHA-256.
- Error disanitasi melalui allowlist field; jangan serialisasi Axios config/response karena dapat memuat credential.
- Penulisan telemetry tidak boleh mengubah status HTTP jawaban CIA bila database analytics gagal.
- Semua query filter memakai placeholder MySQL. Daftar `GROUP BY`/sort berasal dari constant internal, bukan query string.
- Timestamp database disimpan UTC; boundary filter dari UI dikirim ISO dan ditampilkan `Asia/Jakarta` di frontend.
- Analytics baru tidak mengubah `ai_chat_logs` atau `ai_unified_turns`; backfill membaca keduanya secara idempotent.
- `cia_access` tetap deny-by-default dan Admin tidak otomatis memiliki akses CIA.

## File Structure

### Backend

- Create `backend/migrations/add_cia_observability.sql` — tabel request/event dan indeks.
- Create `backend/src/models/ciaTelemetryModel.js` — write lifecycle + aggregate queries.
- Create `backend/src/services/ciaTelemetry.service.js` — sanitasi dan best-effort tracker.
- Create `backend/src/services/ciaAdminAnalytics.service.js` — normalisasi filter/shape API.
- Create `backend/src/routes/adminCiaRoutes.js` — endpoint Admin CIA.
- Create `backend/scripts/backfill-cia-telemetry.mjs` — backfill log lama.
- Create `backend/tests/cia-telemetry.test.mjs`.
- Create `backend/tests/cia-admin-analytics.test.mjs`.
- Modify `backend/src/server.js` — mount `/api/admin/cia`.
- Modify `backend/src/controllers/aiController.js` — lifecycle telemetry pada CIA dashboard.
- Modify `backend/src/controllers/aiController.js` method `unifiedAsk` — lifecycle Multi-Chat.
- Modify `backend/package.json` — script backfill.

### Frontend

- Create `frontend/src/services/ciaAdminApi.js`.
- Create `frontend/src/components/admin/CiaAdminPage.jsx`.
- Create `frontend/src/components/admin/CiaAnalyticsFilters.jsx`.
- Create `frontend/src/components/admin/CiaOverviewTab.jsx`.
- Create `frontend/src/components/admin/CiaUsageTab.jsx`.
- Create `frontend/src/components/admin/CiaHealthTab.jsx`.
- Create `frontend/src/components/admin/CiaAccessTab.jsx`.
- Create `frontend/src/components/admin/CiaSettingsTab.jsx`.
- Create `frontend/tests/cia-admin-page.test.mjs`.
- Modify `frontend/src/App.jsx` — lazy route `/admin/cia` dan admin guard.
- Modify `frontend/src/components/header.jsx` — satu menu Admin CIA.
- Modify `frontend/src/components/ManageUsers.jsx` — hilangkan kontrol CIA dari form umum setelah tab baru aktif.
- Modify `frontend/package.json` — masukkan test baru pada script `test`.

---

### Task 1: Schema observability yang idempotent

**Files:**
- Create: `backend/migrations/add_cia_observability.sql`
- Test: `backend/tests/cia-telemetry.test.mjs`

**Interfaces:**
- Consumes: `users.id`, `dashboards.id` bila tersedia.
- Produces: tabel `cia_requests`, `cia_request_events`; unique `(legacy_source, legacy_id)`.

- [ ] **Step 1: Tulis test schema yang gagal**

Test membaca `information_schema` dan menegaskan kolom/indeks penting:

```js
const requiredRequestColumns = [
  "request_uuid", "user_id", "actor_name", "department", "surface",
  "question_preview", "question_fingerprint", "status", "retrieval_method",
  "input_tokens", "output_tokens", "total_tokens", "latency_ms",
  "retrieval_rounds", "started_at", "finished_at", "legacy_source", "legacy_id",
];
const requiredEventColumns = [
  "request_id", "sequence_no", "stage", "dashboard_id", "semantic_model",
  "provider", "ai_model", "input_tokens", "output_tokens", "total_tokens",
  "latency_ms", "rows_returned", "status", "error_code", "error_message",
  "metadata_json", "created_at",
];
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `cd backend; node tests/cia-telemetry.test.mjs`

Expected: FAIL karena tabel belum ada.

- [ ] **Step 3: Buat migrasi**

Gunakan `VARCHAR`, bukan enum, agar surface/stage dapat bertambah. Foreign key user/dashboard memakai `ON DELETE SET NULL`. Indeks minimum:

```sql
KEY idx_cia_requests_started (started_at),
KEY idx_cia_requests_user_started (user_id, started_at),
KEY idx_cia_requests_department_started (department, started_at),
KEY idx_cia_requests_surface_status (surface, status),
UNIQUE KEY uq_cia_requests_uuid (request_uuid),
UNIQUE KEY uq_cia_requests_legacy (legacy_source, legacy_id)
```

Event mempunyai `FOREIGN KEY (request_id) ... ON DELETE CASCADE`, indeks `(request_id, sequence_no)`, `(dashboard_id, created_at)`, `(stage, status, created_at)`.

- [ ] **Step 4: Jalankan migrasi dua kali dan test**

Run dari root, masing-masing sebagai command terpisah:

```powershell
bash scripts/migrate.sh
bash scripts/migrate.sh
cd backend
node tests/cia-telemetry.test.mjs
```

Expected: kedua migrasi exit 0; test PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/migrations/add_cia_observability.sql backend/tests/cia-telemetry.test.mjs
git commit -m "feat(cia): add request observability schema"
```

---

### Task 2: Model lifecycle request dan event

**Files:**
- Create: `backend/src/models/ciaTelemetryModel.js`
- Modify: `backend/tests/cia-telemetry.test.mjs`

**Interfaces:**
- Produces:
  - `insertRequest(input) -> Promise<{ id, requestId }>`
  - `insertEvent(requestDbId, event) -> Promise<number>`
  - `finishRequest(requestDbId, summary) -> Promise<void>`
  - `findRequestTrace(requestUuid) -> Promise<{ request, events } | null>`

- [ ] **Step 1: Tulis lifecycle test yang gagal**

Test membuat request, dua event, menyelesaikan request, membaca trace, lalu menghapus fixture. Tegaskan `sequenceNo` 1 dan 2 serta token summary 10/5/15.

- [ ] **Step 2: Implementasi query parameterized**

Gunakan signature eksplisit berikut:

```js
export async function insertRequest({
  requestId, userId = null, actorName = null, department = null,
  surface, conversationRef = null, questionPreview, questionFingerprint,
  startedAt = new Date(), legacySource = null, legacyId = null,
}) {}

export async function insertEvent(requestDbId, {
  sequenceNo, stage, dashboardId = null, dashboardName = null,
  semanticModel = null, provider = null, aiModel = null,
  inputTokens = 0, outputTokens = 0, totalTokens = 0,
  latencyMs = null, rowsReturned = null, status = "success",
  errorCode = null, errorMessage = null, metadata = null,
}) {}
```

`finishRequest` harus mengisi status, retrieval method, token totals, latency, rounds, dan `finished_at` dalam satu UPDATE.

- [ ] **Step 3: Jalankan test**

Run: `cd backend; node tests/cia-telemetry.test.mjs`

Expected: PASS dan fixture terhapus.

- [ ] **Step 4: Commit**

```powershell
git add backend/src/models/ciaTelemetryModel.js backend/tests/cia-telemetry.test.mjs
git commit -m "feat(cia): persist request and event telemetry"
```

---

### Task 3: Best-effort telemetry tracker dan sanitasi error

**Files:**
- Create: `backend/src/services/ciaTelemetry.service.js`
- Create: `backend/tests/cia-telemetry-sanitizer.test.mjs`

**Interfaces:**
- Produces:
  - `startCiaTelemetry(envelope) -> Promise<CiaTelemetryTracker>`
  - tracker: `event(stage, data)`, `finish(summary)`, `fail(error, summary)`
  - `safeError(error) -> { code, message }`
  - `previewQuestion(text)`, `fingerprintQuestion(text)`.

- [ ] **Step 1: Tulis unit test tanpa database**

Masukkan fake error yang memiliki `config.headers.Authorization`, `config.auth`, `response.data`, dan password. Assert output hanya:

```js
{ code: "POWERBI_TIMEOUT", message: "Power BI tidak merespons dalam 45 detik" }
```

Assert preview panjang tepat maksimal 300 karakter dan fingerprint stabil 64 hex.

- [ ] **Step 2: Implement tracker dengan dependency injection**

```js
export async function startCiaTelemetry(envelope, store = telemetryModel) {
  if (!enabled()) return createNoopTracker(envelope.requestId);
  // insert failure => log satu baris aman dan kembalikan no-op tracker
}
```

Tracker menyimpan `sequenceNo` di closure dan menjumlah token event. Semua operasi store dibungkus `try/catch`; log hanya `safeError(err)`.

- [ ] **Step 3: Jalankan full suite**

Run: `cd backend; npm test`

Expected: seluruh test PASS.

- [ ] **Step 4: Commit**

```powershell
git add backend/src/services/ciaTelemetry.service.js backend/tests/cia-telemetry-sanitizer.test.mjs
git commit -m "feat(cia): add safe best-effort telemetry tracker"
```

---

### Task 4: Instrumentasi permukaan CIA yang sudah ada

**Files:**
- Modify: `backend/src/controllers/aiController.js`
- Modify: `backend/src/controllers/aiController.js` methods `ask` dan `unifiedAsk`.
- Create: `backend/tests/cia-surface-telemetry.test.mjs`

**Interfaces:**
- Consumes: `startCiaTelemetry`.
- Produces: event stage `request_received`, `snapshot_read`, `ai_synthesis`, `response_sent`, `request_failed`.

- [ ] **Step 1: Tulis contract test dengan fake tracker**

Untuk success assert `finish()` dipanggil sekali. Untuk AI error assert `fail()` sekali dan response contract lama tidak berubah. Surface harus `dashboard` untuk ask biasa dan `multi_chat` untuk unified.

- [ ] **Step 2: Tambahkan wrapper tipis pada awal/akhir handler**

```js
const telemetry = await startCiaTelemetry({
  requestId: crypto.randomUUID(),
  surface: "dashboard",
  user: req.dbUser || req.user,
  question: req.body?.question,
  conversationId: req.body?.conversationId || null,
});
```

Sisipkan `requestId` ke response JSON tanpa menghapus field lama. Jangan mengubah alur snapshot/DAX pada fase ini.

- [ ] **Step 3: Jalankan regression tests**

Run: `cd backend; npm test`

Expected: PASS; existing AI route contracts tetap lulus.

- [ ] **Step 4: Commit**

```powershell
git add backend/src/controllers/aiController.js backend/tests/cia-surface-telemetry.test.mjs
git commit -m "feat(cia): instrument existing web chat surfaces"
```

---

### Task 5: Query analytics dengan filter lengkap

**Files:**
- Modify: `backend/src/models/ciaTelemetryModel.js`
- Create: `backend/src/services/ciaAdminAnalytics.service.js`
- Create: `backend/tests/cia-admin-analytics.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeAnalyticsFilters(query, now) -> AnalyticsFilters`
  - `getOverview(filters)`
  - `getUsageSeries(filters)`
  - `getUsageBreakdown(filters, dimension)`
  - `getRetrievalHealth(filters)`
  - `getFilterOptions(filters)`.

- [ ] **Step 1: Tulis tests filter dan SQL injection**

Valid dimensions hanya `user`, `department`, `surface`, `dashboard`, `status`, `retrieval_method`. Date default 30 hari, maksimum 366 hari. Query `dimension=started_at);DROP TABLE users` harus 400 sebelum menyentuh DB.

- [ ] **Step 2: Implement normalizer**

```js
export function normalizeAnalyticsFilters(query, now = new Date()) {
  return {
    from: parseIsoBoundary(query.from, startOfWibDay(addDays(now, -29))),
    to: parseIsoBoundary(query.to, endOfWibDay(now)),
    userId: positiveIntOrNull(query.userId),
    department: textOrNull(query.department, 100),
    dashboardId: textOrNull(query.dashboardId, 100),
    surface: oneOfOrNull(query.surface, SURFACES),
    status: oneOfOrNull(query.status, STATUSES),
    retrievalMethod: oneOfOrNull(query.retrievalMethod, METHODS),
  };
}
```

- [ ] **Step 3: Implement agregasi**

Overview mengembalikan:

```js
{
  totals: { requests, activeUsers, inputTokens, outputTokens, totalTokens },
  rates: { success, liveDax, fallback, error },
  latency: { averageMs, p95Ms },
  retrieval: { averageRounds, daxFailures, plannerNoMatch },
}
```

Gunakan dua query: request aggregate dan event aggregate; jangan membuat query per row.

- [ ] **Step 4: Jalankan tests**

Run: `cd backend; npm test`

Expected: PASS termasuk filter kombinasi tanggal+user+department+dashboard.

- [ ] **Step 5: Commit**

```powershell
git add backend/src/models/ciaTelemetryModel.js backend/src/services/ciaAdminAnalytics.service.js backend/tests/cia-admin-analytics.test.mjs
git commit -m "feat(cia): add filtered usage and health analytics"
```

---

### Task 6: API Admin CIA dan pemindahan access management

**Files:**
- Create: `backend/src/routes/adminCiaRoutes.js`
- Modify: `backend/src/server.js`
- Create: `backend/tests/cia-admin-routes.test.mjs`

**Interfaces:**
- Produces:
  - `GET /api/admin/cia/overview`
  - `GET /api/admin/cia/usage?dimension=user`
  - `GET /api/admin/cia/health`
  - `GET /api/admin/cia/filters`
  - `GET /api/admin/cia/requests/:requestId`
  - `GET /api/admin/cia/access`
  - `PUT /api/admin/cia/access/:userId` body `{ enabled: boolean }`.

- [ ] **Step 1: Tulis authorization test**

Tanpa token => 401; user biasa => 403; admin aktif => 200; admin yang dihapus/ditolak => 403. PUT access tidak menerima user id dari body.

- [ ] **Step 2: Implement router**

```js
const router = express.Router();
router.use(requireAdmin);
router.get("/overview", handleOverview);
router.get("/usage", handleUsage);
router.get("/health", handleHealth);
router.get("/filters", handleFilters);
router.get("/requests/:requestId", handleTrace);
router.get("/access", handleAccessList);
router.put("/access/:userId", handleAccessUpdate);
```

Mount sesudah `defaultDeny`:

```js
app.use("/api/admin/cia", adminCiaRoutes);
```

Access update hanya menulis `users.cia_access`; role/profile tetap dikelola User Management.

- [ ] **Step 3: Jalankan API tests**

Run: `cd backend; npm test`

Expected: PASS dan route inventory mengenali seluruh endpoint sebagai admin-only.

- [ ] **Step 4: Commit**

```powershell
git add backend/src/routes/adminCiaRoutes.js backend/src/server.js backend/tests/cia-admin-routes.test.mjs
git commit -m "feat(cia): expose admin analytics and access api"
```

---

### Task 7: Backfill log legacy secara idempotent

**Files:**
- Create: `backend/scripts/backfill-cia-telemetry.mjs`
- Modify: `backend/package.json`
- Create: `backend/tests/cia-backfill.test.mjs`

**Interfaces:**
- Consumes: `ai_chat_logs`, `ai_unified_turns`, `users`.
- Produces: `npm run cia:backfill-telemetry -- --dry-run|--apply`.

- [ ] **Step 1: Tulis fixture test**

Buat satu legacy row dari masing-masing sumber. Jalankan apply dua kali. Assert jumlah `cia_requests` tetap dua dan token JSON unified dipetakan ke input/output/total bila ada.

- [ ] **Step 2: Implement batch cursor**

Script memproses 500 row per batch, memakai `legacy_source` dan `legacy_id` untuk idempotensi. `--dry-run` hanya mencetak jumlah kandidat per sumber. Pertanyaan legacy dipreview/fingerprint menggunakan helper yang sama.

Script package:

```json
"cia:backfill-telemetry": "node scripts/backfill-cia-telemetry.mjs"
```

- [ ] **Step 3: Jalankan test dan dry run**

Run: `cd backend; npm test; npm run cia:backfill-telemetry -- --dry-run`

Expected: PASS; dry run tidak mengubah tabel.

- [ ] **Step 4: Commit**

```powershell
git add backend/scripts/backfill-cia-telemetry.mjs backend/package.json backend/tests/cia-backfill.test.mjs
git commit -m "feat(cia): backfill legacy chat telemetry"
```

---

### Task 8: Frontend API client, route, dan shell Admin CIA

**Files:**
- Create: `frontend/src/services/ciaAdminApi.js`
- Create: `frontend/src/components/admin/CiaAdminPage.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/header.jsx`
- Create: `frontend/tests/cia-admin-page.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: route `/admin/cia`; `ciaAdminApi.getOverview(filters)`, `.getUsage`, `.getHealth`, `.getAccess`, `.updateAccess`.

- [ ] **Step 1: Tulis source-contract test yang gagal**

Assert App mempunyai lazy import dan admin route; Header mempunyai satu label `Admin CIA`; client selalu memakai authenticated API helper yang sudah ada.

- [ ] **Step 2: Implement client dan route guard**

Filter serializer menghapus nilai kosong, memakai `URLSearchParams`, dan tidak membuat request saat user bukan admin. Route mengikuti pola guard Admin Dashboard yang sudah ada.

- [ ] **Step 3: Implement shell tab**

Tab tetap di URL query `?tab=overview|usage|health|access|settings`; default `overview`. Tampilkan loading, retry, dan error Indonesia tanpa menampilkan response mentah.

- [ ] **Step 4: Jalankan test/build**

Run: `cd frontend; npm test; npm run build`

Expected: PASS dan build exit 0.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/services/ciaAdminApi.js frontend/src/components/admin/CiaAdminPage.jsx frontend/src/App.jsx frontend/src/components/header.jsx frontend/tests/cia-admin-page.test.mjs frontend/package.json
git commit -m "feat(cia): add dedicated admin control plane"
```

---

### Task 9: Analytics filters, overview, usage, dan health UI

**Files:**
- Create: `frontend/src/components/admin/CiaAnalyticsFilters.jsx`
- Create: `frontend/src/components/admin/CiaOverviewTab.jsx`
- Create: `frontend/src/components/admin/CiaUsageTab.jsx`
- Create: `frontend/src/components/admin/CiaHealthTab.jsx`
- Modify: `frontend/src/components/admin/CiaAdminPage.jsx`
- Modify: `frontend/tests/cia-admin-page.test.mjs`

**Interfaces:**
- Filter shape: `{ from, to, userId, department, dashboardId, surface, status, retrievalMethod }`.

- [ ] **Step 1: Tambah test filter persistence dan chart accessibility**

Assert semua filter ada, label chart mempunyai tabel fallback, reset kembali 30 hari, dan filter disimpan di query string agar dapat dibagikan.

- [ ] **Step 2: Implement filter bar**

Perubahan input lokal baru fetch saat tombol `Terapkan` atau Enter. Date range memvalidasi from ≤ to dan maksimal 366 hari.

- [ ] **Step 3: Implement tab**

Overview: request, active user, token in/out/total, success/fallback, p95. Usage: line request/token + breakdown user/department/dashboard/surface. Health: failure code, live-vs-snapshot, latency, rounds, trace drawer.

- [ ] **Step 4: Jalankan frontend tests/build**

Run: `cd frontend; npm test; npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/components/admin/CiaAnalyticsFilters.jsx frontend/src/components/admin/CiaOverviewTab.jsx frontend/src/components/admin/CiaUsageTab.jsx frontend/src/components/admin/CiaHealthTab.jsx frontend/src/components/admin/CiaAdminPage.jsx frontend/tests/cia-admin-page.test.mjs
git commit -m "feat(cia): render usage and retrieval analytics"
```

---

### Task 10: CIA Access tab dan compatibility cleanup

**Files:**
- Create: `frontend/src/components/admin/CiaAccessTab.jsx`
- Create: `frontend/src/components/admin/CiaSettingsTab.jsx`
- Modify: `frontend/src/components/admin/CiaAdminPage.jsx`
- Modify: `frontend/src/components/ManageUsers.jsx`
- Modify: `frontend/tests/cia-admin-page.test.mjs`

**Interfaces:**
- Access update body `{ enabled: boolean }`.
- Settings fase 1 read-only menampilkan feature flags efektif dan link ke konfigurasi provider yang sudah ada.

- [ ] **Step 1: Tambah test akses deny-by-default**

Assert toggle mengirim boolean eksplisit, optimistic update rollback saat API gagal, dan form Add/Edit User umum tidak lagi merender field CIA.

- [ ] **Step 2: Implement Access tab**

Tampilkan nama, departemen, role, status approved, CIA enabled. Sediakan search/filter department dan konfirmasi sebelum bulk change. Endpoint lama `/update-user/:id` tetap menerima `ciaAccess` untuk compatibility tetapi UI baru tidak memakainya.

- [ ] **Step 3: Implement status konfigurasi runtime**

Tampilkan nilai efektif `CIA_TELEMETRY_ENABLED`, `CIA_ADMIN_ANALYTICS_ENABLED`, max date range, timezone, dan tombol menuju modal provider. Jangan membuat setting dummy yang bisa diedit tetapi tidak berlaku.

- [ ] **Step 4: Verify seluruh fase**

Run:

```powershell
cd backend
npm test
cd ../frontend
npm test
npm run build
```

Expected: semua PASS; build exit 0.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/components/admin/CiaAccessTab.jsx frontend/src/components/admin/CiaSettingsTab.jsx frontend/src/components/admin/CiaAdminPage.jsx frontend/src/components/ManageUsers.jsx frontend/tests/cia-admin-page.test.mjs
git commit -m "feat(cia): move CIA access into admin page"
```

## Phase Verification Checklist

- [ ] Jalankan migrasi dua kali pada clone schema production.
- [ ] Jalankan backfill dry-run, catat jumlah, apply, lalu apply ulang dan pastikan tidak duplikat.
- [ ] Aktifkan hanya `CIA_TELEMETRY_ENABLED=true`; kirim satu pertanyaan dari dashboard dan Multi-Chat.
- [ ] Cocokkan request id pada response dengan trace Admin.
- [ ] Pastikan token input/output tampil terpisah dan totalnya konsisten.
- [ ] Filter tanggal, user, departemen, dashboard, surface, status, method saling dapat dikombinasikan.
- [ ] Periksa non-admin menerima 403 pada semua `/api/admin/cia/*`.
- [ ] Periksa user tanpa `cia_access` tetap ditolak oleh endpoint CIA.
- [ ] Scan secret: `rg -n "Authorization|client_secret|password|access_token"` pada sample telemetry/export dan pastikan tidak ada nilai secret.
