// Kontrak instrumentasi permukaan CIA yang sudah ada (Tanya CIA + Multi-Chat).
//
// Diuji lewat withCiaTelemetry dengan tracker & starter PALSU: yang dijaga
// adalah kontraknya, bukan Gemini/Power BI. Aturan yang tidak boleh melar:
//   - sukses  -> finish() sekali, fail() nol;
//   - gagal   -> fail() sekali, finish() nol (baik gagal via status>=400
//     maupun via exception yang dilempar handler);
//   - requestId disisipkan ke body TANPA menghapus field lama;
//   - surface benar: "dashboard" untuk ask, "multi_chat" untuk unifiedAsk.
//
// Telemetry best-effort, jadi finalisasi dijalankan tanpa ditunggu (tak
// menambah latency jawaban). Uji menunggu satu tick supaya efeknya terlihat.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { withCiaTelemetry } from "../src/controllers/aiController.js";

const tick = () => new Promise((r) => setTimeout(r, 25));

function makeTracker() {
  const t = { events: [], finishCount: 0, failCount: 0, lastFail: null };
  t.event = async (stage) => { t.events.push(stage); };
  t.finish = async () => { t.finishCount += 1; };
  t.fail = async (e) => { t.failCount += 1; t.lastFail = e; };
  return t;
}
function makeStarter(tracker) {
  const fn = async (env) => { fn.calls.push(env); return tracker; };
  fn.calls = [];
  return fn;
}
function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.set = () => res;
  res.json = (b) => { res.body = b; return res; };
  return res;
}

section("Sukses: finish sekali, requestId disisipkan, kontrak utuh");
{
  const tracker = makeTracker();
  const starter = makeStarter(tracker);
  const wrapped = withCiaTelemetry(
    "dashboard",
    async (req, res) => res.json({ answer: "halo", meta: { tier: "cepat" } }),
    { startCiaTelemetry: starter }
  );
  const res = makeRes();
  await wrapped({ user: { id: 1, name: "A", department: "IT" }, body: { question: "q" } }, res);
  await tick();

  ok("surface dashboard diteruskan ke starter", starter.calls[0]?.surface === "dashboard",
    starter.calls[0]?.surface);
  ok("body punya requestId", typeof res.body?.requestId === "string", String(res.body?.requestId));
  ok("field lama answer dipertahankan", res.body?.answer === "halo", res.body?.answer);
  ok("field lama meta dipertahankan", res.body?.meta?.tier === "cepat");
  ok("finish() dipanggil sekali", tracker.finishCount === 1, String(tracker.finishCount));
  ok("fail() tidak dipanggil", tracker.failCount === 0, String(tracker.failCount));
  ok("event request_received tercatat", tracker.events.includes("request_received"));
  ok("event response_sent tercatat", tracker.events.includes("response_sent"));
}

section("Gagal via status >= 400: fail sekali, kontrak error utuh");
{
  const tracker = makeTracker();
  const starter = makeStarter(tracker);
  const wrapped = withCiaTelemetry(
    "dashboard",
    async (req, res) => res.status(500).json({ message: "Gagal memproses pertanyaan ke AI" }),
    { startCiaTelemetry: starter }
  );
  const res = makeRes();
  await wrapped({ user: { id: 1 }, body: { question: "q" } }, res);
  await tick();

  ok("fail() dipanggil sekali", tracker.failCount === 1, String(tracker.failCount));
  ok("finish() tidak dipanggil", tracker.finishCount === 0, String(tracker.finishCount));
  ok("pesan error lama dipertahankan", res.body?.message === "Gagal memproses pertanyaan ke AI");
  ok("requestId tetap disisipkan pada error", typeof res.body?.requestId === "string");
}

section("Gagal via exception: fail sekali lalu dilempar ulang");
{
  const tracker = makeTracker();
  const starter = makeStarter(tracker);
  const wrapped = withCiaTelemetry(
    "dashboard",
    async () => { throw new Error("boom internal"); },
    { startCiaTelemetry: starter }
  );
  const res = makeRes();
  let threw = false;
  try { await wrapped({ user: { id: 1 }, body: {} }, res); } catch { threw = true; }
  await tick();

  ok("exception dilempar ulang (penanganan lama tetap jalan)", threw === true);
  ok("fail() dipanggil sekali", tracker.failCount === 1, String(tracker.failCount));
  ok("finish() tidak dipanggil", tracker.finishCount === 0, String(tracker.finishCount));
}

section("Surface multi_chat untuk unified");
{
  const tracker = makeTracker();
  const starter = makeStarter(tracker);
  const wrapped = withCiaTelemetry(
    "multi_chat",
    async (req, res) => res.json({ answer: "x", dashboards_used: [] }),
    { startCiaTelemetry: starter }
  );
  const res = makeRes();
  await wrapped({ user: { id: 2 }, body: { question: "q" } }, res);
  await tick();
  ok("surface multi_chat diteruskan", starter.calls[0]?.surface === "multi_chat",
    starter.calls[0]?.surface);
  ok("kontrak unified dipertahankan", Array.isArray(res.body?.dashboards_used));
}

section("Starter yang gagal tidak mematahkan handler");
{
  const failingStarter = async () => { throw new Error("db mati"); };
  const wrapped = withCiaTelemetry(
    "dashboard",
    async (req, res) => res.json({ answer: "tetap jalan" }),
    { startCiaTelemetry: failingStarter }
  );
  const res = makeRes();
  await wrapped({ user: { id: 1 }, body: { question: "q" } }, res);
  await tick();
  ok("handler tetap membalas walau telemetry gagal start", res.body?.answer === "tetap jalan");
  ok("requestId tetap ada", typeof res.body?.requestId === "string");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
