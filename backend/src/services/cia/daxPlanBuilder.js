import { humanizeIdentifier } from "../ciaHumanLabels.service.js";
import {
  buildVisualBlueprint, filtersForBindingAssociation, resolveFilterPolicy,
} from "./visualBlueprint.js";

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
    return column ? {
      table, column,
      humanName: clean(raw.humanName ?? raw.displayCaption ?? raw.label) || humanizeIdentifier(column),
    } : null;
  }
  const value = clean(raw);
  const qualified = /^'?(.+?)'?\[([^\]]+)\]$/.exec(value);
  if (qualified) return { table: clean(qualified[1]), column: clean(qualified[2]),
    humanName: humanizeIdentifier(qualified[2]) };
  return value ? { table: null, column: value, humanName: humanizeIdentifier(value) } : null;
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

function bindingDimensions(blueprint, inventory) {
  return (Array.isArray(blueprint.dimensions) ? blueprint.dimensions : []).flatMap((raw) => {
    const parsed = parseDimension(raw);
    if (!parsed) return [];
    const resolved = parsed.table
      ? requireColumn(inventory, parsed.table, parsed.column)
      : resolveBareColumn(inventory, parsed.column);
    return [{ ...resolved, humanName: parsed.humanName, rawName: clean(raw) || parsed.column }];
  });
}

function selectDimensions(goal, blueprint, inventory) {
  const available = bindingDimensions(blueprint, inventory);
  const requested = Array.isArray(goal?.dimensions) ? goal.dimensions.map(clean).filter(Boolean) : [];
  if (!requested.length) return [];
  return requested.map((name) => {
    const found = available.find((item) => [item.humanName, item.column, item.rawName,
      `${item.table}[${item.column}]`, `${item.table}.${item.column}`]
      .some((candidate) => key(candidate) === key(name)));
    if (!found) throw new DaxPlanError("DIMENSION_NOT_ALLOWED", `Dimension ${name} tidak ada pada binding KPI`);
    return found;
  });
}

function selectFilters(filters, blueprint, inventory) {
  const available = bindingDimensions(blueprint, inventory);
  return (Array.isArray(filters) ? filters : []).map((filter) => {
    const name = clean(filter?.dimension);
    const found = available.find((item) => [item.humanName, item.column, item.rawName,
      `${item.table}[${item.column}]`, `${item.table}.${item.column}`]
      .some((candidate) => key(candidate) === key(name)));
    if (!found) throw new DaxPlanError("FILTER_DIMENSION_NOT_ALLOWED", `Filter ${name} tidak ada pada binding KPI`);
    const value = clean(filter?.value).toLowerCase().replace(/\s+/g, "");
    if (!value || !/^[a-z0-9_-]{1,50}$/.test(value)) {
      throw new DaxPlanError("FILTER_VALUE_INVALID", "Nilai filter entitas tidak valid");
    }
    return { ...found, value };
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

export function buildDaxPlan({
  question = "", goal = {}, binding = {}, period = {}, schema, rowLimit: requestedRows,
  explicitFilters = [], contextFilters = [], reportFilters = [],
} = {}) {
  const inventory = schemaInventory(schema);
  const blueprint = binding.blueprint || buildVisualBlueprint(binding);
  const semanticModel = clean(binding.semanticModel);
  if (!semanticModel || (clean(schema?.model) && key(schema.model) !== key(semanticModel))) {
    throw new DaxPlanError("MODEL_NOT_ALLOWED", "Semantic model binding tidak cocok dengan schema");
  }

  const selectedMeasure = blueprint.measures?.[0] || {};
  const measureTable = requireTable(inventory, selectedMeasure.tableName);
  const measure = inventory.measures.get(key(selectedMeasure.measureName));
  if (!measure) throw new DaxPlanError("MEASURE_NOT_ALLOWED", `Measure ${clean(selectedMeasure.measureName)} tidak ada di schema`);

  const date = requireColumn(inventory, blueprint.periodPolicy?.dateTable,
    blueprint.periodPolicy?.dateColumn, "DATE_COLUMN_NOT_ALLOWED");
  const from = isoParts(period.from);
  const to = isoParts(period.to);
  if (!from || !to || period.from > period.to) {
    throw new DaxPlanError("PERIOD_INVALID", "Periode DAX tidak valid");
  }

  const dimensions = selectDimensions(goal, blueprint, inventory);
  const plannedPolicy = goal?.filterPolicy;
  const policy = resolveFilterPolicy({
    question,
    blueprint,
    priorityFilters: filtersForBindingAssociation(explicitFilters, binding),
    explicitFilters: plannedPolicy
      ? plannedPolicy.explicitFilters
      : filtersForBindingAssociation(goal.filters, binding),
    contextFilters: plannedPolicy
      ? plannedPolicy.contextFilters
      : filtersForBindingAssociation(contextFilters, binding),
    reportFilters: plannedPolicy
      ? plannedPolicy.reportFilters
      : filtersForBindingAssociation(reportFilters, binding),
  });
  const filters = selectFilters(policy.filters, blueprint, inventory);
  const humanName = clean(binding.humanName ?? blueprint.labels?.displayCaption) || measure;
  const measureRef = measureIdentifier(measureTable.table, measure);
  const dateRef = columnIdentifier(date.table, date.column);
  const dimensionRefs = dimensions.map((item) => columnIdentifier(item.table, item.column));
  const groupedFilters = new Map();
  for (const item of filters) {
    const filterKey = `${item.table}\u0000${item.column}`;
    const group = groupedFilters.get(filterKey) || { ...item, values: [] };
    if (!group.values.includes(item.value)) group.values.push(item.value);
    groupedFilters.set(filterKey, group);
  }
  const entityFilters = [...groupedFilters.values()].map((item) => {
    const ref = columnIdentifier(item.table, item.column);
    const predicate = item.values.length === 1
      ? `LOWER(SUBSTITUTE(${ref}, " ", "")) = "${item.values[0]}"`
      : `LOWER(SUBSTITUTE(${ref}, " ", "")) IN { ${item.values.map((value) => `"${value}"`).join(", ")} }`;
    return `KEEPFILTERS(FILTER(ALL(${ref}), ${predicate}))`;
  });
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
    `    KEEPFILTERS(${dateRef} >= DATE(${from.join(", ")}) && ${dateRef} <= DATE(${to.join(", ")}))${entityFilters.length ? "," : ""}`,
    ...entityFilters.map((filter, index) => `    ${filter}${index < entityFilters.length - 1 ? "," : ""}`),
    "  ),",
    `  ${alias}, DESC`,
    ")",
    `ORDER BY ${alias} DESC`,
  ].join("\n");

  return {
    semanticModel,
    datasetId: clean(schema.datasetId) || null,
    dashboardId: binding.dashboardId == null ? null : String(binding.dashboardId),
    dashboardName: clean(binding.dashboardName) || null,
    period: { ...period },
    dax,
    selectedKpis: [{ bindingId: clean(binding.bindingId ?? goal.kpiBindingId), humanName }],
    selectedDimensions: dimensions.map(({ table, column, humanName: label }) => ({
      table, column, humanName: label,
    })),
    selectedFilters: filters.map(({ table, column, humanName, value }) => ({
      table, column, humanName, value,
    })),
    labelBindings: [{
      bindingId: clean(binding.bindingId ?? goal.kpiBindingId),
      tableName: measureTable.table,
      measureName: measure,
      humanName,
      displayCaption: clean(blueprint.labels?.displayCaption ?? binding.displayCaption) || null,
      dashboardName: clean(binding.dashboardName) || null,
      definition: clean(binding.definition),
      unit: clean(binding.unit) || null,
      numberFormat: clean(binding.numberFormat) || null,
    }],
    allowedDaxIdentifiers: [...new Set([
      `${measureTable.table}[${measure}]`,
      `${date.table}[${date.column}]`,
      ...dimensions.map((item) => `${item.table}[${item.column}]`),
      ...filters.map((item) => `${item.table}[${item.column}]`),
    ])],
    maxRows,
    purpose: goal.purpose === "correlation" ? "correlation" : "primary",
  };
}
