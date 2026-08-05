import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";
import { statusScheduler } from "../src/config/scheduler.js";

const ADMIN = tokenFor(4, "digital.transformation");
const USER = tokenFor(36, "rasimin");
const sql = db.promise();

section("Endpoint job hanya untuk admin");

// /run dan /send bisa mengirim pesan sungguhan ke grup manajemen, jadi gerbang
// ini bukan formalitas.
for (const [method, path, body] of [
  ["POST", "/api/summary/run", { dryRun: true }],
  ["POST", "/api/summary/send", { dryRun: true }],
  ["GET", "/api/summary/job-status", null],
]) {
  const r = await req(method, path, { token: USER, body: body || {} });
  ok(`${method} ${path} sebagai user biasa -> 403`, r.status === 403, `dapat ${r.status}`);
}

section("Scheduler bawaannya mati");

const st = statusScheduler();
ok("zona Asia/Jakarta", st.zona === "Asia/Jakarta", st.zona);
ok("jadwal kumpul 06:15", st.jadwal.kumpul === "15 6 * * *", st.jadwal.kumpul);
ok("jadwal kirim 08:00", st.jadwal.kirim === "0 8 * * *", st.jadwal.kirim);
ok("ada jadwal percobaan ulang sebelum jam kirim", st.jadwal.ulang === "45 7 * * *", st.jadwal.ulang);
ok("catchup policy skip", st.catchupPolicy === "skip", st.catchupPolicy);

section("Status job dibaca admin dan tidak membocorkan group id");

const js = await req("GET", "/api/summary/job-status", { token: ADMIN });
ok("status 200", js.status === 200, `dapat ${js.status}`);
ok("membawa keadaan scheduler", Boolean(js.body?.scheduler), JSON.stringify(js.body).slice(0, 120));
ok("membawa keadaan kunci", "kumpul" in (js.body?.kunci || {}));
ok("menyebut provider", typeof js.body?.pengiriman?.provider === "string", js.body?.pengiriman?.provider);

// Group id cukup untuk mengirim pesan bila providernya sudah dipasangkan, jadi
// tidak boleh dikembalikan utuh ke browser.
const gid = js.body?.pengiriman?.groupId;
if (gid) {
  ok("group id disamarkan", gid.includes("..."), gid);
  ok("group id tidak utuh", !/^\d{10,}/.test(gid.replace("...@g.us", "")) || gid.length < 20, gid);
} else {
  ok("group id belum diatur, tidak ada yang dibocorkan", true);
}

section("Tanggal tidak sah ditolak sebelum job jalan");

for (const t of ["2026-8-4", "04-08-2026", "besok", "2026/08/04", "'; DROP TABLE users; --"]) {
  const r = await req("POST", "/api/summary/run", { token: ADMIN, body: { dryRun: true, tanggal: t } });
  ok(`tanggal ${JSON.stringify(t.slice(0, 18))} ditolak 400`, r.status === 400, `dapat ${r.status}`);
}

section("Dry run adalah bawaan, mengirim harus diminta eksplisit");

// Ini penjagaan terpenting di berkas ini. Provider baileys sudah dipasangkan ke
// grup manajemen, jadi body tanpa dryRun TIDAK BOLEH mengirim apa pun.
const kirimBawaan = await req("POST", "/api/summary/send", { token: ADMIN, body: {} });
ok("send tanpa dryRun tetap dry run",
  kirimBawaan.status === 200 ? kirimBawaan.body?.dryRun === true || /TIDAK dikirim/.test(kirimBawaan.body?.message || "")
    : [409, 200].includes(kirimBawaan.status),
  `status ${kirimBawaan.status} body ${JSON.stringify(kirimBawaan.body).slice(0, 160)}`);

for (const body of [{}, { dryRun: "false" }, { dryRun: 0 }, { dryRun: null }]) {
  const r = await req("POST", "/api/summary/send", { token: ADMIN, body });
  const amanDryRun =
    r.status === 409 ||
    (r.status === 200 && (r.body?.dryRun === true || /TIDAK dikirim/.test(r.body?.message || ""))) ||
    (r.status === 200 && r.body?.berhasil === false);
  // "false" sebagai string dan 0 bukan false eksplisit, jadi harus tetap dry run.
  ok(`body ${JSON.stringify(body)} tidak mengirim sungguhan`, amanDryRun,
    `status ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
}

section("Data uji dibersihkan");

try {
  await sql.query("DELETE FROM daily_summary_lock WHERE holder LIKE 'manual-%'");
  const [[n]] = await sql.query("SELECT COUNT(*) n FROM daily_summary_lock WHERE holder LIKE 'manual-%'");
  ok("kunci manual tidak tertinggal", Number(n.n) === 0, `sisa ${n.n}`);
} catch (err) {
  ok("pembersihan kunci", false, err.message);
}
