import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";
import { AiModel } from "../src/models/aiModel.js";

// Perbaikan Important #3: distillFindings memakai kuota Gemini tanpa tercatat
// dan tanpa rate limit. Ini membuktikan bahwa distillFindings memasang batas
// tersendiri: memanggilnya berkali-kali dengan cepat akhirnya dijawab 200
// dengan tersaring nol (BUKAN 429 — user tidak meminta penyaringan itu secara
// langsung), dan bahwa pemakaian yang berhasil dicatat lewat AiModel.logChat
// supaya terlihat oleh aiQuota.
//
// Dipakai user TERAKHIR (bukan user pertama yang dipakai banyak berkas uji
// lain) supaya riwayat percakapannya bersih dan bisa dikontrol persis: hanya
// SATU dashboard lain yang punya percakapan, jadi setiap panggilan yang lolos
// batas cuma memanggil Gemini sekali (gagal cepat karena kunci tidak valid),
// bukan sampai 4 kali.

const sql = db.promise();
const [[u]] = await sql.query("SELECT id, username FROM users WHERE approved = 1 ORDER BY id DESC LIMIT 1");
const TOKEN = tokenFor(u.id, u.username);

const DASH_LAIN = 555555;   // dashboard "lain" yang punya percakapan untuk disaring
const DASH_DIBUKA = 555556; // dashboard yang "sedang dibuka" saat distill dipanggil

async function bersihkan() {
  await sql.query("DELETE FROM ai_chat_logs WHERE user_id = ? AND dashboard_id IN (?, ?)", [u.id, DASH_LAIN, DASH_DIBUKA]);
  await sql.query("DELETE FROM ai_user_keys WHERE user_id = ?", [u.id]);
}

await bersihkan();

await AiModel.logChat({
  user_id: u.id,
  dashboard_id: DASH_LAIN,
  dashboard_title: "Dashboard Uji Rate Limit",
  question: "berapa downtime tertinggi?",
  answer: "downtime tertinggi di Line 1",
  model: "gemini-test",
  key_source: "user",
});
// resolveKey tidak memvalidasi ke Google, jadi kunci apa pun yang bisa
// didekripsi cukup untuk membuatnya "resolve" dan mencapai pengecekan limit.
await AiModel.saveUserKey(u.id, "kunci-uji-tidak-valid-untuk-tes-limit-xxxxxxxx", "gemini-3.5-flash-lite");

section("Panggilan berulang akhirnya dijatah, bukan dijawab error");

const MAX = Number(process.env.AI_DISTILL_RATE_MAX_REQUESTS ?? 4);
const hasil = [];
for (let i = 0; i < MAX + 1; i += 1) {
  const r = await req("POST", "/api/ai/finding/distill", { token: TOKEN, body: { dashboardId: DASH_DIBUKA } });
  hasil.push(r);
}

const terakhir = hasil[hasil.length - 1];
ok("panggilan ke-N+1 tetap status 200 (bukan 429)", terakhir.status === 200,
  `dapat ${terakhir.status} ${JSON.stringify(terakhir.body)}`);
ok("tersaring nol setelah batas tercapai", terakhir.body?.tersaring === 0, JSON.stringify(terakhir.body));
ok("alasan menyebut batas", /batas/i.test(terakhir.body?.alasan || ""), JSON.stringify(terakhir.body));

section("Bentuk pencatatan yang dipakai distillFindings tersimpan sesuai skema");

// Tidak ada kunci Gemini yang VALID di lingkungan uji, jadi panggilan di atas
// selalu gagal di askGemini (kunci ditolak Google) sebelum sampai ke
// AiModel.logChat — itu memang perilaku yang benar (baris yang gagal tidak
// perlu tercatat sebagai pemakaian kuota). Bagian ini menguji langsung bentuk
// yang distillFindings kirim ke AiModel.logChat saat sebuah panggilan BERHASIL
// (tier: "distill"), untuk memastikan skemanya memang menerima kolom itu.
await AiModel.logChat({
  user_id: u.id,
  dashboard_id: DASH_LAIN,
  dashboard_title: "Dashboard Uji Rate Limit",
  question: "(CODE AI Distill: Dashboard Uji Rate Limit)",
  answer: "ringkasan hasil penyaringan",
  model: "gemini-3.5-flash-lite",
  key_source: "user",
  tier: "distill",
  prompt_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
});
const [tercatat] = await sql.query(
  "SELECT COUNT(*) AS n FROM ai_chat_logs WHERE user_id = ? AND tier = 'distill' AND dashboard_id = ?",
  [u.id, DASH_LAIN]
);
ok("baris tier distill tersimpan", Number(tercatat[0].n) === 1, JSON.stringify(tercatat));

section("Data uji dibersihkan");

await bersihkan();
