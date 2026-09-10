import { tanyaModelTerstruktur } from "../modelRouter.js";
import { classifyColumn, getSanitizer } from "../aiSanitizer.js";
import { humanizeIdentifier, humanizeTechnicalText } from "../ciaHumanLabels.service.js";

const MAX_ROWS_PER_SOURCE = 20;
const clean = (value, limit = 4_000) => typeof value === "string" ? value.trim().slice(0, limit) : "";

function periodText(period) {
  if (!period) return "periode tidak diketahui";
  if (typeof period === "string") return clean(period, 120);
  if (period.from && period.to) return `${period.from} sampai ${period.to}`;
  return clean(period.label, 120) || "periode tidak diketahui";
}

function sanitizeLiveRows(rows, sanitizer) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  if (!columns.length) return [];
  const keptIndexes = columns.map((column, index) => ({ column, index, kind: classifyColumn(column) }))
    .filter((item) => item.kind !== "drop");
  const visual = sanitizer.sanitizeSnapshot({
    visuals: [{ columns, rows: rows.map((row) => columns.map((column) => row?.[column])) }],
  })?.visuals?.[0];
  // Money columns in "relative" mode are rewritten by sanitizeSnapshot into a
  // share-of-total percentage (e.g. "23.4%") — a deliberately different value,
  // not a formatting change. Restoring the raw numeric original for those
  // cells would silently undo that relativization, so they are excluded from
  // the numeric-preserve below and always take the sanitized cell.
  const relativizedMoney = sanitizer.moneyMode === "relative";
  return (visual?.rows || []).map((cells, rowIndex) => Object.fromEntries(
    (visual.columns || []).map((column, outputIndex) => {
      const kept = keptIndexes[outputIndex];
      const original = rows[rowIndex]?.[kept?.column];
      const isRelativizedMoney = relativizedMoney && kept?.kind === "money";
      const preserve = !isRelativizedMoney
        && (typeof original === "number" || typeof original === "boolean" || original == null);
      return [column, preserve ? original : cells[outputIndex]];
    }),
  ));
}

const ENTITY_COLUMNS = {
  machine: /machine|mesin/i,
  cmd: /cmd|gedung/i,
  product: /product|produk/i,
  plant: /plant/i,
};

function entityTokens(value) {
  return String(value ?? "").normalize("NFKD").toLocaleLowerCase("id-ID")
    .replace(/([\p{L}])(\d)/gu, "$1 $2").replace(/(\d)([\p{L}])/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
}

function entityValueMatches(left, right) {
  const actual = entityTokens(left);
  const wanted = entityTokens(right);
  const contains = (values, subset) => subset.length > 0 && values.some((_, index) =>
    subset.every((token, offset) => values[index + offset] === token));
  return contains(actual, wanted) || contains(wanted, actual);
}

function rowsForEntities(rows, entities) {
  const groups = new Map();
  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!ENTITY_COLUMNS[entity?.type] || !String(entity?.value ?? "").trim()) continue;
    if (!groups.has(entity.type)) groups.set(entity.type, []);
    groups.get(entity.type).push(entity.value);
  }
  let filtered = rows;
  for (const [type, values] of groups) {
    const pattern = ENTITY_COLUMNS[type];
    const hasDimension = rows.some((row) => Object.keys(row || {}).some((label) => pattern.test(label)));
    if (!hasDimension) continue;
    filtered = filtered.filter((row) => Object.entries(row || {}).some(([label, value]) =>
      pattern.test(label) && values.some((wanted) => entityValueMatches(value, wanted))));
  }
  return filtered;
}

function liveSources(evidence, question = "", sanitizer = getSanitizer(), entities = []) {
  const ranking = /\b(top\s+\d+|tertinggi|terendah|terbesar|terkecil)\b/i.test(String(question));
  const sources = (Array.isArray(evidence) ? evidence : []).filter((item) => item?.status === "success"
    && Array.isArray(item.rows) && item.rows.length).map((item) => {
    const configuredLabels = new Map((Array.isArray(item.columns) ? item.columns : [])
      .flatMap((column) => column?.key
        ? [[String(column.key), humanLabel(column.label || column.key, true)]] : []));
    const rows = item.rows.map((row) => Object.fromEntries(Object.entries(row || {})
      .map(([label, value]) => [configuredLabels.get(label) || humanLabel(label),
        typeof value === "string" ? decodeText(value) : value])));
    const safeRows = sanitizeLiveRows(rowsForEntities(rows, entities), sanitizer);
    return {
    kind: "live_dax",
    dashboardId: item.source?.dashboardId ?? null,
    dashboardName: clean(item.source?.dashboardName, 150) || "Dashboard Power BI",
    semanticModel: clean(item.source?.semanticModel, 150) || null,
    period: periodText(item.period),
    kpis: Array.isArray(item.source?.kpis) ? item.source.kpis.map((value) => clean(value, 100)).filter(Boolean) : [],
    rows: (ranking ? distinctRows(safeRows, requestedRowLimit(question), question) : safeRows)
      .slice(0, MAX_ROWS_PER_SOURCE),
    rowCount: safeRows.length,
  };
  });
  const unique = new Map();
  for (const source of sources) {
    const key = [source.semanticModel, source.dashboardName, source.period, [...source.kpis].sort().join("|")]
      .map((value) => String(value ?? "").trim().toLowerCase()).join("::");
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, source);
      continue;
    }
    const rows = [...existing.rows, ...source.rows];
    existing.rows = [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()]
      .slice(0, MAX_ROWS_PER_SOURCE);
    existing.rowCount = Math.max(existing.rowCount || 0, source.rowCount || 0, existing.rows.length);
  }
  return [...unique.values()].slice(0, 6);
}

function safeModelText(value, sanitizer, limit) {
  return humanizeTechnicalText(sanitizer.sanitizeText(clean(value, limit)));
}

function snapshotSources(snapshot, sanitizer) {
  const dashboards = Array.isArray(snapshot?.dashboards) && snapshot.dashboards.length
    ? snapshot.dashboards : [{ id: null, name: "Snapshot dashboard" }];
  const perDashboard = dashboards.slice(0, 10).flatMap((dashboard) => {
    const text = safeModelText(dashboard?.text, sanitizer, 6_000);
    return text ? [{ dashboard, text }] : [];
  });
  const shared = safeModelText(snapshot?.text, sanitizer, 6_000);
  const entries = perDashboard.length
    ? perDashboard
    : shared
      ? dashboards.length === 1
        ? [{ dashboard: dashboards[0], text: shared }]
        : [{ dashboard: { id: null, name: "Snapshot multi-dashboard" }, text: shared }]
      : [];
  return entries.map(({ dashboard, text }) => ({
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
    .replace(/\bmenyebabkan\b/gi, "berkorelasi dengan")
    .replace(/\bmemicu\b/gi, "berkorelasi dengan")
    .replace(/\bakibat\b/gi, "berkorelasi dengan")
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

function matchesIntent(item) {
  const match = item?.intentMatch;
  return !match || ["concepts", "entities", "period", "source"].every((key) => match[key] !== false);
}

function relevanceFailure(evidence, warnings) {
  const labels = { concepts: "metrik bisnis", entities: "entitas", period: "periode", source: "sumber dashboard" };
  const mismatches = [...new Set(evidence.flatMap((item) => Object.entries(item?.intentMatch || {})
    .filter(([, matched]) => matched === false).map(([key]) => labels[key]).filter(Boolean)))];
  return {
    ...emptyResult([...warnings, "EVIDENCE_RELEVANCE_MISMATCH"]),
    answer: `Bukti yang ditemukan tidak cocok dengan ${mismatches.join(", ") || "intent pertanyaan"} yang diminta. CIA tidak akan menggantinya dengan data lain.`,
  };
}

function displayValue(value) {
  if (value == null) return "-";
  if (typeof value === "number") return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  return decodeText(clean(String(value), 300));
}

function decodeText(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'");
}

function humanLabel(label, configured = false) {
  const raw = String(label || "").trim();
  const qualified = /\[([^\]]+)\]\s*$/.exec(raw);
  const field = qualified?.[1] || raw;
  const normalized = field.toLowerCase().replace(/[\s_-]+/g, " ");
  if (/^nama mesin$|^machine name$|^mesin$/.test(normalized)) return "Mesin";
  if (/^issue$|^masalah$/.test(normalized)) return "Masalah";
  if (/^action$|^tindakan$/.test(normalized)) return "Tindakan";
  if (/^gedung$|^cmd( \/ gedung)?$/.test(normalized)) return "CMD / Gedung";
  if (/top mesin downtime|durasi downtime|downtime.*tertinggi/.test(normalized)) return "Durasi downtime";
  if (configured && !qualified) return raw;
  return qualified || /[_-]|[a-z0-9][A-Z]/.test(raw) ? humanizeIdentifier(field) : raw;
}

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeAnswerLabels(answer, evidence, sanitizer) {
  let result = String(answer || "");
  const replacements = (Array.isArray(evidence) ? evidence : []).flatMap((item) =>
    (Array.isArray(item?.columns) ? item.columns : []).flatMap((column) => {
      const key = String(column?.key || "").trim();
      if (!key) return [];
      const label = humanLabel(column?.label || key, true);
      const inner = /\[([^\]]+)\]\s*$/.exec(key)?.[1] || null;
      return [[key, label], ...(inner && inner !== label ? [[inner, label]] : [])];
    }));
  replacements.sort((left, right) => right[0].length - left[0].length);
  for (const [technical, label] of replacements) {
    result = result.replace(new RegExp(escapePattern(technical), "gi"), label);
  }
  return humanizeTechnicalText(sanitizer.sanitizeText(result));
}

function requestedRowLimit(question) {
  const requested = /\btop\s+(\d{1,2})\b/i.exec(String(question || ""));
  return requested ? Math.max(1, Math.min(Number(requested[1]), 10)) : 5;
}

function numericEvidenceValue(row) {
  const values = Object.entries(row || {}).filter(([label, value]) =>
    typeof value === "number" && /downtime|durasi|duration|total|jumlah|nilai|jam/i.test(humanLabel(label)));
  return values.length ? Number(values.at(-1)[1]) : Number.NEGATIVE_INFINITY;
}

function distinctRows(rows, limit, question) {
  const ordered = /\b(top|tertinggi|terbesar)\b/i.test(String(question || ""))
    ? [...rows].sort((left, right) => numericEvidenceValue(right) - numericEvidenceValue(left))
    : rows;
  const unique = new Map();
  for (const row of ordered) {
    const machine = Object.entries(row || {}).find(([label]) => humanLabel(label) === "Mesin")?.[1];
    const identity = machine == null ? JSON.stringify(row) : String(machine).trim().toLowerCase();
    if (!unique.has(identity)) unique.set(identity, row);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

function evidenceFallback(sources, retrievalMethod, warnings, metadata = {}, question = "") {
  // Sumber snapshot menyimpan teks konteks internal ("=== DASHBOARD CONTEXT ===")
  // pada satu field row. Itu untuk model, BUKAN untuk ditampilkan mentah ke user.
  // Kalau synthesis gagal (mis. kuota AI 429), jangan membuang dump itu.
  const usable = sources.filter((source) => source.kind !== "snapshot"
    && Array.isArray(source.rows) && source.rows.length).slice(0, 3);
  if (!usable.length) {
    const adaSnapshot = sources.some((source) => source.kind === "snapshot");
    return {
      answer: adaSnapshot
        ? "CIA sudah membaca data dashboard, tetapi layanan AI sedang sibuk/penuh kuota sehingga analisisnya belum bisa disusun. Coba lagi beberapa saat."
        : emptyResult(warnings).answer,
      confidence: "low",
      retrievalMethod: adaSnapshot ? retrievalMethod : "none",
      sources: [],
      warnings: [...new Set(warnings)],
      usage: metadata.usage || null,
      provider: metadata.provider || null,
      model: metadata.model || null,
    };
  }
  const limit = requestedRowLimit(question);
  const sections = usable.map((source) => {
    const rows = distinctRows(source.rows, limit, question).map((row, index) => {
      const values = Object.entries(row || {}).slice(0, 8)
        .map(([label, value]) => `${humanLabel(label)}: ${displayValue(value)}`).join("; ");
      return `${index + 1}. ${values}`;
    }).join("\n");
    return `${source.dashboardName} — ${source.period}\n${rows}`;
  });
  const top = /\btop\s+(\d{1,2})\b/i.exec(String(question || ""));
  const intro = top
    ? `Berdasarkan data live, berikut top ${Math.min(Number(top[1]), 10)} hasil yang paling relevan:`
    : "Berdasarkan data live yang berhasil dibaca:";
  return {
    answer: `${intro}\n\n${sections.join("\n\n")}`,
    confidence: retrievalMethod === "live_dax" ? "medium" : "low",
    retrievalMethod,
    sources: usable,
    warnings: [...new Set(warnings)],
    usage: metadata.usage || null,
    provider: metadata.provider || null,
    model: metadata.model || null,
  };
}

export async function synthesizeEvidence(input = {}, injected = {}) {
  const callModel = injected.callModel || tanyaModelTerstruktur;
  const sanitizer = injected.sanitizer || getSanitizer();
  const warnings = [...new Set((Array.isArray(input.warnings) ? input.warnings : [])
    .map((value) => clean(value, 100)).filter(Boolean))];
  const allEvidence = Array.isArray(input.evidence) ? input.evidence : [];
  const mismatched = allEvidence.filter((item) => !matchesIntent(item));
  const evidence = allEvidence.filter(matchesIntent);
  if (mismatched.length) warnings.push("EVIDENCE_RELEVANCE_MISMATCH");
  if (mismatched.some((item) => item?.status === "success" && Array.isArray(item.rows) && item.rows.length)
    && !evidence.some((item) => item?.status === "success" && Array.isArray(item.rows) && item.rows.length)) {
    return relevanceFailure(mismatched, warnings);
  }
  const live = liveSources(evidence, input.question, sanitizer, input.intentFrame?.entities);
  const unresolved = warnings.some((warning) => ["EVIDENCE_GAP_UNRESOLVED", "MAX_RETRIEVAL_ROUNDS_REACHED"].includes(warning));
  const liveIncomplete = !live.length || evidence.some((item) => item?.status !== "success") || unresolved;
  const snapshots = liveIncomplete ? snapshotSources(input.snapshotFallback, sanitizer) : [];
  const sources = [...live, ...snapshots];
  const retrievalMethod = methodFor(live.length, snapshots.length);
  if (snapshots.length) warnings.push("SNAPSHOT_FALLBACK_USED");
  if (!sources.length) return emptyResult(warnings);

  const packet = {
    question: safeModelText(input.question, sanitizer, 1_000),
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
      systemInstruction: [
        "Kamu CIA (Cimory Intelligence Assistant) — Principal Analytics Engineer untuk PT. Cisarua Mountain Dairy. Analisis bukti pada packet dan jawab dalam Bahasa Indonesia yang sama dengan pertanyaan.",
        "Kembalikan JSON SAJA: {\"answer\": string berformat markdown, \"citedSourceIndexes\": number[]}.",
        "ATURAN DATA: pakai HANYA angka/nilai yang ada pada packet.sources. Jangan mengarang angka, nama mesin/kategori, atau periode. Jangan menyimpulkan sebab-akibat hanya dari korelasi tanpa bukti mekanisme; kalau menyebut korelasi, tandai sebagai dugaan.",
        "STRUKTUR answer (markdown, padat, jangan menampilkan ulang seluruh tabel — cukup angka relevan, **bold** angka penting):",
        "1. **Ringkasan Temuan** — 1-2 kalimat jawaban utama.",
        "2. **Data Pendukung** — bullet angka kunci dari sumber; sebutkan periode/filter yang berlaku.",
        "3. Untuk pertanyaan investigatif (kenapa / root cause / naik-turun / bandingkan): tambah **Root Cause** (sertakan confidence High/Medium/Low + alasan satu baris) lalu **Rekomendasi** tindakan operasional yang konkret (mis. mesin/kategori mana yang diprioritaskan).",
        "4. **Asumsi / Keterbatasan** — sebutkan bila data terbatas/terpotong, KPI belum terkonfirmasi, atau breakdown yang diminta tidak tersedia; sarankan langkah konkret (buka halaman lain / ubah slicer periode).",
        "Untuk pertanyaan lookup sederhana cukup poin 1-2. Ringkas: target ~150-250 kata.",
      ].join("\n"),
      question: JSON.stringify(packet),
      maxOutputTokens: 8_000,
    });
  } catch {
    return evidenceFallback(sources, retrievalMethod, [...warnings, "SYNTHESIS_FAILED"], {}, input.question);
  }

  const parsed = parseReply(response?.text);
  if (!parsed || !clean(parsed.answer)) {
    return evidenceFallback(sources, retrievalMethod, [...warnings, "SYNTHESIS_INVALID_RESPONSE"], {
      usage: response?.usage, provider: response?.provider, model: response?.model,
    }, input.question);
  }

  const requestedCitations = Array.isArray(parsed.citedSourceIndexes) ? parsed.citedSourceIndexes : [];
  const citations = validCitationIndexes(requestedCitations, sources.length);
  const invalidCitation = citations.length !== requestedCitations.length || citations.length === 0;
  if (invalidCitation) warnings.push("INVALID_SOURCE_CITATION");
  const hasMechanism = evidence.some((item) => item?.causalMechanism === true);
  const asksCausality = /\b(karena|penyebab|menyebabkan|memicu|akibat|korelasi|berkorelasi|hubungan)\b/i
    .test(String(input.question || ""));
  let correlationInsufficient = false;
  if (asksCausality && !hasMechanism) {
    const citedLive = citations.map((index) => sources[index]).filter((source) => source?.kind === "live_dax");
    const compatiblePair = citedLive.some((left, index) => citedLive.slice(index + 1).some((right) =>
      left.dashboardId !== right.dashboardId && left.period === right.period));
    if (!compatiblePair) {
      correlationInsufficient = true;
      warnings.push("CORRELATION_EVIDENCE_INSUFFICIENT");
    }
  }
  let answer = correlationInsufficient
    ? "Bukti yang tersedia belum cukup untuk menyimpulkan korelasi atau penyebab. CIA memerlukan sedikitnya dua sumber live pada periode yang sama."
    : correlationLanguage(clean(parsed.answer), hasMechanism);
  answer = safeAnswerLabels(answer, evidence, sanitizer);
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
