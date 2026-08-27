// Model KPI: editing atomik + revisi immutable + restore sebagai versi baru.
//
// Yang dijaga:
//  - create menaruh versi 1 dan satu revisi 'create';
//  - edit menaikkan versi TEPAT satu dan revisi menyimpan before/after;
//  - bila penulisan revisi gagal, UPDATE KPI ikut ROLLBACK (atomik);
//  - patch hanya menerima field allowlist; slug tidak berubah saat human_name
//    diedit;
//  - restore membuat versi BARU (before=current, after=target), bukan memutar
//    nomor versi mundur;
//  - update/confirm/restore menolak reason kosong.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  createKpi, getKpi, updateKpi, confirmKpi, listRevisions, restoreRevision,
  __setRevisionWriterForTests,
} from "../src/models/ciaKpiModel.js";

const sql = db.promise();
const cleanup = [];

// actor harus user sungguhan (FK created_by/updated_by/actor_id -> users.id).
const [users] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const ACTOR = users[0]?.id ?? null;

async function removeKpi(id) {
  // revisi & binding CASCADE saat KPI dihapus.
  await sql.query("DELETE FROM cia_kpis WHERE id = ?", [id]);
}

try {
  section("createKpi: versi 1 + revisi create");
  const created = await createKpi({
    humanName: "Jam lembur", domain: "cost", unit: "jam",
    synonyms: ["OT_HOURS", "overtime hours", "OT_HOURS"], // duplikat sengaja
    definition: "Total jam lembur.",
    answerableQuestions: ["berapa jam lembur?", ""],       // kosong sengaja
  }, ACTOR);
  cleanup.push(created.id);
  ok("versi awal 1", created.version === 1, String(created.version));
  ok("status awal draft", created.status === "draft", created.status);
  ok("slug terbentuk", typeof created.slug === "string" && created.slug.length > 0, created.slug);
  ok("synonyms unik & non-kosong", Array.isArray(created.synonyms) &&
    created.synonyms.length === 2, JSON.stringify(created.synonyms));
  ok("answerableQuestions membuang string kosong", created.answerableQuestions.length === 1,
    JSON.stringify(created.answerableQuestions));
  const rev0 = await listRevisions(created.id);
  ok("ada satu revisi create", rev0.length === 1 && rev0[0].action === "create",
    JSON.stringify(rev0.map((r) => r.action)));

  section("updateKpi: versi naik satu, before/after tersimpan, slug tetap");
  const slugBefore = created.slug;
  const updated = await updateKpi(created.id, { humanName: "Jam lembur (harian)" }, ACTOR, "perjelas nama");
  ok("versi jadi 2", updated.version === 2, String(updated.version));
  ok("slug tidak berubah", updated.slug === slugBefore, updated.slug);
  ok("human name berubah", updated.humanName === "Jam lembur (harian)");
  const revs = await listRevisions(created.id);
  const editRev = revs.find((r) => r.action === "edit");
  ok("revisi edit menyimpan before lama", editRev?.before?.humanName === "Jam lembur",
    JSON.stringify(editRev?.before));
  ok("revisi edit menyimpan after baru", editRev?.after?.humanName === "Jam lembur (harian)",
    JSON.stringify(editRev?.after));

  section("updateKpi: patch di luar allowlist diabaikan");
  const before = await getKpi(created.id);
  const tampered = await updateKpi(created.id,
    { slug: "diretas", version: 999, id: 123456, definition: "def baru" }, ACTOR, "uji allowlist");
  ok("slug tetap", tampered.slug === slugBefore, tampered.slug);
  ok("version naik normal (bukan 999)", tampered.version === before.version + 1, String(tampered.version));
  ok("definition (allowlist) berubah", tampered.definition === "def baru");

  section("reason kosong ditolak");
  let rejected = 0;
  for (const fn of [
    () => updateKpi(created.id, { unit: "x" }, ACTOR, "   "),
    () => confirmKpi(created.id, ACTOR, ""),
  ]) {
    try { await fn(); } catch (e) { if (e?.statusCode === 400) rejected += 1; }
  }
  ok("update & confirm tanpa reason ditolak 400", rejected === 2, String(rejected));

  section("Atomicity: revisi gagal -> update KPI rollback");
  const stable = await getKpi(created.id);
  __setRevisionWriterForTests(async () => { throw new Error("boom revisi"); });
  let threw = false;
  try {
    await updateKpi(created.id, { humanName: "TIDAK BOLEH TERSIMPAN" }, ACTOR, "harus rollback");
  } catch { threw = true; }
  __setRevisionWriterForTests(null); // pulihkan
  ok("updateKpi melempar saat revisi gagal", threw);
  const afterFail = await getKpi(created.id);
  ok("human name TIDAK berubah (rollback)", afterFail.humanName === stable.humanName, afterFail.humanName);
  ok("version TIDAK naik (rollback)", afterFail.version === stable.version, String(afterFail.version));

  section("confirmKpi menaikkan versi & status confirmed");
  const confirmed = await confirmKpi(created.id, ACTOR, "sudah divalidasi pemilik");
  ok("status confirmed", confirmed.status === "confirmed", confirmed.status);
  ok("versi naik setelah confirm", confirmed.version === afterFail.version + 1, String(confirmed.version));

  section("restoreRevision membuat versi baru (maju), bukan mundur");
  const allRevs = await listRevisions(created.id);
  // Revisi paling awal 'create' menyimpan after = snapshot awal (humanName asli).
  const target = allRevs.find((r) => r.action === "create");
  const beforeRestore = await getKpi(created.id);
  const restored = await restoreRevision(created.id, target.id, ACTOR, "kembalikan nama awal");
  ok("versi restore MAJU (current+1)", restored.version === beforeRestore.version + 1,
    String(restored.version));
  ok("human name kembali ke nilai target", restored.humanName === target.after.humanName,
    restored.humanName);
  const restoreRev = (await listRevisions(created.id)).find((r) => r.action === "restore");
  ok("revisi restore before=current lama", restoreRev?.before?.humanName === beforeRestore.humanName);
  ok("revisi restore after=target", restoreRev?.after?.humanName === target.after.humanName);

  section("restore revisi milik KPI lain ditolak");
  const other = await createKpi({ humanName: "KPI lain", domain: "x" }, ACTOR);
  cleanup.push(other.id);
  let notFound = false;
  try {
    await restoreRevision(other.id, target.id, ACTOR, "salah kpi");
  } catch (e) { notFound = e?.statusCode === 404; }
  ok("restore revisi lintas-KPI -> 404", notFound);
} finally {
  __setRevisionWriterForTests(null);
  for (const id of cleanup) await removeKpi(id);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
