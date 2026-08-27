// Sanitasi error + helper preview/fingerprint telemetry CIA.
//
// Ini uji UNIT tanpa menyentuh database: yang dijaga adalah bahwa error yang
// dicatat ke telemetry TIDAK PERNAH membawa credential. Axios menempelkan
// seluruh request pada error (config.headers.Authorization, config.auth, url),
// dan sebagian API membalas body sensitif di response.data. safeError harus
// membangun objek BARU berisi hanya { code, message } — bukan menyaring objek
// error lama, karena menyaring mudah bocor lewat field yang belum terpikir.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import {
  safeError, previewQuestion, fingerprintQuestion,
} from "../src/services/ciaTelemetry.service.js";

section("safeError hanya mengeluarkan code + message");

const fakeErr = new Error("timeout of 45000ms exceeded");
fakeErr.code = "ECONNABORTED";
fakeErr.config = {
  url: "https://api.powerbi.com/v1.0/myorg/datasets/abc/executeQueries",
  headers: { Authorization: "Bearer SUPERSECRETTOKEN", "X-Trace": "y" },
  auth: { username: "admin", password: "hunter2" },
  data: { queries: [{ query: "EVALUATE SENSITIVE" }] },
};
fakeErr.response = { status: 504, data: { error: "internal detail bocor", access_token: "ZZZ" } };
fakeErr.password = "hunter2";

const safe = safeError(fakeErr);

ok("kelas error timeout ternormalisasi ke POWERBI_TIMEOUT",
  safe.code === "POWERBI_TIMEOUT", safe.code);
ok("pesan aman & manusiawi",
  safe.message === "Power BI tidak merespons dalam 45 detik", safe.message);
ok("output HANYA punya key code dan message",
  JSON.stringify(Object.keys(safe).sort()) === '["code","message"]',
  JSON.stringify(Object.keys(safe)));

const dump = JSON.stringify(safe);
const bocor = ["SUPERSECRETTOKEN", "Authorization", "hunter2", "password",
  "access_token", "ZZZ", "internal detail bocor", "EVALUATE", "executeQueries"];
ok("tidak ada satupun nilai/field sensitif yang bocor",
  bocor.every((s) => !dump.includes(s)), dump);

section("safeError tahan input aneh");

for (const input of [null, undefined, "string biasa", 42, {}]) {
  const r = safeError(input);
  ok(`aman untuk input ${String(input)}`,
    r && typeof r.code === "string" && typeof r.message === "string" &&
    Object.keys(r).length === 2,
    JSON.stringify(r));
}

section("previewQuestion dipotong 300 karakter");

const panjang = "x".repeat(500);
const preview = previewQuestion(panjang);
ok("preview panjang tepat maksimal 300", preview.length === 300, String(preview.length));
ok("preview string kosong -> null aman", previewQuestion("") === null);
ok("preview undefined -> null aman", previewQuestion(undefined) === null);

section("fingerprintQuestion stabil 64 hex");

const fp1 = fingerprintQuestion("Breakdown lembur per departemen");
const fp2 = fingerprintQuestion("Breakdown lembur per departemen");
ok("fingerprint 64 hex", /^[0-9a-f]{64}$/.test(fp1), fp1);
ok("fingerprint stabil untuk input sama", fp1 === fp2);
ok("fingerprint berbeda untuk input berbeda",
  fp1 !== fingerprintQuestion("pertanyaan lain"));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
