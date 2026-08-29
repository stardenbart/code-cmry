import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { CIA_HYBRID_REGRESSION_CASES } from "./fixtures/cia-regression-cases.mjs";
import { buildIntentFrame } from "../src/services/cia/intentFrame.js";

function hasValues(values, expected) {
  return expected.every((value) => values.includes(value));
}

section("Intent frame menangkap beberapa konsep dan entitas");
const downtime = buildIntentFrame({
  question: "waktu downtime tetra pak line 3 dan 6 berapa jam dan berapa persen running hours",
});
ok("downtime + running hours", hasValues(downtime.concepts, ["downtime", "running hours"]));
ok("dua mesin dipertahankan", downtime.entities.some((entity) => entity.value.includes("tetra pak line 3"))
  && downtime.entities.some((entity) => entity.value.includes("tetra pak line 6")));

const production = buildIntentFrame({ question: "achievement produksi dan fulfillment PO minggu ini" });
ok("production + PO", hasValues(production.concepts, ["production", "purchase order"]));

section("Vocabulary dapat diinjeksi tanpa handler domain baru");
const injected = buildIntentFrame({ question: "yield aseptik line 4" }, {
  vocabulary: { concepts: [{ value: "aseptic yield", phrases: ["yield aseptik"] }] },
});
ok("concept dari vocabulary injeksi", injected.concepts.includes("aseptic yield"));

section("Source constraint dan follow-up tetap eksplisit");
const constrained = buildIntentFrame({
  question: "ambil sumber dari dashboard nc dan deviasi saja",
  preferredDashboardIds: ["7", "7", 8, ""],
});
ok("source dashboard dipertahankan", hasValues(constrained.sourceConstraints.map((item) => item.value), ["nc", "deviasi"]));
ok("source dashboard mempertahankan type", constrained.sourceConstraints
  .every((item) => item.type === "dashboard"));
ok("preferred dashboard unik", JSON.stringify(constrained.preferredDashboardIds) === JSON.stringify(["7", "8"]));

const reportConstrained = buildIntentFrame({ question: "gunakan report maintenance saja" });
ok("source report mempertahankan type dan value", reportConstrained.sourceConstraints
  .some((item) => item.type === "report" && item.value === "maintenance"));

const followUp = buildIntentFrame({
  question: "coba jelaskan techical downtime nya saja",
  conversation: [{ role: "user", text: "apakah produksi hari ini ada kendala?" }],
});
ok("follow-up diklasifikasikan sebagai refinement", followUp.continuity === "refinement", followUp.continuity);

const evidenceFollowUp = buildIntentFrame({
  question: "berapa persentasenya terhadap used time?",
  conversation: [{
    role: "assistant", text: "Downtime Evergreen 42 menit.", evidenceContract: {
      concepts: ["downtime"],
      entities: [{ type: "machine", value: "evergreen" }],
      periods: [{ label: "Juni", from: "2026-06-01", to: "2026-06-30", grain: "day" }],
      sources: [{ dashboardId: "44", dashboardName: "Maintenance" }],
      goals: [],
    },
  }],
});
ok("contract mengisi context source nyata untuk priority 200",
  evidenceFollowUp.contextSources?.[0]?.dashboardId === "44"
    && evidenceFollowUp.context?.sources?.[0]?.dashboardId === "44",
  JSON.stringify(evidenceFollowUp));
ok("entity, periode, dan denominator diwarisi sebelum routing",
  evidenceFollowUp.entities.some((item) => item.value === "evergreen")
    && evidenceFollowUp.contextPeriods?.[0]?.from === "2026-06-01"
    && hasValues(evidenceFollowUp.concepts, ["downtime", "running hours"]),
  JSON.stringify(evidenceFollowUp));

section("Corpus hybrid 27 pertanyaan tetap dapat diparse");
ok("corpus menyimpan 27 pertanyaan persis", CIA_HYBRID_REGRESSION_CASES.length === 27
  && CIA_HYBRID_REGRESSION_CASES.filter((item) => item.question.includes("@CODE AI")).length === 0);
for (const testCase of CIA_HYBRID_REGRESSION_CASES) {
  const frame = buildIntentFrame({ question: testCase.question });
  ok(`${testCase.id}: konsep`, hasValues(frame.concepts, testCase.expectsConcepts), JSON.stringify(frame));
  ok(`${testCase.id}: entitas`, testCase.expectsEntities.every((value) => frame.entities
    .some((entity) => entity.value.includes(value))), JSON.stringify(frame.entities));
  ok(`${testCase.id}: operasi`, hasValues(frame.operations, testCase.expectsOperations), JSON.stringify(frame.operations));
  if (testCase.expectsPeriodKind) {
    ok(`${testCase.id}: periode`, frame.periodKinds.includes(testCase.expectsPeriodKind), JSON.stringify(frame.periodKinds));
  }
  if (testCase.expectsSource) {
    ok(`${testCase.id}: sumber`, hasValues(frame.sourceConstraints.map((item) => item.value), testCase.expectsSource));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
