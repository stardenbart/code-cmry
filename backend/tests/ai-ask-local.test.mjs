import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

// Dashboard nyata yang boleh diakses user uji, karena handler ask memeriksa
// keberadaan dashboard dan hak aksesnya sebelum apa pun yang lain.
const [[akun]] = await db.promise().query(
  "SELECT id, username FROM users WHERE tipe_akses = 'All Access' AND approved = 1 ORDER BY id LIMIT 1"
);
const [[dash]] = await db.promise().query(
  "SELECT id, title FROM dashboards ORDER BY id LIMIT 1"
);

const USER = tokenFor(akun.id, akun.username);

// Akses CIA dibuka SEMENTARA untuk akun fikstur ini, lalu dikembalikan di akhir.
// Sejak fitur CIA memakai whitelist per user, akun mana pun bawaannya ditolak,
// jadi tanpa ini seluruh uji di bawah gagal 403 bukan karena bug melainkan
// karena haknya memang belum dibuka. Nilai semula disimpan dan dipulihkan supaya
// suite tidak mengubah hak akses akun sungguhan secara permanen.
const [[semulaCia]] = await db.promise().query("SELECT cia_access FROM users WHERE id = ?", [akun.id]);
await db.promise().query("UPDATE users SET cia_access = 1 WHERE id = ?", [akun.id]);
const pulihkanCia = () => db.promise().query("UPDATE users SET cia_access = ? WHERE id = ?", [semulaCia.cia_access, akun.id]);

const snapshot = {
  filters: ["Bulan is Juli 2026"],
  pagesRead: ["OEE & Downtime"],
  visuals: [{
    title: "Downtime per Mesin",
    columns: ["Mesin", "Downtime (Jam)"],
    rows: [["ABP Line 2", "12,5"], ["Serac 2", "8"], ["Filler A", "3,5"]],
    rowCount: 3,
  }],
};

section("Pertanyaan angka dijawab tanpa memanggil model");

const lokal = await req("POST", "/api/ai/ask", {
  token: USER,
  body: { dashboardId: dash.id, question: "Berapa total downtime?", snapshot },
});
ok("dibalas 200", lokal.status === 200, `dapat ${lokal.status} ${JSON.stringify(lokal.body).slice(0, 200)}`);
ok("ditandai dijawab lokal", lokal.body?.meta?.answeredLocally === true, JSON.stringify(lokal.body?.meta));
ok("intent TOTAL", lokal.body?.meta?.intent === "TOTAL", lokal.body?.meta?.intent);
ok("tier lokal", lokal.body?.meta?.tier === "lokal", lokal.body?.meta?.tier);
ok("tidak memakai token",
  (lokal.body?.meta?.usage?.totalTokenCount ?? 0) === 0, JSON.stringify(lokal.body?.meta?.usage));
// 12,5 + 8 + 3,5 = 24
ok("jawabannya memuat angka 24", /\b24\b/.test(String(lokal.body?.answer)), String(lokal.body?.answer).slice(0, 140));
ok("menyertakan konteks filter", /Juli 2026/.test(String(lokal.body?.answer)), String(lokal.body?.answer).slice(0, 140));

section("Tercatat di ai_chat_logs");

const [rows] = await db.promise().query(
  `SELECT intent, answered_locally, model, total_tokens
   FROM ai_chat_logs WHERE user_id = ? AND question = ? ORDER BY id DESC LIMIT 1`,
  [akun.id, "Berapa total downtime?"]
);
ok("baris log ada", rows.length === 1, JSON.stringify(rows));
ok("intent tersimpan", rows[0]?.intent === "TOTAL", JSON.stringify(rows[0]));
ok("answered_locally = 1", Number(rows[0]?.answered_locally) === 1, JSON.stringify(rows[0]));
ok("model dicatat local", rows[0]?.model === "local", JSON.stringify(rows[0]));
ok("token nol", Number(rows[0]?.total_tokens || 0) === 0, JSON.stringify(rows[0]));

section("Pertanyaan analitis TIDAK dijawab lokal");

const analitis = await req("POST", "/api/ai/ask", {
  token: USER,
  body: { dashboardId: dash.id, question: "Kenapa downtime naik drastis bulan ini?", snapshot },
});
// Boleh 200 (dijawab AI) atau 4xx/5xx kalau kunci AI tidak dikonfigurasi di
// mesin uji. Yang TIDAK boleh: ditandai dijawab lokal.
ok("tidak ditandai lokal", analitis.body?.meta?.answeredLocally !== true,
  `meta=${JSON.stringify(analitis.body?.meta)} status=${analitis.status}`);

section("paksaAI melewati jalur lokal");

const paksa = await req("POST", "/api/ai/ask", {
  token: USER,
  body: { dashboardId: dash.id, question: "Berapa total downtime?", snapshot, paksaAI: true },
});
ok("tidak ditandai lokal saat paksaAI", paksa.body?.meta?.answeredLocally !== true,
  `meta=${JSON.stringify(paksa.body?.meta)} status=${paksa.status}`);

section("Bersihkan");

const [del] = await db.promise().query(
  "DELETE FROM ai_chat_logs WHERE user_id = ? AND question IN (?, ?)",
  [akun.id, "Berapa total downtime?", "Kenapa downtime naik drastis bulan ini?"]
);
ok("baris uji dihapus", del.affectedRows >= 1, `${del.affectedRows} baris`);

await pulihkanCia();
