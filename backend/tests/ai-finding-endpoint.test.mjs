import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();
const [[u]] = await sql.query("SELECT id, username FROM users WHERE approved = 1 ORDER BY id LIMIT 1");
const TOKEN = tokenFor(u.id, u.username);

await sql.query("DELETE FROM ai_finding WHERE user_id = ?", [u.id]);

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
// dashboard memang belum punya apa pun untuk dikorelasikan.
const nihil = await req("POST", "/api/ai/finding/distill", {
  token: TOKEN, body: { dashboardId: 44 },
});
ok("status 200", nihil.status === 200, `dapat ${nihil.status} ${JSON.stringify(nihil.body)}`);
ok("melaporkan jumlah tersaring", typeof nihil.body?.tersaring === "number", JSON.stringify(nihil.body));

section("Temuan yang sudah ada terbaca lewat GET");

await sql.query(
  `INSERT INTO ai_finding (user_id, dashboard_id, ringkasan, angka_json, belum_terjawab, turn_terakhir)
   VALUES (?, 44, 'Losses PM naik di CMD 2', CAST('[{"measure":"% Losses Packing","nilai":0.001}]' AS JSON), 'penyebabnya', 5)`,
  [u.id]
);
const ada = await req("GET", "/api/ai/finding", { token: TOKEN });
ok("satu temuan terbaca", ada.body.temuan.length === 1, JSON.stringify(ada.body.temuan));
ok("ringkasan terbaca", ada.body.temuan[0].ringkasan === "Losses PM naik di CMD 2");
ok("nama dashboard ikut", typeof ada.body.temuan[0].dashboardTitle === "string");
ok("angka ikut", ada.body.temuan[0].angka[0].measure === "% Losses Packing");

section("Data uji dibersihkan");

await sql.query("DELETE FROM ai_finding WHERE user_id = ?", [u.id]);
const [[sisa]] = await sql.query("SELECT COUNT(*) n FROM ai_finding WHERE user_id = ?", [u.id]);
ok("tidak ada sisa", Number(sisa.n) === 0, `sisa ${sisa.n}`);
