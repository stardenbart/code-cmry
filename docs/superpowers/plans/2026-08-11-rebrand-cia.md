# Rebrand CODE AI to CIA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand "CODE AI" to "CIA (Cimory Intelligence Assistant)" across human-readable UI, AI system prompts, and WhatsApp bot responses, and implement CIA self-introduction features.

**Architecture:** Pure text-layer rebranding + `ciaIdentity.js` pure module + Baileys `group-participants.update` listener guarded by `wa_group_intro` DB table + `aiLocalAnswer` zero-latency identity pattern matching + frontend & backend brand ratchet unit tests (`codeAi: 0`).

**Tech Stack:** React 18, Node.js / Express.js (ES Modules), Baileys (WhatsApp Web API), MySQL 8.

## Global Constraints

- Backend JavaScript ESM murni, tanpa TypeScript, tanpa langkah build. Kontrak data via JSDoc.
- Tidak ada emoji dan tidak ada em dash (—) di teks yang dibaca manusia.
- Bahasa komentar dan pesan: Bahasa Indonesia.
- Bentuk panjang `CIA (Cimory Intelligence Assistant)` HANYA digunakan di header panel AI di web dan halaman settings AI. Seluruh tempat lain cukup `CIA`.
- File name `frontend/src/components/CodeAINavigator.jsx` dan env var `CODE_AI_UNIVERSAL_KEY` TIDAK diubah.
- Database migration memakai `CREATE TABLE IF NOT EXISTS`.
- Seluruh suite test dijalankan dari `backend` via `node tests/run-all.mjs`.

---

### Task 1: Core CIA Identity Module & Database Migration

**Files:**
- Create: `backend/src/services/ciaIdentity.js`
- Create: `backend/migrations/add_wa_group_intro.sql`
- Create: `backend/tests/cia-identity.test.mjs`

**Interfaces:**
- Consumes: None (Pure JS function)
- Produces: `getCiaIdentityText()`, `getCiaShortIntro()`, `isCiaIdentityQuestion(text)`

- [ ] **Step 1: Write database migration for `wa_group_intro`**

Create `backend/migrations/add_wa_group_intro.sql`:
```sql
CREATE TABLE IF NOT EXISTS wa_group_intro (
  group_jid VARCHAR(100) NOT NULL PRIMARY KEY,
  greeted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Write failing unit test for `ciaIdentity.js`**

Create `backend/tests/cia-identity.test.mjs`:
```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCiaIdentityText, isCiaIdentityQuestion } from '../src/services/ciaIdentity.js';

test('ciaIdentity returns valid identity text containing 4 core elements', () => {
  const text = getCiaIdentityText();
  assert.ok(text.includes('CIA (Cimory Intelligence Assistant)'));
  assert.ok(text.includes('CMD Plant Sentul'));
  assert.ok(text.includes('Power BI'));
  assert.ok(text.includes('tag CIA'));
  // Ensure no em dash or emoji
  assert.equal(text.includes('—'), false);
  assert.equal(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/u.test(text), false);
});

test('isCiaIdentityQuestion detects identity questions', () => {
  assert.equal(isCiaIdentityQuestion('cia itu apa'), true);
  assert.equal(isCiaIdentityQuestion('kamu siapa'), true);
  assert.equal(isCiaIdentityQuestion('bisa bantu apa aja'), true);
  assert.equal(isCiaIdentityQuestion('berapa losses hari ini'), false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test backend/tests/cia-identity.test.mjs`
Expected: FAIL with module not found `ciaIdentity.js`.

- [ ] **Step 4: Implement `ciaIdentity.js`**

Create `backend/src/services/ciaIdentity.js`:
```javascript
/**
 * CIA Identity text provider and pattern matcher.
 * Pure functions: No I/O, no DB calls, no external network requests.
 */

export function getCiaIdentityText() {
  return [
    'Saya CIA (Cimory Intelligence Assistant), asisten analitik digital untuk CMD Plant Sentul.',
    'Tugas saya membaca dan menjelaskan angka yang tampil pada dashboard Power BI, serta mengaitkan temuan lintas data.',
    'Saya hanya menjawab dari angka yang tersedia, tidak menebak data yang tidak ada, dan tidak menggantikan keputusan operasional.',
    'Untuk bertanya, cukup tag CIA di grup ini lalu sampaikan pertanyaan Anda.'
  ].join('\n\n');
}

export function isCiaIdentityQuestion(text = '') {
  const clean = text.toLowerCase().trim();
  const patterns = [
    /cia\s+itu\s+apa/i,
    /kamu\s+siapa/i,
    /siapa\s+kamu/i,
    /bisa\s+bantu\s+apa/i,
    /apa\s+fungsi/i,
    /fungsinya\s+apa/i,
    /apa\text\s+tugas/i
  ];
  return patterns.some((p) => p.test(clean));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test backend/tests/cia-identity.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/add_wa_group_intro.sql backend/src/services/ciaIdentity.js backend/tests/cia-identity.test.mjs
git commit -m "feat(cia): add ciaIdentity service and wa_group_intro migration"
```

---

### Task 2: Backend Prompt & Service Rebranding

**Files:**
- Modify: `backend/src/controllers/aiController.js`
- Modify: `backend/src/services/aiContext.js`
- Modify: `backend/src/services/aiProvider.js`
- Modify: `backend/src/services/aiQuota.js`
- Modify: `backend/src/services/aiRouter.js`
- Modify: `backend/src/services/aiNavigator.js`
- Modify: `backend/src/services/aiSettings.js`
- Modify: `backend/src/services/aiCache.js`
- Modify: `backend/src/services/summaryFormatter.js`
- Modify: `backend/src/services/geminiSummary.service.js`
- Modify: `backend/src/services/daxAgent.service.js`
- Modify: `backend/src/services/whatsappQA.service.js`
- Modify: `backend/src/services/findingDistiller.js`
- Modify: `backend/tests/summary-formatter.test.mjs`
- Modify: `backend/tests/user-role.test.mjs`

- [ ] **Step 1: Update system prompts & responses in backend services**

Replace occurrences of "CODE AI" / "CODE AI Assistant" with "CIA" / "CIA (Cimory Intelligence Assistant)" across backend services:
- In `aiContext.js`: Update system prompt instructions to state identity as CIA.
- In `summaryFormatter.js`, `geminiSummary.service.js`, `daxAgent.service.js`, `whatsappQA.service.js`, `findingDistiller.js`: Update footer templates and bot message prefixes to "CIA".
- In `aiSettings.js`, `aiQuota.js`, `aiRouter.js`, `aiNavigator.js`, `aiCache.js`, `aiController.js`: Update error messages and log outputs.

- [ ] **Step 2: Update existing backend test expectations**

Update assertions in `backend/tests/summary-formatter.test.mjs` and `backend/tests/user-role.test.mjs` to expect "CIA" instead of "CODE AI".

- [ ] **Step 3: Run backend test suite**

Run: `cd backend && node tests/run-all.mjs`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/ backend/tests/
git commit -m "refactor(backend): rebrand CODE AI text to CIA across services and tests"
```

---

### Task 3: WhatsApp Baileys Bot Introduction & Local Answer Integration

**Files:**
- Modify: `backend/src/services/whatsappListener.service.js`
- Modify: `backend/src/services/aiLocalAnswer.js`
- Modify: `backend/src/services/whatsappQA.service.js`

- [ ] **Step 1: Integrate `isCiaIdentityQuestion` into `aiLocalAnswer.js`**

Update `aiLocalAnswer.js` so that identity questions match locally and return `getCiaIdentityText()` instantly without invoking Gemini.

- [ ] **Step 2: Add `group-participants.update` listener in `whatsappListener.service.js`**

Subscribe to `sock.ev.on('group-participants.update', ...)`:
- Check if `action === 'add'` and participant contains bot JID.
- Verify group JID is listed in `WHATSAPP_GROUP_ID` (env var). If not in whitelist, log warning and exit.
- Query database `wa_group_intro` for `group_jid`.
- If not yet greeted, insert row into `wa_group_intro` and send `getCiaIdentityText()` to the group.

- [ ] **Step 3: Test local answer & group intro listener**

Verify group intro logic and local answer response.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/whatsappListener.service.js backend/src/services/aiLocalAnswer.js backend/src/services/whatsappQA.service.js
git commit -m "feat(whatsapp): implement CIA self-introduction on group join and local identity Q&A"
```

---

### Task 4: Frontend UI Components Rebranding

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/AskAIPanel.jsx`
- Modify: `frontend/src/components/CodeAINavigator.jsx`
- Modify: `frontend/src/components/AISettingsModal.jsx`
- Modify: `frontend/src/components/DashboardManager.jsx`
- Modify: `frontend/src/components/header.jsx`
- Modify: `frontend/src/components/PerfSummary.jsx`
- Modify: `frontend/src/components/PowerBITokenReport.jsx`
- Modify: `frontend/src/components/ManageUsers.jsx`
- Modify: `frontend/src/utils/embedPrefetch.js`

- [ ] **Step 1: Update UI headers and modals**

- In `header.jsx` & `AISettingsModal.jsx`: Update header text to `CIA (Cimory Intelligence Assistant)` and settings title to `Pengaturan CIA`.
- In `AskAIPanel.jsx`: Update header title to `CIA` / `CIA (Cimory Intelligence Assistant)`.
- In `CodeAINavigator.jsx`: Update assistant label to `CIA Navigator` and tooltip text.
- In `DashboardManager.jsx`, `PerfSummary.jsx`, `PowerBITokenReport.jsx`, `ManageUsers.jsx`, `embedPrefetch.js`: Update labels and button texts from CODE AI to CIA.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/
git commit -m "refactor(frontend): update UI headers, modals, buttons, and labels to CIA"
```

---

### Task 5: Brand Ratchet Unit Tests & Documentation Update

**Files:**
- Create: `backend/tests/brand-constraints.test.mjs`
- Modify: `frontend/tests/text-constraints.test.mjs`
- Modify: `README.md`

- [ ] **Step 1: Update frontend ratchet test**

In `frontend/tests/text-constraints.test.mjs`: Add `codeAi: 0` counter to the ratchet object.

- [ ] **Step 2: Create backend brand constraints test**

Create `backend/tests/brand-constraints.test.mjs` to scan `backend/src` for any case-insensitive occurrences of `"code ai"` outside exempt folders (`docs/superpowers/`). Set threshold `codeAi: 0`.

- [ ] **Step 3: Update `README.md`**

Replace occurrences of "CODE AI" with "CIA" in human-readable sections of `README.md`.

- [ ] **Step 4: Run full test suites**

Run: `cd backend && node tests/run-all.mjs`
Run frontend text constraints test.
Expected: All tests pass with 0 brand violations.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/brand-constraints.test.mjs frontend/tests/text-constraints.test.mjs README.md
git commit -m "test(ratchet): add brand constraint ratchet tests codeAi=0 and update README.md"
```
