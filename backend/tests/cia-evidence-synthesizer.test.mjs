import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { synthesizeEvidence } from "../src/services/cia/evidenceSynthesizer.js";

const overtime = {
  status: "success",
  rows: [{ Tanggal: "2026-08-20", Departemen: "Produksi A", "Jam lembur": 120 }],
  columns: [{ label: "Tanggal" }, { label: "Departemen" }, { label: "Jam lembur" }],
  rowCount: 1,
  period: { label: "Agustus 2026", from: "2026-08-01", to: "2026-08-28" },
  source: { dashboardId: "d-ot", dashboardName: "Dashboard Lembur", semanticModel: "Cost",
    kpis: ["Jam lembur"] },
};
const po = {
  status: "success",
  rows: [{ Produk: "Milk A", "Jumlah PO": 1500 }],
  columns: [{ label: "Produk" }, { label: "Jumlah PO" }],
  rowCount: 1,
  period: { label: "Agustus 2026", from: "2026-08-01", to: "2026-08-28" },
  source: { dashboardId: "d-po", dashboardName: "Dashboard PPIC", semanticModel: "PPIC",
    kpis: ["Jumlah PO"] },
};

function modelReply(value, inspect) {
  return async (input) => {
    inspect?.(input);
    return {
      text: JSON.stringify(value), provider: "gemini", model: "gemini-test",
      usage: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
    };
  };
}

section("Jawaban live membawa citation, period, dan confidence");
let packet = null;
const live = await synthesizeEvidence({
  question: "apakah lembur produksi A tinggi karena PO naik",
  evidence: [overtime, po],
  warnings: [],
}, {
  callModel: modelReply({
    answer: "Lembur Produksi A tinggi karena PO Milk A naik.",
    citedSourceIndexes: [0, 1],
  }, (input) => { packet = JSON.parse(input.question); }),
});
ok("dua source dan periode terlihat di jawaban",
  live.answer.includes("Dashboard Lembur") && live.answer.includes("Dashboard PPIC")
    && live.answer.includes("2026-08-01") && live.answer.includes("2026-08-28"),
  live.answer);
ok("bahasa kausal diturunkan menjadi korelasi",
  !/karena PO/i.test(live.answer) && /berkorelasi|berkaitan/i.test(live.answer), live.answer);
ok("live lengkap confidence high",
  live.confidence === "high" && live.retrievalMethod === "live_dax", JSON.stringify(live));
ok("usage/provider/model diteruskan",
  live.usage.totalTokenCount === 30 && live.provider === "gemini" && live.model === "gemini-test",
  JSON.stringify(live));
ok("packet hanya memuat label manusia",
  JSON.stringify(packet).includes("Jam lembur") && !JSON.stringify(packet).includes("OT_HOURS"),
  JSON.stringify(packet));

section("Snapshot diabaikan saat live evidence lengkap");
const liveWithSnapshot = await synthesizeEvidence({
  question: "jelaskan lembur",
  evidence: [overtime],
  snapshotFallback: { text: "snapshot lama", dashboards: [{ id: "d-ot", name: "Dashboard Lembur" }] },
}, { callModel: modelReply({ answer: "Jam lembur 120.", citedSourceIndexes: [0] }) });
ok("hasil tetap live_dax tanpa warning snapshot", liveWithSnapshot.retrievalMethod === "live_dax"
  && !liveWithSnapshot.warnings.includes("SNAPSHOT_FALLBACK_USED"), JSON.stringify(liveWithSnapshot));

section("Model synthesis gagal tetap menjawab dari bukti live unik");
const duplicatedLive = { ...overtime, source: { ...overtime.source, dashboardId: "d-ot-copy" } };
const synthesisFailure = await synthesizeEvidence({
  question: "top mesin downtime tertinggi",
  evidence: [overtime, duplicatedLive],
}, {
  async callModel() { throw new Error("provider unavailable"); },
});
ok("fallback tidak menyatakan bukti tidak tersedia",
  !/bukti data.*belum tersedia/i.test(synthesisFailure.answer), synthesisFailure.answer);
ok("fallback menampilkan label dan nilai live",
  synthesisFailure.answer.includes("Produksi A") && synthesisFailure.answer.includes("120"),
  synthesisFailure.answer);
ok("fallback mempertahankan live_dax dan warning telemetry",
  synthesisFailure.retrievalMethod === "live_dax"
    && synthesisFailure.warnings.includes("SYNTHESIS_FAILED"), JSON.stringify(synthesisFailure));
ok("sumber semantik yang sama dideduplikasi",
  synthesisFailure.sources.length === 1, JSON.stringify(synthesisFailure.sources));

const technicalDowntime = {
  ...overtime,
  rows: [
    { nama_mesin: "Mesin A", Issue: "Bocor", Action: "Ganti seal", gedung: "CMD 1", "Top mesin downtime tertinggi": 12 },
    { nama_mesin: "Mesin B", Issue: "Macet", Action: "Bersihkan", gedung: "CMD 1", "Top mesin downtime tertinggi": 10 },
    { nama_mesin: "Mesin C", Issue: "Sensor", Action: "Kalibrasi", gedung: "CMD 1", "Top mesin downtime tertinggi": 8 },
    { nama_mesin: "Mesin D", Issue: "Motor &amp; gearbox", Action: "Perbaiki", gedung: "CMD 1", "Top mesin downtime tertinggi": 14 },
  ],
  rowCount: 4,
  source: { dashboardId: "d-dt", dashboardName: "Technical Downtime ORS", semanticModel: "ORS",
    kpis: ["Top mesin downtime tertinggi"] },
};
const rankedFallback = await synthesizeEvidence({
  question: "top 3 mesin downtime tertinggi pada CMD1 bulan Juni",
  evidence: [technicalDowntime],
}, { async callModel() { throw new Error("synthesis unavailable"); } });
ok("fallback menghormati jumlah top 3",
  rankedFallback.answer.includes("Mesin D") && rankedFallback.answer.includes("Mesin B")
    && !rankedFallback.answer.includes("Mesin C"),
  rankedFallback.answer);
ok("fallback mengurutkan nilai terbesar dan mendekode entitas HTML",
  rankedFallback.answer.indexOf("Mesin D") < rankedFallback.answer.indexOf("Mesin A")
    && rankedFallback.answer.includes("Motor & gearbox") && !rankedFallback.answer.includes("&amp;"),
  rankedFallback.answer);
ok("fallback tidak menampilkan nama kolom teknis",
  !rankedFallback.answer.includes("nama_mesin") && !rankedFallback.answer.includes("Issue:")
    && !rankedFallback.answer.includes("Action:"), rankedFallback.answer);
ok("fallback memakai label bisnis Indonesia",
  rankedFallback.answer.includes("Mesin:") && rankedFallback.answer.includes("Masalah:")
    && rankedFallback.answer.includes("Tindakan:"), rankedFallback.answer);

let rankedPacket;
await synthesizeEvidence({
  question: "top 3 mesin downtime tertinggi pada CMD1 bulan Juni",
  evidence: [technicalDowntime],
}, { callModel: modelReply({ answer: "Tiga mesin teratas tersedia.", citedSourceIndexes: [0] },
  (input) => { rankedPacket = JSON.parse(input.question); }) });
ok("jalur synthesis normal juga hanya menerima tiga mesin unik terurut",
  rankedPacket.sources[0].rows.length === 3
    && rankedPacket.sources[0].rows[0].Mesin === "Mesin D"
    && rankedPacket.sources[0].rows[2].Mesin === "Mesin B"
    && rankedPacket.sources[0].rows[0].Masalah === "Motor & gearbox",
  JSON.stringify(rankedPacket.sources[0].rows));

section("Bahasa kausal luas diturunkan tanpa dua bukti kompatibel");
const causalSingle = await synthesizeEvidence({
  question: "apa yang menyebabkan lembur naik",
  evidence: [overtime],
}, { callModel: modelReply({ answer: "PO memicu dan menyebabkan lembur naik akibat permintaan.", citedSourceIndexes: [0] }) });
ok("memicu/menyebabkan/akibat tidak lolos sebagai kausal", !/memicu|menyebabkan|akibat/i.test(causalSingle.answer), causalSingle.answer);
ok("warning bukti korelasi tidak cukup", causalSingle.warnings.includes("CORRELATION_EVIDENCE_INSUFFICIENT"),
  JSON.stringify(causalSingle));
ok("klaim korelasi ditahan menjadi limitation", /belum cukup|sedikitnya dua sumber/i.test(causalSingle.answer),
  causalSingle.answer);

section("Invalid citation dibuang dan confidence diturunkan");
const invalidCitation = await synthesizeEvidence({
  question: "jelaskan lembur",
  evidence: [overtime],
  warnings: [],
}, {
  callModel: modelReply({ answer: "Jam lembur 120.", citedSourceIndexes: [99] }),
});
ok("citation invalid tidak ditampilkan", !invalidCitation.answer.includes("Sumber 99"), invalidCitation.answer);
ok("confidence turun medium", invalidCitation.confidence === "medium", JSON.stringify(invalidCitation));
ok("warning invalid citation", invalidCitation.warnings.includes("INVALID_SOURCE_CITATION"),
  JSON.stringify(invalidCitation));

section("Snapshot fallback disebut terang-terangan");
const mixed = await synthesizeEvidence({
  question: "jelaskan lembur dan PO",
  evidence: [overtime, { status: "failed", errorCode: "POWERBI_TIMEOUT", source: po.source, period: po.period }],
  warnings: ["POWERBI_TIMEOUT"],
  snapshotFallback: { text: "Ringkasan PPIC terakhir: PO 1400", period: "2026-08-01 sampai 2026-08-28",
    dashboards: [{ id: "d-po", name: "Dashboard PPIC" }] },
}, {
  callModel: modelReply({ answer: "Bukti live lembur tersedia; PPIC memakai ringkasan terakhir.", citedSourceIndexes: [0, 1] }),
});
ok("mixed method dan medium confidence",
  mixed.retrievalMethod === "mixed" && mixed.confidence === "medium", JSON.stringify(mixed));
ok("warning snapshot eksplisit pada jawaban",
  mixed.answer.includes("data snapshot") && mixed.warnings.includes("SNAPSHOT_FALLBACK_USED"),
  JSON.stringify(mixed));

section("Snapshot-only low confidence");
const snapshotOnly = await synthesizeEvidence({
  question: "berapa lembur",
  evidence: [],
  snapshotFallback: { text: "Total jam lembur 7 jam", period: "2026-08-24 sampai 2026-08-30",
    dashboards: [{ id: "d-ot", name: "Dashboard Lembur" }] },
}, {
  callModel: modelReply({ answer: "Total jam lembur 7 jam.", citedSourceIndexes: [0] }),
});
ok("snapshot-only method/low", snapshotOnly.retrievalMethod === "snapshot"
  && snapshotOnly.confidence === "low", JSON.stringify(snapshotOnly));
ok("snapshot-only tidak menyamar sebagai live", snapshotOnly.answer.includes("data snapshot"), snapshotOnly.answer);

section("Snapshot model packet dan jawaban tidak membawa identifier teknis atau nilai filter mentah");
let safeSnapshotPacket;
const safeSnapshot = await synthesizeEvidence({
  question: "berapa performa supplier",
  evidence: [],
  snapshotFallback: {
    text: "'MeasureTable'[OT_HOURS]: 7; Supplier.Name = MITRA_1",
    period: "Agustus 2026",
    dashboards: [{ id: "d-safe", name: "Supplier OT",
      text: "OT_HOURS: 7; Supplier.Name = MITRA_1" }],
  },
}, {
  callModel: async (args) => {
    safeSnapshotPacket = JSON.parse(args.question);
    return modelReply({ answer: "OT_HOURS 7 untuk MITRA_1.", citedSourceIndexes: [0] })();
  },
});
ok("packet snapshot memakai label manusia dan tidak punya filter asli",
  !/OT_HOURS|Supplier\.Name|AJI/.test(JSON.stringify(safeSnapshotPacket))
    && /Ot hours/.test(JSON.stringify(safeSnapshotPacket)),
  JSON.stringify(safeSnapshotPacket));
ok("jawaban snapshot tidak mengekspos identifier teknis atau filter asli",
  !/OT_HOURS|Supplier\.Name|AJI/.test(safeSnapshot.answer) && /Ot hours/.test(safeSnapshot.answer),
  safeSnapshot.answer);

section("Tanpa bukti menghasilkan keterbatasan jujur tanpa memanggil AI");
let calls = 0;
const none = await synthesizeEvidence({ question: "jelaskan deviasi", evidence: [] }, {
  async callModel() { calls += 1; throw new Error("tidak boleh dipanggil"); },
});
ok("tidak ada AI call", calls === 0, String(calls));
ok("jawaban menyatakan bukti tidak tersedia",
  /belum tersedia|tidak tersedia|tidak cukup/i.test(none.answer), none.answer);
ok("method none dan low", none.retrievalMethod === "none" && none.confidence === "low",
  JSON.stringify(none));

section("Evidence yang tidak cocok intent dibuang sebelum synthesis");
let relevanceCalls = 0;
const mismatched = await synthesizeEvidence({
  question: "berapa downtime Evergreen dari Maintenance Downtime bulan Juni",
  evidence: [{
    status: "success", rows: [{ Mesin: "ORS", "Durasi downtime": 91 }],
    period: { from: "2026-07-01", to: "2026-07-31" },
    source: { dashboardId: "d-ors", dashboardName: "Dashboard DT ORS", kpis: ["Durasi downtime"] },
    intentMatch: { concepts: true, entities: false, period: false, source: false },
  }],
  snapshotFallback: {
    text: "ORS 91 menit", period: "Juli 2026", dashboards: [{ id: "d-ors", name: "Dashboard DT ORS" }],
  },
}, { callModel: async () => { relevanceCalls += 1; throw new Error("tidak boleh dipanggil"); } });
ok("mismatch tidak dikirim ke model", relevanceCalls === 0, String(relevanceCalls));
ok("row dan dashboard lain tidak masuk jawaban",
  !/ORS|91|Dashboard DT ORS/i.test(mismatched.answer), mismatched.answer);
ok("keterbatasan menyebut kategori mismatch",
  /entitas|periode|sumber/i.test(mismatched.answer)
    && mismatched.warnings.includes("EVIDENCE_RELEVANCE_MISMATCH"),
  JSON.stringify(mismatched));
ok("mismatch tidak diganti snapshot", mismatched.retrievalMethod === "none", JSON.stringify(mismatched));

let filteredPacket;
const relevantOnly = await synthesizeEvidence({
  question: "berapa downtime Evergreen",
  evidence: [
    { ...overtime, intentMatch: { concepts: true, entities: true, period: true, source: true } },
    { ...po, rows: [{ Mesin: "ORS", "Jam downtime": 91 }],
      intentMatch: { concepts: false, entities: false, period: true, source: false } },
  ],
}, { callModel: async (args) => {
  filteredPacket = JSON.parse(args.question);
  return modelReply({ answer: "Downtime Evergreen tersedia.", citedSourceIndexes: [0] })();
} });
ok("packet hanya memuat evidence relevan",
  filteredPacket?.sources?.length === 1 && !JSON.stringify(filteredPacket).includes("ORS"),
  JSON.stringify(filteredPacket));
ok("partial mismatch diberi warning", relevantOnly.warnings.includes("EVIDENCE_RELEVANCE_MISMATCH"),
  JSON.stringify(relevantOnly));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
