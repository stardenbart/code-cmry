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

section("Turn assistant tanpa contract menjadi batas lineage");
const afterSnapshot = resolveFollowUpContext({
  question: "lanjutkan yang barusan",
  conversation: [
    { role: "assistant", text: "Downtime Evergreen 42 menit", evidenceContract: previousDowntimeContract },
    { role: "user", text: "sekarang lihat lembur" },
    { role: "assistant", text: "Ringkasan snapshot lembur tersedia" },
  ],
});
ok("snapshot contract-less tidak mencari-through contract live lama",
  afterSnapshot.sources.length === 0 && afterSnapshot.entities.length === 0 && afterSnapshot.periods.length === 0,
  JSON.stringify(afterSnapshot));

const fullConceptContract = createEvidenceContract({
  intentFrame: { concepts: ["downtime", ...Array.from({ length: 11 }, (_, index) => `stale-${index}`)] },
});
const fullConceptFollowUp = resolveFollowUpContext({
  question: "berapa persentasenya terhadap used time?",
  conversation: [{ role: "assistant", evidenceContract: fullConceptContract }],
});
ok("derived denominator bertahan saat contract sudah dua belas konsep",
  fullConceptFollowUp.requiredConcepts.length === 12
    && fullConceptFollowUp.requiredConcepts.includes("running hours"),
  JSON.stringify(fullConceptFollowUp.requiredConcepts));

section("Topic switch memutus konteks domain lama");
const switched = resolveFollowUpContext({
  question: "sekarang rekap overtime bulan juli",
  conversation: [{ role: "assistant", evidenceContract: previousDowntimeContract }],
});
ok("topic switch tidak membawa mesin", switched.entities.length === 0, JSON.stringify(switched));
ok("topic switch tidak membawa source", switched.sources.length === 0, JSON.stringify(switched));

const injectedSwitch = resolveFollowUpContext({
  question: "sekarang rekap quality reject bulan juli",
  currentConcepts: ["quality reject"],
  conversation: [{ role: "assistant", evidenceContract: previousDowntimeContract }],
});
ok("konsep vocabulary baru memutus source dan entitas lama", injectedSwitch.sources.length === 0
  && injectedSwitch.entities.length === 0, JSON.stringify(injectedSwitch));

const previousProductionContract = createEvidenceContract({
  intentFrame: {
    concepts: ["production output"],
    entities: [{ type: "product", value: "uht milk 250ml" }],
  },
  periods: [{ label: "Juli 2026", from: "2026-07-01", to: "2026-07-31", grain: "day" }],
  evidence: [{ source: { dashboardId: "77", dashboardName: "Production Output" } }],
});
const productionRefinement = resolveFollowUpContext({
  question: "produksi bulan ini bagaimana?",
  currentConcepts: ["production"],
  conversation: [{ role: "assistant", evidenceContract: previousProductionContract }],
});
ok("konsep lebih umum dalam family yang sama mempertahankan context",
  productionRefinement.sources[0]?.dashboardId === "77"
    && productionRefinement.entities[0]?.value === "uht milk 250ml",
  JSON.stringify(productionRefinement));

section("Contract bounded dan hanya metadata aman");
const metricRoles = createEvidenceContract({
  goals: [
    { kpiBindingId: "binding-valid", metricRole: "numerator" },
    { kpiBindingId: "binding-invalid", metricRole: "not-a-supported-role" },
  ],
});
ok("metric role hanya menyimpan enum yang didokumentasikan",
  JSON.stringify(metricRoles.goals.map((goal) => goal.metricRole))
    === JSON.stringify(["numerator", "primary"]),
  JSON.stringify(metricRoles.goals));

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
