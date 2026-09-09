export const DEFAULT_VOCABULARY = Object.freeze({
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

function normalize(value) {
  return typeof value === "string"
    ? value.normalize("NFKD").toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim()
    : "";
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

export function matchConcepts(question, vocabulary = DEFAULT_VOCABULARY) {
  return vocabularyEntries(vocabulary)
    .sort((left, right) => Math.max(...right.phrases.map((item) => item.length))
      - Math.max(...left.phrases.map((item) => item.length)))
    .filter((entry) => entry.phrases.some((phrase) => phraseMatches(question, phrase)))
    .map((entry) => entry.value);
}
