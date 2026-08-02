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
