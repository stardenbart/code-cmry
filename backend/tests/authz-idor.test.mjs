import { ok, section, req, tokenFor } from "./harness.mjs";

const ADMIN    = tokenFor(4, "digital.transformation");
const USER_ID  = 36;   // rasimin
const USER     = tokenFor(USER_ID, "rasimin");
const VICTIM_ID = 37;  // ardi

section("user_id pada body diabaikan");

// Berpura-pura sebagai user lain. Request boleh saja dibuat, tapi HARUS
// tercatat atas nama pengirim token — bukan atas nama korban.
const spoof = await req("POST", "/api/request-access", {
  token: USER,
  body: {
    user_id: VICTIM_ID,
    dashboard_title: "__idor_probe__",
    dashboard_department: "Engineering",
    department_requested: "Engineering",
  },
});

// Dashboard "__idor_probe__" tidak ada, jadi request gagal di tahap PIC email
// atau berhasil tercatat atas nama pengirim. Yang penting: tidak atas korban.
const victimLog = await req("GET", `/api/access-requests-log/${VICTIM_ID}`, { token: ADMIN });
const victimHasProbe = (victimLog.body || []).some((r) => r.dashboard_title === "__idor_probe__");
ok("request TIDAK tercatat atas nama korban", !victimHasProbe,
  `status ${spoof.status}, entri korban: ${JSON.stringify(victimLog.body?.slice?.(0, 2))}`);

const selfLog = await req("GET", `/api/access-requests-log/${USER_ID}`, { token: USER });
const selfHasProbe = (selfLog.body || []).some((r) => r.dashboard_title === "__idor_probe__");
ok("kalau tercatat, atas nama pengirim token", spoof.status !== 200 || selfHasProbe,
  `status ${spoof.status}`);

// Bersihkan jejak probe milik pengirim
if (selfHasProbe) {
  await req("POST", "/api/cancel-request", {
    token: USER,
    body: { dashboard_title: "__idor_probe__" },
  });
}

const spoofCancel = await req("POST", "/api/cancel-request", {
  token: USER,
  body: { user_id: VICTIM_ID, dashboard_title: "Technical Downtime Report" },
});
ok("cancel atas nama user lain tidak menghapus milik korban",
  spoofCancel.status === 404 || spoofCancel.status === 400,
  `dapat ${spoofCancel.status}`);

section("Registrasi mandiri tidak bisa meminta All Access");

const stamp = Date.now();
const probeUsername = `__reg_probe_${stamp}`;
const reg = await req("POST", "/api/register", {
  body: {
    nama: "Probe Registrasi",
    departemen: "Plant",
    tipe_akses: "All Access",          // harus diabaikan
    nik: "",
    email: `probe${stamp}@test.local`,
    username: probeUsername,
    password: "PasswordProbe123",
  },
});
ok("registrasi berhasil", reg.status === 200, `${reg.status} ${reg.body?.message}`);

const users = await req("GET", "/api/users", { token: ADMIN });
const registered = (users.body || []).find((u) => u.username === probeUsername);
ok("akun terdaftar ditemukan", Boolean(registered), JSON.stringify(registered));
ok("tipe_akses dipaksa Department Access Only",
  registered?.tipe_akses === "Department Access Only", registered?.tipe_akses);
ok("belum disetujui", registered?.approved === 0 || registered?.approved === false,
  String(registered?.approved));

// Bersihkan
if (registered?.id) {
  const del = await req("DELETE", `/api/delete-user/${registered.id}`, { token: ADMIN });
  ok("akun probe registrasi dihapus", del.status === 200, `dapat ${del.status}`);
}
