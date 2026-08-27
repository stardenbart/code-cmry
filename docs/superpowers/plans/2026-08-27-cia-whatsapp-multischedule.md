# CIA WhatsApp Pairing & Multi-Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memakai Evidence Orchestrator yang sama untuk pertanyaan WhatsApp serta menyediakan satu nomor bot aktif yang dapat di-pair ulang, banyak destinasi group/channel/newsletter, dan banyak schedule dengan composer pesan serta delivery audit.

**Architecture:** `whatsappSessionManager` menjadi satu pemilik lifecycle Baileys dan satu active socket. Nomor default berasal dari env; database menyimpan expected number dan status metadata, bukan credential. Destination registry menyimpan JID terverifikasi. Scheduler tetap satu tick per menit, tetapi membaca banyak schedule, mengklaim run secara atomik, merender composer, mengambil data CIA centralized, lalu membuat delivery attempt per destination. Singleton `report_setting` diadaptasi menjadi schedule legacy sampai migrasi selesai.

**Tech Stack:** Node.js ESM, Baileys existing RC, MySQL 8, node-cron, Evidence Orchestrator, React 18.

## Global Constraints

- Hanya satu nomor bot aktif per deployment.
- `WHATSAPP_BOT_NUMBER` adalah default; setting database menang bila terisi.
- Auth state Baileys tetap di storage sesi yang ada dan tidak pernah disimpan ke database/API/log.
- Pairing code web hanya tersedia di memori, short-lived, Admin-only, dan tidak masuk telemetry. Jalur manager baru menonaktifkan pencetakan QR `qrcode-terminal` agar QR tidak masuk log PM2.
- Re-pair wajib tindakan eksplisit dengan konfirmasi; jangan memutus sesi aktif hanya karena halaman Admin dibuka.
- WhatsApp CIA mempunyai `accessMode: centralized`, tetapi hanya model/dashboard status approved Admin yang boleh dipakai.
- Group/channel/newsletter tergantung capability akun/versi Baileys. UI hanya menawarkan target yang berhasil ditemukan/diverifikasi, dan menyebut unsupported secara jujur.
- Tidak ada batas jumlah schedule pada business rule; API tetap paginate dan runner batasi concurrency.
- Idempotency key run = `(schedule_id, scheduled_for)`; delivery = `(run_id, destination_id)`.
- Test tidak boleh mengirim pesan nyata. Gunakan fake socket/delivery adapter.

## File Structure

- Create `backend/migrations/add_cia_whatsapp_multischedule.sql`.
- Create models `ciaWhatsappSettingModel.js`, `ciaDestinationModel.js`, `ciaScheduleModel.js`.
- Create services `whatsappSessionManager.js`, `ciaDestination.service.js`, `ciaMessageComposer.service.js`, `ciaScheduleRunner.service.js`, `ciaDelivery.service.js`.
- Modify `whatsapp.service.js`, `whatsappListener.service.js`, `whatsappQA.service.js`, `config/scheduler.js`, `dailySummaryJob.js`.
- Create `backend/src/routes/adminCiaWhatsappRoutes.js` or extend Admin CIA router.
- Create `backend/scripts/migrate-report-setting-to-cia-schedule.mjs`.
- Create backend tests `cia-whatsapp-*.test.mjs`, `cia-schedule-*.test.mjs`.
- Create frontend tabs/components for WhatsApp, Destinations, Schedules, Composer, Run History.
- Modify old Report Setting modal into redirect/compatibility notice.

---

### Task 1: WhatsApp/destination/schedule schema

**Files:**
- Create: `backend/migrations/add_cia_whatsapp_multischedule.sql`
- Create: `backend/tests/cia-schedule-schema.test.mjs`

**Interfaces:**
- Produces: `cia_whatsapp_setting`, `cia_notification_destinations`, `cia_schedules`, `cia_schedule_destinations`, `cia_schedule_runs`, `cia_delivery_attempts`.

- [ ] **Step 1: Tulis schema/index test**

Kolom penting:

```js
const setting = ["expected_number", "connection_status", "connected_number", "last_connected_at", "last_error_code", "updated_by"];
const destination = ["name", "jid", "type", "status", "is_test", "verified_at", "last_seen_at"];
const schedule = ["name", "enabled", "timezone", "frequency", "cron_expression", "composer_type", "template_text", "query_text", "dashboard_ids_json", "next_run_at", "last_run_at", "version", "created_by", "updated_by"];
const run = ["schedule_id", "scheduled_for", "status", "request_uuid", "started_at", "finished_at", "error_code", "error_message"];
```

- [ ] **Step 2: Implement idempotent migration**

Destination unique JID. Run unique `(schedule_id, scheduled_for)`. Delivery unique `(run_id, destination_id)`. FK schedule delete cascades mappings/runs; destination delete restricted bila punya audit—UI deactivates instead of hard delete.

- [ ] **Step 3: Run twice/test/commit**

Run dari root:

```powershell
bash scripts/migrate.sh
bash scripts/migrate.sh
cd backend
npm test
```

```powershell
git add backend/migrations/add_cia_whatsapp_multischedule.sql backend/tests/cia-schedule-schema.test.mjs
git commit -m "feat(cia): add WhatsApp and multi-schedule schema"
```

---

### Task 2: Single-owner WhatsApp session manager

**Files:**
- Create: `backend/src/services/whatsappSessionManager.js`
- Modify: `backend/src/services/whatsapp.service.js`
- Modify: `backend/src/services/whatsappListener.service.js`
- Create: `backend/tests/cia-whatsapp-session.test.mjs`

**Interfaces:**
- Produces:
  - `getSessionStatus()`
  - `ensureConnected()`
  - `beginPairing({ expectedNumber })`
  - `disconnect({ clearAuth })`
  - `withSocket(fn)`
  - `onSessionEvent(listener)`.

- [ ] **Step 1: Tulis lifecycle race tests**

Dua `ensureConnected` paralel membuat satu socket. Reconnect storm memakai satu in-flight promise. Status transition: disconnected→connecting→pairing→connected. Expected/connected number mismatch menghasilkan `NUMBER_MISMATCH` dan tidak dianggap ready.

- [ ] **Step 2: Refactor existing global session**

Pindahkan ownership `sock`, auth state, reconnect timer, dan listener install ke manager. `whatsapp.service.js` menjadi adapter `sendText(destinationJid, text)` melalui `withSocket`.

- [ ] **Step 3: Implement ephemeral pairing state**

```js
{
  status: "pairing_code",
  value: String,
  expiresAt: Date.now() + 60_000,
}
```

Value tidak dikembalikan setelah expiry dan diganti setiap attempt. Jangan log value.

- [ ] **Step 4: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/whatsappSessionManager.js backend/src/services/whatsapp.service.js backend/src/services/whatsappListener.service.js backend/tests/cia-whatsapp-session.test.mjs
git commit -m "refactor(cia): centralize WhatsApp session lifecycle"
```

---

### Task 3: WhatsApp setting dan Admin pairing API

**Files:**
- Create: `backend/src/models/ciaWhatsappSettingModel.js`
- Create/Modify: `backend/src/routes/adminCiaWhatsappRoutes.js`
- Modify: `backend/src/server.js`
- Create: `backend/tests/cia-whatsapp-routes.test.mjs`

**Interfaces:**
- Produces:
  - `GET /api/admin/cia/whatsapp/status`
  - `PUT /api/admin/cia/whatsapp/number` body `{ expectedNumber }`
  - `POST /api/admin/cia/whatsapp/pair` body `{ confirm: true }`
  - `POST /api/admin/cia/whatsapp/disconnect` body `{ clearAuth: boolean }`.

- [ ] **Step 1: Tulis auth/default tests**

Without DB row, expected number berasal dari `WHATSAPP_BOT_NUMBER`. Non-admin 403. Number dinormalisasi E.164 digits tanpa `+`; kosong mengembalikan env default. Pairing code hanya bila expected number valid.

- [ ] **Step 2: Implement response redaction**

Status boleh mengembalikan masked number dan full expected number hanya kepada Admin. Jangan return auth path/key/session tokens. Pair response hanya membawa ephemeral pairing code; manager tidak mencetak QR ke console.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/models/ciaWhatsappSettingModel.js backend/src/routes/adminCiaWhatsappRoutes.js backend/src/server.js backend/tests/cia-whatsapp-routes.test.mjs
git commit -m "feat(cia): manage one re-pairable WhatsApp number"
```

---

### Task 4: Destination discovery dan verification

**Files:**
- Create: `backend/src/models/ciaDestinationModel.js`
- Create: `backend/src/services/ciaDestination.service.js`
- Modify: `backend/src/routes/adminCiaWhatsappRoutes.js`
- Create: `backend/tests/cia-destinations.test.mjs`

**Interfaces:**
- Produces:
  - `discoverDestinations()`
  - CRUD `/api/admin/cia/whatsapp/destinations`
  - `POST .../destinations/:id/test`.

- [ ] **Step 1: Tulis supported-type tests**

Map group JID ke `group`; newsletter/channel only when socket discovery returns supported newsletter JID; individual contact may be stored but schedule UI default filters group/channel/newsletter. Unknown JID rejected.

- [ ] **Step 2: Implement upsert discovery**

Discovery memperbarui name/last_seen, tidak otomatis mengaktifkan tujuan. Admin harus memilih dan verifikasi. Test send menyimpan delivery attempt dengan `test` context dan pesan tetap `Tes koneksi CIA — <timestamp WIB>`.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/models/ciaDestinationModel.js backend/src/services/ciaDestination.service.js backend/src/routes/adminCiaWhatsappRoutes.js backend/tests/cia-destinations.test.mjs
git commit -m "feat(cia): discover and verify WhatsApp destinations"
```

---

### Task 5: Schedule model, validation, dan due-claim atomic

**Files:**
- Create: `backend/src/models/ciaScheduleModel.js`
- Create: `backend/tests/cia-schedule-model.test.mjs`

**Interfaces:**
- Produces:
  - `listSchedules`, `getSchedule`, `createSchedule`, `updateSchedule`, `setEnabled`
  - `listDueSchedules(now, limit)`
  - `claimScheduleRun(scheduleId, scheduledFor) -> { claimed, runId }`
  - `finishScheduleRun(runId, result)`.

- [ ] **Step 1: Tulis validation/idempotency tests**

Support `daily`, `weekly`, dan `cron`. Timezone wajib valid IANA. Cron wajib lolos `node-cron.validate`. Schedule boleh banyak dan nama tidak perlu unique. Dua claim paralel untuk slot sama menghasilkan tepat satu claimed.

- [ ] **Step 2: Implement next-run calculation**

Simpan `next_run_at` UTC. Daily/weekly dihitung dari timezone schedule; cron memakai minute tick + matcher existing. DST tidak relevan untuk Jakarta tetapi fungsi tetap tidak hardcode offset.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/models/ciaScheduleModel.js backend/tests/cia-schedule-model.test.mjs
git commit -m "feat(cia): add atomic multi-schedule model"
```

---

### Task 6: Flexible message composer

**Files:**
- Create: `backend/src/services/ciaMessageComposer.service.js`
- Create: `backend/tests/cia-message-composer.test.mjs`

**Interfaces:**
- Produces: `composeScheduledMessage({ schedule, now, orchestrator })`.

- [ ] **Step 1: Tulis composer mode tests**

Modes:

```js
"daily_cia_update" // query default komprehensif, centralized all approved sources
"cia_query"        // Admin menulis query analitik sendiri
"static_text"      // reminder tanpa retrieval AI
```

Assert template variables `{{date}}`, `{{time}}`, `{{schedule_name}}`, `{{cia_answer}}`; unknown variable ditolak saat save, bukan dikirim mentah.

- [ ] **Step 2: Implement daily query default**

Daily overall query meminta ringkasan perubahan, anomali, top issue, hubungan lintas fungsi, dan tindak lanjut dari semua source approved. Jangan batasi dashboard id kecuali Admin mengisi optional scope.

- [ ] **Step 3: Implement WhatsApp length handling**

Pesan panjang dipecah pada paragraph boundary dengan sequence `(1/N)`, mempertahankan source/periode di bagian akhir. Static text tidak memanggil orchestrator dan mencatat token 0.

- [ ] **Step 4: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/ciaMessageComposer.service.js backend/tests/cia-message-composer.test.mjs
git commit -m "feat(cia): compose reusable scheduled CIA messages"
```

---

### Task 7: Delivery attempts dan partial retry

**Files:**
- Create: `backend/src/services/ciaDelivery.service.js`
- Create: `backend/tests/cia-delivery.test.mjs`

**Interfaces:**
- Produces: `deliverRun({ runId, destinations, messages, socket })` dan `retryFailedDelivery(attemptId)`.

- [ ] **Step 1: Tulis fan-out tests**

Tiga destination: 2 success, 1 fail => run `partial`, attempt per destination. Retry hanya destination failed, tidak mengirim ulang success. Duplicate delivery insert tidak mengirim dua kali.

- [ ] **Step 2: Implement status/error safety**

Attempt statuses `pending|sending|sent|failed`; simpan provider message id bila ada, timestamps, safe error code/message. Jangan simpan full message lebih dari preview 500 chars; content lengkap berasal dari schedule run artifact existing bila perlu.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/ciaDelivery.service.js backend/tests/cia-delivery.test.mjs
git commit -m "feat(cia): audit and retry scheduled deliveries"
```

---

### Task 8: Multi-schedule runner dan cron tick integration

**Files:**
- Create: `backend/src/services/ciaScheduleRunner.service.js`
- Modify: `backend/src/config/scheduler.js`
- Modify: `backend/src/scheduler/dailySummaryJob.js`
- Create: `backend/tests/cia-schedule-runner.test.mjs`

**Interfaces:**
- Produces: `runDueSchedules({ now, holder, limit, concurrency })`.

- [ ] **Step 1: Tulis two-process/tick tests**

Dua runner pada waktu sama hanya membuat satu run per schedule slot. Failure satu schedule tidak menghentikan lainnya. Disabled schedule tidak claimed. Limit dan concurrency ditaati.

- [ ] **Step 2: Replace `jadwal-db` body behind flag**

Tick tetap `* * * * *`. Jika `CIA_MULTI_SCHEDULE_ENABLED=true`, panggil runner baru. Jika false, jalankan singleton logic lama persis. Fixed collect/retry/send jobs lama tetap aktif hanya untuk legacy mode agar tidak mengirim dua kali.

- [ ] **Step 3: Connect orchestrator centralized**

Composer `daily_cia_update|cia_query` memanggil `answerWithEvidence` dengan `surface: "schedule"`, `accessMode: "centralized"`, actor system, approved source scope, dan telemetry request id yang ditulis ke schedule run.

- [ ] **Step 4: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/ciaScheduleRunner.service.js backend/src/config/scheduler.js backend/src/scheduler/dailySummaryJob.js backend/tests/cia-schedule-runner.test.mjs
git commit -m "feat(cia): run many centralized CIA schedules"
```

---

### Task 9: Migrasi singleton `report_setting`

**Files:**
- Create: `backend/scripts/migrate-report-setting-to-cia-schedule.mjs`
- Modify: `backend/package.json`
- Create: `backend/tests/cia-schedule-migration.test.mjs`

**Interfaces:**
- Produces: `npm run cia:migrate-schedule -- --dry-run|--apply`.

- [ ] **Step 1: Tulis idempotent migration test**

Satu report setting aktif + comma-separated group JID menjadi satu schedule `Daily CIA Update (Legacy)` dan mapping destination. Apply dua kali tidak duplicate. Invalid JID dilaporkan dan tidak diaktifkan.

- [ ] **Step 2: Implement legacy marker**

Schedule mempunyai source/legacy reference yang unique. Provider field lama dipetakan ke composer AI provider only bila supported; global provider tetap fallback.

- [ ] **Step 3: Test/dry-run/commit**

Run: `cd backend; npm test; npm run cia:migrate-schedule -- --dry-run`

```powershell
git add backend/scripts/migrate-report-setting-to-cia-schedule.mjs backend/package.json backend/tests/cia-schedule-migration.test.mjs
git commit -m "feat(cia): migrate legacy daily report schedule"
```

---

### Task 10: WhatsApp CIA menggunakan Evidence Orchestrator

**Files:**
- Modify: `backend/src/services/whatsappQA.service.js`
- Modify: `backend/src/services/whatsappListener.service.js`
- Create: `backend/tests/cia-whatsapp-orchestrator.test.mjs`

**Interfaces:**
- Incoming mention/question -> orchestrator surface `whatsapp`, centralized scope.

- [ ] **Step 1: Tulis adapter tests**

Flag false => current DAX/snapshot path. Flag true => orchestrator. Router no-match regression tidak fallback bila deterministic KPI exists. Unexpected failure sends concise honest fallback/error, never blank message.

- [ ] **Step 2: Preserve WA behavior**

Mention parsing, quoted message, group allowlist, debounce/dedupe tetap. Conversation reference derived from chat JID + sender JID. Response includes source and period compactly.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/services/whatsappQA.service.js backend/src/services/whatsappListener.service.js backend/tests/cia-whatsapp-orchestrator.test.mjs
git commit -m "feat(cia): answer WhatsApp through shared evidence orchestrator"
```

---

### Task 11: Admin WhatsApp, destinations, schedules API

**Files:**
- Modify: `backend/src/routes/adminCiaWhatsappRoutes.js`
- Create: `backend/tests/cia-schedule-routes.test.mjs`

**Interfaces:**
- Produces CRUD `/api/admin/cia/schedules`, preview, run-now, runs, deliveries, retry.

- [ ] **Step 1: Tulis API validation/auth tests**

Run-now Admin only; disabled schedule may preview but run-now requires explicit override; destinations empty rejected for enable; invalid template/query/cron rejected 400; version conflict 409.

- [ ] **Step 2: Implement preview/run-now**

Preview default dry-run tidak mengirim WA. `POST /:id/run` membutuhkan body `{ confirm: true }`, creates scheduled_for current minute, dan menggunakan idempotency claim.

- [ ] **Step 3: Test and commit**

Run: `cd backend; npm test`

```powershell
git add backend/src/routes/adminCiaWhatsappRoutes.js backend/tests/cia-schedule-routes.test.mjs
git commit -m "feat(cia): expose multi-schedule administration api"
```

---

### Task 12: Admin UI pairing dan destinations

**Files:**
- Create: `frontend/src/components/admin/CiaWhatsappTab.jsx`
- Create: `frontend/src/components/admin/CiaWhatsappPairing.jsx`
- Create: `frontend/src/components/admin/CiaDestinationsPanel.jsx`
- Modify: `frontend/src/services/ciaAdminApi.js`
- Modify: `frontend/src/components/admin/CiaAdminPage.jsx`
- Create: `frontend/tests/cia-whatsapp-admin.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Admin tab `/admin/cia?tab=whatsapp`.

- [ ] **Step 1: Tulis UI safety tests**

Pair ulang dan clear auth memerlukan confirmation. Pairing-code expiry terlihat dan UI berhenti menampilkan value. Full credential/auth path tidak dirender. Number default env ditandai `Default environment`.

- [ ] **Step 2: Implement status/pair UX**

Polling status hanya saat tab aktif/pairing berlangsung. Tampilkan expected number, connected masked number, state, last connection/error. Re-pair flow: save expected number → confirmation → disconnect/clear → pairing code.

- [ ] **Step 3: Implement destinations**

Discover, select, label, type/status, test send, deactivate. Unsupported channel/newsletter diberi penjelasan capability, bukan tombol yang diam-diam gagal.

- [ ] **Step 4: Test/build/commit**

Run: `cd frontend; npm test; npm run build`

```powershell
git add frontend/src/components/admin/CiaWhatsappTab.jsx frontend/src/components/admin/CiaWhatsappPairing.jsx frontend/src/components/admin/CiaDestinationsPanel.jsx frontend/src/components/admin/CiaAdminPage.jsx frontend/src/services/ciaAdminApi.js frontend/tests/cia-whatsapp-admin.test.mjs frontend/package.json
git commit -m "feat(cia): add WhatsApp pairing and destinations UI"
```

---

### Task 13: Admin UI schedule list, editor, composer, history

**Files:**
- Create: `frontend/src/components/admin/CiaSchedulesTab.jsx`
- Create: `frontend/src/components/admin/CiaScheduleEditor.jsx`
- Create: `frontend/src/components/admin/CiaMessageComposer.jsx`
- Create: `frontend/src/components/admin/CiaScheduleRuns.jsx`
- Modify: `frontend/src/components/admin/CiaAdminPage.jsx`
- Modify: `frontend/src/App.jsx`, `frontend/src/components/header.jsx`, dan `frontend/src/components/ReportSettingModal.jsx` untuk mengarahkan entry point lama.
- Create: `frontend/tests/cia-schedules-admin.test.mjs`

**Interfaces:**
- Admin tab `/admin/cia?tab=schedules&scheduleId=<id>`.

- [ ] **Step 1: Tulis multi-schedule/composer tests**

Create >1 schedule; daily/weekly/cron inputs; multiple destinations; composer modes; preview never sends; run-now confirmation; history partial and retry failed.

- [ ] **Step 2: Implement list/editor**

List shows enabled, next run WIB, destinations, last status. Editor uses version field for optimistic concurrency. Dashboard scope empty means all approved sources and is labeled clearly.

- [ ] **Step 3: Implement composer preview/history**

Preview renders final text and estimated parts. Run history shows request id linked to Admin CIA trace, source count, token, delivery status per destination, safe error.

- [ ] **Step 4: Replace old menu action**

`Setelan Laporan Harian` navigates to `/admin/cia?tab=schedules`. Old modal component remains one release only as thin notice/link if deep integration requires it.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
cd backend
npm test
cd ../frontend
npm test
npm run build
```

```powershell
git add frontend/src/components/admin/CiaSchedulesTab.jsx frontend/src/components/admin/CiaScheduleEditor.jsx frontend/src/components/admin/CiaMessageComposer.jsx frontend/src/components/admin/CiaScheduleRuns.jsx frontend/src/components/admin/CiaAdminPage.jsx frontend/src/App.jsx frontend/src/components/header.jsx frontend/src/components/ReportSettingModal.jsx frontend/tests/cia-schedules-admin.test.mjs
git commit -m "feat(cia): add schedule composer and delivery history"
```

## Phase Verification Checklist

- [ ] Env number tampil sebagai default; DB override berlaku setelah save.
- [ ] Pair/re-pair/reconnect hanya menghasilkan satu active socket dan listener.
- [ ] Pairing code expires dan tidak tersimpan/logged; manager baru tidak mencetak QR ke log.
- [ ] Group dan supported channel/newsletter dapat discovered, verified, dan test-sent.
- [ ] Lebih dari satu schedule dapat aktif dengan waktu/composer/destinasi berbeda.
- [ ] Daily overall memakai semua approved sources tanpa batas dashboard default.
- [ ] Static reminder menghasilkan token 0; CIA query/daily update tercatat penuh.
- [ ] Dua tick/proses tidak membuat duplicate run/delivery.
- [ ] Partial failure dapat retry hanya destination gagal.
- [ ] WA question memakai Evidence Orchestrator dan regression lembur/deviasi tidak fallback karena no-match palsu.
- [ ] Mematikan dua feature flag mengembalikan WA/scheduler ke adapter lama.
