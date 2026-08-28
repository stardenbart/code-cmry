import { perbaikiDaxTerbatas } from "../daxAgent.service.js";
import {
  jalankanDaxAman,
  powerBiErrorCode,
  resolusiDatasetId,
} from "../powerbiMeta.service.js";
import { labelDaxRows } from "../ciaHumanLabels.service.js";

const ERROR_CODES = new Set([
  "DAX_INVALID", "POWERBI_AUTH", "POWERBI_FORBIDDEN", "POWERBI_TIMEOUT",
  "POWERBI_THROTTLED", "POWERBI_UNKNOWN",
]);

function normalizeIdentifier(value) {
  const match = /^'?(.+?)'?\[([^\]]+)\]$/.exec(String(value || "").trim());
  if (!match) return "";
  return `${match[1].replaceAll("''", "'").toLowerCase()}[${match[2].toLowerCase()}]`;
}

function validRepair(dax, plan) {
  const query = String(dax || "").trim();
  if (!query || query.length > 4_000 || !/^EVALUATE\b/i.test(query)) return false;
  if (/\/\/|--|\/\*|\*\//.test(query)) return false;
  const allowed = new Set((plan.allowedDaxIdentifiers || []).map(normalizeIdentifier).filter(Boolean));
  const allowedColumns = new Set([...allowed].map((item) => item.slice(item.indexOf("[") + 1, -1)));
  for (const kpi of plan.selectedKpis || []) allowedColumns.add(String(kpi.humanName || "").toLowerCase());

  const qualified = [...query.matchAll(/('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_ ]*)\[([^\]]+)\]/g)];
  for (const match of qualified) {
    if (!allowed.has(normalizeIdentifier(`${match[1]}[${match[2]}]`))) return false;
  }
  for (const match of query.matchAll(/\[([^\]]+)\]/g)) {
    if (!allowedColumns.has(match[1].toLowerCase())) return false;
  }

  // Repair harus mempertahankan seluruh identitas plan, bukan sekadar tidak
  // menambah identifier baru. Ini menolak query konstanta/fabrikasi yang
  // membuang measure, dimensi, atau filter tanggal.
  const used = new Set(qualified.map((match) => normalizeIdentifier(`${match[1]}[${match[2]}]`)));
  if ([...allowed].some((identifier) => !used.has(identifier))) return false;
  const withoutQualifiedIdentifiers = query.replace(
    /('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_ ]*)\[([^\]]+)\]/g, "",
  );
  if (/'(?:[^']|'')+'/g.test(withoutQualifiedIdentifiers)) return false;

  const functions = [...query.matchAll(/\b([A-Z][A-Z0-9_.]*)\s*\(/gi)]
    .map((match) => match[1].toUpperCase());
  const allowedFunctions = new Set(["TOPN", "CALCULATETABLE", "SUMMARIZECOLUMNS", "KEEPFILTERS", "DATE"]);
  if (functions.some((name) => !allowedFunctions.has(name))) return false;
  for (const required of ["TOPN", "CALCULATETABLE", "SUMMARIZECOLUMNS", "KEEPFILTERS", "DATE"]) {
    if (!functions.includes(required)) return false;
  }

  const top = /\bTOPN\s*\(\s*(\d+)/i.exec(query);
  if (!top || Number(top[1]) < 1 || Number(top[1]) > Number(plan.maxRows || 500)) return false;
  const compact = query.replace(/\s+/g, "").toUpperCase();
  for (const value of [plan.period?.from, plan.period?.to]) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!parts || !compact.includes(`DATE(${Number(parts[1])},${Number(parts[2])},${Number(parts[3])})`)) return false;
  }

  // Setelah seluruh token yang memang diizinkan dibuang, tidak boleh tersisa
  // identifier alfabet apa pun. Ini menutup bare table (`EVALUATE SecretTable`)
  // yang tidak memakai bentuk Table[Column].
  const residue = query
    .replace(/('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_ ]*)\[([^\]]+)\]/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/g, " ")
    .replace(/\b(?:EVALUATE|DESC|ASC)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/[\s(),><=+*/&|!-]+/g, " ");
  if (/[A-Za-z_]/.test(residue)) return false;
  return true;
}

function safeMessage(value) {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").slice(0, 300) : "";
}

function typedError(value) {
  if (ERROR_CODES.has(value?.errorCode)) return value.errorCode;
  if (value instanceof Error || value?.response || value?.code) return powerBiErrorCode(value);
  return "POWERBI_UNKNOWN";
}

function sourceFrom(plan) {
  return {
    dashboardId: plan.dashboardId ?? null,
    dashboardName: plan.dashboardName ?? null,
    semanticModel: plan.semanticModel,
    kpis: (plan.selectedKpis || []).map((item) => item.humanName).filter(Boolean),
  };
}

function failure(plan, startedAt, attempts, errorCode, errorMessage = "") {
  return {
    status: "failed",
    errorCode,
    errorMessage: safeMessage(errorMessage),
    attempts,
    rows: [],
    columns: [],
    rowCount: 0,
    durationMs: Date.now() - startedAt,
    period: plan.period,
    source: sourceFrom(plan),
  };
}

export async function executeEvidencePlan(plan, injected = {}) {
  const executeDax = injected.executeDax || jalankanDaxAman;
  const repairDax = injected.repairDax || perbaikiDaxTerbatas;
  const resolveDatasetId = injected.resolveDatasetId || resolusiDatasetId;
  const labelRows = injected.labelRows || labelDaxRows;
  const tracker = injected.tracker;
  const startedAt = Date.now();
  let datasetId;
  try {
    datasetId = plan?.datasetId || await resolveDatasetId(plan?.semanticModel);
  } catch (error) {
    return failure(plan, startedAt, 0, typedError(error), error?.message);
  }
  if (!datasetId) return failure(plan, startedAt, 0, "POWERBI_UNKNOWN", "Dataset tidak ditemukan");

  let dax = String(plan.dax || "");
  let attempts = 0;
  for (;;) {
    attempts += 1;
    let result;
    try {
      await tracker?.event?.("dax_attempt", {
        semanticModel: plan.semanticModel,
        status: "started",
        metadata: { dashboards: [plan.dashboardId].filter(Boolean), period: plan.period?.label || null },
      });
      result = await executeDax(datasetId, dax, { maksBaris: plan.maxRows || 500 });
    } catch (error) {
      return failure(plan, startedAt, attempts, typedError(error), error?.message);
    }

    if (result?.berhasil === true || result?.status === "success") {
      const rawRows = result.baris ?? result.rows ?? [];
      if (!rawRows.length) {
        return {
          ...failure(plan, startedAt, attempts, null),
          status: "empty",
          errorCode: null,
          errorMessage: "",
        };
      }
      const labeled = labelRows({
        rows: rawRows,
        bindings: plan.labelBindings || [],
        dimensions: plan.selectedDimensions || [],
      });
      return {
        status: "success",
        errorCode: null,
        attempts,
        rows: labeled.rows,
        columns: labeled.columns,
        rowCount: labeled.rows.length,
        durationMs: Date.now() - startedAt,
        period: plan.period,
        source: sourceFrom(plan),
      };
    }

    const errorCode = typedError(result);
    const errorMessage = result?.alasan ?? result?.errorMessage ?? "";
    if (errorCode !== "DAX_INVALID" || attempts >= 2) {
      return failure(plan, startedAt, attempts, errorCode, errorMessage);
    }
    if (Array.isArray(plan.selectedFilters) && plan.selectedFilters.length) {
      return failure(plan, startedAt, attempts, "DAX_INVALID",
        "Repair dinonaktifkan untuk query dengan filter entitas");
    }

    let repaired;
    try {
      repaired = await repairDax({ dax, errorMessage: safeMessage(errorMessage), plan });
    } catch (error) {
      return failure(plan, startedAt, attempts, "DAX_INVALID", error?.message);
    }
    if (!validRepair(repaired, plan)) {
      return failure(plan, startedAt, attempts, "DAX_INVALID", "Hasil repair melanggar allowlist schema");
    }
    await tracker?.event?.("dax_repair", { semanticModel: plan.semanticModel, status: "success" });
    dax = repaired;
  }
}
