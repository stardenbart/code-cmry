process.env.CIA_TELEMETRY_ENABLED = "true";

import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { jawabPertanyaanUmum } from "../src/services/whatsappListener.service.js";

function fixture({ dax, snapshot }) {
  const calls = { envelope: null, events: [], finishes: [], failures: [], messages: [] };
  const tracker = {
    requestId: "wa-test-request",
    event: async (stage, data = {}) => calls.events.push({ stage, ...data }),
    finish: async (data) => calls.finishes.push(data),
    fail: async (error, data) => calls.failures.push({ error, data }),
  };
  return {
    calls,
    sock: { sendMessage: async (_jid, body) => calls.messages.push(body.text) },
    deps: {
      startCiaTelemetry: async (envelope) => { calls.envelope = envelope; return tracker; },
      jawabDenganDax: async () => dax,
      jawabDariSnapshot: async () => snapshot,
    },
  };
}

section("WA DAX live tercatat end-to-end");
{
  const f = fixture({
    dax: { berhasil: true, teks: "jawaban live", jejak: { model: ["Model A"], query: [{ model: "Model A", berhasil: true }], baris: 4 } },
    snapshot: null,
  });
  await jawabPertanyaanUmum(f.sock, "120@g.us", {}, "lembur harian", f.deps);
  ok("surface whatsapp", f.calls.envelope?.surface === "whatsapp");
  ok("JID menjadi conversation ref", f.calls.envelope?.conversationId === "120@g.us");
  ok("request_received tercatat", f.calls.events.some((e) => e.stage === "request_received"));
  ok("execute_dax mencatat semantic model", f.calls.events.some((e) => e.stage === "execute_dax" && e.semanticModel === "Model A"));
  ok("finish live_dax sekali", f.calls.finishes.length === 1 && f.calls.finishes[0].retrievalMethod === "live_dax");
  ok("tidak fail", f.calls.failures.length === 0);
}

section("Fallback snapshot dinyatakan transparan di telemetry");
{
  const f = fixture({
    dax: { berhasil: false, alasan: "tidak ada dashboard yang relevan dengan pertanyaan itu", jejak: { model: [], query: [], baris: 0 } },
    snapshot: { berhasil: true, teks: "jawaban snapshot", periode: "2026-08-24 sampai 2026-08-30" },
  });
  await jawabPertanyaanUmum(f.sock, "120@g.us", {}, "deviasi CMD 3", f.deps);
  ok("event fallback tercatat", f.calls.events.some((e) => e.stage === "fallback" && e.status === "error"));
  ok("finish berstatus fallback", f.calls.finishes[0]?.status === "fallback");
  ok("retrieval snapshot", f.calls.finishes[0]?.retrievalMethod === "snapshot");
}

section("DAX dan snapshot gagal menutup request sebagai error");
{
  const f = fixture({
    dax: { berhasil: false, alasan: "gagal", jejak: { model: [], query: [], baris: 0 } },
    snapshot: { berhasil: false, alasan: "kosong" },
  });
  await jawabPertanyaanUmum(f.sock, "120@g.us", {}, "pertanyaan", f.deps);
  ok("fail sekali", f.calls.failures.length === 1);
  ok("tidak finish sukses", f.calls.finishes.length === 0);
  ok("alasan mentah tidak dikirim ke telemetry", f.calls.failures[0]?.error?.code === "EMPTY_RESULT");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
