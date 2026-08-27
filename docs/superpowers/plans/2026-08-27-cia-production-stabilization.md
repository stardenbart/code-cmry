# CIA Production Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuktikan platform CIA baru aman, stabil, dapat diobservasi, dan dapat di-rollback di production sebelum jalur legacy dinonaktifkan.

**Architecture:** Regression replay menggunakan dependency nyata tetapi corpus pertanyaan tetap; shadow/canary policy memilih actor secara deterministic dan tidak menggandakan synthesis. Health gate dihitung dari telemetry, load test mengukur bounded concurrency, dan runbook menyatukan migrasi, flag, smoke test, rollback, serta rotasi credential. Adapter legacy baru boleh dihentikan setelah dua release stabil.

**Tech Stack:** Node.js ESM scripts/tests, CIA Telemetry/Admin Analytics, existing feature flags, Power BI and AI adapters, Markdown runbooks.

## Global Constraints

- Plan ini dijalankan setelah empat fase fungsional selesai dan test masing-masing hijau.
- Tidak ada mutation production dari test tanpa flag `--execute`; default semua script dry-run/read-only.
- Regression output tidak menyimpan row data Power BI lengkap; hanya source, period, counts, normalized status, latency, dan hash jawaban.
- Shadow tidak mengirim jawaban alternatif ke user dan tidak menjalankan synthesis kedua.
- Canary assignment deterministic per user/request fingerprint agar pengalaman tidak berubah acak antar-refresh.
- Jangan menghapus tabel/kolom/adapter legacy dalam release stabilisasi pertama.

## File Structure

- Create `backend/scripts/replay-cia-regressions.mjs`.
- Create `backend/src/services/cia/canaryPolicy.js`.
- Create `backend/tests/cia-canary-policy.test.mjs`.
- Create `backend/scripts/cia-load-smoke.mjs`.
- Create `backend/tests/cia-production-gates.test.mjs`.
- Extend `backend/src/services/ciaAdminAnalytics.service.js` dan Admin Health API.
- Extend Admin Health frontend tab.
- Create `docs/runbooks/cia-production-rollout.md`.
- Modify `backend/.env.example` dengan flag rollout non-secret.

---

### Task 1: Deterministic canary policy

**Files:**
- Create: `backend/src/services/cia/canaryPolicy.js`
- Create: `backend/tests/cia-canary-policy.test.mjs`
- Modify: dashboard, Multi-Chat, dan WA adapters untuk memanggil policy.

**Interfaces:**
- Produces: `resolveCiaExecutionMode({ actorId, surface, requestFingerprint, env }) -> "legacy"|"shadow"|"canary"|"enabled"`.

- [ ] **Step 1: Tulis policy matrix test**

Cover global flag off, admin allowlist, surface-specific flag, 0/10/100 percent, invalid env, dan stable hash assignment.

- [ ] **Step 2: Implement safe precedence**

```js
force legacy > global flag off > explicit actor allowlist > canary percent > shadow percent > legacy
```

Env:

```dotenv
CIA_ORCHESTRATOR_CANARY_USER_IDS=
CIA_ORCHESTRATOR_CANARY_PERCENT=0
CIA_ORCHESTRATOR_SHADOW_PERCENT=0
```

Clamp percent 0–100. User body/header tidak dapat override mode.

- [ ] **Step 3: Integrate adapters**

Shadow hanya menjalankan period resolution, access scope, dan routing; simpan candidate/latency event. Jangan execute DAX/synthesis agar tidak menambah load/billing pada fase awal. Canary menjalankan full orchestrator.

- [ ] **Step 4: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/cia/canaryPolicy.js backend/src/controllers/aiController.js backend/src/services/whatsappQA.service.js backend/tests/cia-canary-policy.test.mjs
git commit -m "feat(cia): add deterministic shadow and canary policy"
```

---

### Task 2: Regression replay script

**Files:**
- Create: `backend/scripts/replay-cia-regressions.mjs`
- Modify: `backend/package.json`
- Create: `backend/tests/cia-regression-replay.test.mjs`

**Interfaces:**
- Produces: `npm run cia:regression -- --dry-run|--execute --surface=web --output=<path>`.

- [ ] **Step 1: Tulis fake replay test**

Assert dry-run tidak memanggil Power BI/AI; execute memproses corpus berurutan dengan concurrency default 1; output redacted dan exit 1 bila gate mandatory gagal.

- [ ] **Step 2: Implement output JSONL**

Satu line per case:

```js
{
  caseId, requestId, status, routingMatched, expectedSourceKinds,
  actualSourceIds, retrievalMethod, rounds, latencyMs,
  inputTokens, outputTokens, warnings, answerHash,
}
```

Jangan menyimpan question bila `--include-question` tidak diberikan; sekalipun diberikan, gunakan approved regression corpus, bukan pertanyaan user production.

- [ ] **Step 3: Add script/test/commit**

```json
"cia:regression": "node scripts/replay-cia-regressions.mjs"
```

Run: `cd backend; npm test; npm run cia:regression -- --dry-run`

```powershell
git add backend/scripts/replay-cia-regressions.mjs backend/tests/cia-regression-replay.test.mjs backend/package.json
git commit -m "test(cia): add safe production regression replay"
```

---

### Task 3: Computed production health gates

**Files:**
- Modify: `backend/src/services/ciaAdminAnalytics.service.js`
- Modify: `backend/src/routes/adminCiaRoutes.js`
- Create: `backend/tests/cia-production-gates.test.mjs`
- Modify: `frontend/src/components/admin/CiaHealthTab.jsx`
- Modify: `frontend/tests/cia-admin-page.test.mjs`

**Interfaces:**
- Produces: `GET /api/admin/cia/health/gates?from&to`.

- [ ] **Step 1: Tulis exact gate tests**

Fixtures di boundary: routing 95%, DAX 90%, telemetry 99%, duplicate delivery 0. Assert denominator 0 menjadi `insufficient_data`, bukan pass 100%.

- [ ] **Step 2: Implement gate response**

```js
{
  ready: false,
  gates: [{
    key: "routing_success", value: 94.9, threshold: 95,
    operator: ">=", status: "fail", numerator: 949, denominator: 1000,
  }],
}
```

Filter tetap memakai rentang maksimal 366 hari dan query parameterized.

- [ ] **Step 3: Render gates UI**

Health tab menampilkan pass/fail/insufficient, denominator, threshold, dan link ke filtered traces. Tidak ada tombol enable otomatis; Admin tetap mengubah environment deployment secara sadar.

- [ ] **Step 4: Verify/commit**

Run: `cd backend; npm test`; lalu `cd frontend; npm test; npm run build`.

```powershell
git add backend/src/services/ciaAdminAnalytics.service.js backend/src/routes/adminCiaRoutes.js backend/tests/cia-production-gates.test.mjs frontend/src/components/admin/CiaHealthTab.jsx frontend/tests/cia-admin-page.test.mjs
git commit -m "feat(cia): calculate production readiness gates"
```

---

### Task 4: Bounded load smoke test

**Files:**
- Create: `backend/scripts/cia-load-smoke.mjs`
- Modify: `backend/package.json`
- Create: `backend/tests/cia-load-smoke.test.mjs`

**Interfaces:**
- Produces: `npm run cia:load-smoke -- --dry-run|--execute --base-url --token-env CIA_SMOKE_TOKEN --concurrency=2 --requests=10`.

- [ ] **Step 1: Tulis CLI safety tests**

Default dry-run. Execute tanpa token env gagal sebelum network. Concurrency maksimum 5, requests maksimum 100. Output tidak mencetak bearer token.

- [ ] **Step 2: Implement standard-library runner**

Gunakan native `fetch`, `performance.now`, dan worker queue sederhana. Pertanyaan berasal dari regression fixture. Summary:

```js
{
  requests, success, failed, p50Ms, p95Ms, maxMs,
  liveDaxRate, fallbackRate, averageRounds, totalTokens,
}
```

- [ ] **Step 3: Add script/test/commit**

```json
"cia:load-smoke": "node scripts/cia-load-smoke.mjs"
```

Run: `cd backend; npm test; npm run cia:load-smoke -- --dry-run`

```powershell
git add backend/scripts/cia-load-smoke.mjs backend/tests/cia-load-smoke.test.mjs backend/package.json
git commit -m "test(cia): add bounded load smoke runner"
```

---

### Task 5: Production rollout and rollback runbook

**Files:**
- Create: `docs/runbooks/cia-production-rollout.md`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces: one operator checklist with exact flags, commands, gates, rollback, and owner evidence.

- [ ] **Step 1: Write runbook with preflight**

Include backup verification, migration dry-run/order, DB connection, Power BI approved models, provider quota/key readiness, WA session holder, scheduler enabled state, current feature flags, and credential rotation reminder.

- [ ] **Step 2: Add rollout steps**

Exact order: telemetry → KPI read-through → 10% shadow routing → selected-user web canary → percent web canary → WA canary → schedule test destination → multi-schedule. Each step records start/end, operator, gate result, and rollback decision.

- [ ] **Step 3: Add rollback matrix**

Map symptom to flag and consequence: routing no-match, DAX 401/403, latency/token spike, ACL violation, WA reconnect storm, duplicate delivery. Rollback never deletes schema/data.

- [ ] **Step 4: Update env example**

Add all non-secret flags from roadmap plus canary/shadow variables with comments. Do not copy any value from `.env`.

- [ ] **Step 5: Commit**

```powershell
git add docs/runbooks/cia-production-rollout.md backend/.env.example
git commit -m "docs(cia): add production rollout and rollback runbook"
```

---

### Task 6: Legacy retirement gate, not immediate deletion

**Files:**
- Create: `docs/runbooks/cia-legacy-retirement.md`
- Modify: no runtime code in this task.

**Interfaces:**
- Produces: auditable removal prerequisites for a later PR.

- [ ] **Step 1: Document objective evidence**

Require two stable production releases, zero ACL incident, gates pass for 14 consecutive days, no legacy-only consumer, backfill complete, rollback rehearsal complete, and explicit product owner approval.

- [ ] **Step 2: Inventory later removal targets**

List `KATALOG_KPI` fallback, snapshot-first branches, singleton `report_setting` adapter, fixed legacy cron, old Report Setting modal, and old response fields. Mark each `keep`, `deprecate`, or `remove later`; do not remove now.

- [ ] **Step 3: Verify inventory against repository**

Run `rg -n "KATALOG_KPI|snapshotResults|report_setting|CRON_KUMPUL|ReportSettingModal" backend/src frontend/src` dan pastikan setiap runtime branch yang ditemukan tercatat di retirement document dengan owner serta rollback dependency.

- [ ] **Step 4: Commit**

```powershell
git add docs/runbooks/cia-legacy-retirement.md
git commit -m "docs(cia): define evidence for legacy retirement"
```

## Final Verification Checklist

- [ ] Backend full suite PASS and frontend full suite/build PASS.
- [ ] All migrations run twice successfully on production-like clone.
- [ ] Regression corpus passes mandatory routing/access/fallback assertions.
- [ ] Load smoke meets agreed p95 and shows no unbounded rounds/repair.
- [ ] Production Health gates show pass or documented insufficient-data hold.
- [ ] Secret scan shows no credential, QR, pairing code, token, or Power BI row payload in telemetry/log artifacts.
- [ ] Rollback of each feature flag rehearsed without schema rollback.
- [ ] Legacy adapters remain present until retirement gate is separately approved.
