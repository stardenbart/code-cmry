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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
