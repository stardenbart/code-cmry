process.env.CIA_TELEMETRY_ENABLED = "true";

import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { jawabPertanyaanUmum } from "../src/services/whatsappListener.service.js";
import { resolveFollowUpContext } from "../src/services/cia/evidenceContract.js";

function fixture({ evidence, snapshot, attempts, failSendAt = 0 }) {
  const calls = { envelope: null, evidenceEnvelopes: [], events: [], finishes: [], failures: [], messages: [] };
  const tracker = {
    requestId: "wa-test-request",
    event: async (stage, data = {}) => calls.events.push({ stage, ...data }),
    finish: async (data) => calls.finishes.push(data),
    fail: async (error, data) => calls.failures.push({ error, data }),
  };
  return {
    calls,
    sock: { sendMessage: async (_jid, body) => {
      calls.messages.push(body.text);
      if (failSendAt && calls.messages.length === failSendAt) throw new Error("WA disconnected");
    } },
    deps: {
      startCiaTelemetry: async (envelope) => { calls.envelope = envelope; return tracker; },
      jawabDenganDax: async () => { calls.legacyDaxCalls = (calls.legacyDaxCalls || 0) + 1; },
      answerWithEvidence: async (envelope, injected = {}) => {
        calls.evidenceEnvelopes.push(envelope);
        const answer = typeof evidence === "function" ? evidence(envelope) : evidence;
        for (const attempt of attempts || [{
          semanticModel: "Model A", rowsReturned: answer?.sources?.[0]?.rowCount || 0,
          status: answer?.retrievalMethod === "live_dax" ? "success" : "error",
        }]) await injected.tracker?.event("dax_attempt", attempt);
        await injected.tracker?.event("ai_synthesis", {
          provider: "gemini", aiModel: "gemini-test", inputTokens: 10, outputTokens: 4, totalTokens: 14,
        });
        await injected.tracker?.finish({
          status: answer?.retrievalMethod === "live_dax" ? "success" : "error",
          retrievalMethod: answer?.retrievalMethod || "none", retrievalRounds: answer?.rounds || 0,
        });
        return answer;
      },
      jawabDariSnapshot: async () => snapshot,
    },
  };
}

section("WA DAX live tercatat end-to-end");
{
  const f = fixture({
    evidence: {
      answer: "jawaban live", requestId: "wa-test-request", confidence: "high",
      retrievalMethod: "live_dax", rounds: 2, warnings: [],
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      sources: [{ dashboardId: "10", dashboardName: "Lembur", rowCount: 4 }],
      evidenceContract: { concepts: ["overtime"], entities: [], periods: [], sources: [{ dashboardId: "10" }], goals: [] },
    },
    snapshot: null,
  });
  await jawabPertanyaanUmum(f.sock, "120@g.us", {}, "lembur harian", f.deps);
  ok("surface whatsapp", f.calls.envelope?.surface === "whatsapp");
  ok("JID menjadi conversation ref", f.calls.envelope?.conversationId === "120@g.us");
  ok("WA memakai envelope orchestrator terpusat",
    f.calls.evidenceEnvelopes[0]?.surface === "whatsapp"
      && f.calls.evidenceEnvelopes[0]?.accessMode === "centralized"
      && Array.isArray(f.calls.evidenceEnvelopes[0]?.conversation)
      && Array.isArray(f.calls.evidenceEnvelopes[0]?.preferredDashboardIds),
    JSON.stringify(f.calls.evidenceEnvelopes[0]));
  ok("WA tidak lagi memanggil jawabDenganDax legacy", !f.calls.legacyDaxCalls,
    String(f.calls.legacyDaxCalls || 0));
  ok("request_received tercatat", f.calls.events.some((e) => e.stage === "request_received"));
  ok("execute_dax mencatat semantic model", f.calls.events.some((e) => e.stage === "dax_attempt" && e.semanticModel === "Model A"));
  ok("nama event telemetry WA legacy tetap tersedia",
    f.calls.events.some((e) => e.stage === "execute_dax" && e.semanticModel === "Model A" && e.status === "success"));
  ok("provider, model, token WA tercatat", f.calls.events.some((e) => e.stage === "ai_synthesis" && e.provider === "gemini" && e.aiModel === "gemini-test" && e.totalTokens === 14));
  ok("finish live_dax sekali", f.calls.finishes.length === 1 && f.calls.finishes[0].retrievalMethod === "live_dax");
  ok("tidak fail", f.calls.failures.length === 0);
}

section("Fallback snapshot dinyatakan transparan di telemetry");
{
  const f = fixture({
    evidence: {
      answer: "Bukti belum tersedia", requestId: "wa-test-request", confidence: "low",
      retrievalMethod: "none", rounds: 0, warnings: ["ROUTER_NO_MATCH"], usage: {}, sources: [],
    },
    snapshot: { berhasil: true, teks: "jawaban snapshot", periode: "2026-08-24 sampai 2026-08-30", provider: "glm", modelVersion: "glm-test", usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } },
  });
  await jawabPertanyaanUmum(f.sock, "120@g.us", {}, "deviasi CMD 3", f.deps);
  ok("event fallback tercatat", f.calls.events.some((e) => e.stage === "fallback" && e.status === "error"));
  ok("finish berstatus fallback", f.calls.finishes[0]?.status === "fallback");
  ok("retrieval snapshot", f.calls.finishes[0]?.retrievalMethod === "snapshot");
  ok("token fallback tercatat", f.calls.events.some((e) => e.stage === "ai_synthesis" && e.provider === "glm" && e.totalTokens === 11));
}

section("Kegagalan delivery menutup telemetry, tidak meninggalkan started");
{
  const f = fixture({
    evidence: {
      answer: "jawaban live", requestId: "wa-test-request", confidence: "high",
      retrievalMethod: "live_dax", rounds: 1, warnings: [], usage: {}, sources: [],
    },
    snapshot: null,
    failSendAt: 2,
  });
  await jawabPertanyaanUmum(f.sock, "120@g.us", {}, "pertanyaan", f.deps);
  ok("delivery gagal memanggil fail sekali", f.calls.failures.length === 1);
  ok("delivery gagal tidak finish sukses", f.calls.finishes.length === 0);
  ok("kode delivery aman", f.calls.failures[0]?.error?.code === "WA_DELIVERY_FAILED");
}

section("Evidence dan snapshot gagal menutup request sebagai error");
{
  const f = fixture({
    evidence: {
      answer: "Bukti belum tersedia", requestId: "wa-test-request", confidence: "low",
      retrievalMethod: "none", rounds: 0, warnings: [], usage: {}, sources: [],
    },
    snapshot: { berhasil: false, alasan: "kosong" },
  });
  await jawabPertanyaanUmum(f.sock, "120@g.us", {}, "pertanyaan", f.deps);
  ok("fail sekali", f.calls.failures.length === 1);
  ok("tidak finish sukses", f.calls.finishes.length === 0);
  ok("alasan mentah tidak dikirim ke telemetry", f.calls.failures[0]?.error?.code === "EMPTY_RESULT");
}

section("Legacy execute_dax mempertahankan outcome per attempt, bukan outcome jawaban keseluruhan");
{
  const f = fixture({
    evidence: {
      answer: "goal kedua berhasil", requestId: "wa-multi-goal", confidence: "medium",
      retrievalMethod: "live_dax", rounds: 1, warnings: ["PARTIAL_EVIDENCE"], usage: {},
      sources: [{ dashboardId: "20", dashboardName: "Produksi", rowCount: 4 }],
    },
    attempts: [
      { semanticModel: "Model Gagal", status: "started" },
      { semanticModel: "Model Gagal", status: "error", rowsReturned: 0, errorCode: "POWERBI_TIMEOUT", errorMessage: "timeout" },
      { semanticModel: "Model Sukses", status: "started" },
      { semanticModel: "Model Sukses", status: "success", rowsReturned: 4, errorCode: null },
    ],
    snapshot: null,
  });
  await jawabPertanyaanUmum(f.sock, "multi-goal@g.us", {}, "bandingkan dua goal", f.deps);
  const legacy = f.calls.events.filter((event) => event.stage === "execute_dax");
  ok("hanya terminal attempt dijembatani dan outcome tidak dipalsukan",
    legacy.length === 2
      && legacy[0].semanticModel === "Model Gagal" && legacy[0].status === "error"
      && legacy[0].rowsReturned === 0 && legacy[0].errorCode === "POWERBI_TIMEOUT"
      && legacy[1].semanticModel === "Model Sukses" && legacy[1].status === "success"
      && legacy[1].rowsReturned === 4 && legacy[1].errorCode === null,
    JSON.stringify(legacy));
}

section("History WA hanya diwariskan pada JID yang sama");
{
  const f = fixture({
    evidence: (envelope) => ({
      answer: `jawaban ${envelope.question}`, requestId: "wa-history", confidence: "medium",
      retrievalMethod: "live_dax", rounds: 1, warnings: [], usage: {}, sources: [],
      evidenceContract: { concepts: [envelope.question], entities: [], periods: [], sources: [], goals: [] },
    }),
    snapshot: null,
  });
  await jawabPertanyaanUmum(f.sock, "history-a@g.us", {}, "pertanyaan pertama", f.deps);
  await jawabPertanyaanUmum(f.sock, "history-a@g.us", {}, "lanjutkan", f.deps);
  await jawabPertanyaanUmum(f.sock, "history-b@g.us", {}, "pertanyaan lain", f.deps);
  ok("turn sebelumnya masuk ke JID yang sama",
    f.calls.evidenceEnvelopes[1]?.conversation?.[0]?.text === "pertanyaan pertama"
      && f.calls.evidenceEnvelopes[1]?.conversation?.[1]?.evidenceContract?.concepts?.[0] === "pertanyaan pertama",
    JSON.stringify(f.calls.evidenceEnvelopes[1]?.conversation));
  ok("JID lain tidak menerima history grup pertama",
    f.calls.evidenceEnvelopes[2]?.conversation?.length === 0,
    JSON.stringify(f.calls.evidenceEnvelopes[2]?.conversation));
}

section("Jawaban snapshot juga menjadi history follow-up JID yang sama");
{
  const f = fixture({
    evidence: (envelope) => envelope.question === "awal snapshot" ? {
      answer: "Bukti live belum tersedia", requestId: "wa-snapshot-history", confidence: "low",
      retrievalMethod: "none", rounds: 0, warnings: [], usage: {}, sources: [],
    } : {
      answer: "jawaban follow-up", requestId: "wa-snapshot-history", confidence: "medium",
      retrievalMethod: "live_dax", rounds: 1, warnings: [], usage: {}, sources: [],
    },
    snapshot: { berhasil: true, teks: "jawaban snapshot awal", periode: "Agustus 2026" },
  });
  await jawabPertanyaanUmum(f.sock, "history-snapshot@g.us", {}, "awal snapshot", f.deps);
  await jawabPertanyaanUmum(f.sock, "history-snapshot@g.us", {}, "lanjut snapshot", f.deps);
  ok("follow-up menerima turn snapshot grupnya",
    f.calls.evidenceEnvelopes[1]?.conversation?.[0]?.text === "awal snapshot"
      && f.calls.evidenceEnvelopes[1]?.conversation?.[1]?.text?.includes("jawaban snapshot awal"),
    JSON.stringify(f.calls.evidenceEnvelopes[1]?.conversation));
}


section("Urutan live A lalu snapshot B memutus contract A untuk follow-up pada JID itu saja");
{
  const contractA = {
    concepts: ["downtime"], entities: [{ type: "machine", value: "Evergreen" }],
    periods: [{ label: "Juni", from: "2026-06-01", to: "2026-06-30" }],
    sources: [{ dashboardId: "44" }], goals: [],
  };
  const f = fixture({
    evidence: (envelope) => envelope.question === "live A" ? {
      answer: "jawaban live A", requestId: "wa-lineage", confidence: "high",
      retrievalMethod: "live_dax", rounds: 1, warnings: [], usage: {}, sources: [], evidenceContract: contractA,
    } : envelope.question === "snapshot B" ? {
      answer: "live tidak tersedia", requestId: "wa-lineage", confidence: "low",
      retrievalMethod: "none", rounds: 0, warnings: [], usage: {}, sources: [],
    } : {
      answer: "jawaban berikut", requestId: "wa-lineage", confidence: "low",
      retrievalMethod: "none", rounds: 0, warnings: [], usage: {}, sources: [],
    },
    snapshot: { berhasil: true, teks: "jawaban snapshot B", periode: "Agustus 2026" },
  });
  await jawabPertanyaanUmum(f.sock, "lineage-a@g.us", {}, "live A", f.deps);
  await jawabPertanyaanUmum(f.sock, "lineage-a@g.us", {}, "snapshot B", f.deps);
  await jawabPertanyaanUmum(f.sock, "lineage-a@g.us", {}, "lanjutkan", f.deps);
  await jawabPertanyaanUmum(f.sock, "lineage-b@g.us", {}, "lanjutkan", f.deps);
  const inheritedAfterB = resolveFollowUpContext({
    question: "lanjutkan", conversation: f.calls.evidenceEnvelopes[2]?.conversation,
  });
  ok("contract A tidak menembus turn snapshot B",
    inheritedAfterB.sources.length === 0 && inheritedAfterB.entities.length === 0,
    JSON.stringify({ conversation: f.calls.evidenceEnvelopes[2]?.conversation, inheritedAfterB }));
  ok("JID lain tetap tidak menerima lineage A/B",
    f.calls.evidenceEnvelopes[3]?.conversation?.length === 0,
    JSON.stringify(f.calls.evidenceEnvelopes[3]?.conversation));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
