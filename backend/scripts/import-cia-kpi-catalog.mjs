// Import deterministik KATALOG_KPI -> KPI Library.
//
// Katalog `kpi` ADALAH nama manusia; `measures` adalah nama teknis. Import
// memisahkan keduanya: human_name = entry.kpi, dan tiap measure menjadi (a)
// sinonim untuk pencarian dan (b) binding measure/model. dashboard_id sengaja
// null di sini — binding ke dashboard/visual aktual adalah tugas reconcile
// (ciaKpiSync), supaya import tetap deterministik dan tidak bergantung pada
// inventory yang berubah-ubah.
//
// IDEMPOTEN: KPI di-upsert per slug secara NON-DESTRUKTIF (ON DUPLICATE KEY
// UPDATE slug=slug), jadi re-import tidak menimpa metadata bisnis yang mungkin
// sudah diedit Admin dan tidak menambah baris. Binding di-upsert per binding_key.
//
// Pemakaian:
//   node scripts/import-cia-kpi-catalog.mjs --dry-run   (default)
//   node scripts/import-cia-kpi-catalog.mjs --apply
import "dotenv/config";
import { pathToFileURL } from "url";
import db from "../src/config/db.js";
import { KATALOG_KPI } from "../src/services/kpiCatalog.js";
import { slugify, computeBindingKey, upsertBinding } from "../src/models/ciaKpiModel.js";

const pool = db.promise();

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    const s = String(v ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// Sebagian entri katalog menaruh prosa pada field pendek (mis. unit berisi
// "satuannya belum dipastikan pemilik"). Clamp ke lebar kolom supaya import
// tidak gagal; Admin merapikan kemudian.
function clamp(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function columnRef(value, fallbackTable = null) {
  const table = typeof value === "object" ? value?.tabel ?? value?.table : fallbackTable;
  const column = typeof value === "object" ? value?.kolom ?? value?.column : value;
  if (!table || !column) return null;
  return { table: String(table).trim(), column: String(column).trim(), humanName: String(column).trim() };
}

function bindingDimensions(entry) {
  return [
    columnRef(entry.dimensi, entry.dimensiTabel),
    ...(Array.isArray(entry.kolomTeks) ? entry.kolomTeks.map((v) => columnRef(v, entry.dimensiTabel)) : []),
  ].filter(Boolean);
}

export function buildImportPlan(catalog = KATALOG_KPI) {
  return catalog.map((entry) => {
    const humanName = clamp(entry.kpi, 200) || "";
    const measures = Array.isArray(entry.measures) ? entry.measures : [];
    return {
      slug: slugify(`${entry.domain || ""}-${humanName}`),
      humanName,
      // Nama measure teknis jadi sinonim supaya router bisa mencocokkan istilah
      // teknis, tetapi TIDAK pernah tampil sebagai nama utama.
      synonyms: uniqueStrings(measures),
      // Jangan mengarang definition: string kosong terlihat jelas di UI untuk
      // dilengkapi Admin.
      definition: String(entry.notes || ""),
      businessFunction: "",
      answerableQuestions: [],
      domain: clamp(entry.domain, 60),
      unit: clamp(entry.unit, 40),
      status: "draft",
      source: "catalog_import",
      dateLogic: entry.dateLogic || null,
      bindings: measures.map((measure, index) => ({
        semanticModel: entry.modelName || null,
        measureName: measure,
        displayCaption: entry.terlihatSebagai?.[index]
          || (measures.length === 1 ? entry.terlihatSebagai?.[0] : null)
          || null,
        dimensions: bindingDimensions(entry),
        dateTable: entry.kolomTanggal?.tabel ?? entry.kolomTanggal?.table ?? null,
        dateColumn: entry.kolomTanggal?.kolom ?? entry.kolomTanggal?.column ?? null,
        dateLogic: entry.dateLogic || null,
        source: "catalog_import",
      })),
    };
  });
}

export async function applyImport(plan, actorId = null) {
  let kpisCreated = 0, kpisExisting = 0, bindingsCreated = 0, bindingsRefreshed = 0;
  for (const item of plan) {
    // SELECT dulu, baru INSERT bila belum ada. Lebih deterministik daripada
    // mengandalkan insertId dari ON DUPLICATE KEY UPDATE (yang bisa 0 saat baris
    // sudah ada), dan tetap non-destruktif: KPI yang sudah ada tidak disentuh.
    const [existing] = await pool.query("SELECT id FROM cia_kpis WHERE slug = ? LIMIT 1", [item.slug]);
    let kpiId;
    if (existing.length) {
      kpiId = existing[0].id;
      kpisExisting += 1;
    } else {
      const [ins] = await pool.query(
        `INSERT INTO cia_kpis
           (slug, human_name, synonyms_json, definition, business_function,
            answerable_questions_json, domain, unit, number_format, status,
            version, source, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)`,
        [item.slug, item.humanName, JSON.stringify(item.synonyms), item.definition,
         item.businessFunction, JSON.stringify(item.answerableQuestions), item.domain,
         item.unit, item.status, item.source, actorId, actorId]
      );
      kpiId = ins.insertId;
      kpisCreated += 1;
      // Satu revisi 'create' untuk audit KPI yang benar-benar baru.
      // Snapshot LENGKAP (semua field editable) supaya revisi 'create' adalah
      // gambaran utuh KPI saat dibuat — restore ke revisi ini memulihkan
      // synonyms/definition/dst dengan benar, bukan mengosongkannya.
      await pool.query(
        `INSERT INTO cia_kpi_revisions (kpi_id, version, before_json, after_json, action, reason, actor_id)
         VALUES (?, 1, NULL, ?, 'create', 'Import dari KATALOG_KPI', ?)`,
        [kpiId, JSON.stringify({
          slug: item.slug, humanName: item.humanName, synonyms: item.synonyms,
          definition: item.definition, businessFunction: item.businessFunction,
          answerableQuestions: item.answerableQuestions, domain: item.domain,
          unit: item.unit, numberFormat: null, status: item.status,
          version: 1, source: item.source,
        }), actorId]
      );
    }

    for (const b of item.bindings) {
      const bindingKey = computeBindingKey({ ...b, kpiId });
      const { created } = await upsertBinding({ ...b, kpiId, bindingKey });
      // Binding versi lama tidak memasukkan kpiId, sehingga dua konsep yang
      // memakai measure sama saling menimpa. Pertahankan barisnya untuk audit,
      // tetapi keluarkan dari routing setelah binding baru berhasil dibuat.
      await pool.query(
        `UPDATE cia_kpi_bindings SET verification_status='missing', missing_since=COALESCE(missing_since,NOW())
          WHERE kpi_id=? AND dashboard_id IS NULL AND source='catalog_import'
            AND semantic_model <=> ? AND measure_name <=> ? AND binding_key<>?`,
        [kpiId, b.semanticModel ?? null, b.measureName ?? null, bindingKey]
      );
      if (created) bindingsCreated += 1;
      else bindingsRefreshed += 1;
    }
  }
  return { kpisCreated, kpisExisting, bindingsCreated, bindingsRefreshed };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const plan = buildImportPlan(KATALOG_KPI);
  const totalBindings = plan.reduce((s, p) => s + p.bindings.length, 0);

  if (!apply) {
    console.log(`[cia:import-kpis] dry-run: ${plan.length} KPI, ${totalBindings} binding kandidat`);
    for (const p of plan.slice(0, 8)) {
      console.log(`  ${p.slug} :: ${p.humanName} — ${p.bindings.length} binding [${p.domain || "-"}]`);
    }
    console.log("  (dry-run: tidak ada baris yang ditulis)");
    process.exit(0);
  }

  const result = await applyImport(plan, null);
  console.log(`[cia:import-kpis] apply: ${JSON.stringify(result)}`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
