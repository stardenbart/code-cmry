# CIA KPI Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti ketergantungan pada nama measure teknis dan katalog hardcoded dengan KPI Library yang dapat di-sync dari kondisi aktual, diedit Admin, dikonfirmasi, di-versioning, dan dipakai CIA untuk memilih dashboard serta menjelaskan hasil menggunakan bahasa manusia.

**Architecture:** `cia_kpis` menyimpan konsep bisnis, sedangkan `cia_kpi_bindings` mengikat konsep ke measure/model/dashboard/visual aktual. Sync membaca `model_measure` dan `visual_field_usage`, melakukan reconcile berdasarkan `binding_key` SHA-256, serta tidak menghapus binding yang hilang—statusnya menjadi `missing`. Setiap perubahan manual membuat revision immutable. Reader memakai library saat flag aktif dan fallback ke `KATALOG_KPI` selama rollout.

**Tech Stack:** Node.js ESM, Express, MySQL 8, metadata Power BI yang sudah dipanen, React 18, Tailwind, Node test harness.

## Global Constraints

- Spec dan roadmap 2026-08-27 mengikat.
- Nama manusia, definition, answerable questions, dan synonym yang dikonfirmasi Admin tidak boleh ditimpa sync otomatis.
- Sync hanya memasang/memperbarui binding teknis dan status kehadiran.
- Measure/table/model boleh disimpan untuk eksekusi internal, tetapi output user memakai `human_name`/`display_caption`.
- Setiap edit manual wajib mempunyai `reason` non-kosong dan actor dari `req.dbUser.id`.
- Restore revision membuat versi baru; jangan memutar nomor versi mundur atau menghapus histori.
- Tidak ada auto-publish hasil AI. Bila kelak ada suggestion, statusnya `draft` sampai Admin confirm.
- Binding web tetap difilter oleh ACL dashboard pada saat query, bukan saat sync.

## File Structure

- Create `backend/migrations/add_cia_kpi_library.sql`.
- Create `backend/src/models/ciaKpiModel.js`.
- Create `backend/src/services/ciaKpiLibrary.service.js`.
- Create `backend/src/services/ciaKpiSync.service.js`.
- Create `backend/src/services/ciaHumanLabels.service.js`.
- Extend `backend/src/routes/adminCiaRoutes.js`.
- Create `backend/scripts/import-cia-kpi-catalog.mjs`.
- Create tests `backend/tests/cia-kpi-*.test.mjs`.
- Create `frontend/src/components/admin/CiaKpiLibraryTab.jsx`.
- Create `frontend/src/components/admin/CiaKpiEditor.jsx`.
- Create `frontend/src/components/admin/CiaKpiSyncPanel.jsx`.
- Extend `frontend/src/services/ciaAdminApi.js`, `CiaAdminPage.jsx`.
- Modify `frontend/src/components/ManageUsers.jsx` to move Visual Harvest UI.

---

### Task 1: KPI, binding, revision, dan sync schema

**Files:**
- Create: `backend/migrations/add_cia_kpi_library.sql`
- Create: `backend/tests/cia-kpi-schema.test.mjs`

**Interfaces:**
- Produces: `cia_kpis`, `cia_kpi_bindings`, `cia_kpi_revisions`, `cia_kpi_sync_runs`.

- [ ] **Step 1: Tulis schema test yang gagal**

Kolom wajib:

```js
const kpiColumns = [
  "slug", "human_name", "synonyms_json", "definition", "business_function",
  "answerable_questions_json", "domain", "unit", "number_format", "status",
  "version", "source", "created_by", "updated_by", "created_at", "updated_at",
];
const bindingColumns = [
  "binding_key", "kpi_id", "dashboard_id", "report_id", "page_name",
  "visual_title", "semantic_model", "table_name", "measure_name",
  "display_caption", "dimensions_json", "date_table", "date_column",
  "date_logic", "source", "verification_status", "first_seen_at",
  "last_seen_at", "missing_since",
];
```

- [ ] **Step 2: Buat migration idempotent**

`slug` dan `binding_key` unique. `status` VARCHAR dengan aplikasi menerima `draft|confirmed|deprecated`; `verification_status` menerima `discovered|confirmed|missing|rejected`. JSON disimpan tipe JSON MySQL.

- [ ] **Step 3: Run migration twice + tests**

Run dari root:

```powershell
bash scripts/migrate.sh
bash scripts/migrate.sh
cd backend
npm test
```

- [ ] **Step 4: Commit**

```powershell
git add backend/migrations/add_cia_kpi_library.sql backend/tests/cia-kpi-schema.test.mjs
git commit -m "feat(cia): add versioned KPI library schema"
```

---

### Task 2: KPI model dan atomic revision

**Files:**
- Create: `backend/src/models/ciaKpiModel.js`
- Create: `backend/tests/cia-kpi-model.test.mjs`

**Interfaces:**
- Produces:
  - `listKpis(filters)`; `getKpi(id)`
  - `createKpi(input, actorId)`
  - `updateKpi(id, patch, actorId, reason)`
  - `confirmKpi(id, actorId, reason)`
  - `listRevisions(id)`; `restoreRevision(id, revisionId, actorId, reason)`.

- [ ] **Step 1: Tulis transaction tests**

Assert edit menaikkan version satu kali dan revision menyimpan before/after. Paksa insert revision gagal dan assert update KPI ikut rollback.

- [ ] **Step 2: Implement allowlist patch**

```js
const EDITABLE = new Set([
  "humanName", "synonyms", "definition", "businessFunction",
  "answerableQuestions", "domain", "unit", "numberFormat", "status",
]);
```

Semua JSON dinormalisasi menjadi array string unik dan non-kosong. `slug` dibuat saat create dan tidak berubah ketika human name diedit.

- [ ] **Step 3: Implement restore-as-new-version**

Restore mengambil `after_json` revision target, menulis revision baru dengan before=current/after=target, dan menaikkan version current + 1.

- [ ] **Step 4: Run tests and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/models/ciaKpiModel.js backend/tests/cia-kpi-model.test.mjs
git commit -m "feat(cia): add atomic KPI editing and revisions"
```

---

### Task 3: Import versi aktual dari `KATALOG_KPI`

**Files:**
- Create: `backend/scripts/import-cia-kpi-catalog.mjs`
- Create: `backend/tests/cia-kpi-import.test.mjs`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `npm run cia:import-kpis -- --dry-run|--apply`.

- [ ] **Step 1: Tulis import mapping test**

Gunakan tiga fixture yang mewakili lembur, deviasi CMD 3, dan PO. Assert human name tidak sama dengan nama measure teknis, dashboard/model terikat, dan import kedua tidak membuat duplikat.

- [ ] **Step 2: Implement deterministic mapper**

Untuk tiap entry katalog:

```js
{
  slug: stableSlug(entry.domain, entry.name),
  humanName: entry.label || humanizeIdentifier(entry.name),
  synonyms: unique([entry.name, ...(entry.aliases || [])]),
  definition: entry.description || "",
  answerableQuestions: entry.questions || [],
  status: "draft",
  source: "catalog_import",
}
```

Binding key:

```js
sha256([dashboardId, semanticModel, tableName, measureName, pageName, visualTitle]
  .map((v) => String(v || "").trim().toLowerCase()).join("|"))
```

Jangan mengarang definition bila katalog tidak memilikinya; string kosong terlihat jelas di UI untuk dilengkapi.

- [ ] **Step 3: Add package script and test**

```json
"cia:import-kpis": "node scripts/import-cia-kpi-catalog.mjs"
```

Run: `cd backend; npm test; npm run cia:import-kpis -- --dry-run`

- [ ] **Step 4: Commit**

```powershell
git add backend/scripts/import-cia-kpi-catalog.mjs backend/tests/cia-kpi-import.test.mjs backend/package.json
git commit -m "feat(cia): import current KPI catalog"
```

---

### Task 4: Reconcile otomatis dari measure dan visual aktual

**Files:**
- Create: `backend/src/services/ciaKpiSync.service.js`
- Create: `backend/tests/cia-kpi-sync.test.mjs`

**Interfaces:**
- Consumes: `model_measure`, `visual_field_usage`, dashboard metadata.
- Produces: `syncKpiBindings({ actorId, dashboardIds, mode }) -> SyncResult`.

- [ ] **Step 1: Tulis reconcile matrix test**

Kasus: binding baru => discovered; binding sama => `last_seen_at` maju; binding hilang => missing; binding muncul kembali => discovered/confirmed lama dipulihkan; edit manusia tidak berubah.

- [ ] **Step 2: Implement inventory join**

Query inventory satu kali per batch dashboard. Measure yang terpasang pada beberapa visual menghasilkan binding per visual. Field non-measure dicatat sebagai dimensions JSON pada binding measure di visual yang sama.

- [ ] **Step 3: Implement transaction dan run audit**

Result:

```js
{
  runId, startedAt, finishedAt, status,
  dashboardsScanned, measuresSeen, visualsSeen,
  bindingsCreated, bindingsRefreshed, bindingsMissing, errors: [],
}
```

Error per dashboard disanitasi dan sync dashboard lain tetap lanjut; status akhir `partial` bila ada error.

- [ ] **Step 4: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/ciaKpiSync.service.js backend/tests/cia-kpi-sync.test.mjs
git commit -m "feat(cia): reconcile KPI bindings from live inventory"
```

---

### Task 5: Read-through library dan lookup untuk router

**Files:**
- Create: `backend/src/services/ciaKpiLibrary.service.js`
- Create: `backend/tests/cia-kpi-reader.test.mjs`

**Interfaces:**
- Produces:
  - `searchKpiCandidates({ question, allowedDashboardIds, limit })`
  - `getBindingsForKpis(kpiIds, allowedDashboardIds)`
  - `getDashboardVocabulary(dashboardIds)`
  - `readKpiLibraryStatus()`.

- [ ] **Step 1: Tulis ranking regression**

Query `breakdown lembur harian per departemen karena alasan dan kategori` harus memberi KPI lembur di atas maintenance walau kata generik `breakdown` ada. Query `issue deviasi cmd 3` harus memberi deviasi CMD 3 di atas generic issue/downtime. Query PO harus menemukan dashboard PPIC.

- [ ] **Step 2: Implement weighted deterministic score**

```js
const WEIGHTS = {
  exactHumanName: 12,
  exactSynonym: 10,
  measureAlias: 8,
  answerableQuestionTerm: 6,
  dashboardOrDomain: 4,
  dimension: 3,
  genericTerm: 0.5,
};
```

Token spesifik seperti `lembur`, `deviasi`, `po`, `cmd 3` menang atas `issue`, `breakdown`, `analisa`. Hanya binding confirmed/discovered yang aktif; missing/rejected tidak dipilih.

- [ ] **Step 3: Implement feature-flag fallback**

Bila flag mati/tabel belum ada/library kosong, adapt `KATALOG_KPI` ke response shape yang sama. Log satu warning per proses, bukan per request.

- [ ] **Step 4: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/ciaKpiLibrary.service.js backend/tests/cia-kpi-reader.test.mjs
git commit -m "feat(cia): add deterministic KPI lookup with catalog fallback"
```

---

### Task 6: Human-readable labels untuk hasil DAX

**Files:**
- Create: `backend/src/services/ciaHumanLabels.service.js`
- Create: `backend/tests/cia-human-labels.test.mjs`

**Interfaces:**
- Produces:
  - `buildLabelMap(bindings) -> Map<string,string>`
  - `labelDaxRows({ rows, bindings }) -> { rows, columns }`
  - `describeKpi(binding) -> { name, definition, unit, numberFormat }`.

- [ ] **Step 1: Tulis collision/unknown tests**

`'MeasureTable'[OT_HOURS]` menjadi `Jam lembur`; dua kolom dengan human label sama mendapat suffix dashboard/variant yang jelas; unknown identifier di-humanize menjadi `Actual production qty`, tidak diekspos mentah dengan bracket/table prefix.

- [ ] **Step 2: Implement canonical key variants**

Lookup harus mengenali `Table[Measure]`, `[Measure]`, `Measure`, dan key JSON ExecuteQueries. Preserve dimension values; hanya nama kolom yang berubah.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/ciaHumanLabels.service.js backend/tests/cia-human-labels.test.mjs
git commit -m "feat(cia): translate DAX output into business labels"
```

---

### Task 7: Admin KPI API

**Files:**
- Modify: `backend/src/routes/adminCiaRoutes.js`
- Create: `backend/tests/cia-kpi-routes.test.mjs`

**Interfaces:**
- Produces:
  - `GET/POST /api/admin/cia/kpis`
  - `GET/PUT /api/admin/cia/kpis/:id`
  - `POST /api/admin/cia/kpis/:id/confirm`
  - `GET /api/admin/cia/kpis/:id/revisions`
  - `POST /api/admin/cia/kpis/:id/revisions/:revisionId/restore`
  - `POST /api/admin/cia/kpis/sync`
  - `GET /api/admin/cia/kpis/sync/:runId`.

- [ ] **Step 1: Tulis auth/validation tests**

Non-admin 403. Update tanpa reason 400. Invalid JSON array/type 400. Sync kedua saat masih running 409. Restore revision KPI lain 404.

- [ ] **Step 2: Implement routes**

Sync endpoint merespons 202 `{ runId, status: "running" }` dan bekerja background dengan catch terpasang. Jangan menahan HTTP sampai seluruh dashboard selesai.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/routes/adminCiaRoutes.js backend/tests/cia-kpi-routes.test.mjs
git commit -m "feat(cia): expose KPI library administration api"
```

---

### Task 8: KPI Library tab dan editor

**Files:**
- Create: `frontend/src/components/admin/CiaKpiLibraryTab.jsx`
- Create: `frontend/src/components/admin/CiaKpiEditor.jsx`
- Modify: `frontend/src/services/ciaAdminApi.js`
- Modify: `frontend/src/components/admin/CiaAdminPage.jsx`
- Create: `frontend/tests/cia-kpi-library.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- UI route state: `/admin/cia?tab=kpi&kpiId=<id>`.

- [ ] **Step 1: Tulis UI source contract**

Assert filter search/domain/status/dashboard, status badge, binding list, required reason, revision view, confirm dan restore confirmation tersedia.

- [ ] **Step 2: Implement table/detail editor**

List memuat human name sebagai primary text dan measure sebagai secondary monospace. Editor tidak mengubah binding teknis langsung; field tersebut read-only dari sync.

- [ ] **Step 3: Implement optimistic rules**

Save menunggu API sebelum menutup editor. Bila version stale/409, tampilkan pesan untuk reload; jangan overwrite diam-diam.

- [ ] **Step 4: Test/build and commit**

Run: `cd frontend; npm test; npm run build`

```powershell
git add frontend/src/components/admin/CiaKpiLibraryTab.jsx frontend/src/components/admin/CiaKpiEditor.jsx frontend/src/components/admin/CiaAdminPage.jsx frontend/src/services/ciaAdminApi.js frontend/tests/cia-kpi-library.test.mjs frontend/package.json
git commit -m "feat(cia): add KPI library editor"
```

---

### Task 9: Sync panel dan pindahkan Visual Harvest

**Files:**
- Create: `frontend/src/components/admin/CiaKpiSyncPanel.jsx`
- Modify: `frontend/src/components/admin/CiaKpiLibraryTab.jsx`
- Modify: `frontend/src/components/ManageUsers.jsx`
- Reuse/move: komponen Visual Harvest aktual ke tab KPI tanpa mengubah API harvest.
- Modify: `frontend/tests/cia-kpi-library.test.mjs`

**Interfaces:**
- Consumes sync response/status dan UI Visual Harvest yang ada.

- [ ] **Step 1: Tulis test ownership UI**

Assert `ManageUsers` tidak lagi mengimpor Visual Harvest; Admin KPI tab menampilkan `Panen metadata visual` dan `Sinkronkan KPI Library` sebagai dua langkah berurutan.

- [ ] **Step 2: Implement sync UX**

Flow: pilih semua/dashboard tertentu → harvest bila perlu → sync → polling 2 detik sampai terminal state → tampilkan created/refreshed/missing/error. Tombol disabled saat running.

- [ ] **Step 3: Verify**

Run:

```powershell
cd backend
npm test
cd ../frontend
npm test
npm run build
```

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/components/admin/CiaKpiSyncPanel.jsx frontend/src/components/admin/CiaKpiLibraryTab.jsx frontend/src/components/VisualHarvestPanel.jsx frontend/src/components/ManageUsers.jsx frontend/tests/cia-kpi-library.test.mjs
git commit -m "feat(cia): centralize KPI discovery and sync"
```

## Phase Verification Checklist

- [ ] Import aktual menghasilkan KPI lembur, deviasi CMD 3, dan PO/PPIC.
- [ ] Sync tidak menimpa human name/definition/synonym yang diedit Admin.
- [ ] Binding yang tidak lagi ada berubah `missing`, bukan terhapus.
- [ ] Revision dapat dilihat dan restore membuat versi baru.
- [ ] Regression ranking tidak lagi gagal dengan `tidak ada dashboard yang relevan` untuk dua pertanyaan produksi pada PRD.
- [ ] Hasil DAX memakai label manusia; measure mentah hanya terlihat di Admin detail.
- [ ] User web tidak dapat memperoleh binding dashboard di luar ACL.
- [ ] `KATALOG_KPI` fallback tetap bekerja saat flag dimatikan.
