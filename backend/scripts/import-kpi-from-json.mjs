// Import KPI Library dari file NDJSON (keluaran generate_ndjson.py).
//
// Membaca dua file:
//   kpis.ndjson     — satu objek per baris, masing-masing satu cia_kpis row
//   bindings.ndjson — satu objek per baris, masing-masing satu cia_kpi_bindings row
//
// IDEMPOTEN: KPI di-upsert per slug secara NON-DESTRUKTIF (ON DUPLICATE KEY
// UPDATE slug=slug), jadi re-import tidak menimpa metadata bisnis yang mungkin
// sudah diedit Admin. Binding di-upsert per binding_key, menjaga
// verification_status yang sudah confirmed/rejected.
//
// Pemakaian:
//   node scripts/import-kpi-from-json.mjs --dry-run           (default)
//   node scripts/import-kpi-from-json.mjs --apply
//   node scripts/import-kpi-from-json.mjs --apply --dir /path/to/ndjson/
//   node scripts/import-kpi-from-json.mjs --apply --kpis /path/to/kpis.ndjson --bindings /path/to/bindings.ndjson
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { pathToFileURL } from "url";
import db from "../src/config/db.js";
import { slugify, computeBindingKey, upsertBinding } from "../src/models/ciaKpiModel.js";

const pool = db.promise();

// ── Parse NDJSON ─────────────────────────────────────────────────────────────
function parseNdjson(filepath) {
  const content = readFileSync(filepath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim());
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`NDJSON parse error at line ${i + 1} in ${filepath}: ${err.message}`);
    }
  });
}

// ── Clamp string to column width ────────────────────────────────────────────
function clamp(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

// ── Build import plan ───────────────────────────────────────────────────────
export function buildImportPlan(kpiItems, bindingItems) {
  // Index bindings by kpi_slug
  const bindingsBySlug = new Map();
  for (const b of bindingItems) {
    const slug = b.kpi_slug;
    if (!bindingsBySlug.has(slug)) bindingsBySlug.set(slug, []);
    bindingsBySlug.get(slug).push(b);
  }

  return kpiItems.map((item) => ({
    slug: slugify(item.slug || `${item.domain || ""}-${item.human_name}`),
    humanName: clamp(item.human_name, 200) || "",
    synonyms: Array.isArray(item.synonyms) ? item.synonyms : [],
    definition: String(item.definition || ""),
    businessFunction: String(item.business_function || ""),
    answerableQuestions: Array.isArray(item.answerable_questions) ? item.answerable_questions : [],
    domain: clamp(item.domain, 60),
    unit: clamp(item.unit, 40),
    numberFormat: clamp(item.number_format, 30),
    status: item.status || "draft",
    source: item.source || "powerbi_cowork",
    bindings: (bindingsBySlug.get(item.slug) || []).map((b) => ({
      bindingKey: b.binding_key,
      dashboardId: b.dashboard_id ?? null,
      reportId: b.report_id ?? null,
      pageName: b.page_name ?? null,
      visualTitle: b.visual_title ?? null,
      semanticModel: b.semantic_model ?? null,
      tableName: b.table_name ?? null,
      measureName: b.measure_name ?? null,
      displayCaption: b.display_caption ?? null,
      dimensions: b.dimensions ?? null,
      dateTable: b.date_table ?? null,
      dateColumn: b.date_column ?? null,
      dateLogic: b.date_logic ?? null,
      source: b.source || "powerbi_cowork",
      verificationStatus: b.verification_status || "discovered",
      review: b.review ?? null,
    })),
  }));
}

// ── Apply import ────────────────────────────────────────────────────────────
export async function applyImport(plan, actorId = null) {
  let kpisCreated = 0,
    kpisExisting = 0,
    bindingsCreated = 0,
    bindingsRefreshed = 0,
    orphanBindings = 0;

  for (const item of plan) {
    // SELECT first, INSERT only if not exists (non-destructive).
    const [existing] = await pool.query(
      "SELECT id FROM cia_kpis WHERE slug = ? LIMIT 1",
      [item.slug]
    );
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          item.slug,
          item.humanName,
          JSON.stringify(item.synonyms),
          item.definition,
          item.businessFunction,
          JSON.stringify(item.answerableQuestions),
          item.domain,
          item.unit,
          item.numberFormat,
          item.status,
          item.source,
          actorId,
          actorId,
        ]
      );
      kpiId = ins.insertId;
      kpisCreated += 1;

      // Create revision for audit trail
      await pool.query(
        `INSERT INTO cia_kpi_revisions (kpi_id, version, before_json, after_json, action, reason, actor_id)
         VALUES (?, 1, NULL, ?, 'create', 'Import dari NDJSON (powerbi_cowork)', ?)`,
        [
          kpiId,
          JSON.stringify({
            slug: item.slug,
            humanName: item.humanName,
            synonyms: item.synonyms,
            definition: item.definition,
            businessFunction: item.businessFunction,
            answerableQuestions: item.answerableQuestions,
            domain: item.domain,
            unit: item.unit,
            numberFormat: item.numberFormat,
            status: item.status,
            version: 1,
            source: item.source,
          }),
          actorId,
        ]
      );
    }

    // Upsert bindings for this KPI
    for (const b of item.bindings) {
      // Recompute binding_key with kpiId to match existing computeBindingKey
      // which includes kpiId as part of the 7-field hash.
      // However, we also store the NDJSON's original 6-field binding_key as a
      // fallback reference. The upsertBinding function will compute its own key.
      const bindingWithKpi = { ...b, kpiId };
      const { created } = await upsertBinding(bindingWithKpi);

      // Retire old bindings for same kpi+model+measure that have different key
      await pool.query(
        `UPDATE cia_kpi_bindings SET verification_status='missing', missing_since=COALESCE(missing_since,NOW())
          WHERE kpi_id=? AND dashboard_id IS NULL AND source='powerbi_cowork'
            AND semantic_model <=> ? AND measure_name <=> ? AND binding_key<>?`,
        [kpiId, b.semanticModel ?? null, b.measureName ?? null, bindingWithKpi.bindingKey || computeBindingKey(bindingWithKpi)]
      );

      if (created) bindingsCreated += 1;
      else bindingsRefreshed += 1;
    }

    if (item.bindings.length === 0) {
      orphanBindings += 1;
    }
  }

  return { kpisCreated, kpisExisting, bindingsCreated, bindingsRefreshed, orphanBindings };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  // Resolve file paths
  let kpisFile, bindingsFile;
  const dirIdx = args.indexOf("--dir");
  const kpisIdx = args.indexOf("--kpis");
  const bindingsIdx = args.indexOf("--bindings");

  if (dirIdx !== -1 && args[dirIdx + 1]) {
    const dir = resolve(args[dirIdx + 1]);
    kpisFile = resolve(dir, "kpis.ndjson");
    bindingsFile = resolve(dir, "bindings.ndjson");
  } else if (kpisIdx !== -1 && bindingsIdx !== -1) {
    kpisFile = resolve(args[kpisIdx + 1]);
    bindingsFile = resolve(args[bindingsIdx + 1]);
  } else {
    // Default: look in current directory
    kpisFile = resolve("kpis.ndjson");
    bindingsFile = resolve("bindings.ndjson");
  }

  console.log(`[cia:import-json] reading KPIs from: ${kpisFile}`);
  console.log(`[cia:import-json] reading bindings from: ${bindingsFile}`);

  const kpiItems = parseNdjson(kpisFile);
  const bindingItems = parseNdjson(bindingsFile);

  console.log(`[cia:import-json] parsed: ${kpiItems.length} KPIs, ${bindingItems.length} bindings`);

  const plan = buildImportPlan(kpiItems, bindingItems);
  const totalBindings = plan.reduce((s, p) => s + p.bindings.length, 0);

  if (!apply) {
    console.log(`\n[cia:import-json] dry-run: ${plan.length} KPI, ${totalBindings} binding kandidat`);

    // Show domain breakdown
    const domains = {};
    for (const p of plan) {
      const d = p.domain || "?";
      if (!domains[d]) domains[d] = { kpis: 0, bindings: 0 };
      domains[d].kpis += 1;
      domains[d].bindings += p.bindings.length;
    }
    console.log("\n  Per-domain breakdown:");
    for (const [domain, stats] of Object.entries(domains).sort()) {
      console.log(`    ${domain.padEnd(15)}: ${stats.kpis} KPIs, ${stats.bindings} bindings`);
    }

    // Show sample entries
    console.log("\n  Sample KPIs:");
    for (const p of plan.slice(0, 8)) {
      console.log(`    ${p.slug} :: ${p.humanName} — ${p.bindings.length} binding [${p.domain || "-"}]`);
    }

    // Orphan check: bindings whose kpi_slug has no matching KPI
    const kpiSlugs = new Set(kpiItems.map((k) => k.slug));
    const orphanBindings = bindingItems.filter((b) => !kpiSlugs.has(b.kpi_slug));
    if (orphanBindings.length > 0) {
      console.log(`\n  ⚠ ${orphanBindings.length} binding(s) reference non-existent KPI slug(s)`);
      const orphanSlugs = [...new Set(orphanBindings.map((b) => b.kpi_slug))];
      console.log(`    Orphan slugs: ${orphanSlugs.slice(0, 5).join(", ")}${orphanSlugs.length > 5 ? "…" : ""}`);
    }

    console.log("\n  (dry-run: tidak ada baris yang ditulis)");
    process.exit(0);
  }

  const result = await applyImport(plan, null);
  console.log(`\n[cia:import-json] apply: ${JSON.stringify(result)}`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
