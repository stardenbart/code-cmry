import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { buildDaxPlan, DaxPlanError } from "../src/services/cia/daxPlanBuilder.js";

const schema = {
  berhasil: true,
  model: "Cost Model",
  datasetId: "dataset-cost",
  tabel: [
    { tabel: "Calendar", kolom: ["Date:datetime", "Month:string"] },
    { tabel: "Overtime", kolom: ["Department:string", "Reason:string", "Category:string", "Work Date:datetime"] },
    { tabel: "Quality", kolom: ["Category:string", "Issue Description:string", "CMD:string"] },
    { tabel: "PPIC", kolom: ["Product:string", "PO Type:string"] },
    { tabel: "Plant", kolom: ["Gedung:string"] },
    { tabel: "Measures", kolom: [] },
  ],
  measure: ["OT_HOURS", "NC_CMD3", "PO_QTY"],
};

const period = { label: "Agustus 2026", from: "2026-08-01", to: "2026-08-28", grain: "day" };

function plan(binding, dimensions, selectedPeriod = period) {
  return buildDaxPlan({
    goal: { kpiBindingId: binding.bindingId, dimensions, periodIndex: 0, purpose: "primary" },
    binding,
    period: selectedPeriod,
    schema,
    rowLimit: 500,
  });
}

section("Golden DAX lembur per hari/departemen/alasan/kategori");
const overtime = plan({
  bindingId: "b-ot", semanticModel: "Cost Model", dashboardId: "dash-ot",
  tableName: "Measures", measureName: "OT_HOURS", humanName: "Jam lembur",
  dateTable: "Calendar", dateColumn: "Date",
  dimensions: [
    { table: "Calendar", column: "Date", humanName: "Tanggal" },
    { table: "Overtime", column: "Department", humanName: "Departemen" },
    { table: "Overtime", column: "Reason", humanName: "Alasan" },
    { table: "Overtime", column: "Category", humanName: "Kategori" },
  ],
}, ["Tanggal", "Departemen", "Alasan", "Kategori"]);
ok("plan membawa model/dashboard/periode",
  overtime.semanticModel === "Cost Model" && overtime.dashboardId === "dash-ot"
    && overtime.period.from === "2026-08-01", JSON.stringify(overtime));
ok("DAX dibatasi TOPN 500", /EVALUATE\s+TOPN\(\s*500,/i.test(overtime.dax), overtime.dax);
ok("DAX memakai measure allowlisted", overtime.dax.includes("'Measures'[OT_HOURS]"), overtime.dax);
ok("DAX mengelompokkan empat dimensi",
  ["'Calendar'[Date]", "'Overtime'[Department]", "'Overtime'[Reason]", "'Overtime'[Category]"]
    .every((identifier) => overtime.dax.includes(identifier)), overtime.dax);
ok("DAX memfilter tanggal dari period intent",
  overtime.dax.includes("DATE(2026, 8, 1)") && overtime.dax.includes("DATE(2026, 8, 28)"), overtime.dax);
ok("selected dimensions memakai label manusia",
  JSON.stringify(overtime.selectedDimensions.map((item) => item.humanName))
    === JSON.stringify(["Tanggal", "Departemen", "Alasan", "Kategori"]),
  JSON.stringify(overtime.selectedDimensions));
ok("plan membawa allowlist identifier untuk validasi repair",
  overtime.allowedDaxIdentifiers.includes("Measures[OT_HOURS]")
    && overtime.allowedDaxIdentifiers.includes("Calendar[Date]")
    && overtime.allowedDaxIdentifiers.includes("Overtime[Department]"),
  JSON.stringify(overtime.allowedDaxIdentifiers));
ok("plan membawa binding label tanpa nama measure sebagai label utama",
  overtime.labelBindings[0]?.humanName === "Jam lembur"
    && overtime.labelBindings[0]?.measureName === "OT_HOURS",
  JSON.stringify(overtime.labelBindings));

section("Filter entitas CMD divalidasi dan diterapkan ke DAX");
const cmdFiltered = buildDaxPlan({
  goal: {
    kpiBindingId: "b-dt", dimensions: ["Mesin", "CMD / Gedung"], periodIndex: 0,
    purpose: "primary", filters: [{ dimension: "CMD / Gedung", value: "CMD1" }],
  },
  binding: {
    bindingId: "b-dt", semanticModel: "Cost Model", dashboardId: "dash-dt",
    tableName: "Measures", measureName: "OT_HOURS", humanName: "Durasi downtime",
    dateTable: "Calendar", dateColumn: "Date",
    dimensions: [
      { table: "Overtime", column: "Department", humanName: "Mesin" },
      { table: "Plant", column: "Gedung", humanName: "CMD / Gedung" },
    ],
  },
  period,
  schema,
});
ok("CMD1 menjadi filter nilai kolom allowlisted",
  cmdFiltered.dax.includes("'Plant'[Gedung]")
    && cmdFiltered.dax.includes('SUBSTITUTE')
    && cmdFiltered.dax.includes('"cmd1"'), cmdFiltered.dax);
ok("filter ikut metadata plan", cmdFiltered.selectedFilters?.[0]?.humanName === "CMD / Gedung",
  JSON.stringify(cmdFiltered.selectedFilters));

section("Builder memakai blueprint dan precedence filter");
const visualBinding = {
  bindingId: "b-visual", semanticModel: "Cost Model", dashboardId: "dash-dt",
  tableName: "Quality", measureName: "NC_CMD3", humanName: "Technical downtime",
  dateTable: "Overtime", dateColumn: "Work Date", dimensions: ["Quality[Category]"],
  blueprint: {
    measures: [{ tableName: "Measures", measureName: "OT_HOURS", displayCaption: "Technical downtime" }],
    dimensions: [
      { table: "Overtime", column: "Department", humanName: "Mesin" },
      { table: "Calendar", column: "Month", humanName: "Bulan" },
    ],
    role: "ranking",
    periodPolicy: { dateTable: "Calendar", dateColumn: "Date", dateLogic: "calendar_day" },
    labels: { visualTitle: "Top Mesin", displayCaption: "Technical downtime" },
  },
};
const juneOutsideSlicer = buildDaxPlan({
  question: "jelaskan evergreen bulan juni",
  goal: { kpiBindingId: "b-visual", dimensions: ["Mesin"], filters: [
    { dimension: "Mesin", value: "Evergreen" },
  ] },
  binding: visualBinding,
  period: { label: "Juni", from: "2026-06-01", to: "2026-06-30", grain: "day" },
  reportFilters: [{ dimension: "Bulan", value: "August" }],
  schema,
});
ok("builder memakai measure/date/dimensi blueprint",
  juneOutsideSlicer.dax.includes("'Measures'[OT_HOURS]")
    && juneOutsideSlicer.dax.includes("'Calendar'[Date]")
    && juneOutsideSlicer.dax.includes("'Overtime'[Department]"),
  juneOutsideSlicer.dax);
ok("June dan Evergreen tidak mewarisi slicer August",
  juneOutsideSlicer.dax.includes("DATE(2026, 6, 1)")
    && juneOutsideSlicer.dax.includes('"evergreen"')
    && !juneOutsideSlicer.dax.includes('"august"'),
  juneOutsideSlicer.dax);

const currentViewFiltered = buildDaxPlan({
  question: "jelaskan data yang sedang tampil",
  goal: { kpiBindingId: "b-visual", dimensions: ["Mesin"] },
  binding: visualBinding,
  period,
  contextFilters: [{ dimension: "Mesin", value: "Evergreen" }],
  reportFilters: [{ dimension: "Bulan", value: "August" }],
  schema,
});
ok("current-view memakai context dan report filters",
  currentViewFiltered.selectedFilters.map((item) => item.value).join(",") === "evergreen,august",
  JSON.stringify(currentViewFiltered.selectedFilters));

const allDataPlan = buildDaxPlan({
  question: "tampilkan keseluruhan data",
  goal: { kpiBindingId: "b-visual", dimensions: ["Mesin"] },
  binding: visualBinding,
  period,
  reportFilters: [{ dimension: "Bulan", value: "August" }],
  schema,
});
ok("keseluruhan menolak report filters di builder",
  allDataPlan.selectedFilters.every((item) => item.value !== "august"),
  JSON.stringify(allDataPlan.selectedFilters));

section("Golden DAX deviasi CMD 3 dan PO");
const deviation = plan({
  bindingId: "b-dev", semanticModel: "Cost Model", dashboardId: "dash-dev",
  tableName: "Measures", measureName: "NC_CMD3", humanName: "Deviasi CMD 3",
  dateTable: "Calendar", dateColumn: "Date",
  dimensions: ["Quality[Category]", "Quality[Issue Description]"],
}, ["Category", "Issue Description"]);
ok("deviasi mengelompokkan kategori dan deskripsi",
  deviation.dax.includes("'Quality'[Category]") && deviation.dax.includes("'Quality'[Issue Description]"),
  deviation.dax);
const purchaseOrder = plan({
  bindingId: "b-po", semanticModel: "Cost Model", dashboardId: "dash-po",
  tableName: "Measures", measureName: "PO_QTY", humanName: "Jumlah PO",
  dateTable: "Calendar", dateColumn: "Date",
  dimensions: ["PPIC[Product]", "PPIC[PO Type]"],
}, ["Product", "PO Type"]);
ok("PO mengelompokkan produk dan jenis",
  purchaseOrder.dax.includes("'PPIC'[Product]") && purchaseOrder.dax.includes("'PPIC'[PO Type]"),
  purchaseOrder.dax);

section("Dua periode menghasilkan dua plan dengan filter berbeda");
const july = plan({
  bindingId: "b-ot", semanticModel: "Cost Model", dashboardId: "dash-ot",
  tableName: "Measures", measureName: "OT_HOURS", humanName: "Jam lembur",
  dateTable: "Calendar", dateColumn: "Date", dimensions: ["Overtime[Department]"],
}, ["Department"], { label: "Juli", from: "2026-07-01", to: "2026-07-31", grain: "day" });
ok("filter Juli berbeda dari Agustus",
  july.dax.includes("DATE(2026, 7, 1)") && july.dax.includes("DATE(2026, 7, 31)")
    && july.dax !== overtime.dax, july.dax);

section("Identifier di luar schema ditolak sebelum API call");
function rejected(label, mutate, code) {
  let error = null;
  try {
    const binding = {
      bindingId: "bad", semanticModel: "Cost Model", dashboardId: "dash",
      tableName: "Measures", measureName: "OT_HOURS", humanName: "Jam lembur",
      dateTable: "Calendar", dateColumn: "Date", dimensions: ["Overtime[Department]"],
    };
    mutate(binding);
    plan(binding, ["Department"]);
  } catch (caught) { error = caught; }
  ok(label, error instanceof DaxPlanError && error.code === code,
    `${error?.constructor?.name}:${error?.code}:${error?.message}`);
}
rejected("measure asing ditolak", (binding) => { binding.measureName = "DROP_MEASURE"; }, "MEASURE_NOT_ALLOWED");
rejected("table asing ditolak", (binding) => { binding.tableName = "Secret"; }, "TABLE_NOT_ALLOWED");
rejected("date column asing ditolak", (binding) => { binding.dateColumn = "Secret Date"; }, "DATE_COLUMN_NOT_ALLOWED");
rejected("dimension asing ditolak", (binding) => { binding.dimensions = ["Overtime[Payroll]"]; }, "DIMENSION_NOT_ALLOWED");

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
