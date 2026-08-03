import { ok, section, req, tokenFor } from "./harness.mjs";

// Frontend memakai `code` untuk memutuskan apakah user harus dikeluarkan.
// Membedakannya penting: "akun tidak aktif" berarti sesinya sudah tidak
// berlaku, sedangkan "butuh hak admin" berarti akun aktif menyentuh sesuatu
// yang bukan haknya — mengeluarkan user karena yang kedua itu salah.

const GHOST_ID = 999999; // tidak pernah ada di tabel users
const GHOST    = tokenFor(GHOST_ID, "__hantu");
const USER     = tokenFor(36, "rasimin");        // akun nyata, bukan admin
const ADMIN    = tokenFor(4, "digital.transformation");

section("Token sah untuk akun yang tidak ada");

const ghostAdmin = await req("GET", "/api/users", { token: GHOST });
ok("ditolak 403", ghostAdmin.status === 403, `dapat ${ghostAdmin.status}`);
ok("membawa code ACCOUNT_INACTIVE", ghostAdmin.body?.code === "ACCOUNT_INACTIVE",
  JSON.stringify(ghostAdmin.body));

const ghostSelf = await req("GET", `/api/access/${GHOST_ID}`, { token: GHOST });
ok("selfOrAdmin juga menolak 403", ghostSelf.status === 403, `dapat ${ghostSelf.status}`);
ok("selfOrAdmin juga membawa code", ghostSelf.body?.code === "ACCOUNT_INACTIVE",
  JSON.stringify(ghostSelf.body));

section("Penolakan otorisasi biasa TIDAK boleh membawa code itu");

// Akun aktif, hanya bukan admin. User ini tidak boleh dikeluarkan dari sesinya.
const bukanAdmin = await req("GET", "/api/users", { token: USER });
ok("user biasa ditolak 403", bukanAdmin.status === 403, `dapat ${bukanAdmin.status}`);
ok("TANPA code ACCOUNT_INACTIVE", bukanAdmin.body?.code !== "ACCOUNT_INACTIVE",
  JSON.stringify(bukanAdmin.body));

// Mengakses data user lain: ditolak, tapi sesinya tetap sah.
const dataOrangLain = await req("GET", "/api/access/37", { token: USER });
ok("akses data user lain ditolak 403", dataOrangLain.status === 403, `dapat ${dataOrangLain.status}`);
ok("TANPA code ACCOUNT_INACTIVE", dataOrangLain.body?.code !== "ACCOUNT_INACTIVE",
  JSON.stringify(dataOrangLain.body));

section("Akun sah tetap bisa bekerja");

const adminOk = await req("GET", "/api/users", { token: ADMIN });
ok("admin tetap 200", adminOk.status === 200, `dapat ${adminOk.status}`);
