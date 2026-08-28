import { tanyaModelTerstruktur } from "../modelRouter.js";

const MAX_ROWS_PER_SOURCE = 20;
const clean = (value, limit = 4_000) => typeof value === "string" ? value.trim().slice(0, limit) : "";

function periodText(period) {
  if (!period) return "periode tidak diketahui";
  if (typeof period === "string") return clean(period, 120);
  if (period.from && period.to) return `${period.from} sampai ${period.to}`;
  return clean(period.label, 120) || "periode tidak diketahui";
}

function liveSources(evidence) {
  return (Array.isArray(evidence) ? evidence : []).filter((item) => item?.status === "success"
    && Array.isArray(item.rows) && item.rows.length).map((item) => ({
    kind: "live_dax",
    dashboardId: item.source?.dashboardId ?? null,
    dashboardName: clean(item.source?.dashboardName, 150) || "Dashboard Power BI",
    semanticModel: clean(item.source?.semanticModel, 150) || null,
    period: periodText(item.period),
    kpis: Array.isArray(item.source?.kpis) ? item.source.kpis.map((value) => clean(value, 100)).filter(Boolean) : [],
    rows: item.rows.slice(0, MAX_ROWS_PER_SOURCE),
    rowCount: Number(item.rowCount) || item.rows.length,
  }));
}

function snapshotSources(snapshot) {
  const text = clean(snapshot?.text, 6_000);
  if (!text) return [];
  const dashboards = Array.isArray(snapshot?.dashboards) && snapshot.dashboards.length
    ? snapshot.dashboards : [{ id: null, name: "Snapshot dashboard" }];
  return dashboards.slice(0, 10).map((dashboard) => ({
    kind: "snapshot",
    dashboardId: dashboard?.id == null ? null : String(dashboard.id),
    dashboardName: clean(dashboard?.name ?? dashboard?.title, 150) || "Snapshot dashboard",
    semanticModel: null,
    period: periodText(snapshot.period),
    kpis: [],
    rows: [{ Ringkasan: text }],
    rowCount: null,
  }));
}

function parseReply(text) {
  const raw = clean(text, 20_000);
  const body = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw)?.[1] || raw;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validCitationIndexes(value, sourceCount) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((index) => Number.isInteger(index)
    && index >= 0 && index < sourceCount))];
}

function correlationLanguage(answer, hasMechanism) {
  if (hasMechanism) return answer;
  return answer
    .replace(/\bdisebabkan\s+oleh\b/gi, "berkorelasi dengan")
    .replace(/\bkarena\b/gi, "berkorelasi dengan");
}

function citationText(indexes, sources) {
  if (!indexes.length) return "";
  return `Sumber: ${indexes.map((index) => {
    const source = sources[index];
    return `${source.dashboardName} (${source.period})`;
  }).join("; ")}.`;
}

function methodFor(liveCount, snapshotCount) {
  if (liveCount && snapshotCount) return "mixed";
  if (liveCount) return "live_dax";
  if (snapshotCount) return "snapshot";
  return "none";
}

function emptyResult(warnings = []) {
  return {
    answer: "Bukti data yang diperlukan belum tersedia, jadi CIA belum dapat memberikan analisis yang dapat dipertanggungjawabkan.",
    confidence: "low",
    retrievalMethod: "none",
    sources: [],
    warnings: [...new Set(warnings)],
    usage: null,
    provider: null,
    model: null,
  };
}

export async function synthesizeEvidence(input = {}, injected = {}) {
  const callModel = injected.callModel || tanyaModelTerstruktur;
  const live = liveSources(input.evidence);
  const snapshots = snapshotSources(input.snapshotFallback);
  const sources = [...live, ...snapshots];
  const retrievalMethod = methodFor(live.length, snapshots.length);
  const warnings = [...new Set((Array.isArray(input.warnings) ? input.warnings : [])
    .map((value) => clean(value, 100)).filter(Boolean))];
  if (snapshots.length) warnings.push("SNAPSHOT_FALLBACK_USED");
  if (!sources.length) return emptyResult(warnings);

  const packet = {
    question: clean(input.question, 1_000),
    rules: {
      citeOnlySourceIndexes: sources.map((_, index) => index),
      correlationIsNotCausation: true,
      useOnlyPacketValues: true,
    },
    sources,
  };

  let response;
  try {
    response = await callModel({
      ...(input.modelOptions || {}),
      systemInstruction: "Jawab dalam JSON saja: {answer:string,citedSourceIndexes:number[]}. Gunakan hanya bukti pada packet. Jangan menyatakan sebab-akibat dari korelasi.",
      question: JSON.stringify(packet),
      maxOutputTokens: 3_000,
    });
  } catch {
    const fallback = emptyResult([...warnings, "SYNTHESIS_FAILED"]);
    fallback.retrievalMethod = retrievalMethod;
    fallback.sources = sources;
    return fallback;
  }

  const parsed = parseReply(response?.text);
  if (!parsed || !clean(parsed.answer)) {
    const fallback = emptyResult([...warnings, "SYNTHESIS_INVALID_RESPONSE"]);
    fallback.retrievalMethod = retrievalMethod;
    fallback.sources = sources;
    fallback.usage = response?.usage || null;
    fallback.provider = response?.provider || null;
    fallback.model = response?.model || null;
    return fallback;
  }

  const requestedCitations = Array.isArray(parsed.citedSourceIndexes) ? parsed.citedSourceIndexes : [];
  const citations = validCitationIndexes(requestedCitations, sources.length);
  const invalidCitation = citations.length !== requestedCitations.length || citations.length === 0;
  if (invalidCitation) warnings.push("INVALID_SOURCE_CITATION");
  const hasMechanism = (Array.isArray(input.evidence) ? input.evidence : [])
    .some((item) => item?.causalMechanism === true);
  let answer = correlationLanguage(clean(parsed.answer), hasMechanism);
  const cited = citationText(citations, sources);
  if (cited) answer = `${answer}\n\n${cited}`;
  if (snapshots.length) {
    const scope = live.length ? "sebagian jawaban" : "jawaban ini";
    answer = `${answer}\n\nCatatan: ${scope} menggunakan data snapshot karena bukti live tidak tersedia atau belum cukup.`;
  }

  let confidence = "low";
  if (retrievalMethod === "live_dax") confidence = invalidCitation || warnings.length ? "medium" : "high";
  else if (retrievalMethod === "mixed") confidence = "medium";

  return {
    answer,
    confidence,
    retrievalMethod,
    sources: citations.map((index) => sources[index]),
    warnings: [...new Set(warnings)],
    usage: response?.usage || null,
    provider: response?.provider || null,
    model: response?.model || null,
  };
}

