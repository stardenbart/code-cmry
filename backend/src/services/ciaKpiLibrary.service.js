// Read-through KPI Library + lookup deterministik untuk router CIA.
//
// Skor deterministik memberi bobot tinggi pada token SPESIFIK (nama KPI,
// sinonim, measure, pertanyaan) dan bobot rendah pada token GENERIK
// ("breakdown", "issue", "detail", "analisa"). Itulah yang membuat pertanyaan
// "breakdown lembur ..." mengarah ke KPI lembur, bukan tersesat ke maintenance
// karena kata "breakdown".
//
// Fallback: bila CIA_KPI_LIBRARY_ENABLED != "true", tabel belum ada, atau
// library kosong, KATALOG_KPI diadaptasi ke shape kandidat yang SAMA sehingga
// router tidak pernah kehilangan sumber. Peringatan dicatat satu kali per proses.
//
// ACL: allowedDashboardIds (array) memfilter binding — binding dashboard di luar
// ACL dibuang; binding model-level (dashboard_id NULL) tidak membocorkan
// dashboard sehingga tetap boleh. Bila null, tidak ada filter (mode centralized).
import db from "../config/db.js";
import { KATALOG_KPI } from "./kpiCatalog.js";
import { buildIntentFrame } from "./cia/intentFrame.js";
import { buildVisualBlueprint } from "./cia/visualBlueprint.js";

const pool = db.promise();

const WEIGHTS = {
  exactHumanName: 12,
  exactSynonym: 10,
  measureAlias: 8,
  answerableQuestionTerm: 6,
  dashboardOrDomain: 4,
  dimension: 3,
  genericTerm: 0,
};

// Kata generik/analitik + stopword: hadir di hampir semua pertanyaan sehingga
// tidak boleh menentukan sumber.
const GENERIC = new Set([
  "breakdown", "issue", "issues", "detail", "rincian", "analisa", "analisis",
  "top", "tertinggi", "terendah", "tinggi", "rendah", "paling", "banyak",
  "ranking", "bandingkan", "dibandingkan", "dibanding", "perbandingan", "versus", "vs",
  "berapa", "persen", "persentase", "achievement", "achivement", "totalnya",
  "rekap", "snapshot", "pecahan", "kategorinya", "kategori", "pemicu", "penyebab", "kendala",
  "januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus",
  "september", "oktober", "november", "desember", "bulan", "minggu", "week", "hari", "tanggal",
  "jelaskan", "penjelasan", "mengenai", "perihal", "berikan", "tolong", "kenapa",
  "mengapa", "apa", "apakah", "bagaimana", "harian", "bulanan", "mingguan",
  "per", "dan", "yang", "di", "ke", "dari", "untuk", "pada", "atau", "itu",
  "karena", "dikarenakan", "terjadi", "adalah", "dengan", "dalam", "ada",
  "saja", "juga", "naik", "turun",
]);

let warnedFallback = false;
function warnFallbackOnce(reason) {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(`[cia-kpi] memakai fallback KATALOG_KPI: ${reason}`);
}

function libraryEnabled() {
  return process.env.CIA_KPI_LIBRARY_ENABLED === "true";
}

// ── Tokenisasi ──────────────────────────────────────────────────────────────
function unigrams(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
function withBigrams(text) {
  const u = unigrams(text);
  const out = new Set(u);
  for (let i = 0; i < u.length - 1; i += 1) out.add(`${u[i]} ${u[i + 1]}`);
  return out;
}
function termSet(text) { return withBigrams(text); }
function isGenericTerm(term) {
  return String(term).split(" ").some((part) => GENERIC.has(part));
}

// dimensions_json bisa berupa string ("Departemen"), qualified string
// ("Tbl[Kol]"), atau object {table,column,humanName}. Ambil teks untuk scoring.
function dimText(d) {
  if (d && typeof d === "object" && !Array.isArray(d)) {
    return String(d.humanName || d.column || d.label || "").trim();
  }
  return String(d ?? "").trim();
}

// ── Skoring ─────────────────────────────────────────────────────────────────
function buildBuckets(candidate) {
  const humanNameTerms = termSet(candidate.humanName);
  const synonymPhrases = new Set((candidate.synonyms || []).map((s) => String(s).toLowerCase().trim()));
  const synonymTerms = termSet((candidate.synonyms || []).join(" "));
  const aqTerms = termSet((candidate.answerableQuestions || []).join(" "));
  const dashNames = (candidate.bindings || []).map((b) => b.dashboardName || "").join(" ");
  const domainDashTerms = termSet(`${candidate.domain || ""} ${dashNames}`);
  const dimTerms = termSet((candidate.bindings || [])
    .flatMap((b) => b.dimensions || []).map(dimText).join(" "));
  return { humanNameTerms, synonymPhrases, synonymTerms, aqTerms, domainDashTerms, dimTerms };
}

function scoreCandidate(candidate, questionTerms) {
  const b = buildBuckets(candidate);
  let score = 0;
  for (const t of questionTerms) {
    if (isGenericTerm(t)) {
      const anywhere = b.humanNameTerms.has(t) || b.synonymTerms.has(t) ||
        b.aqTerms.has(t) || b.domainDashTerms.has(t) || b.dimTerms.has(t);
      if (anywhere) score += WEIGHTS.genericTerm;
      continue;
    }
    let w = 0;
    if (b.humanNameTerms.has(t)) w = Math.max(w, WEIGHTS.exactHumanName);
    if (b.synonymPhrases.has(t)) w = Math.max(w, WEIGHTS.exactSynonym);
    if (b.synonymTerms.has(t)) w = Math.max(w, WEIGHTS.measureAlias);
    if (b.aqTerms.has(t)) w = Math.max(w, WEIGHTS.answerableQuestionTerm);
    if (b.domainDashTerms.has(t)) w = Math.max(w, WEIGHTS.dashboardOrDomain);
    if (b.dimTerms.has(t)) w = Math.max(w, WEIGHTS.dimension);
    score += w;
  }
  return score;
}

function candidateBusinessText(candidate) {
  return [
    candidate.humanName,
    ...(candidate.synonyms || []),
    ...(candidate.answerableQuestions || []),
    candidate.domain,
    ...(candidate.bindings || []).flatMap((binding) => [
      binding.measureName, binding.displayCaption,
    ]),
  ].filter(Boolean).join(" ");
}

function anchorMatches(candidate, intentFrame) {
  const wanted = new Set((intentFrame?.concepts || []).map((value) => String(value).trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return [];
  const candidateText = candidateBusinessText(candidate);
  const parsed = buildIntentFrame({ question: candidateText }).concepts;
  const matches = parsed.filter((concept) => wanted.has(concept));
  const candidateTerms = termSet(candidateText);
  for (const concept of wanted) {
    const conceptTerms = unigrams(concept).filter((term) => !isGenericTerm(term));
    if (!matches.includes(concept) && conceptTerms.some((term) => candidateTerms.has(term))) matches.push(concept);
  }
  return matches;
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sourceLabelMatches(needle, values) {
  const wanted = normalized(needle);
  return wanted && values.some((value) => {
    const actual = normalized(value);
    if (!actual) return false;
    if (/^\d+$/.test(actual) && /^\d+$/.test(wanted)) return actual === wanted;
    return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
  });
}

function matchesExplicitSource(binding, intentFrame) {
  return (intentFrame?.sourceConstraints || []).some((constraint) => {
    const values = constraint?.type === "dashboard"
      ? [binding.dashboardId, binding.dashboardName]
      : [binding.reportId, binding.dashboardName, binding.semanticModel];
    return sourceLabelMatches(constraint?.value, values);
  });
}

function sourcePriority(binding, intentFrame, preferredDashboardIds) {
  const explicitSource = matchesExplicitSource(binding, intentFrame);
  const preferred = new Set((preferredDashboardIds || []).map((id) => String(id)));
  const contextSources = intentFrame?.contextSources || intentFrame?.context?.sources || [];
  const contextSource = contextSources.some((source) => {
    if (!source || typeof source !== "object") {
      return sourceLabelMatches(source, [binding.bindingId, binding.dashboardId, binding.reportId]);
    }
    return sourceLabelMatches(source.bindingId, [binding.bindingId])
      || sourceLabelMatches(source.dashboardId, [binding.dashboardId])
      || sourceLabelMatches(source.reportId, [binding.reportId])
      || sourceLabelMatches(source.semanticModel, [binding.semanticModel]);
  });
  const preferredDashboard = binding.dashboardId != null && preferred.has(String(binding.dashboardId));
  return explicitSource ? 300 : contextSource ? 200 : preferredDashboard ? 100 : 0;
}

// ── Loader library ──────────────────────────────────────────────────────────
function aclAllows(binding, allowedSet) {
  if (!allowedSet) return true;                          // centralized
  if (binding.dashboardId == null) return false;         // web: fail closed tanpa asosiasi dashboard
  return allowedSet.has(Number(binding.dashboardId));
}

// Bentuk binding kaya yang dikonsumsi router/planner/builder/synthesis. SATU
// pemetaan supaya kedua loader (candidate & follow-up) konsisten. bindingId =
// id DB (identitas stabil); bindingKey = binding_key. dateTable/dateColumn/
// dateLogic wajib ada agar builder bisa membangun filter periode.
function mapBindingRow(b) {
  const binding = {
    bindingId: b.id,
    bindingKey: b.binding_key,
    dashboardId: b.dashboard_id,
    dashboardName: b.dashboard_name,
    reportId: b.report_id,
    pageName: b.page_name,
    visualTitle: b.visual_title,
    semanticModel: b.semantic_model,
    tableName: b.table_name,
    measureName: b.measure_name,
    displayCaption: b.display_caption,
    dimensions: b.dimensions_json || [],
    dateTable: b.date_table,
    dateColumn: b.date_column,
    dateLogic: b.date_logic,
    verificationStatus: b.verification_status,
  };
  return { ...binding, blueprint: buildVisualBlueprint(binding) };
}

async function loadLibraryCandidates(allowedDashboardIds) {
  const [kpis] = await pool.query(
    `SELECT id, slug, human_name, synonyms_json, answerable_questions_json,
            domain, definition, unit, number_format, status
       FROM cia_kpis`);
  if (!kpis.length) return null; // kosong -> caller fallback

  const [bindings] = await pool.query(
    `SELECT b.id, b.binding_key, b.kpi_id, b.dashboard_id, b.report_id,
            b.page_name, b.visual_title,
            b.semantic_model, b.table_name, b.measure_name, b.display_caption,
            b.dimensions_json, b.date_table, b.date_column, b.date_logic,
            b.verification_status, d.title AS dashboard_name
       FROM cia_kpi_bindings b
       LEFT JOIN dashboards d ON d.id = b.dashboard_id
      WHERE b.verification_status IN ('discovered','confirmed')`);

  const allowedSet = Array.isArray(allowedDashboardIds)
    ? new Set(allowedDashboardIds.map(Number)) : null;

  const byKpi = new Map();
  for (const b of bindings) {
    if (!aclAllows({ dashboardId: b.dashboard_id }, allowedSet)) continue;
    if (!byKpi.has(b.kpi_id)) byKpi.set(b.kpi_id, []);
    byKpi.get(b.kpi_id).push(mapBindingRow(b));
  }

  const candidates = [];
  for (const k of kpis) {
    const kpiBindings = byKpi.get(k.id) || [];
    // Hanya jadi kandidat bila ada binding aktif yang boleh diakses (model-level
    // atau dashboard dalam ACL). Ini mencegah KPI yang buktinya HANYA dashboard
    // di luar ACL ikut muncul.
    if (!kpiBindings.length) continue;
    candidates.push({
      kpiId: k.id,
      slug: k.slug,
      humanName: k.human_name,
      synonyms: k.synonyms_json || [],
      answerableQuestions: k.answerable_questions_json || [],
      domain: k.domain,
      definition: k.definition || "",
      unit: k.unit,
      numberFormat: k.number_format,
      status: k.status,
      bindings: kpiBindings,
    });
  }
  return candidates;
}

function catalogCandidates() {
  return KATALOG_KPI.map((entry, i) => ({
    kpiId: null,
    slug: `catalog-${i}`,
    humanName: entry.kpi,
    synonyms: Array.isArray(entry.measures) ? entry.measures : [],
    answerableQuestions: [],
    domain: entry.domain || null,
    unit: entry.unit || null,
    numberFormat: null,
    status: "catalog",
    bindings: (entry.measures || []).map((m) => ({
      dashboardId: null, dashboardName: null,
      semanticModel: entry.modelName || null, measureName: m, dimensions: [],
      verificationStatus: "catalog",
    })),
  }));
}

async function resolveCandidatePool(allowedDashboardIds) {
  // Catalog lama tidak punya dashboardId, jadi tidak bisa dibuktikan masuk ACL
  // user web. Hanya surface centralized yang boleh menggunakannya.
  const safeCatalog = () => Array.isArray(allowedDashboardIds) ? [] : catalogCandidates();
  if (!libraryEnabled()) {
    warnFallbackOnce("flag CIA_KPI_LIBRARY_ENABLED != true");
    return { pool: safeCatalog(), source: "catalog" };
  }
  try {
    const lib = await loadLibraryCandidates(allowedDashboardIds);
    if (!lib || lib.length === 0) {
      warnFallbackOnce("library kosong");
      return { pool: safeCatalog(), source: "catalog" };
    }
    return { pool: lib, source: "library" };
  } catch (err) {
    warnFallbackOnce(`tabel library tidak tersedia (${err?.code || err?.message})`);
    return { pool: safeCatalog(), source: "catalog" };
  }
}

// ── API publik ──────────────────────────────────────────────────────────────
export async function searchKpiCandidates({
  question, intentFrame = {}, allowedDashboardIds = null, preferredDashboardIds = [], limit = 10,
} = {}) {
  const questionTerms = [...termSet(question)];
  const { pool: candidatePool } = await resolveCandidatePool(allowedDashboardIds);
  const concepts = Array.isArray(intentFrame.concepts) ? intentFrame.concepts.map(normalized).filter(Boolean) : [];
  const hasExplicitSource = (intentFrame.sourceConstraints || [])
    .some((constraint) => normalized(constraint?.value));

  const scored = candidatePool
    .map((candidate) => {
      const matches = anchorMatches(candidate, intentFrame);
      const bindings = candidate.bindings.map((binding) => ({
        ...binding,
        sourcePriority: sourcePriority(binding, intentFrame, preferredDashboardIds),
      })).filter((binding) => !hasExplicitSource || binding.sourcePriority === 300)
        .sort((left, right) => right.sourcePriority - left.sourcePriority);
      return {
        ...candidate,
        bindings,
        anchorMatches: matches,
        sourcePriority: Math.max(0, ...bindings.map((binding) => binding.sourcePriority)),
        score: scoreCandidate(candidate, questionTerms),
      };
    })
    .filter((candidate) => candidate.bindings.length && candidate.score > 0
      && (!concepts.length || candidate.anchorMatches.some((value) => concepts.includes(value))))
    .sort((left, right) => right.sourcePriority - left.sourcePriority || right.score - left.score);

  return scored.slice(0, Math.max(1, Math.min(Number(limit) || 10, 100)));
}

export async function getBindingsForKpis(kpiIds, allowedDashboardIds = null) {
  if (!Array.isArray(kpiIds) || !kpiIds.length) return [];
  const ids = kpiIds.map(Number).filter((n) => Number.isInteger(n));
  if (!ids.length) return [];
  const [rows] = await pool.query(
    `SELECT b.id, b.binding_key, b.kpi_id, b.dashboard_id, b.report_id,
            b.page_name, b.visual_title,
            b.semantic_model, b.table_name, b.measure_name, b.display_caption,
            b.dimensions_json, b.date_table, b.date_column, b.date_logic,
            b.verification_status, d.title AS dashboard_name,
            k.human_name, k.definition, k.unit, k.number_format
       FROM cia_kpi_bindings b
       LEFT JOIN dashboards d ON d.id = b.dashboard_id
       JOIN cia_kpis k ON k.id = b.kpi_id
      WHERE b.kpi_id IN (${ids.map(() => "?").join(",")})
        AND b.verification_status IN ('discovered','confirmed')`,
    ids
  );
  const allowedSet = Array.isArray(allowedDashboardIds) ? new Set(allowedDashboardIds.map(Number)) : null;
  return rows
    .filter((b) => aclAllows({ dashboardId: b.dashboard_id }, allowedSet))
    .map((b) => ({
      ...mapBindingRow(b),
      kpiId: b.kpi_id,
      humanName: b.human_name,
      definition: b.definition || "",
      unit: b.unit,
      numberFormat: b.number_format,
    }));
}

export async function getDashboardVocabulary(dashboardIds) {
  if (!Array.isArray(dashboardIds) || !dashboardIds.length) return {};
  const ids = dashboardIds.map(Number).filter((n) => Number.isInteger(n));
  if (!ids.length) return {};
  const [rows] = await pool.query(
    `SELECT b.dashboard_id, b.measure_name, b.dimensions_json, k.human_name
       FROM cia_kpi_bindings b JOIN cia_kpis k ON k.id = b.kpi_id
      WHERE b.dashboard_id IN (${ids.map(() => "?").join(",")})
        AND b.verification_status IN ('discovered','confirmed')`,
    ids
  );
  const out = {};
  for (const r of rows) {
    const key = Number(r.dashboard_id);
    if (!out[key]) out[key] = { measures: new Set(), dimensions: new Set(), kpis: new Set() };
    if (r.measure_name) out[key].measures.add(r.measure_name);
    for (const d of (r.dimensions_json || [])) { const t = dimText(d); if (t) out[key].dimensions.add(t); }
    if (r.human_name) out[key].kpis.add(r.human_name);
  }
  const result = {};
  for (const [k, v] of Object.entries(out)) {
    result[k] = { measures: [...v.measures], dimensions: [...v.dimensions], kpis: [...v.kpis] };
  }
  return result;
}

export async function readKpiLibraryStatus() {
  const enabled = libraryEnabled();
  if (!enabled) return { enabled, usingLibrary: false, source: "catalog", kpiCount: 0 };
  try {
    const [rows] = await pool.query("SELECT COUNT(*) AS n FROM cia_kpis");
    const kpiCount = Number(rows[0].n) || 0;
    const usingLibrary = kpiCount > 0;
    return { enabled, usingLibrary, source: usingLibrary ? "library" : "catalog", kpiCount };
  } catch (err) {
    return { enabled, usingLibrary: false, source: "catalog", kpiCount: 0, error: err?.code || "UNAVAILABLE" };
  }
}
