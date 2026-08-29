const text = (value) => typeof value === "string" ? value.trim() : "";

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
  const dimensions = Array.isArray(binding.dimensions) ? binding.dimensions.slice(0, 50) : [];
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

function mergeByPrecedence(...groups) {
  const seen = new Set();
  return groups.flatMap((group) => normalizedFilters(group).filter((filter) => {
    const dimension = filter.dimension.toLocaleLowerCase("id-ID");
    if (seen.has(dimension)) return false;
    seen.add(dimension);
    return true;
  }));
}

function referencesCurrentView(question) {
  return /\b(?:data yang sedang tampil|data yang (?:sedang )?ditampilkan|data yang tampil|filter ini|slicer ini|tampilan ini|current view|current display)\b/i
    .test(String(question || ""));
}

export function extractReportFilters(snapshot = {}) {
  return [...(Array.isArray(snapshot.filters) ? snapshot.filters : []),
    ...(Array.isArray(snapshot.slicers) ? snapshot.slicers : [])].flatMap((line) => {
    const match = /^\s*(.+?)\s+(?:=|is)\s+(.+?)\s*$/i.exec(String(line || ""));
    if (!match) return [];
    const dimension = match[1].trim().split(".").at(-1)?.replace(/^'|'$/g, "").trim();
    if (!dimension) return [];
    return match[2].split(",").map((value) => value.trim()).filter(Boolean)
      .map((value) => ({ dimension, value }));
  }).slice(0, 50);
}

export function resolveFilterPolicy({
  question = "", explicitFilters = [], contextFilters = [], reportFilters = [],
} = {}) {
  const wholeDataset = /\bkeseluruhan\b/i.test(String(question));
  const useReportFilters = !wholeDataset && referencesCurrentView(question);
  return {
    filters: mergeByPrecedence(
      explicitFilters,
      contextFilters,
      useReportFilters ? reportFilters : [],
    ),
    reportFiltersApplied: useReportFilters,
  };
}
