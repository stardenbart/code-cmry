import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const USER  = tokenFor(36, "rasimin");
const ADMIN = tokenFor(4, "digital.transformation");

const [[{ maxId }]] = await db
  .promise()
  .query("SELECT COALESCE(MAX(id), 0) AS maxId FROM perf_samples");

section("GET /api/perf/summary hanya untuk admin");

const anon = await req("GET", "/api/perf/summary");
ok("tanpa token ditolak", anon.status === 401, `dapat ${anon.status}`);

const asUser = await req("GET", "/api/perf/summary", { token: USER });
ok("user biasa ditolak", asUser.status === 403, `dapat ${asUser.status}`);

section("Bentuk ringkasan");

// Kirim sampel dengan sebaran yang diketahui supaya persentilnya bisa diperiksa,
// bukan sekadar "ada angkanya".
const APP_READY = [100, 200, 300, 400, 900];
for (const ms of APP_READY) {
  await req("POST", "/api/perf", {
    token: USER,
    body: { kind: "app_load", metrics: { ttfb: 5, domInteractive: ms, appReady: ms } },
  });
}

const res = await req("GET", "/api/perf/summary", { token: ADMIN });
ok("admin dapat 200", res.status === 200, `dapat ${res.status}`);
ok("ada bagian appLoad", Boolean(res.body?.appLoad), JSON.stringify(res.body)?.slice(0, 200));
ok("appLoad punya p50 dan p95",
  typeof res.body?.appLoad?.p50?.appReady === "number" &&
  typeof res.body?.appLoad?.p95?.appReady === "number",
  JSON.stringify(res.body?.appLoad));

// nearest-rank atas 5 nilai: p50 -> indeks ceil(0.5*5)=3 -> 300; p95 -> indeks 5 -> 900
ok("p50 dihitung benar", res.body?.appLoad?.p50?.appReady === 300,
  `dapat ${res.body?.appLoad?.p50?.appReady}, harusnya 300`);
ok("p95 dihitung benar", res.body?.appLoad?.p95?.appReady === 900,
  `dapat ${res.body?.appLoad?.p95?.appReady}, harusnya 900`);
// Optional chaining sepanjang jalur: sebuah TypeError di sini akan
// menjatuhkan seluruh runner, bukan cuma menggagalkan satu assertion.
ok("p95 tidak lebih kecil dari p50",
  (res.body?.appLoad?.p95?.appReady ?? -1) >= (res.body?.appLoad?.p50?.appReady ?? 0),
  `p50=${res.body?.appLoad?.p50?.appReady} p95=${res.body?.appLoad?.p95?.appReady}`);

ok("ada bagian dashboard", Boolean(res.body?.dashboard), JSON.stringify(res.body?.dashboard));
ok("ada daftar slowest", Array.isArray(res.body?.slowest), JSON.stringify(res.body?.slowest));

section("prefetchHitRate dan slowest");

// 4 sampel dashboard_open, 2 di antaranya prefetch kena -> rate 0.5
for (const hit of [true, true, false, false]) {
  await req("POST", "/api/perf", {
    token: USER,
    body: {
      kind: "dashboard_open",
      dashboard_id: 999999,
      metrics: { tokenMs: hit ? 1 : 1400, renderMs: 2000, prefetchHit: hit },
    },
  });
}

const res2 = await req("GET", "/api/perf/summary", { token: ADMIN });
ok("prefetchHitRate dihitung", res2.body?.dashboard?.prefetchHitRate === 0.5,
  `dapat ${res2.body?.dashboard?.prefetchHitRate}, harusnya 0.5`);

// dashboard_id 999999 tidak ada di tabel dashboards — join LEFT harus tetap
// memasukkannya dengan title null, bukan menjatuhkannya diam-diam.
const ghost = (res2.body?.slowest || []).find((d) => d.dashboard_id === 999999);
ok("dashboard tanpa judul tetap muncul di slowest", Boolean(ghost),
  JSON.stringify(res2.body?.slowest));
ok("slowest butuh minimal 3 sampel", (ghost?.samples ?? 0) >= 3, `samples ${ghost?.samples}`);

section("Test membersihkan sampelnya sendiri");

const [cleanup] = await db.promise().query("DELETE FROM perf_samples WHERE id > ?", [maxId]);
ok("sampel buatan test dihapus", cleanup.affectedRows >= 9,
  `${cleanup.affectedRows} baris dihapus (id > ${maxId})`);
