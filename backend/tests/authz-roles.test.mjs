import { ok, section, req, tokenFor } from "./harness.mjs";

// Real ids from the live database.
const ADMIN_ID = 4;    // digital.transformation
const USER_ID  = 36;   // rasimin — role 'user'
const OTHER_ID = 37;   // ardi    — role 'user'

const ADMIN = tokenFor(ADMIN_ID, "digital.transformation");
const USER  = tokenFor(USER_ID, "rasimin");

// Destructive endpoints are aimed at an id that does not exist. Authorization
// must reject BEFORE the handler runs, so a bogus target still yields 403 —
// and a missing guard cannot damage a real record while proving the point.
// An earlier version of this test pointed DELETE at a real id and created a
// junk user through add-user.
const GHOST_ID = 999999;

section("Endpoint admin menolak user biasa");

const ADMIN_ONLY = [
  ["GET", "/api/users", null],
  ["GET", "/api/requests", null],
  ["POST", "/api/add-user", { nama: "__authz_probe__", username: "__authz_probe__", password: "irrelevant" }],
  ["PUT", `/api/update-user/${GHOST_ID}`, { nama: "x" }],
  ["DELETE", `/api/delete-user/${GHOST_ID}`, null],
  ["PUT", `/api/approve-user/${GHOST_ID}`, null],
  ["PUT", `/api/decline-user/${GHOST_ID}`, null],
  ["PUT", `/api/approve-request/${GHOST_ID}`, null],
  ["PUT", `/api/decline-request/${GHOST_ID}`, null],
  ["POST", `/api/users/${USER_ID}/dashboard-access`, { dashboardId: 44, checked: true }],
  ["POST", "/api/dashboards", { title: "__authz_probe__", url: "x", department: "x" }],
];

for (const [method, path, body] of ADMIN_ONLY) {
  const r = await req(method, path, { token: USER, body: body || {} });
  ok(`${method} ${path} sebagai user biasa → 403`, r.status === 403, `dapat ${r.status}`);
}

section("Endpoint admin menerima admin");

const asAdmin = await req("GET", "/api/users", { token: ADMIN });
ok("GET /api/users sebagai admin → 200", asAdmin.status === 200, `dapat ${asAdmin.status}`);

section("Data milik user lain ditolak");

const CROSS = [
  ["GET", `/api/dashboard-access-status/${OTHER_ID}`],
  ["GET", `/api/access-requests-log/${OTHER_ID}`],
  ["GET", `/api/access/${OTHER_ID}`],
  ["GET", `/api/notifications/count/${OTHER_ID}`],
  ["PUT", `/api/notifications/mark-read/${OTHER_ID}`],
  ["GET", `/api/users/${OTHER_ID}/dashboard-access`],
  ["PUT", `/api/users/${OTHER_ID}/password`],
];

for (const [method, path] of CROSS) {
  const r = await req(method, path, { token: USER, body: { newPassword: "TidakAkanTerpakai123" } });
  ok(`${method} ${path} milik user lain → 403`, r.status === 403, `dapat ${r.status}`);
}

section("Data sendiri tetap bisa diakses");

const SELF = [
  ["GET", `/api/dashboard-access-status/${USER_ID}`],
  ["GET", `/api/access-requests-log/${USER_ID}`],
  ["GET", `/api/access/${USER_ID}`],
  ["GET", `/api/notifications/count/${USER_ID}`],
];

for (const [method, path] of SELF) {
  const r = await req(method, path, { token: USER });
  ok(`${method} ${path} milik sendiri → 200`, r.status === 200, `dapat ${r.status}`);
}
