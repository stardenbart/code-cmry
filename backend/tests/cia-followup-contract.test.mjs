import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import {
  createEvidenceContract,
  resolveFollowUpContext,
} from "../src/services/cia/evidenceContract.js";

const previousDowntimeContract = createEvidenceContract({
  intentFrame: {
    concepts: ["downtime"],
    entities: [{ type: "machine", value: "evergreen" }],
  },
  periods: [{ label: "Juni 2026", from: "2026-06-01", to: "2026-06-30", grain: "day" }],
  goals: [{
    kpiBindingId: "binding-downtime",
    dimensions: ["Mesin"],
    periodIndex: 0,
    purpose: "primary",
    filters: [{ dimension: "Mesin", value: "Evergreen" }],
  }],
  evidence: [{
    rows: [{ Mesin: "Evergreen", Menit: 42 }],
    dax: "EVALUATE ROW(\"secret\", 1)",
    source: { dashboardId: "44", dashboardName: "Maintenance", semanticModel: "maintenance" },
  }],
});

section("Follow-up mewarisi bukti relevan");
const inherited = resolveFollowUpContext({
  question: "berapa persentasenya terhadap used time?",
  conversation: [{ role: "assistant", evidenceContract: previousDowntimeContract }],
});
ok("mewarisi downtime source", inherited.sources[0]?.dashboardId === "44", JSON.stringify(inherited));
ok("menambah denominator", inherited.requiredConcepts.includes("running hours"), JSON.stringify(inherited));
ok("mewarisi mesin dan periode", inherited.entities[0]?.value === "evergreen"
  && inherited.periods[0]?.from === "2026-06-01", JSON.stringify(inherited));

section("Topic switch memutus konteks domain lama");
const switched = resolveFollowUpContext({
  question: "sekarang rekap overtime bulan juli",
  conversation: [{ role: "assistant", evidenceContract: previousDowntimeContract }],
});
ok("topic switch tidak membawa mesin", switched.entities.length === 0, JSON.stringify(switched));
ok("topic switch tidak membawa source", switched.sources.length === 0, JSON.stringify(switched));

section("Contract bounded dan hanya metadata aman");
const oversized = createEvidenceContract({
  intentFrame: {
    concepts: Array.from({ length: 20 }, (_, index) => `concept-${index}`),
    entities: Array.from({ length: 20 }, (_, index) => ({ type: "machine", value: `machine-${index}` })),
  },
  periods: Array.from({ length: 10 }, (_, index) => ({
    label: `period-${index}`, from: "2026-01-01", to: "2026-01-31", grain: "day",
  })),
  goals: Array.from({ length: 10 }, (_, index) => ({
    kpiBindingId: `binding-${index}`,
    dimensions: ["Machine"],
    periodIndex: 0,
    purpose: "primary",
    filters: Array.from({ length: 20 }, (__, filterIndex) => ({
      dimension: "Machine", value: `machine-${filterIndex}`,
    })),
    dax: "EVALUATE secret",
  })),
  evidence: Array.from({ length: 10 }, (_, index) => ({
    rows: [{ secret: index }],
    dax: "EVALUATE secret",
    source: { dashboardId: String(index), dashboardName: `Dashboard ${index}` },
  })),
});
const serialized = JSON.stringify(oversized);
ok("maksimum enam source dan goal", oversized.sources.length === 6 && oversized.goals.length === 6,
  `${oversized.sources.length}/${oversized.goals.length}`);
ok("maksimum dua belas entity dan filter", oversized.entities.length === 12
  && oversized.goals.flatMap((goal) => goal.filters).length === 12,
  `${oversized.entities.length}/${oversized.goals.flatMap((goal) => goal.filters).length}`);
ok("row mentah dan DAX tidak tersimpan", !serialized.includes("rows")
  && !serialized.includes("EVALUATE") && !serialized.includes("secret"), serialized);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
