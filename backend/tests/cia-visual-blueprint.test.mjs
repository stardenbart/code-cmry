import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import {
  buildVisualBlueprint,
  extractReportFilters,
  resolveFilterPolicy,
} from "../src/services/cia/visualBlueprint.js";

section("Binding visual menjadi blueprint query live");
const blueprint = buildVisualBlueprint({
  pageName: "Routine Downtime",
  visualTitle: "Top Mesin",
  tableName: "Measures",
  measureName: "TECHNICAL_DT",
  displayCaption: "Technical Downtime",
  dimensions: [
    { table: "Machine", column: "Machine Name", humanName: "Mesin" },
    "Calendar[Month]",
  ],
  dateTable: "Calendar",
  dateColumn: "Date",
  dateLogic: "calendar_day",
});
ok("measure visual dipertahankan", blueprint.measures[0]?.measureName === "TECHNICAL_DT",
  JSON.stringify(blueprint.measures));
ok("dimensi visual dipertahankan", blueprint.dimensions.length === 2,
  JSON.stringify(blueprint.dimensions));
ok("dimensi legacy punya label manusia dan identifier teknis terpisah",
  blueprint.dimensions[1]?.humanName === "Month"
    && blueprint.dimensions[1]?.table === "Calendar"
    && blueprint.dimensions[1]?.column === "Month",
  JSON.stringify(blueprint.dimensions[1]));
ok("role ranking berasal dari fungsi visual", blueprint.role === "ranking", blueprint.role);
ok("date mapping menjadi period policy",
  blueprint.periodPolicy.dateTable === "Calendar"
    && blueprint.periodPolicy.dateColumn === "Date"
    && blueprint.periodPolicy.dateLogic === "calendar_day",
  JSON.stringify(blueprint.periodPolicy));
ok("label page/visual/caption tetap manusiawi",
  blueprint.labels.pageName === "Routine Downtime"
    && blueprint.labels.visualTitle === "Top Mesin"
    && blueprint.labels.displayCaption === "Technical Downtime",
  JSON.stringify(blueprint.labels));

section("Filter pertanyaan mengabaikan slicer tampilan");
const questionPolicy = resolveFilterPolicy({
  question: "jelaskan evergreen bulan juni",
  explicitFilters: [{ dimension: "Mesin", value: "Evergreen" }],
  contextFilters: [],
  reportFilters: [{ dimension: "Month", value: "August" }],
});
ok("filter pertanyaan menang", questionPolicy.filters.some((f) => f.value === "Evergreen")
  && questionPolicy.filters.every((f) => f.value !== "August"));

const aliasPolicy = resolveFilterPolicy({
  question: "jelaskan data yang sedang tampil",
  blueprint: { ...blueprint, dimensions: [
    { table: "Calendar", column: "Month", humanName: "Bulan" },
  ] },
  explicitFilters: [{ dimension: "Month", value: "June" }],
  contextFilters: [],
  reportFilters: [{ dimension: "Bulan", value: "August" }],
});
ok("precedence berlaku setelah alias dimensi dicanonicalkan",
  JSON.stringify(aliasPolicy.filters) === JSON.stringify([
    { dimension: "Bulan", value: "June" },
  ]), JSON.stringify(aliasPolicy));

section("Filter report hanya untuk referensi tampilan eksplisit");
const currentView = resolveFilterPolicy({
  question: "jelaskan data yang sedang tampil",
  explicitFilters: [],
  contextFilters: [{ dimension: "Mesin", value: "Evergreen" }],
  reportFilters: [{ dimension: "Month", value: "August" }],
});
ok("current-view mewarisi context lalu report filters",
  JSON.stringify(currentView.filters) === JSON.stringify([
    { dimension: "Mesin", value: "Evergreen" },
    { dimension: "Month", value: "August" },
  ]), JSON.stringify(currentView));

const multiSelect = resolveFilterPolicy({
  question: "jelaskan data yang sedang tampil",
  explicitFilters: [],
  contextFilters: [],
  reportFilters: [
    { dimension: "Mesin", value: "Evergreen" },
    { dimension: "Mesin", value: "Tetra Pak" },
  ],
});
ok("multi-select mempertahankan semua nilai pada precedence yang menang",
  JSON.stringify(multiSelect.filters) === JSON.stringify([
    { dimension: "Mesin", value: "Evergreen" },
    { dimension: "Mesin", value: "Tetra Pak" },
  ]), JSON.stringify(multiSelect));

const allData = resolveFilterPolicy({
  question: "tampilkan keseluruhan data",
  explicitFilters: [],
  contextFilters: [{ dimension: "Mesin", value: "Evergreen" }],
  reportFilters: [{ dimension: "Month", value: "August" }],
});
ok("keseluruhan membuang seluruh report filters",
  allData.filters.some((f) => f.value === "Evergreen")
    && allData.filters.every((f) => f.value !== "August"),
  JSON.stringify(allData));

section("Filter snapshot dinormalisasi menjadi filter report terstruktur");
const extracted = extractReportFilters({
  filters: ["Calendar.Month = August", "Plant.CMD bukan CMD2"],
  slicers: ["Machine.Machine Name is Evergreen, Tetra Pak"],
});
ok("hanya equality filter/slicer yang menjadi kandidat DAX",
  JSON.stringify(extracted) === JSON.stringify([
    { dimension: "Month", value: "August" },
    { dimension: "Machine Name", value: "Evergreen" },
    { dimension: "Machine Name", value: "Tetra Pak" },
  ]), JSON.stringify(extracted));

const associated = extractReportFilters({ filters: ["Calendar.Month = August"] }, {
  dashboardId: "dash-dt",
  bindingId: "b-visual",
});
ok("filter snapshot membawa asosiasi dashboard dan binding",
  associated[0]?.dashboardId === "dash-dt" && associated[0]?.bindingId === "b-visual",
  JSON.stringify(associated));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
