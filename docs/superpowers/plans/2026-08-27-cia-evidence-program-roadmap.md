# CIA Evidence Platform Program Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah CIA menjadi platform analitik terpusat yang dapat menarik bukti Power BI secara fleksibel lintas dashboard untuk web, Multi-Chat, dan WhatsApp; sekaligus memberi Admin kontrol, observabilitas, kamus KPI, pairing WhatsApp, dan multi-schedule.

**Architecture:** Program dibagi menjadi lima delivery plan berurutan. Fase 1 membangun telemetry dan Admin CIA sebagai control plane. Fase 2 membuat KPI Library ter-versioning dari katalog aktual serta metadata visual. Fase 3 mengganti snapshot-first dengan Evidence Orchestrator untuk seluruh permukaan web. Fase 4 memakai orchestrator yang sama di WhatsApp dan mengganti singleton report schedule dengan pairing serta multi-schedule. Fase 5 membuktikan regression, canary, load, gate, dan rollback sebelum legacy retirement. Kontrak lama dipertahankan sebagai adapter sampai setiap feature flag stabil di production.

**Tech Stack:** Node.js 20+ ESM, Express 4, MySQL 8/mysql2, React 18, Vite, Tailwind CSS, Power BI REST/XMLA ExecuteQueries, Google Gemini/GLM adapters yang sudah ada, Baileys, node-cron, Node built-in test harness.

## Global Constraints

- Product source of truth: `docs/superpowers/specs/2026-08-27-cia-evidence-orchestrator-prd.md`.
- Jangan menambahkan dependency runtime baru. Gunakan library yang sudah terpasang.
- Semua endpoint Admin harus memakai `requireAdmin`; semua permukaan CIA web tetap memakai `requireCiaAccess`.
- Akses web dibatasi ke dashboard yang diizinkan user. WA memakai seluruh semantic model yang disetujui Admin karena merupakan kanal CIA terpusat.
- Satu request CIA mempunyai satu `request_id` end-to-end dan seluruh event retrieval/token/delivery mengacu ke id itu.
- Jangan menyimpan prompt lengkap, hasil row mentah, token, QR, credential, atau secret ke telemetry. Simpan preview yang dipotong dan error yang sudah disanitasi.
- Maksimal empat ronde retrieval per request, satu perbaikan DAX per semantic model, dan batas row/timeout mengikuti konfigurasi yang ada.
- Snapshot hanya fallback transparan. Jawaban wajib menyebut saat bukti live gagal dan tidak boleh mengarang korelasi.
- Nama measure teknis tidak boleh muncul pada jawaban akhir bila binding human-readable tersedia.
- Migrasi SQL harus idempotent dengan pola `information_schema` karena MySQL target tidak menjamin `ADD ... IF NOT EXISTS`.
- Setiap fase dirilis di balik feature flag. Default flag `false` sampai smoke test production selesai.
- Pertahankan perubahan user yang sudah ada pada `package.json`, `package-lock.json`, `.agents/`, `.claude/`, dan `skills-lock.json`; jangan masukkan ke commit program ini tanpa kaitan langsung.

## Delivery Plans

| Urutan | Plan | Outcome yang dapat dirilis | Gate sebelum lanjut |
|---|---|---|---|
| 1 | `2026-08-27-cia-admin-observability.md` | Halaman Admin CIA, analytics penggunaan/token/health, pemindahan kontrol akses | Event request terbaca dari web lama; agregasi cocok dengan sample log |
| 2 | `2026-08-27-cia-kpi-library.md` | KPI Library aktual, binding measure-dashboard-visual, sync dan versi | KPI kritis lembur/deviasi/PO terkonfirmasi dan label manusia lolos uji |
| 3 | `2026-08-27-cia-evidence-orchestrator-web.md` | Live DAX fleksibel dan korelasi lintas dashboard di dashboard CIA + Multi-Chat | Regression query produksi lolos, akses tidak bocor, fallback transparan |
| 4 | `2026-08-27-cia-whatsapp-multischedule.md` | Orchestrator yang sama di WA, satu nomor re-pairable, destinasi, multi-schedule/composer | Pair/reconnect, dedupe, schedule, dan delivery audit lolos canary |
| 5 | `2026-08-27-cia-production-stabilization.md` | Canary policy, regression replay, health gates, load smoke, rollout/rollback runbook | Seluruh gate lulus dan rollback sudah direhearsal |

## Release Topology

```text
User / Admin
    |
    +-- Web Dashboard CIA ---------+
    +-- Multi-Chat ----------------+--> CIA Evidence Orchestrator --> Power BI models
    +-- WhatsApp ------------------+            |                         |
                                                +--> KPI Library <---------+
                                                +--> CIA Telemetry

Admin CIA
    +-- Overview / Usage / Health ------> CIA Telemetry
    +-- Access --------------------------> users.cia_access + dashboard ACL
    +-- KPI Library / Sync --------------> KPI catalog + visual/model inventory
    +-- WhatsApp / Destinations ---------> Baileys session manager
    +-- Schedules / Composer ------------> schedule runner + delivery audit
```

## Cross-Plan Contracts

### Request envelope

Semua surface memanggil orchestrator menggunakan objek yang sama:

```js
{
  requestId: crypto.randomUUID(),
  surface: "dashboard" | "multi_chat" | "whatsapp" | "schedule",
  actor: { userId, name, department },
  question: String,
  conversationId: String | null,
  preferredDashboardIds: String[],
  accessMode: "user_acl" | "centralized",
  snapshotFallback: { period, dashboards, text } | null
}
```

### Answer envelope

Kontrak lama boleh mendapat field tambahan, tetapi field lama tidak dihapus:

```js
{
  answer: String,
  requestId: String,
  confidence: "high" | "medium" | "low",
  retrievalMethod: "live_dax" | "mixed" | "snapshot" | "none",
  sources: [{ dashboardId, dashboardName, period, kpis, rowCount }],
  warnings: String[],
  usage: { inputTokens, outputTokens, totalTokens },
  rounds: Number
}
```

### Feature flags

| Flag | Default | Owner plan | Fungsi |
|---|---:|---|---|
| `CIA_TELEMETRY_ENABLED` | `false` | Fase 1 | Menulis request/event baru tanpa mengubah jawaban |
| `CIA_ADMIN_ANALYTICS_ENABLED` | `false` | Fase 1 | Membuka route analytics dan menu Admin CIA |
| `CIA_KPI_LIBRARY_ENABLED` | `false` | Fase 2 | Membaca binding library, dengan katalog lama sebagai fallback |
| `CIA_ORCHESTRATOR_WEB_ENABLED` | `false` | Fase 3 | Mengaktifkan live orchestrator untuk dashboard CIA dan Multi-Chat |
| `CIA_ORCHESTRATOR_WA_ENABLED` | `false` | Fase 4 | Mengaktifkan orchestrator yang sama untuk pertanyaan WA |
| `CIA_MULTI_SCHEDULE_ENABLED` | `false` | Fase 4 | Mengaktifkan runner jadwal baru; singleton lama menjadi adapter |

## Environment Additions

Tambahkan ke `.env.example`, bukan ke `.env` yang berisi secret:

```dotenv
CIA_TELEMETRY_ENABLED=false
CIA_ADMIN_ANALYTICS_ENABLED=false
CIA_KPI_LIBRARY_ENABLED=false
CIA_ORCHESTRATOR_WEB_ENABLED=false
CIA_ORCHESTRATOR_WA_ENABLED=false
CIA_MULTI_SCHEDULE_ENABLED=false
CIA_MAX_RETRIEVAL_ROUNDS=4
CIA_DAX_REPAIR_LIMIT=1
CIA_DAX_MAX_ROWS=500
CIA_DAX_TIMEOUT_MS=45000
CIA_ORCHESTRATOR_CANARY_USER_IDS=
CIA_ORCHESTRATOR_CANARY_PERCENT=0
CIA_ORCHESTRATOR_SHADOW_PERCENT=0
WHATSAPP_BOT_NUMBER=
```

`WHATSAPP_BOT_NUMBER` adalah default nomor aktif. Nilai database yang disimpan Admin meng-overwrite default tanpa pernah menyimpan credential sesi ke tabel.

## Rollout Sequence

### Stage A — Development

- [ ] Jalankan migrasi per fase pada database development.
- [ ] Jalankan `npm test` di `backend` dan `frontend` setelah setiap task.
- [ ] Jalankan `npm run build` di `frontend` sebelum commit akhir fase.
- [ ] Gunakan fake Power BI/AI/Baileys di unit test; jangan mengirim WhatsApp sungguhan.

### Stage B — Production shadow

- [ ] Aktifkan `CIA_TELEMETRY_ENABLED=true` saja selama minimum satu hari kerja.
- [ ] Bandingkan jumlah request per surface dengan log lama dan sample manual.
- [ ] Aktifkan KPI Library read-through: library dahulu, `KATALOG_KPI` sebagai fallback.
- [ ] Jalankan orchestrator sebagai shadow plan pada maksimal 10% request; jawaban user masih memakai jalur lama.
- [ ] Catat candidate dashboard, DAX validity, latency, dan expected fallback tanpa menggandakan billing synthesis.

### Stage C — Web canary

- [ ] Aktifkan web orchestrator untuk akun Admin/tester terlebih dahulu.
- [ ] Uji pertanyaan regresi: lembur per departemen/alasan/kategori; deviasi CMD 3; korelasi lembur dengan PO/PPIC; periode bulan lalu/tahun lalu/aktual.
- [ ] Pastikan user tanpa ACL dashboard tidak dapat memilih atau menerima sumber dashboard tersebut.
- [ ] Naikkan canary bertahap dan matikan flag bila error/latency melewati gate.

### Stage D — WhatsApp and schedules

- [ ] Pair ulang satu nomor pada environment canary dan verifikasi reconnect setelah restart.
- [ ] Kirim test hanya ke destinasi bertanda `test`.
- [ ] Migrasikan singleton `report_setting` menjadi satu schedule baru, lalu cocokkan preview pesan.
- [ ] Aktifkan multi-schedule dan WA orchestrator setelah dedupe/delivery audit lolos.

## Production Gates

Sebelum feature flag dinaikkan:

- Dashboard routing success ≥ 95% untuk regression corpus.
- DAX execution success ≥ 90% setelah satu repair; sisanya mempunyai error code yang bisa ditindaklanjuti.
- Tidak ada source dashboard di luar ACL untuk web test corpus.
- 100% jawaban live menyertakan periode dan minimal satu sumber.
- 100% fallback menyebut bahwa data live gagal/tidak cukup.
- P95 request latency tetap di bawah batas yang disetujui untuk surface; WA timeout harus membalas status yang jujur.
- Token input/output/total dan retrieval rounds tercatat untuk ≥ 99% request AI baru.
- Duplicate delivery schedule = 0 pada pengujian dua proses/dua tick.

## Rollback

- Matikan flag pemilik fitur; tidak perlu rollback schema.
- Route dan response contract lama tetap tersedia sampai dua release stabil penuh.
- `report_setting` tidak dihapus pada fase ini; adapter membacanya bila belum ada schedule hasil migrasi.
- `KATALOG_KPI` tidak dihapus; dijadikan fallback read-only selama rollout.
- Data telemetry, version history, dan delivery audit tidak dihapus ketika rollback.

## Definition of Done Program

- [ ] Admin CIA menjadi halaman khusus dan tidak lagi bercampur dengan Manage Users/AI modal.
- [ ] Analytics dapat difilter tanggal, user, departemen, surface, dashboard, status, dan retrieval method.
- [ ] Dashboard CIA, Multi-Chat, dan WA memakai orchestrator serta KPI Library yang sama.
- [ ] Pertanyaan lintas periode dan lintas dashboard dijawab dari DAX live bila tersedia.
- [ ] Korelasi hanya dinyatakan dari bukti yang benar-benar diambil dan sumbernya terlihat.
- [ ] KPI Library bisa sync, diedit, dikonfirmasi, dilihat versinya, dan di-rollback.
- [ ] Satu nomor WA dapat di-pair ulang; default berasal dari env.
- [ ] Banyak destinasi dan banyak schedule dapat dibuat; setiap schedule punya composer dan delivery audit.
- [ ] Seluruh regression test, build, migration smoke test, dan production canary gate lulus.
