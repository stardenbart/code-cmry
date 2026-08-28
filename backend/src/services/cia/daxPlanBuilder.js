export class DaxPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DaxPlanError";
    this.code = code;
  }
}

const clean = (value) => typeof value === "string" ? value.trim() : "";
const key = (value) => clean(value).toLowerCase();

function tableIdentifier(table) {
  return `'${table.replaceAll("'", "''")}'`;
}

function columnIdentifier(table, column) {
  return `${tableIdentifier(table)}[${column.replaceAll("]", "]]" )}]`;
}

function measureIdentifier(table, measure) {
  return `${tableIdentifier(table)}[${measure.replaceAll("]", "]]" )}]`;
}

function aliasIdentifier(alias) {
  return `[${alias.replaceAll("]", "]]" )}]`;
}

function schemaInventory(schema) {
  if (!schema || schema.berhasil === false) {
    throw new DaxPlanError("SCHEMA_UNAVAILABLE", "Schema semantic model tidak tersedia");
  }
  const tables = new Map();
  for (const entry of Array.isArray(schema.tabel) ? schema.tabel : []) {
    const table = clean(entry?.tabel ?? entry?.table ?? entry?.name);
    if (!table) continue;
    const columns = new Map();
    for (const raw of Array.isArray(entry.kolom ?? entry.columns) ? (entry.kolom ?? entry.columns) : []) {
      const column = clean(typeof raw === "string" ? raw.split(":")[0] : raw?.nama ?? raw?.name ?? raw?.column);
      if (column) columns.set(key(column), column);
    }
    tables.set(key(table), { table, columns });
  }
  const measures = new Map();
  for (const raw of Array.isArray(schema.measure ?? schema.measures) ? (schema.measure ?? schema.measures) : []) {
    const measure = clean(typeof raw === "string" ? raw : raw?.nama ?? raw?.name);
    if (measure) measures.set(key(measure), measure);
  }
  return { tables, measures };
}

function requireTable(inventory, requested) {
  const result = inventory.tables.get(key(requested));
  if (!result) throw new DaxPlanError("TABLE_NOT_ALLOWED", `Table ${clean(requested) || "(kosong)"} tidak ada di schema`);
  return result;
}

function requireColumn(inventory, tableName, columnName, errorCode = "DIMENSION_NOT_ALLOWED") {
  const table = inventory.tables.get(key(tableName));
  const column = table?.columns.get(key(columnName));
  if (!table || !column) {
    throw new DaxPlanError(errorCode, `Column ${clean(tableName)}[${clean(columnName)}] tidak ada di schema`);
  }
  return { table: table.table, column };
}

function parseDimension(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const table = clean(raw.table ?? raw.tableName ?? raw.tabel);
    const column = clean(raw.column ?? raw.columnName ?? raw.kolom);
    return table && column ? {
      table, column,
      humanName: clean(raw.humanName ?? raw.displayCaption ?? raw.label) || column,
    } : null;
  }
  const value = clean(raw);
  const qualified = /^'?(.+?)'?\[([^\]]+)\]$/.exec(value);
  if (qualified) return { table: clean(qualified[1]), column: clean(qualified[2]), humanName: clean(qualified[2]) };
  return value ? { table: null, column: value, humanName: value } : null;
}

function resolveBareColumn(inventory, columnName, errorCode = "DIMENSION_NOT_ALLOWED") {
  const matches = [...inventory.tables.values()].flatMap((entry) => {
    const column = entry.columns.get(key(columnName));
    return column ? [{ table: entry.table, column }] : [];
  });
  if (matches.length !== 1) {
    throw new DaxPlanError(errorCode,
      matches.length ? `Column ${columnName} ambigu di schema` : `Column ${columnName} tidak ada di schema`);
  }
  return matches[0];
}

function bindingDimensions(binding, inventory) {
  return (Array.isArray(binding.dimensions) ? binding.dimensions : []).flatMap((raw) => {
    const parsed = parseDimension(raw);
    if (!parsed) return [];
    const resolved = parsed.table
      ? requireColumn(inventory, parsed.table, parsed.column)
      : resolveBareColumn(inventory, parsed.column);
    return [{ ...resolved, humanName: parsed.humanName, rawName: clean(raw) || parsed.column }];
  });
}

function selectDimensions(goal, binding, inventory) {
  const available = bindingDimensions(binding, inventory);
  const requested = Array.isArray(goal?.dimensions) ? goal.dimensions.map(clean).filter(Boolean) : [];
  if (!requested.length) return [];
  return requested.map((name) => {
    const found = available.find((item) => [item.humanName, item.column, item.rawName]
      .some((candidate) => key(candidate) === key(name)));
    if (!found) throw new DaxPlanError("DIMENSION_NOT_ALLOWED", `Dimension ${name} tidak ada pada binding KPI`);
    return found;
  });
}

function isoParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() + 1 === parts[1]
    && date.getUTCDate() === parts[2] ? parts : null;
}

function rowLimit(value) {
  const configured = Number(process.env.CIA_DAX_MAX_ROWS) || 500;
  const requested = Number(value) || configured;
  return Math.max(1, Math.min(Math.floor(requested), configured, 500));
}

export function buildDaxPlan({ goal = {}, binding = {}, period = {}, schema, rowLimit: requestedRows } = {}) {
  const inventory = schemaInventory(schema);
  const semanticModel = clean(binding.semanticModel);
  if (!semanticModel || (clean(schema?.model) && key(schema.model) !== key(semanticModel))) {
    throw new DaxPlanError("MODEL_NOT_ALLOWED", "Semantic model binding tidak cocok dengan schema");
  }

  const measureTable = requireTable(inventory, binding.tableName);
  const measure = inventory.measures.get(key(binding.measureName));
  if (!measure) throw new DaxPlanError("MEASURE_NOT_ALLOWED", `Measure ${clean(binding.measureName)} tidak ada di schema`);

  const date = requireColumn(inventory, binding.dateTable, binding.dateColumn, "DATE_COLUMN_NOT_ALLOWED");
  const from = isoParts(period.from);
  const to = isoParts(period.to);
  if (!from || !to || period.from > period.to) {
    throw new DaxPlanError("PERIOD_INVALID", "Periode DAX tidak valid");
  }

  const dimensions = selectDimensions(goal, binding, inventory);
  const humanName = clean(binding.humanName ?? binding.displayCaption) || measure;
  const measureRef = measureIdentifier(measureTable.table, measure);
  const dateRef = columnIdentifier(date.table, date.column);
  const dimensionRefs = dimensions.map((item) => columnIdentifier(item.table, item.column));
  const alias = aliasIdentifier(humanName.slice(0, 100));
  const summarizeArgs = [...dimensionRefs, `"${humanName.replaceAll('"', '""').slice(0, 100)}", ${measureRef}`];
  const maxRows = rowLimit(requestedRows);
  const dax = [
    "EVALUATE",
    "TOPN(",
    `  ${maxRows},`,
    "  CALCULATETABLE(",
    "    SUMMARIZECOLUMNS(",
    `      ${summarizeArgs.join(",\n      ")}`,
    "    ),",
    `    KEEPFILTERS(${dateRef} >= DATE(${from.join(", ")}) && ${dateRef} <= DATE(${to.join(", ")}))`,
    "  ),",
    `  ${alias}, DESC`,
    ")",
  ].join("\n");

  return {
    semanticModel,
    datasetId: clean(schema.datasetId) || null,
    dashboardId: binding.dashboardId == null ? null : String(binding.dashboardId),
    period: { ...period },
    dax,
    selectedKpis: [{ bindingId: clean(binding.bindingId ?? goal.kpiBindingId), humanName }],
    selectedDimensions: dimensions.map(({ table, column, humanName: label }) => ({
      table, column, humanName: label,
    })),
    maxRows,
    purpose: goal.purpose === "correlation" ? "correlation" : "primary",
  };
}

