// ─────────────────────────────────────────────────────────────────────────────
// Akun sekali pakai, bukan akun nyata — sama seperti alasan di
// tests/ai-finding-model.test.mjs dan tests/user-role.test.mjs.
//
// Versi sebelumnya memakai "user pertama yang approved" sebagai fixture, dan
// itu akun NYATA yang bisa sedang dipakai sungguhan. GET /api/ai/finding
// membaca SEMUA temuan milik akun itu (bukan hanya yang dibuat uji), dan
// "Data uji dibersihkan" menghapus SEMUA ai_finding milik akun itu tanpa
// dibatasi ke baris yang dibuat uji — dua-duanya bisa membaca ATAU menghapus
// memori lintas dashboard yang sungguhan milik user tersebut.
// ─────────────────────────────────────────────────────────────────────────────

import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();

const [[admin]] = await sql.query("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
const ADMIN = tokenFor(admin.id, admin.username);
const NAMA_PROBE = "__uji_finding_endpoint__";

let idProbe = null;
try {
  const dibuat = await req("POST", "/api/add-user", {
    token: ADMIN,
    body: {
      nama: NAMA_PROBE, username: NAMA_PROBE, password: "SandiUjiTidakDipakai123",
      departemen: "Plant", tipe_akses: "Department Access Only",
    },
  });
  if (dibuat.status !== 200) throw new Error(`gagal membuat akun probe: ${dibuat.status}`);
  const semua = await req("GET", "/api/users", { token: ADMIN });
  idProbe = (semua.body || []).find((u) => u.username === NAMA_PROBE)?.id ?? null;
  if (!idProbe) throw new Error("akun probe tidak ditemukan sesudah dibuat");

  // Akun probe baru bawaannya TIDAK punya akses CIA, sama seperti akun sungguhan
  // yang baru dibuat. Dibukakan di sini karena yang diuji berkas ini adalah
  // endpoint temuannya, bukan penjaga aksesnya; penjaganya diuji tersendiri di
  // tests/authz-cia-access.test.mjs.
  await db.promise().query("UPDATE users SET cia_access = 1 WHERE id = ?", [idProbe]);

  const TOKEN = tokenFor(idProbe, NAMA_PROBE);

  section("Endpoint temuan menolak yang tidak berhak");

  for (const [method, path] of [["GET", "/api/ai/finding"], ["POST", "/api/ai/finding/distill"]]) {
    const r = await req(method, path, { body: {} });
    ok(`${method} ${path} tanpa token -> 401`, r.status === 401, `dapat ${r.status}`);
  }

  section("GET finding mengembalikan daftar kosong, bukan error");

  // Belum ada temuan adalah keadaan normal, bukan kegagalan. Mengembalikan 404
  // akan membuat frontend menampilkan error pada pemakaian pertama setiap user.
  const kosong = await req("GET", "/api/ai/finding", { token: TOKEN });
  ok("status 200", kosong.status === 200, `dapat ${kosong.status}`);
  ok("membawa array", Array.isArray(kosong.body?.temuan), JSON.stringify(kosong.body));
  ok("kosong", kosong.body.temuan.length === 0, JSON.stringify(kosong.body.temuan));
  ok("menyebut jendela jam", typeof kosong.body?.jendelaJam === "number", JSON.stringify(kosong.body));

  section("Distill tanpa dashboardId ditolak");

  for (const body of [{}, { dashboardId: "abc" }, { dashboardId: -1 }, { dashboardId: 0 }]) {
    const r = await req("POST", "/api/ai/finding/distill", { token: TOKEN, body });
    ok(`body ${JSON.stringify(body)} -> 400`, r.status === 400, `dapat ${r.status}`);
  }

  section("Distill tanpa percakapan lain melaporkan tidak ada yang disaring");

  // Tidak ada yang perlu disaring bukan kegagalan: user yang baru membuka satu
  // dashboard memang belum punya apa pun untuk dikorelasikan. dashboardId 44
  // aman dipakai di sini karena baris yang dicari dibatasi ke user_id akun
  // probe ini, yang baru dibuat dan tidak mungkin punya percakapan apa pun.
  const nihil = await req("POST", "/api/ai/finding/distill", {
    token: TOKEN, body: { dashboardId: 44 },
  });
  ok("status 200", nihil.status === 200, `dapat ${nihil.status} ${JSON.stringify(nihil.body)}`);
  ok("melaporkan jumlah tersaring", typeof nihil.body?.tersaring === "number", JSON.stringify(nihil.body));

  section("Temuan yang sudah ada terbaca lewat GET");

  await sql.query(
    `INSERT INTO ai_finding (user_id, dashboard_id, ringkasan, angka_json, belum_terjawab, turn_terakhir)
     VALUES (?, 44, 'Losses PM naik di CMD 2', CAST('[{"measure":"% Losses Packing","nilai":0.001}]' AS JSON), 'penyebabnya', 5)`,
    [idProbe]
  );
  const ada = await req("GET", "/api/ai/finding", { token: TOKEN });
  ok("satu temuan terbaca", ada.body.temuan.length === 1, JSON.stringify(ada.body.temuan));
  ok("ringkasan terbaca", ada.body.temuan[0].ringkasan === "Losses PM naik di CMD 2");
  ok("nama dashboard ikut", typeof ada.body.temuan[0].dashboardTitle === "string");
  ok("angka ikut", ada.body.temuan[0].angka[0].measure === "% Losses Packing");
} finally {
  // Menghapus akun probe menghapus SELURUH ai_finding miliknya lewat
  // ON DELETE CASCADE di fk_finding_user — tidak ada DELETE manual atas
  // ai_finding yang bisa salah sasaran ke akun lain.
  section("Data uji dibersihkan");

  if (idProbe) {
    await req("DELETE", `/api/delete-user/${idProbe}`, { token: ADMIN });
    const [[sisa]] = await sql.query("SELECT COUNT(*) n FROM ai_finding WHERE user_id = ?", [idProbe]);
    ok("tidak ada sisa temuan milik akun probe", Number(sisa.n) === 0, `sisa ${sisa.n}`);
  }
  const [[sisaUser]] = await sql.query("SELECT COUNT(*) n FROM users WHERE username = ?", [NAMA_PROBE]);
  ok("akun probe tidak tersisa", Number(sisaUser.n) === 0, `sisa ${sisaUser.n}`);
}
