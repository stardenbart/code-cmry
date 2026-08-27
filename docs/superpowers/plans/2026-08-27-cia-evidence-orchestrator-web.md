# CIA Evidence Orchestrator for Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat CIA di dashboard dan Multi-Chat mengambil data Power BI live secara fleksibel sesuai pertanyaan, periode, dan kebutuhan korelasi lintas dashboard, tanpa bergantung pada filter/snapshot awal user.

**Architecture:** Evidence Orchestrator menjalankan pipeline shared: normalize request → resolve access scope → deterministic KPI routing → optional AI planning → bounded DAX retrieval → evidence gap analysis → additional dashboard retrieval → synthesis with citations/confidence. Snapshot hanya dipakai setelah jalur live gagal atau bukti tidak tersedia. Adapter mempertahankan response lama dan feature flag memungkinkan shadow/canary rollout.

**Tech Stack:** Node.js ESM, existing AI provider router, Power BI ExecuteQueries, KPI Library, CIA Telemetry, Express, React 18.

## Global Constraints

- Maximum retrieval rounds 4; maximum DAX repair 1 per semantic model.
- Deterministic KPI matches tidak boleh dibuang hanya karena AI planner mengembalikan kandidat kosong.
- Query generic (`issue`, `breakdown`, `analisa`) mempunyai bobot rendah; domain spesifik (`lembur`, `deviasi`, `PO`, `CMD 3`) menang.
- DAX dibuat dari metadata allowlisted. Jangan mengeksekusi table/column/measure yang tidak ada pada schema model.
- Period intent berasal dari pertanyaan dan timezone Asia/Jakarta, bukan state filter embedded report.
- Website memakai ACL user; preferred dashboard hanya hint dan tidak memperluas akses.
- Setiap claim korelasi wajib mengacu minimal dua evidence source dengan period compatible.
- Bila evidence tidak cukup, jawaban menyatakan keterbatasan; jangan mengubah korelasi menjadi sebab-akibat.
- Snapshot fallback wajib menyertakan warning dan `retrievalMethod: "snapshot"|"mixed"`.
- Semua row diberi human labels sebelum masuk prompt synthesis.

## File Structure

- Create `backend/src/services/cia/periodResolver.js`.
- Create `backend/src/services/cia/accessScope.js`.
- Create `backend/src/services/cia/evidenceRouter.js`.
- Create `backend/src/services/cia/evidencePlanner.js`.
- Create `backend/src/services/cia/daxPlanBuilder.js`.
- Create `backend/src/services/cia/daxEvidenceExecutor.js`.
- Create `backend/src/services/cia/evidenceGapAnalyzer.js`.
- Create `backend/src/services/cia/evidenceSynthesizer.js`.
- Create `backend/src/services/cia/evidenceOrchestrator.js`.
- Modify `backend/src/services/daxAgent.service.js`, `backend/src/services/powerbiMeta.service.js`, dan methods `ask`/`unifiedAsk` di `backend/src/controllers/aiController.js`.
- Create regression fixtures/tests under `backend/tests/cia-evidence-*`.
- Modify `frontend/src/components/AskAIPanel.jsx` or actual dashboard CIA component.
- Modify `frontend/src/components/UnifiedChatPanel.jsx` and `frontend/src/services/unifiedChatApi.js`.
- Create `frontend/src/components/chat/CiaEvidenceMeta.jsx`.

---

### Task 1: Regression corpus dan orchestrator contracts

**Files:**
- Create: `backend/tests/fixtures/cia-regression-cases.mjs`
- Create: `backend/src/services/cia/contracts.js`
- Create: `backend/tests/cia-evidence-contracts.test.mjs`

**Interfaces:**
- Produces: `normalizeEnvelope`, `normalizeAnswer`, constants surface/method/status/stage.

- [ ] **Step 1: Encode approved regressions**

Fixture minimum:

```js
export const cases = [
  { id: "overtime-breakdown", question: "jelaskan breakdown lembur harian per departemen dikarenakan alasan dan kategori apa", expects: ["overtime"] },
  { id: "cmd3-deviation", question: "breakdown perihal deviasi cmd 3, jelaskan issue deviasi yang terjadi", expects: ["deviation_cmd3"] },
  { id: "overtime-po-correlation", question: "apakah lembur produksi A tinggi karena PO naik, produk apa dan kenapa", expects: ["overtime", "ppic_po"] },
  { id: "last-month", question: "bandingkan lembur bulan lalu dengan bulan ini", expectsPeriods: 2 },
  { id: "last-year", question: "bagaimana deviasi tahun lalu dibanding aktual", expectsPeriods: 2 },
];
```

- [ ] **Step 2: Implement answer envelope defaults**

`normalizeAnswer` selalu menghasilkan `answer`, `requestId`, `confidence`, `retrievalMethod`, `sources`, `warnings`, `usage`, `rounds`. Invalid enum menjadi safe default, bukan diteruskan.

- [ ] **Step 3: Run test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/tests/fixtures/cia-regression-cases.mjs backend/src/services/cia/contracts.js backend/tests/cia-evidence-contracts.test.mjs
git commit -m "test(cia): define evidence orchestrator contracts"
```

---

### Task 2: Period resolver yang independen dari report filter

**Files:**
- Create: `backend/src/services/cia/periodResolver.js`
- Create: `backend/tests/cia-period-resolver.test.mjs`

**Interfaces:**
- Produces: `resolvePeriods(question, now, timezone) -> PeriodIntent[]`.

- [ ] **Step 1: Tulis boundary tests**

Cover `hari ini`, `minggu lalu`, `24-30 Agustus 2026`, `bulan lalu`, `tahun lalu`, `aktual`, comparison dua periode, leap year, dan pergantian tahun WIB.

- [ ] **Step 2: Implement deterministic resolver**

Result:

```js
{
  label: "Bulan lalu",
  from: "2026-07-01",
  to: "2026-07-31",
  grain: "day",
  comparisonKey: "previous_month",
}
```

Bila tidak ada waktu eksplisit, default berasal dari KPI binding `dateLogic`; bila tidak ada, gunakan periode aktual dashboard sebagai last resort dan beri warning `PERIOD_DEFAULTED`.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/periodResolver.js backend/tests/cia-period-resolver.test.mjs
git commit -m "feat(cia): resolve query periods independently"
```

---

### Task 3: Access scope untuk web dan centralized surface

**Files:**
- Create: `backend/src/services/cia/accessScope.js`
- Create: `backend/tests/cia-access-scope.test.mjs`

**Interfaces:**
- Produces: `resolveEvidenceScope({ actor, accessMode, preferredDashboardIds })`.

- [ ] **Step 1: Tulis deny tests**

Web user dengan dashboard A dan preferred B hanya mendapat A. User tanpa ACL mendapat array kosong/403 path. `centralized` hanya sah untuk internal surface `whatsapp|schedule`; request web yang mengirim string itu tidak dapat mengaktifkannya.

- [ ] **Step 2: Implement server-derived access mode**

Controller menetapkan access mode, bukan body user. Result:

```js
{
  allowedDashboardIds: ["..."],
  preferredDashboardIds: ["..."],
  deniedPreferredDashboardIds: ["..."],
  mode: "user_acl",
}
```

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/accessScope.js backend/tests/cia-access-scope.test.mjs
git commit -m "feat(cia): enforce evidence source scope"
```

---

### Task 4: Hybrid evidence router

**Files:**
- Create: `backend/src/services/cia/evidenceRouter.js`
- Create: `backend/tests/cia-evidence-router.test.mjs`

**Interfaces:**
- Consumes: KPI Library search, scope.
- Produces: `routeEvidence({ question, periods, scope, aiPlanner }) -> RoutePlan`.

- [ ] **Step 1: Tulis production failure regression**

Mock AI planner mengembalikan `{ candidates: [] }`. Assert query lembur dan deviasi tetap memiliki kandidat deterministic serta tidak melempar `tidak ada dashboard yang relevan`.

- [ ] **Step 2: Implement merge policy**

```js
const merged = dedupeByBinding([
  ...deterministicCandidates.map((x) => ({ ...x, origin: "deterministic" })),
  ...aiCandidates.map((x) => ({ ...x, origin: "ai" })),
]);
```

AI boleh menambah intent/dimensions/correlation hints, tetapi hanya id binding dari allowlist. Jika semua kosong, return structured `NO_RELEVANT_KPI` dengan top vocabulary suggestions; jangan throw string generik.

- [ ] **Step 3: Telemetry**

Emit `route_candidates` dengan count/ids (bukan prompt) dan `planner_no_match` bila AI kosong.

- [ ] **Step 4: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/evidenceRouter.js backend/tests/cia-evidence-router.test.mjs
git commit -m "fix(cia): preserve deterministic dashboard routing"
```

---

### Task 5: Structured planner adapter

**Files:**
- Create: `backend/src/services/cia/evidencePlanner.js`
- Create: `backend/tests/cia-evidence-planner.test.mjs`
- Modify: `backend/src/services/modelRouter.js` untuk meneruskan usage/provider/model pada structured planning call.

**Interfaces:**
- Produces: `planEvidence({ question, periods, candidateBindings, conversation })`.

- [ ] **Step 1: Tulis malformed/time-out tests**

Invalid JSON, unknown binding id, timeout, and empty response return safe empty additions plus warning, never abort deterministic route.

- [ ] **Step 2: Implement strict parser**

Accepted shape:

```js
{
  goals: [{ kpiBindingId, dimensions: [], periodIndex: 0, purpose: "primary|correlation" }],
  followUpSignals: [{ concept, reason }],
}
```

Remove ids not in candidates, cap goals at 6, dimensions at 6, string length at 100.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/evidencePlanner.js backend/tests/cia-evidence-planner.test.mjs
git commit -m "feat(cia): add bounded structured evidence planner"
```

---

### Task 6: Metadata-validated DAX plan builder

**Files:**
- Create: `backend/src/services/cia/daxPlanBuilder.js`
- Create: `backend/tests/cia-dax-plan-builder.test.mjs`

**Interfaces:**
- Produces: `buildDaxPlan({ goal, binding, period, schema, rowLimit })`.

- [ ] **Step 1: Tulis golden DAX tests**

Cover overtime grouped by date/department/reason/category, deviasi CMD3 category/description, PO product/group, two-period comparison. Assert unrecognized dimension/table/measure rejected before API call.

- [ ] **Step 2: Implement safe builders**

Plan object:

```js
{
  semanticModel, dashboardId, period,
  dax: "EVALUATE TOPN(500, ...)",
  selectedKpis: [{ bindingId, humanName }],
  selectedDimensions: [{ table, column, humanName }],
  maxRows: 500,
}
```

DAX identifier hanya berasal dari schema/binding allowlist. Literal date/string di-escape oleh helper tunggal dan tidak berasal dari raw snippets AI.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/daxPlanBuilder.js backend/tests/cia-dax-plan-builder.test.mjs
git commit -m "feat(cia): build validated period-aware DAX plans"
```

---

### Task 7: DAX executor dengan satu repair dan typed errors

**Files:**
- Create: `backend/src/services/cia/daxEvidenceExecutor.js`
- Modify: `backend/src/services/daxAgent.service.js`
- Modify: `backend/src/services/powerbiMeta.service.js`
- Create: `backend/tests/cia-dax-executor.test.mjs`

**Interfaces:**
- Produces: `executeEvidencePlan(plan, deps) -> EvidenceResult`.

- [ ] **Step 1: Tulis outcome matrix**

Success first try; invalid DAX repaired once; second invalid stops; 401 credential; 403 model permission; timeout; empty rows; Power BI throttle. Assert call count maksimum dua per plan.

- [ ] **Step 2: Implement typed result**

```js
{
  status: "success" | "empty" | "failed",
  errorCode: null | "DAX_INVALID" | "POWERBI_AUTH" | "POWERBI_FORBIDDEN" |
    "POWERBI_TIMEOUT" | "POWERBI_THROTTLED" | "POWERBI_UNKNOWN",
  attempts, rows, columns, rowCount, durationMs, period, source,
}
```

Jangan log Axios object. Repair menerima error message aman + schema + DAX pertama; output repair divalidasi lagi.

- [ ] **Step 3: Apply human labels before return**

`rows/columns` yang dikembalikan ke orchestrator sudah melalui `ciaHumanLabels.service.js`.

- [ ] **Step 4: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/daxEvidenceExecutor.js backend/src/services/daxAgent.service.js backend/src/services/powerbiMeta.service.js backend/tests/cia-dax-executor.test.mjs
git commit -m "feat(cia): execute and repair DAX evidence safely"
```

---

### Task 8: Gap analyzer dan korelasi lintas dashboard

**Files:**
- Create: `backend/src/services/cia/evidenceGapAnalyzer.js`
- Create: `backend/tests/cia-evidence-gap.test.mjs`

**Interfaces:**
- Produces: `analyzeEvidenceGap({ question, plan, evidence, round, library })`.

- [ ] **Step 1: Tulis multi-round tests**

Pertanyaan lembur+PO: round 1 overtime menemukan produksi A; analyzer meminta PPIC PO dengan product dimension; round 2 evidence cukup. Follow-up baru tentang quality meminta dashboard ketiga. Repeated goal deduped. Round 4 stops.

- [ ] **Step 2: Implement deterministic completeness first**

Periksa primary KPI, requested dimensions, requested periods, comparison, and correlation concepts. AI gap suggestion optional dan hanya memilih binding library allowlisted.

Result:

```js
{
  complete: false,
  missing: ["correlation:ppic_po", "dimension:product"],
  additionalGoals: [{ kpiBindingId, periodIndex, dimensions, purpose }],
  warnings: [],
}
```

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/evidenceGapAnalyzer.js backend/tests/cia-evidence-gap.test.mjs
git commit -m "feat(cia): retrieve follow-up evidence across dashboards"
```

---

### Task 9: Evidence synthesis, citations, confidence, fallback

**Files:**
- Create: `backend/src/services/cia/evidenceSynthesizer.js`
- Create: `backend/tests/cia-evidence-synthesizer.test.mjs`

**Interfaces:**
- Produces: `synthesizeEvidence({ question, evidence, warnings, snapshotFallback })`.

- [ ] **Step 1: Tulis grounded-answer tests**

Assert source names/periods included; human labels used; causal language rejected/rephrased to correlation unless evidence supports mechanism; no evidence uses honest limitation; snapshot warning explicit.

- [ ] **Step 2: Implement evidence packet**

Prompt menerima compact packet per source, capped rows, definitions, periods, and allowed claims. Parser menghasilkan answer + cited source indexes; invalid citations removed and confidence lowered.

Confidence:

```js
high   = primary evidence live + requested dimensions/period complete + no critical error
medium = live evidence partial atau mixed snapshot
low    = snapshot only, empty live result, atau unresolved gap
```

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/evidenceSynthesizer.js backend/tests/cia-evidence-synthesizer.test.mjs
git commit -m "feat(cia): synthesize grounded cited answers"
```

---

### Task 10: Main orchestrator dan telemetry

**Files:**
- Create: `backend/src/services/cia/evidenceOrchestrator.js`
- Create: `backend/tests/cia-evidence-orchestrator.test.mjs`

**Interfaces:**
- Produces: `answerWithEvidence(envelope, deps) -> AnswerEnvelope`.

- [ ] **Step 1: Tulis end-to-end fake dependency tests**

Test success one round, cross-dashboard two rounds, new follow-up dashboard, DAX fail→snapshot, no match, access denied, four-round cap, token/event aggregation.

- [ ] **Step 2: Implement bounded loop**

```js
for (let round = 1; round <= maxRounds; round += 1) {
  const results = await executeUnseenGoals(goals, evidenceKeys);
  evidence.push(...results);
  const gap = await analyzeEvidenceGap({ question, plan, evidence, round, library });
  if (gap.complete || !gap.additionalGoals.length) break;
  goals = gap.additionalGoals;
}
```

Semua event memakai tracker yang sama: `scope_resolved`, `route_candidates`, `ai_plan`, `dax_attempt`, `dax_repair`, `evidence_gap`, `ai_synthesis`, `snapshot_fallback`, `response_sent`.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/evidenceOrchestrator.js backend/tests/cia-evidence-orchestrator.test.mjs
git commit -m "feat(cia): orchestrate bounded multi-dashboard evidence"
```

---

### Task 11: Integrasi dashboard CIA dengan compatibility flag

**Files:**
- Modify: `backend/src/controllers/aiController.js`
- Create: `backend/tests/cia-dashboard-adapter.test.mjs`

**Interfaces:**
- Existing endpoint tetap menerima body lama; tambahan opsional `preferredDashboardIds`, `conversationId`.

- [ ] **Step 1: Tulis old/new contract tests**

Flag false => legacy handler. Flag true => orchestrator. Orchestrator throws unexpectedly => legacy fallback plus telemetry warning, bukan blank response. Field lama answer/period tetap ada.

- [ ] **Step 2: Implement adapter**

Dashboard id yang sedang dibuka menjadi preferred hint. Jangan memasukkan embedded filter/snapshot kecuali sebagai `snapshotFallback`. Period ditentukan dari pertanyaan.

- [ ] **Step 3: Run tests and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/controllers/aiController.js backend/tests/cia-dashboard-adapter.test.mjs
git commit -m "feat(cia): enable live evidence in dashboard chat"
```

---

### Task 12: Integrasi Multi-Chat tanpa snapshot-first

**Files:**
- Modify: `backend/src/controllers/aiController.js` method `unifiedAsk`.
- Modify: `frontend/src/services/unifiedChatApi.js`
- Modify: `frontend/src/components/UnifiedChatPanel.jsx`
- Create: `frontend/src/components/chat/CiaEvidenceMeta.jsx`
- Create: `frontend/tests/cia-multichat-evidence.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Request baru `{ question, conversationId, preferredDashboardIds }`; legacy `snapshots` masih diterima sebagai fallback.

- [ ] **Step 1: Tulis frontend/backend contract tests**

Assert frontend tidak memblokir kirim saat snapshot belum capture; dashboard selection disebut `Sumber pilihan`/hint; response sources/warnings visible.

- [ ] **Step 2: Update backend unified adapter**

Panggil orchestrator surface `multi_chat`. Conversation memory tetap dipakai untuk follow-up; source baru dapat ditarik walau tidak dipilih sebelumnya selama ACL mengizinkan.

- [ ] **Step 3: Update UI**

Hapus auto-capture sebagai primary path. Pertahankan capture lama hanya untuk fallback saat server meminta/flag mati. Render source chips, period, confidence, live/snapshot badge, dan warning.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
cd backend
npm test
cd ../frontend
npm test
npm run build
```

```powershell
git add backend/src/controllers/aiController.js backend/tests/cia-evidence-orchestrator.test.mjs frontend/src/services/unifiedChatApi.js frontend/src/components/UnifiedChatPanel.jsx frontend/src/components/chat/CiaEvidenceMeta.jsx frontend/tests/cia-multichat-evidence.test.mjs frontend/package.json
git commit -m "feat(cia): use flexible evidence retrieval in multi-chat"
```

## Phase Verification Checklist

- [ ] Kedua pertanyaan production failure memilih dashboard yang benar walau planner AI kosong.
- [ ] Query lembur mengembalikan departemen, alasan, kategori, dan hari dari DAX live bila field tersedia.
- [ ] Query deviasi CMD 3 mengembalikan kategori/deskripsi issue dari DAX live.
- [ ] Query lembur+PO mengambil dashboard lembur dan PPIC serta menyebut korelasi, bukan kausalitas tanpa bukti.
- [ ] Query bulan lalu/tahun lalu tidak membutuhkan user mengubah filter report.
- [ ] Follow-up dapat menambah dashboard baru tanpa memulai conversation baru.
- [ ] Web tidak pernah mengakses dashboard di luar ACL.
- [ ] Planner/DAX failure tidak menghasilkan blank screen; fallback dinyatakan eksplisit.
- [ ] Maksimum rounds/repair terjaga melalui call-count tests.
- [ ] Response source, period, confidence, method, usage, dan requestId tampil di web.
