# API Authorization Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup 26 endpoint CODE yang berjalan tanpa autentikasi dan otorisasi, dengan mekanisme yang membuat endpoint baru aman secara default.

**Architecture:** Satu middleware `defaultDeny` dipasang sebelum semua router — setiap path `/api/*` wajib token kecuali daftar-putih eksplisit. Di atasnya, guard `requireAdmin` dan `requireSelfOrAdmin` per-route. Hak admin dibaca dari kolom baru `users.role`, bukan dari perbandingan username yang tersebar. Sebuah uji inventaris route memastikan endpoint baru tidak bisa lolos tanpa diklasifikasi.

**Tech Stack:** Node.js 20+ (ESM), Express 4, MySQL 8 (`mysql2`), `jsonwebtoken`, `bcrypt`. Test memakai runner Node bawaan — tidak ada framework test di proyek ini.

## Global Constraints

- Spec acuan: `docs/superpowers/specs/2026-08-02-api-authorization-design.md`. Semua keputusan di sana mengikat.
- Semua file backend ESM (`"type": "module"`). Pakai `import`, bukan `require`.
- MySQL **tidak mendukung** `ADD COLUMN IF NOT EXISTS`. Setiap `ALTER TABLE` wajib dijaga lewat `information_schema` + prepared statement, mengikuti pola `backend/migrations/add_ai_usage_tracking.sql`.
- Perbandingan id **wajib numerik**: `req.params` selalu string, `req.user.id` dari JWT adalah number. `"9" === 9` bernilai `false`.
- Identitas **tidak pernah** diambil dari body atau URL — selalu dari `req.user`.
- Rate-limit login **per username**, bukan per IP.
- Jangan mengganti `JWT_SECRET`. `src/config/secretBox.js` menurunkan kunci enkripsi dari nilai itu; mengubahnya membuat kunci Gemini tersimpan tidak bisa didekripsi.
- Backend dijalankan di port `5050` (dari `.env`). Test mengasumsikan server hidup di `http://localhost:5050`.
- Bahasa pesan error ke user: Indonesia. Komentar kode: Inggris, mengikuti codebase.

## Prasyarat: version control

Folder proyek **belum** di bawah git (`fatal: not a git repository`). Perubahan ini menyentuh jalur autentikasi seluruh aplikasi, sehingga kemampuan rollback penting.

Sebelum Task 1, putuskan salah satu:
- **`git init` + commit awal** — langkah commit di setiap task dijalankan normal.
- **Tanpa git** — lewati semua langkah "Commit"; buat salinan `backend/src` sebelum mulai.

Sisa rencana ini menganggap git sudah aktif.

---

### Task 1: Fondasi — kolom `role`, helper `isAdmin`, harness test

**Files:**
- Create: `backend/migrations/add_user_roles.sql`
- Create: `backend/tests/harness.mjs`
- Create: `backend/tests/run-all.mjs`
- Create: `backend/tests/authz-foundation.test.mjs`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/package.json` (tambah script `test`)

**Interfaces:**
- Consumes: —
- Produces:
  - `isAdmin(user)` → `boolean` — menerima objek user berisi `{ role }`; `true` bila `role === "admin"`
  - `loadUser(userId)` → `Promise<{id, nama, username, role, approved} | null>`
  - Harness: `ok(name, cond, extra?)`, `summary()`, `req(method, path, {token, body})` → `Promise<{status, body}>`, `tokenFor(id, username)` → `string`

- [ ] **Step 1: Tulis harness test**

Buat `backend/tests/harness.mjs`:

```js
// Minimal test harness — proyek ini tidak memakai framework test.
import "dotenv/config";
import jwt from "jsonwebtoken";

const BASE = process.env.TEST_BASE || "http://localhost:5050";

export const results = { pass: 0, fail: 0 };

export function ok(name, cond, extra = "") {
  if (cond) {
    results.pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    results.fail += 1;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

export function section(title) {
  console.log(`\n═══ ${title} ═══`);
}

/** Mints a token the same way POST /api/login does. */
export function tokenFor(id, username) {
  return jwt.sign({ id, username }, process.env.JWT_SECRET || "jwt_secret_key", {
    expiresIn: "1h",
  });
}

export async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body && !["GET", "HEAD"].includes(method) ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body: parsed };
}

export function summary() {
  console.log(`\n──────── ${results.pass} passed, ${results.fail} failed ────────\n`);
  return results.fail === 0;
}
```

Buat `backend/tests/run-all.mjs`:

```js
// Runs every *.test.mjs in this folder, then reports one combined result.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { summary } from "./harness.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();

for (const file of files) {
  console.log(`\n########  ${file}  ########`);
  await import(`file://${path.join(dir, file)}`);
}

process.exit(summary() ? 0 : 1);
```

Buat `backend/tests/authz-foundation.test.mjs`:

```js
import { ok, section } from "./harness.mjs";
import { isAdmin, loadUser } from "../src/middleware/auth.js";

section("Fondasi: kolom role & helper isAdmin");

ok("isAdmin true untuk role admin", isAdmin({ role: "admin" }) === true);
ok("isAdmin false untuk role user", isAdmin({ role: "user" }) === false);
ok("isAdmin false untuk user tanpa role", isAdmin({}) === false);
ok("isAdmin false untuk null", isAdmin(null) === false);
ok("isAdmin TIDAK lagi memakai username",
  isAdmin({ username: "digital.transformation", role: "user" }) === false);

const admin = await loadUser(4);
ok("loadUser mengembalikan role dari database", admin?.role === "admin",
  JSON.stringify(admin));

const missing = await loadUser(999999);
ok("loadUser mengembalikan null untuk id tidak dikenal", missing === null);
```

Tambahkan script di `backend/package.json`:

```json
"scripts": {
  "start": "node src/server.js",
  "dev": "nodemon src/server.js",
  "test": "node tests/run-all.mjs"
}
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test`
Expected: FAIL — `SyntaxError` atau `isAdmin is not a function`, karena `middleware/auth.js` belum mengekspor `isAdmin` maupun `loadUser`.

- [ ] **Step 3: Tulis migration**

Buat `backend/migrations/add_user_roles.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: kolom role untuk otorisasi admin
-- Jalankan SETELAH cod_db.sql. Aman diulang.
--
-- MySQL tidak mendukung "ADD COLUMN IF NOT EXISTS" — karena itu dijaga
-- lewat information_schema, sama seperti add_ai_usage_tracking.sql.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role') = 0,
  "ALTER TABLE users ADD COLUMN role ENUM('admin','user') NOT NULL DEFAULT 'user'",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Hanya akun ini yang dijadikan admin. Akun 'superuser' sengaja TIDAK
-- diikutkan — itu keputusan pemilik sistem, bukan asumsi migration.
UPDATE users SET role = 'admin' WHERE username = 'digital.transformation';
```

Jalankan:

```bash
mysql -u root -p central_of_digitalization < backend/migrations/add_user_roles.sql
```

- [ ] **Step 4: Implementasi `isAdmin` dan `loadUser`**

Ganti seluruh isi `backend/src/middleware/auth.js`:

```js
import jwt from "jsonwebtoken";
import db from "../config/db.js";

const sql = db.promise();

// Verifies the Bearer JWT and attaches { id, username } to req.user
export function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token missing" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET || "jwt_secret_key", (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired token" });
    req.user = decoded;
    next();
  });
}

/**
 * Single source of truth for admin rights.
 *
 * Reads the `role` column rather than comparing usernames: the old check was
 * duplicated across five files, broke if the account was renamed, and could
 * never support a second admin.
 */
export function isAdmin(user) {
  return user?.role === "admin";
}

/**
 * Loads a user fresh from the database.
 *
 * Authorization deliberately does NOT trust the role inside the JWT — a token
 * issued before an admin was demoted would keep working until it expired.
 */
export async function loadUser(userId) {
  const [rows] = await sql.query(
    "SELECT id, nama, username, departemen, tipe_akses, role, approved FROM users WHERE id = ?",
    [userId]
  );
  return rows[0] || null;
}
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `cd backend && npm test`
Expected: PASS — 7 assertion di `authz-foundation.test.mjs`.

Bila `loadUser(4)` mengembalikan `role: "user"`, migration belum jalan. Ulangi Step 3.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/add_user_roles.sql backend/tests backend/src/middleware/auth.js backend/package.json
git commit -m "feat(auth): add users.role column, isAdmin helper, and test harness"
```

---

### Task 2: Middleware otorisasi

**Files:**
- Create: `backend/src/middleware/authorize.js`
- Create: `backend/tests/authz-middleware.test.mjs`

**Interfaces:**
- Consumes: `isAdmin(user)`, `loadUser(userId)`, `verifyJWT` dari `middleware/auth.js`
- Produces:
  - `PUBLIC_ROUTES` → `Set<string>` berisi entri `"METHOD /path"`
  - `isPublicRoute(method, path)` → `boolean`
  - `defaultDeny(req, res, next)` — middleware
  - `requireAdmin(req, res, next)` — middleware, mengisi `req.dbUser`
  - `requireSelfOrAdmin(paramName)` → middleware, mengisi `req.dbUser`

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/tests/authz-middleware.test.mjs`:

```js
import { ok, section } from "./harness.mjs";
import { isPublicRoute, PUBLIC_ROUTES } from "../src/middleware/authorize.js";

section("Middleware: daftar-putih route publik");

ok("login publik", isPublicRoute("POST", "/api/login") === true);
ok("register publik", isPublicRoute("POST", "/api/register") === true);
ok("link approval email publik", isPublicRoute("GET", "/api/approve-via-email") === true);
ok("portal-links publik (dipakai landing page sebelum login)",
  isPublicRoute("GET", "/api/portal-links") === true);

ok("daftar user TIDAK publik", isPublicRoute("GET", "/api/users") === false);
ok("dashboards TIDAK publik", isPublicRoute("GET", "/api/dashboards") === false);

// Pencocokan harus PERSIS, bukan awalan — ini mencegah "/api/login-anything"
// ikut terbuka gara-gara "/api/login" ada di daftar-putih.
ok("awalan mirip TIDAK ikut terbuka", isPublicRoute("POST", "/api/login-bypass") === false);
ok("metode berbeda TIDAK ikut terbuka", isPublicRoute("DELETE", "/api/login") === false);

ok("daftar-putih berupa Set", PUBLIC_ROUTES instanceof Set);
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test`
Expected: FAIL — `Cannot find module '../src/middleware/authorize.js'`.

- [ ] **Step 3: Implementasi middleware**

Buat `backend/src/middleware/authorize.js`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Authorization layer for the CODE API.
//
// Default-deny: every /api path requires a valid token unless it appears in an
// explicit allowlist. This is the property that matters — a new endpoint added
// six months from now is protected without anyone remembering to protect it.
// Forgetting produces a loud 401, not a silent hole.
// ─────────────────────────────────────────────────────────────────────────────

import { verifyJWT, isAdmin, loadUser } from "./auth.js";

/**
 * Routes reachable without a token.
 *
 * Matched EXACTLY as "METHOD /path" — never by prefix, so allowlisting
 * "/api/login" cannot accidentally open "/api/login-bypass".
 */
export const PUBLIC_ROUTES = new Set([
  "POST /api/login",
  "POST /api/register",
  "GET /api/check-token",              // verifies the token itself
  "GET /api/approve-via-email",        // signed token lives in the query string
  "GET /api/reject-via-email",
  "GET /api/approve-user-via-email",
  "GET /api/reject-user-via-email",
  "GET /api/portal-links",             // landing page renders before login
]);

export function isPublicRoute(method, path) {
  return PUBLIC_ROUTES.has(`${method} ${path}`);
}

/** Requires a token for every /api route that is not explicitly public. */
export function defaultDeny(req, res, next) {
  if (!req.path.startsWith("/api")) return next();   // static files, health check
  if (isPublicRoute(req.method, req.path)) return next();
  return verifyJWT(req, res, next);
}

/**
 * Admin-only. The role is read from the database, not from the token, so
 * revoking admin rights takes effect immediately instead of when the token
 * happens to expire.
 */
export async function requireAdmin(req, res, next) {
  try {
    const user = await loadUser(req.user?.id);
    if (!user || !user.approved) {
      return res.status(403).json({ message: "Akun tidak aktif" });
    }
    if (!isAdmin(user)) {
      return res.status(403).json({ message: "Butuh hak admin" });
    }
    req.dbUser = user;
    next();
  } catch (err) {
    console.error("❌ requireAdmin error:", err);
    res.status(500).json({ message: "Gagal memeriksa hak akses" });
  }
}

/**
 * The :param must belong to the caller, unless the caller is an admin.
 *
 * Comparison is numeric on purpose: req.params values are always strings while
 * the JWT carries a number, and "9" === 9 is false — a strict comparison would
 * reject the rightful owner of the data.
 */
export function requireSelfOrAdmin(paramName) {
  return async (req, res, next) => {
    try {
      const user = await loadUser(req.user?.id);
      if (!user || !user.approved) {
        return res.status(403).json({ message: "Akun tidak aktif" });
      }

      const target = Number(req.params[paramName]);
      if (Number.isFinite(target) && target === Number(user.id)) {
        req.dbUser = user;
        return next();
      }
      if (isAdmin(user)) {
        req.dbUser = user;
        return next();
      }
      return res.status(403).json({ message: "Kamu hanya bisa mengakses datamu sendiri" });
    } catch (err) {
      console.error("❌ requireSelfOrAdmin error:", err);
      res.status(500).json({ message: "Gagal memeriksa hak akses" });
    }
  };
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `cd backend && npm test`
Expected: PASS — 9 assertion baru.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/authorize.js backend/tests/authz-middleware.test.mjs
git commit -m "feat(auth): add default-deny and role-based authorization middleware"
```

---

### Task 3: Pasang `defaultDeny` — semua endpoint wajib token

**Files:**
- Modify: `backend/src/server.js` (setelah baris 38, sebelum mount router)
- Create: `backend/tests/authz-endpoints.test.mjs`

**Interfaces:**
- Consumes: `defaultDeny` dari `middleware/authorize.js`
- Produces: seluruh `/api/*` non-publik menolak request tanpa token dengan `401`

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/tests/authz-endpoints.test.mjs`:

```js
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
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Jalankan server di terminal lain: `cd backend && npm run dev`
Run: `cd backend && npm test`
Expected: FAIL — sebagian besar `PROTECTED` menjawab `200`, bukan `401`.

- [ ] **Step 3: Pasang middleware**

Di `backend/src/server.js`, tambahkan import di dekat import middleware lain:

```js
import { defaultDeny } from "./middleware/authorize.js";
```

Lalu sisipkan **tepat setelah** `app.use(cors());` (baris 38) dan **sebelum** mount router mana pun:

```js
// Default-deny: everything under /api needs a token unless explicitly public.
// Must sit before every router so no route can be registered behind its back.
app.use(defaultDeny);
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Restart server, lalu run: `cd backend && npm test`
Expected: PASS — 20 endpoint menjawab `401`, 3 endpoint publik tetap jalan.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js backend/tests/authz-endpoints.test.mjs
git commit -m "feat(auth): require a token for every non-public API route"
```

---

### Task 4: Guard admin & self-or-admin per endpoint

**Files:**
- Modify: `backend/src/server.js` (handler pada baris 135, 175, 189, 223, 241, 296, 334, 364, 408, 434, 459, 507, 541, 553, 562, 581)
- Modify: `backend/src/routes/dashboardRoutes.js`
- Modify: `backend/src/routes/portalLinkRoutes.js` (selaraskan `requireAdmin` lama)
- Modify: `backend/src/routes/aiRoutes.js` (universal-key jadi adminOnly)
- Create: `backend/tests/authz-roles.test.mjs`

**Interfaces:**
- Consumes: `requireAdmin`, `requireSelfOrAdmin` dari `middleware/authorize.js`
- Produces: endpoint admin menolak user biasa dengan `403`; endpoint `:userId` menolak akses lintas-user dengan `403`

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/tests/authz-roles.test.mjs`:

```js
import { ok, section, req, tokenFor } from "./harness.mjs";

// id 4 = digital.transformation (admin). id 9 = rasimin (user biasa).
const ADMIN = tokenFor(4, "digital.transformation");
const USER  = tokenFor(9, "rasimin");
const USER_ID = 9;
const OTHER_ID = 12;

section("Endpoint admin menolak user biasa");

const ADMIN_ONLY = [
  ["GET", "/api/users", null],
  ["GET", "/api/requests", null],
  ["POST", "/api/add-user", { nama: "x", username: "x", password: "x" }],
  ["PUT", "/api/update-user/12", { nama: "x" }],
  ["DELETE", "/api/delete-user/12", null],
  ["PUT", "/api/approve-user/12", null],
  ["PUT", "/api/decline-user/12", null],
  ["PUT", "/api/approve-request/1", null],
  ["PUT", "/api/decline-request/1", null],
  ["POST", `/api/users/${USER_ID}/dashboard-access`, { dashboardId: 44, checked: true }],
  ["POST", "/api/dashboards", { title: "x", url: "x", department: "x" }],
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
  const r = await req(method, path, { token: USER, body: { newPassword: "x" } });
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
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test`
Expected: FAIL — endpoint admin menjawab `200` untuk user biasa; akses lintas-user juga `200`.

- [ ] **Step 3: Pasang guard**

Di `backend/src/server.js`, tambahkan import:

```js
import { defaultDeny, requireAdmin, requireSelfOrAdmin } from "./middleware/authorize.js";
```

Sisipkan guard sebagai argumen kedua pada setiap handler berikut. Contoh bentuknya:

```js
// SEBELUM
app.get("/api/users", (req, res) => {

// SESUDAH
app.get("/api/users", requireAdmin, (req, res) => {
```

Terapkan `requireAdmin` pada:

```
app.get("/api/users", ...)                      // baris 135
app.post("/api/add-user", ...)                  // baris 175
app.put("/api/update-user/:id", ...)            // baris 189
app.put("/api/approve-user/:id", ...)           // baris 223
app.put("/api/decline-user/:id", ...)           // baris 241
app.post("/api/users/:userId/dashboard-access", ...)  // baris 364
app.get("/api/requests", ...)                   // baris 459
app.put("/api/approve-request/:id", ...)        // baris 507
app.put("/api/decline-request/:id", ...)        // baris 541
app.delete("/api/delete-user/:id", ...)         // baris 553
```

Terapkan `requireSelfOrAdmin("<nama param>")`:

```js
app.put("/api/users/:id/password", requireSelfOrAdmin("id"), async (req, res) => {           // 144
app.get("/api/dashboard-access-status/:userId", requireSelfOrAdmin("userId"), (req, res) => { // 296
app.get("/api/users/:userId/dashboard-access", requireSelfOrAdmin("userId"), (req, res) => {  // 334
app.get("/api/access-requests-log/:userId", requireSelfOrAdmin("userId"), (req, res) => {     // 408
app.get("/api/access/:userId", requireSelfOrAdmin("userId"), (req, res) => {                  // 434
app.get("/api/notifications/count/:userId", requireSelfOrAdmin("userId"), (req, res) => {     // 562
app.put("/api/notifications/mark-read/:userId", requireSelfOrAdmin("userId"), (req, res) => { // 581
```

Di `backend/src/routes/dashboardRoutes.js`, ganti seluruh isi:

```js
import express from "express";
import { DashboardController } from "../controllers/dashboardController.js";
import { requireAdmin } from "../middleware/authorize.js";

const router = express.Router();

// Reading the catalogue only needs a login (defaultDeny already enforced it);
// changing it is an admin action.
router.get("/", DashboardController.getDashboards);
router.post("/", requireAdmin, DashboardController.createDashboard);
router.put("/:id", requireAdmin, DashboardController.updateDashboard);
router.delete("/:id", requireAdmin, DashboardController.deleteDashboard);

export default router;
```

Di `backend/src/routes/portalLinkRoutes.js`, hapus fungsi `requireAdmin` lokal (baris 34-44) dan pakai yang terpusat. Tambahkan di bagian import:

```js
import { requireAdmin } from "../middleware/authorize.js";
```

Guard lama membandingkan `decoded.username !== "digital.transformation"`; versi terpusat membaca kolom `role`, sehingga admin kedua ikut berlaku tanpa mengubah kode.

Di `backend/src/routes/aiRoutes.js`, ubah dua baris universal-key:

```js
// SEBELUM
router.put("/universal-key", AiController.saveUniversalKey);
router.delete("/universal-key", AiController.deleteUniversalKey);

// SESUDAH
router.put("/universal-key", requireAdmin, AiController.saveUniversalKey);
router.delete("/universal-key", requireAdmin, AiController.deleteUniversalKey);
```

dengan import:

```js
import { requireAdmin } from "../middleware/authorize.js";
```

Pengecekan admin di dalam `AiController.saveUniversalKey` / `deleteUniversalKey` (`aiSettings.isAdminUser`) menjadi lapis kedua — biarkan, tapi ubah `isAdminUser` di `backend/src/services/aiSettings.js` agar memakai kolom role:

```js
export function isAdminUser(user) {
  return user?.role === "admin";
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Restart server, lalu run: `cd backend && npm test`
Expected: PASS — 11 endpoint admin menolak user biasa, 7 akses lintas-user ditolak, 4 akses data sendiri tetap `200`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js backend/src/routes backend/src/services/aiSettings.js backend/tests/authz-roles.test.mjs
git commit -m "feat(auth): enforce admin and self-or-admin guards per endpoint"
```

---

### Task 5: Ganti password wajib password lama

**Files:**
- Modify: `backend/src/server.js:144-172` (handler password)
- Create: `backend/tests/authz-password.test.mjs`

**Interfaces:**
- Consumes: `requireSelfOrAdmin("id")` (sudah terpasang di Task 4), `req.dbUser`
- Produces: `PUT /api/users/:id/password` menerima `{ currentPassword?, newPassword }`

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/tests/authz-password.test.mjs`:

```js
import { ok, section, req, tokenFor } from "./harness.mjs";

const USER_ID = 9;
const USER  = tokenFor(USER_ID, "rasimin");
const ADMIN = tokenFor(4, "digital.transformation");

section("Ganti password sendiri wajib password lama");

const noCurrent = await req("PUT", `/api/users/${USER_ID}/password`, {
  token: USER,
  body: { newPassword: "PasswordBaru123!" },
});
ok("tanpa currentPassword → 400", noCurrent.status === 400, `dapat ${noCurrent.status}`);
ok("pesan menyebut password lama", /password (saat ini|lama)/i.test(noCurrent.body?.message || ""),
  noCurrent.body?.message);

const wrongCurrent = await req("PUT", `/api/users/${USER_ID}/password`, {
  token: USER,
  body: { currentPassword: "jelas-salah-sekali", newPassword: "PasswordBaru123!" },
});
ok("currentPassword salah → 400", wrongCurrent.status === 400, `dapat ${wrongCurrent.status}`);

section("Password baru divalidasi");

const tooShort = await req("PUT", `/api/users/${USER_ID}/password`, {
  token: USER,
  body: { currentPassword: "apa-saja", newPassword: "123" },
});
ok("password baru terlalu pendek → 400", tooShort.status === 400, `dapat ${tooShort.status}`);

section("Admin me-reset milik orang lain tanpa password lama");

// Tidak dieksekusi sungguhan agar tidak mengubah password user nyata:
// cukup pastikan tidak ditolak karena currentPassword hilang.
const adminReset = await req("PUT", `/api/users/${USER_ID}/password`, {
  token: ADMIN,
  body: { newPassword: "" },   // kosong → ditolak validasi, BUKAN ditolak karena currentPassword
});
ok("admin tidak dimintai currentPassword",
  !/password (saat ini|lama)/i.test(adminReset.body?.message || ""),
  adminReset.body?.message);
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test`
Expected: FAIL — request tanpa `currentPassword` menjawab `200`, bukan `400`.

- [ ] **Step 3: Tulis ulang handler password**

Ganti `backend/src/server.js` baris 144-172 seluruhnya:

```js
// CHANGE PASSWORD
// Self-service requires the current password: without it, anyone who finds an
// unattended logged-in browser could lock the owner out permanently. An admin
// resetting someone else's password is exempt — that is the point of a reset.
app.put("/api/users/:id/password", requireSelfOrAdmin("id"), async (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.trim().length < 8) {
    return res.status(400).json({ message: "Password baru minimal 8 karakter" });
  }

  const isSelf = Number(id) === Number(req.dbUser.id);

  try {
    if (isSelf) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Password saat ini wajib diisi" });
      }

      const [rows] = await db.promise().query("SELECT password FROM users WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ message: "User tidak ditemukan" });

      const valid = await bcrypt.compare(currentPassword, rows[0].password);
      if (!valid) return res.status(400).json({ message: "Password saat ini salah" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const [result] = await db
      .promise()
      .query("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }
    res.json({ message: "Password berhasil diperbarui" });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ message: "Server error" });
  }
});
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Restart server, lalu run: `cd backend && npm test`
Expected: PASS — 5 assertion baru.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js backend/tests/authz-password.test.mjs
git commit -m "feat(auth): require current password for self-service password change"
```

---

### Task 6: Identitas dari token, bukan dari body

**Files:**
- Modify: `backend/src/server.js:250-290` (`/api/request-access`), `:480-500` (`/api/cancel-request`), `:48-97` (`/api/register`)
- Create: `backend/tests/authz-idor.test.mjs`

**Interfaces:**
- Consumes: `req.user.id`
- Produces: `POST /api/request-access` dan `POST /api/cancel-request` mengabaikan `user_id` pada body; `POST /api/register` mengabaikan `tipe_akses` pada body

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/tests/authz-idor.test.mjs`:

```js
import { ok, section, req, tokenFor } from "./harness.mjs";

const USER_ID = 9;
const USER = tokenFor(USER_ID, "rasimin");
const VICTIM_ID = 12;

section("user_id pada body diabaikan");

// Mengaku sebagai user lain. Harus ditolak ATAU dicatat atas nama pengirim —
// yang penting TIDAK dibuat atas nama korban.
const spoof = await req("POST", "/api/request-access", {
  token: USER,
  body: {
    user_id: VICTIM_ID,
    dashboard_title: "Technical Downtime Report",
    dashboard_department: "Engineering",
    department_requested: "Engineering",
  },
});
ok("request atas nama user lain tidak sukses sebagai korban",
  spoof.status !== 200 || !JSON.stringify(spoof.body).includes(String(VICTIM_ID)),
  `${spoof.status} ${JSON.stringify(spoof.body)}`);

const spoofCancel = await req("POST", "/api/cancel-request", {
  token: USER,
  body: { user_id: VICTIM_ID, dashboard_title: "Technical Downtime Report" },
});
ok("cancel atas nama user lain tidak menghapus milik korban",
  spoofCancel.status === 404 || spoofCancel.status === 400,
  `dapat ${spoofCancel.status}`);

section("Registrasi mandiri tidak bisa meminta All Access");

const stamp = Date.now();
const reg = await req("POST", "/api/register", {
  body: {
    nama: "Uji Registrasi",
    departemen: "Plant",
    tipe_akses: "All Access",          // harus diabaikan
    nik: "",
    email: `uji${stamp}@test.local`,
    username: `uji_reg_${stamp}`,
    password: "PasswordUji123",
  },
});
ok("registrasi berhasil", reg.status === 200, `dapat ${reg.status} ${reg.body?.message}`);
ok("respons tidak mengonfirmasi All Access",
  !JSON.stringify(reg.body).includes("All Access"), JSON.stringify(reg.body));
```

Verifikasi manual di database setelah test:

```sql
SELECT username, tipe_akses, approved FROM users WHERE username LIKE 'uji_reg_%';
-- harus 'Department Access Only', approved = 0
DELETE FROM users WHERE username LIKE 'uji_reg_%';
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test`
Expected: FAIL — request dibuat atas nama `VICTIM_ID`; kolom `tipe_akses` terisi `All Access`.

- [ ] **Step 3: Ambil identitas dari token**

Di `backend/src/server.js`, pada handler `/api/request-access` (baris 250), ganti baris pembacaan body:

```js
// SEBELUM
const { user_id, dashboard_title, dashboard_department, department_requested } = req.body;

// SESUDAH
// Identity comes from the token, never from the payload: a valid token with a
// forged user_id would otherwise let anyone act on someone else's behalf.
const user_id = req.user.id;
const { dashboard_title, dashboard_department, department_requested } = req.body;
```

Pada handler `/api/cancel-request` (baris 480):

```js
// SEBELUM
const { user_id, dashboard_title } = req.body;

// SESUDAH
const user_id = req.user.id;
const { dashboard_title } = req.body;
```

Pada handler `/api/register` (baris 48):

```js
// SEBELUM
const { nama, departemen, tipe_akses, nik, email, username, password } = req.body;

// SESUDAH
const { nama, departemen, nik, email, username, password } = req.body;
// Self-registration cannot grant itself All Access. Upgrades go through an
// admin, who can see what they are approving.
const tipe_akses = "Department Access Only";
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Restart server, lalu run: `cd backend && npm test`
Expected: PASS — 4 assertion baru. Jalankan juga query verifikasi di Step 1 dan hapus user uji.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js backend/tests/authz-idor.test.mjs
git commit -m "fix(auth): take identity from the token, not the request body"
```

---

### Task 7: Rate-limit percobaan login

**Files:**
- Modify: `backend/src/server.js:104-120` (handler login)
- Create: `backend/tests/authz-login-limit.test.mjs`

**Interfaces:**
- Consumes: `hit(key, maxRequests, windowSeconds)` dari `services/rateLimiter.js`
- Produces: `POST /api/login` menjawab `429` setelah 10 percobaan gagal per username dalam 5 menit

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/tests/authz-login-limit.test.mjs`:

```js
import { ok, section, req } from "./harness.mjs";

section("Rate-limit login per username");

const victim = `brute_${Date.now()}`;
let got429 = false;

for (let i = 0; i < 12; i += 1) {
  const r = await req("POST", "/api/login", {
    body: { username: victim, password: `tebakan-${i}` },
  });
  if (r.status === 429) { got429 = true; break; }
}
ok("percobaan berulang akhirnya kena 429", got429);

// Username lain tidak boleh ikut terkunci — pembatasan per username, bukan per IP.
const lain = await req("POST", "/api/login", {
  body: { username: `orang_lain_${Date.now()}`, password: "x" },
});
ok("username lain tidak ikut terkunci", lain.status !== 429, `dapat ${lain.status}`);
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test`
Expected: FAIL — tidak pernah muncul `429`.

- [ ] **Step 3: Pasang rate-limit**

Di `backend/src/server.js`, tambahkan import:

```js
import * as rateLimit from "./services/rateLimiter.js";
```

Ganti awal handler login (baris 104):

```js
// LOGIN
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  // Limited per username rather than per IP: an office shares one public IP, so
  // an IP-based limit would lock out a whole floor because one person mistyped.
  const limit = rateLimit.hit(`login:${username}`, 10, 300);
  if (!limit.allowed) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({
      message: `Terlalu banyak percobaan login. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
    });
  }

  const query = "SELECT * FROM users WHERE username = ?";
```

Sisa handler tidak berubah.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Restart server, lalu run: `cd backend && npm test`
Expected: PASS — 2 assertion baru.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js backend/tests/authz-login-limit.test.mjs
git commit -m "feat(auth): rate-limit login attempts per username"
```

---

### Task 8: Uji inventaris route — mencegah kambuh

**Files:**
- Create: `backend/src/routeInventory.js`
- Create: `backend/tests/authz-inventory.test.mjs`
- Modify: `backend/src/server.js` (ekspor `app`)

**Interfaces:**
- Consumes: instance `app` Express
- Produces: `listApiRoutes(app)` → `Array<{method, path}>`, `ROUTE_CLASSIFICATION` → `Map<string, "public"|"authenticated"|"selfOrAdmin"|"adminOnly">`

- [ ] **Step 1: Tulis test yang gagal**

Buat `backend/tests/authz-inventory.test.mjs`:

```js
import { ok, section } from "./harness.mjs";
import { app } from "../src/server.js";
import { listApiRoutes, ROUTE_CLASSIFICATION } from "../src/routeInventory.js";

section("Setiap route /api wajib punya klasifikasi");

const routes = listApiRoutes(app);
ok("route berhasil dibaca dari Express", routes.length > 20, `${routes.length} route`);

const unclassified = routes.filter(
  (r) => !ROUTE_CLASSIFICATION.has(`${r.method} ${r.path}`)
);

ok(
  "tidak ada route tanpa klasifikasi",
  unclassified.length === 0,
  `belum diklasifikasi: ${unclassified.map((r) => `${r.method} ${r.path}`).join(", ")}`
);

const stale = [...ROUTE_CLASSIFICATION.keys()].filter(
  (key) => !routes.some((r) => `${r.method} ${r.path}` === key)
);
ok("tidak ada klasifikasi basi (route sudah dihapus)", stale.length === 0,
  `basi: ${stale.join(", ")}`);
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd backend && npm test`
Expected: FAIL — `Cannot find module '../src/routeInventory.js'`.

- [ ] **Step 3: Implementasi inventaris**

Buat `backend/src/routeInventory.js`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// Route inventory.
//
// defaultDeny guarantees authentication. It cannot guarantee AUTHORIZATION —
// nothing stops a new endpoint from being added without deciding whether it is
// admin-only. This map makes that decision mandatory: a route missing from it
// fails the test suite.
// ─────────────────────────────────────────────────────────────────────────────

/** Walks the Express router stack and returns every registered /api route. */
export function listApiRoutes(app) {
  const out = [];
  const walk = (stack, prefix = "") => {
    for (const layer of stack) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) out.push({ method: method.toUpperCase(), path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        // Recover the mount path from the layer's regexp
        const mount = layer.regexp?.source
          ?.replace("^\\/", "/")
          ?.replace("\\/?(?=\\/|$)", "")
          ?.replace(/\\\//g, "/")
          ?.replace(/\$$/, "") || "";
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(app._router?.stack || []);
  return out.filter((r) => r.path.startsWith("/api"));
}

export const ROUTE_CLASSIFICATION = new Map([
  // public
  ["POST /api/login", "public"],
  ["POST /api/register", "public"],
  ["GET /api/check-token", "public"],
  ["GET /api/approve-via-email", "public"],
  ["GET /api/reject-via-email", "public"],
  ["GET /api/approve-user-via-email", "public"],
  ["GET /api/reject-user-via-email", "public"],
  ["GET /api/portal-links/", "public"],

  // authenticated
  ["GET /api/dashboards/", "authenticated"],
  ["POST /api/request-access", "authenticated"],
  ["POST /api/cancel-request", "authenticated"],
  ["POST /api/refresh-token", "authenticated"],
  ["GET /api/powerbi/embed-config/:dashboardKey", "authenticated"],
  ["GET /api/powerbi/embed-config-by-report/:reportId", "authenticated"],
  ["GET /api/ai/status", "authenticated"],
  ["GET /api/ai/quota", "authenticated"],
  ["PUT /api/ai/key", "authenticated"],
  ["DELETE /api/ai/key", "authenticated"],
  ["PUT /api/ai/model", "authenticated"],
  ["POST /api/ai/ask", "authenticated"],
  ["POST /api/ai/navigate", "authenticated"],
  ["GET /api/ai/history/:dashboardId", "authenticated"],
  ["DELETE /api/ai/history/:dashboardId", "authenticated"],

  // selfOrAdmin
  ["PUT /api/users/:id/password", "selfOrAdmin"],
  ["GET /api/dashboard-access-status/:userId", "selfOrAdmin"],
  ["GET /api/users/:userId/dashboard-access", "selfOrAdmin"],
  ["GET /api/access-requests-log/:userId", "selfOrAdmin"],
  ["GET /api/access/:userId", "selfOrAdmin"],
  ["GET /api/notifications/count/:userId", "selfOrAdmin"],
  ["PUT /api/notifications/mark-read/:userId", "selfOrAdmin"],

  // adminOnly
  ["GET /api/users", "adminOnly"],
  ["POST /api/add-user", "adminOnly"],
  ["PUT /api/update-user/:id", "adminOnly"],
  ["DELETE /api/delete-user/:id", "adminOnly"],
  ["PUT /api/approve-user/:id", "adminOnly"],
  ["PUT /api/decline-user/:id", "adminOnly"],
  ["GET /api/requests", "adminOnly"],
  ["PUT /api/approve-request/:id", "adminOnly"],
  ["PUT /api/decline-request/:id", "adminOnly"],
  ["POST /api/users/:userId/dashboard-access", "adminOnly"],
  ["POST /api/dashboards/", "adminOnly"],
  ["PUT /api/dashboards/:id", "adminOnly"],
  ["DELETE /api/dashboards/:id", "adminOnly"],
  ["GET /api/portal-links/all", "adminOnly"],
  ["POST /api/portal-links/", "adminOnly"],
  ["PUT /api/portal-links/:id", "adminOnly"],
  ["DELETE /api/portal-links/:id", "adminOnly"],
  ["PUT /api/ai/universal-key", "adminOnly"],
  ["DELETE /api/ai/universal-key", "adminOnly"],
]);
```

Di `backend/src/server.js`, ubah baris terakhir agar `app` bisa diimpor test tanpa menyalakan server dua kali:

```js
// SEBELUM
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// SESUDAH
// Only listen when run directly; importing this module (e.g. from a test that
// inspects the route table) must not bind the port a second time.
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isDirectRun) {
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

export { app };
```

- [ ] **Step 4: Cetak dulu route yang terbaca**

Pembacaan mount path dari `layer.regexp` di Express 4 rapuh — bentuk regexp-nya
tidak didokumentasikan dan bisa menghasilkan awalan yang salah. Karena itu cetak
dulu hasilnya sebelum mencocokkan dengan peta:

```bash
cd backend && node -e "
import('./src/server.js').then(async (m) => {
  const { listApiRoutes } = await import('./src/routeInventory.js');
  const routes = listApiRoutes(m.app);
  console.log(routes.length + ' route:');
  routes.sort((a,b)=>a.path.localeCompare(b.path)).forEach(r => console.log('  ' + r.method + ' ' + r.path));
  process.exit(0);
});
"
```

Cocokkan keluarannya dengan kunci di `ROUTE_CLASSIFICATION`. Yang biasa berbeda:

- Route pada router yang dipasang di `/api/dashboards` muncul sebagai
  `/api/dashboards/` (ada garis miring penutup) — sesuaikan kuncinya.
- Nama parameter memakai nama asli di kode (`:dashboardKey`, bukan `:key`).
- Bila mount path terbaca kosong sehingga muncul `/dashboards/` tanpa `/api`,
  perbaiki fungsi `listApiRoutes` — **jangan** menyesuaikan peta untuk menutupi,
  karena itu membuat filter `startsWith("/api")` ikut meleset.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `cd backend && npm test`
Expected: PASS — 3 assertion. Bila ada route "belum diklasifikasi", tambahkan ke
`ROUTE_CLASSIFICATION` dengan tingkat yang benar sesuai §4.2 spec; bila "basi",
hapus entrinya.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routeInventory.js backend/src/server.js backend/tests/authz-inventory.test.mjs
git commit -m "test(auth): fail the suite when a route has no authorization classification"
```

---

### Task 9: Frontend — role dari server & field password lama

**Files:**
- Modify: `backend/src/server.js:104-120` (login mengembalikan `role`)
- Modify: `frontend/src/components/ChangePasswordModal.jsx`
- Modify: `frontend/src/components/header.jsx:20-23`
- Modify: `frontend/src/components/NotificationPage.jsx:14,69`
- Modify: `frontend/src/App.jsx` (fungsi `isAdmin`)
- Modify: `frontend/src/components/AISettingsModal.jsx` (tidak ada perubahan logika; verifikasi saja)

**Interfaces:**
- Consumes: `user.role` dari respons login
- Produces: UI admin muncul berdasarkan `role`, bukan nama/username

- [ ] **Step 1: Kembalikan `role` saat login**

Di `backend/src/server.js`, handler login mengirim seluruh baris user. Pastikan kolom `role` ikut terkirim — karena query memakai `SELECT *`, kolom baru otomatis ikut. Verifikasi manual:

```bash
curl -s -X POST http://localhost:5050/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"digital.transformation","password":"<password>"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('role =',JSON.parse(d).user.role))"
```

Expected: `role = admin`

Hapus `password` dari objek user sebelum dikirim — hash tidak perlu sampai ke browser:

```js
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || "jwt_secret_key", { expiresIn: "8h" });
    // Never ship the password hash to the client.
    const { password: _omit, ...safeUser } = user;
    res.status(200).json({ token, user: safeUser });
```

- [ ] **Step 2: Tambah field password lama**

Di `frontend/src/components/ChangePasswordModal.jsx`, tambahkan state:

```js
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
```

Tambahkan field di atas field password baru:

```jsx
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">Password saat ini</label>
          <div className="relative">
            <input
              type={showCurrent ? "text" : "password"}
              className="border w-full p-2 rounded-lg pr-10"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
            >
              {showCurrent ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </div>
        </div>
```

Sertakan pada request:

```js
      await API.put(`/api/users/${loggedInUser.id}/password`, {
        currentPassword,
        newPassword,
      });
```

Pastikan `EyeIcon` dan `EyeOffIcon` sudah ada di import `lucide-react` file tersebut; tambahkan bila belum.

- [ ] **Step 3: Ganti pengecekan admin di frontend**

`frontend/src/components/header.jsx` baris 20-23:

```js
// SEBELUM
  const isAdmin =
    user.nama === "Digital Transformer" ||
    user.username === "digital.transformation";

// SESUDAH
  // Server is the authority; this only decides what to render.
  const isAdmin = user?.role === "admin";
```

`frontend/src/components/NotificationPage.jsx` baris 14 dan 69 — ganti `user?.nama === "Digital Transformer"` menjadi `user?.role === "admin"` di kedua tempat.

`frontend/src/App.jsx` — ganti fungsi:

```js
// SEBELUM
  const isAdmin = (u) =>
    u?.nama === "Digital Transformer" || u?.username === "digital.transformation";

// SESUDAH
  const isAdmin = (u) => u?.role === "admin";
```

- [ ] **Step 4: Verifikasi build & tidak ada identifier hilang**

Run:

```bash
cd frontend && npx vite build
```

Expected: `✓ built` tanpa error.

Build Vite **tidak** menangkap komponen yang dipakai tapi belum diimpor. Jalankan juga:

```bash
node -e "
const fs=require('fs');
const src=fs.readFileSync('src/components/ChangePasswordModal.jsx','utf8');
const used=[...src.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)].map(m=>m[1]);
const imported=(src.match(/import\s*\{([^}]*)\}/g)||[]).join(',');
const missing=[...new Set(used)].filter(n=>!imported.includes(n)&&!src.includes('function '+n));
console.log(missing.length?'MISSING: '+missing.join(', '):'OK: semua komponen terimpor');
"
```

Expected: `OK: semua komponen terimpor`

- [ ] **Step 5: Uji manual alur**

Dengan server dan frontend berjalan:

1. Login sebagai user biasa → ikon admin (Dashboard Manager, Portal Manager, Add User, Manage Users) **tidak** muncul.
2. Login sebagai `digital.transformation` → semua ikon admin muncul.
3. Ganti password sendiri dengan password lama **salah** → pesan "Password saat ini salah".
4. Ganti password sendiri dengan password lama **benar** → berhasil, lalu login ulang dengan password baru.

- [ ] **Step 6: Commit**

```bash
git add backend/src/server.js frontend/src
git commit -m "feat(auth): drive admin UI from users.role and require current password"
```

---

### Task 10: Ekstraksi router manajemen user

**Files:**
- Create: `backend/src/routes/userRoutes.js`
- Modify: `backend/src/server.js` (hapus handler yang dipindah, mount router)
- Modify: `backend/src/routeInventory.js` (sesuaikan path bila berubah)

**Interfaces:**
- Consumes: `requireAdmin`, `requireSelfOrAdmin`, `db`, `bcrypt`
- Produces: router pada mount `/api` yang memuat handler user-management

- [ ] **Step 1: Pastikan test hijau sebelum memindahkan**

Run: `cd backend && npm test`
Expected: PASS seluruhnya. Ekstraksi murni refactor — bila ada yang merah sebelum mulai, selesaikan dulu agar kegagalan setelah pindah pasti berasal dari pemindahan.

- [ ] **Step 2: Buat router**

Pindahkan **tanpa mengubah logika** tujuh handler berikut dari `server.js`.
Nomor baris mengacu pada kondisi setelah Task 1-9 selesai — cari berdasarkan
pola `app.<method>("<path>"` bila nomornya sudah bergeser:

| Handler | Guard yang sudah terpasang | Perkiraan baris |
|---|---|---|
| `GET /api/users` | `requireAdmin` | ~135 |
| `PUT /api/users/:id/password` | `requireSelfOrAdmin("id")` | ~144 |
| `POST /api/add-user` | `requireAdmin` | ~175 |
| `PUT /api/update-user/:id` | `requireAdmin` | ~189 |
| `PUT /api/approve-user/:id` | `requireAdmin` | ~223 |
| `PUT /api/decline-user/:id` | `requireAdmin` | ~241 |
| `DELETE /api/delete-user/:id` | `requireAdmin` | ~553 |

Setiap handler dipindah **utuh beserta guard-nya**, hanya `app.<method>("/api/x"`
berubah menjadi `router.<method>("/x"` karena router dipasang di `/api`.

Kerangkanya:

```js
import express from "express";
import bcrypt from "bcrypt";
import db from "../config/db.js";
import { requireAdmin, requireSelfOrAdmin } from "../middleware/authorize.js";

const router = express.Router();

// Mounted at /api, so paths here are relative to that.
router.get("/users", requireAdmin, (req, res) => {
  const q = "SELECT id, nama, departemen, tipe_akses, nik, email, username, approved, role FROM users";
  db.query(q, (err, results) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.json(results);
  });
});

// Handler lain dipindah ke sini apa adanya, mengikuti tabel di atas:
//   router.put("/users/:id/password", requireSelfOrAdmin("id"), ...)
//   router.post("/add-user", requireAdmin, ...)
//   router.put("/update-user/:id", requireAdmin, ...)
//   router.put("/approve-user/:id", requireAdmin, ...)
//   router.put("/decline-user/:id", requireAdmin, ...)
//   router.delete("/delete-user/:id", requireAdmin, ...)

export default router;
```

Dua hal yang berubah dari salinan aslinya:

1. `GET /api/users` sebelumnya menyebut kolom secara eksplisit tanpa `role`.
   Tambahkan `role` agar Manage Users bisa menampilkannya.
2. `PUT /users/:id/password` memakai `bcrypt` dan `db.promise()` — pastikan
   kedua import ada di file router baru, bukan tertinggal di `server.js`.

- [ ] **Step 3: Mount router, hapus handler lama**

Di `backend/src/server.js`, tambahkan import dan mount **setelah** `app.use(defaultDeny)`:

```js
import userRoutes from "./routes/userRoutes.js";
...
app.use("/api", userRoutes);
```

Hapus ketujuh handler yang sudah dipindah dari `server.js`.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Restart server, lalu run: `cd backend && npm test`
Expected: PASS seluruhnya, termasuk uji inventaris.

Bila uji inventaris melaporkan path berubah (mis. `/api/users` menjadi `/api//users`), perbaiki mount atau path router — jangan mengubah `ROUTE_CLASSIFICATION` untuk menyembunyikannya.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/userRoutes.js backend/src/server.js backend/src/routeInventory.js
git commit -m "refactor(auth): extract user-management routes out of server.js"
```

---

## Verifikasi akhir

- [ ] `cd backend && npm test` — seluruh suite hijau
- [ ] `cd frontend && npx vite build` — build bersih
- [ ] Uji ulang bukti celah awal, sekarang harus tertutup:

```bash
curl -s -o /dev/null -w "GET /api/users tanpa token → %{http_code}\n" http://localhost:5050/api/users
```

Expected: `401`

- [ ] Alur end-to-end masih utuh: login → lihat dashboard → request akses → admin menyetujui → user melihat dashboard
- [ ] Konfirmasi ke pemilik sistem apakah akun `superuser` perlu `role = 'admin'`
