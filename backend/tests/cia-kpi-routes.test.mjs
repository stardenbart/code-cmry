// Admin KPI API: otorisasi + validasi.
//
// Dijalankan in-process pada port ephemeral (tidak mengganggu :5050).
// Yang dijaga: non-admin 403; update/confirm/restore tanpa reason 400; tipe
// array salah 400; sync kedua saat masih running 409; sync balas 202 {runId};
// restore revisi milik KPI lain 404.
process.env.SKIP_SERVER_LISTEN = "true";

import { pathToFileURL } from "url";
import { ok, section, summary, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const { app } = await import("../src/server.js");
const sql = db.promise();

const [admins] = await sql.query("SELECT id, username FROM users WHERE role='admin' AND approved=1 LIMIT 1");
const [normals] = await sql.query("SELECT id, username FROM users WHERE role<>'admin' AND approved=1 LIMIT 1");
const admin = admins[0];
const normal = normals[0];

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const createdKpiIds = [];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body && !["GET", "HEAD"].includes(method) ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await res.json(); } catch { /* */ }
  return { status: res.status, body: parsed };
}

try {
  ok("ada admin fixture", Boolean(admin), "tidak ada admin");
  ok("ada user biasa fixture", Boolean(normal), "tidak ada user biasa");
  const token = admin ? tokenFor(admin.id, admin.username) : null;

  section("Non-admin ditolak");
  if (normal) {
    const r = await call("GET", "/api/admin/cia/kpis", { token: tokenFor(normal.id, normal.username) });
    ok("user biasa -> 403 GET /kpis", r.status === 403, `dapat ${r.status}`);
    const r2 = await call("POST", "/api/admin/cia/kpis", { token: tokenFor(normal.id, normal.username), body: { humanName: "x" } });
    ok("user biasa -> 403 POST /kpis", r2.status === 403, `dapat ${r2.status}`);
  }
  const noTok = await call("GET", "/api/admin/cia/kpis");
  ok("tanpa token -> 401", noTok.status === 401, `dapat ${noTok.status}`);

  if (admin) {
    section("CRUD + validasi");
    const create = await call("POST", "/api/admin/cia/kpis", {
      token, body: { humanName: "KPI Uji Route", domain: "test", synonyms: ["uji"] },
    });
    ok("create -> 201", create.status === 201, `dapat ${create.status}`);
    const kpiId = create.body?.id;
    if (kpiId) createdKpiIds.push(kpiId);
    ok("body punya id & versi 1", kpiId > 0 && create.body.version === 1);

    const list = await call("GET", "/api/admin/cia/kpis?q=KPI Uji Route", { token });
    ok("list -> 200 & memuat KPI baru", list.status === 200 && list.body.kpis.some((k) => k.id === kpiId));

    const noReason = await call("PUT", `/api/admin/cia/kpis/${kpiId}`, { token, body: { definition: "x" } });
    ok("update tanpa reason -> 400", noReason.status === 400, `dapat ${noReason.status}`);

    const badType = await call("PUT", `/api/admin/cia/kpis/${kpiId}`, {
      token, body: { reason: "ubah", synonyms: "bukan array" },
    });
    ok("synonyms non-array -> 400", badType.status === 400, `dapat ${badType.status}`);

    const okUpdate = await call("PUT", `/api/admin/cia/kpis/${kpiId}`, {
      token, body: { reason: "perjelas definisi", definition: "definisi baru" },
    });
    ok("update dengan reason -> 200 & versi 2", okUpdate.status === 200 && okUpdate.body.version === 2,
      JSON.stringify({ s: okUpdate.status, v: okUpdate.body?.version }));

    const confirmNoReason = await call("POST", `/api/admin/cia/kpis/${kpiId}/confirm`, { token, body: {} });
    ok("confirm tanpa reason -> 400", confirmNoReason.status === 400, `dapat ${confirmNoReason.status}`);

    const revs = await call("GET", `/api/admin/cia/kpis/${kpiId}/revisions`, { token });
    ok("revisions -> 200 array", revs.status === 200 && Array.isArray(revs.body));

    section("Restore revisi milik KPI lain -> 404");
    const other = await call("POST", "/api/admin/cia/kpis", {
      token, body: { humanName: "KPI Lain Route", domain: "test" },
    });
    if (other.body?.id) createdKpiIds.push(other.body.id);
    const someRevId = revs.body?.[0]?.id;
    const crossRestore = await call(
      "POST", `/api/admin/cia/kpis/${other.body.id}/revisions/${someRevId}/restore`,
      { token, body: { reason: "salah kpi" } });
    ok("restore revisi lintas-KPI -> 404", crossRestore.status === 404, `dapat ${crossRestore.status}`);

    section("Sync 202 lalu status; sync kedua saat running -> 409");
    const sync = await call("POST", "/api/admin/cia/kpis/sync", {
      token, body: { dashboardIds: [999999999] }, // dashboard bogus -> cepat, minim efek samping
    });
    ok("sync -> 202 { runId, running }", sync.status === 202 && sync.body?.status === "running" && sync.body?.runId,
      JSON.stringify({ s: sync.status, b: sync.body }));

    // Tunggu run latar selesai supaya tidak ada state menggantung.
    let runStatus = "running";
    for (let i = 0; i < 40 && runStatus === "running"; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const g = await call("GET", `/api/admin/cia/kpis/sync/${sync.body.runId}`, { token });
      runStatus = g.body?.status;
      if (g.status !== 200) break;
      if (runStatus === "running") await new Promise((r) => setTimeout(r, 50));
    }
    ok("status run terbaca & terminal", ["success", "partial", "error"].includes(runStatus), runStatus);

    // 409 deterministik: sisipkan run 'running' manual, lalu coba sync lagi.
    const [ins] = await sql.query(
      "INSERT INTO cia_kpi_sync_runs (run_uuid, status) VALUES (UUID(), 'running')");
    const conflict = await call("POST", "/api/admin/cia/kpis/sync", { token, body: {} });
    ok("sync saat running -> 409", conflict.status === 409, `dapat ${conflict.status}`);
    await sql.query("DELETE FROM cia_kpi_sync_runs WHERE id=?", [ins.insertId]);

    const missingRun = await call("GET", "/api/admin/cia/kpis/sync/tidak-ada", { token });
    ok("sync run tak ada -> 404", missingRun.status === 404, `dapat ${missingRun.status}`);
  }
} finally {
  for (const id of createdKpiIds) await sql.query("DELETE FROM cia_kpis WHERE id=?", [id]);
  await new Promise((r) => server.close(r));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
