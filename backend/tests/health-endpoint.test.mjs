// Denyut nadi yang dipakai pengawas pm2 untuk memutuskan restart.
//
// Dua sifatnya yang harus dijaga:
//   1. Tanpa token. Pengawas berjalan sebagai cron di server, bukan sebagai user.
//      Kalau /health ikut default-deny, pengawas menerima 401 dan merestart
//      backend yang justru sehat, setiap kali ia memeriksa.
//   2. Tetap 200 saat database mati. Restart memperbaiki proses yang menggantung,
//      bukan MySQL yang mati. Membalas 503 di sini mengubah gangguan database
//      menjadi lingkaran restart tanpa akhir.
import { ok, section, req, tokenFor } from "./harness.mjs";

section("Denyut nadi bisa dibaca tanpa token");

const tanpaToken = await req("GET", "/health");
ok("tanpa token -> 200", tanpaToken.status === 200, `dapat ${tanpaToken.status}`);
ok("statusnya ok", tanpaToken.body?.status === "ok", JSON.stringify(tanpaToken.body));
ok(
  "melaporkan keadaan database",
  typeof tanpaToken.body?.database === "string",
  JSON.stringify(tanpaToken.body)
);
ok(
  "melaporkan uptime sebagai angka",
  Number.isFinite(tanpaToken.body?.uptime_detik),
  JSON.stringify(tanpaToken.body)
);

section("Token yang sah tidak mengubah apa pun");

const denganToken = await req("GET", "/health", { token: tokenFor(1, "uji") });
ok("dengan token -> 200", denganToken.status === 200, `dapat ${denganToken.status}`);

section("Denyut nadi TIDAK berada di bawah /api");

// Ini bukan gaya penamaan, melainkan yang membuat sifat nomor 1 di atas berlaku:
// defaultDeny menjaga setiap jalur /api. Memindahkan endpoint ini ke
// /api/health akan menutupnya untuk pengawas.
const { listApiRoutes } = await import("../src/routeInventory.js");

// server.js mengikat port secara bawaan. Test ini hanya membaca tabel rutenya,
// jadi ia menyatakan tidak butuh listener; tanpa ini, port 5050 diikat dua kali.
process.env.SKIP_SERVER_LISTEN = "true";
const { app } = await import("../src/server.js");
const jalurApi = listApiRoutes(app).map((r) => r.path);
ok(
  "tidak ada /api/health yang terdaftar",
  !jalurApi.some((p) => p.includes("health")),
  jalurApi.filter((p) => p.includes("health")).join(", ")
);
