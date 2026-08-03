import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const USER = tokenFor(36, "rasimin");

// Tabel perf_samples adalah sumber angka p50/p95 yang dilihat admin. Sampel
// palsu dari test akan membuat angka itu bohong, jadi test membersihkan
// persis baris yang dibuatnya sendiri — dibatasi id di atas tanda ini.
const [[{ maxId }]] = await db
  .promise()
  .query("SELECT COALESCE(MAX(id), 0) AS maxId FROM perf_samples");

section("POST /api/perf menerima telemetri");

const good = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: { ttfb: 12, domInteractive: 340, appReady: 780 } },
});
ok("kiriman sah dibalas 204", good.status === 204, `dapat ${good.status}`);

const noToken = await req("POST", "/api/perf", {
  body: { kind: "app_load", metrics: { ttfb: 1, domInteractive: 2, appReady: 3 } },
});
ok("tanpa token ditolak", noToken.status === 401, `dapat ${noToken.status}`);

section("Bentuk metrics divalidasi");

const badKind = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "bukan_kind_yang_dikenal", metrics: { ttfb: 1 } },
});
ok("kind tak dikenal ditolak", badKind.status === 400, `dapat ${badKind.status}`);

const badValue = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: { ttfb: "bukan angka" } },
});
ok("nilai non-angka ditolak", badValue.status === 400, `dapat ${badValue.status}`);

const tooBig = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: { ttfb: 99_999_999 } },
});
ok("nilai di luar rentang ditolak", tooBig.status === 400, `dapat ${tooBig.status}`);

const unknownKey = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: { ttfb: 5, kunci_asing: 1 } },
});
ok("kunci asing ditolak", unknownKey.status === 400, `dapat ${unknownKey.status}`);

const metricsArray = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "app_load", metrics: [1, 2, 3] },
});
ok("metrics berupa array ditolak", metricsArray.status === 400, `dapat ${metricsArray.status}`);

section("dashboard_open memakai kunci yang berbeda");

const dashOk = await req("POST", "/api/perf", {
  token: USER,
  body: {
    kind: "dashboard_open",
    dashboard_id: 999999,
    metrics: { tokenMs: 4, renderMs: 2100, prefetchHit: true },
  },
});
ok("sampel dashboard_open diterima", dashOk.status === 204, `dapat ${dashOk.status}`);

const wrongKeyForKind = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "dashboard_open", metrics: { ttfb: 10 } },
});
ok("kunci app_load ditolak pada dashboard_open",
  wrongKeyForKind.status === 400, `dapat ${wrongKeyForKind.status}`);

const boolAsNumber = await req("POST", "/api/perf", {
  token: USER,
  body: { kind: "dashboard_open", metrics: { prefetchHit: 1 } },
});
ok("prefetchHit non-boolean ditolak", boolAsNumber.status === 400, `dapat ${boolAsNumber.status}`);

section("Test membersihkan sampelnya sendiri");

const [cleanup] = await db
  .promise()
  .query("DELETE FROM perf_samples WHERE id > ?", [maxId]);
ok("sampel buatan test dihapus", cleanup.affectedRows >= 2,
  `${cleanup.affectedRows} baris dihapus (id > ${maxId})`);

const [[{ sisa }]] = await db
  .promise()
  .query("SELECT COUNT(*) AS sisa FROM perf_samples WHERE id > ?", [maxId]);
ok("tidak ada sampel test yang tertinggal", sisa === 0, `sisa ${sisa}`);
