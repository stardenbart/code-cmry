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
  if (!query || query.length > 4_000 || !/^(EVALUATE|DEFINE)\b/i.test(query)) return false;
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
  const datasetId = plan?.datasetId || await resolveDatasetId(plan?.semanticModel);
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
