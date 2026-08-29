# CIA Dashboard Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menjadikan seluruh dashboard aktif dapat diaudit, dipanen, dipetakan, diuji, dan dipelihara melalui Admin CIA tanpa membuat binding bisnis secara spekulatif.

**Architecture:** Tambahkan read-only coverage matrix dari tabel existing, dry-run proposal pada sync, dan satu tab Admin untuk status serta routing tester. Exact model/measure/visual matches dapat dipromosikan sebagai discovered; date policy, label, denominator, join key, dan ambiguity tetap melalui review.

**Tech Stack:** Node.js/Express/MySQL, React/Vite, existing KPI Library dan visual harvest, tanpa dependency baru.

## Global Constraints

- Tidak mengubah binding `confirmed` melalui sync otomatis.
- Tidak mengarang fungsi KPI, period policy, join key, numerator, atau denominator.
- Dashboard tanpa visual inventory berstatus `not_harvested`, bukan dianggap kosong.
- Coverage mengikuti ACL admin dan endpoint memakai `requireAdmin`.
- Semua proposal menyimpan alasan dan bukti field/model yang cocok.
- Tidak menambah package baru.

---

### Task 1: Coverage Matrix Backend

**Files:**
- Create: `backend/src/services/ciaDashboardCoverage.service.js`
- Modify: `backend/src/routes/ciaAdminRoutes.js`
- Create: `backend/tests/cia-dashboard-coverage.test.mjs`
- Modify: `backend/tests/cia-admin-routes.test.mjs`
- Modify: `backend/tests/run-all.mjs`

**Interfaces:**
- Produces: `getDashboardCoverage() -> { summary, dashboards }`.
- Route: `GET /api/admin/cia/kpis/coverage`.

- [ ] **Step 1: Tulis failing service test dengan fixture 7 status**

```js
ok("tanpa inventory", result.dashboards.find((d) => d.id === 58).status === "not_harvested");
ok("tanpa binding", result.dashboards.find((d) => d.id === 38).status === "mapping_required");
ok("date ready", result.dashboards.find((d) => d.id === 65).status === "query_ready");
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `cd backend && node tests/cia-dashboard-coverage.test.mjs`  
Expected: FAIL karena service belum ada.

- [ ] **Step 3: Implementasikan agregasi satu query**

Hitung inventory fields, discovered/confirmed bindings, date-ready bindings,
missing bindings, semantic models, dan last harvest. Status ditentukan secara
deterministik dari counts tersebut.

- [ ] **Step 4: Tambahkan admin route dan authorization test**

Response tidak memuat DAX, credential, atau row data.

- [ ] **Step 5: Jalankan tests dan commit**

Run: `cd backend && node tests/cia-dashboard-coverage.test.mjs && node tests/cia-admin-routes.test.mjs`  
Expected: PASS.

```bash
git add backend/src/services/ciaDashboardCoverage.service.js backend/src/routes/ciaAdminRoutes.js backend/tests/cia-dashboard-coverage.test.mjs backend/tests/cia-admin-routes.test.mjs backend/tests/run-all.mjs
git commit -m "feat(cia-admin): expose dashboard query coverage"
```

### Task 2: Dry-Run Sync Proposal

**Files:**
- Modify: `backend/src/services/ciaKpiSync.service.js`
- Modify: `backend/src/routes/ciaAdminRoutes.js`
- Modify: `backend/tests/cia-kpi-sync.test.mjs`
- Create: `backend/tests/cia-kpi-sync-proposal.test.mjs`
- Modify: `backend/tests/run-all.mjs`

**Interfaces:**
- Produces: `previewSync({ dashboardIds }) -> { exact, ambiguous, unknown, unchanged }`.
- Route: `POST /api/admin/cia/kpis/sync/preview`.

- [ ] **Step 1: Tulis failing tests proposal classification**

Exact match membutuhkan model, measure, dan visual inventory yang sama. Lebih
dari satu KPI match masuk `ambiguous`; field tanpa catalog match masuk `unknown`.
Confirmed bindings masuk `unchanged`.

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `cd backend && node tests/cia-kpi-sync-proposal.test.mjs`  
Expected: FAIL karena preview belum tersedia.

- [ ] **Step 3: Ekstrak reconciliation murni dari `runSync`**

Preview dan apply memakai fungsi klasifikasi yang sama. Preview tidak menulis
`cia_kpi_bindings` atau `cia_kpi_sync_runs`.

- [ ] **Step 4: Tambahkan endpoint dan tests**

Endpoint memvalidasi maksimum 100 dashboard IDs dan mengembalikan alasan match.

- [ ] **Step 5: Jalankan tests dan commit**

Run: `cd backend && node tests/cia-kpi-sync.test.mjs && node tests/cia-kpi-sync-proposal.test.mjs`  
Expected: PASS dan preview terbukti read-only.

```bash
git add backend/src/services/ciaKpiSync.service.js backend/src/routes/ciaAdminRoutes.js backend/tests/cia-kpi-sync.test.mjs backend/tests/cia-kpi-sync-proposal.test.mjs backend/tests/run-all.mjs
git commit -m "feat(cia-admin): preview KPI binding reconciliation"
```

### Task 3: Coverage dan Routing Tester UI

**Files:**
- Modify: `frontend/src/services/ciaAdminApi.js`
- Create: `frontend/src/components/admin/CiaCoveragePanel.jsx`
- Modify: `frontend/src/components/admin/CiaKpiLibraryTab.jsx`
- Create: `frontend/tests/cia-dashboard-coverage.test.mjs`
- Modify: `frontend/tests/cia-kpi-library.test.mjs`

**Interfaces:**
- `getKpiCoverage()` memanggil coverage endpoint.
- `previewKpiSync(dashboardIds)` memanggil preview endpoint.

- [ ] **Step 1: Tulis failing UI contract test**

Assert kartu summary, filter status, tabel dashboard, tombol harvest/preview,
serta state loading/error/empty.

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `cd frontend && node tests/cia-dashboard-coverage.test.mjs`  
Expected: FAIL karena komponen belum ada.

- [ ] **Step 3: Implementasikan panel minimal**

Gunakan komponen/tailwind existing. Tampilkan dashboard, inventory count,
binding count, date-ready count, last harvest, status, dan action relevan.

- [ ] **Step 4: Integrasikan dengan Visual Harvest dan sync preview**

Harvest menggunakan flow existing; preview menampilkan exact/ambiguous/unknown
sebelum admin menjalankan sync.

- [ ] **Step 5: Jalankan tests/build dan commit**

Run: `cd frontend && node tests/cia-dashboard-coverage.test.mjs && node tests/cia-kpi-library.test.mjs && npm run build`  
Expected: tests dan build PASS.

```bash
git add frontend/src/services/ciaAdminApi.js frontend/src/components/admin/CiaCoveragePanel.jsx frontend/src/components/admin/CiaKpiLibraryTab.jsx frontend/tests/cia-dashboard-coverage.test.mjs frontend/tests/cia-kpi-library.test.mjs
git commit -m "feat(cia-admin): show dashboard coverage and sync preview"
```

### Task 4: Audit Aktual dan Runbook Update Dashboard

**Files:**
- Create: `backend/scripts/audit-cia-dashboard-coverage.mjs`
- Modify: `backend/package.json`
- Create: `docs/CIA-KPI-UPDATE-RUNBOOK.md`
- Create: `backend/tests/cia-coverage-audit-script.test.mjs`
- Modify: `backend/tests/run-all.mjs`

**Interfaces:**
- Command: `npm run cia:audit-coverage`.
- Output: summary serta dashboard `not_harvested`, `mapping_required`, `date_policy_missing`, `query_ready`.

- [ ] **Step 1: Tulis failing script contract test**

Inject fake coverage service dan assert exit code nonzero hanya untuk execution
error, bukan untuk dashboard yang belum siap.

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `cd backend && node tests/cia-coverage-audit-script.test.mjs`  
Expected: FAIL karena script belum ada.

- [ ] **Step 3: Implementasikan script read-only dan package command**

Script tidak menjalankan sync atau menulis database.

- [ ] **Step 4: Tulis tutorial operasional lengkap**

Runbook memuat urutan: buka/harvest dashboard, preview sync, review ambiguous,
isi human name/synonym/function/question/dimension/date policy, confirm, uji pada
routing tester, publish, regression smoke, dan rollback revision.

- [ ] **Step 5: Jalankan audit aktual**

Run: `cd backend && npm run cia:audit-coverage`  
Expected: daftar 44 dashboard dan summary yang konsisten dengan Admin UI.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/audit-cia-dashboard-coverage.mjs backend/package.json backend/tests/cia-coverage-audit-script.test.mjs backend/tests/run-all.mjs docs/CIA-KPI-UPDATE-RUNBOOK.md
git commit -m "docs(cia): add dashboard coverage audit runbook"
```

### Task 5: Harvest dan Review Seluruh Dashboard Aktif

**Files:**
- Data operation: `visual_field_usage`, `cia_kpi_bindings`, dan revision records melalui API existing.
- Verification: `docs/CIA-KPI-UPDATE-RUNBOOK.md`.

**Interfaces:**
- Consumes: coverage matrix dan sync preview dari Tasks 1–4.
- Produces: status aktual setiap dashboard dan daftar ambiguity yang membutuhkan owner.

- [ ] **Step 1: Harvest 12 dashboard `not_harvested`**

Buka dashboard melalui sesi Power BI berizin dan jalankan Visual Harvest. Jika
akses report ditolak, catat dashboard ID serta status permission; jangan membuat
inventory sintetis.

- [ ] **Step 2: Preview seluruh 44 dashboard**

Jalankan preview sync, simpan counts exact/ambiguous/unknown, lalu apply exact
matches sebagai `discovered`.

- [ ] **Step 3: Review period policy dan label**

Konfirmasi binding yang mempunyai date mapping eksplisit. Binding tanpa tanggal
tetap `date_policy_missing`; cut-off dan holiday calendar tidak ditebak.

- [ ] **Step 4: Jalankan corpus dan smoke per domain query-ready**

Verifikasi sedikitnya satu pertanyaan total, breakdown, ranking, periode, dan
follow-up untuk tiap domain yang siap.

- [ ] **Step 5: Laporkan gap yang memerlukan bantuan owner**

Laporan hanya berisi ambiguity konkret: dashboard, visual, field/measure,
pilihan mapping, dan pertanyaan bisnis yang perlu dijawab.

- [ ] **Step 6: Commit hanya perubahan code/docs bila ada**

Database mapping direkam melalui revision table; jangan mengekspor credential
atau row data ke Git.

