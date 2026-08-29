# CIA Hybrid Query Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat CIA memilih sumber yang relevan, membaca data live di luar slicer aktif, serta menjawab follow-up menggunakan evidence turn sebelumnya pada dashboard, Multi-Chat, dan WhatsApp.

**Architecture:** Tambahkan intent frame dan evidence contract tipis di depan Evidence Orchestrator yang ada. Router memakai business-anchor gate, source constraint, preferred dashboard, dan konteks turn; planner tetap menyusun DAX dari binding tervalidasi, sedangkan visual inventory menjadi blueprint pilihan dimensi tanpa menjadi batas nilai data.

**Tech Stack:** Node.js ESM, MySQL, Power BI Execute Queries/DAX, existing model router, test harness `.mjs` tanpa dependency baru.

## Global Constraints

- Satu shared Evidence Orchestrator untuk dashboard, Multi-Chat, dan WhatsApp.
- Query eksplisit tidak mewarisi slicer dashboard; snapshot hanya fallback atau sumber saat user merujuk tampilan aktif.
- Kandidat wajib cocok business concept, source constraint, dan ACL.
- Preferred dashboard diprioritaskan bila relevan tetapi tidak menjadi satu-satunya sumber.
- Jawaban tidak boleh mengganti domain, model, entitas, atau periode yang diminta dengan data lain.
- Output user memakai label bisnis, bukan nama measure/kolom teknis.
- Tidak menambah package baru.

---

### Task 1: Regression Corpus dan Intent Frame

**Files:**
- Modify: `backend/tests/fixtures/cia-regression-cases.mjs`
- Create: `backend/tests/cia-intent-frame.test.mjs`
- Create: `backend/src/services/cia/intentFrame.js`
- Modify: `backend/tests/run-all.mjs`

**Interfaces:**
- Produces: `buildIntentFrame({ question, conversation, preferredDashboardIds }) -> IntentFrame`
- `IntentFrame` memuat `concepts`, `entities`, `operations`, `sourceConstraints`, `continuity`, dan `question`.

- [ ] **Step 1: Masukkan 27 pertanyaan user ke fixture**

Setiap case menyimpan `expectsConcepts`, `expectsEntities`, `expectsOperations`, dan bila ada `expectsPeriodKind` atau `expectsSource`. Jangan menyimpan jawaban angka aktual.

- [ ] **Step 2: Tulis failing test untuk intent lintas domain**

```js
const downtime = buildIntentFrame({ question: "waktu downtime tetra pak line 3 dan 6 berapa jam dan berapa persen running hours" });
ok("downtime + running hours", downtime.concepts.includes("downtime")
  && downtime.concepts.includes("running hours"));
ok("dua mesin dipertahankan", downtime.entities.some((e) => e.value.includes("tetra pak line 3"))
  && downtime.entities.some((e) => e.value.includes("tetra pak line 6")));

const production = buildIntentFrame({ question: "achievement produksi dan fulfillment PO minggu ini" });
ok("production + PO", production.concepts.includes("production")
  && production.concepts.includes("purchase order"));
```

- [ ] **Step 3: Jalankan test dan pastikan gagal**

Run: `cd backend && node tests/cia-intent-frame.test.mjs`  
Expected: FAIL karena `intentFrame.js` belum ada.

- [ ] **Step 4: Implementasikan parser minimal berbasis vocabulary**

Gunakan normalisasi string, phrase matching terpanjang, regex entitas umum, dan vocabulary yang dapat diinjeksi dari KPI Library. Jangan menulis satu handler per pertanyaan.

```js
export function buildIntentFrame(input = {}, injected = {}) {
  const question = normalize(input.question);
  const vocabulary = injected.vocabulary || DEFAULT_VOCABULARY;
  return {
    question,
    concepts: matchConcepts(question, vocabulary),
    entities: extractEntities(question),
    operations: matchOperations(question),
    sourceConstraints: extractSourceConstraints(question),
    continuity: classifyContinuity(question, input.conversation),
    preferredDashboardIds: uniqueIds(input.preferredDashboardIds),
  };
}
```

- [ ] **Step 5: Jalankan test intent dan seluruh fixture parser**

Run: `cd backend && node tests/cia-intent-frame.test.mjs`  
Expected: PASS untuk downtime, produksi/PO, deviasi, overtime/cost, source constraint, dan follow-up.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/cia/intentFrame.js backend/tests/cia-intent-frame.test.mjs backend/tests/fixtures/cia-regression-cases.mjs backend/tests/run-all.mjs
git commit -m "feat(cia): parse domain-agnostic evidence intent"
```

### Task 2: Business-Anchor dan Preferred-Source Routing

**Files:**
- Modify: `backend/src/services/ciaKpiLibrary.service.js`
- Modify: `backend/src/services/cia/evidenceRouter.js`
- Modify: `backend/src/services/cia/evidenceOrchestrator.js`
- Modify: `backend/tests/cia-kpi-reader.test.mjs`
- Modify: `backend/tests/cia-evidence-router.test.mjs`
- Modify: `backend/tests/cia-evidence-orchestrator.test.mjs`

**Interfaces:**
- Consumes: `IntentFrame` dari Task 1.
- Produces: `searchKpiCandidates({ question, intentFrame, allowedDashboardIds, preferredDashboardIds, limit })`.
- Produces: candidate fields `anchorMatches`, `sourcePriority`, dan `score`.

- [ ] **Step 1: Tulis failing tests untuk false routing**

```js
const result = await routeEvidence({
  question: "top departemen dengan lembur tertinggi",
  intentFrame: { concepts: ["overtime"], sourceConstraints: [] },
  periods, scope: { ...scope, preferredDashboardIds: ["52"] },
}, depsReturningOvertimeAndDowntime);
ok("downtime dieliminasi", result.candidates.every((c) => c.slug !== "top_machine_downtime"));

const activeReport = await routeEvidence({
  question: "masalah evergreen bulan juni",
  intentFrame: { concepts: ["downtime"], entities: [{ type: "machine", value: "evergreen" }] },
  periods, scope: { ...scope, preferredDashboardIds: ["44"] },
}, depsReturningMaintenanceAndOrs);
ok("report aktif didahulukan", activeReport.candidates[0].dashboardId === "44");
```

- [ ] **Step 2: Jalankan tests dan verifikasi kegagalan saat ini**

Run: `cd backend && node tests/cia-evidence-router.test.mjs`  
Expected: FAIL karena router belum menggunakan anchor/preferred dashboard.

- [ ] **Step 3: Implementasikan anchor gate dan source priority**

`top`, `tertinggi`, `detail`, nama periode, dan operasi analitik masuk generic set. Candidate tanpa kecocokan konsep ditolak bila intent memiliki konsep. Source constraint eksplisit mendapat prioritas tertinggi, lalu binding follow-up, preferred dashboard, kemudian kandidat ACL lain.

```js
const anchored = intentFrame.concepts.length === 0
  || candidate.anchorMatches.some((value) => intentFrame.concepts.includes(value));
if (!anchored) return null;

candidate.sourcePriority = explicitSource ? 300
  : contextSource ? 200
    : preferredDashboard ? 100 : 0;
```

- [ ] **Step 4: Teruskan intent dan preferred IDs dari orchestrator**

Bangun intent sebelum periode/router, lalu kirim `scope.preferredDashboardIds` ke pencarian kandidat. Telemetry hanya menyimpan concept IDs/count, bukan prompt mentah.

- [ ] **Step 5: Jalankan unit tests**

Run: `cd backend && node tests/cia-kpi-reader.test.mjs && node tests/cia-evidence-router.test.mjs && node tests/cia-evidence-orchestrator.test.mjs`  
Expected: PASS dan tidak ada cross-domain candidate.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ciaKpiLibrary.service.js backend/src/services/cia/evidenceRouter.js backend/src/services/cia/evidenceOrchestrator.js backend/tests/cia-kpi-reader.test.mjs backend/tests/cia-evidence-router.test.mjs backend/tests/cia-evidence-orchestrator.test.mjs
git commit -m "fix(cia): anchor routing to business intent and source"
```

### Task 3: Evidence Contract untuk Follow-Up

**Files:**
- Create: `backend/src/services/cia/evidenceContract.js`
- Create: `backend/tests/cia-followup-contract.test.mjs`
- Modify: `backend/src/services/unifiedConversationManager.js`
- Modify: `backend/src/controllers/aiController.js`
- Modify: `backend/src/services/cia/contracts.js`
- Modify: `backend/tests/unified-conversation.test.mjs`
- Modify: `backend/tests/run-all.mjs`

**Interfaces:**
- Produces: `createEvidenceContract({ intentFrame, periods, goals, evidence, sources })`.
- Produces: `resolveFollowUpContext({ question, conversation })`.
- Persists: `tokens_used.evidenceContract` pada `ai_unified_turns`, tanpa migration baru.

- [ ] **Step 1: Tulis failing tests inheritance dan topic switch**

```js
const inherited = resolveFollowUpContext({
  question: "berapa persentasenya terhadap used time?",
  conversation: [{ role: "assistant", evidenceContract: previousDowntimeContract }],
});
ok("mewarisi downtime source", inherited.sources[0].dashboardId === "44");
ok("menambah denominator", inherited.requiredConcepts.includes("running hours"));

const switched = resolveFollowUpContext({
  question: "sekarang rekap overtime bulan juli",
  conversation: [{ role: "assistant", evidenceContract: previousDowntimeContract }],
});
ok("topic switch tidak membawa mesin", switched.entities.length === 0);
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `cd backend && node tests/cia-followup-contract.test.mjs`  
Expected: FAIL karena contract resolver belum ada.

- [ ] **Step 3: Implementasikan contract aman dan bounded**

Simpan hanya IDs, label aman, periode, filter, dan goal metadata. Batasi enam source/goal, dua belas entity/filter, dan jangan simpan row mentah atau DAX.

- [ ] **Step 4: Sertakan contract saat menyimpan/membaca turn**

`getTurns()` mengembalikan `evidence_contract`; controller memasukkannya ke conversation envelope. Bentuk history lama tanpa contract tetap valid.

- [ ] **Step 5: Jalankan tests**

Run: `cd backend && node tests/cia-followup-contract.test.mjs && node tests/unified-conversation.test.mjs && node tests/cia-evidence-contracts.test.mjs`  
Expected: PASS untuk inheritance, topic switch, bounds, dan backward compatibility.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/cia/evidenceContract.js backend/src/services/unifiedConversationManager.js backend/src/controllers/aiController.js backend/src/services/cia/contracts.js backend/tests/cia-followup-contract.test.mjs backend/tests/unified-conversation.test.mjs backend/tests/run-all.mjs
git commit -m "feat(cia): preserve evidence context across turns"
```

### Task 4: Visual Blueprint Resolver dan Filter Precedence

**Files:**
- Create: `backend/src/services/cia/visualBlueprint.js`
- Create: `backend/tests/cia-visual-blueprint.test.mjs`
- Modify: `backend/src/services/ciaKpiLibrary.service.js`
- Modify: `backend/src/services/cia/evidencePlanner.js`
- Modify: `backend/src/services/cia/daxPlanBuilder.js`
- Modify: `backend/tests/cia-evidence-planner.test.mjs`
- Modify: `backend/tests/cia-dax-plan-builder.test.mjs`
- Modify: `backend/tests/run-all.mjs`

**Interfaces:**
- Produces: `buildVisualBlueprint(binding) -> { measures, dimensions, role, periodPolicy, labels }`.
- Produces: `resolveFilterPolicy({ question, explicitFilters, contextFilters, reportFilters })`.

- [ ] **Step 1: Tulis failing tests untuk filter di luar slicer**

```js
const policy = resolveFilterPolicy({
  question: "jelaskan evergreen bulan juni",
  explicitFilters: [{ dimension: "Mesin", value: "Evergreen" }],
  contextFilters: [],
  reportFilters: [{ dimension: "Month", value: "August" }],
});
ok("filter pertanyaan menang", policy.filters.some((f) => f.value === "Evergreen")
  && policy.filters.every((f) => f.value !== "August"));
```

Tambahkan case `data yang sedang tampil` yang mengizinkan report filters dan
`keseluruhan` yang membuang seluruh report filters.

- [ ] **Step 2: Jalankan tests dan pastikan gagal**

Run: `cd backend && node tests/cia-visual-blueprint.test.mjs`  
Expected: FAIL karena resolver belum ada.

- [ ] **Step 3: Bangun blueprint dari binding existing**

Reuse `page_name`, `visual_title`, `display_caption`, `measure_name`,
`dimensions_json`, serta date mapping. Jangan menambah tabel baru pada task ini.

- [ ] **Step 4: Kirim blueprint dan filter policy ke planner/builder**

Planner hanya dapat memilih dimensi dari blueprint. Builder memakai filter
pertanyaan/context dan tidak menerima report filters kecuali referensi tampilan
eksplisit.

- [ ] **Step 5: Jalankan tests planner/builder**

Run: `cd backend && node tests/cia-visual-blueprint.test.mjs && node tests/cia-evidence-planner.test.mjs && node tests/cia-dax-plan-builder.test.mjs`  
Expected: PASS untuk June vs August slicer, entity filter, current-view, dan keseluruhan.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/cia/visualBlueprint.js backend/src/services/ciaKpiLibrary.service.js backend/src/services/cia/evidencePlanner.js backend/src/services/cia/daxPlanBuilder.js backend/tests/cia-visual-blueprint.test.mjs backend/tests/cia-evidence-planner.test.mjs backend/tests/cia-dax-plan-builder.test.mjs backend/tests/run-all.mjs
git commit -m "feat(cia): query live data from visual blueprints"
```

### Task 5: Composite Goals dan Evidence Relevance Guard

**Files:**
- Modify: `backend/src/services/cia/evidencePlanner.js`
- Modify: `backend/src/services/cia/evidenceGapAnalyzer.js`
- Modify: `backend/src/services/cia/evidenceSynthesizer.js`
- Modify: `backend/src/services/cia/evidenceOrchestrator.js`
- Create: `backend/tests/cia-composite-evidence.test.mjs`
- Modify: `backend/tests/cia-evidence-gap.test.mjs`
- Modify: `backend/tests/cia-evidence-synthesizer.test.mjs`
- Modify: `backend/tests/run-all.mjs`

**Interfaces:**
- Goal menambah `metricRole: primary|numerator|denominator|target|detail|correlation`.
- Evidence menambah `intentMatch: { concepts, entities, period, source }`.

- [ ] **Step 1: Tulis failing tests composite metric**

```js
ok("downtime percentage memiliki denominator",
  plan.goals.some((g) => g.metricRole === "numerator")
  && plan.goals.some((g) => g.metricRole === "denominator"));
ok("achievement memiliki actual dan target",
  productionPlan.goals.some((g) => g.metricRole === "primary")
  && productionPlan.goals.some((g) => g.metricRole === "target"));
```

Tambahkan test bahwa evidence ORS/mesin lain ditolak untuk pertanyaan Evergreen
pada Maintenance Downtime.

- [ ] **Step 2: Jalankan tests dan pastikan gagal**

Run: `cd backend && node tests/cia-composite-evidence.test.mjs`  
Expected: FAIL karena role/relevance guard belum tersedia.

- [ ] **Step 3: Implementasikan goal roles dan bounded expansion**

Planner tetap memakai maksimal enam goals dan empat retrieval rounds. Gap
analyzer menambahkan denominator/target/detail hanya dari candidate anchored.

- [ ] **Step 4: Implementasikan synthesis relevance guard**

Sebelum prompt synthesis, buang evidence yang tidak cocok source constraint,
business concept, periode, atau entity eksplisit. Jika tidak ada evidence cocok,
kembalikan keterbatasan spesifik tanpa menampilkan row lain.

- [ ] **Step 5: Jalankan tests**

Run: `cd backend && node tests/cia-composite-evidence.test.mjs && node tests/cia-evidence-gap.test.mjs && node tests/cia-evidence-synthesizer.test.mjs && node tests/cia-evidence-orchestrator.test.mjs`  
Expected: PASS dan unrelated evidence tidak masuk jawaban.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/cia/evidencePlanner.js backend/src/services/cia/evidenceGapAnalyzer.js backend/src/services/cia/evidenceSynthesizer.js backend/src/services/cia/evidenceOrchestrator.js backend/tests/cia-composite-evidence.test.mjs backend/tests/cia-evidence-gap.test.mjs backend/tests/cia-evidence-synthesizer.test.mjs backend/tests/run-all.mjs
git commit -m "feat(cia): compose and validate multi-metric evidence"
```

### Task 6: Shared Surface Integration dan Human Labels

**Files:**
- Modify: `backend/src/services/cia/webEvidenceAdapter.js`
- Modify: `backend/src/services/whatsappListener.service.js`
- Modify: `backend/src/services/cia/evidenceSynthesizer.js`
- Modify: `backend/tests/cia-dashboard-adapter.test.mjs`
- Modify: `backend/tests/cia-whatsapp-telemetry.test.mjs`
- Modify: `backend/tests/cia-human-labels.test.mjs`
- Modify: `frontend/src/components/AskAIPanel.jsx`
- Modify: `frontend/src/services/unifiedChatApi.js`
- Modify: `frontend/tests/cia-unified-evidence.test.mjs`

**Interfaces:**
- Semua surface mengirim `conversation`, `preferredDashboardIds`, dan optional `reportContext` ke `answerWithEvidence`.
- Response tetap backward-compatible; metadata boleh menambah `evidenceContract` internal.

- [ ] **Step 1: Tulis failing contract tests untuk tiga surface**

Pastikan dashboard mengirim report aktif, Multi-Chat mengirim contract turn, dan
WhatsApp mengirim history JID yang sama. Pastikan output tidak mengandung
`nama_mesin`, qualified column, atau measure mentah.

- [ ] **Step 2: Jalankan surface tests dan verifikasi kegagalan**

Run: `cd backend && node tests/cia-dashboard-adapter.test.mjs && node tests/cia-whatsapp-telemetry.test.mjs && node tests/cia-human-labels.test.mjs`  
Expected: minimal satu FAIL pada context/label contract baru.

- [ ] **Step 3: Teruskan envelope yang sama pada seluruh adapter**

Reuse `runWebEvidence` dan `answerWithEvidence`; jangan membuat router baru di
controller/listener.

- [ ] **Step 4: Humanize result keys sebelum synthesis/fallback**

Prioritas label: KPI human name, visual caption, configured dimension humanName,
kemudian cleaned field label. Technical key hanya boleh muncul di admin trace.

- [ ] **Step 5: Jalankan backend dan frontend tests**

Run: `cd backend && node tests/cia-dashboard-adapter.test.mjs && node tests/cia-whatsapp-telemetry.test.mjs && node tests/cia-human-labels.test.mjs`  
Run: `cd frontend && node tests/cia-unified-evidence.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/cia/webEvidenceAdapter.js backend/src/services/whatsappListener.service.js backend/src/services/cia/evidenceSynthesizer.js backend/tests/cia-dashboard-adapter.test.mjs backend/tests/cia-whatsapp-telemetry.test.mjs backend/tests/cia-human-labels.test.mjs frontend/src/components/AskAIPanel.jsx frontend/src/services/unifiedChatApi.js frontend/tests/cia-unified-evidence.test.mjs
git commit -m "feat(cia): share hybrid context across all chat surfaces"
```

### Task 7: Acceptance Evaluation dan Safe Rollout

**Files:**
- Create: `backend/tests/cia-hybrid-regression.test.mjs`
- Modify: `backend/tests/run-all.mjs`
- Modify: `backend/.env.example`
- Modify: `docs/DEPLOYMENT.md`

**Interfaces:**
- Feature flag: `CIA_HYBRID_QUERY_ENABLED=true`.
- Regression test consumes `CIA_REGRESSION_CASES` and injected fake library/executor.

- [ ] **Step 1: Tulis failing regression runner**

Untuk setiap fixture, assertion wajib memeriksa concepts, source selection,
period kind, entity preservation, goal roles, dan forbidden source. Pertanyaan
follow-up dijalankan sebagai pasangan turn.

- [ ] **Step 2: Jalankan regression runner**

Run: `cd backend && node tests/cia-hybrid-regression.test.mjs`  
Expected: FAIL bila salah satu dari 27 kasus memilih sumber/domain yang salah.

- [ ] **Step 3: Pasang feature flag pada orchestrator**

Flag false mempertahankan jalur existing; flag true memakai intent/context/
blueprint baru. Dokumentasikan restart backend dan rollback flag.

- [ ] **Step 4: Jalankan seluruh suite dan build**

Run: `cd backend && npm test`  
Expected: seluruh backend tests PASS.  
Run: `cd frontend && npm run build`  
Expected: build sukses tanpa error.

- [ ] **Step 5: Jalankan smoke read-only**

Uji minimal: Evergreen Juni pada dashboard 44, downtime + running hours,
production vs PO, overtime cut-off, deviasi CMD3, serta satu follow-up. Verifikasi
source, period, entity, retrieval method, dan tidak ada technical labels.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/cia-hybrid-regression.test.mjs backend/tests/run-all.mjs backend/.env.example docs/DEPLOYMENT.md
git commit -m "test(cia): lock hybrid query acceptance corpus"
```

