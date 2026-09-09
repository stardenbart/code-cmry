import { humanizeIdentifier } from "../ciaHumanLabels.service.js";

const text = (value) => typeof value === "string" ? value.trim() : "";

function blueprintDimension(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const table = text(raw.table ?? raw.tableName ?? raw.tabel) || null;
    const column = text(raw.column ?? raw.columnName ?? raw.kolom);
    if (!column) return null;
    return {
      table,
      column,
      humanName: text(raw.humanName ?? raw.displayCaption ?? raw.label)
        || humanizeIdentifier(column),
    };
  }
  const value = text(raw);
  if (!value) return null;
  const qualified = /^'?(.+?)'?\[([^\]]+)\]$/.exec(value);
  return qualified ? {
    table: text(qualified[1]) || null,
    column: text(qualified[2]),
    humanName: humanizeIdentifier(qualified[2]),
  } : {
    table: null,
    column: value,
    humanName: humanizeIdentifier(value),
  };
}

function visualRole(binding) {
  if (text(binding.role)) return text(binding.role).toLowerCase();
  const label = `${text(binding.visualTitle)} ${text(binding.displayCaption)}`.toLowerCase();
  if (/\b(?:top|rank|ranking|tertinggi|terendah)\b/.test(label)) return "ranking";
  if (/\b(?:trend|harian|mingguan|bulanan|daily|weekly|monthly)\b/.test(label)) return "trend";
  if (/\b(?:detail|rincian|issue|masalah|action|tindakan|status)\b/.test(label)) return "detail";
  if (/\b(?:persen|persentase|percentage|achievement|achivement|ratio)\b/.test(label)) return "ratio";
  return Array.isArray(binding.dimensions) && binding.dimensions.length ? "breakdown" : "total";
}

export function buildVisualBlueprint(binding = {}) {
  const measureName = text(binding.measureName);
  const dimensions = (Array.isArray(binding.dimensions) ? binding.dimensions : [])
    .slice(0, 50).map(blueprintDimension).filter(Boolean);
  return {
    measures: measureName ? [{
      tableName: text(binding.tableName) || null,
      measureName,
      displayCaption: text(binding.displayCaption) || null,
    }] : [],
    dimensions,
    role: visualRole({ ...binding, dimensions }),
    periodPolicy: {
      dateTable: text(binding.dateTable) || null,
      dateColumn: text(binding.dateColumn) || null,
      dateLogic: text(binding.dateLogic) || null,
    },
    labels: {
      pageName: text(binding.pageName) || null,
      visualTitle: text(binding.visualTitle) || null,
      displayCaption: text(binding.displayCaption) || null,
      humanName: text(binding.humanName) || null,
    },
  };
}

function normalizedFilters(value) {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const dimension = text(item.dimension ?? item.field ?? item.column).slice(0, 100);
    const filterValue = text(item.value).slice(0, 160);
    return dimension && filterValue ? [{ dimension, value: filterValue }] : [];
  });
}

function canonicalDimensions(blueprint) {
  const aliases = new Map();
  for (const raw of Array.isArray(blueprint?.dimensions) ? blueprint.dimensions : []) {
    const dimension = blueprintDimension(raw);
    if (!dimension) continue;
    const canonical = dimension.humanName || dimension.column;
    const candidates = [canonical, dimension.column,
      dimension.table ? `${dimension.table}[${dimension.column}]` : "",
      dimension.table ? `${dimension.table}.${dimension.column}` : ""];
    for (const candidate of candidates) {
      const alias = text(candidate).toLocaleLowerCase("id-ID");
      if (alias) aliases.set(alias, canonical);
    }
  }
  return aliases;
}

function mergeByPrecedence(blueprint, ...groups) {
  const aliases = canonicalDimensions(blueprint);
  const claimed = new Set();
  const result = [];
  for (const group of groups) {
    const canonical = normalizedFilters(group).map((filter) => ({
      ...filter,
      dimension: aliases.get(filter.dimension.toLocaleLowerCase("id-ID")) || filter.dimension,
    }));
    const groupDimensions = new Set(canonical.map((filter) =>
      filter.dimension.toLocaleLowerCase("id-ID")));
    const values = new Set();
    for (const filter of canonical) {
      const dimension = filter.dimension.toLocaleLowerCase("id-ID");
      const valueKey = `${dimension}\u0000${filter.value.toLocaleLowerCase("id-ID")}`;
      if (!claimed.has(dimension) && !values.has(valueKey)) {
        result.push(filter);
        values.add(valueKey);
      }
    }
    for (const dimension of groupDimensions) claimed.add(dimension);
  }
  return result;
}

function referencesCurrentView(question) {
  return /\b(?:data yang sedang tampil|data yang (?:sedang )?ditampilkan|data yang tampil|filter ini|slicer ini|tampilan ini|current view|current display)\b/i
    .test(String(question || ""));
}

export function extractReportFilters(snapshot = {}, association = {}) {
  return [...(Array.isArray(snapshot.filters) ? snapshot.filters : []),
    ...(Array.isArray(snapshot.slicers) ? snapshot.slicers : [])].flatMap((line) => {
    const match = /^\s*(.+?)\s+(?:=|is)\s+(.+?)\s*$/i.exec(String(line || ""));
    if (!match) return [];
    const dimension = match[1].trim().split(".").at(-1)?.replace(/^'|'$/g, "").trim();
    if (!dimension) return [];
    return match[2].split(",").map((value) => value.trim()).filter(Boolean)
      .map((value) => ({
        dimension,
        value,
        ...(association.dashboardId == null ? {} : { dashboardId: String(association.dashboardId) }),
        ...(association.bindingId == null ? {} : { bindingId: String(association.bindingId) }),
      }));
  }).slice(0, 50);
}

export function filtersForBindingAssociation(filters, binding = {}) {
  const dashboardId = binding.dashboardId == null ? null : String(binding.dashboardId);
  const bindingId = binding.bindingId == null ? null : String(binding.bindingId);
  return (Array.isArray(filters) ? filters : []).filter((filter) => {
    if (filter?.dashboardId != null && dashboardId !== String(filter.dashboardId)) return false;
    if (filter?.bindingId != null && bindingId !== String(filter.bindingId)) return false;
    return true;
  });
}

export function resolveFilterPolicy({
  question = "", blueprint = null, priorityFilters = [], explicitFilters = [],
  contextFilters = [], reportFilters = [],
} = {}) {
  const wholeDataset = /\bkeseluruhan\b/i.test(String(question));
  const useReportFilters = !wholeDataset && referencesCurrentView(question);
  return {
    filters: mergeByPrecedence(
      blueprint,
      priorityFilters,
      explicitFilters,
      contextFilters,
      useReportFilters ? reportFilters : [],
    ),
    reportFiltersApplied: useReportFilters,
  };
}
