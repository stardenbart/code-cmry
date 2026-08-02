import { ok, section, req, tokenFor } from "./harness.mjs";

// Password tests MUTATE the row they target, so they run against a disposable
// account created and removed here — never a real employee. An earlier version
// pointed at a live user and overwrote their password three times.
const ADMIN = tokenFor(4, "digital.transformation");
const PROBE_USERNAME = "__authz_pwtest__";
const PROBE_PASSWORD = "ProbeLama123!";

section("Persiapan: akun sekali pakai");

// Clean up a leftover from an interrupted run before creating a fresh one.
const before = await req("GET", "/api/users", { token: ADMIN });
const stale = (before.body || []).find((u) => u.username === PROBE_USERNAME);
if (stale) await req("DELETE", `/api/delete-user/${stale.id}`, { token: ADMIN });

const created = await req("POST", "/api/add-user", {
  token: ADMIN,
  body: {
    nama: "Probe Password", departemen: "Plant", tipe_akses: "Department Access Only",
    nik: "", email: "probe@test.local", username: PROBE_USERNAME, password: PROBE_PASSWORD,
  },
});
ok("akun probe dibuat", created.status === 200, `${created.status} ${created.body?.message}`);

const list = await req("GET", "/api/users", { token: ADMIN });
const probe = (list.body || []).find((u) => u.username === PROBE_USERNAME);
ok("id akun probe ditemukan", Boolean(probe?.id), JSON.stringify(probe));

const PROBE_ID = probe?.id;
const PROBE_TOKEN = PROBE_ID ? tokenFor(PROBE_ID, PROBE_USERNAME) : "";

section("Ganti password sendiri wajib password lama");

const noCurrent = await req("PUT", `/api/users/${PROBE_ID}/password`, {
  token: PROBE_TOKEN,
  body: { newPassword: "PasswordBaru123!" },
});
ok("tanpa currentPassword → 400", noCurrent.status === 400, `dapat ${noCurrent.status}`);
ok("pesan menyebut password saat ini",
  /password saat ini/i.test(noCurrent.body?.message || ""), noCurrent.body?.message);

const wrongCurrent = await req("PUT", `/api/users/${PROBE_ID}/password`, {
  token: PROBE_TOKEN,
  body: { currentPassword: "jelas-salah-sekali", newPassword: "PasswordBaru123!" },
});
ok("currentPassword salah → 400", wrongCurrent.status === 400, `dapat ${wrongCurrent.status}`);
ok("pesan menyebut salah", /salah/i.test(wrongCurrent.body?.message || ""), wrongCurrent.body?.message);

section("Password baru divalidasi");

const tooShort = await req("PUT", `/api/users/${PROBE_ID}/password`, {
  token: PROBE_TOKEN,
  body: { currentPassword: PROBE_PASSWORD, newPassword: "123" },
});
ok("password baru terlalu pendek → 400", tooShort.status === 400, `dapat ${tooShort.status}`);
ok("pesan menyebut minimal 8 karakter",
  /8 karakter/i.test(tooShort.body?.message || ""), tooShort.body?.message);

section("Password lama benar → berhasil");

const good = await req("PUT", `/api/users/${PROBE_ID}/password`, {
  token: PROBE_TOKEN,
  body: { currentPassword: PROBE_PASSWORD, newPassword: "PasswordBaru123!" },
});
ok("currentPassword benar → 200", good.status === 200, `${good.status} ${good.body?.message}`);

// Password lama tidak boleh dipakai dua kali
const reuseOld = await req("PUT", `/api/users/${PROBE_ID}/password`, {
  token: PROBE_TOKEN,
  body: { currentPassword: PROBE_PASSWORD, newPassword: "PasswordLain123!" },
});
ok("password lama tidak berlaku lagi setelah diganti", reuseOld.status === 400,
  `dapat ${reuseOld.status}`);

section("Admin me-reset milik orang lain tanpa password lama");

const adminReset = await req("PUT", `/api/users/${PROBE_ID}/password`, {
  token: ADMIN,
  body: { newPassword: "DiresetAdmin123!" },
});
ok("admin berhasil reset tanpa currentPassword", adminReset.status === 200,
  `${adminReset.status} ${adminReset.body?.message}`);

section("Pembersihan");

const removed = await req("DELETE", `/api/delete-user/${PROBE_ID}`, { token: ADMIN });
ok("akun probe dihapus", removed.status === 200, `dapat ${removed.status}`);

const after = await req("GET", "/api/users", { token: ADMIN });
ok("tidak ada sisa akun probe",
  !(after.body || []).some((u) => u.username === PROBE_USERNAME));
