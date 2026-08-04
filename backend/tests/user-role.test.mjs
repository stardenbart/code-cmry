// ─────────────────────────────────────────────────────────────────────────────
// Pengelolaan kolom role lewat Manage Users.
//
// Kolom role adalah satu-satunya sumber kebenaran untuk requireAdmin, jadi
// kegagalan di sini tidak berisik: tidak ada error, tidak ada crash, cuma orang
// yang kehilangan akses atau mendapat akses yang tidak seharusnya.
//
// Uji ini memakai akun sekali pakai, bukan akun nyata. Menaikkan lalu
// menurunkan akun asli, walau cuma beberapa milidetik, memberi hak admin
// sungguhan ke orang yang sedang memakai CODE saat uji berjalan.
// ─────────────────────────────────────────────────────────────────────────────

import { ok, section, req, tokenFor } from "./harness.mjs";

const ADMIN = tokenFor(4, "digital.transformation");
const USER = tokenFor(36, "rasimin");
const GHOST_ID = 999999;

const NAMA_PROBE = "__uji_role__";

async function ambilUser(id) {
  const r = await req("GET", "/api/users", { token: ADMIN });
  return (r.body || []).find((u) => u.id === id) || null;
}

section("GET /api/users membawa kolom role");

const daftar = await req("GET", "/api/users", { token: ADMIN });
ok("status 200", daftar.status === 200, `dapat ${daftar.status}`);
ok(
  "setiap baris punya properti role",
  Array.isArray(daftar.body) && daftar.body.every((u) => "role" in u),
  "ada baris tanpa properti role"
);

const jumlahAdmin = (daftar.body || []).filter((u) => u.role === "admin").length;
ok("minimal satu admin ada", jumlahAdmin >= 1, `dapat ${jumlahAdmin}`);

section("Role di luar daftar putih ditolak");

// Diarahkan ke id yang tidak ada: validasi harus menolak SEBELUM query jalan,
// jadi target palsu tetap menghasilkan 400 tanpa menyentuh baris mana pun.
for (const peran of ["Admin", "ADMIN", "superadmin", "", "root"]) {
  const r = await req("PUT", `/api/update-user/${GHOST_ID}`, {
    token: ADMIN,
    body: { nama: "x", role: peran },
  });
  ok(`role ${JSON.stringify(peran)} ditolak 400`, r.status === 400, `dapat ${r.status}`);
}

section("Admin terakhir tidak bisa diturunkan");

if (jumlahAdmin === 1) {
  const satuSatunya = daftar.body.find((u) => u.role === "admin");
  const r = await req("PUT", `/api/update-user/${satuSatunya.id}`, {
    token: ADMIN,
    body: { nama: satuSatunya.nama, username: satuSatunya.username, role: "user" },
  });
  ok("penurunan admin terakhir ditolak 409", r.status === 409, `dapat ${r.status}`);

  const sesudah = await ambilUser(satuSatunya.id);
  ok("rolenya tetap admin", sesudah?.role === "admin", `dapat ${sesudah?.role}`);
} else {
  // Bukan kegagalan: penjaganya memang hanya berlaku saat tersisa satu admin.
  ok(`penjaga admin terakhir dilewati, ada ${jumlahAdmin} admin`, true);
}

section("User biasa tidak bisa menyentuh role sama sekali");

const dicoba = await req("PUT", "/api/update-user/37", {
  token: USER,
  body: { nama: "x", role: "admin" },
});
ok("user biasa → 403", dicoba.status === 403, `dapat ${dicoba.status}`);

const naikSendiri = await req("PUT", "/api/update-user/36", {
  token: USER,
  body: { nama: "rasimin", role: "admin" },
});
ok("menaikkan diri sendiri → 403", naikSendiri.status === 403, `dapat ${naikSendiri.status}`);

const rasimin = await ambilUser(36);
ok("rasimin tetap role user", rasimin?.role === "user", `dapat ${rasimin?.role}`);

section("Kolom role sampai ke pemeriksaan admin CODE AI");

// getUser di aiController pernah tidak mengambil kolom role. Akibatnya
// user.role undefined untuk semua orang, canManage selalu false, dan
// PUT /api/ai/universal-key menjawab 403 bahkan untuk admin sungguhan:
// kunci universalnya tidak bisa diatur oleh siapa pun. Tidak ada error yang
// muncul di mana pun, jadi hanya uji seperti ini yang menangkapnya.

const statusAdmin = await req("GET", "/api/ai/status", { token: ADMIN });
ok("status CODE AI admin → 200", statusAdmin.status === 200, `dapat ${statusAdmin.status}`);
ok(
  "admin melihat canManage true",
  statusAdmin.body?.universal?.canManage === true,
  `dapat ${statusAdmin.body?.universal?.canManage}, artinya kolom role tidak sampai ke isAdminUser`
);

const statusUser = await req("GET", "/api/ai/status", { token: USER });
ok(
  "user biasa melihat canManage false",
  statusUser.body?.universal?.canManage === false,
  `dapat ${statusUser.body?.universal?.canManage}`
);

// Kunci sengaja tidak valid: ia tidak akan pernah lolos validasi ke Google,
// jadi kunci universal yang sedang dipakai tidak mungkin tertimpa oleh uji ini.
const KUNCI_TIDAK_VALID = "AIzaKunciUjiTidakValidSamaSekali000";

const tulisUser = await req("PUT", "/api/ai/universal-key", {
  token: USER,
  body: { apiKey: KUNCI_TIDAK_VALID },
});
ok("user biasa menulis kunci universal → 403", tulisUser.status === 403, `dapat ${tulisUser.status}`);

const hapusUser = await req("DELETE", "/api/ai/universal-key", { token: USER });
ok("user biasa menghapus kunci universal → 403", hapusUser.status === 403, `dapat ${hapusUser.status}`);

// Yang diuji cuma gerbangnya terbuka, bukan kuncinya diterima. Admin harus
// gagal di validasi, bukan di otorisasi.
const tulisAdmin = await req("PUT", "/api/ai/universal-key", {
  token: ADMIN,
  body: { apiKey: KUNCI_TIDAK_VALID },
});
ok(
  "admin tidak lagi kena 403 saat menulis kunci universal",
  tulisAdmin.status !== 403,
  `dapat 403, gerbangnya masih menolak admin`
);

section("Siklus akun sekali pakai");

let idProbe = null;
try {
  // Body sengaja TIDAK menyebut role: akun baru harus lahir sebagai user.
  const dibuat = await req("POST", "/api/add-user", {
    token: ADMIN,
    body: {
      nama: NAMA_PROBE,
      username: NAMA_PROBE,
      password: "SandiUjiTidakDipakai123",
      departemen: "Plant",
      tipe_akses: "Department Access Only",
    },
  });
  ok("akun probe dibuat", dibuat.status === 200, `dapat ${dibuat.status}`);

  const semua = await req("GET", "/api/users", { token: ADMIN });
  const probe = (semua.body || []).find((u) => u.username === NAMA_PROBE);
  idProbe = probe?.id ?? null;
  ok("akun probe ditemukan", Boolean(probe), "tidak ada di daftar");
  ok("tanpa role di body, bawaannya user", probe?.role === "user", `dapat ${probe?.role}`);

  // Naikkan jadi admin.
  const naik = await req("PUT", `/api/update-user/${idProbe}`, {
    token: ADMIN,
    body: { nama: NAMA_PROBE, username: NAMA_PROBE, role: "admin" },
  });
  ok("dinaikkan jadi admin", naik.status === 200, `dapat ${naik.status}`);
  ok("rolenya tersimpan admin", (await ambilUser(idProbe))?.role === "admin");

  // Inti uji ini. Permintaan tanpa role tidak boleh menyentuh kolomnya.
  // Versi query yang selalu menulis role=? akan menurunkannya ke "user" di
  // sini, dan tidak ada satu pun error yang muncul.
  const tanpaRole = await req("PUT", `/api/update-user/${idProbe}`, {
    token: ADMIN,
    body: { nama: NAMA_PROBE, username: NAMA_PROBE, departemen: "PPIC" },
  });
  ok("update tanpa role → 200", tanpaRole.status === 200, `dapat ${tanpaRole.status}`);

  const sesudahTanpaRole = await ambilUser(idProbe);
  ok(
    "role TIDAK berubah saat tidak dikirim",
    sesudahTanpaRole?.role === "admin",
    `dapat ${sesudahTanpaRole?.role}, artinya kolom role ikut ditulis padahal tidak diminta`
  );
  ok("kolom lain tetap tersimpan", sesudahTanpaRole?.departemen === "PPIC", `dapat ${sesudahTanpaRole?.departemen}`);

  // Sekarang boleh diturunkan: admin aslinya masih ada, jadi ini bukan yang terakhir.
  const turun = await req("PUT", `/api/update-user/${idProbe}`, {
    token: ADMIN,
    body: { nama: NAMA_PROBE, username: NAMA_PROBE, role: "user" },
  });
  ok("diturunkan jadi user → 200", turun.status === 200, `dapat ${turun.status}`);
  ok("rolenya kembali user", (await ambilUser(idProbe))?.role === "user");
} finally {
  // Wajib jalan walau assertion di atas gagal. Akun probe punya approved = 1,
  // jadi meninggalkannya berarti meninggalkan akun yang bisa login.
  if (idProbe) {
    const dihapus = await req("DELETE", `/api/delete-user/${idProbe}`, { token: ADMIN });
    ok("akun probe dibersihkan", dihapus.status === 200, `dapat ${dihapus.status}`);
    ok("tidak tersisa di daftar", (await ambilUser(idProbe)) === null);
  }
}
