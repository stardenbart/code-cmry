import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { CIA_REGRESSION_CASES } from "./fixtures/cia-regression-cases.mjs";
import {
  normalizeAnswer,
  normalizeEnvelope,
} from "../src/services/cia/contracts.js";

section("Regression corpus menjaga pertanyaan produksi yang disetujui");
ok("corpus memuat lima kasus unik", CIA_REGRESSION_CASES.length === 5
  && new Set(CIA_REGRESSION_CASES.map((item) => item.id)).size === 5);
ok("korelasi lembur dan PO meminta dua domain",
  CIA_REGRESSION_CASES.find((item) => item.id === "overtime-po-correlation")?.expects?.length === 2);
ok("perbandingan bulan dan tahun meminta dua periode",
  CIA_REGRESSION_CASES.filter((item) => item.expectsPeriods === 2).length === 2);

section("Request envelope dinormalisasi tanpa memperluas akses");
const request = normalizeEnvelope({
  requestId: " req-123 ",
  surface: "unknown-client-surface",
  actor: { userId: "7", name: "  Rina  ", department: " Production " },
  question: "  bandingkan lembur bulan lalu  ",
  conversationId: 99,
  preferredDashboardIds: ["dash-a", "dash-a", "", 22],
  accessMode: "centralized",
  snapshotFallback: { period: "2026-07", text: "fallback" },
});
ok("surface asing turun ke dashboard", request.surface === "dashboard", request.surface);
ok("akses dari envelope publik turun ke user_acl", request.accessMode === "user_acl", request.accessMode);
ok("question dan actor dirapikan", request.question === "bandingkan lembur bulan lalu"
  && request.actor.name === "Rina" && request.actor.department === "Production");
ok("actor userId menjadi integer positif", request.actor.userId === 7, String(request.actor.userId));
ok("preferred dashboard unik dan hanya string non-kosong",
  JSON.stringify(request.preferredDashboardIds) === JSON.stringify(["dash-a"]),
  JSON.stringify(request.preferredDashboardIds));
ok("conversation id aman menjadi string", request.conversationId === "99", String(request.conversationId));
ok("snapshot fallback yang valid dipertahankan", request.snapshotFallback?.text === "fallback");

const internal = normalizeEnvelope({
  surface: "whatsapp",
  accessMode: "centralized",
  question: "update",
}, { allowCentralized: true });
ok("centralized hanya dipertahankan untuk internal WA/schedule",
  internal.accessMode === "centralized", internal.accessMode);

const evidenceContract = {
  concepts: ["downtime"], entities: [{ type: "machine", value: "evergreen" }],
  periods: [{ label: "Juni", from: "2026-06-01", to: "2026-06-30", grain: "day" }],
  sources: [{ dashboardId: "44", dashboardName: "Maintenance" }], goals: [],
};
const followUpEnvelope = normalizeEnvelope({
  question: "berapa persentasenya?",
  conversation: [
    { role: "user", text: "downtime evergreen bulan juni" },
    { role: "assistant", text: "42 menit", evidenceContract },
  ],
});
ok("conversation lama tetap menjadi history teks normal",
  followUpEnvelope.conversation[0]?.text === "downtime evergreen bulan juni"
    && !Object.hasOwn(followUpEnvelope.conversation[0], "evidenceContract"),
  JSON.stringify(followUpEnvelope.conversation));
ok("contract assistant ikut dinormalisasi tanpa raw metadata lain",
  followUpEnvelope.conversation[1]?.evidenceContract?.sources?.[0]?.dashboardId === "44",
  JSON.stringify(followUpEnvelope.conversation));

section("Answer envelope selalu lengkap dan memakai default aman");
const answer = normalizeAnswer({
  answer: 42,
  requestId: " req-123 ",
  confidence: "certain",
  retrievalMethod: "magic",
  sources: [null, { dashboardId: 2, dashboardName: " Lembur ", period: " Juli ", kpis: ["Jam lembur", ""], rowCount: -5 }],
  warnings: [" live gagal ", "", 12],
  usage: { inputTokens: "15", outputTokens: -2, totalTokens: "17" },
  rounds: -4,
});
ok("answer non-string tidak dibocorkan", answer.answer === "", JSON.stringify(answer.answer));
ok("enum invalid memakai default aman",
  answer.confidence === "low" && answer.retrievalMethod === "none",
  `${answer.confidence}/${answer.retrievalMethod}`);
ok("source invalid dibuang dan source valid dinormalisasi",
  answer.sources.length === 1 && answer.sources[0].dashboardId === "2"
    && answer.sources[0].dashboardName === "Lembur" && answer.sources[0].rowCount === 0,
  JSON.stringify(answer.sources));
ok("warnings hanya string non-kosong", JSON.stringify(answer.warnings) === JSON.stringify(["live gagal"]));
ok("usage selalu angka non-negatif dan total konsisten",
  answer.usage.inputTokens === 15 && answer.usage.outputTokens === 0 && answer.usage.totalTokens === 17,
  JSON.stringify(answer.usage));
ok("rounds negatif menjadi nol", answer.rounds === 0, String(answer.rounds));

const defaults = normalizeAnswer();
ok("default memiliki seluruh contract field",
  Object.keys(defaults).sort().join(",")
    === "answer,confidence,evidenceContract,requestId,retrievalMethod,rounds,sources,usage,warnings");
ok("default arrays/usage aman",
  defaults.sources.length === 0 && defaults.warnings.length === 0
    && defaults.usage.inputTokens === 0 && defaults.usage.outputTokens === 0
    && defaults.usage.totalTokens === 0);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
