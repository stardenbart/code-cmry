import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

// GET /api/notifications/count/:userId dulu memakai `status != last_notified_status`.
// `last_notified_status` bernilai NULL sampai user membuka halaman notifikasi,
// dan di SQL `status != NULL` menghasilkan NULL bukan true, sehingga hitungannya
// SELALU 0 untuk permintaan yang belum pernah dilihat. Uji ini menjaga agar
// perbandingan null-safe itu tidak hilang lagi.

const ADMIN = tokenFor(4, "digital.transformation");
const USERNAME = `__uji_notifcount_${Date.now()}`;

section("Siapkan akun sekali pakai");

const add = await req("POST", "/api/add-user", {
  token: ADMIN,
  body: {
    nama: "Uji Hitung Notifikasi", departemen: "Plant",
    tipe_akses: "Department Access Only", nik: "",
    email: `${USERNAME}@test.local`, username: USERNAME, password: "UjiHitung123",
  },
});
ok("akun dibuat", add.status === 200, `dapat ${add.status}`);

const daftar = await req("GET", "/api/users", { token: ADMIN });
const akun = (daftar.body || []).find((u) => u.username === USERNAME);
ok("akun ditemukan", Boolean(akun), JSON.stringify(akun));

const UJI = tokenFor(akun.id, USERNAME);

section("Permintaan dengan last_notified_status NULL tetap terhitung");

// Sisipkan langsung supaya tidak bergantung pada PIC email atau alur approve.
await db.promise().query(
  `INSERT INTO access_requests
     (user_id, dashboard_title, dashboard_department, department_requested, status, last_notified_status)
   VALUES (?, ?, ?, ?, 'APPROVED', NULL)`,
  [akun.id, "__uji_dash_notif", "Plant", "Plant"]
);

const hitung = await req("GET", `/api/notifications/count/${akun.id}`, { token: UJI });
ok("endpoint membalas 200", hitung.status === 200, `dapat ${hitung.status}`);
ok("NULL last_notified_status dihitung sebagai belum dibaca",
  hitung.body?.total === 1, `dapat ${JSON.stringify(hitung.body)}, harusnya total 1`);

section("Setelah ditandai terbaca, hitungannya nol");

const tandai = await req("PUT", `/api/notifications/mark-read/${akun.id}`, { token: UJI });
ok("mark-read berhasil", tandai.status === 200, `dapat ${tandai.status}`);

const hitung2 = await req("GET", `/api/notifications/count/${akun.id}`, { token: UJI });
ok("hitungan jadi nol", hitung2.body?.total === 0, `dapat ${JSON.stringify(hitung2.body)}`);

section("Perubahan status membuatnya belum dibaca lagi");

await db.promise().query(
  "UPDATE access_requests SET status = 'DECLINED' WHERE user_id = ? AND dashboard_title = ?",
  [akun.id, "__uji_dash_notif"]
);

const hitung3 = await req("GET", `/api/notifications/count/${akun.id}`, { token: UJI });
ok("status berubah terhitung lagi", hitung3.body?.total === 1, `dapat ${JSON.stringify(hitung3.body)}`);

section("Bersihkan");

await db.promise().query("DELETE FROM access_requests WHERE user_id = ?", [akun.id]);
const hapus = await req("DELETE", `/api/delete-user/${akun.id}`, { token: ADMIN });
ok("akun sekali pakai dihapus", hapus.status === 200, `dapat ${hapus.status}`);

const [[sisa]] = await db
  .promise()
  .query("SELECT COUNT(*) AS n FROM access_requests WHERE dashboard_title = ?", ["__uji_dash_notif"]);
ok("tidak ada baris uji yang tertinggal", sisa.n === 0, `sisa ${sisa.n}`);
