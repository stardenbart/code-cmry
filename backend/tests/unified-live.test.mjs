// Satu panggilan sungguhan ke chat lintas dashboard, dengan akses CIA DIBUKA.
//
// Alasannya spesifik. authz-cia-access.test.mjs menguji rute yang sama, tapi
// requireCiaAccess menolak SEBELUM badan controller jalan, jadi 403 tetap
// terbit walau isi controllernya rusak total. Dua bug nyata lolos dari 1127
// asersi hijau justru karena itu:
//
//   1. rateLimit.getRateLimiter() — nama fungsi yang tidak pernah ada.
//      Modulnya mengekspor hit(). Setiap panggilan mati 500.
//   2. classifyRelevantDashboards memanggil askGemini tanpa apiKey dan dengan
//      nama parameter yang salah semua. Hasilnya SELALU classifier_error, dan
//      saran dashboard selalu kosong tanpa satu pun galat sampai ke user.
//
// Yang kedua paling berbahaya: statusnya 200. Fitur terlihat hidup padahal
// tidak pernah menyarankan apa pun.
//
// Memakai akun yang aksesnya SUDAH dibuka admin, bukan membuka akses sendiri:
// uji tidak boleh mengubah hak akses orang. Kalau belum ada yang dibuka,
// uji ini melewat dengan terang, bukan diam-diam lulus.
import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();

const [[pemakai]] = await sql.query(
  "SELECT id, username FROM users WHERE cia_access = 1 ORDER BY id LIMIT 1"
);

section("Chat lintas dashboard menembus badan controller");

if (!pemakai) {
  console.log("  SKIP  belum ada user dengan cia_access = 1");
} else {
  const TOKEN = tokenFor(pemakai.id, pemakai.username);

  const saran = await req("POST", "/api/ai/unified/suggest", {
    token: TOKEN,
    body: { question: "Berapa OEE line produksi bulan ini?" },
  });

  // 500 di sini berarti badan controller melempar. Itulah bentuk kedua bug tadi.
  ok("suggest tidak 500", saran.status !== 500, JSON.stringify(saran.body));
  ok("suggest 200", saran.status === 200, `dapat ${saran.status}`);

  // classifier_error adalah kegagalan diam: statusnya tetap 200, tapi tidak ada
  // satu pun dashboard yang pernah bisa disarankan.
  //
  // quota_habis dipisahkan dan DILEWATKAN, bukan diluluskan: itu keadaan sah
  // di lingkungan uji (kuota free-tier harian bersama), tapi menganggapnya
  // lulus akan menyembunyikan cacat kode di balik habisnya kuota. Melewat
  // dengan terang, sama seperti saat tidak ada user ber-akses CIA.
  const alasan = String(saran.body?.alasanRouter);
  if (alasan === "quota_habis") {
    console.log("  SKIP  kuota Gemini habis - klasifikasi tidak bisa diuji sekarang");
  } else {
    ok(
      "klasifikasi tidak jatuh ke galat teknis",
      !["classifier_error", "parse_error", "no_api_key"].includes(alasan),
      alasan
    );
  }

  const tanya = await req("POST", "/api/ai/unified/ask", {
    token: TOKEN,
    body: { question: "Berapa OEE line produksi bulan ini?" },
  });
  ok("ask tidak 500", tanya.status !== 500, JSON.stringify(tanya.body));
  ok("ask 200", tanya.status === 200, `dapat ${tanya.status}`);

  // Tanpa snapshot, jawabannya WAJIB saran, bukan angka. Membedakan keduanya
  // adalah inti fiturnya: jawaban tanpa data yang terdengar berdata adalah
  // kegagalan termahal di sistem ini.
  ok(
    "tanpa snapshot tidak mengaku memakai dashboard",
    Array.isArray(tanya.body?.dashboards_used) && tanya.body.dashboards_used.length === 0,
    JSON.stringify(tanya.body?.dashboards_used)
  );

  // Percakapan uji dibuang supaya tidak menumpuk di riwayat orang.
  if (tanya.body?.conversation_id) {
    await req("DELETE", `/api/ai/unified/conversations/${tanya.body.conversation_id}`, {
      token: TOKEN,
    });
  }
}
