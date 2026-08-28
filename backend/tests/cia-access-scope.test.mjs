import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { resolveEvidenceScope } from "../src/services/cia/accessScope.js";

const calls = [];
const deps = {
  async loadUserDashboardIds(actor) {
    calls.push(["user", actor.userId]);
    if (actor.userId === 7) return ["dash-a"];
    return [];
  },
  async loadCentralizedDashboardIds() {
    calls.push(["centralized"]);
    return ["dash-a", "dash-b", "dash-c"];
  },
};

section("Preferred dashboard hanya hint di dalam ACL user");
calls.length = 0;
const web = await resolveEvidenceScope({
  actor: { userId: 7 },
  surface: "dashboard",
  accessMode: "centralized",
  preferredDashboardIds: ["dash-b", "dash-a", "dash-a"],
}, deps);
ok("web selalu memakai user_acl", web.mode === "user_acl", web.mode);
ok("dashboard di luar ACL tidak memperluas allowed",
  JSON.stringify(web.allowedDashboardIds) === JSON.stringify(["dash-a"]),
  JSON.stringify(web.allowedDashboardIds));
ok("preferred yang valid dipertahankan",
  JSON.stringify(web.preferredDashboardIds) === JSON.stringify(["dash-a"]),
  JSON.stringify(web.preferredDashboardIds));
ok("preferred yang ditolak terlihat untuk audit",
  JSON.stringify(web.deniedPreferredDashboardIds) === JSON.stringify(["dash-b"]),
  JSON.stringify(web.deniedPreferredDashboardIds));
ok("web tidak pernah memanggil loader centralized",
  calls.length === 1 && calls[0][0] === "user", JSON.stringify(calls));

section("User tanpa ACL menghasilkan scope denied yang terstruktur");
const denied = await resolveEvidenceScope({
  actor: { userId: 8 }, surface: "multi_chat", preferredDashboardIds: ["dash-a"],
}, deps);
ok("allowed kosong", denied.allowedDashboardIds.length === 0);
ok("scope membawa ACCESS_DENIED", denied.denied === true && denied.errorCode === "ACCESS_DENIED",
  JSON.stringify(denied));
ok("semua preferred ditandai denied",
  JSON.stringify(denied.deniedPreferredDashboardIds) === JSON.stringify(["dash-a"]),
  JSON.stringify(denied));

section("Centralized hanya untuk internal WhatsApp atau schedule");
calls.length = 0;
const spoofed = await resolveEvidenceScope({
  actor: { userId: 7 }, surface: "whatsapp", accessMode: "centralized",
  trustedInternal: false, preferredDashboardIds: ["dash-b"],
}, deps);
ok("WA tanpa trustedInternal tetap user_acl", spoofed.mode === "user_acl", spoofed.mode);
ok("spoof tidak memanggil centralized loader", calls.every(([kind]) => kind !== "centralized"), JSON.stringify(calls));

calls.length = 0;
const centralized = await resolveEvidenceScope({
  actor: { userId: null }, surface: "schedule", accessMode: "centralized",
  trustedInternal: true, preferredDashboardIds: ["dash-c", "dash-x"],
}, deps);
ok("schedule internal mendapat centralized", centralized.mode === "centralized", centralized.mode);
ok("centralized memuat seluruh dashboard aktif",
  JSON.stringify(centralized.allowedDashboardIds) === JSON.stringify(["dash-a", "dash-b", "dash-c"]),
  JSON.stringify(centralized.allowedDashboardIds));
ok("preferred tetap difilter terhadap daftar centralized",
  JSON.stringify(centralized.preferredDashboardIds) === JSON.stringify(["dash-c"])
    && JSON.stringify(centralized.deniedPreferredDashboardIds) === JSON.stringify(["dash-x"]),
  JSON.stringify(centralized));
ok("centralized memakai loader yang benar",
  calls.length === 1 && calls[0][0] === "centralized", JSON.stringify(calls));

section("Masukan aktor tidak valid gagal tertutup");
calls.length = 0;
const invalidActor = await resolveEvidenceScope({
  actor: {}, surface: "dashboard", preferredDashboardIds: ["dash-a"],
}, deps);
ok("aktor invalid tidak mendapat dashboard", invalidActor.allowedDashboardIds.length === 0);
ok("aktor invalid tidak menyentuh loader", calls.length === 0, JSON.stringify(calls));
ok("aktor invalid membawa ACCESS_DENIED", invalidActor.errorCode === "ACCESS_DENIED",
  JSON.stringify(invalidActor));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

