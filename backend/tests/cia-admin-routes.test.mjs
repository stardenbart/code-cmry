// Otorisasi endpoint Admin CIA.
//
// Dijalankan IN-PROCESS pada port ephemeral (app.listen(0)), bukan terhadap
// server :5050, supaya uji berdiri sendiri dan tidak menuntut backend luar
// direstart. SKIP_SERVER_LISTEN mencegah server.js mengikat port default saat
// di-import.
//
// Yang dijaga: tanpa token -> 401; user biasa -> 403; admin -> 200; token untuk
// akun yang tidak ada -> 403; dan PUT access TIDAK PERNAH membaca userId dari
// body (hanya dari path param).
process.env.SKIP_SERVER_LISTEN = "true";

import { pathToFileURL } from "url";
import { ok, section, summary, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const { app } = await import("../src/server.js");
const sql = db.promise();

const [admins] = await sql.query(
  "SELECT id, username FROM users WHERE role='admin' AND approved=1 LIMIT 1");
const [normals] = await sql.query(
  "SELECT id, username, cia_access FROM users WHERE role<>'admin' AND approved=1 LIMIT 1");

const admin = admins[0];
const normal = normals[0];

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body && !["GET", "HEAD"].includes(method) ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: parsed };
}

try {
  section("Prasyarat fixture");
  ok("ada admin approved untuk diuji", Boolean(admin), "tidak ada admin di DB");
  ok("ada user biasa approved untuk diuji", Boolean(normal), "tidak ada user biasa di DB");

  const ADMIN_ENDPOINTS = [
    ["GET", "/api/admin/cia/overview"],
    ["GET", "/api/admin/cia/usage"],
    ["GET", "/api/admin/cia/health"],
    ["GET", "/api/admin/cia/filters"],
    ["GET", "/api/admin/cia/access"],
    ["GET", "/api/admin/cia/settings"],
  ];

  section("Tanpa token -> 401");
  for (const [m, p] of ADMIN_ENDPOINTS) {
    const r = await call(m, p);
    ok(`${m} ${p} -> 401`, r.status === 401, `dapat ${r.status}`);
  }

  if (normal) {
    section("User biasa -> 403");
    const token = tokenFor(normal.id, normal.username);
    for (const [m, p] of ADMIN_ENDPOINTS) {
      const r = await call(m, p, { token });
      ok(`${m} ${p} user biasa -> 403`, r.status === 403, `dapat ${r.status}`);
    }
  }

  section("Token untuk akun tak ada -> 403");
  {
    const ghost = tokenFor(99999999, "ghost");
    const r = await call("GET", "/api/admin/cia/overview", { token: ghost });
    ok("akun tak ada ditolak 403", r.status === 403, `dapat ${r.status}`);
  }

  if (admin) {
    const token = tokenFor(admin.id, admin.username);

    section("Admin -> 200 + bentuk data");
    {
      const ov = await call("GET", "/api/admin/cia/overview", { token });
      ok("overview 200", ov.status === 200, `dapat ${ov.status}`);
      ok("overview punya totals", ov.body && typeof ov.body.totals === "object");

      const usage = await call("GET", "/api/admin/cia/usage?dimension=user", { token });
      ok("usage 200", usage.status === 200, `dapat ${usage.status}`);
      ok("usage punya breakdown array", Array.isArray(usage.body?.breakdown));

      const health = await call("GET", "/api/admin/cia/health", { token });
      ok("health 200", health.status === 200, `dapat ${health.status}`);

      const filters = await call("GET", "/api/admin/cia/filters", { token });
      ok("filters 200", filters.status === 200, `dapat ${filters.status}`);

      const access = await call("GET", "/api/admin/cia/access", { token });
      ok("access 200", access.status === 200, `dapat ${access.status}`);
      ok("access mengembalikan daftar user", Array.isArray(access.body?.users));
      ok("access tidak membocorkan password", JSON.stringify(access.body || {}).indexOf("password") === -1);

      const settings = await call("GET", "/api/admin/cia/settings", { token });
      ok("settings 200", settings.status === 200, `dapat ${settings.status}`);
      ok("settings mengembalikan feature flags boolean",
        typeof settings.body?.flags?.CIA_TELEMETRY_ENABLED === "boolean" &&
        typeof settings.body?.flags?.CIA_ADMIN_ANALYTICS_ENABLED === "boolean");
      ok("settings mengembalikan timezone efektif", typeof settings.body?.timezone === "string");
      ok("settings tidak membocorkan secret",
        !/(api.?key|password|secret|token)/i.test(JSON.stringify(settings.body || {})));
    }

    section("Dimensi injeksi -> 400 (bukan 500)");
    {
      const r = await call("GET",
        "/api/admin/cia/usage?dimension=" + encodeURIComponent("started_at);DROP TABLE users"),
        { token });
      ok("dimensi injeksi ditolak 400", r.status === 400, `dapat ${r.status}`);
    }

    section("Request trace tak ada -> 404");
    {
      const r = await call("GET",
        "/api/admin/cia/requests/00000000-0000-0000-0000-000000000000", { token });
      ok("trace tak ada -> 404", r.status === 404, `dapat ${r.status}`);
    }

    if (normal) {
      section("PUT access memakai param, mengabaikan userId di body");
      const original = Number(normal.cia_access) ? true : false;
      try {
        // Body sengaja menaruh userId=admin.id — server WAJIB mengabaikannya dan
        // memakai param path (normal.id).
        const put = await call("PUT", `/api/admin/cia/access/${normal.id}`, {
          token, body: { enabled: !original, userId: admin.id },
        });
        ok("PUT access 200", put.status === 200, `dapat ${put.status}`);
        ok("respons memakai userId dari path", Number(put.body?.userId) === Number(normal.id),
          `${put.body?.userId} vs ${normal.id}`);

        const [after] = await sql.query("SELECT cia_access FROM users WHERE id IN (?, ?)",
          [normal.id, admin.id]);
        const normalAfter = (await sql.query(
          "SELECT cia_access FROM users WHERE id=?", [normal.id]))[0][0];
        ok("cia_access user target berubah sesuai enabled",
          Boolean(Number(normalAfter.cia_access)) === !original);

        const nonBool = await call("PUT", `/api/admin/cia/access/${normal.id}`, {
          token, body: { enabled: "true" },
        });
        ok("enabled non-boolean ditolak 400", nonBool.status === 400, `dapat ${nonBool.status}`);
      } finally {
        // Kembalikan ke nilai semula supaya uji idempotent.
        await sql.query("UPDATE users SET cia_access=? WHERE id=?",
          [original ? 1 : 0, normal.id]);
      }
    }
  }
} finally {
  await new Promise((r) => server.close(r));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
