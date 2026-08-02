import { ok, section, req } from "./harness.mjs";

section("Tanpa token: endpoint non-publik harus 401");

const PROTECTED = [
  ["GET", "/api/users"],
  ["GET", "/api/dashboards"],
  ["GET", "/api/requests"],
  ["POST", "/api/add-user"],
  ["PUT", "/api/update-user/1"],
  ["DELETE", "/api/delete-user/1"],
  ["PUT", "/api/approve-user/1"],
  ["PUT", "/api/decline-user/1"],
  ["PUT", "/api/users/1/password"],
  ["POST", "/api/request-access"],
  ["POST", "/api/cancel-request"],
  ["GET", "/api/dashboard-access-status/1"],
  ["GET", "/api/users/1/dashboard-access"],
  ["POST", "/api/users/1/dashboard-access"],
  ["GET", "/api/access-requests-log/1"],
  ["GET", "/api/access/1"],
  ["GET", "/api/notifications/count/1"],
  ["PUT", "/api/notifications/mark-read/1"],
  ["PUT", "/api/approve-request/1"],
  ["PUT", "/api/decline-request/1"],
];

for (const [method, path] of PROTECTED) {
  const r = await req(method, path, { body: {} });
  ok(`${method} ${path} tanpa token → 401`, r.status === 401, `dapat ${r.status}`);
}

section("Tanpa token: endpoint publik harus tetap jalan");

const loginAttempt = await req("POST", "/api/login", {
  body: { username: "__tidak_ada__", password: "__salah__" },
});
ok("POST /api/login tetap bisa diakses (404 user, bukan 401)",
  loginAttempt.status !== 401, `dapat ${loginAttempt.status}`);

const portal = await req("GET", "/api/portal-links");
ok("GET /api/portal-links tetap publik", portal.status === 200, `dapat ${portal.status}`);

const health = await req("GET", "/");
ok("GET / tetap publik", health.status === 200, `dapat ${health.status}`);
