import { ok, section } from "./harness.mjs";

// Harus disetel SEBELUM server.js dievaluasi, dan itu sebabnya import `app` di
// bawah memakai import() dinamis: import statis di-hoist ke atas berkas, jadi
// baris ini akan berjalan terlambat. Tanpa penanda ini, meng-import server.js
// mengikat port 5050 dan bentrok dengan backend yang sedang melayani.
process.env.SKIP_SERVER_LISTEN = "true";

const { app } = await import("../src/server.js");
const { listApiRoutes, ROUTE_CLASSIFICATION } = await import("../src/routeInventory.js");

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

section("Klasifikasi konsisten dengan daftar-putih publik");

const { PUBLIC_ROUTES } = await import("../src/middleware/authorize.js");
const markedPublic = [...ROUTE_CLASSIFICATION.entries()]
  .filter(([, level]) => level === "public")
  .map(([key]) => key.replace(/\/$/, ""));

const missingFromAllowlist = markedPublic.filter((k) => !PUBLIC_ROUTES.has(k));
ok("semua route berlabel public ada di daftar-putih", missingFromAllowlist.length === 0,
  missingFromAllowlist.join(", "));

const notMarkedPublic = [...PUBLIC_ROUTES].filter((k) => !markedPublic.includes(k));
ok("semua isi daftar-putih berlabel public", notMarkedPublic.length === 0,
  notMarkedPublic.join(", "));

console.log(`  info  ${routes.length} route: ` +
  ["public", "authenticated", "selfOrAdmin", "adminOnly"]
    .map((lvl) => `${lvl} ${[...ROUTE_CLASSIFICATION.values()].filter((v) => v === lvl).length}`)
    .join(" · "));
