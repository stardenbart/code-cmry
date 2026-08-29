const DEFAULT_VOCABULARY = Object.freeze({
  concepts: [
    { value: "routine downtime", phrases: ["routine downtime"] },
    { value: "running hours", phrases: ["running hoursnya", "running hours", "running hour"] },
    { value: "overtime cost", phrases: ["biaya estimasi lembur", "cost per dept", "cost lembur"] },
    { value: "purchase order", phrases: ["purchase order", "fulfillment po", "total po", " po"] },
    { value: "production output", phrases: ["production output", "output produksi", "output"] },
    { value: "production", phrases: ["produksi", "production"] },
    { value: "downtime", phrases: ["downtime"] },
    { value: "deviation", phrases: ["deviasi", "deviation"] },
    { value: "overtime", phrases: ["overtime", "lembur"] },
    { value: "planning", phrases: ["planning", "rencana produksi"] },
  ],
});

const OPERATIONS = Object.freeze([
  ["comparison", ["bandingkan", "dibandingkan", "dibanding", "planning dan output", " versus ", " vs "]],
  ["ranking", ["tertinggi", "paling tinggi", "paling banyak", " top "]],
  ["breakdown", ["breakdown", "rincian", "detail", "pecahan", "rekap", "snapshot", "kategorinya", "kategori", "hari apa", "per hari", "per dept", " in detail"]],
  ["explanation", ["kenapa", "penyebab", "pemicu", "jelaskan", "jelasin", "masalahnya", "kendala", "analisa"]],
  ["calculation", ["berapa", "persen", "persentase", "achievement", "achivement", "totalnya"]],
]);

const MONTH_NAMES = "januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember";

function normalize(value) {
  return typeof value === "string"
    ? value.normalize("NFKD").toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim()
    : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function phraseMatches(text, phrase) {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(text);
}

function vocabularyEntries(vocabulary) {
  const concepts = vocabulary?.concepts ?? vocabulary;
  if (Array.isArray(concepts)) {
    return concepts.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = normalize(entry.value ?? entry.concept ?? entry.name);
      const phrases = Array.isArray(entry.phrases) ? entry.phrases : [entry.phrase, value];
      return value ? [{ value, phrases: phrases.map(normalize).filter(Boolean) }] : [];
    });
  }
  if (!concepts || typeof concepts !== "object") return [];
  return Object.entries(concepts).flatMap(([value, phrases]) => {
    const normalizedValue = normalize(value);
    const list = Array.isArray(phrases) ? phrases : [phrases, value];
    return normalizedValue ? [{ value: normalizedValue, phrases: list.map(normalize).filter(Boolean) }] : [];
  });
}

function matchConcepts(question, vocabulary) {
  return vocabularyEntries(vocabulary)
    .sort((left, right) => Math.max(...right.phrases.map((item) => item.length))
      - Math.max(...left.phrases.map((item) => item.length)))
    .filter((entry) => entry.phrases.some((phrase) => phraseMatches(question, phrase)))
    .map((entry) => entry.value);
}

function addEntities(out, type, regex, question, transform = (value) => value) {
  for (const match of question.matchAll(regex)) {
    const value = normalize(transform(match[1] || match[0], match));
    if (value) out.push({ type, value });
  }
}

function extractEntities(question) {
  const entities = [];
  addEntities(entities, "machine", /\b(tetra pak line\s+(\d+))\b/g, question);
  for (const match of question.matchAll(/\btetra pak line\s+\d+\s+dan\s+(\d+)\b/g)) {
    entities.push({ type: "machine", value: `tetra pak line ${match[1]}` });
  }
  addEntities(entities, "machine", /\b(serac blow moulding line\s+\d+(?:_sbl\d+)?)\b/g, question);
  addEntities(entities, "machine", /\b(serac line\s+\d+\s+cyd\s+\d+ml)\b/g, question);
  addEntities(entities, "machine", /\b(evergreen(?:\s+esl\s+\d+ml)?)\b/g, question);
  addEntities(entities, "machine", /\b(serac blow moulding)\b/g, question);
  addEntities(entities, "product", /\b(uht milk\s+\d+ml)\b/g, question);
  addEntities(entities, "plant", /\b(plant\s+[\p{L}]+)\b/gu, question);
  addEntities(entities, "cmd", /\b(cmd)\s?(\d+)\b/g, question, (_, match) => `cmd ${match?.[2] ?? ""}`);
  addEntities(entities, "date_range", new RegExp(`\\b(\\d{1,2}\\s*-\\s*\\d{1,2}\\s+(?:${MONTH_NAMES}))\\b`, "g"), question);
  addEntities(entities, "date", new RegExp(`\\b(?:(?:tanggal)\\s+)?(\\d{1,2}\\s+(?:${MONTH_NAMES}))\\b`, "g"), question);

  const seen = new Set();
  return entities.filter((entity) => {
    const key = `${entity.type}:${entity.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchOperations(question) {
  return OPERATIONS.filter(([, phrases]) => phrases.some((phrase) => phraseMatches(question, phrase)))
    .map(([operation]) => operation);
}

function extractSourceConstraints(question) {
  const match = /\b(dashboard|report)\s+([^,?.]+?)(?=\s+(?:saja|hanya|untuk|yang|produk)\b|[,?.]|$)/.exec(question);
  if (!match) return [];
  const type = normalize(match[1]);
  return unique(match[2].split(/\s+(?:dan|atau)\s+|\s*,\s*/).map(normalize))
    .map((value) => ({ type, value }));
}

function periodKinds(question) {
  const kinds = [];
  if (new RegExp(`\\b\\d{1,2}\\s*-\\s*\\d{1,2}\\s+(?:${MONTH_NAMES})\\b`).test(question)) kinds.push("explicit_range");
  if (new RegExp(`\\b(?:(?:tanggal)\\s+)?\\d{1,2}\\s+(?:${MONTH_NAMES})\\b`).test(question)) kinds.push("explicit_date");
  if (/\bhari ini\b/.test(question)) kinds.push("today");
  if (/\bkemarin\b/.test(question)) kinds.push("yesterday");
  if (/\b(?:minggu|week) ini\b/.test(question)) kinds.push("current_week");
  if (new RegExp(`\\b(?:bulan\\s+)?(?:${MONTH_NAMES})\\b`).test(question)) kinds.push("named_month");
  if (/\bini\b/.test(question) && !kinds.length) kinds.push("current");
  if (/\bnya saja\b/.test(question)) kinds.push("follow_up");
  return unique(kinds);
}

function classifyContinuity(question, conversation) {
  const hasConversation = Array.isArray(conversation) && conversation.some((turn) => normalize(turn?.text));
  if (!hasConversation) return "new_topic";
  if (matchOperations(question).includes("comparison")) return "comparison";
  if (matchOperations(question).includes("calculation")) return "calculation";
  if (/\b(?:detail|rincian|drill|in detail)\b/.test(question)) return "drill_down";
  return "refinement";
}

function uniqueIds(value) {
  return unique((Array.isArray(value) ? value : []).map((item) => String(item ?? "").trim()));
}

export function buildIntentFrame(input = {}, injected = {}) {
  const question = normalize(input.question);
  const vocabulary = injected.vocabulary || DEFAULT_VOCABULARY;
  return {
    question,
    concepts: matchConcepts(question, vocabulary),
    entities: extractEntities(question),
    operations: matchOperations(question),
    sourceConstraints: extractSourceConstraints(question),
    continuity: classifyContinuity(question, input.conversation),
    preferredDashboardIds: uniqueIds(input.preferredDashboardIds),
    periodKinds: periodKinds(question),
  };
}
