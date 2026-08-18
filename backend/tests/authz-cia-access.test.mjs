// Penjaga akses fitur CIA.
//
// Aturannya: MENOLAK secara default, dan hanya dibuka admin per user.
//
// Yang dijaga paling ketat di sini adalah hal yang mudah disalahpahami sebagai
// sudah aman: menyembunyikan tombol di web BUKAN kontrol akses. Endpoint CIA
// tetap bisa dipanggil langsung oleh siapa pun yang punya token, jadi yang diuji
// di bawah adalah penolakan di SERVER, bukan tampilannya.
//
// Memakai akun sekali pakai, bukan akun nyata, dengan alasan yang sama seperti
// tests/ai-finding-model.test.mjs: uji tidak boleh mengubah hak akses orang
// sungguhan, dan akun yang dibuat khusus dijamin belum punya akses apa pun.
import { ok, section, req, tokenFor } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();

const [[admin]] = await sql.query(
  "SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
);
const ADMIN = tokenFor(admin.id, admin.username);

const NAMA_PROBE = "__uji_cia_akses__";

// Sisa run sebelumnya dibersihkan supaya uji tidak bergantung urutan.
await sql.query("DELETE FROM users WHERE username = ?", [NAMA_PROBE]);

const dibuat = await req("POST", "/api/add-user", {
  token: ADMIN,
  body: {
    nama: NAMA_PROBE,
    departemen: "Uji",
    tipe_akses: "Department Access Only",
    nik: "UJI-CIA",
    email: `${NAMA_PROBE}@contoh.invalid`,
    username: NAMA_PROBE,
    password: "UjiCia#2026",
  },
});
if (dibuat.status !== 200) throw new Error(`gagal membuat akun probe: ${dibuat.status}`);

const semua = await req("GET", "/api/users", { token: ADMIN });
const probe = (semua.body || []).find((u) => u.username === NAMA_PROBE);
if (!probe) throw new Error("akun probe tidak ditemukan sesudah dibuat");

const TOKEN = tokenFor(probe.id, NAMA_PROBE);

try {
  section("Akun baru DITOLAK secara default");

  ok(
    "akun baru tidak punya akses CIA",
    Number(probe.cia_access) === 0,
    `cia_access ${probe.cia_access}`
  );

  // Setiap rute pemakaian CIA diuji, bukan hanya satu. Penjaga yang terpasang di
  // sebagian rute saja tetap menyisakan pintu terbuka, dan pintu yang terlewat
  // tidak menimbulkan error apa pun sampai ada yang memakainya.
  const rute = [
    ["POST", "/api/ai/ask", { dashboardId: 1, question: "halo" }],
    ["POST", "/api/ai/navigate", { question: "halo" }],
    ["GET", "/api/ai/finding", null],
    ["POST", "/api/ai/finding/distill", { dashboardId: 1 }],
    ["GET", "/api/ai/history/1", null],
    ["DELETE", "/api/ai/history/1", null],
    // Chat lintas dashboard. Halamannya /cia-chat memang hanya muncul untuk
    // yang aksesnya dibuka, tapi alamatnya bisa diketik siapa saja dan
    // endpointnya bisa dipanggil tanpa lewat web sama sekali.
    ["POST", "/api/ai/unified/ask", { question: "halo" }],
    ["POST", "/api/ai/unified/suggest", { question: "halo" }],
    ["GET", "/api/ai/unified/conversations", null],
    ["GET", "/api/ai/unified/conversations/1/turns", null],
    ["DELETE", "/api/ai/unified/conversations/1", null],
  ];

  for (const [metode, jalur, body] of rute) {
    const r = await req(metode, jalur, { token: TOKEN, ...(body ? { body } : {}) });
    ok(`${metode} ${jalur} ditolak 403`, r.status === 403, `dapat ${r.status}`);
  }

  section("Alasannya bisa ditindaklanjuti, bukan sekadar ditolak");

  const ditolak = await req("GET", "/api/ai/finding", { token: TOKEN });
  ok("membawa kode yang bisa dikenali web", ditolak.body?.kode === "CIA_TIDAK_DIIZINKAN", JSON.stringify(ditolak.body));
  ok("menyebut cara mendapatkannya", /admin/i.test(ditolak.body?.message || ""), ditolak.body?.message);

  section("Status melaporkan hak aksesnya supaya web bisa menyembunyikan pintu masuk");

  // /status SENGAJA tidak ikut dijaga: kalau ikut ditolak, web tidak punya cara
  // mengetahui bahwa pintu masuknya harus disembunyikan.
  const status = await req("GET", "/api/ai/status", { token: TOKEN });
  ok("status tetap bisa dibaca", status.status === 200, `dapat ${status.status}`);
  ok("melaporkan ciaAccess false", status.body?.ciaAccess === false, JSON.stringify(status.body?.ciaAccess));
  ok("enabled ikut false walau kunci tersedia", status.body?.enabled === false, JSON.stringify(status.body?.enabled));

  section("Admin membuka akses, lalu diterima");

  const buka = await req("PUT", `/api/update-user/${probe.id}`, {
    token: ADMIN,
    body: {
      nama: NAMA_PROBE,
      departemen: "Uji",
      tipe_akses: "Department Access Only",
      nik: "UJI-CIA",
      email: `${NAMA_PROBE}@contoh.invalid`,
      username: NAMA_PROBE,
      ciaAccess: true,
    },
  });
  ok("admin bisa membuka akses", buka.status === 200, `dapat ${buka.status}`);

  const sesudah = await req("GET", "/api/ai/finding", { token: TOKEN });
  ok("tidak lagi 403 sesudah dibuka", sesudah.status !== 403, `dapat ${sesudah.status}`);

  const statusSesudah = await req("GET", "/api/ai/status", { token: TOKEN });
  ok("status melaporkan ciaAccess true", statusSesudah.body?.ciaAccess === true, JSON.stringify(statusSesudah.body?.ciaAccess));

  section("Penyuntingan biasa tidak mencabut akses diam-diam");

  // Pola yang sama dengan kolom role: kalau kolomnya ditulis tanpa syarat,
  // setiap penyuntingan yang tidak menyertakannya akan mencabut akses orang itu
  // tanpa ada yang bermaksud demikian.
  const suntingTanpaFlag = await req("PUT", `/api/update-user/${probe.id}`, {
    token: ADMIN,
    body: {
      nama: NAMA_PROBE,
      departemen: "Uji Diubah",
      tipe_akses: "Department Access Only",
      nik: "UJI-CIA",
      email: `${NAMA_PROBE}@contoh.invalid`,
      username: NAMA_PROBE,
    },
  });
  ok("penyuntingan tanpa flag berhasil", suntingTanpaFlag.status === 200, `dapat ${suntingTanpaFlag.status}`);

  const masihBoleh = await req("GET", "/api/ai/status", { token: TOKEN });
  ok(
    "akses CIA TIDAK ikut tercabut",
    masihBoleh.body?.ciaAccess === true,
    JSON.stringify(masihBoleh.body?.ciaAccess)
  );

  section("Admin bisa mencabut kembali");

  await req("PUT", `/api/update-user/${probe.id}`, {
    token: ADMIN,
    body: {
      nama: NAMA_PROBE,
      departemen: "Uji",
      tipe_akses: "Department Access Only",
      nik: "UJI-CIA",
      email: `${NAMA_PROBE}@contoh.invalid`,
      username: NAMA_PROBE,
      ciaAccess: false,
    },
  });
  const dicabut = await req("GET", "/api/ai/finding", { token: TOKEN });
  ok("ditolak lagi sesudah dicabut", dicabut.status === 403, `dapat ${dicabut.status}`);
} finally {
  // Di blok finally supaya akun probe tetap terhapus walau ada asersi yang gagal.
  await sql.query("DELETE FROM users WHERE username = ?", [NAMA_PROBE]);
  const [[sisa]] = await sql.query("SELECT COUNT(*) n FROM users WHERE username = ?", [NAMA_PROBE]);
  ok("akun probe dibersihkan", Number(sisa.n) === 0, `sisa ${sisa.n}`);
}
