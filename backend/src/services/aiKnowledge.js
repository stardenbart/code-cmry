// ─────────────────────────────────────────────────────────────────────────────
// Domain knowledge pack for the AI assistant.
//
// Source: the `powerbi-enterprise-analyst` skill — a structural sweep of the
// "CMD - Plant Sentul" Power BI workspace (semantic models, KPI statuses,
// acronym collisions, RCA framework, executive answer template).
// Files live in backend/knowledge/powerbi-analyst/ and are loaded once at boot.
//
// Only the slices relevant to the dashboard being asked about are injected into
// the Gemini system prompt, so the prompt stays small and on-topic.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "..", "knowledge", "powerbi-analyst");

export const MAX_KNOWLEDGE_CHARS = Number(process.env.AI_MAX_KNOWLEDGE_CHARS ?? 22_000);

// CODE dashboard title → semantic model name(s) in the registry.
// Only for cases where plain token matching is not reliable.
const MODEL_ALIASES = {
  // Maintenance & downtime
  "oee & downtime": ["Maintenance Downtime", "Dashboard Daily Meeting untuk OEE"],
  "technical downtime report": ["Maintenance Downtime"],
  "technical downtime ors": ["Maintenance Downtime", "Dashboard Utility (Energy)"],
  "utility failure": ["Dashboard Utility Failure"],
  "sparepart management": ["Dashboard Sparepart Management"],
  "cost repair & maintenance": ["Expenses - Cost, Repair, and Maintenance"],
  "pm execution report": ["PM Execution Report"],          // PM Execution model not in the registry sweep
  "timeline project": ["Project Timeline DT"],

  // Production, losses & cost
  "losses report": ["Dashboard Efis & Losses", "Variance & Losses"],
  "output report": ["Dashboard PPIC", "Dashboard Efis & Losses"],
  "production output": ["Dashboard PPIC", "Dashboard Efis & Losses"],
  "variance & losses": ["Dashboard Efis & Losses", "Variance & Losses"],  // "Dashboard Variance" never connected
  "cost savings & initiatives report": ["Dashboard Data Room Cost"],
  cost: ["Dashboard Data Room Cost"],

  // Quality
  "nc & deviasi": ["Dashboard NC dan Deviasi"],
  "repetitive nc report": ["Repetitive NC"],
  "nc cost report": ["Dashboard NC dan Deviasi", "Dashboard Data Room Cost"],
  "nc man report": ["Dashboard Lembur Plant"],
  "pyschem report": ["Pyschem"],
  "pqr report cmd 1": ["Pyschem"],
  "pqr report cmd 2": ["Dashboard PQR CMD 2"],
  "pqr report cmd 3 filling": [],
  "pqr report cmd 3 process": [],
  "pqr report cmd 3 bossar & tunnel": [],
  "pqr lab micro": ["Dashboard PQR Mikro"],
  "instrument calibration": ["Dashboard Kalibrasi Instrument"],
  quality: ["Dashboard Data Room Quality"],

  // Dairy service / PPIC
  "fresh milk report": ["Dashboard PPIC-DS"],
  "fresh milk incoming": ["Dashboard PPIC-DS"],
  "fresh milk receiving": ["Dashboard PPIC-DS"],
  "service level": ["Dashboard Data Room Service Level"],

  // Energy & sustainability
  "utility energy": ["Dashboard Utility (Energy)"],
  "wwtp report": ["Dashboard WWTP"],
  "safety & sustainability": ["Dashboard Data Room Safety & Sustainability"],

  // Inventory & warehouse
  "inventory control": ["Dashboard Inventory Control"],
  "inventory accuracy": ["Dashboard Inventory Accuracy"],
  "cycle time": ["Dashboard Cycle Time"],
  "appsheet cycle time": ["Dashboard Cycle Time"],
  "warehouse utilization": [],        // known: fails to connect under this name

  // HR
  "overtime report": ["Dashboard Overtime", "Dashboard Lembur Plant"],
  "overtime planning": ["Dashboard Overtime", "Dashboard Lembur Plant"],
  "appsheet seal tracking": [],       // no semantic model discovered
};

const RCA_TRIGGERS = [
  "why", "kenapa", "mengapa", "root cause", "akar masalah", "penyebab",
  "naik", "turun", "meningkat", "menurun", "abnormal", "anomali", "deviasi",
  "reject", "downtime", "loss", "losses", "failure", "gagal", "masalah",
  "drop", "spike", "lonjakan", "analisa", "analisis",
];

const STOP_WORDS = new Set([
  "dashboard", "report", "laporan", "db", "data", "room", "the", "and", "dan",
  "of", "per", "plant", "cmd",
]);

// ── File loading ─────────────────────────────────────────────────────────────

const cache = {};

function read(file) {
  if (cache[file] !== undefined) return cache[file];
  try {
    cache[file] = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), "utf8");
  } catch {
    console.warn(`[AI] Knowledge file missing: ${file}`);
    cache[file] = "";
  }
  return cache[file];
}

export function isKnowledgeAvailable() {
  return fs.existsSync(path.join(KNOWLEDGE_DIR, "semantic-model-registry.md"));
}

// ── Section helpers ──────────────────────────────────────────────────────────

/** Splits a markdown doc into { heading, body } blocks at the given level. */
function splitSections(md, level = 3) {
  const marker = `${"#".repeat(level)} `;
  const lines = md.split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith(marker) && !line.startsWith(`${marker}#`)) {
      if (current) sections.push(current);
      current = { heading: line.slice(marker.length).trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  return sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() }));
}

/** Extracts one `## <name>` section (heading included) from a markdown doc. */
function extractSection(md, headingStartsWith, level = 2) {
  const marker = `${"#".repeat(level)} `;
  const lines = md.split("\n");
  const out = [];
  let inside = false;

  for (const line of lines) {
    if (line.startsWith(marker)) {
      if (inside) break;
      if (line.slice(marker.length).toLowerCase().startsWith(headingStartsWith.toLowerCase())) {
        inside = true;
      }
    }
    if (inside) out.push(line);
  }
  return out.join("\n").trim();
}

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[()\-–—_,.]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s) =>
  normalize(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

// ── Model matching ───────────────────────────────────────────────────────────

/**
 * Finds the registry section(s) most likely describing the semantic model
 * behind a CODE dashboard.
 */
export function matchModels(dashboardTitle, department) {
  const registry = read("semantic-model-registry.md");
  if (!registry) return [];

  const sections = splitSections(registry, 3);
  const key = normalize(dashboardTitle);

  // 1) Explicit alias
  const aliasKey = Object.keys(MODEL_ALIASES).find((k) => normalize(k) === key);
  if (aliasKey) {
    const wanted = MODEL_ALIASES[aliasKey].map(normalize);
    // Score exact heading matches above prefix/substring ones, so an alias of
    // "Dashboard PPIC" does not drag in "Dashboard PPIC-DS" as an equal.
    const hits = sections
      .map((s) => {
        const h = normalize(s.heading).replace(/\s*\*?\(.*$/, "").trim();
        let score = 0;
        for (const w of wanted) {
          if (h === w) score = Math.max(score, 3);
          else if (h.startsWith(w)) score = Math.max(score, 2);
          else if (h.includes(w)) score = Math.max(score, 1);
        }
        return { ...s, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (hits.length || MODEL_ALIASES[aliasKey].length === 0) return hits;
  }

  // 2) Token overlap scoring against model headings
  const qTokens = tokens(`${dashboardTitle} ${department || ""}`);
  if (!qTokens.length) return [];

  const scored = sections
    .map((s) => {
      const hTokens = tokens(s.heading);
      const overlap = qTokens.filter((t) => hTokens.includes(t)).length;
      const coverage = hTokens.length ? overlap / hTokens.length : 0;
      return { ...s, score: overlap + coverage };
    })
    .filter((s) => s.score >= 1)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 2);
}

/**
 * True when the dashboard's model is on the registry's "failed to connect" list,
 * i.e. its internal structure was never discovered.
 */
export function isUnmappedModel(dashboardTitle) {
  const registry = read("semantic-model-registry.md");
  const block = registry.match(/### Models that FAILED to connect[^\n]*\n([\s\S]*?)\n\n/);
  if (!block) return false;
  const t = normalize(dashboardTitle);
  if (t.length < 5) return false;
  return block[1]
    .split(/[,.]/)
    .map(normalize)
    .some((name) => name.length > 4 && (name.includes(t) || t.includes(name)));
}

// ── KPI dictionary slicing ───────────────────────────────────────────────────

function kpiRowsFor(modelHeadings, question) {
  const kpi = read("kpi-dictionary.md");
  if (!kpi) return "";

  const wanted = modelHeadings.map(normalize);
  const qTokens = tokens(question);

  const rows = kpi
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-+/.test(line.trim()))
    .filter((line) => {
      const n = normalize(line);
      if (wanted.some((w) => w && n.includes(w))) return true;
      // also keep rows whose KPI name matches question keywords
      const kpiName = normalize(line.split("|")[1] || "");
      return qTokens.some((t) => kpiName.includes(t));
    });

  if (!rows.length) return "";

  return [
    "| KPI | Model | Type | Meaning | Status |",
    "|---|---|---|---|---|",
    ...rows.slice(0, 20),
  ].join("\n");
}

/**
 * Every KPI row from the dictionary, for the navigator's glossary.
 * Blocked KPIs are excluded — an assistant that cannot see data has no way to
 * disambiguate competing measure versions, so quoting them would mislead.
 */
export function getGlossaryRows(limit = 40) {
  const kpi = read("kpi-dictionary.md");
  if (!kpi) return "";

  const rows = kpi
    .split("\n")
    .filter((line) => {
      const l = line.trim();
      if (!l.startsWith("|") || /^\|\s*-+/.test(l)) return false;
      if (/^\|\s*KPI\s*\|/i.test(l)) return false;              // header rows
      return /\[(Confirmed|Needs confirmation)\]/.test(l);
    })
    .map((line) => {
      // Keep name | model | meaning | status; drop the "Type" column as noise
      const cells = line.split("|").map((c) => c.trim());
      const [, name, model, , meaning, status] = cells;
      return `- ${name}: ${meaning} (model: ${model}) ${status}`;
    })
    .slice(0, limit);

  return rows.join("\n");
}

// ── Public: build the knowledge block for one question ───────────────────────

/** Drops the "Flags:" paragraphs — internal modelling debt notes, not business context. */
function withoutFlags(text) {
  return text
    .split("\n")
    .filter((line) => !/^Flags?:/i.test(line.trim()))
    .join("\n");
}

/** Keeps only acronym rows whose acronym actually appears in this request. */
function relevantAcronyms(table, haystack) {
  const lines = table.split("\n");
  const kept = lines.filter((line, i) => {
    if (i < 3 || !line.trim().startsWith("|")) return true;   // heading + header rows
    const acronym = (line.split("|")[1] || "").trim();
    if (!acronym) return false;
    return new RegExp(`\\b${acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack);
  });
  // Nothing matched → the whole table is noise for this question
  return kept.length > 3 ? kept.join("\n") : "";
}

/**
 * @param {object} opts
 * @param {string} opts.dashboardTitle
 * @param {string} opts.department
 * @param {string} opts.question
 * @param {string} [opts.tier]      "cepat" trims aggressively; see plan §7
 * @param {string} [opts.dataText]  rendered snapshot, used to keep only relevant legends
 * @returns {{ text: string, models: string[], rcaTriggered: boolean }}
 */
export function buildKnowledgeBlock({ dashboardTitle, department, question, tier = "standar", dataText = "" }) {
  if (!isKnowledgeAvailable()) {
    return { text: "", models: [], rcaTriggered: false };
  }

  const matched = matchModels(dashboardTitle, department);
  const modelNames = matched.map((m) => m.heading.replace(/\*\(.*?\)\*/g, "").trim());
  const q = normalize(question);
  const rcaTriggered = RCA_TRIGGERS.some((t) => q.includes(t));

  const parts = [];

  parts.push("=== DOMAIN KNOWLEDGE: CMD PLANT SENTUL (workspace Power BI) ===");
  parts.push(
    "Sumber: hasil discovery struktural semantic model workspace `CMD - Plant Sentul` (snapshot 2026-07-20). Gunakan ini untuk memahami istilah, KPI, dan konteks bisnis — BUKAN sebagai sumber angka. Angka hanya dari DATA SNAPSHOT."
  );

  const lean = tier === "cepat";
  const haystack = `${question} ${dataText}`;

  // 1) Semantic model context for this dashboard
  if (matched.length) {
    parts.push("");
    parts.push("--- SEMANTIC MODEL YANG MENOPANG DASHBOARD INI ---");
    // "Flags:" lines document modelling debt — useful for an analyst, dead weight
    // for a lookup question.
    matched.forEach((m) => parts.push(lean ? withoutFlags(m.text) : m.text));
    if (matched.length > 1) {
      parts.push(
        "(CATATAN ROUTING: ada lebih dari satu model kandidat untuk dashboard ini — sebutkan asumsi model yang kamu pakai kalau relevan.)"
      );
    }
  } else {
    parts.push("");
    parts.push(
      "--- SEMANTIC MODEL: tidak ada entry registry yang cocok untuk dashboard ini. Jangan mengarang nama tabel/measure; jelaskan hanya dari data snapshot. ---"
    );
  }

  // 2) KPI status rows (Confirmed / Needs confirmation / Blocked)
  const kpiRows = kpiRowsFor(modelNames, question);
  if (kpiRows) {
    parts.push("");
    parts.push("--- STATUS KPI TERKAIT ([Confirmed] aman dipakai, [Needs confirmation] sebutkan asumsinya, [Blocked] jangan pilih sendiri — surface ambiguitasnya) ---");
    parts.push(kpiRows);
  }

  // 3) Acronym collisions — kept always, but trimmed to acronyms in play.
  // The PM / DT collisions are a genuine wrong-answer risk, so never drop wholesale.
  const acronyms = extractSection(read("data-dictionary.md"), "Acronym disambiguation");
  if (acronyms) {
    const table = lean ? relevantAcronyms(acronyms, haystack) : acronyms;
    if (table) {
      parts.push("");
      parts.push(table);
    } else {
      parts.push("");
      parts.push("(Ingat: PM bisa berarti Packaging Material atau Preventive Maintenance, DT bisa Downtime atau Digital Transformation — tentukan dari konteks dashboard ini.)");
    }
  }

  // Measure-name legend only matters when such names actually appear
  const prefixLegend = extractSection(read("data-dictionary.md"), "Measure name prefix");
  const legendRelevant = !lean || /\((M|N|alt\d?|br|ket|CARD)\)|\bNw \b|\bNEW\b|\(HIST\)|\(RT\)|ver[234]|\(\+batch\)/.test(haystack);
  if (prefixLegend && legendRelevant) {
    parts.push("");
    parts.push(prefixLegend);
  }

  // 4) RCA framework — only for investigative questions
  if (rcaTriggered) {
    parts.push("");
    parts.push("--- KERANGKA ROOT CAUSE ANALYSIS (pakai sesuai bobot masalah, sebutkan level yang dipakai + confidence) ---");
    parts.push(read("rca-framework.md"));
  }

  // 5) Executive answer template — a lookup question does not need
  // Ringkasan/RCA/Rekomendasi/Asumsi scaffolding
  if (!lean) {
    const template = read("analysis-templates.md");
    if (template) {
      parts.push("");
      parts.push("--- FORMAT JAWABAN EKSEKUTIF (audiens: Plant Manager ke atas) ---");
      parts.push(template);
    }
  }

  let text = parts.join("\n");
  if (text.length > MAX_KNOWLEDGE_CHARS) {
    text = `${text.slice(0, MAX_KNOWLEDGE_CHARS)}\n(knowledge dipotong karena batas ukuran)`;
  }

  return { text, models: modelNames, rcaTriggered };
}
